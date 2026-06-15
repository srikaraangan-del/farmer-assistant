import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { conversations, farmers, messages } from "@db/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";

export const conversationsRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          farmerId: z.number().optional(),
          status: z.enum(["active", "closed", "archived"]).optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { farmerId, status, page = 1, limit = 20 } = input ?? {};

      const conditions = [];
      if (farmerId) conditions.push(eq(conversations.farmerId, farmerId));
      if (status) conditions.push(eq(conversations.status, status));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select({
            id: conversations.id,
            farmerId: conversations.farmerId,
            status: conversations.status,
            intent: conversations.intent,
            satisfaction: conversations.satisfaction,
            startedAt: conversations.startedAt,
            endedAt: conversations.endedAt,
            messageCount: conversations.messageCount,
            createdAt: conversations.createdAt,
            updatedAt: conversations.updatedAt,
            farmerName: farmers.name,
            farmerPhone: farmers.phoneNumber,
            farmerLanguage: farmers.preferredLanguage,
          })
          .from(conversations)
          .leftJoin(farmers, eq(conversations.farmerId, farmers.id))
          .where(where)
          .orderBy(desc(conversations.updatedAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(conversations).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      };
    }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [conv, msgs] = await Promise.all([
        db
          .select()
          .from(conversations)
          .where(eq(conversations.id, input.id))
          .limit(1),
        db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, input.id))
          .orderBy(messages.createdAt),
      ]);
      return { conversation: conv[0] ?? null, messages: msgs };
    }),

  create: publicQuery
    .input(
      z.object({
        farmerId: z.number(),
        intent: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(conversations).values(input);
      return { id: Number(result[0].insertId), ...input };
    }),

  update: publicQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["active", "closed", "archived"]).optional(),
        intent: z.string().optional(),
        satisfaction: z.enum(["positive", "neutral", "negative"]).optional(),
        endedAt: z.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(conversations).set(data).where(eq(conversations.id, id));
      const updated = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      return updated[0];
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, activeResult, todayResult, byStatusResult] =
      await Promise.all([
        db.select({ count: count() }).from(conversations),
        db
          .select({ count: count() })
          .from(conversations)
          .where(eq(conversations.status, "active")),
        db
          .select({ count: count() })
          .from(conversations)
          .where(sql`${conversations.createdAt} >= CURDATE()`),
        db
          .select({
            status: conversations.status,
            count: count(),
          })
          .from(conversations)
          .groupBy(conversations.status),
      ]);

    return {
      total: totalResult[0]?.count ?? 0,
      active: activeResult[0]?.count ?? 0,
      today: todayResult[0]?.count ?? 0,
      byStatus: byStatusResult,
    };
  }),
});
