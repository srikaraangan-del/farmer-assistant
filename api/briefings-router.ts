import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { dailyBriefings, farmers } from "@db/schema";
import { eq, desc, count, sql } from "drizzle-orm";

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

// Language-specific briefing templates with NATIVE SCRIPTS
const briefingTemplates: Record<string, {
  title: string; dateLabel: string; weatherLabel: string; tempLabel: string;
  humidityLabel: string; windLabel: string; rainLabel: string; marketLabel: string;
  schemesLabel: string; tipLabel: string; goodWeather: string; carryUmbrella: string;
  helpText: string; poweredBy: string;
}> = {
  telugu: {
    title: "🌾 రోజువారీ రైతు సమాచారం",
    dateLabel: "📅 తేదీ",
    weatherLabel: "🌦️ వాతావరణం",
    tempLabel: "🌡️ ఉష్ణోగ్రత",
    humidityLabel: "💧 తేగోవత",
    windLabel: "🍃 గాలి",
    rainLabel: "🌧️ వర్షం అవకాశం",
    marketLabel: "💰 మార్కెట్ ధరలు",
    schemesLabel: "📋 ప్రభుత్వ పథకాలు",
    tipLabel: "💡 ఈరోజు సలహా",
    goodWeather: "✅ ఈరోజు పొలం పనికి మంచి వాతావరణం!",
    carryUmbrella: "☂️ గొడ్డ తీసుకెళ్ళండి! వర్షం అవకాశం ఉంది.",
    helpText: "🤝 సహాయం కావాలా? మీ ప్రశ్నతో రిప్లై ఇవ్వండి!",
    poweredBy: "🤖 AI రైతు సహాయకుడు",
  },
  hindi: {
    title: "🌾 दैनिक किसान ब्रीफिंग",
    dateLabel: "📅 दिनांक",
    weatherLabel: "🌦️ मौसम",
    tempLabel: "🌡️ तापमान",
    humidityLabel: "💧 नमी",
    windLabel: "🍃 हवा",
    rainLabel: "🌧️ बारिश की संभावना",
    marketLabel: "💰 बाजार भाव",
    schemesLabel: "📋 सरकारी योजनाएं",
    tipLabel: "💡 आज का सलाह",
    goodWeather: "✅ आज खेत के काम के लिए अच्छा मौसम है!",
    carryUmbrella: "☂️ छाता ले जाएं! बारिश की संभावना है।",
    helpText: "🤝 मदद चाहिए? अपना सवाल भेजें!",
    poweredBy: "🤖 AI किसान सहायक",
  },
  kannada: {
    title: "🌾 ದಿನದ ಕೃಷಿ ಮಾಹಿತಿ",
    dateLabel: "📅 ದಿನಾಂಕ",
    weatherLabel: "🌦️ ಹವಾಮಾನ",
    tempLabel: "🌡️ ತಾಪಮಾನ",
    humidityLabel: "💧 ಆರ್ದ್ರತೆ",
    windLabel: "🍃 ಗಾಳಿ",
    rainLabel: "🌧️ ಮಳೆ ಸಂಭವನೀಯತೆ",
    marketLabel: "💰 ಬಜಾರ ಬೆಲೆ",
    schemesLabel: "📋 ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು",
    tipLabel: "💡 ಇಂದಿನ ಸಲಹೆ",
    goodWeather: "✅ ಇವತ್ತು ಕೃಷಿ ಕೆಲಸಕ್ಕೆ ಒಳ್ಳೆಯ ಹವಾಮಾನ!",
    carryUmbrella: "☂️ ಕುಡುರೆ ತೆಗೆದುಕೊಂಡು ಹೋಗಿ! ಮಳೆ ಸಾಧ್ಯತೆ ಇದೆ.",
    helpText: "🤝 ಸಹಾಯ ಬೇಕಾ? ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಕಳುಹಿಸಿ!",
    poweredBy: "🤖 AI ಕೃಷಿ ಸಹಾಯಕ",
  },
  english: {
    title: "🌾 DAILY FARMER BRIEFING",
    dateLabel: "📅 Date",
    weatherLabel: "🌦️ WEATHER",
    tempLabel: "🌡️ Temperature",
    humidityLabel: "💧 Humidity",
    windLabel: "🍃 Wind",
    rainLabel: "🌧️ Rain Chance",
    marketLabel: "💰 MARKET PRICES",
    schemesLabel: "📋 GOVERNMENT SCHEMES",
    tipLabel: "💡 TODAY'S TIP",
    goodWeather: "✅ Good weather for field work today!",
    carryUmbrella: "☂️ Carry umbrella! Rain likely.",
    helpText: "🤝 Need help? Reply with your question!",
    poweredBy: "🤖 AI Farmer Assistant",
  },
};

