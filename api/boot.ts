import "dotenv/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { getDb } from "./queries/connection";
import { farmers, messages, conversations } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// ============ WHATSAPP WEBHOOK HTTP ENDPOINT ============
// WhatsApp sends raw HTTP requests (NOT tRPC), so we need a Hono route

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "farmer_verify_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

// 1. Verification endpoint (GET) — Facebook calls this to verify the webhook
app.get("/api/webhook/whatsapp", async (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WhatsApp] Webhook verified successfully");
    return c.text(challenge ?? "OK");
  }

  return c.json({ error: "Verification failed" }, 403);
});

// 2. Message receiving endpoint (POST) — WhatsApp sends messages here
app.post("/api/webhook/whatsapp", async (c) => {
  try {
    const body = await c.req.json();
    console.log("[WhatsApp] Received webhook:", JSON.stringify(body, null, 2));

    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        const messages_data = change.value?.messages ?? [];
        for (const msg of messages_data) {
          const from = msg.from;           // Sender's phone number
          const text = msg.text?.body ?? ""; // Message text
          const type = msg.type ?? "text";   // Message type

          if (text) {
            await processIncomingMessage(from, text, type);
          }
        }
      }
    }

    return c.json({ status: "ok" });
  } catch (err: any) {
    console.error("[WhatsApp] Webhook error:", err.message);
    return c.json({ status: "error", message: err.message }, 500);
  }
});

// Normalize phone number: remove +, spaces, dashes — keep only digits
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").trim();
}

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber: string, message: string, contentType: string) {
  const db = getDb();

  // Normalize phone number before lookup
  const normalizedPhone = normalizePhone(phoneNumber);

  // 1. Find or create farmer (using normalized phone)
  let farmer = await db.select().from(farmers).where(eq(farmers.phoneNumber, normalizedPhone)).limit(1);

  let farmerId: number;
  if (!farmer[0]) {
    const result = await db.insert(farmers).values({
      phoneNumber: normalizedPhone,
      preferredLanguage: "english",
      isActive: true,
    });
    farmerId = Number(result[0].insertId);
    console.log(`[WhatsApp] New farmer registered: ${normalizedPhone}`);
  } else {
    farmerId = farmer[0].id;
  }

  // 2. Find or create active conversation
  let conversation = await db.select().from(conversations)
    .where(sql`${conversations.farmerId} = ${farmerId} AND ${conversations.status} = 'active'`)
    .orderBy(desc(conversations.createdAt)).limit(1);

  let conversationId: number;
  if (!conversation[0]) {
    const result = await db.insert(conversations).values({ farmerId, status: "active" });
    conversationId = Number(result[0].insertId);
  } else {
    conversationId = conversation[0].id;
  }

  // 3. Detect intent
  const intent = detectIntent(message);

  // 4. Generate AI response (async for weather with location)
  const lang = farmer[0]?.preferredLanguage ?? "english";
  const farmerDistrict = farmer[0]?.district;
  const farmerState = farmer[0]?.state;
  const aiResponse = await generateAIResponse(intent, lang, farmerDistrict, farmerState);

  // 5. Save farmer message
  await db.insert(messages).values({
    conversationId, farmerId, senderType: "farmer",
    contentType: contentType as "text" | "voice" | "image" | "template",
    content: message, language: lang, intentDetected: intent,
  });

  // 6. Save AI response
  await db.insert(messages).values({
    conversationId, farmerId, senderType: "ai",
    contentType: "text", content: aiResponse,
    language: lang, aiResponse, intentDetected: intent,
  });

  // 7. Update conversation
  await db.update(conversations).set({
    intent, messageCount: sql`${conversations.messageCount} + 2`, updatedAt: new Date(),
  }).where(eq(conversations.id, conversationId));

  // 8. Update farmer stats
  await db.update(farmers).set({
    totalInteractions: sql`${farmers.totalInteractions} + 1`,
    lastInteractionAt: new Date(), updatedAt: new Date(),
  }).where(eq(farmers.id, farmerId));

  console.log(`[WhatsApp] Processed message from ${phoneNumber}: intent=${intent}`);

  // 9. Send AI response back to farmer via WhatsApp
  await sendWhatsAppMessage(phoneNumber, aiResponse);
}

