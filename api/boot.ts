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
import { farmers, messages, conversations, pincodes, marketPrices, governmentSchemes, cropKnowledge } from "@db/schema";
import { eq, desc, sql, and } from "drizzle-orm";

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
          const type = msg.type ?? "text";   // Message type

          let text = "";
          let interactiveId = "";

          if (type === "interactive") {
            // Handle button replies and list selections
            const interactive = msg.interactive;
            if (interactive?.type === "button_reply") {
              interactiveId = interactive.button_reply?.id ?? "";
              text = interactive.button_reply?.title ?? "";
            } else if (interactive?.type === "list_reply") {
              interactiveId = interactive.list_reply?.id ?? "";
              text = interactive.list_reply?.title ?? "";
            }
            console.log(`[WhatsApp] Interactive reply from ${from}: id=${interactiveId}, title=${text}`);
          } else {
            // Regular text message
            text = msg.text?.body ?? "";
          }

          if (text || interactiveId) {
            await processIncomingMessage(from, text, type, interactiveId);
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
// Auto-add India country code (91) if 10 digits
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "").trim();
  // If 10 digits, assume Indian number and add 91
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }
  return cleaned;
}

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber: string, message: string, contentType: string, interactiveId: string = "") {
  const db = getDb();

  // Normalize phone number before lookup
  const normalizedPhone = normalizePhone(phoneNumber);

  // 1. Find or create farmer (using normalized phone)
  let farmer = await db.select().from(farmers).where(eq(farmers.phoneNumber, normalizedPhone)).limit(1);

  let farmerId: number;
  let isNewFarmer = false;
  if (!farmer[0]) {
    const result = await db.insert(farmers).values({
      phoneNumber: normalizedPhone,
      preferredLanguage: "english",
      isActive: true,
    });
    farmerId = Number(result[0].insertId);
    isNewFarmer = true;
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

  // 3. Detect intent (from text or interactive ID)
  let intent: string;
  let isMenuAction = false;

  if (interactiveId) {
    // Handle interactive button/list replies
    const lang = farmer[0]?.preferredLanguage ?? "english";
    const result = handleInteractiveReply(interactiveId, lang);
    intent = result.intent;
    isMenuAction = result.isMenuAction;

    // Handle language change
    if (intent.startsWith("set_language_")) {
      const newLang = intent.replace("set_language_", "");
      await db.update(farmers).set({ preferredLanguage: newLang }).where(eq(farmers.id, farmerId));

      // Confirm in new language
      const confirmText = newLang === "telugu" ? "భాష తెలుగుకు మార్చబడింది."
        : newLang === "hindi" ? "भाषा हिंदी में बदल दी गई है।"
        : "Language changed to English.";
      await sendWhatsAppMessage(phoneNumber, confirmText);

      // Send main menu in new language
      await sendMainMenu(phoneNumber, newLang);
      return;
    }
  } else {
    intent = detectIntent(message);
  }

  // 4. Generate AI response
  const lang = farmer[0]?.preferredLanguage ?? "english";
  const farmerDistrict = farmer[0]?.district;
  const farmerState = farmer[0]?.state;
  const farmerPincode = farmer[0]?.pincode;
  const aiResponse = await generateAIResponse(intent, lang, farmerDistrict, farmerState, farmerPincode, farmer[0]?.primaryCrop);

  // 5. Save farmer message
  await db.insert(messages).values({
    conversationId, farmerId, senderType: "farmer",
    contentType: contentType as "text" | "voice" | "image" | "template",
    content: message || interactiveId, language: lang, intentDetected: intent,
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

  console.log(`[WhatsApp] Processed message from ${phoneNumber}: intent=${intent}, interactive=${interactiveId}`);

  // 9. Send response
  if (isMenuAction && intent === "language_change") {
    // Send language selection buttons
    await sendLanguageMenu(phoneNumber);
  } else if (isMenuAction) {
    // For menu items: send response then re-send menu
    await sendWhatsAppMessage(phoneNumber, aiResponse);
    await sendMainMenu(phoneNumber, lang);
  } else if (isNewFarmer) {
    // New farmer: send welcome + main menu
    await sendWhatsAppMessage(phoneNumber, aiResponse);
    await sendMainMenu(phoneNumber, lang);
  } else {
    // Regular text message
    await sendWhatsAppMessage(phoneNumber, aiResponse);
  }
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

// ====== WHATSAPP INTERACTIVE MESSAGES (Buttons & Lists) ======

// Send a List Message — opens a scrollable list of options
type ListRow = { id: string; title: string; description: string };
type ListSection = { title: string; rows: ListRow[] };

async function sendWhatsAppList(toPhoneNumber: string, header: string, body: string, footer: string, buttonText: string, sections: ListSection[]) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  const normalizedTo = normalizePhone(toPhoneNumber);
  if (normalizedTo.length < 10) return;

  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: header },
          body: { text: body },
          footer: { text: footer },
          action: { button: buttonText, sections },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error(`[WhatsApp] List send failed:`, JSON.stringify(result));
      return false;
    }
    console.log(`[WhatsApp] List message sent to ${normalizedTo}: ${header}`);
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp] List error:`, err.message);
    return false;
  }
}

// Send Reply Buttons — up to 3 inline buttons
async function sendWhatsAppButtons(toPhoneNumber: string, body: string, buttons: { id: string; title: string }[]) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  const normalizedTo = normalizePhone(toPhoneNumber);
  if (normalizedTo.length < 10) return;

  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error(`[WhatsApp] Buttons send failed:`, JSON.stringify(result));
      return false;
    }
    console.log(`[WhatsApp] Buttons sent to ${normalizedTo}: ${buttons.map((b) => b.title).join(", ")}`);
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp] Buttons error:`, err.message);
    return false;
  }
}