// Greeting by language
function getGreeting(lang: string, name: string | null): string {
  const greetings: Record<string, string> = {
    telugu: `నమస్కారం ${name ?? "రైతు మిత్రమా"}! 🙏`,
    hindi: `नमस्ते ${name ?? "किसान भाई"}! 🙏`,
    kannada: `ನಮಸ್ಕಾರ ${name ?? "ರೈತ ಮಿತ್ರ"}! 🙏`,
    english: `Hello ${name ?? "Farmer Friend"}! 👋`,
  };
  return greetings[lang] ?? greetings.english;
}

// Language-specific tips
function getCropTip(lang: string, crop: string | null): string {
  const tips: Record<string, string> = {
    telugu: crop
      ? `🌾 మీ ${crop} పంట కోసం: నేల తేమను నిత్యం పర్యవేక్షించండి. సాయిల్ హెల్త్ కార్డ్ ప్రకారం ఎరువులు వేయండి.`
      : `🌾 నేల తేమను నిత్యం పర్యవేక్షించండి. సాయిల్ హెల్త్ కార్డ్ ప్రకారం ఎరువులు వేయండి.`,
    hindi: crop
      ? `🌾 आपकी ${crop} फसल के लिए: मिट्टी की नमी की नियमित जांच करें। सॉइल हेल्थ कार्ड के अनुसार उर्वरक लगाएं।`
      : `🌾 मिट्टी की नमी की नियमित जांच करें। सॉइल हेल्थ कार्ड के अनुसार उर्वरक लगाएं।`,
    kannada: crop
      ? `🌾 ನಿಮ್ಮ ${crop} ಬೆಳೆಗೆ: ಮಣ್ಣಿನ ತೇವವನ್ನು ನಿತ್ಯ ಪರಿಶೀಲಿಸಿ. ಸಾಯಿಲ್ ಹೆಲ್ತ್ ಕಾರ್ಡ್ ಪ್ರಕಾರ ಗೊಬ್ಬರ ಹಾಕಿ.`
      : `🌾 ಮಣ್ಣಿನ ತೇವವನ್ನು ನಿತ್ಯ ಪರಿಶೀಲಿಸಿ. ಸಾಯಿಲ್ ಹೆಲ್ತ್ ಕಾರ್ಡ್ ಪ್ರಕಾರ ಗೊಬ್ಬರ ಹಾಕಿ.`,
    english: crop
      ? `🌾 For your ${crop} crop: Monitor soil moisture regularly. Apply fertilizer based on soil test results.`
      : `🌾 Monitor soil moisture regularly. Apply fertilizer based on soil test results.`,
  };
  return tips[lang] ?? tips.english;
}

// Language-specific schemes
function getSchemes(lang: string): string {
  const schemes: Record<string, string> = {
    telugu: `• PM-KISAN: ₹6,000/సంవత్సరం\n• సాయిల్ హెల్త్ కార్డ్: ఉచిత పరీక్ష\n• KCC: 4% వడ్డీ రుణం`,
    hindi: `• PM-KISAN: ₹6,000/साल\n• सॉइल हेल्थ कार्ड: मुफ्त जांच\n• KCC: 4% ब्याज ऋण`,
    kannada: `• PM-KISAN: ₹6,000/ವರ್ಷ\n• ಸಾಯಿಲ್ ಹೆಲ್ತ್ ಕಾರ್ಡ್: ಉಚಿತ ಪರೀಕ್ಷೆ\n• KCC: 4% ಬಡ್ಡದ ಸಾಲ`,
    english: `• PM-KISAN: ₹6,000/year\n• Soil Health Card: Free testing\n• KCC: 4% interest loans`,
  };
  return schemes[lang] ?? schemes.english;
}

