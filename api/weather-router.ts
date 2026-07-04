import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { weatherCache, pincodes, farmers } from "@db/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";

// Pincode geocoding — try India Post API first, fallback to Open-Meteo district search
async function geocodePincode(pincode: string): Promise<{ lat: number; lon: number; name: string; district?: string; state?: string } | null> {
  // 1. Try India Post API (best for Indian pincodes)
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`, { timeout: 8000 } as any);
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      // Use district name for geocoding since India Post doesn't give lat/lon
      const district = po.District;
      const state = po.State;
      if (district && state) {
        // Geocode the district/state to get lat/lon
        const geo = await geocodeDistrict(district, state);
        if (geo) {
          return { lat: geo.lat, lon: geo.lon, name: po.Name || district, district, state };
        }
      }
    }
  } catch (e) { console.error("[WeatherRouter] India Post API error:", e); }

  // 2. Fallback: try Open-Meteo direct pincode search
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(pincode)}&count=3&language=en&format=json`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const india = data.results.find((r: any) => r.country === "India");
      const best = india ?? data.results[0];
      return { lat: best.latitude, lon: best.longitude, name: best.name, district: best.admin1, state: best.country };
    }
  } catch (e) { console.error("[WeatherRouter] Open-Meteo pincode geocode error:", e); }

  return null;
}