// Language-specific main menu
const MAIN_MENU: Record<string, { header: string; body: string; footer: string; button: string; sections: ListSection[] }> = {
  english: {
    header: "Kisan Saathi",
    body: "Your AI farming assistant. Select a service:",
    footer: "Tap the button below to see options",
    button: "Services",
    sections: [{
      title: "Available Services",
      rows: [
        { id: "weather", title: "Weather", description: "Get weather updates for your area" },
        { id: "prices", title: "Market Prices", description: "Check current crop prices" },
        { id: "schemes", title: "Govt Schemes", description: "Find eligible government schemes" },
        { id: "crops", title: "Crop Knowledge", description: "Get farming advice for your crops" },
        { id: "language", title: "Change Language", description: "Switch to Telugu, Hindi or English" },
      ],
    }],
  },
  telugu: {
    header: "కిసాన్ సాథి",
    body: "మీ ఎఐ వ్యవసాయ సహాయకుడు. ఒక సేవను ఎంచుకోండి:",
    footer: "ఎంపికలను చూడటానికి కింది బటన్ నొక్కండి",
    button: "సేవలు",
    sections: [{
      title: "అందుబాటులో ఉన్న సేవలు",
      rows: [
        { id: "weather", title: "వాతావరణం", description: "మీ ప్రాంతం కోసం వాతావరణ నవీకరణలు" },
        { id: "prices", title: "మార్కెట్ ధరలు", description: "పంటల వర్తమాన ధరలు తనిఖీ చేయండి" },
        { id: "schemes", title: "ప్రభుత్వ పథకాలు", description: "అర్హత గల ప్రభుత్వ పథకాలు కనుగొనండి" },
        { id: "crops", title: "పంట జ్ఞానం", description: "మీ పంటల కోసం వ్యవసాయ సలహా పొందండి" },
        { id: "language", title: "భాష మార్చు", description: "తెలుగు, హిందీ లేదా ఆంగ్లంలోకి మార్చండి" },
      ],
    }],
  },
  hindi: {
    header: "किसान साथी",
    body: "आपका AI कृषि सहायक। एक सेवा चुनें:",
    footer: "विकल्प देखने के लिए नीचे बटन दबाएं",
    button: "सेवाएं",
    sections: [{
      title: "उपलब्ध सेवाएं",
      rows: [
        { id: "weather", title: "मौसम", description: "अपने क्षेत्र के लिए मौसम अपडेट" },
        { id: "prices", title: "बाजार भाव", description: "फसलों के वर्तमान भाव जांचें" },
        { id: "schemes", title: "सरकारी योजनाएं", description: "पात्र सरकारी योजनाएं खोजें" },
        { id: "crops", title: "फसल ज्ञान", description: "अपनी फसलों के लिए कृषि सलाह" },
        { id: "language", title: "भाषा बदलें", description: "तेलुगु, हिंदी या अंग्रेजी में बदलें" },
      ],
    }],
  },
};

// Language selection buttons
const LANGUAGE_BUTTONS = [
  { id: "lang_english", title: "English" },
  { id: "lang_telugu", title: "Telugu" },
  { id: "lang_hindi", title: "Hindi" },
];