// Send message back to farmer via WhatsApp Cloud API
async function sendWhatsAppMessage(toPhoneNumber: string, message: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.warn("[WhatsApp] Cannot send message: Missing ACCESS_TOKEN or PHONE_NUMBER_ID in .env");
    return;
  }

  // Normalize phone: remove +, spaces, dashes — WhatsApp API needs digits only
  const normalizedTo = normalizePhone(toPhoneNumber);
  if (normalizedTo.length < 10) {
    console.error(`[WhatsApp] Invalid phone number: ${toPhoneNumber} (normalized: ${normalizedTo})`);
    return;
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "text",
        text: { body: message },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`[WhatsApp] Failed to send to ${normalizedTo}:`, JSON.stringify(result));
      return;
    }

    console.log(`[WhatsApp] Message sent to ${normalizedTo}: ${message.substring(0, 50)}...`);
  } catch (err: any) {
    console.error(`[WhatsApp] Error sending message to ${normalizedTo}:`, err.message);
  }
}

// Geocode location to lat/lon using Open-Meteo
async function geocodeLocation(district: string, state: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    // Try district name alone first (most reliable)
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(district)}&count=3&language=en&format=json`);
    const data = await res.json();
    console.log(`[Weather] Geocode for "${district}":`, JSON.stringify(data.results?.map((r: any) => ({ name: r.name, country: r.country })) ?? "no results"));

    if (data.results && data.results.length > 0) {
      // Pick the one in India if multiple
      const indiaResult = data.results.find((r: any) => r.country === "India");
      const best = indiaResult ?? data.results[0];
      return { lat: best.latitude, lon: best.longitude, name: best.name };
    }
  } catch (e) {
    console.error("[Weather] Geocoding error:", e);
  }
  return null;
}

// Fetch weather from Open-Meteo
async function fetchWeather(district: string, state: string): Promise<{ temp: number; humidity: number; rainProb: number; condition: string; forecast: string } | null> {
  try {
    const geo = await geocodeLocation(district, state);
    if (!geo) {
      console.error(`[Weather] Could not geocode: ${district}, ${state}`);
      return null;
    }
    console.log(`[Weather] Geocoded ${district} → ${geo.name} (${geo.lat}, ${geo.lon})`);

    // precipitation_probability is NOT in current - use daily for rain chance
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,relative_humidity_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`;
    console.log(`[Weather] API URL: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Weather] API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    console.log(`[Weather] API response keys:`, Object.keys(data));

    if (!data.current) {
      console.error(`[Weather] No current data in response`);
      return null;
    }

    const current = data.current;
    const daily = data.daily;

    // WMO weather code to text
    const wmoCodes: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Rime fog",
      51: "Light drizzle", 53: "Moderate drizzle", 55: "Heavy drizzle",
      61: "Light rain", 63: "Moderate rain", 65: "Heavy rain",
      71: "Light snow", 73: "Moderate snow", 75: "Heavy snow",
      80: "Rain showers", 81: "Moderate showers", 82: "Heavy showers",
      95: "Thunderstorm", 96: "Thunderstorm with hail",
    };

    const condition = wmoCodes[current.weather_code] ?? "Unknown";
    // Use daily precipitation_probability_max for today
    const rainProb = daily?.precipitation_probability_max?.[0] ?? 0;

    console.log(`[Weather] Result: ${Math.round(current.temperature_2m)}°C, ${condition}, Humidity: ${current.relative_humidity_2m}%, Rain: ${rainProb}%`);

    return {
      temp: Math.round(current.temperature_2m),
      humidity: current.relative_humidity_2m,
      rainProb,
      condition,
      forecast: `High: ${Math.round(daily.temperature_2m_max[0])}°C, Low: ${Math.round(daily.temperature_2m_min[0])}°C`,
    };
  } catch (e: any) {
    console.error("[Weather] Fetch error:", e.message);
  }
  return null;
}

// Format weather response in farmer's language
async function getWeatherResponse(district: string, state: string, lang: string): Promise<string> {
  console.log(`[Weather] Getting weather for ${district}, ${state} in ${lang}`);
  const weather = await fetchWeather(district, state);
  if (!weather) {
    const fallbacks: Record<string, string> = {
      english: `Weather for ${district}:\n\nUnable to fetch live data. Please try again later.`,
      hindi: `${district} का मौसम:\n\nलाइव डेटा प्राप्त करने में असफल। कृपया बाद में प्रयास करें।`,
      telugu: `${district} వాతావరణం:\n\nలైవ్ డేటా అందుకోలేకపోయాము. దయచేసి మళ్ళీ ప్రయత్నించండి.`,
      kannada: `${district} ಹವಾಮಾನ:\n\nಲೈವ್ ಡೇಟಾ ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
    };
    return fallbacks[lang] ?? fallbacks.english;
  }

  const templates: Record<string, (w: typeof weather, loc: string) => string> = {
    english: (w, loc) => `Weather for ${loc}:\n\nNow: ${w.temp}°C, ${w.condition}\nHumidity: ${w.humidity}%\nRain chance: ${w.rainProb}%\nToday: ${w.forecast}\n\n${w.rainProb > 50 ? "Carry umbrella! Rain likely." : "Good weather for farm work today."}`,
    hindi: (w, loc) => `${loc} का मौसम:\n\nअभी: ${w.temp}°C, ${w.condition}\nनमी: ${w.humidity}%\nबारिश की संभावना: ${w.rainProb}%\nआज: ${w.forecast}\n\n${w.rainProb > 50 ? "छाता ले जाएं! बारिश की संभावना है।" : "आज खेती के लिए अच्छा मौसम है।"}`,
    telugu: (w, loc) => `${loc} వాతావరణం:\n\nఇప్పుడు: ${w.temp}°C, ${w.condition}\nతేగోవత: ${w.humidity}%\nవర్షం అవకాశం: ${w.rainProb}%\nఈరోజు: ${w.forecast}\n\n${w.rainProb > 50 ? "గొడ్డ తీసుకొని వెళ్ళండి! వర్షం అవకాశం ఉంది." : "ఈరోజు రైతు పనికి మంచి వాతావరణం."}`,
    kannada: (w, loc) => `${loc} ಹವಾಮಾನ:\n\nಈಗ: ${w.temp}°C, ${w.condition}\nಆರ್ದ್ರತೆ: ${w.humidity}%\nಮಳೆ ಸಂಭವನೀಯತೆ: ${w.rainProb}%\nಇವತ್ತು: ${w.forecast}\n\n${w.rainProb > 50 ? "ಕುಡುರೆ ತೆಗೆದುಕೊಂಡು ಹೋಗಿ! ಮಳೆ ಸಾಧ್ಯತೆ ಇದೆ." : "ಇವತ್ತು ಕೃಷಿ ಕೆಲಸಕ್ಕೆ ಒಳ್ಳೆಯ ಹವಾಮಾನ."}`,
  };

  const template = templates[lang] ?? templates.english;
  return template(weather, district);
}

