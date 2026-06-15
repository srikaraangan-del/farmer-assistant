import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { aiIntents } from "@db/schema";
import { eq, desc, count, sql } from "drizzle-orm";

export const aiIntentsRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          handlerType: z
            .enum([
              "weather",
              "market_price",
              "scheme",
              "crop_advice",
              "general",
              "voice",
              "fallback",
            ])
            .optional(),
          isActive: z.boolean().optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { search, handlerType, isActive, page = 1, limit = 20 } = input ?? {};

      const conditions = [];
      if (search) {
        conditions.push(
          sql`(${aiIntents.intentName} LIKE ${`%${search}%`} OR ${aiIntents.keywords} LIKE ${`%${search}%`})`
        );
      }
      if (handlerType) conditions.push(eq(aiIntents.handlerType, handlerType));
      if (isActive !== undefined) conditions.push(eq(aiIntents.isActive, isActive));

      const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(aiIntents)
          .where(where)
          .orderBy(desc(aiIntents.usageCount))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(aiIntents).where(where),
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
      const result = await db
        .select()
        .from(aiIntents)
        .where(eq(aiIntents.id, input.id))
        .limit(1);
      return result[0] ?? null;
    }),

  create: adminQuery
    .input(
      z.object({
        intentName: z.string().min(1),
        keywords: z.string().optional(),
        description: z.string().optional(),
        responseTemplate: z.string().optional(),
        handlerType: z
          .enum([
            "weather",
            "market_price",
            "scheme",
            "crop_advice",
            "general",
            "voice",
            "fallback",
          ])
          .default("general"),
        confidence: z.number().default(0.8),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(aiIntents).values(input);
      return { id: Number(result[0].insertId), ...input };
    }),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        intentName: z.string().optional(),
        keywords: z.string().optional(),
        description: z.string().optional(),
        responseTemplate: z.string().optional(),
        handlerType: z
          .enum([
            "weather",
            "market_price",
            "scheme",
            "crop_advice",
            "general",
            "voice",
            "fallback",
          ])
          .optional(),
        isActive: z.boolean().optional(),
        confidence: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(aiIntents).set(data).where(eq(aiIntents.id, id));
      const updated = await db
        .select()
        .from(aiIntents)
        .where(eq(aiIntents.id, id))
        .limit(1);
      return updated[0];
    }),

  incrementUsage: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(aiIntents)
        .set({
          usageCount: sql`${aiIntents.usageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(aiIntents.id, input.id));
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(aiIntents).where(eq(aiIntents.id, input.id));
      return { success: true };
    }),
});