// Send main menu as interactive list
async function sendMainMenu(phoneNumber: string, lang: string) {
  const menu = MAIN_MENU[lang as keyof typeof MAIN_MENU] ?? MAIN_MENU.english;
  const success = await sendWhatsAppList(phoneNumber, menu.header, menu.body, menu.footer, menu.button, menu.sections);
  if (!success) {
    // Fallback to text message if interactive fails
    const fallbackText = lang === "telugu"
      ? "దయచేసి ఒక ఎంపికను టైప్ చేయండి:\n• వాతావరణం\n• మార్కెట్ ధరలు\n• ప్రభుత్వ పథకాలు\n• పంట జ్ఞానం"
      : lang === "hindi"
      ? "कृपया एक विकल्प टाइप करें:\n• मौसम\n• बाजार भाव\n• सरकारी योजनाएं\n• फसल ज्ञान"
      : "Please type an option:\n• Weather\n• Market Prices\n• Govt Schemes\n• Crop Knowledge";
    await sendWhatsAppMessage(phoneNumber, fallbackText);
  }
}

// Send language selection buttons
async function sendLanguageMenu(phoneNumber: string) {
  const body = "Please choose your preferred language / कृपया अपनी भाषा चुनें / దయచేసి మీ భాషను ఎంచుకోండి:";
  const success = await sendWhatsAppButtons(phoneNumber, body, LANGUAGE_BUTTONS);
  if (!success) {
    await sendWhatsAppMessage(phoneNumber, "Please type your language: English, Telugu, or Hindi");
  }
}

// Handle interactive list/button replies
function handleInteractiveReply(replyId: string, lang: string): { intent: string; isMenuAction: boolean } {
  // Map reply IDs to intents
  const intentMap: Record<string, string> = {
    weather: "weather",
    prices: "market_prices",
    schemes: "government_schemes",
    crops: "crop_knowledge",
    language: "language_change",
    lang_english: "set_language_english",
    lang_telugu: "set_language_telugu",
    lang_hindi: "set_language_hindi",
  };

  const intent = intentMap[replyId] ?? "general";
  const isMenuAction = ["weather", "prices", "schemes", "crops", "language"].includes(replyId);

  return { intent, isMenuAction };
}

// Geocode a pincode using Open-Meteo
async function geocodePincode(pincode: string): Promise<{ lat: number; lon: number; name: string; district?: string; state?: string } | null> {
  const cleanPin = pincode.trim();

  // 1. Try India Post API (best for Indian pincodes)
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(cleanPin)}`);
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      const district = po.District;
      const state = po.State;
      console.log(`[Pincode] India Post API: ${cleanPin} → ${po.Name}, ${district}, ${state}`);
      if (district && state) {
        // Geocode the district to get lat/lon
        const geo = await geocodeLocation(district, state);
        if (geo) {
          return { lat: geo.lat, lon: geo.lon, name: po.Name || district, district, state };
        }
      }
    }
  } catch (e) {
    console.error(`[Pincode] India Post API error for "${cleanPin}":`, e);
  }

  // 2. Fallback: Open-Meteo direct pincode search
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanPin)}&count=5&language=en&format=json`);
    const data = await res.json();
    console.log(`[Pincode] Open-Meteo geocode "${cleanPin}":`, JSON.stringify(data.results?.map((r: any) => ({ name: r.name, admin1: r.admin1, country: r.country })) ?? "no results"));

    if (data.results && data.results.length > 0) {
      const indiaResult = data.results.find((r: any) => r.country === "India");
      const best = indiaResult ?? data.results[0];
      return {
        lat: best.latitude,
        lon: best.longitude,
        name: best.name,
        district: best.admin1,
        state: best.admin1,
      };
    }
  } catch (e) {
    console.error(`[Pincode] Open-Meteo geocoding error for "${cleanPin}":`, e);
  }

  console.log(`[Pincode] Could not geocode pincode "${cleanPin}"`);
  return null;
}

// Cached pincode lookup from DB
async function lookupCachedPincode(pincode: string): Promise<{ lat: number; lon: number; district?: string; state?: string } | null> {
  try {
    const db = getDb();
    const cached = await db.select().from(pincodes).where(eq(pincodes.pincode, pincode.trim())).limit(1);
    if (cached.length > 0) {
      console.log(`[Pincode] Cache hit for "${pincode}": ${cached[0].location}`);
      return { lat: cached[0].latitude, lon: cached[0].longitude, district: cached[0].district ?? undefined, state: cached[0].state ?? undefined };
    }
  } catch { /* table may not exist yet */ }
  return null;
}