function detectIntent(message: string): string {
  const lower = message.toLowerCase().trim();

  // Native script keywords (Telugu, Hindi, Kannada) + English
  const intents = [
    {
      keywords: [
        "weather", "rain", "temperature", "forecast", "mausam", "barish",
        "vaana", "vaanam", "avadhanam", "havaaman", "havamana",
        "వాతావరణం", "వాన", "వర్షం", "వాతావరణ", "మోసం", "మౌసమ్",
        "मौसम", "बारिश", "मौसमी", "वर्षा", "तापमान",
        "ಹವಾಮಾನ", "ಮಳೆ", "ತಾಪಮಾನ",
      ],
      intent: "weather",
    },
    {
      keywords: [
        "price", "rate", "cost", "value", "selling", "mandi", "bazar", "market",
        "dhara", "dar", "bele", "belli", "dhaam", "bhaav",
        "ధర", "ధరలు", "మార్కెట్", "మార్కెట్ ధరలు", "మార్కెటు", "బజార్", "మండి",
        "మార్కెట్ ధర", "అమ్మకం", "కొనుగోలు", "ధరల",
        "भाव", "दाम", "मंडी", "बाजार", "कीमत", "मूल्य", "बिक्री", "बेचने",
        "ಬೆಲೆ", "ಬೆಲೆಗಳು", "ಮಾರುಕಟ್ಟೆ", "ಮಂಡಿ", "ಮಾರಾಟ",
      ],
      intent: "market_price",
    },
    {
      keywords: [
        "scheme", "yojana", "subsidy", "loan", "pension", "government",
        "yojane", "paddhati", "salle", "vritti",
        "పథకం", "పథకాలు", "యోజన", "యోజనలు", "సబ్సిడీ", "రుణం", "పెన్షన్",
        "ప్రభుత్వ", "ప్రభుత్వ పథకాలు", "సహాయం", "అర్హత",
        "योजना", "योजनाएं", "सब्सिडी", "ऋण", "सरकारी", "सरकारी योजना",
        "ಯೋಜನೆ", "ಯೋಜನೆಗಳು", "ಸಬ್ಸಿಡಿ", "ಸಾಲ", "ಸರ್ಕಾರಿ",
      ],
      intent: "scheme",
    },
    {
      keywords: [
        "crop", "plant", "seed", "harvest", "fertilizer", "pest", "disease",
        "irrigation", "water", "soil", "spray", "insect", "weed",
        "panta", "pantalu", "gobbara", "kita", "roga", "bale", "neeru",
        "పంట", "పంటలు", "విత్తనాలు", "ఎరువులు", "పురుగు", "వ్యాధి", "నీరు",
        "నీటిపారుదల", "మందు", "పంటల సలహా", "సాగు", "పొలం",
        "फसल", "बीज", "उर्वरक", "कीट", "रोग", "सिंचाई", "पानी", "खेती",
        "ಬೆಳೆ", "ಬೀಜ", "ಗೊಬ್ಬರ", "ಕೀಟ", "ರೋಗ", "ನೀರು", "ನೀರಾವರಣ",
      ],
      intent: "crop_advice",
    },
    {
      keywords: [
        "hello", "hi", "hey", "namaste", "namaskaram", "namaskara",
        "welcome", "start", "begin",
        "నమస్కారం", "హలో", "హాయి", "శుభోదయం",
        "नमस्ते", "हैलो", "हाय", "शुभ प्रभात",
        "ನಮಸ್ಕಾರ", "ಹಲೋ", "ಹಾಯ್",
      ],
      intent: "greeting",
    },
    {
      keywords: ["voice", "audio", "speak", "call", "phone"],
      intent: "voice_request",
    },
  ];

  for (const item of intents) {
    if (item.keywords.some((k) => lower.includes(k.toLowerCase()))) return item.intent;
  }
  return "general";
}