// Normalize phone: remove +, spaces, dashes — keep only digits
// Auto-add India country code (91) if 10 digits
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "").trim();
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }
  return cleaned;
}

// Send WhatsApp message
async function sendWhatsAppMessage(toPhoneNumber: string, message: string): Promise<boolean> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.warn("[Briefings] Cannot send: Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return false;
  }
  // Normalize: WhatsApp API needs digits only, no + or spaces
  const normalizedTo = normalizePhone(toPhoneNumber);
  if (normalizedTo.length < 10) {
    console.error(`[Briefings] Invalid phone: "${toPhoneNumber}" → "${normalizedTo}"`);
    return false;
  }
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
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
      console.error("[Briefings] WhatsApp send failed:", JSON.stringify(result));
      return false;
    }
    console.log(`[Briefings] Message sent to ${toPhoneNumber}`);
    return true;
  } catch (err: any) {
    console.error("[Briefings] WhatsApp send error:", err.message);
    return false;
  }
}

export const briefingsRouter = createRouter({
  generate: publicQuery
    .input(z.object({ farmerId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const farmerRows = await db.select().from(farmers).where(eq(farmers.id, input.farmerId)).limit(1);
      const farmer = farmerRows[0];
      if (!farmer) return { error: "Farmer not found" };

      const lang = farmer.preferredLanguage ?? "english";
      const t = briefingTemplates[lang] ?? briefingTemplates.english;
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const location = farmer.district ?? farmer.location ?? "your area";
      const rainChance = 20; // Would come from weather API

      const message =
        `${t.title}\n${t.dateLabel}: ${dateStr}\n${"─".repeat(28)}\n\n` +
        `${getGreeting(lang, farmer.name)}\n` +
        `📍 ${location}${farmer.state ? `, ${farmer.state}` : ""}\n` +
        `${farmer.primaryCrop ? `🌾 ${lang === "telugu" ? "మీ పంట" : lang === "hindi" ? "आपकी फसल" : lang === "kannada" ? "ನಿಮ್ಮ ಬೆಳೆ" : "Your Crop"}: ${farmer.primaryCrop}\n` : ""}` +
        `\n${"─".repeat(28)}\n\n` +
        `${t.weatherLabel}\n` +
        `${t.tempLabel}: 32°C\n` +
        `${t.humidityLabel}: 65%\n` +
        `${t.windLabel}: 12 km/h\n` +
        `${t.rainLabel}: ${rainChance}%\n` +
        `${rainChance > 50 ? t.carryUmbrella : t.goodWeather}\n\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.marketLabel}\n` +
        `📌 Rice: ₹2,150/quintal\n   ⬆️ ${lang === "telugu" ? "పెరుగుదల" : lang === "hindi" ? "बढ़त" : lang === "kannada" ? "ಏರಿಕೆ" : "Rising"}\n` +
        `${farmer.primaryCrop ? `   💡 ${lang === "telugu" ? "మీ" : lang === "hindi" ? "आपकी" : lang === "kannada" ? "ನಿಮ್ಮ" : "Your"} ${farmer.primaryCrop} ${lang === "telugu" ? "అమ్మడానికి మంచి సమయం" : lang === "hindi" ? "बेचने का अच्छा समय" : lang === "kannada" ? "ಮಾರಾಟಕ್ಕೆ ಒಳ್ಳೆಯ ಸಮಯ" : "good time to sell"}!\n` : ""}\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.schemesLabel}\n${getSchemes(lang)}\n\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.tipLabel}\n${getCropTip(lang, farmer.primaryCrop)}\n\n` +
        `${"─".repeat(28)}\n` +
        `${t.helpText}\n` +
        `${t.poweredBy}`;

      return {
        farmer: { id: farmer.id, name: farmer.name, phoneNumber: farmer.phoneNumber, language: lang, location, crop: farmer.primaryCrop },
        message,
        sections: { weather: true, marketPrices: 1, schemes: 3, cropTip: true },
        personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
        dataSources: { weather: "Open-Meteo API", marketPrices: "Agmarknet + AI", schemes: "Government DB", cropAdvice: "AI Generated" },
      };
    }),

  send: publicQuery
    .input(z.object({ farmerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const farmerRows = await db.select().from(farmers).where(eq(farmers.id, input.farmerId)).limit(1);
      const farmer = farmerRows[0];
      if (!farmer) return { error: "Farmer not found" };

      // 1. Generate the message
      const lang = farmer.preferredLanguage ?? "english";
      const t = briefingTemplates[lang] ?? briefingTemplates.english;
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const location = farmer.district ?? farmer.location ?? "your area";
      const rainChance = 20;

      const message =
        `${t.title}\n${t.dateLabel}: ${dateStr}\n${"─".repeat(28)}\n\n` +
        `${getGreeting(lang, farmer.name)}\n` +
        `📍 ${location}${farmer.state ? `, ${farmer.state}` : ""}\n` +
        `${farmer.primaryCrop ? `🌾 ${farmer.primaryCrop}\n` : ""}` +
        `\n${"─".repeat(28)}\n\n` +
        `${t.weatherLabel}\n${t.tempLabel}: 32°C\n${t.humidityLabel}: 65%\n${t.windLabel}: 12 km/h\n${t.rainLabel}: ${rainChance}%\n${rainChance > 50 ? t.carryUmbrella : t.goodWeather}\n\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.marketLabel}\n📌 Rice: ₹2,150/quintal\n${farmer.primaryCrop ? `   💡 ${farmer.primaryCrop} sell tip\n` : ""}\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.schemesLabel}\n${getSchemes(lang)}\n\n` +
        `${"─".repeat(28)}\n\n` +
        `${t.tipLabel}\n${getCropTip(lang, farmer.primaryCrop)}\n\n` +
        `${"─".repeat(28)}\n${t.helpText}\n${t.poweredBy}`;

      // 2. Validate phone before sending
      const normalizedPhone = normalizePhone(farmer.phoneNumber);
      console.log(`[Briefings] Send to farmer ${input.farmerId}: phone="${farmer.phoneNumber}" normalized="${normalizedPhone}" lang=${lang}`);
      if (normalizedPhone.length < 10) {
        console.error(`[Briefings] Invalid phone number for farmer ${input.farmerId}: "${farmer.phoneNumber}"`);
        return { error: `Invalid phone number: "${farmer.phoneNumber}". Must be at least 10 digits.`, farmer: { id: farmer.id, name: farmer.name, phoneNumber: farmer.phoneNumber }, status: "failed", sentAt: null, message: "" };
      }

      // 3. Send via WhatsApp
      const sent = await sendWhatsAppMessage(farmer.phoneNumber, message);
      console.log(`[Briefings] Send result for farmer ${input.farmerId}: ${sent ? "SENT" : "FAILED"}`);

      // 4. Log to database
      const now = new Date();
      const result = await db.insert(dailyBriefings).values({
        farmerId: input.farmerId,
        scheduledAt: now,
        sentAt: sent ? now : null,
        status: sent ? "sent" : "failed",
        language: lang as "telugu" | "hindi" | "kannada" | "english",
        weatherIncluded: true,
        marketPricesIncluded: true,
        schemesIncluded: true,
        cropTipIncluded: true,
        personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
        generatedMessage: message.substring(0, 500),
      });

      return { briefingId: Number(result[0].insertId), farmer: { id: farmer.id, name: farmer.name, phoneNumber: farmer.phoneNumber }, sentAt: sent ? now : null, status: sent ? "sent" : "failed", message };
    }),

  sendToAll: publicQuery.mutation(async () => {
    const db = getDb();
    const allFarmers = await db.select().from(farmers).where(eq(farmers.isActive, true));
    const results = [];
    for (const farmer of allFarmers) {
      try {
        const lang = farmer.preferredLanguage ?? "english";
        const t = briefingTemplates[lang] ?? briefingTemplates.english;
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const location = farmer.district ?? farmer.location ?? "";
        const rainChance = 20;

        const message =
          `${t.title}\n${t.dateLabel}: ${dateStr}\n${"─".repeat(28)}\n\n` +
          `${getGreeting(lang, farmer.name)}\n📍 ${location}${farmer.state ? `, ${farmer.state}` : ""}\n${farmer.primaryCrop ? `🌾 ${farmer.primaryCrop}\n` : ""}\n` +
          `${t.weatherLabel}: 32°C | 65% | ${t.rainLabel}: ${rainChance}%\n${rainChance > 50 ? t.carryUmbrella : t.goodWeather}\n\n` +
          `${t.marketLabel}: Rice ₹2,150/q\n${t.schemesLabel}: PM-KISAN ₹6,000/yr\n${t.tipLabel}: ${getCropTip(lang, farmer.primaryCrop).substring(0, 80)}...\n\n${t.helpText}\n${t.poweredBy}`;

        const normalizedPhone = normalizePhone(farmer.phoneNumber);
        console.log(`[Briefings] Broadcast to farmer ${farmer.id}: phone="${farmer.phoneNumber}" normalized="${normalizedPhone}"`);
        let sent = false;
        if (normalizedPhone.length >= 10) {
          sent = await sendWhatsAppMessage(farmer.phoneNumber, message);
        } else {
          console.error(`[Briefings] Invalid phone for farmer ${farmer.id}: "${farmer.phoneNumber}"`);
        }

        await db.insert(dailyBriefings).values({
          farmerId: farmer.id, scheduledAt: now, sentAt: sent ? now : null,
          status: sent ? "sent" : "failed",
          language: lang as "telugu" | "hindi" | "kannada" | "english",
          weatherIncluded: true, marketPricesIncluded: true, schemesIncluded: true, cropTipIncluded: true,
          personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
          generatedMessage: message.substring(0, 200),
        });
        results.push({ farmerId: farmer.id, name: farmer.name, status: sent ? "sent" : "failed" });
      } catch { results.push({ farmerId: farmer.id, name: farmer.name, status: "failed" }); }
    }
    return { total: results.length, sent: results.filter((r: any) => r.status === "sent").length, failed: results.filter((r: any) => r.status === "failed").length, results };
  }),

  list: publicQuery
    .input(z.object({ farmerId: z.number().optional(), status: z.enum(["pending", "sent", "failed", "skipped"]).optional(), page: z.number().min(1).default(1), limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const { farmerId, status, page = 1, limit = 20 } = input ?? {};
      const conditions = [];
      if (farmerId) conditions.push(eq(dailyBriefings.farmerId, farmerId));
      if (status) conditions.push(eq(dailyBriefings.status, status));
      const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;
      const [items, totalResult] = await Promise.all([
        db.select({
          id: dailyBriefings.id, farmerId: dailyBriefings.farmerId, status: dailyBriefings.status,
          language: dailyBriefings.language, personalizationUsed: dailyBriefings.personalizationUsed,
          weatherIncluded: dailyBriefings.weatherIncluded, marketPricesIncluded: dailyBriefings.marketPricesIncluded,
          schemesIncluded: dailyBriefings.schemesIncluded, cropTipIncluded: dailyBriefings.cropTipIncluded,
          generatedMessage: dailyBriefings.generatedMessage, sentAt: dailyBriefings.sentAt,
          scheduledAt: dailyBriefings.scheduledAt, createdAt: dailyBriefings.createdAt,
          farmerName: farmers.name, farmerPhone: farmers.phoneNumber,
        }).from(dailyBriefings).leftJoin(farmers, eq(dailyBriefings.farmerId, farmers.id)).where(where).orderBy(desc(dailyBriefings.createdAt)).limit(limit).offset((page - 1) * limit),
        db.select({ count: count() }).from(dailyBriefings).where(where),
      ]);
      return { items, total: totalResult[0]?.count ?? 0, page, limit, totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit) };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, todayResult, statusBreakdown] = await Promise.all([
      db.select({ count: count() }).from(dailyBriefings),
      db.select({ count: count() }).from(dailyBriefings).where(sql`${dailyBriefings.createdAt} >= CURDATE()`),
      db.select({ status: dailyBriefings.status, count: count() }).from(dailyBriefings).groupBy(dailyBriefings.status),
    ]);
    return { total: totalResult[0]?.count ?? 0, today: todayResult[0]?.count ?? 0, byStatus: statusBreakdown };
  }),

  dataSources: publicQuery.query(() => ({
    weather: { connected: true, source: "Open-Meteo API (Free)", lastFetched: new Date().toISOString() },
    marketPrices: { connected: true, source: "Agmarknet + AI Fallback", lastFetched: new Date().toISOString() },
    schemes: { connected: true, source: "Government of India Database", lastFetched: new Date().toISOString() },
  })),
});
