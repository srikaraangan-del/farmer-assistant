import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { dailyBriefings, farmers, marketPrices, governmentSchemes, weatherCache, cropKnowledge } from "@db/schema";
import { eq, and, desc, count, sql, like } from "drizzle-orm";

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

interface BriefingData {
  weather: typeof weatherCache.$inferSelect | null;
  marketPrices: (typeof marketPrices.$inferSelect)[];
  schemes: (typeof governmentSchemes.$inferSelect)[];
  cropTip: typeof cropKnowledge.$inferSelect | null;
}

function generateCardMessage(
  farmer: FarmerProfile,
  data: BriefingData,
  lang: string
): string {
  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Greetings in different languages
  const greetings: Record<string, string> = {
    telugu: `నమస్కారం *${farmer.name ?? "రైతు మిత్రుడా"}*!`,
    hindi: `नमस्ते *${farmer.name ?? "किसान भाई"}*!`,
    english: `Hello *${farmer.name ?? "Farmer Friend"}*!`,
  };

  const sections: Record<string, Record<string, string>> = {
    telugu: {
      weatherTitle: "🌦️ వాతావరణం",
      marketTitle: "💰 మార్కెట్ ధరలు",
      schemesTitle: "📋 ప్రభుత్వ పథకాలు",
      tipTitle: "💡 వ్యవసాయ సలహా",
      helpText: "🤝 సహాయం కావాలా? మీ ప్రశ్న రిప్లై చేయండి!",
      locationLabel: "📍 ప్రాంతం",
      cropLabel: "🌾 పంట",
      tempLabel: "ఉష్ణోగ్రత",
      humidityLabel: "తేమ",
      windLabel: "గాలి",
      rainLabel: "వర్షం",
      perQuintal: "క్వింటాకు",
      trendUp: "⬆️ పెరుగుదల",
      trendDown: "⬇️ తగ్గుదల",
      trendStable: "➡️ స్థిరం",
      sellAdvice: "ధరలు పెరుగుతున్నాయి. అమ్మడానికి మంచి సమయం!",
      holdAdvice: "ధరలు స్థిరంగా ఉన్నాయి. మరింత నిరీక్షించండి.",
      buyAdvice: "ధరలు తగ్గుతున్నాయి. కొనుగోలు చేయడానికి మంచి సమయం!",
    },
    hindi: {
      weatherTitle: "🌦️ मौसम",
      marketTitle: "💰 बाजार भाव",
      schemesTitle: "📋 सरकारी योजनाएं",
      tipTitle: "💡 खेती की सलाह",
      helpText: "🤝 मदद चाहिए? अपना सवाल भेजें!",
      locationLabel: "📍 स्थान",
      cropLabel: "🌾 फसल",
      tempLabel: "तापमान",
      humidityLabel: "नमी",
      windLabel: "हवा",
      rainLabel: "बारिश",
      perQuintal: "प्रति क्विंटल",
      trendUp: "⬆️ बढ़ता",
      trendDown: "⬇️ घटता",
      trendStable: "➡️ स्थिर",
      sellAdvice: "भाव बढ़ रहे हैं। बेचने का अच्छा समय!",
      holdAdvice: "भाव स्थिर हैं। और इंतजार करें।",
      buyAdvice: "भाव घट रहे हैं। खरीदने का अच्छा समय!",
    },
    english: {
      weatherTitle: "🌦️ WEATHER",
      marketTitle: "💰 MARKET PRICES",
      schemesTitle: "📋 GOVERNMENT SCHEMES",
      tipTitle: "💡 FARMING TIP",
      helpText: "🤝 Need help? Reply with your question!",
      locationLabel: "📍 Location",
      cropLabel: "🌾 Your Crop",
      tempLabel: "Temperature",
      humidityLabel: "Humidity",
      windLabel: "Wind",
      rainLabel: "Rain",
      perQuintal: "per quintal",
      trendUp: "⬆️ Rising",
      trendDown: "⬇️ Falling",
      trendStable: "➡️ Stable",
      sellAdvice: "Prices rising. Good time to sell!",
      holdAdvice: "Prices stable. Wait for better rates.",
      buyAdvice: "Prices falling. Good time to buy!",
    },
  };

  const t = sections[lang] ?? sections.english;

  let message = "";

  // ===== HEADER =====
  message += `🌤️ *DAILY FARMER BRIEFING*\n`;
  message += `${dateStr}\n`;
  message += `${"─".repeat(30)}\n\n`;
  message += `${greetings[lang] ?? greetings.english}\n\n`;
  message += `${t.locationLabel}: ${farmer.district ?? farmer.location ?? "Your area"}${farmer.state ? `, ${farmer.state}` : ""}\n`;
  if (farmer.primaryCrop) {
    message += `${t.cropLabel}: ${farmer.primaryCrop}\n`;
  }
  message += `\n${"─".repeat(30)}\n`;

  // ===== WEATHER SECTION =====
  if (data.weather) {
    const w = data.weather;
    message += `\n${t.weatherTitle}\n`;
    message += `${"─".repeat(20)}\n`;
    message += `🌡️ ${t.tempLabel}: *${w.temperature}°C* (feels like ${w.feelsLike ?? w.temperature}°C)\n`;
    message += `💧 ${t.humidityLabel}: *${w.humidity}%*\n`;
    message += `🍃 ${t.windLabel}: *${w.windSpeed} km/h*\n`;
    message += `🌧️ ${t.rainLabel}: *${w.rainProbability}%*\n`;
    message += `☁️ ${w.weatherCondition}\n`;

    // Smart advice based on weather
    if ((w.rainProbability ?? 0) > 50) {
      message += `\n⚠️ *High rain expected!* Avoid spraying pesticides today.\n`;
    } else if ((w.temperature ?? 0) > 38) {
      message += `\n⚠️ *Very hot!* Ensure adequate irrigation.\n`;
    } else {
      message += `\n✅ Good weather for field work!\n`;
    }
  }

  // ===== MARKET PRICES SECTION =====
  if (data.marketPrices.length > 0) {
    message += `\n${t.marketTitle}\n`;
    message += `${"─".repeat(20)}\n`;

    data.marketPrices.slice(0, 3).forEach((mp) => {
      const trendText =
        mp.priceTrend === "up"
          ? t.trendUp
          : mp.priceTrend === "down"
            ? t.trendDown
            : t.trendStable;

      message += `📌 *${mp.commodity}*${mp.variety ? ` (${mp.variety})` : ""}\n`;
      message += `   ${mp.mandiName}: *₹${Math.round(mp.pricePerQuintal).toLocaleString("en-IN")}* ${t.perQuintal}\n`;
      message += `   ${trendText}\n`;

      // Personalized advice for farmer's crop
      if (farmer.primaryCrop && mp.commodity.toLowerCase().includes(farmer.primaryCrop.toLowerCase())) {
        const advice =
          mp.priceTrend === "up"
            ? t.sellAdvice
            : mp.priceTrend === "down"
              ? t.buyAdvice
              : t.holdAdvice;
        message += `   💡 *${advice}*\n`;
      }
      message += `\n`;
    });
  }

  // ===== SCHEMES SECTION =====
  if (data.schemes.length > 0) {
    message += `${t.schemesTitle}\n`;
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
        message += `  ${s.benefits.substring(0, 80)}${s.benefits.length > 80 ? "..." : ""}\n`;
      }
    });
    message += `\nReply *SCHEME* for more details\n`;
  }

  // ===== CROP TIP SECTION =====
  if (data.cropTip) {
    message += `\n${t.tipTitle}\n`;
    message += `${"─".repeat(20)}\n`;

    const tipContent =
      lang === "telugu" && data.cropTip.contentTelugu
        ? data.cropTip.contentTelugu
        : lang === "hindi" && data.cropTip.contentHindi
          ? data.cropTip.contentHindi
          : data.cropTip.content;

    message += `🌿 *${data.cropTip.title}*\n`;
    message += `${tipContent.substring(0, 200)}${tipContent.length > 200 ? "..." : ""}\n`;
    message += `\nReply *TIP* for more advice\n`;
  } else if (farmer.primaryCrop) {
    // Generic tip if no specific tip found
    message += `\n${t.tipTitle}\n`;
    message += `${"─".repeat(20)}\n`;
    message += `🌿 General tips for *${farmer.primaryCrop}*:\n`;
    message += `• Monitor soil moisture regularly\n`;
    message += `• Watch for pest signs in early stages\n`;
    message += `• Apply fertilizer based on soil test\n`;
  }

  // ===== FOOTER =====
  message += `\n${"─".repeat(30)}\n`;
  message += `${t.helpText}\n`;
  message += `Powered by AI Farmer Assistant 🤖\n`;

  return message;
}

