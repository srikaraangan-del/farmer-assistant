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
import { getDb, getRawPool } from "./queries/connection";
import { farmers, messages, conversations, pincodes, marketPrices, governmentSchemes, cropKnowledge, dailyNews } from "@db/schema";
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

    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        // Skip status receipts (delivered/read) - only process actual messages
        const statuses = change.value?.statuses ?? [];
        if (statuses.length > 0) {
          for (const s of statuses) {
            console.log(`[WhatsApp] Status: ${s.status} for msg ${s.id?.slice(-8)} to ${s.recipient_id?.slice(-6)}`);
          }
          continue; // Don't process statuses as messages
        }

        const messages_data = change.value?.messages ?? [];
        if (messages_data.length === 0) continue;

        for (const msg of messages_data) {
          const from = msg.from;
          const type = msg.type ?? "text";

          let text = "";
          let interactiveId = "";

          if (type === "interactive") {
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
            text = msg.text?.body ?? "";
            console.log(`[WhatsApp] Text from ${from}: "${text.substring(0, 50)}"`);
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
    // Re-fetch the newly created farmer so we have the full record
    farmer = await db.select().from(farmers).where(eq(farmers.id, farmerId)).limit(1);
  } else {
    farmerId = farmer[0].id;
  }

  // === FARMER ONBOARDING: Collect missing profile details ===
  const lang = farmer[0]?.preferredLanguage ?? "english";
  const farmerName = farmer[0]?.name;
  const farmerState = farmer[0]?.state;
  const farmerDistrict = farmer[0]?.district;
  const farmerPincode = farmer[0]?.pincode;
  const farmerCrop = farmer[0]?.primaryCrop;
  const profileComplete = farmerName && farmerState && farmerDistrict && farmerPincode && farmerCrop;

  const lowerMsg = message.toLowerCase().trim();
  const isGreeting = ["hello", "hi", "hey", "namaste", "start"].includes(lowerMsg);

  // Only run onboarding on greeting for incomplete profiles, or when answering questions
  const isAnsweringQuestion = !interactiveId && !profileComplete && !isGreeting &&
    !["menu", "సేవలు", "మెనూ", "मेनू"].includes(lowerMsg);

  if ((isGreeting && !profileComplete) || isAnsweringQuestion) {
    // Step 1: Collect name
    if (!farmerName) {
      if (isGreeting) {
        const askName = lang === "telugu" ? `నమస్కారం! నేను మీ Krishiva AI సహాయకుడిని.\n\nమీ పేరును చెప్పగలరా?`
          : lang === "hindi" ? `नमस्ते! मैं आपका Krishiva AI सहायक हूं।\n\nकृपया अपना नाम बताएं?`
          : lang === "kannada" ? `ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ Krishiva AI ಸಹಾಯಕ.\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಹೆಸರನ್ನು ಹೇಳಿ?`
          : `Hello! I am your Krishiva AI assistant.\n\nMay I know your name?`;
        await sendWhatsAppMessage(phoneNumber, askName);
        return;
      }
      // Real name provided - save it, ask for pincode next
      await db.update(farmers).set({ name: message.trim() }).where(eq(farmers.id, farmerId));
      const askPincode = lang === "telugu" ? `నమస్కారం ${message.trim()}!\n\nదయచేసి మీ 6-అంకెల పిన్‌కోడ్‌ను పంపండి (ఉదా: 533201):\n\n📍 మేము మీ ఏరియా స్టేట్ మరియు జిల్లాను ఆటో-డిటెక్ట్ చేస్తాము.`
        : lang === "hindi" ? `नमस्ते ${message.trim()}!\n\nकृपया अपना 6-अंकीय पिनकोड भेजें (जैसे: 533201):\n\n📍 हम आपका राज्य और जिला ऑटो-डिटेक्ट करेंगे।`
        : lang === "kannada" ? `ನಮಸ್ಕಾರ ${message.trim()}!\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ 6-ಅಂಕಿಯ ಪಿನ್‌ಕೋಡ್‌ನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: 533201):\n\n📍 ನಾವು ನಿಮ್ಮ ರಾಜ್ಯ ಮತ್ತು ಜಿಲ್ಲೆಯನ್ನು ಆಟೋ-ಡಿಟೆಕ್ಟ್ ಮಾಡುತ್ತೇವೆ.`
        : `Namaskaram ${message.trim()}!\n\nPlease send your 6-digit pincode (e.g., 533201):\n\n📍 We will auto-detect your state and district.`;
      await sendWhatsAppMessage(phoneNumber, askPincode);
      return;
    }

    // Step 2: Collect pincode → auto-fetch state & district
    if (!farmerPincode) {
      if (/^\d{6}$/.test(message.trim())) {
        const pin = message.trim();
        // Fetch state and district from postal API
        const location = await fetchLocationFromPincode(pin);
        if (location) {
          // Auto-detected - save all and ask for confirmation
          await db.update(farmers).set({
            pincode: pin,
            state: location.state,
            district: location.district,
          }).where(eq(farmers.id, farmerId));
          // Send confirmation with Yes/No buttons
          const confirmBody = lang === "telugu" ? `📍 మేము మీ లొకేషన్ గుర్తించాము:\n*${location.district}, ${location.state}*\n\n🌦️ ఈ సమాచారం మీ ప్రాంతానికి సరైన వాతావరణ అప్‌డేట్‌లను పంపించడానికి సహాయపడుతుంది.\n\nఇది సరైనదా?`
            : lang === "hindi" ? `📍 हमने आपका स्थान पहचाना:\n*${location.district}, ${location.state}*\n\n🌦️ यह जानकारी आपके क्षेत्र के लिए सटीक मौसम अपडेट भेजने में मदद करेगी।\n\nक्या यह सही है?`
            : lang === "kannada" ? `📍 ನಾವು ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಗುರುತಿಸಿದ್ದೇವೆ:\n*${location.district}, ${location.state}*\n\n🌦️ ಈ ಮಾಹಿತಿ ನಿಮ್ಮ ಪ್ರದೇಶಕ್ಕಾಗಿ ಸರಿಯಾದ ಹವಾಮಾನ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ಕಳುಹಿಸಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ.\n\nಇದು ಸರಿಯಾದದ್ದೇ?`
            : `📍 We detected your location:\n*${location.district}, ${location.state}*\n\n🌦️ This helps us send accurate weather updates customized for your area.\n\nIs this correct?`;
          await sendWhatsAppButtons(phoneNumber, confirmBody, [
            { id: "confirm_location_yes", title: lang === "telugu" ? "అవును ✅" : lang === "hindi" ? "हाँ ✅" : lang === "kannada" ? "ಹೌದು ✅" : "Yes ✅" },
            { id: "confirm_location_no", title: lang === "telugu" ? "కాదు ❌" : lang === "hindi" ? "नहीं ❌" : lang === "kannada" ? "ಇಲ್ಲ ❌" : "No ❌" },
          ]);
        } else {
          // API failed - save pincode only, ask for manual state
          await db.update(farmers).set({ pincode: pin }).where(eq(farmers.id, farmerId));
          const askState = lang === "telugu" ? `పిన్‌కోడ్ సేవ్ చేయబడింది.\n\nమేము మీ ఏరియాను గుర్తించలేకపోయాము.\n\nదయచేసి మీ రాష్ట్రాన్ని టైప్ చేయండి (ఉదా: Andhra Pradesh):`
            : lang === "hindi" ? `पिनकोड सेव हो गया।\n\nहम आपका क्षेत्र नहीं पहचान सके।\n\nकृपया अपना राज्य टाइप करें (जैसे: Andhra Pradesh):`
            : lang === "kannada" ? `ಪಿನ್‌ಕೋಡ್ ಉಳಿಸಲಾಗಿದೆ.\n\nನಾವು ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಗುರುತಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ರಾಜ್ಯವನ್ನು ಟೈಪ್ ಮಾಡಿ (ಉದಾ: Karnataka):`
            : `Pincode saved.\n\nWe could not detect your area.\n\nPlease type your state (e.g., Andhra Pradesh):`;
          await sendWhatsAppMessage(phoneNumber, askState);
        }
      } else {
        const retryPincode = lang === "telugu" ? `దయచేసి సరైన 6-అంకెల పిన్‌కోడ్‌ను పంపండి (ఉదా: 533201):`
          : lang === "hindi" ? `कृपया वैध 6-अंकीय पिनकोड भेजें (जैसे: 533201):`
          : lang === "kannada" ? `ದಯವಿಟ್ಟು ಸರಿಯಾದ 6-ಅಂಕಿಯ ಪಿನ್‌ಕೋಡ್‌ನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: 533201):`
          : `Please send a valid 6-digit pincode (e.g., 533201):`;
        await sendWhatsAppMessage(phoneNumber, retryPincode);
      }
      return;
    }

    // Step 3: Manual state entry (only if auto-detect failed or user said "No")
    if (!farmerState) {
      await db.update(farmers).set({ state: message.trim() }).where(eq(farmers.id, farmerId));
      const askDistrict = lang === "telugu" ? `ధన్యవాదాలు!\n\nదయచేసి మీ జిల్లాను పంపండి (ఉదా: East Godavari):`
        : lang === "hindi" ? `धन्यवाद!\n\nकृपया अपना जिला भेजें (जैसे: East Godavari):`
        : lang === "kannada" ? `ಧನ್ಯವಾದಗಳು!\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಜಿಲ್ಲೆಯನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: East Godavari):`
        : `Thank you!\n\nPlease send your district (e.g., East Godavari):`;
      await sendWhatsAppMessage(phoneNumber, askDistrict);
      return;
    }

    // Step 4: Manual district entry
    if (!farmerDistrict) {
      await db.update(farmers).set({ district: message.trim() }).where(eq(farmers.id, farmerId));
      await sendLanguageMenu(phoneNumber);
      return;
    }

    // Step 5: Collect crop
    if (!farmerCrop) {
      await db.update(farmers).set({ primaryCrop: message.trim() }).where(eq(farmers.id, farmerId));
      const readyMsg = lang === "telugu" ? `అన్ని వివరాలు సేకరించబడ్డాయి ${farmerName}!\n\nమీ AI సహాయకుడు సిద్ధంగా ఉన్నాడు.`
        : lang === "hindi" ? `सभी जानकारी एकत्रित हो गई ${farmerName}!\n\nआपका AI सहायक तैयार है।`
        : lang === "kannada" ? `ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಸಂಗ್ರಹಿಸಲಾಗಿದೆ ${farmerName}!\n\nನಿಮ್ಮ AI ಸಹಾಯಕ ಸಿದ್ಧವಾಗಿದೆ.`
        : `All details collected ${farmerName}!\n\nYour AI assistant is ready.`;
      await sendWhatsAppMessage(phoneNumber, readyMsg);
      await sendMainMenu(phoneNumber, lang);
      return;
    }
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

    // Handle crop selection (e.g., crop_rice, crop_cotton)
    if (result.isCropSelection) {
      const cropAdvice = await getCropAdviceByName(intent, lang);
      await sendWhatsAppMessage(phoneNumber, cropAdvice);
      await sendMainMenu(phoneNumber, lang);
      return;
    }

    // Handle location confirmation (Yes/No after pincode auto-detect)
    if (intent === "confirm_location_yes") {
      // Location confirmed - continue to language selection
      const thankMsg = lang === "telugu" ? `ధన్యవాదాలు! మీ లొకేషన్ నమోదు చేయబడింది.`
        : lang === "hindi" ? `धन्यवाद! आपका स्थान सेव कर लिया गया।`
        : lang === "kannada" ? `ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಉಳಿಸಲಾಗಿದೆ.`
        : `Thank you! Your location has been saved.`;
      await sendWhatsAppMessage(phoneNumber, thankMsg);
      await sendLanguageMenu(phoneNumber);
      return;
    }

    if (intent === "confirm_location_no") {
      // Location rejected - clear state+district and ask for manual state
      await db.update(farmers).set({ state: null, district: null }).where(eq(farmers.id, farmerId));
      const askState = lang === "telugu" ? `సరే, దయచేసి మీ రాష్ట్రాన్ని టైప్ చేయండి (ఉదా: Andhra Pradesh):`
        : lang === "hindi" ? `ठीक है, कृपया अपना राज्य टाइप करें (जैसे: Andhra Pradesh):`
        : lang === "kannada" ? `ಸರಿ, ದಯವಿಟ್ಟು ನಿಮ್ಮ ರಾಜ್ಯವನ್ನು ಟೈಪ್ ಮಾಡಿ (ಉದಾ: Karnataka):`
        : `Okay, please type your state (e.g., Andhra Pradesh):`;
      await sendWhatsAppMessage(phoneNumber, askState);
      return;
    }

    // Handle language change
    if (intent.startsWith("set_language_")) {
      const newLang = intent.replace("set_language_", "");
      await db.update(farmers).set({ preferredLanguage: newLang }).where(eq(farmers.id, farmerId));

      // Confirm in new language
      const confirmText = newLang === "telugu" ? "భాష తెలుగుకు మార్చబడింది."
        : newLang === "hindi" ? "भाषा हिंदी में बदल दी गई है।"
        : newLang === "kannada" ? "ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ."
        : "Language changed to English.";
      await sendWhatsAppMessage(phoneNumber, confirmText);

      // Check if crop is still missing → ask for crop before showing menu
      const farmerCrop = farmer[0]?.primaryCrop;
      if (!farmerCrop) {
        const askCrop = newLang === "telugu" ? `అద్భుతం!\n\nదయచేసి మీ ప్రధాన పంటను పంపండి (ఉదా: Rice, Cotton):`
          : newLang === "hindi" ? `बहुत अच्छे!\n\nकृपया अपनी मुख्य फसल भेजें (जैसे: Rice, Cotton):`
          : newLang === "kannada" ? `ಅದ್ಭುತ!\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರಧಾನ ಪಂಟವನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: Rice, Cotton):`
          : `Excellent!\n\nPlease send your main crop (e.g., Rice, Cotton):`;
        await sendWhatsAppMessage(phoneNumber, askCrop);
      } else {
        await sendMainMenu(phoneNumber, newLang);
      }
      return;
    }
  } else {
    // Text message — detect intent and check for special cases
    const lowerMsg = message.toLowerCase().trim();

    // Check if message is a 6-digit pincode → save and get weather
    if (/^\d{6}$/.test(message.trim())) {
      console.log(`[WhatsApp] Detected 6-digit pincode: ${message}`);
      const farmerLang = farmer[0]?.preferredLanguage ?? "english";
      const farmerDist = farmer[0]?.district;
      const farmerSt = farmer[0]?.state;
      await db.update(farmers).set({ pincode: message.trim() }).where(eq(farmers.id, farmerId));
      const weatherMsg = await getWeatherResponse(farmerDist ?? "", farmerSt ?? "", farmerLang, message.trim());
      await sendWhatsAppMessage(phoneNumber, weatherMsg);
      await sendMainMenu(phoneNumber, farmerLang);
      return;
    }

    // Check if message matches a crop name (text-based crop selection)
    const cropMatch = await findCropByName(message.trim());
    if (cropMatch) {
      console.log(`[WhatsApp] Matched crop: ${cropMatch}`);
      const farmerLang = farmer[0]?.preferredLanguage ?? "english";
      const cropAdvice = await getCropAdviceByName(`crop_${cropMatch.toLowerCase().replace(/\s+/g, "_")}`, farmerLang);
      await sendWhatsAppMessage(phoneNumber, cropAdvice);
      await sendMainMenu(phoneNumber, farmerLang);
      return;
    }

    intent = detectIntent(message);
    // "menu", "hello", "hi", "namaste" should trigger the main menu
    if (lowerMsg === "menu" || lowerMsg === "hello" || lowerMsg === "hi" || lowerMsg === "hey" ||
        lowerMsg === "namaste" || lowerMsg === "namaskaram" || lowerMsg === "start" ||
        lowerMsg === "సేవలు" || lowerMsg === "मेनू" || lowerMsg === "మెనూ") {
      isMenuAction = true;
    }
    // Language change keywords should trigger language menu
    if (intent === "language_change") {
      isMenuAction = true;
    }
  }

  // 4. Generate AI response with full error handling
  let aiResponse = "";
  try {
    const lang = farmer[0]?.preferredLanguage ?? "english";
    const farmerName = farmer[0]?.name;
    const farmerDistrict = farmer[0]?.district;
    const farmerState = farmer[0]?.state;
    const farmerPincode = farmer[0]?.pincode;
    const farmerCrop = farmer[0]?.primaryCrop;
    const profileComplete = farmerName && farmerState && farmerDistrict && farmerPincode && farmerCrop;

    console.log(`[WhatsApp] === PROCESSING ${phoneNumber} === intent=${intent}, lang=${lang}, profileComplete=${profileComplete}`);

    // Step 1: Generate response
    console.log(`[WhatsApp] Step 1: Generating AI response...`);
    aiResponse = await generateAIResponse(intent, lang, farmerDistrict, farmerState, farmerPincode, farmerCrop, farmerName);
    console.log(`[WhatsApp] Step 1 DONE: Response ${aiResponse.length} chars`);

    // Step 2: Save farmer message
    console.log(`[WhatsApp] Step 2: Saving farmer message...`);
    await db.insert(messages).values({
      conversationId, farmerId, senderType: "farmer",
      contentType: "text", // DB enum only allows text/voice/image/template
      content: message || interactiveId, language: lang, intentDetected: intent,
    });
    console.log(`[WhatsApp] Step 2 DONE`);

    // Step 3: Save AI response
    console.log(`[WhatsApp] Step 3: Saving AI response...`);
    await db.insert(messages).values({
      conversationId, farmerId, senderType: "ai",
      contentType: "text", content: aiResponse,
      language: lang, aiResponse, intentDetected: intent,
    });
    console.log(`[WhatsApp] Step 3 DONE`);

    // Step 4: Update conversation
    console.log(`[WhatsApp] Step 4: Updating conversation...`);
    await db.update(conversations).set({
      intent, messageCount: sql`${conversations.messageCount} + 2`, updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    console.log(`[WhatsApp] Step 4 DONE`);

    // Step 5: Update farmer stats
    console.log(`[WhatsApp] Step 5: Updating farmer stats...`);
    await db.update(farmers).set({
      totalInteractions: sql`${farmers.totalInteractions} + 1`,
      lastInteractionAt: new Date(), updatedAt: new Date(),
    }).where(eq(farmers.id, farmerId));
    console.log(`[WhatsApp] Step 5 DONE`);

    // Step 6: Send response
    console.log(`[WhatsApp] Step 6: Sending response... menuAction=${isMenuAction}, intent=${intent}`);
    if (isMenuAction && intent === "language_change") {
      await sendLanguageMenu(phoneNumber);
    } else if (isMenuAction && intent === "crop_knowledge") {
      // Show crop selection text list
      await sendCropSelectionList(phoneNumber, lang);
    } else if (isMenuAction && intent === "weather") {
      // Weather: use pincode if available
      if (farmerPincode) {
        const weatherMsg = await getWeatherResponse(farmerDistrict ?? "", farmerState ?? "", lang, farmerPincode);
        await sendWhatsAppMessage(phoneNumber, weatherMsg);
        await sendMainMenu(phoneNumber, lang);
      } else if (!profileComplete) {
        // During onboarding - tell them to complete profile first
        const completeProfile = lang === "telugu" ? `🌦️ *వాతావరణం*\n\nమీ ప్రొఫైల్‌ను పూర్తి చేయండి.\n\nమీ పిన్‌కోడ్ సేకరించబడుతుంది.\n\n_Type "menu" to continue_`
          : lang === "hindi" ? `🌦️ *मौसम*\n\nकृपया अपनी प्रोफ़ाइल पूरी करें।\n\nआपका पिनकोड एकत्र किया जाएगा।\n\n_Type "menu" to continue_`
          : `🌦️ *Weather*\n\nPlease complete your profile setup first.\n\nYour pincode will be collected during registration.\n\n_Type "menu" to continue_`;
        await sendWhatsAppMessage(phoneNumber, completeProfile);
      } else {
        // Profile complete but no pincode - ask for it
        const askPincode = lang === "telugu" ? `🌦️ *వాతావరణం*\n\nమీ ఏరియా పిన్‌కోడ్‌ను పంపండి (ఉదా: 500001).`
          : lang === "hindi" ? `🌦️ *मौसम*\n\nकृपया अपना एरिया पिनकोड भेजें (जैसे: 500001)。`
          : lang === "kannada" ? `🌦️ *ಹವಾಮಾನ*\n\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಏರಿಯಾ ಪಿನ್‌ಕೋಡ್‌ನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: 500001).`
          : `🌦️ *Weather*\n\nPlease send your area pincode (e.g., 500001).`;
        await sendWhatsAppMessage(phoneNumber, askPincode);
      }
    } else if (isMenuAction) {
      await sendWhatsAppMessage(phoneNumber, aiResponse);
      await sendMainMenu(phoneNumber, lang);
    } else if (isNewFarmer) {
      // New farmer: personalized welcome, ask for name first
      const welcomeMsg = lang === "telugu" ? `నమస్కారం! నేను మీ Krishiva AI సహాయకుడిని.\n\nమీ పేరును చెప్పగలరా?`
        : lang === "hindi" ? `नमस्ते! मैं आपका Krishiva AI सहायक हूं।\n\nकृपया अपना नाम बताएं?`
        : `Hello! I am your Krishiva AI assistant.\n\nMay I know your name?`;
      await sendWhatsAppMessage(phoneNumber, welcomeMsg);
    } else {
      await sendWhatsAppMessage(phoneNumber, aiResponse);
    }
    console.log(`[WhatsApp] === COMPLETE ${phoneNumber} ===`);
  } catch (err: any) {
    console.error(`[WhatsApp] CRITICAL ERROR for ${phoneNumber} at step unknown:`, err.message);
    console.error(`[WhatsApp] Stack:`, err.stack);
    // Send error message to farmer so they're not left hanging
    const errorMsg = `Sorry, there was an error. Please try again.`;
    try {
      await sendWhatsAppMessage(phoneNumber, errorMsg);
    } catch (sendErr: any) {
      console.error(`[WhatsApp] Failed to send error message:`, sendErr.message);
    }
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
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.warn("[WhatsApp] Cannot send list: Missing token or phone ID");
    return false;
  }
  const normalizedTo = normalizePhone(toPhoneNumber);
  if (normalizedTo.length < 10) {
    console.error(`[WhatsApp] Invalid phone for list: ${normalizedTo}`);
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    // Validate button text length (1-20 chars required by Meta)
    const safeButton = buttonText.slice(0, 20);
    // Validate row titles (1-24 chars)
    const safeSections = sections.map((s) => ({
      title: s.title.slice(0, 24),
      rows: s.rows.map((r) => ({
        id: r.id.slice(0, 200),
        title: r.title.slice(0, 24),
        description: (r.description || "").slice(0, 72),
      })),
    }));

    const payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: body.slice(0, 1024) },
        action: { button: safeButton, sections: safeSections },
      },
    };
    // Only add header if provided (can cause issues on some API versions)
    if (header && header.trim().length > 0) {
      payload.interactive.header = { type: "text", text: header.slice(0, 60) };
    }
    // Only add footer if provided
    if (footer && footer.trim().length > 0) {
      payload.interactive.footer = { text: footer.slice(0, 60) };
    }

    console.log(`[WhatsApp] Sending list to ${normalizedTo}: button="${safeButton}", rows=${safeSections.reduce((sum, s) => sum + s.rows.length, 0)}`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error(`[WhatsApp] List send failed (${response.status}):`, JSON.stringify(result));
      return false;
    }
    console.log(`[WhatsApp] List message sent successfully to ${normalizedTo}: wamid=${result.messages?.[0]?.id ?? "unknown"}`);
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp] List error to ${toPhoneNumber}:`, err.message);
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
    header: "Krishiva",
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
        { id: "news", title: "Daily News", description: "Read latest farming news and updates" },
        { id: "language", title: "Change Language", description: "Switch to Telugu, Hindi, Kannada or English" },
      ],
    }],
  },
  telugu: {
    header: "Krishiva",
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
        { id: "news", title: "రోజువారీ వార్తలు", description: "తాజా వ్యవసాయ వార్తలు చదవండి" },
        { id: "language", title: "భాష మార్చు", description: "తెలుగు, హిందీ, కన్నడ లేదా ఆంగ్లంలోకి మార్చండి" },
      ],
    }],
  },
  hindi: {
    header: "Krishiva",
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
        { id: "news", title: "दैनिक समाचार", description: "नवीनतम कृषि समाचार पढ़ें" },
        { id: "language", title: "भाषा बदलें", description: "तेलुगु, हिंदी, कन्नड़ या अंग्रेजी में बदलें" },
      ],
    }],
  },
  kannada: {
    header: "ಕೃಷಿವ",
    body: "ನಿಮ್ಮ AI ಕೃಷಿ ಸಹಾಯಕ. ಒಂದು ಸೇವೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:",
    footer: "ಎಂಪಿಕೆಗಳನ್ನು ನೋಡಲು ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿರಿ",
    button: "ಸೇವೆಗಳು",
    sections: [{
      title: "ಲಭ್ಯವಿರುವ ಸೇವೆಗಳು",
      rows: [
        { id: "weather", title: "ಹವಾಮಾನ", description: "ನಿಮ್ಮ ಪ್ರದೇಶದ ಹವಾಮಾನ ನವೀಕರಣ" },
        { id: "prices", title: "ಮಾರುಕಟ್ಟೆ ಬೆಲೆ", description: "ಪಂಟಗಳ ಪ್ರಸ್ತುತ ಬೆಲೆ ಪರಿಶೀಲಿಸಿ" },
        { id: "schemes", title: "ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು", description: "ಅರ್ಹ ಸರ್ಕಾರಿ ಯೋಜನೆಗಳನ್ನು ಹುಡುಕಿ" },
        { id: "crops", title: "ಪಂಟ ಜ್ಞಾನ", description: "ನಿಮ್ಮ ಪಂಟಗಳಿಗೆ ಕೃಷಿ ಸಲಹೆ ಪಡೆಯಿರಿ" },
        { id: "news", title: "ದೈನಂದಿನ ಸುದ್ದಿ", description: "ತಾಜಾ ಕೃಷಿ ಸುದ್ದಿಗಳನ್ನು ಓದಿ" },
        { id: "language", title: "ಭಾಷೆ ಬದಲಾಯಿಸಿ", description: "ತೆಲುಗು, ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ಗೆ ಬದಲಾಯಿಸಿ" },
      ],
    }],
  },
};

// Language selection list
const LANGUAGE_LIST = {
  header: "🌐 Language / భాష / भाषा / ಭಾಷೆ",
  body: "Please choose your preferred language:\nकृपया अपनी भाषा चुनें:\nదయచేసి మీ భాషను ఎంచుకోండి:\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:",
  footer: "Tap a language to switch",
  button: "Select Language",
  sections: [{
    title: "Languages / భాషలు / भाषाएं / ಭಾಷೆಗಳು",
    rows: [
      { id: "lang_english", title: "English", description: "Continue in English" },
      { id: "lang_telugu", title: "Telugu / తెలుగు", description: "తెలుగులో కొనసాగించండి" },
      { id: "lang_hindi", title: "Hindi / हिन्दी", description: "हिंदी में जारी रखें" },
      { id: "lang_kannada", title: "Kannada / ಕನ್ನಡ", description: "ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಸಿ" },
    ],
  }],
};

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

// Send language selection as list message (supports 4 languages)
async function sendLanguageMenu(phoneNumber: string) {
  const l = LANGUAGE_LIST;
  const success = await sendWhatsAppList(phoneNumber, l.header, l.body, l.footer, l.button, l.sections);
  if (!success) {
    await sendWhatsAppMessage(phoneNumber, "Please type your language: English, Telugu, Hindi, or Kannada");
  }
}

// Handle interactive list/button replies
function handleInteractiveReply(replyId: string, lang: string): { intent: string; isMenuAction: boolean; isCropSelection: boolean } {
  // Map reply IDs to intents
  const intentMap: Record<string, string> = {
    weather: "weather",
    prices: "market_prices",
    schemes: "government_schemes",
    crops: "crop_knowledge",
    news: "daily_news",
    language: "language_change",
    lang_english: "set_language_english",
    lang_telugu: "set_language_telugu",
    lang_hindi: "set_language_hindi",
    lang_kannada: "set_language_kannada",
    confirm_location_yes: "confirm_location_yes",
    confirm_location_no: "confirm_location_no",
  };

  // Check if this is a crop selection (e.g., "crop_rice", "crop_cotton")
  const isCropSelection = replyId.startsWith("crop_");

  const intent = isCropSelection ? replyId : (intentMap[replyId] ?? "general");
  const isMenuAction = ["weather", "prices", "schemes", "crops", "news", "language"].includes(replyId);

  return { intent, isMenuAction, isCropSelection };
}

// Fetch state and district from Indian postal pincode API
async function fetchLocationFromPincode(pincode: string): Promise<{ state: string; district: string } | null> {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      if (po.State && po.District) {
        return { state: po.State, district: po.District };
      }
    }
  } catch (e: any) {
    console.error(`[Pincode] Location fetch error:`, e.message);
  }
  return null;
}

// Geocode a pincode using Open-Meteo
// Hardcoded lat/lon for major Indian districts (fallback when APIs fail)
const INDIAN_DISTRICT_COORDS: Record<string, { lat: number; lon: number }> = {
  "east godavari": { lat: 17.3212, lon: 82.0407 },
  "west godavari": { lat: 16.7907, lon: 81.3220 },
  "krishna": { lat: 16.6096, lon: 80.6936 },
  "guntur": { lat: 16.3008, lon: 80.4420 },
  "visakhapatnam": { lat: 17.6868, lon: 83.2185 },
  "chittoor": { lat: 13.2218, lon: 79.1010 },
  "anantapur": { lat: 14.6819, lon: 77.6006 },
  "kurnool": { lat: 15.8281, lon: 78.0373 },
  "nellore": { lat: 14.4426, lon: 79.9865 },
  "kadapa": { lat: 14.4673, lon: 78.8242 },
  "hyderabad": { lat: 17.4065, lon: 78.4772 },
  "rangareddy": { lat: 17.2543, lon: 78.2618 },
  "medak": { lat: 17.9000, lon: 78.1000 },
  "karimnagar": { lat: 18.4392, lon: 79.1288 },
  "warangal": { lat: 17.9689, lon: 79.5941 },
  "khammam": { lat: 17.2473, lon: 80.1514 },
  "nalgonda": { lat: 17.0575, lon: 79.2680 },
  "bangalore": { lat: 12.9716, lon: 77.5946 },
  "bangalore urban": { lat: 12.9716, lon: 77.5946 },
  "mumbai": { lat: 19.0760, lon: 72.8777 },
  "pune": { lat: 18.5204, lon: 73.8567 },
  "delhi": { lat: 28.7041, lon: 77.1025 },
  "chennai": { lat: 13.0827, lon: 80.2707 },
  "kolkata": { lat: 22.5726, lon: 88.3639 },
  "jaipur": { lat: 26.9124, lon: 75.7873 },
  "lucknow": { lat: 26.8467, lon: 80.9462 },
  "kanpur": { lat: 26.4499, lon: 80.3319 },
  "nagpur": { lat: 21.1458, lon: 79.0882 },
  "indore": { lat: 22.7196, lon: 75.8577 },
  "bhopal": { lat: 23.2599, lon: 77.4126 },
  "ahmedabad": { lat: 23.0225, lon: 72.5714 },
  "surat": { lat: 21.1702, lon: 72.8311 },
  "vadodara": { lat: 22.3072, lon: 73.1812 },
  "coimbatore": { lat: 11.0168, lon: 76.9558 },
  "madurai": { lat: 9.9252, lon: 78.1198 },
  "salem": { lat: 11.6643, lon: 78.1460 },
  "tiruchirappalli": { lat: 10.7905, lon: 78.7047 },
  "thane": { lat: 19.2183, lon: 72.9781 },
  "nashik": { lat: 19.9975, lon: 73.7898 },
  "aurangabad": { lat: 19.8762, lon: 75.3433 },
  "patna": { lat: 25.5941, lon: 85.1376 },
  "ranchi": { lat: 23.3441, lon: 85.3096 },
  "bhubaneswar": { lat: 20.2961, lon: 85.8245 },
  "cuttack": { lat: 20.4625, lon: 85.8830 },
  "guwahati": { lat: 26.1445, lon: 91.7362 },
  "ludhiana": { lat: 30.9010, lon: 75.8573 },
  "amritsar": { lat: 31.6340, lon: 74.8723 },
  "jalandhar": { lat: 31.3260, lon: 75.5762 },
  "kochi": { lat: 9.9312, lon: 76.2673 },
  "thiruvananthapuram": { lat: 8.5241, lon: 76.9366 },
  "kozhikode": { lat: 11.2588, lon: 75.7804 },
  "mysore": { lat: 12.2958, lon: 76.6394 },
  "hubli": { lat: 15.3647, lon: 75.1240 },
  "belgaum": { lat: 15.8497, lon: 74.4977 },
  "gulbarga": { lat: 17.3297, lon: 76.8343 },
  "shimoga": { lat: 13.9299, lon: 75.5681 },
  "mangalore": { lat: 12.9141, lon: 74.8560 },
  "prakasam": { lat: 15.3485, lon: 79.5603 },
  "spsr nellore": { lat: 14.4426, lon: 79.9865 },
};

async function geocodePincode(pincode: string): Promise<{ lat: number; lon: number; name: string; district?: string; state?: string } | null> {
  const cleanPin = pincode.trim();

  // 1. Try India Post API (best for Indian pincodes)
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(cleanPin)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      const district = po.District;
      const state = po.State;
      console.log(`[Pincode] India Post API: ${cleanPin} → ${po.Name}, ${district}, ${state}`);
      if (district && state) {
        // Try hardcoded coords first (most reliable)
        const key = district.toLowerCase().trim();
        if (INDIAN_DISTRICT_COORDS[key]) {
          const c = INDIAN_DISTRICT_COORDS[key];
          console.log(`[Pincode] Using hardcoded coords for ${district}: ${c.lat}, ${c.lon}`);
          return { lat: c.lat, lon: c.lon, name: po.Name || district, district, state };
        }
        // Fallback: geocode via Open-Meteo
        const geo = await geocodeLocation(district, state);
        if (geo) {
          return { lat: geo.lat, lon: geo.lon, name: po.Name || district, district, state };
        }
      }
    }
  } catch (e: any) {
    console.error(`[Pincode] India Post API error for "${cleanPin}":`, e.message);
  }

  // 2. Fallback: Open-Meteo direct pincode search
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanPin)}&count=5&language=en&format=json`, { signal: AbortSignal.timeout(10000) });
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
  } catch (e: any) {
    console.error(`[Pincode] Open-Meteo geocoding error for "${cleanPin}":`, e.message);
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

    // Use reliable Open-Meteo parameters (precipitation_probability_max is not always available)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,relative_humidity_2m,weather_code,is_day,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=3`;
    console.log(`[Weather] API URL: ${url}`);

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Weather] API error ${res.status}: ${errorText.substring(0, 200)}`);
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
      56: "Freezing drizzle", 57: "Heavy freezing drizzle",
      61: "Light rain", 63: "Moderate rain", 65: "Heavy rain",
      66: "Freezing rain", 67: "Heavy freezing rain",
      71: "Light snow", 73: "Moderate snow", 75: "Heavy snow",
      77: "Snow grains",
      80: "Light showers", 81: "Moderate showers", 82: "Heavy showers",
      85: "Snow showers", 86: "Heavy snow showers",
      95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
    };

    const condition = wmoCodes[current.weather_code] ?? "Unknown";
    // Derive rain probability from weather code + precipitation
    const precip = daily?.precipitation_sum?.[0] ?? 0;
    const code = current.weather_code ?? 0;
    let rainProb = 0;
    if (precip > 10) rainProb = 90;
    else if (precip > 5) rainProb = 70;
    else if (precip > 1) rainProb = 50;
    else if (precip > 0) rainProb = 30;
    else if ([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code)) rainProb = 60;
    else if ([71,73,75,77,85,86].includes(code)) rainProb = 50;

    console.log(`[Weather] Result: ${Math.round(current.temperature_2m)}°C, ${condition}, Humidity: ${current.relative_humidity_2m}%, Rain: ${rainProb}%`);

    return {
      temp: Math.round(current.temperature_2m),
      humidity: current.relative_humidity_2m,
      rainProb,
      condition,
      forecast: `High: ${Math.round(daily?.temperature_2m_max?.[0] ?? 0)}°C, Low: ${Math.round(daily?.temperature_2m_min?.[0] ?? 0)}°C`,
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
  let weather = null;
  try {
    weather = await fetchWeather(district, state, pincode);
  } catch (e: any) {
    console.error(`[Weather] fetchWeather error:`, e.message);
  }
  if (!weather) {
    const fallbacks: Record<string, string> = {
      english: `🌦️ *Weather for ${district}*\n\nUnable to fetch live data for your area.\n\n• Check your pincode in profile\n• Try again later\n\n_Type "menu" for more options_`,
      hindi: `🌦️ *${district} का मौसम*\n\nआपके क्षेत्र के लिए लाइव डेटा प्राप्त करने में असफल।\n\n• प्रोफ़ाइल में अपना पिनकोड जांचें\n• बाद में पुनः प्रयास करें\n\n_अधिक विकल्पों के लिए "menu" टाइप करें_`,
      telugu: `🌦️ *${district} వాతావరణం*\n\nమీ ప్రాంతం కోసం లైవ్ డేటా అందుకోలేకపోయాము.\n\n• ప్రొఫైల్‌లో మీ పిన్‌కోడ్‌ను తనిఖీ చేయండి\n• తర్వాత మళ్ళీ ప్రయత్నించండి\n\n_మరిన్ని ఎంపికల కోసం "menu" టైప్ చేయండి_`,
      kannada: `🌦️ *${district} ಹವಾಮಾನ*\n\nನಿಮ್ಮ ಪ್ರದೇಶದ ಲೈವ್ ಡೇಟಾ ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಿಲ್ಲ.\n\n• ನಿಮ್ಮ ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಪಿನ್‌ಕೋಡ್ ಪರಿಶೀಲಿಸಿ\n• ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ\n\n_ಹೆಚ್ಚಿನ ಆಯ್ಕೆಗಳಿಗಾಗಿ "menu" ಟೈಪ್ ಮಾಡಿ_`,
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
        "news", "samachar", "newspaper", "khabar", "vaartha", "vaarta",
        "farming news", "agriculture news", "daily news", "today news",
        "వార్తలు", "వార్త", "రోజువారీ వార్తలు", "వ్యవసాయ వార్తలు", "తాజా వార్తలు",
        "समाचार", "खबर", "दैनिक समाचार", "कृषि समाचार", "आज की खबर",
        "ಸುದ್ದಿ", "ವಾರ್ತೆ", "ದೈನಂದಿನ ಸುದ್ದಿ", "ಕೃಷಿ ಸುದ್ದಿ", "ಇಂದಿನ ಸುದ್ದಿ",
      ],
      intent: "daily_news",
    },
    {
      keywords: [
        "menu", "hello", "hi", "hey", "namaste", "namaskaram", "namaskara",
        "welcome", "start", "begin", "help",
        "మెనూ", "సేవలు", "హలో", "హాయి", "నమస్కారం", "శుభోదయం",
        "मेनू", "सेवाएं", "नमस्ते", "हैलो", "हाय", "शुभ प्रभात",
        "ಮೆನು", "ಸೇವೆಗಳು", "ನಮಸ್ಕಾರ", "ಹಲೋ", "ಹಾಯ್",
      ],
      intent: "greeting",
    },
    {
      keywords: [
        "language", "bhasha", "basha", "bhasa", "lugha", "locale",
        "telugu", "తెలుగు",
        "hindi", "हिन्दी", "हिंदी",
        "english", "ఆంగ్లం",
        "kannada", "ಕನ್ನಡ",
        "change language", "switch language", "language change",
        "భాష మార్చు", "భాష మార్పిడి",
        "भाषा बदलें", "भाषा परिवर्तन",
        "ಭಾಷೆ ಬದಲಾಯಿಸಿ", "ಭಾಷೆ ಮಾರ್ಪಾಡು",
      ],
      intent: "language_change",
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
// Fetch live mandi prices from Krishi Jagat
async function fetchLiveMandiPrices(state?: string | null): Promise<any[]> {
  try {
    // Try Krishi Jagat mandi page
    const res = await fetch("https://krishakjagat.org/mandi-bhav/", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract price articles from the HTML
    const prices: any[] = [];
    // Look for article patterns with commodity and price info
    const articleRegex = /<article[^>]*>[\s\S]*?<h[23][^>]*>(.*?)<\/h[23]>[\s\S]*?(?:<p[^>]*>(.*?)<\/p>)?[\s\S]*?<\/article>/gi;
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
      const title = stripHtmlTags(match[1]).trim();
      const content = stripHtmlTags(match[2] || "").trim();
      if (title && containsPriceInfo(title)) {
        prices.push({ title, content, source: "Krishi Jagat Mandi" });
      }
    }

    // Also try the main RSS for price-related articles
    if (prices.length === 0) {
      const rssRes = await fetch("https://krishakjagat.org/feed/", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (rssRes.ok) {
        const rssXml = await rssRes.text();
        const items = parseNewsRSS(rssXml, "Krishak Jagat");
        for (const item of items) {
          if (containsPriceInfo(item.title)) {
            prices.push({ title: item.title, content: item.summary, source: "Krishak Jagat" });
          }
        }
      }
    }

    return prices;
  } catch (e: any) {
    console.error("[MandiPrices] Fetch error:", e.message);
    return [];
  }
}

// Check if text contains price information (₹ symbol, price keywords, numbers)
function containsPriceInfo(text: string): boolean {
  const priceKeywords = [
    "₹", "rs", "rupees", "रुपये", "per kg", "per quintal", "per ton",
    "/kg", "/quintal", "/ton", "price", "rate", "भाव", "दर",
    "mandi", "market", "bazar", "मंडी", "बाजार",
    "buy", "sell", "purchase", "sale", "खरीद", "बिक्री",
  ];
  const lower = text.toLowerCase();
  return priceKeywords.some(kw => lower.includes(kw.toLowerCase())) && /\d/.test(text);
}

// Extract price details from article title using regex patterns
function parsePriceFromTitle(title: string): { commodity?: string; price?: string; unit?: string; mandi?: string } {
  const result: { commodity?: string; price?: string; unit?: string; mandi?: string } = {};

  // Match price patterns: ₹500, ₹ 500, 500/-, 500 rs, etc.
  const priceMatch = title.match(/[₹Rs\.\s]*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:\/\s*(kg|quintal|ton|tonne)|\s*(kg|quintal|ton|tonne)|\/-|rs|rupees|rupaye)?/i);
  if (priceMatch) {
    result.price = priceMatch[1];
    result.unit = priceMatch[2] || priceMatch[3] || "quintal";
  }

  // Extract commodity names (common Indian crops)
  const commodityKeywords = [
    "rice", "wheat", "corn", "maize", "soybean", "cotton", "sugarcane",
    "paddy", "bajra", "jowar", "ragi", "barley", "gram", "moong",
    "urad", "arhar", "tur", "lentil", "mustard", "groundnut", "peanut",
    "sunflower", "sesame", "onion", "potato", "tomato", "garlic",
    "chilli", "turmeric", "ginger", "coriander", "cumin", "cardamom",
    "black pepper", "clove", "cinnamon", "jute", "tea", "coffee",
    "apple", "mango", "banana", "orange", "grapes", "pomegranate",
    "cauliflower", "cabbage", "brinjal", "okra", "bitter gourd",
    "green gram", "red gram", "black gram", " Bengal gram",
    "ধান", "গম", "ভুট্টা", "সয়াবিন", "তুলা", "আলু", "পেঁয়াজ",
    "चावल", "गेहूं", "मक्का", "सोयाबीन", "कपास", "गन्ना",
    "బియ్యం", "గోధుమ", "మొక్కజొన్న", "సోయాబీన్", "పత్తి",
    "ಅಕ್ಕಿ", "ಗೋಧಿ", "ಮೆಕ್ಕೆಜೋಳ", "ಸೋಯಾಬೀನ್", "ಹತ್ತಿ",
  ];
  const lowerTitle = title.toLowerCase();
  for (const crop of commodityKeywords) {
    if (lowerTitle.includes(crop.toLowerCase())) {
      result.commodity = crop.charAt(0).toUpperCase() + crop.slice(1);
      break;
    }
  }

  return result;
}

// Common commodity translations for 4 languages
const COMMODITY_NAMES: Record<string, Record<string, string>> = {
  rice: { telugu: "బియ్యం", hindi: "चावल", kannada: "ಅಕ್ಕಿ", english: "Rice" },
  wheat: { telugu: "గోధుమ", hindi: "गेहूं", kannada: "ಗೋಧಿ", english: "Wheat" },
  corn: { telugu: "మొక్కజొన్న", hindi: "मक्का", kannada: "ಮೆಕ್ಕೆಜೋಳ", english: "Corn/Maize" },
  maize: { telugu: "మొక్కజొన్న", hindi: "मक्का", kannada: "ಮೆಕ್ಕೆಜೋಳ", english: "Maize" },
  soybean: { telugu: "సోయాబీన్", hindi: "सोयाबीन", kannada: "ಸೋಯಾಬೀನ್", english: "Soybean" },
  cotton: { telugu: "పత్తి", hindi: "कपास", kannada: "ಹತ್ತಿ", english: "Cotton" },
  paddy: { telugu: "వరి", hindi: "धान", kannada: "ಭತ್ತ", english: "Paddy" },
  gram: { telugu: "శనగ", hindi: "चना", kannada: "ಕಡಲೆ", english: "Gram" },
  groundnut: { telugu: "వేరుశనగ", hindi: "मूंगफली", kannada: "ಕಡಲೆಕಾಯಿ", english: "Groundnut" },
  peanut: { telugu: "వేరుశనగ", hindi: "मूंगफली", kannada: "ಕಡಲೆಕಾಯಿ", english: "Peanut" },
  onion: { telugu: "ఉల్లిపాయ", hindi: "प्याज", kannada: "ಈರುಳ್ಳಿ", english: "Onion" },
  potato: { telugu: "బంగాళాదుంప", hindi: "आलू", kannada: "ಆಲೂಗಡ್ಡೆ", english: "Potato" },
  tomato: { telugu: "టమాటో", hindi: "टमाटर", kannada: "ಟೊಮ್ಯಾಟೊ", english: "Tomato" },
  chilli: { telugu: "మిరప", hindi: "मिर्च", kannada: "ಮೆಣಸು", english: "Chilli" },
  turmeric: { telugu: "పసుపు", hindi: "हल्दी", kannada: "ಅರಿಶಿನ", english: "Turmeric" },
  garlic: { telugu: "వెల్లుల్లి", hindi: "लहसुन", kannada: "ಬೆಳ್ಳುಳ್ಳಿ", english: "Garlic" },
  bajra: { telugu: "సజ్జ", hindi: "बाजरा", kannada: "ಸಜ್ಜೆ", english: "Bajra" },
  jowar: { telugu: "జొన్న", hindi: "ज्वार", kannada: "ಜೋಳ", english: "Jowar" },
  moong: { telugu: "పెసర", hindi: "मूंग", kannada: "ಹೆಸರು", english: "Moong" },
  urad: { telugu: "మినుము", hindi: "उड़द", kannada: "ಉದ್ದು", english: "Urad" },
  arhar: { telugu: "కంది", hindi: "अरहर", kannada: "ತೊಗರಿ", english: "Arhar/Tur" },
  mustard: { telugu: "ఆవాలు", hindi: "सरसों", kannada: "ಸಾಸಿವೆ", english: "Mustard" },
  sugarcane: { telugu: "చెరకు", hindi: "गन्ना", kannada: "ಕಬ್ಬು", english: "Sugarcane" },
};

// Get commodity name in farmer's language
function getCommodityName(commodity: string, lang: string): string {
  const key = commodity.toLowerCase();
  const langKey = lang === "telugu" ? "telugu" : lang === "hindi" ? "hindi" : lang === "kannada" ? "kannada" : "english";
  return COMMODITY_NAMES[key]?.[langKey] || commodity;
}

async function formatMarketPrices(lang: string, district?: string | null, state?: string | null): Promise<string> {
  const locLabel = district ? `${district}${state ? `, ${state}` : ""}` : (state ?? "All India");
  const trendEmoji = (t: string) => t === "up" ? "⬆️" : t === "down" ? "⬇️" : "➡️";

  const headers: Record<string, string> = {
    english: `💰 *Market Prices*\n📍 ${locLabel}\n\nLatest mandi rates:\n\n`,
    hindi: `💰 *बाजार भाव*\n📍 ${locLabel}\n\nनवीनतम मंडी दर:\n\n`,
    telugu: `💰 *మార్కెట్ ధరలు*\n📍 ${locLabel}\n\nతాజా మండి ధరలు:\n\n`,
    kannada: `💰 *ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು*\n📍 ${locLabel}\n\nತಾಜಾ ಮಂಡಿ ದರಗಳು:\n\n`,
  };

  // Try 1: Fetch live mandi prices from Krishi Jagat
  const livePrices = await fetchLiveMandiPrices(state);
  if (livePrices.length > 0) {
    let body = "";
    let count = 0;
    for (const item of livePrices.slice(0, 5)) {
      const parsed = parsePriceFromTitle(item.title);
      if (parsed.commodity && parsed.price) {
        const commName = getCommodityName(parsed.commodity, lang);
        const translatedTitle = lang !== "english" ? (await translateText(item.title, lang) || item.title) : item.title;
        body += `• *${commName}* — ₹${parsed.price}/${parsed.unit || "quintal"}\n  📝 ${translatedTitle.substring(0, 80)}${translatedTitle.length > 80 ? "..." : ""}\n  📰 ${item.source}\n\n`;
        count++;
      }
    }
    if (count > 0) {
      return (headers[lang] ?? headers.english) + body;
    }
  }

  // Try 2: Query from DB
  try {
    const pool = getRawPool();
    let sqlQuery: string;
    let params: any[];
    if (state) {
      sqlQuery = `SELECT commodity, variety, mandi_name, price_per_quintal, min_price, max_price, price_trend FROM market_prices WHERE is_active = true AND LOWER(state) = LOWER(?) ORDER BY price_date DESC LIMIT 5`;
      params = [state];
    } else {
      sqlQuery = `SELECT commodity, variety, mandi_name, price_per_quintal, min_price, max_price, price_trend FROM market_prices WHERE is_active = true ORDER BY price_date DESC LIMIT 5`;
      params = [];
    }
    const [result] = await pool.execute(sqlQuery, params);
    const prices = (result as any[]) || [];

    if (prices.length > 0) {
      let body = "";
      for (const p of prices) {
        const commName = getCommodityName(p.commodity, lang);
        const variety = p.variety ? ` (${p.variety})` : "";
        const mandi = p.mandi_name ? ` @ ${p.mandi_name}` : "";
        const trend = p.price_trend ?? "stable";
        body += `• *${commName}${variety}*${mandi}\n  ₹${p.price_per_quintal.toLocaleString("en-IN")}/quintal ${trendEmoji(trend)}`;
        if (p.min_price && p.max_price) {
          body += ` (Range: ₹${p.min_price}-₹${p.max_price})`;
        }
        body += `\n`;
      }
      return (headers[lang] ?? headers.english) + body;
    }
  } catch (e: any) {
    console.error("[MarketPrices] DB error:", e.message);
  }

  // Fallback: no data
  const noData: Record<string, string> = {
    english: `💰 *Market Prices*\n📍 ${locLabel}\n\nNo price data available at the moment.\nPlease try again later.`,
    hindi: `💰 *बाजार भाव*\n📍 ${locLabel}\n\nफिलहाल मूल्य डेटा उपलब्ध नहीं।\nकृपया बाद में पुनः प्रयास करें।`,
    telugu: `💰 *మార్కెట్ ధరలు*\n📍 ${locLabel}\n\nప్రస్తుతం ధర డేటా అందుబాటులో లేదు.\nదయచేసి తర్వాత మళ్ళీ ప్రయత్నించండి.`,
    kannada: `💰 *ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು*\n📍 ${locLabel}\n\nಪ್ರಸ್ತುತ ಬೆಲೆ ಡೇಟಾ ಲಭ್ಯವಿಲ್ಲ.\nದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
  };
  return noData[lang] ?? noData.english;
}

