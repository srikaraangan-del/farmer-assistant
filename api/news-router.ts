import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { dailyNews } from "@db/schema";
import { desc, eq, sql, and } from "drizzle-orm";

// ====== RSS Feed Fetchers ======

interface RawNewsItem {
  title: string;
  summary: string;
  source: string;
  sourceUrl?: string;
  category: string;
  publishedDate?: string;
}

// Parse RSS XML to extract items
function parseRSS(xml: string, source: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const desc = extractTag(itemXml, "description");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    if (title) {
      items.push({
        title,
        summary: stripHtml(desc || title).substring(0, 500),
        source,
        sourceUrl: link || undefined,
        category: "general",
        publishedDate: pubDate ? new Date(pubDate).toISOString().split("T")[0] : undefined,
      });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(regex);
  return m ? m[1].trim() : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fetch news from multiple RSS sources
async function fetchNewsFromSources(): Promise<RawNewsItem[]> {
  const allNews: RawNewsItem[] = [];
  const sources = [
    {
      url: "https://www.thehindu.com/agriculture/feeder/default.rss",
      name: "The Hindu",
      category: "policy",
    },
    {
      url: "https://krishakjagat.org/feed/",
      name: "Krishak Jagat",
      category: "technology",
    },
    {
      url: "https://www.agriculture.com/rss/news",
      name: "Agriculture.com",
      category: "research",
    },
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { headers: { "User-Agent": "KisanSaathi-Bot/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRSS(xml, src.name);
      for (const item of items.slice(0, 5)) {
        item.category = src.category;
        allNews.push(item);
      }
      console.log(`[News] Fetched ${items.length} from ${src.name}`);
    } catch (e: any) {
      console.error(`[News] Failed ${src.name}:`, e.message);
    }
  }

  return allNews;
}

// ====== Router ======

export const newsRouter = createRouter({
  // List all news
  list: publicQuery.query(async () => {
    const db = getDb();
    const items = await db.select().from(dailyNews)
      .where(eq(dailyNews.isActive, true))
      .orderBy(desc(dailyNews.fetchedAt))
      .limit(50);
    return items;
  }),

  // Get latest N news
  latest: publicQuery
    .input(z.object({ limit: z.number().default(5), category: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 5;
      let items;
      if (input?.category) {
        items = await db.select().from(dailyNews)
          .where(and(eq(dailyNews.isActive, true), eq(dailyNews.category, input.category as any)))
          .orderBy(desc(dailyNews.fetchedAt))
          .limit(limit);
      } else {
        items = await db.select().from(dailyNews)
          .where(eq(dailyNews.isActive, true))
          .orderBy(desc(dailyNews.fetchedAt))
          .limit(limit);
      }
      return items;
    }),

  // Fetch fresh news from RSS and save to DB
  refresh: publicQuery.mutation(async () => {
    const db = getDb();
    const fetched = await fetchNewsFromSources();
    let inserted = 0;
    let duplicates = 0;

    for (const item of fetched) {
      try {
        // Simple dedup: check if title exists
        const existing = await db.select({ id: dailyNews.id }).from(dailyNews)
          .where(sql`LOWER(${dailyNews.title}) = LOWER(${item.title})`)
          .limit(1);
        if (existing.length > 0) {
          duplicates++;
          continue;
        }

        await db.insert(dailyNews).values({
          title: item.title,
          summary: item.summary,
          source: item.source,
          sourceUrl: item.sourceUrl,
          category: item.category as any,
          publishedDate: item.publishedDate ? new Date(item.publishedDate) : new Date(),
        });
        inserted++;
      } catch (e: any) {
        if (!e.message?.includes("Duplicate")) {
          console.error(`[News] Insert error:`, e.message);
        }
      }
    }

    return { inserted, duplicates, total: fetched.length };
  }),

  // Delete a news item
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(dailyNews).set({ isActive: false }).where(eq(dailyNews.id, input.id));
      return { success: true };
    }),

  // Stats
  stats: publicQuery.query(async () => {
    const db = getDb();
    const [total] = await db.select({ count: sql<number>`COUNT(*)` }).from(dailyNews).where(eq(dailyNews.isActive, true));
    const [today] = await db.select({ count: sql<number>`COUNT(*)` }).from(dailyNews)
      .where(sql`${dailyNews.isActive} = true AND ${dailyNews.fetchedAt} > DATE_SUB(NOW(), INTERVAL 1 DAY)`);
    return { total: total?.count ?? 0, today: today?.count ?? 0 };
  }),
});
