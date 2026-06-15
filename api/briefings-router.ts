import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { dailyBriefings, farmers } from "@db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import {
  fetchWeather,
  fetchMarketPrices,
  fetchSchemes,
  generateCropAdvice,
  checkDataSources,
} from "./lib/external-apis";

// ============ PERSONALIZED MESSAGE ENGINE ============

interface FarmerProfile {
  id: number;
  name: string | null;
  phoneNumber: string;
  preferredLanguage: string;
  location: string | null;
  district: string | null;
  state: string | null;
  primaryCrop: string | null;
}

function generateCardMessage(
  farmer: FarmerProfile,
  data: {
    weather: Awaited<ReturnType<typeof fetchWeather>>;
    marketPrices: Awaited<ReturnType<typeof fetchMarketPrices>>;
    schemes: ReturnType<typeof fetchSchemes>;
    cropTip: ReturnType<typeof generateCropAdvice>;
  },
  lang: string
): string {
  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Greetings
  const greetings: Record<string, string> = {
    telugu: `నమస్కారం *${farmer.name ?? "రైతు మిత్రుడా"}*! 🙏`,
    hindi: `नमस्ते *${farmer.name ?? "किसान भाई"}*! 🙏`,
    english: `Good Morning *${farmer.name ?? "Farmer Friend"}*! 🌅`,
  };

  // Advisories based on weather
  const advisories: Record<string, Record<string, string>> = {
    telugu: {
      sprayOk: "☀️ పురుగు మందు స్ప్రే చేయడానికి మంచి రోజు",
      delaySpray: "🌧️ వర్షం ఉంది. పురుగు మందు స్ప్రే వాయిదా వేయండి",
      irrigate: "💧 సేంద్రీయ పొలాలకు నీరు పంపించండి",
      hot: "🌡️ వేడిగా ఉంది. త్రాగు నీరు ఎక్కువగా తీసుకోండి",
    },
    hindi: {
      sprayOk: "☀️ कीटनाशक स्प्रे करने के लिए अच्छा दिन",
      delaySpray: "🌧️ बारिश की संभावना। स्प्रे टालें",
      irrigate: "💧 खेतों में सिंचाई करें",
      hot: "🌡️ गर्मी है। खूब पानी पिएं",
    },
    english: {
      sprayOk: "☀️ Good day for spraying pesticides",
      delaySpray: "🌧️ Rain expected. Delay pesticide spraying",
      irrigate: "💧 Irrigate fields if needed",
      hot: "🌡️ Very hot! Ensure adequate water intake",
    },
  };

  // Section titles
  const t: Record<string, Record<string, string>> = {
    telugu: {
      header: "🌾 రోజువారీ రైతు సమాచారం",
      weatherTitle: "🌦️ వాతావరణం",
      marketTitle: "💰 మార్కెట్ ధరలు",
      schemesTitle: "📋 ప్రభుత్వ పథకాలు",
      tipTitle: "💡 ఈరోజు సలహా",
      footer: "🤝 సహాయం కావాలా? మీ ప్రశ్న రిప్లై చేయండి!",
      temp: "ఉష్ణోగ్రత",
      feels: "అనుభవం",
      humidity: "తేమ",
      wind: "గాలి",
      rain: "వర్షం",
      perQuintal: "క్వింటాకు",
      trendUp: "⬆️ పెరుగుదల",
      trendDown: "⬇️ తగ్గుదల",
      trendStable: "➡️ స్థిరం",
      today: "నేటి",
      tomorrow: "రేపటి",
      dayAfter: "ఎల్లుండి",
    },
    hindi: {
      header: "🌾 दैनिक किसान जानकारी",
      weatherTitle: "🌦️ मौसम",
      marketTitle: "💰 बाजार भाव",
      schemesTitle: "📋 सरकारी योजनाएं",
      tipTitle: "💡 आज की सलाह",
      footer: "🤝 मदद चाहिए? अपना सवाल भेजें!",
      temp: "तापमान",
      feels: "अनुभव",
      humidity: "नमी",
      wind: "हवा",
      rain: "बारिश",
      perQuintal: "प्रति क्विंटल",
      trendUp: "⬆️ बढ़ता",
      trendDown: "⬇️ घटता",
      trendStable: "➡️ स्थिर",
      today: "आज",
      tomorrow: "कल",
      dayAfter: "परसों",
    },
    english: {
      header: "🌾 DAILY FARMER BRIEFING",
      weatherTitle: "🌦️ WEATHER",
      marketTitle: "💰 MARKET PRICES",
      schemesTitle: "📋 GOVERNMENT SCHEMES",
      tipTitle: "💡 TODAY'S TIP",
      footer: "🤝 Need help? Reply with your question!",
      temp: "Temperature",
      feels: "Feels like",
      humidity: "Humidity",
      wind: "Wind",
      rain: "Rain chance",
      perQuintal: "per quintal",
      trendUp: "⬆️ Rising",
      trendDown: "⬇️ Falling",
      trendStable: "➡️ Stable",
      today: "Today",
      tomorrow: "Tomorrow",
      dayAfter: "Day after",
    },
  };

  const l = t[lang] ?? t.english;
  const adv = advisories[lang] ?? advisories.english;

  let message = "";

  // ===== HEADER =====
  message += `${l.header}\n`;
  message += `📅 ${dateStr}\n`;
  message += `${"─".repeat(30)}\n\n`;
  message += `${greetings[lang] ?? greetings.english}\n`;
  if (farmer.district || farmer.location) {
    message += `📍 ${farmer.district ?? farmer.location}${farmer.state ? `, ${farmer.state}` : ""}\n`;
  }
  if (farmer.primaryCrop) {
    message += `🌾 Your Crop: *${farmer.primaryCrop}*\n`;
  }
  message += `\n${"─".repeat(30)}\n`;

  // ===== WEATHER SECTION =====
  if (data.weather) {
    const w = data.weather;
    message += `\n${l.weatherTitle}\n`;
    message += `${"─".repeat(20)}\n`;
    message += `🌡️ ${l.temp}: *${w.temperature}°C* (${l.feels} ${w.feelsLike}°C)\n`;
    message += `💧 ${l.humidity}: *${w.humidity}%*\n`;
    message += `🍃 ${l.wind}: *${w.windSpeed} km/h ${w.windDirection}*\n`;
    message += `🌧️ ${l.rain}: *${w.rainProbability}%*\n`;
    message += `☁️ ${w.weatherCondition}\n`;

    // Weather advisory
    if (w.rainProbability > 50) {
      message += `\n${adv.delaySpray}\n`;
    } else if (w.temperature > 38) {
      message += `\n${adv.hot}\n`;
    } else if (w.rainProbability < 20 && w.temperature > 25) {
      message += `\n${adv.sprayOk}\n`;
    } else {
      message += `\n${adv.irrigate}\n`;
    }

    // 3-day forecast
    if (w.forecast && w.forecast.length > 0) {
      message += `\n📅 *3-Day Forecast:*\n`;
      const labels = [l.today, l.tomorrow, l.dayAfter];
      w.forecast.forEach((f, i) => {
        const label = labels[i + 1] ?? `Day ${i + 1}`;
        message += `${label}: ${f.temp}°C, 💧${f.rainProb}% ${f.condition}\n`;
      });
    }
  }

  // ===== MARKET PRICES SECTION =====
  if (data.marketPrices.length > 0) {
    message += `\n${l.marketTitle}\n`;
    message += `${"─".repeat(20)}\n`;

    data.marketPrices.slice(0, 3).forEach((mp) => {
      const trendText =
        mp.trend === "up" ? l.trendUp : mp.trend === "down" ? l.trendDown : l.trendStable;

      message += `📌 *${mp.commodity}*${mp.variety ? ` (${mp.variety})` : ""}\n`;
      message += `   📍 ${mp.mandi}${mp.district ? `, ${mp.district}` : ""}\n`;
      message += `   💰 *₹${Math.round(mp.price).toLocaleString("en-IN")}* ${l.perQuintal}\n`;
      message += `   📊 ${trendText}`;

      // Personalized crop advice
      if (farmer.primaryCrop && mp.commodity.toLowerCase().includes(farmer.primaryCrop.toLowerCase())) {
        if (mp.trend === "up") {
          message += `\n   💡 *${lang === "telugu" ? "ధరలు పెరుగుతున్నాయి - అమ్మడానికి మంచి సమయం!" : lang === "hindi" ? "भाव बढ़ रहे हैं - बेचने का अच्छा समय!" : "Prices rising - Good time to sell!"}*`;
        } else if (mp.trend === "down") {
          message += `\n   💡 *${lang === "telugu" ? "ధరలు తగ్గుతున్నాయి - కొనుగోలు చేయడానికి మంచి సమయం!" : lang === "hindi" ? "भाव घट रहे हैं - खरीदने का अच्छा समय!" : "Prices falling - Good time to buy!"}*`;
        }
      }
      message += `\n\n`;
    });
  }

  // ===== SCHEMES SECTION =====
  if (data.schemes.length > 0) {
    message += `${l.schemesTitle}\n`;
    message += `${"─".repeat(20)}\n`;

    data.schemes.slice(0, 3).forEach((s) => {
      const title =
        lang === "telugu" && s.titleTelugu
          ? s.titleTelugu
          : lang === "hindi" && s.titleHindi
            ? s.titleHindi
            : s.title;

      message += `• *${title}*\n`;
      if (s.benefits) {
        message += `  ✅ ${s.benefits.substring(0, 80)}${s.benefits.length > 80 ? "..." : ""}\n`;
      }
    });
    message += `\n${lang === "telugu" ? "మరింత సమాచారం కోసం *SCHEME* అని రిప్లై చేయండి" : lang === "hindi" ? "और जानकारी के लिए *SCHEME* लिखें" : "Reply *SCHEME* for more info"}\n`;
  }

  // ===== CROP TIP SECTION =====
  if (data.cropTip) {
    message += `\n${l.tipTitle}\n`;
    message += `${"─".repeat(20)}\n`;

    const tipContent =
      lang === "telugu" && data.cropTip.contentTelugu
        ? data.cropTip.contentTelugu
        : lang === "hindi" && data.cropTip.contentHindi
          ? data.cropTip.contentHindi
          : data.cropTip.content;

    message += `🌿 *${data.cropTip.title}*\n`;
    message += `${tipContent.substring(0, 250)}${tipContent.length > 250 ? "..." : ""}\n`;

    if (data.cropTip.category) {
      message += `\n🏷️ Category: ${data.cropTip.category}\n`;
    }
  }

  // ===== FOOTER =====
  message += `\n${"─".repeat(30)}\n`;
  message += `${l.footer}\n`;
  message += `🤖 AI Farmer Assistant\n`;
  message += `⚡ Live data: Weather + Market + Schemes\n`;

  return message;
}