// Fetch government schemes from DB
async function formatSchemesFromDB(lang: string, state?: string | null): Promise<string> {
  try {
    const pool = getRawPool();
    // Try with all columns (including kannada) — fallback to basic columns if migration pending
    let schemes: any[] = [];
    const tryQueries = [
      // Query 1: With all translation columns (title + description)
      state
        ? { sql: `SELECT title, title_telugu, title_hindi, title_kannada, description, description_telugu, description_hindi, description_kannada, category, benefits, eligibility FROM government_schemes WHERE is_active = true AND (state_specific IS NULL OR LOWER(state_specific) = LOWER(?)) ORDER BY created_at DESC LIMIT 5`, params: [state] }
        : { sql: `SELECT title, title_telugu, title_hindi, title_kannada, description, description_telugu, description_hindi, description_kannada, category, benefits, eligibility FROM government_schemes WHERE is_active = true ORDER BY created_at DESC LIMIT 5`, params: [] },
      // Query 2: Fallback without kannada columns
      state
        ? { sql: `SELECT title, title_telugu, title_hindi, description, description_telugu, description_hindi, category, benefits, eligibility FROM government_schemes WHERE is_active = true AND (state_specific IS NULL OR LOWER(state_specific) = LOWER(?)) ORDER BY created_at DESC LIMIT 5`, params: [state] }
        : { sql: `SELECT title, title_telugu, title_hindi, description, description_telugu, description_hindi, category, benefits, eligibility FROM government_schemes WHERE is_active = true ORDER BY created_at DESC LIMIT 5`, params: [] },
      // Query 3: Fallback with only basic columns
      state
        ? { sql: `SELECT title, description, category, benefits, eligibility FROM government_schemes WHERE is_active = true AND (state_specific IS NULL OR LOWER(state_specific) = LOWER(?)) ORDER BY created_at DESC LIMIT 5`, params: [state] }
        : { sql: `SELECT title, description, category, benefits, eligibility FROM government_schemes WHERE is_active = true ORDER BY created_at DESC LIMIT 5`, params: [] },
    ];

    for (const q of tryQueries) {
      try {
        const [result] = await pool.execute(q.sql, q.params);
        schemes = (result as any[]) || [];
        if (schemes.length > 0) break;
      } catch (colErr: any) {
        console.error(`[Schemes] Query failed: ${colErr.message} — trying simpler query...`);
      }
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
      // 1. Get title in farmer's language
      let title: string = lang === "telugu" && s.title_telugu ? s.title_telugu
        : lang === "hindi" && s.title_hindi ? s.title_hindi
        : lang === "kannada" && s.title_kannada ? s.title_kannada
        : s.title;

      // 2. Get description in farmer's language
      let desc: string = lang === "telugu" && s.description_telugu ? s.description_telugu
        : lang === "hindi" && s.description_hindi ? s.description_hindi
        : lang === "kannada" && s.description_kannada ? s.description_kannada
        : s.description;

      // 3. On-the-fly translation if DB translations are empty
      if (lang !== "english" && title === s.title) {
        const translated = await translateText(s.title, lang);
        if (translated) title = translated;
      }
      if (lang !== "english" && (!desc || desc === s.description)) {
        const src = s.description || s.title;
        const translated = await translateText(src, lang);
        if (translated) desc = translated;
      }

      const catLabel = s.category ? ` [${s.category.toUpperCase()}]` : "";
      body += `• *${title}*${catLabel}\n`;
      if (desc) body += `  📝 ${desc.substring(0, 120)}${desc.length > 120 ? "..." : ""}\n`;
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

// Fetch crop knowledge from DB using raw SQL
async function formatCropAdviceFromDB(lang: string, farmerCrop?: string | null): Promise<string> {
  try {
    const pool = getRawPool();
    // Try with all columns — fallback to simpler queries if migration pending
    let crops: any[] = [];
    const likeParam = farmerCrop ? `%${farmerCrop}%` : null;
    const whereClause = farmerCrop ? ` AND LOWER(crop_name) LIKE LOWER(?)` : ``;

    const tryQueries = [
      // Query 1: With all translation columns
      { sql: `SELECT crop_name, crop_name_telugu, crop_name_hindi, crop_name_kannada, title, content, content_telugu, content_hindi, content_kannada, category, stage FROM crop_knowledge WHERE is_active = true${whereClause} ORDER BY created_at DESC LIMIT 3`, params: farmerCrop ? [likeParam] : [] },
      // Query 2: Without kannada columns
      { sql: `SELECT crop_name, crop_name_telugu, crop_name_hindi, title, content, content_telugu, content_hindi, category, stage FROM crop_knowledge WHERE is_active = true${whereClause} ORDER BY created_at DESC LIMIT 3`, params: farmerCrop ? [likeParam] : [] },
      // Query 3: Basic columns only
      { sql: `SELECT crop_name, title, content, category, stage FROM crop_knowledge WHERE is_active = true${whereClause} ORDER BY created_at DESC LIMIT 3`, params: farmerCrop ? [likeParam] : [] },
    ];

    for (const q of tryQueries) {
      try {
        const [result] = await pool.execute(q.sql, q.params);
        crops = (result as any[]) || [];
        if (crops.length > 0) break;
      } catch (colErr: any) {
        console.error(`[CropAdvice] Query failed: ${colErr.message} — trying simpler query...`);
      }
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
      const name = lang === "telugu" && c.crop_name_telugu ? c.crop_name_telugu
        : lang === "hindi" && c.crop_name_hindi ? c.crop_name_hindi
        : lang === "kannada" && c.crop_name_kannada ? c.crop_name_kannada
        : c.crop_name;
      const content = lang === "telugu" && c.content_telugu ? c.content_telugu
        : lang === "hindi" && c.content_hindi ? c.content_hindi
        : lang === "kannada" && c.content_kannada ? c.content_kannada
        : c.content;
      body += `• *${name}*${c.stage ? ` (${c.stage})` : ""}\n`;
      if (content) body += `  💡 ${content.substring(0, 120)}${content.length > 120 ? "..." : ""}\n`;
      body += `\n`;
    }

    return (headers[lang] ?? headers.english) + body;
  } catch (e: any) {
    console.error("[CropAdvice] DB error:", e.message);
    return `💡 *Farming Advice*\n\nUnable to fetch advice. Please try again later.`;
  }
}

// ====== CROP SELECTION & ADVICE FLOW ======

// Fetch all distinct crops from DB and send as WhatsApp list
async function sendCropSelectionList(phoneNumber: string, lang: string) {
  try {
    console.log(`[CropSelection] Fetching crops for lang=${lang}`);

    // Use RAW mysql2 pool - completely bypass Drizzle ORM
    const pool = getRawPool();
    let cropArray: any[] = [];
    try {
      const [rows] = await pool.execute(
        "SELECT crop_name, crop_name_telugu, crop_name_hindi, is_active FROM crop_knowledge LIMIT 100"
      );
      cropArray = (rows as any[]) || [];
      console.log(`[CropSelection] Raw mysql2 returned ${cropArray.length} rows`);
    } catch (tableErr: any) {
      console.error(`[CropSelection] Table query failed:`, tableErr.message);
      await sendWhatsAppMessage(phoneNumber,
        `📋 *Crop Knowledge*\n\nCrop database table not found.\n\nPlease add crops via the dashboard.\n\n(Error: ${tableErr.message})`);
      return;
    }

    // Filter active and deduplicate
    const activeCrops = cropArray.filter((c: any) => c && c.is_active !== 0 && c.is_active !== false);
    const seen = new Set<string>();
    const crops = activeCrops.filter((c: any) => {
      if (!c || !c.crop_name || seen.has(c.crop_name)) return false;
      seen.add(c.crop_name);
      return true;
    });

    console.log(`[CropSelection] Found ${crops.length} unique crops`);

    if (crops.length === 0) {
      await sendWhatsAppMessage(phoneNumber,
        `📋 *Crop Knowledge*\n\nNo crops in the database yet.\n\nAdd crops via the dashboard.`);
      return;
    }

    // Use list message for crop selection (supports up to 10 items)
    const cropRows = crops.slice(0, 10).map((c: any) => {
      const name = lang === "telugu" && c.crop_name_telugu ? c.crop_name_telugu
        : lang === "hindi" && c.crop_name_hindi ? c.crop_name_hindi
        : c.crop_name;
      return {
        id: `crop_${c.crop_name.toLowerCase().replace(/\s+/g, "_")}`,
        title: name.slice(0, 24),
        description: lang === "telugu" ? `${name} పంట సలహా` : lang === "hindi" ? `${name} की सलाह` : `${name} farming advice`,
      };
    });

    const listHeader = lang === "telugu" ? `పంట జ్ఞానం` : lang === "hindi" ? `फसल ज्ञान` : `Crop Knowledge`;
    const listBody = lang === "telugu" ? `వివరణాత్మక సలహా కోసం పంటను ఎంచుకోండి:`
      : lang === "hindi" ? `विस्तृत सलाह के लिए फसल चुनें:`
      : `Select a crop for detailed advice:`;
    const listButton = lang === "telugu" ? `పంటలు చూడండి` : lang === "hindi" ? `फसलें देखें` : `View Crops`;

    const success = await sendWhatsAppList(phoneNumber, listHeader, listBody, "", listButton, [{
      title: lang === "telugu" ? `పంటల జాబితా` : lang === "hindi" ? `फसल सूची` : `Crop List`,
      rows: cropRows,
    }]);

    if (!success) {
      // Fallback to text if list fails
      const cropNames = crops.map((c: any, i: number) => `${i + 1}. ${c.crop_name}`).join("\n");
      await sendWhatsAppMessage(phoneNumber, `📋 *Crop Knowledge*\n\nType a crop name:\n\n${cropNames}`);
    }
  } catch (e: any) {
    console.error(`[CropSelection] CRITICAL ERROR:`, e.message, e.stack);
    await sendWhatsAppMessage(phoneNumber, `Crop list error: ${e.message}`);
  }
}

// Check if a text message matches a crop name in the DB
async function findCropByName(message: string): Promise<string | null> {
  try {
    const clean = message.trim().toLowerCase();
    if (clean.length < 2) return null;

    const pool = getRawPool();
    let rows: any[] = [];
    try {
      const [result] = await pool.execute(
        "SELECT crop_name FROM crop_knowledge WHERE LOWER(crop_name) = ? OR LOWER(crop_name) LIKE ? LIMIT 1",
        [clean, "%" + clean + "%"]
      );
      rows = (result as any[]) || [];
    } catch { return null; }

    if (rows.length > 0 && rows[0]?.crop_name) return rows[0].crop_name;
    return null;
  } catch (e: any) {
    console.error(`[CropMatch] Error:`, e.message);
    return null;
  }
}

// Get detailed advice for a specific crop
async function getCropAdviceByName(cropName: string, lang: string): Promise<string> {
  try {
    const cleanName = cropName.replace(/^crop_/, "").replace(/_/g, " ");

    const pool = getRawPool();
    let rows: any[] = [];
    try {
      const [result] = await pool.execute(
        "SELECT * FROM crop_knowledge WHERE LOWER(crop_name) = LOWER(?) LIMIT 1",
        [cleanName]
      );
      rows = (result as any[]) || [];
    } catch {
      return `💡 *Crop Advice*\n\nCrop database not found.\n\nAdd crops via the dashboard.`;
    }

    if (rows.length === 0) {
      return `💡 *Crop Advice*\n\nNo advice found for "${cleanName}".\n\nType "menu" to see all crops.`;
    }

    const c = rows[0];
    const name = lang === "telugu" && c.crop_name_telugu ? c.crop_name_telugu
      : lang === "hindi" && c.crop_name_hindi ? c.crop_name_hindi
      : c.crop_name;
    const title = c.title || "Farming Advice";
    const content = lang === "telugu" && c.content_telugu ? c.content_telugu
      : lang === "hindi" && c.content_hindi ? c.content_hindi
      : c.content || "No detailed content available.";

    let response = `💡 *${name}*\n`;
    response += `*${title}*\n\n`;
    response += `${content}\n\n`;

    if (c.fertilizer) response += `🌱 *Fertilizer:* ${c.fertilizer}\n`;
    if (c.pest_control) response += `🐛 *Pest Control:* ${c.pest_control}\n`;
    if (c.watering) response += `💧 *Watering:* ${c.watering}\n`;
    if (c.harvesting_tips) response += `🌾 *Harvesting:* ${c.harvesting_tips}\n`;
    if (c.season) response += `📅 *Season:* ${c.season}\n`;
    if (c.region) response += `📍 *Region:* ${c.region}\n`;

    response += `\n_Type "menu" to see all options_`;
    return response;
  } catch (e: any) {
    console.error("[CropAdvice] Error:", e.message);
    return `💡 *Crop Advice*\n\nError: ${e.message}`;
  }
}

// Fetch daily farming news from DB
async function formatNewsFromDB(lang: string): Promise<string> {
  const headers: Record<string, string> = {
    english: `📰 *Daily Farming News*\n\nLatest agriculture updates:\n\n`,
    hindi: `📰 *दैनिक कृषि समाचार*\n\nनवीनतम कृषि अपडेट:\n\n`,
    telugu: `📰 *రోజువారీ వ్యవసాయ వార్తలు*\n\nతాజా వ్యవసాయ అప్‌డేట్‌లు:\n\n`,
    kannada: `📰 *ದೈನಂದಿನ ಕೃಷಿ ಸುದ್ದಿ*\n\nತಾಜಾ ಕೃಷಿ ಅಪ್‌ಡೇಟ್‌ಗಳು:\n\n`,
  };

  // Try 1: Fetch from DB using raw SQL (avoids column-mismatch issues with Drizzle)
  try {
    const pool = getRawPool();
    const [result] = await pool.execute(
      "SELECT id, title, title_telugu, title_hindi, title_kannada, summary, summary_telugu, summary_hindi, summary_kannada, source, source_url, source_language FROM daily_news WHERE is_active = true ORDER BY fetched_at DESC LIMIT 5"
    );
    const items = (result as any[]) || [];

    if (items.length > 0) {
      return await buildNewsResponseAsync(items, lang, headers);
    }
    console.log("[News] DB empty - fetching live from RSS...");
  } catch (dbErr: any) {
    console.error("[News] DB query failed:", dbErr.message, "- fetching live from RSS...");
  }

  // Try 2: DB empty or error → fetch live from RSS, save, and return
  try {
    const liveItems = await fetchLiveNews();
    if (liveItems.length > 0) {
      // Save to DB (best effort - don't fail if save errors)
      try { await saveNewsToDB(liveItems); } catch (saveErr: any) { console.error("[News] Save error:", saveErr.message); }
      return await buildNewsResponseAsync(liveItems, lang, headers);
    }
  } catch (rssErr: any) {
    console.error("[News] RSS fetch failed:", rssErr.message);
  }

  // Fallback: no news available
  const noData: Record<string, string> = {
    english: `📰 *Daily Farming News*\n\nNo news articles available at the moment.\nPlease try again later.`,
    hindi: `📰 *दैनिक कृषि समाचार*\n\nफिलहाल कोई समाचार लेख उपलब्ध नहीं।\nकृपया बाद में पुनः प्रयास करें।`,
    telugu: `📰 *రోజువారీ వ్యవసాయ వార్తలు*\n\nప్రస్తుతం వార్తా కథనాలు అందుబాటులో లేవు.\nదయచేసి తర్వాత మళ్లీ ప్రయత్నించండి.`,
    kannada: `📰 *ದೈನಂದಿನ ಕೃಷಿ ಸುದ್ದಿ*\n\nಪ್ರಸ್ತುತ ಸುದ್ದಿ ಲೇಖನಗಳು ಲಭ್ಯವಿಲ್ಲ.\nದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
  };
  return noData[lang] ?? noData.english;
}

// Detect text language using Unicode range checks
function detectTextLanguage(text: string): "english" | "hindi" | "telugu" | "kannada" | "unknown" {
  if (/[\u0900-\u097F]/.test(text)) return "hindi";      // Devanagari
  if (/[\u0C00-\u0C7F]/.test(text)) return "telugu";      // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return "kannada";     // Kannada
  if (/[a-zA-Z]/.test(text)) return "english";             // Latin
  return "unknown";
}

// Multi-API translation with fallback — optimized for Telugu/Kannada
async function translateText(text: string, targetLang: string): Promise<string | null> {
  if (!text || text.length < 2) return null;
  const sourceLang = detectTextLanguage(text);
  const tgt = targetLang === "telugu" ? "te" : targetLang === "hindi" ? "hi" : targetLang === "kannada" ? "kn" : "en";
  const src = sourceLang === "hindi" ? "hi" : sourceLang === "telugu" ? "te" : sourceLang === "kannada" ? "kn" : "en";
  if (src === tgt) return text;

  const encoded = encodeURIComponent(text.substring(0, 400));

  // Try 1: Google Translate (free endpoint, no key)
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=${tgt}&dt=t&q=${encoded}`,
      { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0] && Array.isArray(data[0])) {
        const translated = data[0].map((s: any) => s[0]).join("");
        if (translated && translated !== text && translated.length > 0) {
          return translated;
        }
      }
    }
  } catch { /* silent fail, try next */ }

  // Try 2: MyMemory API
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${src}|${tgt}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const translated = data?.responseData?.translatedText;
      if (translated && !translated.startsWith("TRANSLATION") && translated !== text) {
        return translated;
      }
    }
  } catch { /* silent fail, try next */ }

  // Try 3: If source is not English, translate to English first, then to target
  if (src !== "en") {
    try {
      // Get English version
      const enRes = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=en&dt=t&q=${encoded}`,
        { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (enRes.ok) {
        const enData = await enRes.json();
        if (Array.isArray(enData) && enData[0] && Array.isArray(enData[0])) {
          const englishText = enData[0].map((s: any) => s[0]).join("");
          if (englishText && englishText !== text) {
            const enEncoded = encodeURIComponent(englishText.substring(0, 400));
            const tgtRes = await fetch(
              `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tgt}&dt=t&q=${enEncoded}`,
              { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } }
            );
            if (tgtRes.ok) {
              const tgtData = await tgtRes.json();
              if (Array.isArray(tgtData) && tgtData[0] && Array.isArray(tgtData[0])) {
                const final = tgtData[0].map((s: any) => s[0]).join("");
                if (final && final !== englishText && final.length > 0) return final;
              }
            }
          }
        }
      }
    } catch { /* silent fail */ }
  }

  return null;
}

// Save a translation to DB for caching
async function cacheTranslation(newsId: number, field: string, value: string): Promise<void> {
  try {
    const pool = getRawPool();
    await pool.execute(`UPDATE daily_news SET ${field} = ? WHERE id = ?`, [value, newsId]);
  } catch { /* ignore cache errors */ }
}

// Build formatted news response — with on-the-fly translation fallback
async function buildNewsResponseAsync(items: any[], lang: string, headers: Record<string, string>): Promise<string> {
  const langKey = lang === "telugu" ? "telugu" : lang === "hindi" ? "hindi" : lang === "kannada" ? "kannada" : "english";

  // Sort items: prioritize articles from sources matching farmer's language
  const sorted = [...items].sort((a, b) => {
    const aMatch = a.source_language === langKey ? 2 : a[`title_${langKey}`] ? 1 : 0;
    const bMatch = b.source_language === langKey ? 2 : b[`title_${langKey}`] ? 1 : 0;
    return bMatch - aMatch;
  });

  let body = "";
  let matchedCount = 0;

  for (const item of sorted.slice(0, 5)) {
    // Get all available versions of this article
    const baseTitle: string = item.title || "";
    const baseSummary: string = item.summary || "";
    const teTitle: string = item.title_telugu || item.titleTelugu || "";
    const hiTitle: string = item.title_hindi || item.titleHindi || "";
    const knTitle: string = item.title_kannada || item.titleKannada || "";
    const teSummary: string = item.summary_telugu || item.summaryTelugu || "";
    const hiSummary: string = item.summary_hindi || item.summaryHindi || "";
    const knSummary: string = item.summary_kannada || item.summaryKannada || "";
    const articleSourceLang: string = item.source_language || item.sourceLanguage || "";

    let title: string | null = null;
    let summary: string | null = null;

    // 1. Use DB translation for farmer's language (highest priority)
    if (langKey === "telugu" && teTitle) { title = teTitle; summary = teSummary; }
    else if (langKey === "hindi" && hiTitle) { title = hiTitle; summary = hiSummary; }
    else if (langKey === "kannada" && knTitle) { title = knTitle; summary = knSummary; }
    else if (langKey === "english") { title = baseTitle; summary = baseSummary; }

    // 2. If source language matches farmer's language, use original text
    if (!title && articleSourceLang === langKey) {
      title = baseTitle;
      summary = baseSummary;
    }

    // 3. If article source is Hindi and farmer wants Kannada/Telugu,
    //    try the Hindi→English→Target two-step translation
    if (!title && langKey !== "english") {
      // Use baseTitle (should be English) for translation source
      const sourceForTranslation = baseTitle || "";
      if (sourceForTranslation) {
        let translated = await translateText(sourceForTranslation, langKey);
        if (translated) {
          title = translated;
          // Save to DB for next time
          const dbField = langKey === "telugu" ? "title_telugu" : langKey === "hindi" ? "title_hindi" : "title_kannada";
          if (item.id) await cacheTranslation(item.id, dbField, translated);
        }
        if (baseSummary) {
          const sumTranslated = await translateText(baseSummary, langKey);
          if (sumTranslated) {
            summary = sumTranslated;
            const dbField = langKey === "telugu" ? "summary_telugu" : langKey === "hindi" ? "summary_hindi" : "summary_kannada";
            if (item.id) await cacheTranslation(item.id, dbField, sumTranslated);
          }
        }
      }
    }

    // 4. Final fallback — NEVER show Hindi to Kannada farmer or vice versa
    if (!title) {
      // Check what script baseTitle is in
      const baseLang = detectTextLanguage(baseTitle);
      if (langKey !== "english" && baseLang !== "english" && baseLang !== langKey) {
        // baseTitle is in wrong language — try to get English from source translations
        if (articleSourceLang === "hindi" && hiTitle) {
          // Translate Hindi title to farmer's language
          const viaEnglish = await translateText(hiTitle, "english");
          if (viaEnglish) {
            const toTarget = await translateText(viaEnglish, langKey);
            if (toTarget) title = toTarget;
          }
        }
        if (!title) title = "News Article"; // absolute last resort
      } else {
        title = baseTitle || "News Article";
      }
    }
    if (!summary) {
      const baseLang = detectTextLanguage(baseSummary);
      if (langKey !== "english" && baseLang !== "english" && baseLang !== langKey) {
        summary = baseSummary || "";
      } else {
        summary = baseSummary || "";
      }
    }

    if (articleSourceLang === langKey) matchedCount++;
    const sourceTag = item.source ? `📰 ${item.source}` : "";

    body += `• *${title}*\n  ${summary.substring(0, 120)}${summary.length > 120 ? "..." : ""}\n  ${sourceTag}`;
    if (item.source_url || item.sourceUrl) body += ` — ${item.source_url || item.sourceUrl || ""}`;
    body += `\n\n`;
  }

  // If no articles matched farmer's language, add a helpful note
  if (langKey !== "english" && matchedCount === 0) {
    const note = langKey === "telugu" ? "\n_మీ భాషలో వార్తల కోసం త్వరలో అప్‌డేట్ చేయబడతాయి._\n"
      : langKey === "hindi" ? "\n_आपकी भाषा में समाचार जल्द ही उपलब्ध होंगे._\n"
      : "\n_ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಸುದ್ದಿಗಳು ಶೀಘ್ರದಲ್ಲೇ ಲಭ್ಯವಾಗುತ್ತವೆ._\n";
    body += note;
  }

  return (headers[langKey] ?? headers.english) + body;
}

// Working RSS sources for agriculture news
// Each source is tagged with its native language so we know which translation column to use
const NEWS_SOURCES = [
  { url: "https://krishakjagat.org/feed/", name: "Krishak Jagat", sourceLang: "hindi" },
  { url: "https://www.farmprogress.com/rss.xml", name: "Farm Progress", sourceLang: "english" },
];

// Fetch live news from RSS sources — each tagged with its source language
async function fetchLiveNews(): Promise<any[]> {
  const allNews: any[] = [];
  const sources = NEWS_SOURCES;

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { headers: { "User-Agent": "Krishiva-Bot/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseNewsRSS(xml, src.name);
      for (const raw of items.slice(0, 5)) {
        const sourceLang = src.sourceLang; // known from RSS source config

        let englishTitle = raw.title;
        let englishSummary = raw.summary;
        let titleHindi: string | undefined;
        let titleTelugu: string | undefined;
        let titleKannada: string | undefined;
        let summaryHindi: string | undefined;
        let summaryTelugu: string | undefined;
        let summaryKannada: string | undefined;

        // Store original text in the correct language column based on source
        if (sourceLang === "telugu") {
          titleTelugu = raw.title;
          summaryTelugu = raw.summary;
          // Translate to English for the base column
          const enTitle = await translateText(raw.title, "english");
          if (enTitle) englishTitle = enTitle;
          const enSummary = await translateText(raw.summary, "english");
          if (enSummary) englishSummary = enSummary;
        } else if (sourceLang === "hindi") {
          titleHindi = raw.title;
          summaryHindi = raw.summary;
          const enTitle = await translateText(raw.title, "english");
          if (enTitle) englishTitle = enTitle;
          const enSummary = await translateText(raw.summary, "english");
          if (enSummary) englishSummary = enSummary;
        } else if (sourceLang === "kannada") {
          titleKannada = raw.title;
          summaryKannada = raw.summary;
          const enTitle = await translateText(raw.title, "english");
          if (enTitle) englishTitle = enTitle;
          const enSummary = await translateText(raw.summary, "english");
          if (enSummary) englishSummary = enSummary;
        }
        // english sources: title/summary already in English

        // Translate English to other languages (skip the source language)
        const needHi = sourceLang !== "hindi";
        const needTe = sourceLang !== "telugu";
        const needKn = sourceLang !== "kannada";

        const [tTe, tHi, tKn] = await Promise.all([
          needTe ? translateText(englishTitle, "telugu") : Promise.resolve(titleTelugu),
          needHi ? translateText(englishTitle, "hindi") : Promise.resolve(titleHindi),
          needKn ? translateText(englishTitle, "kannada") : Promise.resolve(titleKannada),
        ]);
        if (tTe) titleTelugu = tTe;
        if (tHi) titleHindi = tHi;
        if (tKn) titleKannada = tKn;

        const [sTe, sHi, sKn] = await Promise.all([
          needTe ? translateText(englishSummary, "telugu") : Promise.resolve(summaryTelugu),
          needHi ? translateText(englishSummary, "hindi") : Promise.resolve(summaryHindi),
          needKn ? translateText(englishSummary, "kannada") : Promise.resolve(summaryKannada),
        ]);
        if (sTe) summaryTelugu = sTe;
        if (sHi) summaryHindi = sHi;
        if (sKn) summaryKannada = sKn;

        allNews.push({
          title: englishTitle, summary: englishSummary,
          title_telugu: titleTelugu, title_hindi: titleHindi, title_kannada: titleKannada,
          summary_telugu: summaryTelugu, summary_hindi: summaryHindi, summary_kannada: summaryKannada,
          source: src.name, source_url: raw.source_url, sourceUrl: raw.sourceUrl,
          source_language: sourceLang,
        });
      }
    } catch (e: any) { console.error(`[News] RSS ${src.name}:`, e.message); }
  }
  return allNews;
}

// Parse RSS XML to news items
function parseNewsRSS(xml: string, source: string): any[] {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractRSSTag(itemXml, "title");
    const desc = extractRSSTag(itemXml, "description");
    const link = extractRSSTag(itemXml, "link");
    if (title) {
      items.push({
        title, summary: stripHtmlTags(desc || title).substring(0, 500),
        source, source_url: link || undefined, sourceUrl: link || undefined,
      });
    }
  }
  return items;
}

function extractRSSTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(regex);
  return m ? m[1].trim() : "";
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Save fetched news to DB (best effort) — includes translations
async function saveNewsToDB(items: any[]): Promise<void> {
  const db = getDb();
  for (const item of items) {
    try {
      await db.insert(dailyNews).values({
        title: item.title, summary: item.summary,
        titleTelugu: item.title_telugu || item.titleTelugu,
        titleHindi: item.title_hindi || item.titleHindi,
        titleKannada: item.title_kannada || item.titleKannada,
        summaryTelugu: item.summary_telugu || item.summaryTelugu,
        summaryHindi: item.summary_hindi || item.summaryHindi,
        summaryKannada: item.summary_kannada || item.summaryKannada,
        source: item.source, sourceUrl: item.source_url || item.sourceUrl,
        category: "general", fetchedAt: new Date(),
        sourceLanguage: item.source_language,
      });
    } catch (e: any) { /* ignore duplicates */ }
  }
}

async function generateAIResponse(intent: string, lang: string, district?: string | null, state?: string | null, pincode?: string | null, farmerCrop?: string | null, farmerName?: string | null): Promise<string> {
  console.log(`[generateAIResponse] START: intent=${intent}, lang=${lang}, district=${district}, state=${state}, pincode=${pincode}, crop=${farmerCrop}`);

  // Normalize intent names from button IDs
  const normalizedIntent = intent === "market_prices" ? "market_price"
    : intent === "government_schemes" ? "scheme"
    : intent === "crop_knowledge" ? "crop_advice"
    : intent;
  console.log(`[generateAIResponse] normalizedIntent=${normalizedIntent}`);

  // 1. Weather — fetch live data from Open-Meteo
  if (normalizedIntent === "weather") {
    console.log(`[generateAIResponse] Weather path: district=${district}, state=${state}`);
    if (district && state) {
      try {
        const result = await getWeatherResponse(district, state, lang, pincode);
        console.log(`[generateAIResponse] Weather result: ${result.substring(0, 80)}...`);
        return result;
      } catch (e: any) {
        console.error(`[generateAIResponse] Weather error:`, e.message);
        return `🌦️ *Weather*\n\nUnable to fetch weather. Please try again later.`;
      }
    }
    console.log(`[generateAIResponse] Weather: missing district/state, sending fallback`);
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

  // 5. Daily News — query from DB
  if (normalizedIntent === "daily_news") {
    return await formatNewsFromDB(lang);
  }

  // 6. Static responses for greeting, language_change, general
  const responses: Record<string, Record<string, string>> = {
    greeting: {
      english: `👋 *Welcome back${farmerName ? `, ${farmerName}` : ""}!*

Your Krishiva is ready to help.

Tap the menu below to get started 👇`,
      hindi: `🙏 *नमस्ते${farmerName ? ` ${farmerName}` : ""}!*

आपका Krishiva मदद के लिए तैयार है।

शुरू करने के लिए नीचे मेनू दबाएं 👇`,
      telugu: `🙏 *నమస్కారం${farmerName ? ` ${farmerName}` : ""}!*

మీ Krishiva సహాయానికి సిద్ధంగా ఉన్నాడు।

ప్రారంభించడానికి కింది మెనూను ట్యాప్ చేయండి 👇`,
      kannada: `🙏 *Krishiva ಗೆ ಸ್ವಾಗತ!*

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
      english: `🤖 *Krishiva*

I can help you with:
• 🌦️ Weather updates
• 💰 Market prices
• 📋 Government schemes
• 💡 Farming advice

Type "menu" anytime to see options!`,
      hindi: `🤖 *Krishiva*

मैं आपकी मदद कर सकता हूं:
• 🌦️ मौसम की जानकारी
• 💰 बाजार भाव
• 📋 सरकारी योजनाएं
• 💡 खेती सलाह

"menu" टाइप करें विकल्प देखने के लिए!`,
      telugu: `🤖 *Krishiva*

నేను మీకు సహాయం చేయగల విషయాలు:
• 🌦️ వాతావరణ సమాచారం
• 💰 మార్కెట్ ధరలు
• 📋 ప్రభుత్వ పథకాలు
• 💡 వ్యవసాయ సలహా

ఎప్పుడైనా "menu" టైప్ చేస్తే ఎంపికలు కనిపిస్తాయి!`,
      kannada: `🤖 *Krishiva*

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
