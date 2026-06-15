import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { governmentSchemes } from "@db/schema";
import { eq, like, and, desc, count, sql } from "drizzle-orm";

export const schemesRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          category: z
            .enum([
              "loan",
              "subsidy",
              "insurance",
              "grant",
              "training",
              "equipment",
              "other",
            ])
            .optional(),
          state: z.string().optional(),
          isActive: z.boolean().optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { search, category, state, isActive, page = 1, limit = 20 } = input ?? {};

      const conditions = [];
      if (search) {
        conditions.push(
          sql`(${governmentSchemes.title} LIKE ${`%${search}%`} OR ${governmentSchemes.description} LIKE ${`%${search}%`})`
        );
      }
      if (category) conditions.push(eq(governmentSchemes.category, category));
      if (state) conditions.push(like(governmentSchemes.stateSpecific, `%${state}%`));
      if (isActive !== undefined) conditions.push(eq(governmentSchemes.isActive, isActive));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(governmentSchemes)
          .where(where)
          .orderBy(desc(governmentSchemes.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(governmentSchemes).where(where),
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
        .from(governmentSchemes)
        .where(eq(governmentSchemes.id, input.id))
        .limit(1);
      return result[0] ?? null;
    }),

  create: adminQuery
    .input(
      z.object({
        schemeCode: z.string().optional(),
        title: z.string().min(1),
        titleTelugu: z.string().optional(),
        titleHindi: z.string().optional(),
        description: z.string().optional(),
        descriptionTelugu: z.string().optional(),
        descriptionHindi: z.string().optional(),
        category: z
          .enum([
            "loan",
            "subsidy",
            "insurance",
            "grant",
            "training",
            "equipment",
            "other",
          ])
          .default("other"),
        eligibility: z.string().optional(),
        benefits: z.string().optional(),
        documentsRequired: z.string().optional(),
        applicationProcess: z.string().optional(),
        stateSpecific: z.string().optional(),
        department: z.string().optional(),
        officialUrl: z.string().optional(),
        validFrom: z.string().optional(),
        validUntil: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const data = {
        ...input,
        validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
        validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      };
      const result = await db.insert(governmentSchemes).values(data);
      return { id: Number(result[0].insertId), ...input };
    }),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        titleTelugu: z.string().optional(),
        titleHindi: z.string().optional(),
        description: z.string().optional(),
        descriptionTelugu: z.string().optional(),
        descriptionHindi: z.string().optional(),
        category: z
          .enum([
            "loan",
            "subsidy",
            "insurance",
            "grant",
            "training",
            "equipment",
            "other",
          ])
          .optional(),
        eligibility: z.string().optional(),
        benefits: z.string().optional(),
        documentsRequired: z.string().optional(),
        applicationProcess: z.string().optional(),
        stateSpecific: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(governmentSchemes).set(data).where(eq(governmentSchemes.id, id));
      const updated = await db
        .select()
        .from(governmentSchemes)
        .where(eq(governmentSchemes.id, id))
        .limit(1);
      return updated[0];
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(governmentSchemes).where(eq(governmentSchemes.id, input.id));
      return { success: true };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, activeResult, byCategoryResult] = await Promise.all([
      db.select({ count: count() }).from(governmentSchemes),
      db
        .select({ count: count() })
        .from(governmentSchemes)
        .where(eq(governmentSchemes.isActive, true)),
      db
        .select({
          category: governmentSchemes.category,
          count: count(),
        })
        .from(governmentSchemes)
        .groupBy(governmentSchemes.category),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      active: activeResult[0]?.count ?? 0,
      byCategory: byCategoryResult,
    };
  }),
});