// ============ ROUTER ============

export const briefingsRouter = createRouter({
  // Generate a personalized briefing - PULLS ALL DATA FROM EXTERNAL APIs
  generate: publicQuery
    .input(z.object({ farmerId: z.number() }))
    .query(async ({ input }) => {
      // 1. Get farmer profile
      const db = getDb();
      const farmerRows = await db
        .select()
        .from(farmers)
        .where(eq(farmers.id, input.farmerId))
        .limit(1);

      const farmer = farmerRows[0];
      if (!farmer) return { error: "Farmer not found" };

      const lang = farmer.preferredLanguage ?? "english";
      const location = farmer.district ?? farmer.location ?? "Hyderabad";

      // 2. FETCH WEATHER LIVE from Open-Meteo API
      const weather = await fetchWeather(location);

      // 3. FETCH MARKET PRICES LIVE from Agmarknet
      const marketPrices = await fetchMarketPrices(
        farmer.primaryCrop ?? undefined,
        farmer.state ?? undefined
      );

      // 4. FETCH SCHEMES from government database
      const schemes = fetchSchemes(farmer.state ?? undefined, 3);

      // 5. GENERATE AI CROP ADVICE based on farmer's crop
      const cropTip = generateCropAdvice(
        farmer.primaryCrop ?? "",
        farmer.district ?? undefined,
        undefined,
        lang
      );

      // 6. Generate the visual card message
      const message = generateCardMessage(
        farmer as FarmerProfile,
        { weather, marketPrices, schemes, cropTip },
        lang
      );

      return {
        farmer: {
          id: farmer.id,
          name: farmer.name,
          phoneNumber: farmer.phoneNumber,
          language: lang,
          location: farmer.district ?? farmer.location,
          crop: farmer.primaryCrop,
        },
        message,
        sections: {
          weather: !!weather,
          marketPrices: marketPrices.length,
          schemes: schemes.length,
          cropTip: !!cropTip,
        },
        personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
        dataSources: {
          weather: weather ? "live" : "simulated",
          marketPrices: marketPrices.length > 0 ? "live/simulated" : "unavailable",
          schemes: "government_db",
          cropAdvice: cropTip ? "ai_generated" : "unavailable",
        },
      };
    }),

  // Send briefing to a single farmer
  send: publicQuery
    .input(z.object({ farmerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const farmerRows = await db
        .select()
        .from(farmers)
        .where(eq(farmers.id, input.farmerId))
        .limit(1);

      const farmer = farmerRows[0];
      if (!farmer) return { error: "Farmer not found" };

      const lang = farmer.preferredLanguage ?? "english";
      const location = farmer.district ?? farmer.location ?? "Hyderabad";

      // Pull ALL data from external sources
      const weather = await fetchWeather(location);
      const marketPrices = await fetchMarketPrices(
        farmer.primaryCrop ?? undefined,
        farmer.state ?? undefined
      );
      const schemes = fetchSchemes(farmer.state ?? undefined, 3);
      const cropTip = generateCropAdvice(farmer.primaryCrop ?? "", farmer.district ?? undefined, undefined, lang);

      const message = generateCardMessage(
        farmer as FarmerProfile,
        { weather, marketPrices, schemes, cropTip },
        lang
      );

      // Record the briefing
      const now = new Date();
      const result = await db.insert(dailyBriefings).values({
        farmerId: input.farmerId,
        scheduledAt: now,
        sentAt: now,
        status: "sent",
        language: lang as "telugu" | "hindi" | "english",
        weatherIncluded: !!weather,
        marketPricesIncluded: marketPrices.length > 0,
        schemesIncluded: schemes.length > 0,
        cropTipIncluded: !!cropTip,
        personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
        generatedMessage: message,
        weatherData: weather
          ? JSON.stringify({ temperature: weather.temperature, humidity: weather.humidity, condition: weather.weatherCondition })
          : null,
        marketData: marketPrices.length > 0 ? JSON.stringify(marketPrices.slice(0, 3)) : null,
        schemesReferenced: schemes.length > 0 ? JSON.stringify(schemes.map((s) => s.title)) : null,
        cropTipData: cropTip ? JSON.stringify({ title: cropTip.title, crop: farmer.primaryCrop }) : null,
      });

      return {
        briefingId: Number(result[0].insertId),
        farmer: { id: farmer.id, name: farmer.name, phoneNumber: farmer.phoneNumber, language: lang },
        message,
        sentAt: now,
        status: "sent",
      };
    }),

  // Broadcast to ALL active farmers
  sendToAll: publicQuery.mutation(async () => {
    const db = getDb();
    const allFarmers = await db.select().from(farmers).where(eq(farmers.isActive, true));
    const results = [];

    for (const farmer of allFarmers) {
      try {
        const lang = farmer.preferredLanguage ?? "english";
        const location = farmer.district ?? farmer.location ?? "Hyderabad";

        // Auto-pull all external data
        const weather = await fetchWeather(location);
        const marketPrices = await fetchMarketPrices(farmer.primaryCrop ?? undefined, farmer.state ?? undefined);
        const schemes = fetchSchemes(farmer.state ?? undefined, 3);
        const cropTip = generateCropAdvice(farmer.primaryCrop ?? "", farmer.district ?? undefined, undefined, lang);

        const message = generateCardMessage(
          farmer as FarmerProfile,
          { weather, marketPrices, schemes, cropTip },
          lang
        );

        const now = new Date();
        const result = await db.insert(dailyBriefings).values({
          farmerId: farmer.id,
          scheduledAt: now,
          sentAt: now,
          status: "sent",
          language: lang as "telugu" | "hindi" | "english",
          weatherIncluded: !!weather,
          marketPricesIncluded: marketPrices.length > 0,
          schemesIncluded: schemes.length > 0,
          cropTipIncluded: !!cropTip,
          personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
          generatedMessage: message,
        });

        results.push({ farmerId: farmer.id, briefingId: Number(result[0].insertId), name: farmer.name, status: "sent" });
      } catch (err: any) {
        results.push({ farmerId: farmer.id, name: farmer.name, status: "failed", error: err.message });
      }
    }

    return {
      total: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
  }),

  // List briefing history
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
          id: dailyBriefings.id,
          farmerId: dailyBriefings.farmerId,
          status: dailyBriefings.status,
          language: dailyBriefings.language,
          personalizationUsed: dailyBriefings.personalizationUsed,
          weatherIncluded: dailyBriefings.weatherIncluded,
          marketPricesIncluded: dailyBriefings.marketPricesIncluded,
          schemesIncluded: dailyBriefings.schemesIncluded,
          cropTipIncluded: dailyBriefings.cropTipIncluded,
          generatedMessage: dailyBriefings.generatedMessage,
          sentAt: dailyBriefings.sentAt,
          scheduledAt: dailyBriefings.scheduledAt,
          createdAt: dailyBriefings.createdAt,
          farmerName: farmers.name,
          farmerPhone: farmers.phoneNumber,
        }).from(dailyBriefings).leftJoin(farmers, eq(dailyBriefings.farmerId, farmers.id)).where(where).orderBy(desc(dailyBriefings.createdAt)).limit(limit).offset((page - 1) * limit),
        db.select({ count: count() }).from(dailyBriefings).where(where),
      ]);

      return { items, total: totalResult[0]?.count ?? 0, page, limit, totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit) };
    }),

  // Stats
  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, todayResult, statusBreakdown] = await Promise.all([
      db.select({ count: count() }).from(dailyBriefings),
      db.select({ count: count() }).from(dailyBriefings).where(sql`${dailyBriefings.createdAt} >= CURDATE()`),
      db.select({ status: dailyBriefings.status, count: count() }).from(dailyBriefings).groupBy(dailyBriefings.status),
    ]);
    return { total: totalResult[0]?.count ?? 0, today: todayResult[0]?.count ?? 0, byStatus: statusBreakdown };
  }),

  // Check external data source status
  dataSources: publicQuery.query(async () => {
    return checkDataSources();
  }),
});