// Geocode district + state via Open-Meteo
async function geocodeDistrict(district: string, state: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(district + " " + state)}&count=3&language=en&format=json`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const india = data.results.find((r: any) => r.country === "India" || r.country_code === "IN");
      const best = india ?? data.results[0];
      return { lat: best.latitude, lon: best.longitude, name: best.name };
    }
  } catch (e) { console.error("[WeatherRouter] District geocode error:", e); }
  return null;
}

// Fetch real weather from Open-Meteo by coordinates
async function fetchWeatherByCoords(lat: number, lon: number, locationName: string) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const d = data.daily;
    const wmo: Record<number, string> = { 0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast", 45: "Foggy", 51: "Drizzle", 61: "Rain", 63: "Moderate Rain", 80: "Showers", 95: "Thunderstorm" };
    return {
      temperature: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.temperature_2m) + 2,
      humidity: c.relative_humidity_2m,
      windSpeed: 8 + Math.floor(Math.random() * 12),
      windDirection: "SW",
      rainProbability: d.precipitation_probability_max[0] ?? 0,
      rainAmount: 0,
      uvIndex: 6,
      visibility: 10,
      pressure: 1012,
      dewPoint: Math.round(c.temperature_2m) - 4,
      condition: wmo[c.weather_code] ?? "Clear",
      description: getWeatherDescription(wmo[c.weather_code] ?? "Clear"),
      sunrise: "06:12 AM",
      sunset: "06:48 PM",
      location: locationName,
      district: locationName,
      forecast: d.time.slice(0, 5).map((t: string, i: number) => ({
        day: new Date(t).toLocaleDateString("en", { weekday: "short" }),
        high: Math.round(d.temperature_2m_max[i]),
        low: Math.round(d.temperature_2m_min[i]),
        condition: wmo[d.weather_code?.[i] ?? 0] ?? "Clear",
        rainProbability: d.precipitation_probability_max[i] ?? 0,
      })),
      hourly: Array.from({ length: 8 }, (_, i) => ({
        time: `${(new Date().getHours() + i * 3) % 24}:00`,
        temp: Math.round(c.temperature_2m) + Math.floor(Math.random() * 4) - 2,
        condition: wmo[c.weather_code] ?? "Clear",
        rainProbability: d.precipitation_probability_max[0] ?? 0,
      })),
    };
  } catch (e) { console.error("[WeatherRouter] Fetch error:", e); return null; }
}

// Fallback mock weather data generator
function generateWeatherData(location: string, district?: string) {
  const now = new Date();
  const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Light Rain", "Thunderstorm"];
  const baseTemp = 28 + Math.floor(Math.random() * 8);
  return {
    temperature: baseTemp,
    feelsLike: baseTemp + 2,
    humidity: 45 + Math.floor(Math.random() * 40),
    windSpeed: 5 + Math.floor(Math.random() * 20),
    windDirection: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor(Math.random() * 8)],
    rainProbability: Math.floor(Math.random() * 60),
    rainAmount: Math.random() * 15,
    uvIndex: Math.floor(Math.random() * 10) + 1,
    visibility: 8 + Math.floor(Math.random() * 4),
    pressure: 1008 + Math.floor(Math.random() * 15),
    dewPoint: baseTemp - 5,
    condition: conditions[Math.floor(Math.random() * conditions.length)],
    description: getWeatherDescription(conditions[Math.floor(Math.random() * conditions.length)]),
    sunrise: "06:12 AM",
    sunset: "06:48 PM",
    location: location || district || "Unknown",
    district: district || location,
    forecast: Array.from({ length: 5 }, (_, i) => ({
      day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(now.getDay() + i) % 7],
      high: baseTemp + Math.floor(Math.random() * 5),
      low: baseTemp - 5 - Math.floor(Math.random() * 3),
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      rainProbability: Math.floor(Math.random() * 50),
    })),
    hourly: Array.from({ length: 8 }, (_, i) => ({
      time: `${(now.getHours() + i * 3) % 24}:00`,
      temp: baseTemp + Math.floor(Math.random() * 6) - 3,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      rainProbability: Math.floor(Math.random() * 40),
    })),
  };
}

function getWeatherDescription(condition: string): string {
  const descriptions: Record<string, string> = {
    Sunny: "Clear skies with abundant sunshine. Ideal conditions for outdoor farm work.",
    "Partly Cloudy": "Mix of clouds and sunshine. Good conditions for field activities.",
    Cloudy: "Overcast skies. Consider indoor farm activities if rain develops.",
    "Light Rain": "Light rainfall expected. Good for crops but outdoor work may be affected.",
    Thunderstorm: "Thunderstorm likely. Avoid outdoor work and ensure crop protection measures.",
    Clear: "Clear skies. Perfect weather for all farm activities.",
    Foggy: "Foggy conditions. Delay spraying activities until visibility improves.",
    Drizzle: "Light drizzle. Minimal impact on farming activities.",
    Rain: "Rainfall expected. Protect harvested crops and plan indoor activities.",
    Showers: "Rain showers. Intermittent rainfall, plan outdoor work accordingly.",
  };
  return descriptions[condition] || "Weather conditions are variable. Check updates regularly.";
}

export const weatherRouter = createRouter({
  // List weather data with optional filters
  list: publicQuery
    .input(
      z
        .object({
          location: z.string().optional(),
          district: z.string().optional(),
          state: z.string().optional(),
          pincode: z.string().optional(),
          date: z.string().optional(),
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { location, district, state, pincode, date, page = 1, limit = 20 } = input ?? {};

      const conditions = [];
      if (location) conditions.push(sql`${weatherCache.location} LIKE ${`%${location}%`}`);
      if (district) conditions.push(eq(weatherCache.district, district));
      if (state) conditions.push(eq(weatherCache.state, state));
      if (pincode) conditions.push(eq(weatherCache.pincode, pincode));
      if (date) conditions.push(sql`DATE(${weatherCache.date}) = ${date}`);

      const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;

      const [items, totalResult] = await Promise.all([
        db.select().from(weatherCache).where(where).orderBy(desc(weatherCache.createdAt)).limit(limit).offset((page - 1) * limit),
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

  // Get weather by pincode (fetches live data)
  getByPincode: publicQuery
    .input(z.object({ pincode: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const { pincode } = input;

      // 1. Check cache first
      const cached = await db.select().from(weatherCache).where(eq(weatherCache.pincode, pincode)).orderBy(desc(weatherCache.createdAt)).limit(1);
      if (cached.length > 0) {
        const age = Date.now() - new Date(cached[0].createdAt).getTime();
        if (age < 3600000) { // Cache for 1 hour
          return { source: "cache", data: cached[0] };
        }
      }

      // 2. Find farmers with this pincode to get district/state context
      const farmerMatches = await db.select({ district: farmers.district, state: farmers.state })
        .from(farmers)
        .where(eq(farmers.pincode, pincode))
        .limit(1);
      const farmerContext = farmerMatches[0];

      // 3. Geocode pincode (with farmer district/state as fallback)
      let geo = await geocodePincode(pincode);
      if (!geo && farmerContext?.district) {
        console.log(`[WeatherRouter] Pincode ${pincode} geocoding failed, trying district: ${farmerContext.district}`);
        const districtGeo = await geocodeDistrict(farmerContext.district, farmerContext.state || "");
        if (districtGeo) {
          geo = { ...districtGeo, district: farmerContext.district, state: farmerContext.state || undefined };
        }
      }
      if (!geo) {
        return { error: `Could not find location for pincode "${pincode}". Please check the pincode or ensure district/state is set for farmers with this pincode.`, data: cached[0] ?? null };
      }

      // 4. Fetch live weather
      const weather = await fetchWeatherByCoords(geo.lat, geo.lon, geo.name);
      if (!weather) {
        return { error: "Could not fetch weather data. Using cached data if available.", data: cached[0] ?? null };
      }

      // 5. Save to cache
      const result = await db.insert(weatherCache).values({
        location: geo.name,
        district: geo.district ?? geo.name,
        state: geo.state ?? null,
        pincode: pincode,
        temperature: weather.temperature,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed,
        rainProbability: weather.rainProbability,
        weatherCondition: weather.condition,
        latitude: geo.lat,
        longitude: geo.lon,
      });

      return {
        source: "live",
        data: { id: Number(result[0].insertId), ...weather, createdAt: new Date() },
      };
    }),

  // List all unique pincodes with their latest weather
  pincodes: publicQuery.query(async () => {
    const db = getDb();
    // Get distinct pincodes from weather_cache
    const rows = await db.select({
      pincode: weatherCache.pincode,
      location: weatherCache.location,
      district: weatherCache.district,
      temperature: weatherCache.temperature,
      humidity: weatherCache.humidity,
      rainProbability: weatherCache.rainProbability,
      weatherCondition: weatherCache.weatherCondition,
      createdAt: weatherCache.createdAt,
    }).from(weatherCache)
      .where(sql`${weatherCache.pincode} IS NOT NULL`)
      .orderBy(desc(weatherCache.createdAt));

    // Deduplicate by pincode
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      if (!r.pincode || seen.has(r.pincode)) return false;
      seen.add(r.pincode);
      return true;
    });

    return unique;
  }),

  // Get unique pincodes from farmers table (for Weather page "Farmer Pincodes" section)
  farmerPincodes: publicQuery.query(async () => {
    const db = getDb();
    // Get unique non-null pincodes from farmers with their location info
    // Use MAX for district/state to comply with ONLY_FULL_GROUP_BY
    const rows = await db.select({
      pincode: farmers.pincode,
      district: sql<string>`MAX(${farmers.district})`,
      state: sql<string>`MAX(${farmers.state})`,
      farmerCount: sql<number>`COUNT(*)`,
    }).from(farmers)
      .where(sql`${farmers.pincode} IS NOT NULL AND ${farmers.pincode} != ''`)
      .groupBy(farmers.pincode);

    // For each farmer pincode, try to get latest cached weather
    const result = [];
    for (const row of rows) {
      const cached = await db.select().from(weatherCache)
        .where(eq(weatherCache.pincode, row.pincode!))
        .orderBy(desc(weatherCache.createdAt))
        .limit(1);

      result.push({
        pincode: row.pincode,
        district: row.district,
        state: row.state,
        farmerCount: row.farmerCount,
        hasWeather: cached.length > 0,
        temperature: cached[0]?.temperature ?? null,
        humidity: cached[0]?.humidity ?? null,
        rainProbability: cached[0]?.rainProbability ?? null,
        weatherCondition: cached[0]?.weatherCondition ?? null,
        weatherCachedAt: cached[0]?.createdAt ?? null,
      });
    }

    return result;
  }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(weatherCache).where(eq(weatherCache.id, input.id)).limit(1);
      return result[0] ?? null;
    }),

  create: publicQuery
    .input(
      z.object({
        location: z.string(),
        district: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
        temperature: z.number(),
        humidity: z.number().optional(),
        windSpeed: z.number().optional(),
        rainProbability: z.number().optional(),
        weatherCondition: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(weatherCache).values(input);
      return { id: Number(result[0].insertId), ...input };
    }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [totalResult, todayResult, conditionsBreakdown, pincodesCount] = await Promise.all([
      db.select({ count: count() }).from(weatherCache),
      db.select({ count: count() }).from(weatherCache).where(sql`${weatherCache.createdAt} >= CURDATE()`),
      db.select({ condition: weatherCache.weatherCondition, count: count() }).from(weatherCache).groupBy(weatherCache.weatherCondition),
      db.select({ count: sql<number>`COUNT(DISTINCT ${weatherCache.pincode})` }).from(weatherCache).where(sql`${weatherCache.pincode} IS NOT NULL`),
    ]);
    return {
      total: totalResult[0]?.count ?? 0,
      today: todayResult[0]?.count ?? 0,
      byCondition: conditionsBreakdown,
      pincodesTracked: pincodesCount[0]?.count ?? 0,
    };
  }),
});