// Save pincode to cache
async function cachePincode(pincode: string, lat: number, lon: number, location?: string, district?: string, state?: string) {
  try {
    const db = getDb();
    await db.insert(pincodes).values({
      pincode: pincode.trim(),
      latitude: lat,
      longitude: lon,
      location: location ?? null,
      district: district ?? null,
      state: state ?? null,
    });
    console.log(`[Pincode] Cached "${pincode}" → ${location}`);
  } catch (e: any) {
    // Duplicate key is fine - ignore
    if (!e.message?.includes("Duplicate")) {
      console.error("[Pincode] Cache error:", e.message);
    }
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
async function fetchWeather(district: string, state: string, pincode?: string | null): Promise<{ temp: number; humidity: number; rainProb: number; condition: string; forecast: string; location: string } | null> {
  try {
    // Try pincode-based geocoding first
    let geo: { lat: number; lon: number; name: string; district?: string; state?: string } | null = null;

    if (pincode) {
      // 1. Check cache first
      const cached = await lookupCachedPincode(pincode);
      if (cached) {
        geo = { lat: cached.lat, lon: cached.lon, name: cached.district ?? district, district: cached.district, state: cached.state ?? state };
      } else {
        // 2. Geocode pincode via API
        geo = await geocodePincode(pincode);
        if (geo) {
          await cachePincode(pincode, geo.lat, geo.lon, geo.name, geo.district, geo.state);
        }
      }
      console.log(`[Weather] Using pincode "${pincode}" → ${geo?.name ?? "fallback to district"}`);
    }

    // 3. Fallback to district/state if pincode geocoding failed
    if (!geo) {
      geo = await geocodeLocation(district, state);
    }
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
      location: geo?.name ?? district,
    };
  } catch (e: any) {
    console.error("[Weather] Fetch error:", e.message);
  }
  return null;
}

// Format weather response in farmer's language
async function getWeatherResponse(district: string, state: string, lang: string, pincode?: string | null): Promise<string> {
  console.log(`[Weather] Getting weather for ${district}, ${state}${pincode ? `, pincode:${pincode}` : ""} in ${lang}`);
  const weather = await fetchWeather(district, state, pincode);
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
    english: (w, loc) => `🌦️ *Weather for ${loc}*\n\n• Now: ${w.temp}°C, ${w.condition}\n• Humidity: ${w.humidity}%\n• Rain chance: ${w.rainProb}%\n• Today: ${w.forecast}\n\n${w.rainProb > 50 ? "☂️ Carry umbrella! Rain likely." : "✅ Good weather for farm work today!"}`,
    hindi: (w, loc) => `🌦️ *${loc} का मौसम*\n\n• अभी: ${w.temp}°C, ${w.condition}\n• नमी: ${w.humidity}%\n• बारिश की संभावना: ${w.rainProb}%\n• आज: ${w.forecast}\n\n${w.rainProb > 50 ? "☂️ छाता ले जाएं! बारिश की संभावना है।" : "✅ आज खेती के लिए अच्छा मौसम है!"}`,
    telugu: (w, loc) => `🌦️ *${loc} వాతావరణం*\n\n• ఇప్పుడు: ${w.temp}°C, ${w.condition}\n• తేగోవత: ${w.humidity}%\n• వర్షం అవకాశం: ${w.rainProb}%\n• ఈరోజు: ${w.forecast}\n\n${w.rainProb > 50 ? "☂️ గొడ్డ తీసుకొని వెళ్ళండి! వర్షం అవకాశం ఉంది." : "✅ ఈరోజు రైతు పనికి మంచి వాతావరణం!"}`,
    kannada: (w, loc) => `🌦️ *${loc} ಹವಾಮಾನ*\n\n• ಈಗ: ${w.temp}°C, ${w.condition}\n• ಆರ್ದ್ರತೆ: ${w.humidity}%\n• ಮಳೆ ಸಂಭವನೀಯತೆ: ${w.rainProb}%\n• ಇವತ್ತು: ${w.forecast}\n\n${w.rainProb > 50 ? "☂️ ಕುಡುರೆ ತೆಗೆದುಕೊಂಡು ಹೋಗಿ! ಮಳೆ ಸಾಧ್ಯತೆ ಇದೆ." : "✅ ಇವತ್ತು ಕೃಷಿ ಕೆಲಸಕ್ಕೆ ಒಳ್ಳೆಯ ಹವಾಮಾನ!"}`,
  };

  const template = templates[lang] ?? templates.english;
  return template(weather, weather.location);
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
// ====== DB-DRIVEN RESPONSE FUNCTIONS ======

// Fetch market prices from DB for farmer's state/district
async function formatMarketPrices(lang: string, district?: string | null, state?: string | null): Promise<string> {
  const db = getDb();
  const locLabel = district ? `${district}${state ? `, ${state}` : ""}` : (state ?? "All India");

  try {
    // Query latest prices from DB, filter by state if available
    const conditions = [eq(marketPrices.isActive, true)];
    if (state) conditions.push(sql`LOWER(${marketPrices.state}) = LOWER(${state})`);

    const prices = await db.select()
      .from(marketPrices)
      .where(and(...conditions))
      .orderBy(desc(marketPrices.priceDate))
      .limit(5);

    // If no results for the state, get all active prices
    let data = prices;
    if (data.length === 0) {
      data = await db.select()
        .from(marketPrices)
        .where(eq(marketPrices.isActive, true))
        .orderBy(desc(marketPrices.priceDate))
        .limit(5);
    }

    const trendEmoji = (t: string) => t === "up" ? "⬆️" : t === "down" ? "⬇️" : "➡️";

    const headers: Record<string, string> = {
      english: `💰 *Market Prices*\n📍 ${locLabel}\n\nLatest mandi rates:\n\n`,
      hindi: `💰 *बाजार भाव*\n📍 ${locLabel}\n\nनवीनतम मंडी दर:\n\n`,
      telugu: `💰 *మార్కెట్ ధరలు*\n📍 ${locLabel}\n\nతాజా మండి ధరలు:\n\n`,
      kannada: `💰 *ಬಜಾರ ಬೆಲೆಗಳು*\n📍 ${locLabel}\n\nತಾಜಾ ಮಂಡಿ ದರಗಳು:\n\n`,
    };

    if (data.length === 0) {
      const noData: Record<string, string> = {
        english: `💰 *Market Prices*\n📍 ${locLabel}\n\nNo price data available for your area.\nPlease check the Market Prices section on the dashboard.`,
        hindi: `💰 *बाजार भाव*\n📍 ${locLabel}\n\nआपके क्षेत्र के लिए कोई मूल्य डेटा उपलब्ध नहीं।\nकृपया डैशबोर्ड पर बाजार भाव अनुभाग देखें।`,
        telugu: `💰 *మార్కెట్ ధరలు*\n📍 ${locLabel}\n\nమీ ప్రాంతానికి ధర డేటా అందుబాటులో లేదు.\nదయచేసి డాష్‌బోర్డ్‌లో మార్కెట్ ధరల విభాగాన్ని చూడండి.`,
        kannada: `💰 *ಬಜಾರ ಬೆಲೆಗಳು*\n📍 ${locLabel}\n\nನಿಮ್ಮ ಪ್ರದೇಶಕ್ಕೆ ಬೆಲೆ ಡೇಟಾ ಲಭ್ಯವಿಲ್ಲ.\nದಯವಿಟ್ಟು ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನಲ್ಲಿ ಮಾರುಕಟ್ಟೆ ಬೆಲೆ ವಿಭಾಗವನ್ನು ನೋಡಿ.`,
      };
      return noData[lang] ?? noData.english;
    }

    let body = "";
    for (const p of data) {
      const variety = p.variety ? ` (${p.variety})` : "";
      const mandi = p.mandiName ? ` @ ${p.mandiName}` : "";
      const trend = p.priceTrend ?? "stable";
      body += `• *${p.commodity}${variety}*${mandi}\n  ₹${p.pricePerQuintal.toLocaleString("en-IN")}/quintal ${trendEmoji(trend)}`;
      if (p.minPrice && p.maxPrice) {
        body += ` (Range: ₹${p.minPrice}-₹${p.maxPrice})`;
      }
      body += `\n`;
    }

    return (headers[lang] ?? headers.english) + body;
  } catch (e: any) {
    console.error("[MarketPrices] DB error:", e.message);
    return `💰 *Market Prices*\n📍 ${locLabel}\n\nUnable to fetch prices. Please try again later.`;
  }
}

// Fetch government schemes from DB
async function formatSchemesFromDB(lang: string, state?: string | null): Promise<string> {
  const db = getDb();

  try {
    // Query active schemes, filter by state if available
    let schemes;
    if (state) {
      schemes = await db.select()
        .from(governmentSchemes)
        .where(
          and(
            eq(governmentSchemes.isActive, true),
            sql`(${governmentSchemes.stateSpecific} IS NULL OR LOWER(${governmentSchemes.stateSpecific}) = LOWER(${state}))`
          )
        )
        .orderBy(desc(governmentSchemes.createdAt))
        .limit(5);
    } else {
      schemes = await db.select()
        .from(governmentSchemes)
        .where(eq(governmentSchemes.isActive, true))
        .orderBy(desc(governmentSchemes.createdAt))
        .limit(5);
    }

    const headers: Record<string, string> = {
      english: `📋 *Government Schemes*\n\nActive schemes you may be eligible for:\n\n`,
      hindi: `📋 *सरकारी योजनाएं*\n\nआपके लिए उपलब्ध सक्रिय योजनाएं:\n\n`,
      telugu: `📋 *ప్రభుత్వ పథకాలు*\n\nమీకు అర్హత ఉండే సక్రియ పథకాలు:\n\n`,
      kannada: `📋 *ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು*\n\nನಿಮಗೆ ಅರ್ಹತೆ ಇರಬಹುದಾದ ಸಕ್ರಿಯ ಯೋಜನೆಗಳು:\n\n`,
    };

    if (schemes.length === 0) {
      const noData: Record<string, string> = {
        english: `📋 *Government Schemes*\n\nNo schemes found. Please check the Govt Schemes section on the dashboard.`,
        hindi: `📋 *सरकारी योजनाएं*\n\nकोई योजना नहीं मिली। कृपया डैशबोर्ड पर योजनाएं अनुभाग देखें।`,
        telugu: `📋 *ప్రభుత్వ పథకాలు*\n\nపథకాలు కనుగొనబడలేదు. దయచేసి డాష్‌బోర్డ్‌లో పథకాల విభాగాన్ని చూడండి.`,
        kannada: `📋 *ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು*\n\nಯೋಜನೆಗಳು ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನಲ್ಲಿ ಯೋಜನೆಗಳ ವಿಭಾಗವನ್ನು ನೋಡಿ.`,
      };
      return noData[lang] ?? noData.english;
    }

    let body = "";
    for (const s of schemes) {
      const title = lang === "telugu" && s.titleTelugu ? s.titleTelugu
        : lang === "hindi" && s.titleHindi ? s.titleHindi
        : s.title;
      const catLabel = s.category ? ` [${s.category.toUpperCase()}]` : "";
      body += `• *${title}*${catLabel}\n`;
      if (s.benefits) body += `  💰 ${s.benefits}\n`;
      if (s.eligibility) body += `  ✅ Eligibility: ${s.eligibility}\n`;
      body += `\n`;
    }

    return (headers[lang] ?? headers.english) + body;
  } catch (e: any) {
    console.error("[Schemes] DB error:", e.message);
    return `📋 *Government Schemes*\n\nUnable to fetch schemes. Please try again later.`;
  }
}

// Fetch crop knowledge from DB
async function formatCropAdviceFromDB(lang: string, farmerCrop?: string | null): Promise<string> {
  const db = getDb();

  try {
    // If farmer has a primary crop, search for that first
    let crops;
    if (farmerCrop) {
      crops = await db.select()
        .from(cropKnowledge)
        .where(
          and(
            eq(cropKnowledge.isActive, true),
            sql`LOWER(${cropKnowledge.cropName}) LIKE LOWER(${'%' + farmerCrop + '%'})`
          )
        )
        .limit(3);
    }

    // If no specific crop found, get general advice
    if (!crops || crops.length === 0) {
      crops = await db.select()
        .from(cropKnowledge)
        .where(eq(cropKnowledge.isActive, true))
        .limit(3);
    }

    const headers: Record<string, string> = {
      english: `💡 *Farming Advice*\n\n`,
      hindi: `💡 *खेती सलाह*\n\n`,
      telugu: `💡 *వ్యవసాయ సలహా*\n\n`,
      kannada: `💡 *ಕೃಷಿ ಸಲಹೆ*\n\n`,
    };

    if (crops.length === 0) {
      const noData: Record<string, string> = {
        english: `💡 *Farming Advice*\n\n• Apply NPK 20-20-20 at 50kg/acre\n• Monitor for stem borer pests\n• Water every 7-10 days\n• Use neem-based spray if needed\n\nType a crop name (e.g., Rice, Cotton) for specific advice.`,
        hindi: `💡 *खेती सलाह*\n\n• NPK 20-20-20, 50kg/एकड़ में डालें\n• स्टेम बोरर कीट की जांच करें\n• 7-10 दिन में पानी दें\n• जरूरत हो तो नीम स्प्रे का उपयोग करें\n\nविशिष्ट सलाह के लिए फसल का नाम (जैसे चावल, कपास) टाइप करें।`,
        telugu: `💡 *వ్యవసాయ సలహా*\n\n• NPK 20-20-20, 50kg/ఎకరం వేయండి\n• స్టెమ్ బోరర్ పురుగులను పరిశీలించండి\n• 7-10 రోజులకు నీరు పారించండి\n• అవసరమైతే వేప స్ప్రే వాడండి\n\nప్రత్యేక సలహా కోసం పంట పేరు (ఉదా: బియ్యం, పత్తి) టైప్ చేయండి.`,
        kannada: `💡 *ಕೃಷಿ ಸಲಹೆ*\n\n• NPK 20-20-20, 50kg/ಎಕರೆ ಹಾಕಿ\n• ಸ್ಟೆಮ್ ಬೋರರ್ ಕೀಟ ಗಮನಿಸಿ\n• 7-10 ದಿನಕ್ಕೊಮ್ಮೆ ನೀರು ಹಾಕಿ\n• ಅಗತ್ಯವಿದ್ದರೆ ಬೇವು ಸ್ಪ್ರೇ ಬಳಸಿ\n\nವಿಶಿಷ್ಟ ಸಲಹೆಗೆ ಬೆಳೆಯ ಹೆಸರು (ಉದಾ: ಅಕ್ಕಿ, ಹತ್ತಿ) ಟೈಪ್ ಮಾಡಿ.`,
      };
      return noData[lang] ?? noData.english;
    }

    let body = "";
    for (const c of crops) {
      const name = lang === "telugu" && c.cropNameTelugu ? c.cropNameTelugu
        : lang === "hindi" && c.cropNameHindi ? c.cropNameHindi
        : c.cropName;
      body += `• *${name}*${c.variety ? ` (${c.variety})` : ""}\n`;
      if (c.fertilizer) body += `  🌱 Fertilizer: ${c.fertilizer}\n`;
      if (c.pestControl) body += `  🐛 Pest Control: ${c.pestControl}\n`;
      if (c.watering) body += `  💧 Watering: ${c.watering}\n`;
      if (c.harvestingTips) body += `  🌾 Harvest: ${c.harvestingTips}\n`;
      body += `\n`;
    }

    return (headers[lang] ?? headers.english) + body;
  } catch (e: any) {
    console.error("[CropAdvice] DB error:", e.message);
    return `💡 *Farming Advice*\n\nUnable to fetch advice. Please try again later.`;
  }
}

async function generateAIResponse(intent: string, lang: string, district?: string | null, state?: string | null, pincode?: string | null, farmerCrop?: string | null): Promise<string> {
  // Normalize intent names from button IDs
  const normalizedIntent = intent === "market_prices" ? "market_price"
    : intent === "government_schemes" ? "scheme"
    : intent === "crop_knowledge" ? "crop_advice"
    : intent;

  // 1. Weather — fetch live data from Open-Meteo
  if (normalizedIntent === "weather") {
    if (district && state) {
      return await getWeatherResponse(district, state, lang, pincode);
    }
    const fallback: Record<string, string> = {
      english: `🌦️ *Weather*

Please set your district and state in your profile for accurate weather updates.

Type "menu" to see options.`,
      hindi: `🌦️ *मौसम*

सटीक मौसम अपडेट के लिए कृपया अपना जिला और राज्य सेट करें।

विकल्प देखने के लिए "menu" टाइप करें।`,
      telugu: `🌦️ *వాతావరణం*

సరైన వాతావరణ నవీకరణల కోసం దయచేసి మీ జిల్లా మరియు రాష్ట్రాన్ని సెట్ చేయండి.

ఎంపికలను చూడటానికి "menu" టైప్ చేయండి।`,
      kannada: `🌦️ *ಹವಾಮಾನ*

ಸರಿಯಾದ ಹವಾಮಾನ ಅಪ್‌ಡೇಟ್‌ಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ನಿಮ್ಮ ಜಿಲ್ಲೆ ಮತ್ತು ರಾಜ್ಯವನ್ನು ಹೊಂದಿಸಿ।

ಆಯ್ಕೆಗಳನ್ನು ನೋಡಲು "menu" ಟೈಪ್ ಮಾಡಿ।`,
    };
    return fallback[lang] ?? fallback.english;
  }

  // 2. Market Prices — query from DB
  if (normalizedIntent === "market_price") {
    return await formatMarketPrices(lang, district, state);
  }

  // 3. Government Schemes — query from DB
  if (normalizedIntent === "scheme") {
    return await formatSchemesFromDB(lang, state);
  }

  // 4. Crop Advice — query from DB
  if (normalizedIntent === "crop_advice") {
    return await formatCropAdviceFromDB(lang, farmerCrop);
  }

  // 5. Static responses for greeting, language_change, general
  const responses: Record<string, Record<string, string>> = {
    greeting: {
      english: `👋 *Welcome to Kisan Saathi!*

Your AI farming assistant is ready to help.

Tap the menu below to get started 👇`,
      hindi: `🙏 *किसान साथी में स्वागत है!*

आपका AI कृषि सहायक मदद के लिए तैयार है।

शुरू करने के लिए नीचे मेनू दबाएं 👇`,
      telugu: `🙏 *కిసాన్ సాథికి స్వాగతం!*

మీ AI వ్యవసాయ సహాయకుడు సహాయానికి సిద్ధంగా ఉన్నాడు।

ప్రారంభించడానికి కింది మెనూను ట్యాప్ చేయండి 👇`,
      kannada: `🙏 *ಕಿಸಾನ್ ಸಾಥಿಗೆ ಸ್ವಾಗತ!*

ನಿಮ್ಮ AI ಕೃಷಿ ಸಹಾಯಕ ಸಹಾಯಕ್ಕೆ ಸಿದ್ಧವಾಗಿದೆ।

ಪ್ರಾರಂಭಿಸಲು ಕೆಳಗಿನ ಮೆನುವನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ 👇`,
    },
    language_change: {
      english: `🌐 *Language Settings*

Choose your preferred language using the buttons above.`,
      hindi: `🌐 *भाषा सेटिंग्स*

ऊपर दिए गए बटन का उपयोग करके अपनी पसंदीदा भाषा चुनें।`,
      telugu: `🌐 *భాష సెట్టింగ్స్*

పైన ఉన్న బటన్లను ఉపయోగించి మీకు ఇష్టమైన భాషను ఎంచుకోండి।`,
      kannada: `🌐 *ಭಾಷೆ ಸೆಟ್ಟಿಂಗ್ಸ್*

ಮೇಲಿನ ಬಟನ್ ಬಳಸಿ ನಿಮ್ಮ ಆದ್ಯತೆಯ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ।`,
    },
    general: {
      english: `🤖 *Kisan Saathi*

I can help you with:
• 🌦️ Weather updates
• 💰 Market prices
• 📋 Government schemes
• 💡 Farming advice

Type "menu" anytime to see options!`,
      hindi: `🤖 *किसान साथी*

मैं आपकी मदद कर सकता हूं:
• 🌦️ मौसम की जानकारी
• 💰 बाजार भाव
• 📋 सरकारी योजनाएं
• 💡 खेती सलाह

"menu" टाइप करें विकल्प देखने के लिए!`,
      telugu: `🤖 *కిసాన్ సాథి*

నేను మీకు సహాయం చేయగల విషయాలు:
• 🌦️ వాతావరణ సమాచారం
• 💰 మార్కెట్ ధరలు
• 📋 ప్రభుత్వ పథకాలు
• 💡 వ్యవసాయ సలహా

ఎప్పుడైనా "menu" టైప్ చేస్తే ఎంపికలు కనిపిస్తాయి!`,
      kannada: `🤖 *ಕಿಸಾನ್ ಸಾಥಿ*

ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದಾದ ವಿಷಯಗಳು:
• 🌦️ ಹವಾಮಾನ ಮಾಹಿತಿ
• 💰 ಬಜಾರ ಬೆಲೆ
• 📋 ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು
• 💡 ಕೃಷಿ ಸಲಭೆ

ಯಾವಾಗಲಾದರೂ "menu" ಟೈಪ್ ಮಾಡಿ ಆಯ್ಕೆಗಳನ್ನು ನೋಡಿ!`,
    },
  };

  const langMap: Record<string, string> = { telugu: "telugu", hindi: "hindi", kannada: "kannada", english: "english" };
  const responsesForIntent = responses[normalizedIntent] ?? responses.general;
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