// Location-aware market prices
function formatMarketPrices(lang: string, district?: string | null, state?: string | null): string {
  const locLabel = district ? `${district}${state ? `, ${state}` : ""}` : (state ?? "All India");

  // State-specific crops
  const stateCrops: Record<string, Array<{ name: { en: string; te: string; hi: string; kn: string }; price: number; trend: string }>> = {
    "andhra pradesh": [
      { name: { en: "Rice (Sona Masoori)", te: "బియ్యం (సోనా మసూరి)", hi: "चावल (सोना मसूरी)", kn: "ಅಕ್ಕಿ (ಸೋನಾ ಮಸೂರಿ)" }, price: 2150, trend: "up" },
      { name: { en: "Chilli (Guntur Sannam)", te: "మిర్చి (గుంటూరు సన్నం)", hi: "मिर्च (गुंटूर सनम)", kn: "ಮೆಣಸು (ಗುಂಟೂರು ಸನ್ನಂ)" }, price: 12000, trend: "stable" },
      { name: { en: "Turmeric", te: "పసుపు", hi: "हल्दी", kn: "ಅರಿಶಿನ" }, price: 8500, trend: "up" },
      { name: { en: "Cotton", te: "పత్తి", hi: "कपास", kn: "ಹತ್ತಿ" }, price: 7200, trend: "up" },
    ],
    "telangana": [
      { name: { en: "Rice", te: "బియ్యం", hi: "चावल", kn: "ಅಕ್ಕಿ" }, price: 2180, trend: "up" },
      { name: { en: "Turmeric (Nizamabad)", te: "పసుపు (నిజామాబాద్)", hi: "हल्दी (निजामाबाद)", kn: "ಅರಿಶಿನ (ನಿಜಾಮಾಬಾದ್)" }, price: 8600, trend: "up" },
      { name: { en: "Soybean", te: "సోయాబీన్", hi: "सोयाबीन", kn: "ಸೋಯಾಬೀನ್" }, price: 4200, trend: "stable" },
      { name: { en: "Maize", te: "మొక్కజొన్న", hi: "मक्का", kn: "ಮೆಕ್ಕೆಜೋಳ" }, price: 2100, trend: "stable" },
    ],
    "karnataka": [
      { name: { en: "Rice", te: "బియ్యం", hi: "चावल", kn: "ಅಕ್ಕಿ" }, price: 2280, trend: "stable" },
      { name: { en: "Coffee (Arabica)", te: "కాఫీ (అరబికా)", hi: "कॉफी (अरबिका)", kn: "ಕಾಫಿ (ಅರಬಿಕಾ)" }, price: 35000, trend: "up" },
      { name: { en: "Tomato (Kolar)", te: "టమాటో (కోలార్)", hi: "टमाटर (कोलार)", kn: "ಟೊಮೆಟೋ (ಕೋಲಾರ್)" }, price: 2400, trend: "up" },
      { name: { en: "Groundnut", te: "వేరుశనగ", hi: "मूंगफली", kn: "ಕಡಲೆಕಾಯಿ" }, price: 5900, trend: "up" },
    ],
    "maharashtra": [
      { name: { en: "Wheat", te: "గోధుమలు", hi: "गेहूं", kn: "ಗೋಧಿ" }, price: 2450, trend: "up" },
      { name: { en: "Soybean", te: "సోయాబీన్", hi: "सोयाबीन", kn: "ಸೋಯಾಬೀನ್" }, price: 4200, trend: "up" },
      { name: { en: "Onion (Nashik)", te: "ఉల్లిపాయ (నాసిక్)", hi: "प्याज (नासिक)", kn: "ಈರುಳ್ಳಿ (ನಾಸಿಕ್)" }, price: 1800, trend: "down" },
      { name: { en: "Sugarcane", te: "చెరకు", hi: "गन्ना", kn: "ಕಬ್ಬು" }, price: 340, trend: "stable" },
    ],
    "madhya pradesh": [
      { name: { en: "Wheat (Sharbati)", te: "గోధుమ (షర్బతి)", hi: "गेहूं (शरबती)", kn: "ಗೋಧಿ (ಶರಬತಿ)" }, price: 2600, trend: "stable" },
      { name: { en: "Soybean", te: "సోయాబీన్", hi: "सोयाबीन", kn: "ಸೋಯಾಬೀನ್" }, price: 4300, trend: "up" },
      { name: { en: "Maize", te: "మొక్కజొన్న", hi: "मक्का", kn: "ಮೆಕ್ಕೆಜೋಳ" }, price: 2150, trend: "stable" },
    ],
    "gujarat": [
      { name: { en: "Cotton (Shankar-6)", te: "పత్తి (శంకర్-6)", hi: "कपास (शंकर-6)", kn: "ಹತ್ತಿ (ಶಂಕರ್-6)" }, price: 6800, trend: "down" },
      { name: { en: "Groundnut", te: "వేరుశనగ", hi: "मूंगफली", kn: "ಕಡಲೆಕಾಯಿ" }, price: 6000, trend: "stable" },
      { name: { en: "Wheat", te: "గోధుమలు", hi: "गेहूं", kn: "ಗೋಧಿ" }, price: 2480, trend: "stable" },
    ],
  };

  const normState = (state ?? "").toLowerCase().trim();
  const crops = stateCrops[normState] ?? stateCrops["andhra pradesh"];
  const langKey = lang === "telugu" ? "te" : lang === "hindi" ? "hi" : lang === "kannada" ? "kn" : "en";

  const trendEmoji = (t: string) => t === "up" ? "⬆️" : t === "down" ? "⬇️" : "➡️";

  const headers: Record<string, string> = {
    english: `💰 *Market Prices*\n📍 ${locLabel}\n\n`,
    hindi: `💰 *बाजार भाव*\n📍 ${locLabel}\n\n`,
    telugu: `💰 *మార్కెట్ ధరలు*\n📍 ${locLabel}\n\n`,
    kannada: `💰 *ಬಜಾರ ಬೆಲೆಗಳು*\n📍 ${locLabel}\n\n`,
  };

  const footers: Record<string, string> = {
    english: `\n✅ Prices trending upward. Good time to sell!`,
    hindi: `\n✅ भाव बढ़ रहे हैं। बेचने का अच्छा समय!`,
    telugu: `\n✅ ధరలు పెరుగుతున్నాయి. అమ్మడానికి మంచి సమయం!`,
    kannada: `\n✅ ಬೆಲೆ ಏರಿಕೆಯಾಗುತ್ತಿದೆ. ಮಾರಾಟಕ್ಕೆ ಒಳ್ಳೆಯ ಸಮಯ!`,
  };

  let body = "";
  for (const c of crops) {
    body += `• ${c.name[langKey]}\n  ₹${c.price.toLocaleString("en-IN")}/quintal ${trendEmoji(c.trend)}\n`;
  }

  return (headers[lang] ?? headers.english) + body + (footers[lang] ?? footers.english);
}

