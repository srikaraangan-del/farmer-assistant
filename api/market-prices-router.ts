import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { marketPrices } from "@db/schema";
import { eq, like, and, desc, count, sql } from "drizzle-orm";

export const marketPricesRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          commodity: z.string().optional(),
          mandi: z.string().optional(),
          state: z.string().optional(),
          district: z.string().optional(),
          date: z.string().optional(), // YYYY-MM-DD
          priceTrend: z.enum(["up", "down", "stable"]).optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const {
        commodity,
        mandi,
        state,
        district,
        date,
        priceTrend,
        page = 1,
        limit = 20,
      } = input ?? {};

      const conditions = [eq(marketPrices.isActive, true)];
      if (commodity) conditions.push(like(marketPrices.commodity, `%${commodity}%`));
      if (mandi) conditions.push(like(marketPrices.mandiName, `%${mandi}%`));
      if (state) conditions.push(like(marketPrices.state, `%${state}%`));
      if (district) conditions.push(like(marketPrices.district, `%${district}%`));
      if (date) conditions.push(sql`${marketPrices.priceDate} = ${date}`);
      if (priceTrend) conditions.push(eq(marketPrices.priceTrend, priceTrend));

      const where = and(...conditions);

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(marketPrices)
          .where(where)
          .orderBy(desc(marketPrices.priceDate))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(marketPrices).where(where),
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
        .from(marketPrices)
        .where(eq(marketPrices.id, input.id))
        .limit(1);
      return result[0] ?? null;
    }),

  create: adminQuery
    .input(
      z.object({
        commodity: z.string().min(1),
        variety: z.string().optional(),
        mandiName: z.string().min(1),
        district: z.string().optional(),
        state: z.string().min(1),
        pricePerQuintal: z.number().positive(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        currency: z.string().default("INR"),
        unit: z.string().default("Quintal"),
        priceDate: z.string(), // YYYY-MM-DD
        priceTrend: z.enum(["up", "down", "stable"]).default("stable"),
        source: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const data = {
        ...input,
        priceDate: new Date(input.priceDate),
      };
      const result = await db.insert(marketPrices).values(data);
      return { id: Number(result[0].insertId), ...input };
    }),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        commodity: z.string().optional(),
        variety: z.string().optional(),
        mandiName: z.string().optional(),
        district: z.string().optional(),
        state: z.string().optional(),
        pricePerQuintal: z.number().optional(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        priceTrend: z.enum(["up", "down", "stable"]).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(marketPrices).set(data).where(eq(marketPrices.id, id));
      const updated = await db
        .select()
        .from(marketPrices)
        .where(eq(marketPrices.id, id))
        .limit(1);
      return updated[0];
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(marketPrices).where(eq(marketPrices.id, input.id));
      return { success: true };
    }),

  getCommodities: publicQuery.query(async () => {
    const db = getDb();
    return db
      .selectDistinct({ commodity: marketPrices.commodity })
      .from(marketPrices)
      .where(eq(marketPrices.isActive, true))
      .orderBy(marketPrices.commodity);
  }),

  getTrends: publicQuery
    .input(
      z.object({
        commodity: z.string(),
        mandi: z.string().optional(),
        days: z.number().default(7),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { commodity, mandi, days } = input;

      const conditions = [
        eq(marketPrices.commodity, commodity),
        eq(marketPrices.isActive, true),
        sql`${marketPrices.priceDate} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`,
      ];
      if (mandi) conditions.push(eq(marketPrices.mandiName, mandi));

      return db
        .select()
        .from(marketPrices)
        .where(and(...conditions))
        .orderBy(marketPrices.priceDate);
    }),
});
