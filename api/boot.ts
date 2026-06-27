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

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber: string, message: string, contentType: string) {
  const db = getDb();

  // 1. Find or create farmer
  let farmer = await db.select().from(farmers).where(eq(farmers.phoneNumber, phoneNumber)).limit(1);

  let farmerId: number;
  if (!farmer[0]) {
    const result = await db.insert(farmers).values({
      phoneNumber,
      preferredLanguage: "english",
      isActive: true,
    });
    farmerId = Number(result[0].insertId);
    console.log(`[WhatsApp] New farmer registered: ${phoneNumber}`);
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
        to: toPhoneNumber,
        type: "text",
        text: { body: message },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[WhatsApp] Failed to send message:", JSON.stringify(result));
      return;
    }

    console.log(`[WhatsApp] Message sent to ${toPhoneNumber}: ${message.substring(0, 50)}...`);
  } catch (err: any) {
    console.error("[WhatsApp] Error sending message:", err.message);
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
  const lower = message.toLowerCase();
  const intents = [
    { keywords: ["weather", "rain", "temperature", "barish", "mausam", "vaana", "haṅgāmu", "maḷe"], intent: "weather" },
    { keywords: ["price", "rate", "mandi", "bazar", "dhara", "dar", "bele", "belli", "dharaṇi"], intent: "market_price" },
    { keywords: ["scheme", "subsidy", "loan", "yojana", "pension", "yojane", "salle", "vṛtti"], intent: "scheme" },
    { keywords: ["fertilizer", "pest", "disease", "crop", "panta", "gobbara", "kīṭa", "roga", "balé"], intent: "crop_advice" },
    { keywords: ["hello", "hi", "namaste", "namaskaram", "namaskāra"], intent: "greeting" },
    { keywords: ["voice", "audio", "speak"], intent: "voice_request" },
  ];
  for (const item of intents) {
    if (item.keywords.some((k) => lower.includes(k))) return item.intent;
  }
  return "general";
}

