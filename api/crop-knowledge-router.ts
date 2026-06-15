import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { cropKnowledge } from "@db/schema";
import { eq, like, and, desc, count, sql } from "drizzle-orm";

export const cropKnowledgeRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          cropName: z.string().optional(),
          category: z
            .enum([
              "planting",
              "fertilizer",
              "irrigation",
              "pest_control",
              "harvesting",
              "storage",
              "disease",
              "seasonal",
              "general",
            ])
            .optional(),
          stage: z.string().optional(),
          region: z.string().optional(),
          isActive: z.boolean().optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const {
        search,
        cropName,
        category,
        stage,
        region,
        isActive,
        page = 1,
        limit = 20,
      } = input ?? {};

      const conditions = [];
      if (search) {
        conditions.push(
          sql`(${cropKnowledge.title} LIKE ${`%${search}%`} OR ${cropKnowledge.content} LIKE ${`%${search}%`} OR ${cropKnowledge.tags} LIKE ${`%${search}%`})`
        );
      }
      if (cropName) conditions.push(like(cropKnowledge.cropName, `%${cropName}%`));
      if (category) conditions.push(eq(cropKnowledge.category, category));
      if (stage) conditions.push(like(cropKnowledge.stage, `%${stage}%`));
      if (region) conditions.push(like(cropKnowledge.region, `%${region}%`));
      if (isActive !== undefined) conditions.push(eq(cropKnowledge.isActive, isActive));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(cropKnowledge)
          .where(where)
          .orderBy(desc(cropKnowledge.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(cropKnowledge).where(where),
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
        .from(cropKnowledge)
        .where(eq(cropKnowledge.id, input.id))
        .limit(1);
      return result[0] ?? null;
    }),

  create: adminQuery
    .input(
      z.object({
        cropName: z.string().min(1),
        cropNameTelugu: z.string().optional(),
        cropNameHindi: z.string().optional(),
        category: z
          .enum([
            "planting",
            "fertilizer",
            "irrigation",
            "pest_control",
            "harvesting",
            "storage",
            "disease",
            "seasonal",
            "general",
          ])
          .default("general"),
        title: z.string().min(1),
        content: z.string().min(1),
        contentTelugu: z.string().optional(),
        contentHindi: z.string().optional(),
        stage: z.string().optional(),
        season: z.string().optional(),
        region: z.string().optional(),
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(cropKnowledge).values(input);
      return { id: Number(result[0].insertId), ...input };
    }),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        cropName: z.string().optional(),
        cropNameTelugu: z.string().optional(),
        cropNameHindi: z.string().optional(),
        category: z
          .enum([
            "planting",
            "fertilizer",
            "irrigation",
            "pest_control",
            "harvesting",
            "storage",
            "disease",
            "seasonal",
            "general",
          ])
          .optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        contentTelugu: z.string().optional(),
        contentHindi: z.string().optional(),
        stage: z.string().optional(),
        season: z.string().optional(),
        region: z.string().optional(),
        tags: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(cropKnowledge).set(data).where(eq(cropKnowledge.id, id));
      const updated = await db
        .select()
        .from(cropKnowledge)
        .where(eq(cropKnowledge.id, id))
        .limit(1);
      return updated[0];
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(cropKnowledge).where(eq(cropKnowledge.id, input.id));
      return { success: true };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, activeResult, byCategoryResult, topCropsResult] =
      await Promise.all([
        db.select({ count: count() }).from(cropKnowledge),
        db
          .select({ count: count() })
          .from(cropKnowledge)
          .where(eq(cropKnowledge.isActive, true)),
        db
          .select({
            category: cropKnowledge.category,
            count: count(),
          })
          .from(cropKnowledge)
          .groupBy(cropKnowledge.category),
        db
          .select({
            cropName: cropKnowledge.cropName,
            count: count(),
          })
          .from(cropKnowledge)
          .groupBy(cropKnowledge.cropName)
          .orderBy(sql`count(*) DESC`)
          .limit(10),
      ]);

    return {
      total: totalResult[0]?.count ?? 0,
      active: activeResult[0]?.count ?? 0,
      byCategory: byCategoryResult,
      topCrops: topCropsResult,
    };
  }),
});
