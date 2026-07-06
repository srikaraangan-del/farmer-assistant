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

// Translate text using MyMemory API (free tier, no key needed)
async function translateText(text: string, targetLang: string): Promise<string | null> {
  if (!text || text.length < 2) return null;
  const langPair = targetLang === "te" ? "en|te"
    : targetLang === "hi" ? "en|hi"
    : targetLang === "kn" ? "en|kn"
    : null;
  if (!langPair) return null;

  try {
    const encoded = encodeURIComponent(text.substring(0, 500));
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${langPair}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // MyMemory returns "TRANSLATION ERROR" or similar on failure
    const translated = data?.responseData?.translatedText;
    if (!translated || translated.startsWith("TRANSLATION") || translated === text) return null;
    return translated;
  } catch (e: any) {
    console.error(`[Translate] ${langPair} failed:`, e.message);
    return null;
  }
}

// Batch translate a news item to all 3 languages
async function translateNewsItem(item: RawNewsItem): Promise<{
  titleTelugu?: string; titleHindi?: string; titleKannada?: string;
  summaryTelugu?: string; summaryHindi?: string; summaryKannada?: string;
}> {
  const results: ReturnType<typeof translateNewsItem> extends Promise<infer T> ? T : never = {};

  // Translate titles (run in parallel)
  const [titleTe, titleHi, titleKn] = await Promise.all([
    translateText(item.title, "te"),
    translateText(item.title, "hi"),
    translateText(item.title, "kn"),
  ]);
  if (titleTe) results.titleTelugu = titleTe;
  if (titleHi) results.titleHindi = titleHi;
  if (titleKn) results.titleKannada = titleKn;

  // Translate summaries (run in parallel)
  const [sumTe, sumHi, sumKn] = await Promise.all([
    translateText(item.summary, "te"),
    translateText(item.summary, "hi"),
    translateText(item.summary, "kn"),
  ]);
  if (sumTe) results.summaryTelugu = sumTe;
  if (sumHi) results.summaryHindi = sumHi;
  if (sumKn) results.summaryKannada = sumKn;

  return results;
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

        // Translate to regional languages
        const translations = await translateNewsItem(item);

        await db.insert(dailyNews).values({
          title: item.title,
          titleTelugu: translations.titleTelugu,
          titleHindi: translations.titleHindi,
          titleKannada: translations.titleKannada,
          summary: item.summary,
          summaryTelugu: translations.summaryTelugu,
          summaryHindi: translations.summaryHindi,
          summaryKannada: translations.summaryKannada,
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
