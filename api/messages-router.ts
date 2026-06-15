import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { messages, conversations, farmers } from "@db/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";

export const messagesRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          farmerId: z.number().optional(),
          conversationId: z.number().optional(),
          contentType: z.enum(["text", "voice", "image", "template"]).optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { farmerId, conversationId, contentType, page = 1, limit = 50 } = input ?? {};

      const conditions = [];
      if (farmerId) conditions.push(eq(messages.farmerId, farmerId));
      if (conversationId) conditions.push(eq(messages.conversationId, conversationId));
      if (contentType) conditions.push(eq(messages.contentType, contentType));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            farmerId: messages.farmerId,
            senderType: messages.senderType,
            contentType: messages.contentType,
            content: messages.content,
            mediaUrl: messages.mediaUrl,
            language: messages.language,
            aiResponse: messages.aiResponse,
            intentDetected: messages.intentDetected,
            processingTime: messages.processingTime,
            createdAt: messages.createdAt,
            farmerName: farmers.name,
            farmerPhone: farmers.phoneNumber,
          })
          .from(messages)
          .leftJoin(farmers, eq(messages.farmerId, farmers.id))
          .where(where)
          .orderBy(desc(messages.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(messages).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      };
    }),

  getConversationMessages: publicQuery
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(messages.createdAt);
    }),

  create: publicQuery
    .input(
      z.object({
        conversationId: z.number(),
        farmerId: z.number(),
        senderType: z.enum(["farmer", "ai", "system"]),
        contentType: z.enum(["text", "voice", "image", "template"]).default("text"),
        content: z.string(),
        mediaUrl: z.string().optional(),
        language: z.enum(["telugu", "hindi", "english"]).optional(),
        aiResponse: z.string().optional(),
        intentDetected: z.string().optional(),
        processingTime: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(messages).values(input);

      // Update conversation message count and farmer interaction count
      await db
        .update(conversations)
        .set({
          messageCount: sql`${conversations.messageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, input.conversationId));

      await db
        .update(farmers)
        .set({
          totalInteractions: sql`${farmers.totalInteractions} + 1`,
          lastInteractionAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(farmers.id, input.farmerId));

      return { id: Number(result[0].insertId), ...input };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, todayResult, byTypeResult, bySenderResult] = await Promise.all([
      db.select({ count: count() }).from(messages),
      db
        .select({ count: count() })
        .from(messages)
        .where(sql`${messages.createdAt} >= CURDATE()`),
      db
        .select({
          contentType: messages.contentType,
          count: count(),
        })
        .from(messages)
        .groupBy(messages.contentType),
      db
        .select({
          senderType: messages.senderType,
          count: count(),
        })
        .from(messages)
        .groupBy(messages.senderType),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      today: todayResult[0]?.count ?? 0,
      byType: byTypeResult,
      bySender: bySenderResult,
    };
  }),
});