// ============ ROUTER ============

export const briefingsRouter = createRouter({
  // Generate a personalized briefing for a farmer
  generate: publicQuery
    .input(
      z.object({
        farmerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();

      // 1. Get farmer profile
      const farmerRows = await db
        .select()
        .from(farmers)
        .where(eq(farmers.id, input.farmerId))
        .limit(1);

      const farmer = farmerRows[0];
      if (!farmer) {
        return { error: "Farmer not found" };
      }

      const lang = farmer.preferredLanguage ?? "english";

      // 2. Get weather for farmer's location
      const weatherRows = farmer.district
        ? await db
            .select()
            .from(weatherCache)
            .where(
              and(
                eq(weatherCache.district, farmer.district),
                sql`${weatherCache.expiresAt} > NOW()`,
                sql`${weatherCache.forecastDays} = 0`
              )
            )
            .orderBy(desc(weatherCache.fetchedAt))
            .limit(1)
        : [];

      // 3. Get market prices
      const crop = farmer.primaryCrop;
      const state = farmer.state;

      let priceRows: (typeof marketPrices.$inferSelect)[] = [];
      if (crop) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(
            and(
              like(marketPrices.commodity, `%${crop}%`),
              eq(marketPrices.isActive, true)
            )
          )
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }

      // If no crop-specific prices, get state-level prices
      if (priceRows.length === 0 && state) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(
            and(
              like(marketPrices.state, `%${state}%`),
              eq(marketPrices.isActive, true)
            )
          )
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }

      // Fallback: get any recent prices
      if (priceRows.length === 0) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(eq(marketPrices.isActive, true))
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }

      // 4. Get relevant government schemes
      const schemeRows = await db
        .select()
        .from(governmentSchemes)
        .where(
          and(
            farmer.state
              ? sql`(${governmentSchemes.stateSpecific} IS NULL OR ${governmentSchemes.stateSpecific} LIKE ${`%${farmer.state}%`})`
              : sql`1=1`,
            eq(governmentSchemes.isActive, true)
          )
        )
        .orderBy(desc(governmentSchemes.createdAt))
        .limit(3);

      // 5. Get crop-specific tip
      let tipRow: (typeof cropKnowledge.$inferSelect) | null = null;
      if (crop) {
        const tips = await db
          .select()
          .from(cropKnowledge)
          .where(
            and(
              like(cropKnowledge.cropName, `%${crop}%`),
              eq(cropKnowledge.isActive, true)
            )
          )
          .orderBy(desc(cropKnowledge.viewCount))
          .limit(1);
        tipRow = tips[0] ?? null;
      }

      // 6. Generate the card message
      const briefingData: BriefingData = {
        weather: weatherRows[0] ?? null,
        marketPrices: priceRows,
        schemes: schemeRows,
        cropTip: tipRow,
      };

      const message = generateCardMessage(
        farmer as FarmerProfile,
        briefingData,
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
          weather: !!briefingData.weather,
          marketPrices: briefingData.marketPrices.length,
          schemes: briefingData.schemes.length,
          cropTip: !!briefingData.cropTip,
        },
        personalizationUsed: !!(crop || farmer.district || farmer.state),
      };
    }),

  // Send the briefing (creates a record + simulates WhatsApp send)
  send: publicQuery
    .input(
      z.object({
        farmerId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Get farmer
      const farmerRows = await db
        .select()
        .from(farmers)
        .where(eq(farmers.id, input.farmerId))
        .limit(1);

      const farmer = farmerRows[0];
      if (!farmer) {
        return { error: "Farmer not found" };
      }

      const lang = farmer.preferredLanguage ?? "english";

      // Get all data (reuse generate logic inline for mutation)
      const weatherRows = farmer.district
        ? await db
            .select()
            .from(weatherCache)
            .where(
              and(
                eq(weatherCache.district, farmer.district),
                sql`${weatherCache.expiresAt} > NOW()`,
                sql`${weatherCache.forecastDays} = 0`
              )
            )
            .orderBy(desc(weatherCache.fetchedAt))
            .limit(1)
        : [];

      let priceRows: (typeof marketPrices.$inferSelect)[] = [];
      if (farmer.primaryCrop) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(
            and(
              like(marketPrices.commodity, `%${farmer.primaryCrop}%`),
              eq(marketPrices.isActive, true)
            )
          )
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }
      if (priceRows.length === 0 && farmer.state) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(
            and(
              like(marketPrices.state, `%${farmer.state}%`),
              eq(marketPrices.isActive, true)
            )
          )
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }
      if (priceRows.length === 0) {
        priceRows = await db
          .select()
          .from(marketPrices)
          .where(eq(marketPrices.isActive, true))
          .orderBy(desc(marketPrices.priceDate))
          .limit(3);
      }

      const schemeRows = await db
        .select()
        .from(governmentSchemes)
        .where(
          and(
            farmer.state
              ? sql`(${governmentSchemes.stateSpecific} IS NULL OR ${governmentSchemes.stateSpecific} LIKE ${`%${farmer.state}%`})`
              : sql`1=1`,
            eq(governmentSchemes.isActive, true)
          )
        )
        .orderBy(desc(governmentSchemes.createdAt))
        .limit(3);

      let tipRow: (typeof cropKnowledge.$inferSelect) | null = null;
      if (farmer.primaryCrop) {
        const tips = await db
          .select()
          .from(cropKnowledge)
          .where(
            and(
              like(cropKnowledge.cropName, `%${farmer.primaryCrop}%`),
              eq(cropKnowledge.isActive, true)
            )
          )
          .orderBy(desc(cropKnowledge.viewCount))
          .limit(1);
        tipRow = tips[0] ?? null;
      }

      const briefingData: BriefingData = {
        weather: weatherRows[0] ?? null,
        marketPrices: priceRows,
        schemes: schemeRows,
        cropTip: tipRow,
      };

      const message = generateCardMessage(
        farmer as FarmerProfile,
        briefingData,
        lang
      );

      // Create the briefing record
      const now = new Date();
      const scheduledAt = new Date(now);
      scheduledAt.setHours(8, 0, 0, 0);
      if (scheduledAt < now) scheduledAt.setDate(scheduledAt.getDate() + 1);

      const result = await db.insert(dailyBriefings).values({
        farmerId: input.farmerId,
        scheduledAt,
        sentAt: now,
        status: "sent",
        language: lang as "telugu" | "hindi" | "english",
        weatherIncluded: !!briefingData.weather,
        marketPricesIncluded: priceRows.length > 0,
        schemesIncluded: schemeRows.length > 0,
        cropTipIncluded: !!tipRow,
        personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
        generatedMessage: message,
        weatherData: briefingData.weather
          ? JSON.stringify({
              temperature: briefingData.weather.temperature,
              humidity: briefingData.weather.humidity,
              condition: briefingData.weather.weatherCondition,
            })
          : null,
        marketData: priceRows.length > 0 ? JSON.stringify(priceRows.map((p) => ({
          commodity: p.commodity,
          price: p.pricePerQuintal,
          mandi: p.mandiName,
        }))) : null,
        schemesReferenced: schemeRows.length > 0 ? JSON.stringify(schemeRows.map((s) => s.id)) : null,
        cropTipData: tipRow
          ? JSON.stringify({ title: tipRow.title, crop: tipRow.cropName })
          : null,
      });

      return {
        briefingId: Number(result[0].insertId),
        farmer: {
          id: farmer.id,
          name: farmer.name,
          phoneNumber: farmer.phoneNumber,
          language: lang,
        },
        message,
        sentAt: now,
        status: "sent",
      };
    }),

  // Send to ALL active farmers (bulk broadcast)
  sendToAll: publicQuery.mutation(async () => {
    const db = getDb();

    const allFarmers = await db
      .select()
      .from(farmers)
      .where(eq(farmers.isActive, true));

    const results = [];
    for (const farmer of allFarmers) {
      try {
        // Call the send mutation logic inline
        const lang = farmer.preferredLanguage ?? "english";
        const weatherRows = farmer.district
          ? await db
              .select()
              .from(weatherCache)
              .where(
                and(
                  eq(weatherCache.district, farmer.district),
                  sql`${weatherCache.expiresAt} > NOW()`,
                  sql`${weatherCache.forecastDays} = 0`
                )
              )
              .orderBy(desc(weatherCache.fetchedAt))
              .limit(1)
          : [];

        let priceRows: (typeof marketPrices.$inferSelect)[] = [];
        if (farmer.primaryCrop) {
          priceRows = await db
            .select()
            .from(marketPrices)
            .where(
              and(
                like(marketPrices.commodity, `%${farmer.primaryCrop}%`),
                eq(marketPrices.isActive, true)
              )
            )
            .orderBy(desc(marketPrices.priceDate))
            .limit(3);
        }
        if (priceRows.length === 0 && farmer.state) {
          priceRows = await db
            .select()
            .from(marketPrices)
            .where(
              and(
                like(marketPrices.state, `%${farmer.state}%`),
                eq(marketPrices.isActive, true)
              )
            )
            .orderBy(desc(marketPrices.priceDate))
            .limit(3);
        }
        if (priceRows.length === 0) {
          priceRows = await db
            .select()
            .from(marketPrices)
            .where(eq(marketPrices.isActive, true))
            .orderBy(desc(marketPrices.priceDate))
            .limit(3);
        }

        const schemeRows = await db
          .select()
          .from(governmentSchemes)
          .where(
            and(
              farmer.state
                ? sql`(${governmentSchemes.stateSpecific} IS NULL OR ${governmentSchemes.stateSpecific} LIKE ${`%${farmer.state}%`})`
                : sql`1=1`,
              eq(governmentSchemes.isActive, true)
            )
          )
          .orderBy(desc(governmentSchemes.createdAt))
          .limit(3);

        let tipRow: (typeof cropKnowledge.$inferSelect) | null = null;
        if (farmer.primaryCrop) {
          const tips = await db
            .select()
            .from(cropKnowledge)
            .where(
              and(
                like(cropKnowledge.cropName, `%${farmer.primaryCrop}%`),
                eq(cropKnowledge.isActive, true)
              )
            )
            .orderBy(desc(cropKnowledge.viewCount))
            .limit(1);
          tipRow = tips[0] ?? null;
        }

        const briefingData: BriefingData = {
          weather: weatherRows[0] ?? null,
          marketPrices: priceRows,
          schemes: schemeRows,
          cropTip: tipRow,
        };

        const message = generateCardMessage(
          farmer as FarmerProfile,
          briefingData,
          lang
        );

        const now = new Date();
        const result = await db.insert(dailyBriefings).values({
          farmerId: farmer.id,
          scheduledAt: now,
          sentAt: now,
          status: "sent",
          language: lang as "telugu" | "hindi" | "english",
          weatherIncluded: !!briefingData.weather,
          marketPricesIncluded: priceRows.length > 0,
          schemesIncluded: schemeRows.length > 0,
          cropTipIncluded: !!tipRow,
          personalizationUsed: !!(farmer.primaryCrop || farmer.district || farmer.state),
          generatedMessage: message,
        });

        results.push({
          farmerId: farmer.id,
          briefingId: Number(result[0].insertId),
          name: farmer.name,
          status: "sent",
        });
      } catch (err: any) {
        results.push({
          farmerId: farmer.id,
          name: farmer.name,
          status: "failed",
          error: err.message,
        });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return { total: results.length, sent, failed, results };
  }),

  // List briefing history
  list: publicQuery
    .input(
      z
        .object({
          farmerId: z.number().optional(),
          status: z.enum(["pending", "sent", "failed", "skipped"]).optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { farmerId, status, page = 1, limit = 20 } = input ?? {};

      const conditions = [];
      if (farmerId) conditions.push(eq(dailyBriefings.farmerId, farmerId));
      if (status) conditions.push(eq(dailyBriefings.status, status));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select({
            id: dailyBriefings.id,
            farmerId: dailyBriefings.farmerId,
            status: dailyBriefings.status,
            language: dailyBriefings.language,
            personalizationUsed: dailyBriefings.personalizationUsed,
            generatedMessage: dailyBriefings.generatedMessage,
            sentAt: dailyBriefings.sentAt,
            scheduledAt: dailyBriefings.scheduledAt,
            createdAt: dailyBriefings.createdAt,
            farmerName: farmers.name,
            farmerPhone: farmers.phoneNumber,
          })
          .from(dailyBriefings)
          .leftJoin(farmers, eq(dailyBriefings.farmerId, farmers.id))
          .where(where)
          .orderBy(desc(dailyBriefings.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(dailyBriefings).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      };
    }),

  // Stats
  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, todayResult, statusBreakdown] = await Promise.all([
      db.select({ count: count() }).from(dailyBriefings),
      db
        .select({ count: count() })
        .from(dailyBriefings)
        .where(sql`${dailyBriefings.createdAt} >= CURDATE()`),
      db
        .select({
          status: dailyBriefings.status,
          count: count(),
        })
        .from(dailyBriefings)
        .groupBy(dailyBriefings.status),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      today: todayResult[0]?.count ?? 0,
      byStatus: statusBreakdown,
    };
  }),
});