async function generateAIResponse(intent: string, lang: string, district?: string | null, state?: string | null): Promise<string> {
  // If weather intent and farmer has location, fetch real weather
  if (intent === "weather" && district && state) {
    return await getWeatherResponse(district, state, lang);
  }

  // If market_price intent, generate location-aware prices
  if (intent === "market_price") {
    return formatMarketPrices(lang, district, state);
  }

  const responses: Record<string, Record<string, string>> = {
    weather: {
      english: `🌦️ *Weather Forecast*\n\n` +
        `• Temperature: 32°C\n` +
        `• Humidity: 65%\n` +
        `• Rain Chance: 20%\n` +
        `• Wind: 12 km/h\n` +
        `• Condition: Partly cloudy\n\n` +
        `✅ Good weather for field work today!`,
      hindi: `🌦️ *मौसम की जानकारी*\n\n` +
        `• तापमान: 32°C\n` +
        `• नमी: 65%\n` +
        `• बारिश की संभावना: 20%\n` +
        `• हवा: 12 किमी/घंटा\n` +
        `• स्थिति: आंशिक रूप से बादल\n\n` +
        `✅ आज खेत के काम के लिए अच्छा मौसम है!`,
      telugu: `🌦️ *వాతావరణ సమాచారం*\n\n` +
        `• ఉష్ణోగ్రత: 32°C\n` +
        `• తేగోవత: 65%\n` +
        `• వర్షం అవకాశం: 20%\n` +
        `• గాలి: 12 కి.మీ/గం\n` +
        `• పరిస్థితి: పాక్షికంగా మేఘావృతం\n\n` +
        `✅ ఈరోజు పొలం పనికి మంచి వాతావరణం!`,
      kannada: `🌦️ *ಹವಾಮಾನದ ಮಾಹಿತಿ*\n\n` +
        `• ತಾಪಮಾನ: 32°C\n` +
        `• ಆರ್ದ್ರತೆ: 65%\n` +
        `• ಮಳೆ ಸಂಭವನೀಯತೆ: 20%\n` +
        `• ಗಾಳಿ: 12 ಕಿ.ಮೀ/ಗಂ\n` +
        `• ಸ್ಥಿತಿ: ಭಾಗಶಃ ಮೇಘಾವೃತ\n\n` +
        `✅ ಇವತ್ತು ಕೃಷಿ ಕೆಲಸಕ್ಕೆ ಒಳ್ಳೆಯ ಹವಾಮಾನ!`,
    },
    scheme: {
      english: `📋 *Government Schemes*\n\n` +
        `• PM-KISAN: ₹6,000/year income support\n` +
        `• Soil Health Card: Free soil testing\n` +
        `• Kisan Credit Card: 4% interest loans\n` +
        `• PMFBY: 50% subsidy crop insurance\n\n` +
        `Reply with scheme name for more details.`,
      hindi: `📋 *सरकारी योजनाएं*\n\n` +
        `• PM-KISAN: ₹6,000/साल आय सहायता\n` +
        `• सॉइल हेल्थ कार्ड: मुफ्त मिट्टी जांच\n` +
        `• किसान क्रेडिट कार्ड: 4% ब्याज ऋण\n` +
        `• PMFBY: 50% सब्सिडी फसल बीमा\n\n` +
        `योजना का नाम भेजें और जानकारी पाएं।`,
      telugu: `📋 *ప్రభుత్వ పథకాలు*\n\n` +
        `• PM-KISAN: ₹6,000/సంవత్సరం ఆదాయ మద్దతు\n` +
        `• సాయిల్ హెల్త్ కార్డ్: ఉచిత మట్టి పరీక్ష\n` +
        `• కిసాన్ క్రెడిట్ కార్డ్: 4% వడ్డీ రుణం\n` +
        `• PMFBY: 50% సబ్సిడీ పంట బీమా\n\n` +
        `పథకం పేరు రిప్లై ఇస్తే ఎక్కువ వివరాలు తెలుసుకోవచ్చు.`,
      kannada: `📋 *ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು*\n\n` +
        `• PM-KISAN: ₹6,000/ವರ್ಷ ಆಯ ಸಮರ್ಥನೆ\n` +
        `• ಸಾಯಿಲ್ ಹೆಲ್ತ್ ಕಾರ್ಡ್: ಉಚಿತ ಮಣ್ಣಿನ ಪರೀಕ್ಷೆ\n` +
        `• ಕಿಸಾನ್ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್: 4% ಬಡ್ಡದ ಸಾಲ\n` +
        `• PMFBY: 50% ಸಬ್ಸಿಡಿ ಬೆಳೆ ವಿಮೆ\n\n` +
        `ಯೋಜನೆಯ ಹೆಸರು ರಿಪ್ಲೈ ಕೊಟ್ಟರೆ ಹೆಚ್ಚು ಮಾಹಿತಿ ದೊರೆಯುತ್ತದೆ.`,
    },
    crop_advice: {
      english: `💡 *Farming Advice*\n\n` +
        `• Fertilizer: Apply NPK 20-20-20 at 50kg/acre\n` +
        `• Pest Control: Monitor for stem borer\n` +
        `• Use neem-based spray if needed\n` +
        `• Irrigation: Water every 7-10 days\n\n` +
        `Would you like advice on a specific crop stage?`,
      hindi: `💡 *खेती सलाह*\n\n` +
        `• उर्वरक: NPK 20-20-20, 50kg/एकड़\n` +
        `• कीट नियंत्रण: स्टेम बोरर की जांच\n` +
        `• जरूरत हो तो नीम स्प्रे का उपयोग करें\n` +
        `• सिंचाई: 7-10 दिन में पानी दें\n\n` +
        `किसी विशेष अवस्था की जानकारी चाहिए?`,
      telugu: `💡 *వ్యవసాయ సలహా*\n\n` +
        `• ఎరువు: NPK 20-20-20, 50kg/ఎకరం\n` +
        `• పురుగు నియంత్రణ: స్టెమ్ బోరర్ కు సిక్షణ\n` +
        `• అవసరమైతే వేప ఆధారిత స్ప్రే వాడండి\n` +
        `• నీటి పారుదల: 7-10 రోజులకు నీరు\n\n` +
        `కొన్ని విశిష్ట దశ గురించి సలహా కావాలా?`,
      kannada: `💡 *ಕೃಷಿ ಸಲಹೆ*\n\n` +
        `• ಗೊಬ್ಬರ: NPK 20-20-20, 50kg/ಎಕರೆ\n` +
        `• ಕೀಟ ನಿಯಂತ್ರಣ: ಸ್ಟೆಮ್ ಬೋರರ್ ಗಮನಿಸಿ\n` +
        `• ಅಗತ್ಯವಿದ್ದರೆ ಬೇವು ಆಧಾರಿತ ಸ್ಪ್ರೇ ಬಳಸಿ\n` +
        `• ನೀರಾವರಣ: 7-10 ದಿನಕ್ಕೊಮ್ಮೆ ನೀರು\n\n` +
        `ವಿಶಿಷ್ಟ ಬೆಳೆಯ stages ಗೆ ಸಲಹೆ ಬೇಕಾ?`,
    },
    greeting: {
      english: `👋 *Welcome to AI Farmer Assistant!*\n\n` +
        `I can help you with:\n` +
        `• 🌦️ Weather updates\n` +
        `• 💰 Market prices\n` +
        `• 📋 Government schemes\n` +
        `• 💡 Farming advice\n\n` +
        `What would you like to know?`,
      hindi: `🙏 *AI किसान सहायक में स्वागत है!*\n\n` +
        `मैं आपकी मदद कर सकता हूं:\n` +
        `• 🌦️ मौसम की जानकारी\n` +
        `• 💰 बाजार भाव\n` +
        `• 📋 सरकारी योजनाएं\n` +
        `• 💡 खेती सलाह\n\n` +
        `आप क्या जानना चाहते हैं?`,
      telugu: `🙏 *AI రైతు సహాయకుడుకు స్వాగతం!*\n\n` +
        `నేను మీకు సహాయం చేయగల విషయాలు:\n` +
        `• 🌦️ వాతావరణ సమాచారం\n` +
        `• 💰 మార్కెట్ ధరలు\n` +
        `• 📋 ప్రభుత్వ పథకాలు\n` +
        `• 💡 వ్యవసాయ సలహా\n\n` +
        `మీకు ఏమి తెలుసుకోవాలని ఉంది?`,
      kannada: `🙏 *AI ಕೃಷಿ ಸಹಾಯಕಕ್ಕೆ ಸ್ವಾಗತ!*\n\n` +
        `ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದಾದ ವಿಷಯಗಳು:\n` +
        `• 🌦️ ಹವಾಮಾನ ಮಾಹಿತಿ\n` +
        `• 💰 ಬಜಾರ ಬೆಲೆ\n` +
        `• 📋 ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು\n` +
        `• 💡 ಕೃಷಿ ಸಲಹೆ\n\n` +
        `ನೀವು ಯಾವ ಮಾಹಿತಿ ಬೇಕು?`,
    },
    general: {
      english: `🤖 *AI Farmer Assistant*\n\n` +
        `I can help you with:\n` +
        `• 🌦️ Weather updates\n` +
        `• 💰 Market prices\n` +
        `• 📋 Government schemes\n` +
        `• 💡 Farming advice\n\n` +
        `Please send your question!`,
      hindi: `🤖 *AI किसान सहायक*\n\n` +
        `मैं आपकी मदद कर सकता हूं:\n` +
        `• 🌦️ मौसम की जानकारी\n` +
        `• 💰 बाजार भाव\n` +
        `• 📋 सरकारी योजनाएं\n` +
        `• 💡 खेती सलाह\n\n` +
        `कृपया अपना सवाल भेजें!`,
      telugu: `🤖 *AI రైతు సహాయకుడు*\n\n` +
        `నేను మీకు సహాయం చేయగల విషయాలు:\n` +
        `• 🌦️ వాతావరణ సమాచారం\n` +
        `• 💰 మార్కెట్ ధరలు\n` +
        `• 📋 ప్రభుత్వ పథకాలు\n` +
        `• 💡 వ్యవసాయ సలహా\n\n` +
        `దయచేసి మీ ప్రశ్నను పంపండి!`,
      kannada: `🤖 *AI ಕೃಷಿ ಸಹಾಯಕ*\n\n` +
        `ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದಾದ ವಿಷಯಗಳು:\n` +
        `• 🌦️ ಹವಾಮಾನ ಮಾಹಿತಿ\n` +
        `• 💰 ಬಜಾರ ಬೆಲೆ\n` +
        `• 📋 ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು\n` +
        `• 💡 ಕೃಷಿ ಸಲಭೆ\n\n` +
        `ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಕಳುಹಿಸಿ!`,
    },
  };

  const langMap: Record<string, string> = { telugu: "telugu", hindi: "hindi", kannada: "kannada", english: "english" };
  const responsesForIntent = responses[intent] ?? responses.general;
  return responsesForIntent[langMap[lang] ?? "english"] ?? responsesForIntent.english;
}

// ============ tRPC ROUTER ============
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
