import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { systemSettings } from "@db/schema";
import { eq } from "drizzle-orm";

export const settingsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(systemSettings);
  }),

  getByKey: publicQuery
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, input.key))
        .limit(1);
      return result[0] ?? null;
    }),

  set: adminQuery
    .input(
      z.object({
        key: z.string(),
        value: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, input.key))
        .limit(1);

      if (existing[0]) {
        await db
          .update(systemSettings)
          .set({ value: input.value, description: input.description ?? existing[0].description })
          .where(eq(systemSettings.key, input.key));
      } else {
        await db.insert(systemSettings).values(input);
      }

      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(systemSettings).where(eq(systemSettings.key, input.key));
      return { success: true };
    }),
});
