import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { farmers, messages, conversations, analyticsEvents, marketPrices, governmentSchemes, weatherCache } from "@db/schema";
import { count, sql, desc, eq } from "drizzle-orm";

export const analyticsRouter = createRouter({
  dashboard: publicQuery.query(async () => {
    const db = getDb();
    const [
      totalFarmers,
      activeFarmers,
      totalMessages,
      todayMessages,
      totalConversations,
      activeConversations,
      todayConversations,
      marketPricesCount,
      schemesCount,
      weatherLocations,
    ] = await Promise.all([
      db.select({ count: count() }).from(farmers),
      db
        .select({ count: count() })
        .from(farmers)
        .where(sql`${farmers.isActive} = true`),
      db.select({ count: count() }).from(messages),
      db
        .select({ count: count() })
        .from(messages)
        .where(sql`${messages.createdAt} >= CURDATE()`),
      db.select({ count: count() }).from(conversations),
      db
        .select({ count: count() })
        .from(conversations)
        .where(sql`${conversations.status} = 'active'`),
      db
        .select({ count: count() })
        .from(conversations)
        .where(sql`${conversations.createdAt} >= CURDATE()`),
      db.select({ count: count() }).from(marketPrices),
      db
        .select({ count: count() })
        .from(governmentSchemes)
        .where(sql`${governmentSchemes.isActive} = true`),
      // Count both cached weather locations AND unique farmer pincodes
      db.select({ count: sql<number>`COUNT(DISTINCT ${farmers.pincode})` })
        .from(farmers)
        .where(sql`${farmers.pincode} IS NOT NULL AND ${farmers.pincode} != ''`),
    ]);

    return {
      farmers: {
        total: totalFarmers[0]?.count ?? 0,
        active: activeFarmers[0]?.count ?? 0,
      },
      messages: {
        total: totalMessages[0]?.count ?? 0,
        today: todayMessages[0]?.count ?? 0,
      },
      conversations: {
        total: totalConversations[0]?.count ?? 0,
        active: activeConversations[0]?.count ?? 0,
        today: todayConversations[0]?.count ?? 0,
      },
      marketPrices: marketPricesCount[0]?.count ?? 0,
      schemes: schemesCount[0]?.count ?? 0,
      weatherLocations: weatherLocations.length,
    };
  }),

  dailyActivity: publicQuery
    .input(z.object({ days: z.number().default(7) }))
    .query(async ({ input }) => {
      const db = getDb();
      const { days } = input;

      const messageActivity = await db
        .select({
          date: sql<string>`DATE(${messages.createdAt})`,
          count: count(),
        })
        .from(messages)
        .where(
          sql`${messages.createdAt} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`
        )
        .groupBy(sql`DATE(${messages.createdAt})`)
        .orderBy(sql`DATE(${messages.createdAt})`);

      const conversationActivity = await db
        .select({
          date: sql<string>`DATE(${conversations.createdAt})`,
          count: count(),
        })
        .from(conversations)
        .where(
          sql`${conversations.createdAt} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`
        )
        .groupBy(sql`DATE(${conversations.createdAt})`)
        .orderBy(sql`DATE(${conversations.createdAt})`);

      const farmerSignups = await db
        .select({
          date: sql<string>`DATE(${farmers.createdAt})`,
          count: count(),
        })
        .from(farmers)
        .where(
          sql`${farmers.createdAt} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`
        )
        .groupBy(sql`DATE(${farmers.createdAt})`)
        .orderBy(sql`DATE(${farmers.createdAt})`);

      return {
        messages: messageActivity,
        conversations: conversationActivity,
        farmerSignups,
      };
    }),

  topIntents: publicQuery
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          intent: messages.intentDetected,
          count: count(),
        })
        .from(messages)
        .where(sql`${messages.intentDetected} IS NOT NULL`)
        .groupBy(messages.intentDetected)
        .orderBy(desc(count()))
        .limit(input.limit);
    }),

  languageDistribution: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select({
        language: farmers.preferredLanguage,
        count: count(),
      })
      .from(farmers)
      .groupBy(farmers.preferredLanguage);
  }),

  messageTypes: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select({
        contentType: messages.contentType,
        count: count(),
      })
      .from(messages)
      .groupBy(messages.contentType);
  }),

  recentActivity: publicQuery
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: messages.id,
          senderType: messages.senderType,
          contentType: messages.contentType,
          content: messages.content,
          intentDetected: messages.intentDetected,
          createdAt: messages.createdAt,
          farmerName: farmers.name,
          farmerPhone: farmers.phoneNumber,
        })
        .from(messages)
        .leftJoin(farmers, eq(farmers.id, messages.farmerId))
        .orderBy(desc(messages.createdAt))
        .limit(input.limit);
    }),

  logEvent: publicQuery
    .input(
      z.object({
        eventType: z.enum([
          "message_received",
          "message_sent",
          "voice_received",
          "weather_requested",
          "price_requested",
          "scheme_requested",
          "advice_requested",
          "farmer_registered",
          "conversation_started",
          "conversation_ended",
          "error",
        ]),
        farmerId: z.number().optional(),
        conversationId: z.number().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(analyticsEvents).values(input);
      return { success: true };
    }),
});