async function generateAIResponse(intent: string, lang: string, district?: string | null, state?: string | null): Promise<string> {
  // If weather intent and farmer has location, fetch real weather
  if (intent === "weather" && district && state) {
    return await getWeatherResponse(district, state, lang);
  }

  const responses: Record<string, Record<string, string>> = {
    weather: {
      english: "Here's the weather forecast for your area:\n\nToday: 32°C, Humidity 65%, Rain probability 20%\nTomorrow: 30°C, Rain probability 45%\n\nLight rain expected tomorrow afternoon. Good conditions for field work today.",
      hindi: "आपके क्षेत्र का मौसम:\n\nआज: 32°C, नमी 65%, बारिश की संभावना 20%\nकल: 30°C, बारिश की संभावना 45%\n\nकल दोपहर में हल्की बारिश की आशंका है।",
      telugu: "మీ ప్రాంతం వాతావరణ సమాచారం:\n\nఈరోజు: 32°C, తేగోవత 65%, వర్షం అవకాశం 20%\nరేపు: 30°C, వర్షం అవకాశం 45%\n\nరేపు మధ్యాహ్నం జల్ల వాన సంభవం ఉంది.",
      kannada: "ನಿಮ್ಮ ಪ್ರದೇಶದ ಹವಾಮಾನ:\n\nಇವತ್ತು: 32°C, ಆರ್ದ್ರತೆ 65%, ಮಳೆ ಸಂಭವನೀಯತೆ 20%\nನಾಳೆ: 30°C, ಮಳೆ ಸಂಭವನೀಯತೆ 45%\n\nನಾಳೆ ಮಧ್ಯಾಹ್ನ ಸೌಮ್ಯ ಮಳೆ ಸಾಧ್ಯತೆ ಇದೆ.",
    },
    market_price: {
      english: "Current market prices:\n\nRice: INR 2,150/quintal\nWheat: INR 2,450/quintal\nCotton: INR 6,800/quintal\n\nPrices are trending upward this week. Good time to sell.",
      hindi: "वर्तमान बाजार भाव:\n\nचावल: INR 2,150/क्विंटल\nगेहूं: INR 2,450/क्विंटल\nकपास: INR 6,800/क्विंटल\n\nइस हफ्ते भाव बढ़ते हुए हैं। बेचने का अच्छा समय है।",
      telugu: "ప్రస్తుత మార్కెట్ ధరలు:\n\nబియ్యం: INR 2,150/క్వింటాల్\nగోధుమలు: INR 2,450/క్వింటాల్\nపత్తి: INR 6,800/క్వింటాల్\n\nఈ వారం ధరలు పెంచు వద్దున్నాయి.",
      kannada: "ವर्तಮಾನ ಬಜಾರ ಬೆಲೆ:\n\nಅಕ್ಕಿ: INR 2,150/ಕ್ವಿಂಟಾಲ್\nಗೋಧಿ: INR 2,450/ಕ್ವಿಂಟಾಲ್\nಹತ್ತಿ: INR 6,800/ಕ್ವಿಂಟಾಲ್\n\nಈ ವಾರ ಬೆಲೆ ಏರಿಕೆಯಾಗುತ್ತಿದೆ. ಮಾರಾಟಕ್ಕೆ ಒಳ್ಳೆಯ ಸಮಯ.",
    },
    scheme: {
      english: "Available government schemes:\n\n1. PM-KISAN: Rs 6,000/year income support\n2. Soil Health Card: Free soil testing\n3. Kisan Credit Card: Low-interest loans at 4%\n4. PMFBY: Crop insurance with 50% subsidy\n\nReply with scheme name for more details.",
      hindi: "सरकारी योजनाएं:\n\n1. PM-KISAN: Rs 6,000/साल आय सहायता\n2. सॉइल हेल्थ कार्ड: मुफ्त मिट्टी जांच\n3. किसान क्रेडिट कार्ड: 4% पर कम ब्याज ऋण\n4. PMFBY: 50% सब्सिडी के साथ फसल बीमा\n\nऔर जानकारी के लिए योजना का नाम भेजें।",
      telugu: "ప్రభుత్వ పథకాలు:\n\n1. PM-KISAN: Rs 6,000/సంవత్సరం ఆదాయ మద్దతు\n2. సాయిల్ హెల్త్ కార్డ్: ఉచిత మట్టి పరీక్ష\n3. కిసాన్ క్రెడిట్ కార్డ్: 4% తక్కువ వడ్డీ రుణం\n4. PMFBY: 50% సబ్సిడీతో పంట బీమా\n\nఎక్కువ వివరాలకు పథకం పేరు రిప్లై ఇవ్వండి.",
      kannada: "ಪ್ರಸ್ತುತ ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು:\n\n1. PM-KISAN: ವರ್ಷಕ್ಕೆ Rs 6,000 ಆಯ ಸಮರ್ಥನೆ\n2. ಸಾಯಿಲ್ ಹೆಲ್ತ್ ಕಾರ್ಡ್: ಉಚಿತ ಮಣ್ಣಿನ ಪರೀಕ್ಷೆ\n3. ಕಿಸಾನ್ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್: 4% ಕಡಿಮೆ ಬಡ್ಡದ ಸಾಲ\n4. PMFBY: 50% ಸಬ್ಸಿಡಿಯೊಂದಿಗೆ ಬೆಳೆ ವಿಮೆ\n\nಹೆಚ್ಚು ಮಾಹಿತಿಗೆ ಯೋಜನೆಯ ಹೆಸರು ರಿಪ್ಲೈ ಕೊಡಿ.",
    },
    crop_advice: {
      english: "For your crop, here are the recommendations:\n\nFertilizer: Apply NPK 20-20-20 at 50kg/acre\nPest Control: Monitor for stem borer. Use neem-based spray if needed.\nIrrigation: Water every 7-10 days depending on soil moisture.\n\nWould you like advice on a specific crop stage?",
      hindi: "आपकी फसल के लिए सलाह:\n\nउर्वरक: NPK 20-20-20, 50kg/एकड़ लगाएं\nकीट नियंत्रण: स्टेम बोरर की निगरानी रखें। जरूरत हो तो नीम स्प्रे का उपयोग करें।\nसिंचाई: 7-10 दिन में पानी दें।\n\nकिसी विशेष अवस्था की जानकारी चाहिए?",
      telugu: "మీ పంటకు సిఫార్సులు:\n\nఎరువు: NPK 20-20-20, 50kg/ఎకరం వాడండి\nపురుగు నియంత్రణ: స్టెమ్ బోరర్ కు సిక్షణ చేయండి.\nనీటి పారుదల: 7-10 రోజులకు నీరు ఇవ్వండి.\n\nకొన్ని విశిష్ట దశ గురించి సలహా కావాలా?",
      kannada: "ನಿಮ್ಮ ಬೆಳೆಗೆ ಸಲಹೆ:\n\nಗೊಬ್ಬರ: NPK 20-20-20, 50kg/ಎಕರೆ ಹಾಕಿ\nಕೀಟ ನಿಯಂತ್ರಣ: ಸ್ಟೆಮ್ ಬೋರರ್ ಗಮನಿಸಿ. ಬೇವು ಆಧಾರಿತ ಸ್ಪ್ರೇ ಬಳಸಿ.\nನೀರಾವರಣ: 7-10 ದಿನಕ್ಕೊಮ್ಮೆ ನೀರು ಹಾಕಿ.\n\nವಿಶಿಷ್ಟ ಬೆಳೆಯ stages ಗೆ ಸಲಹೆ ಬೇಕಾ?",
    },
    greeting: {
      english: "Hello! Welcome to AI Farmer Assistant.\n\nI can help you with:\n- Weather updates\n- Market prices\n- Government schemes\n- Farming advice\n\nWhat would you like to know?",
      hindi: "नमस्ते! AI Farmer Assistant में आपका स्वागत है।\n\nमैं आपकी मदद कर सकता हूं:\n- मौसम की जानकारी\n- बाजार भाव\n- सरकारी योजनाएं\n- खेती सलाह\n\nआप क्या जानना चाहते हैं?",
      telugu: "నమస్కారం! AI Farmer Assistant కు స్వాగతం.\n\nనేను మీకు సహాయం చేయగల విషయాలు:\n- వాతావరణ సమాచారం\n- మార్కెట్ ధరలు\n- ప్రభుత్వ పథకాలు\n- వ్యవసాయ సలహా\n\nమీకు ఏమి తెలుసుకోవాలని ఉంది?",
      kannada: "ನಮಸ್ಕಾರ! AI Farmer Assistant ಗೆ ಸ್ವಾಗತ.\n\nನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದಾದ ವಿಷಯಗಳು:\n- ಹವಾಮಾನ ಮಾಹಿತಿ\n- ಬಜಾರ ಬೆಲೆ\n- ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು\n- ಕೃಷಿ ಸಲಹೆ\n\nನೀವು ಯಾವ ಮಾಹಿತಿ ಬೇಕು?",
    },
    general: {
      english: "I understand. I'm here to help farmers with weather, market prices, government schemes, and farming advice.\n\nWhat specific information do you need?",
      hindi: "मैं समझ गया। मैं किसानों की मदद के लिए यहां हूं।\n\nमौसम, बाजार भाव, सरकारी योजनाएं, और खेती सलाह।\n\nआपको किस विशेष जानकारी की जरूरत है?",
      telugu: "అర్థమైంది. నేను రైతులకు సహాయం చేయడానికి ఉన్నాను.\n\nవాతావరణం, మార్కెట్ ధరలు, ప్రభుత్వ పథకాలు, వ్యవసాయ సలహా.\n\nమీకు ఏమి విశిష్ట సమాచారం కావాలి?",
      kannada: "ಅರ್ಥವಾಯಿತು. ನಾನು ರೈತರಿಗೆ ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇನೆ.\n\nಹವಾಮಾನ, ಬಜಾರ ಬೆಲೆ, ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು, ಕೃಷಿ ಸಲಹೆ.\n\nನಿಮಗೆ ಯಾವ ವಿಶೇಷ ಮಾಹಿತಿ ಬೇಕು?",
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
