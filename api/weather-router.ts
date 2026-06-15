import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { weatherCache } from "@db/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";

export const weatherRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          location: z.string().optional(),
          district: z.string().optional(),
          state: z.string().optional(),
          date: z.string().optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { location, district, state, date, page = 1, limit = 20 } = input ?? {};

      const conditions = [
        sql`${weatherCache.expiresAt} > NOW()`,
      ];
      if (location) conditions.push(eq(weatherCache.location, location));
      if (district) conditions.push(eq(weatherCache.district, district));
      if (state) conditions.push(eq(weatherCache.state, state));
      if (date) conditions.push(sql`${weatherCache.forecastDate} = ${date}`);

      const where = and(...conditions);

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(weatherCache)
          .where(where)
          .orderBy(weatherCache.forecastDays)
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(weatherCache).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      };
    }),

  getForLocation: publicQuery
    .input(
      z.object({
        location: z.string(),
        forecastDays: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(weatherCache)
        .where(
          and(
            eq(weatherCache.location, input.location),
            eq(weatherCache.forecastDays, input.forecastDays),
            sql`${weatherCache.expiresAt} > NOW()`
          )
        )
        .orderBy(desc(weatherCache.fetchedAt))
        .limit(1);
      return result[0] ?? null;
    }),

  create: publicQuery
    .input(
      z.object({
        location: z.string(),
        district: z.string().optional(),
        state: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        temperature: z.number(),
        feelsLike: z.number().optional(),
        humidity: z.number(),
        windSpeed: z.number(),
        windDirection: z.string().optional(),
        precipitation: z.number().optional(),
        rainProbability: z.number(),
        weatherCondition: z.string(),
        forecastDate: z.string(),
        forecastDays: z.number().default(0),
        source: z.string().optional(),
        expiresAt: z.date(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const data = {
        ...input,
        forecastDate: new Date(input.forecastDate),
      };
      const result = await db.insert(weatherCache).values(data);
      return { id: Number(result[0].insertId), ...input };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, locationsResult] = await Promise.all([
      db.select({ count: count() }).from(weatherCache),
      db
        .selectDistinct({
          location: weatherCache.location,
          state: weatherCache.state,
        })
        .from(weatherCache)
        .where(sql`${weatherCache.expiresAt} > NOW()`),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      activeLocations: locationsResult.length,
      locations: locationsResult,
    };
  }),
});
