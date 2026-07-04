import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { farmers, conversations, messages, dailyBriefings, analyticsEvents } from "@db/schema";
import { eq, like, and, desc, sql, count } from "drizzle-orm";

// Normalize phone: remove +, spaces, dashes — keep only digits
// Auto-add India country code (91) if 10 digits
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "").trim();
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }
  return cleaned;
}

export const farmersRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          district: z.string().optional(),
          state: z.string().optional(),
          language: z.enum(["telugu", "hindi", "english"]).optional(),
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
        district,
        state,
        language,
        isActive,
        page = 1,
        limit = 20,
      } = input ?? {};

      const conditions = [];
      if (search) {
        conditions.push(
          sql`(${farmers.name} LIKE ${`%${search}%`} OR ${farmers.phoneNumber} LIKE ${`%${search}%`})`
        );
      }
      if (district) conditions.push(like(farmers.district, `%${district}%`));
      if (state) conditions.push(like(farmers.state, `%${state}%`));
      if (language) conditions.push(eq(farmers.preferredLanguage, language));
      if (isActive !== undefined) conditions.push(eq(farmers.isActive, isActive));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(farmers)
          .where(where)
          .orderBy(desc(farmers.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: count() }).from(farmers).where(where),
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
        .from(farmers)
        .where(eq(farmers.id, input.id))
        .limit(1);
      return result[0] ?? null;
    }),

  getByPhone: publicQuery
    .input(z.object({ phoneNumber: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(farmers)
        .where(eq(farmers.phoneNumber, normalizePhone(input.phoneNumber)))
        .limit(1);
      return result[0] ?? null;
    }),

  create: publicQuery
    .input(
      z.object({
        phoneNumber: z.string().min(10).max(20),
        name: z.string().optional(),
        preferredLanguage: z.enum(["telugu", "hindi", "english"]).default("english"),
        location: z.string().optional(),
        district: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        landSize: z.number().optional(),
        primaryCrop: z.string().optional(),
        secondaryCrops: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const normalizedInput = { ...input, phoneNumber: normalizePhone(input.phoneNumber) };
      const result = await db.insert(farmers).values(normalizedInput);
      return { id: Number(result[0].insertId), ...normalizedInput };
    }),

  update: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        preferredLanguage: z.enum(["telugu", "hindi", "english"]).optional(),
        location: z.string().optional(),
        district: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        landSize: z.number().optional(),
        primaryCrop: z.string().optional(),
        secondaryCrops: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(farmers).set(data).where(eq(farmers.id, id));
      const updated = await db
        .select()
        .from(farmers)
        .where(eq(farmers.id, id))
        .limit(1);
      return updated[0];
    }),

  toggleActive: publicQuery
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(farmers)
        .set({ isActive: input.isActive })
        .where(eq(farmers.id, input.id));
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const farmerId = input.id;

      // Cascade delete: remove all related records first
      // 1. Delete messages referencing this farmer's conversations
      const convRows = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.farmerId, farmerId));
      const convIds = convRows.map((c) => c.id);
      if (convIds.length > 0) {
        for (const cid of convIds) {
          await db.delete(messages).where(eq(messages.conversationId, cid));
        }
      }

      // 2. Delete conversations
      await db.delete(conversations).where(eq(conversations.farmerId, farmerId));

      // 3. Delete analytics events
      await db.delete(analyticsEvents).where(eq(analyticsEvents.farmerId, farmerId));

      // 4. Delete daily briefings
      await db.delete(dailyBriefings).where(eq(dailyBriefings.farmerId, farmerId));

      // 5. Finally delete the farmer
      await db.delete(farmers).where(eq(farmers.id, farmerId));

      return { success: true, deletedId: farmerId };
    }),

  exportAll: publicQuery.query(async () => {
    const db = getDb();
    const allFarmers = await db
      .select()
      .from(farmers)
      .orderBy(desc(farmers.createdAt));
    return allFarmers;
  }),

  importBulk: adminQuery
    .input(
      z.array(
        z.object({
          phoneNumber: z.string().min(10).max(20),
          name: z.string().optional(),
          preferredLanguage: z.enum(["telugu", "hindi", "kannada", "english"]).default("english"),
          location: z.string().optional(),
          district: z.string().optional(),
          state: z.string().optional(),
          landSize: z.union([z.number(), z.string()]).optional().transform((v) => v ? Number(v) : undefined),
          primaryCrop: z.string().optional(),
          secondaryCrops: z.string().optional(),
        })
      )
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let inserted = 0;
      let skipped = 0;

      for (const row of input) {
        const normalizedPhone = normalizePhone(row.phoneNumber);

        // Skip if phone number already exists
        const existing = await db
          .select()
          .from(farmers)
          .where(eq(farmers.phoneNumber, normalizedPhone))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        await db.insert(farmers).values({
          phoneNumber: normalizedPhone,
          name: row.name || null,
          preferredLanguage: row.preferredLanguage,
          location: row.location || null,
          district: row.district || null,
          state: row.state || null,
          landSize: row.landSize || null,
          primaryCrop: row.primaryCrop || null,
          secondaryCrops: row.secondaryCrops || null,
          isActive: true,
        });
        inserted++;
      }

      return { inserted, skipped };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, activeResult, todayResult, languageResult] =
      await Promise.all([
        db.select({ count: count() }).from(farmers),
        db
          .select({ count: count() })
          .from(farmers)
          .where(eq(farmers.isActive, true)),
        db
          .select({ count: count() })
          .from(farmers)
          .where(
            sql`${farmers.createdAt} >= CURDATE()`
          ),
        db
          .select({
            language: farmers.preferredLanguage,
            count: count(),
          })
          .from(farmers)
          .groupBy(farmers.preferredLanguage),
      ]);

    return {
      total: totalResult[0]?.count ?? 0,
      active: activeResult[0]?.count ?? 0,
      today: todayResult[0]?.count ?? 0,
      byLanguage: languageResult,
    };
  }),
});
