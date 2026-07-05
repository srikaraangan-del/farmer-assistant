import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  float,
  boolean,
  json,
  date,
  index,
} from "drizzle-orm/mysql-core";

// ============ CORE TABLES ============

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Local users (username/password for admin dashboard)
export const localUsers = mysqlTable("local_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("admin").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type LocalUser = typeof localUsers.$inferSelect;
export type InsertLocalUser = typeof localUsers.$inferInsert;

// Farmers (WhatsApp users)
export const farmers = mysqlTable(
  "farmers",
  {
    id: serial("id").primaryKey(),
    phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    preferredLanguage: mysqlEnum("preferred_language", [
      "telugu",
      "hindi",
      "kannada",
      "english",
    ])
      .default("english")
      .notNull(),
    location: varchar("location", { length: 255 }),
    district: varchar("district", { length: 255 }),
    state: varchar("state", { length: 255 }),
    pincode: varchar("pincode", { length: 10 }),
    latitude: float("latitude"),
    longitude: float("longitude"),
    landSize: float("land_size"), // in acres
    primaryCrop: varchar("primary_crop", { length: 255 }),
    secondaryCrops: varchar("secondary_crops", { length: 500 }),
    isActive: boolean("is_active").default(true).notNull(),
    lastInteractionAt: timestamp("last_interaction_at"),
    totalInteractions: int("total_interactions").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("phone_idx").on(table.phoneNumber),
    index("district_idx").on(table.district),
    index("language_idx").on(table.preferredLanguage),
  ]
);

export type Farmer = typeof farmers.$inferSelect;
export type InsertFarmer = typeof farmers.$inferInsert;

// Conversations (chat sessions)
export const conversations = mysqlTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    farmerId: bigint("farmer_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => farmers.id),
    status: mysqlEnum("status", ["active", "closed", "archived"])
      .default("active")
      .notNull(),
    intent: varchar("intent", { length: 100 }), // classified intent
    satisfaction: mysqlEnum("satisfaction", ["positive", "neutral", "negative"]),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    messageCount: int("message_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("farmer_conv_idx").on(table.farmerId)]
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

// Messages (individual messages)
export const messages = mysqlTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => conversations.id),
    farmerId: bigint("farmer_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => farmers.id),
    senderType: mysqlEnum("sender_type", ["farmer", "ai", "system"])
      .notNull(),
    contentType: mysqlEnum("content_type", ["text", "voice", "image", "template", "interactive"])
      .default("text")
      .notNull(),
    content: text("content"), // text content or transcription
    mediaUrl: text("media_url"), // for voice/image
    language: mysqlEnum("language", ["telugu", "hindi", "english"]).default("english"),
    aiResponse: text("ai_response"), // AI generated response
    intentDetected: varchar("intent_detected", { length: 100 }),
    processingTime: int("processing_time_ms"), // AI processing time
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conv_msg_idx").on(table.conversationId),
    index("farmer_msg_idx").on(table.farmerId),
    index("created_msg_idx").on(table.createdAt),
  ]
);

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// ============ MARKET & PRICING ============

// Market prices (Mandi rates)
export const marketPrices = mysqlTable(
  "market_prices",
  {
    id: serial("id").primaryKey(),
    commodity: varchar("commodity", { length: 255 }).notNull(),
    variety: varchar("variety", { length: 255 }),
    mandiName: varchar("mandi_name", { length: 255 }).notNull(),
    district: varchar("district", { length: 255 }),
    state: varchar("state", { length: 255 }).notNull(),
    pricePerQuintal: float("price_per_quintal").notNull(), // INR per quintal
    minPrice: float("min_price"),
    maxPrice: float("max_price"),
    currency: varchar("currency", { length: 10 }).default("INR").notNull(),
    unit: varchar("unit", { length: 50 }).default("Quintal").notNull(),
    priceDate: date("price_date").notNull(),
    priceTrend: mysqlEnum("price_trend", ["up", "down", "stable"]).default("stable"),
    source: varchar("source", { length: 255 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("commodity_idx").on(table.commodity),
    index("mandi_idx").on(table.mandiName),
    index("state_idx").on(table.state),
    index("date_idx").on(table.priceDate),
  ]
);

export type MarketPrice = typeof marketPrices.$inferSelect;
export type InsertMarketPrice = typeof marketPrices.$inferInsert;

// ============ GOVERNMENT SCHEMES ============

export const governmentSchemes = mysqlTable(
  "government_schemes",
  {
    id: serial("id").primaryKey(),
    schemeCode: varchar("scheme_code", { length: 100 }).unique(),
    title: varchar("title", { length: 500 }).notNull(),
    titleTelugu: varchar("title_telugu", { length: 500 }),
    titleHindi: varchar("title_hindi", { length: 500 }),
    description: text("description"),
    descriptionTelugu: text("description_telugu"),
    descriptionHindi: text("description_hindi"),
    category: mysqlEnum("category", [
      "loan",
      "subsidy",
      "insurance",
      "grant",
      "training",
      "equipment",
      "other",
    ])
      .default("other")
      .notNull(),
    eligibility: text("eligibility"),
    benefits: text("benefits"),
    documentsRequired: text("documents_required"),
    applicationProcess: text("application_process"),
    stateSpecific: varchar("state_specific", { length: 255 }),
    department: varchar("department", { length: 255 }),
    officialUrl: text("official_url"),
    isActive: boolean("is_active").default(true).notNull(),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("category_idx").on(table.category),
    index("state_scheme_idx").on(table.stateSpecific),
    index("active_idx").on(table.isActive),
  ]
);

export type GovernmentScheme = typeof governmentSchemes.$inferSelect;
export type InsertGovernmentScheme = typeof governmentSchemes.$inferInsert;

// ============ WEATHER DATA ============

export const weatherCache = mysqlTable(
  "weather_cache",
  {
    id: serial("id").primaryKey(),
    location: varchar("location", { length: 255 }).notNull(),
    district: varchar("district", { length: 255 }),
    state: varchar("state", { length: 255 }),
    pincode: varchar("pincode", { length: 10 }),
    latitude: float("latitude"),
    longitude: float("longitude"),
    temperature: float("temperature"), // Celsius
    feelsLike: float("feels_like"),
    humidity: int("humidity"), // percentage
    windSpeed: float("wind_speed"), // km/h
    windDirection: varchar("wind_direction", { length: 50 }),
    precipitation: float("precipitation"), // mm
    rainProbability: int("rain_probability"), // percentage
    weatherCondition: varchar("weather_condition", { length: 255 }),
    forecastDate: date("forecast_date").notNull(),
    forecastDays: int("forecast_days").default(0).notNull(), // 0 = today, 1 = tomorrow, etc.
    source: varchar("source", { length: 255 }),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("location_weather_idx").on(table.location),
    index("forecast_date_idx").on(table.forecastDate),
    index("expires_idx").on(table.expiresAt),
  ]
);

export type WeatherCache = typeof weatherCache.$inferSelect;
export type InsertWeatherCache = typeof weatherCache.$inferInsert;

// ============ PINCODES REFERENCE ============
// Stores geocoded pincodes so we don't geocode the same pin repeatedly

export const pincodes = mysqlTable(
  "pincodes",
  {
    id: serial("id").primaryKey(),
    pincode: varchar("pincode", { length: 10 }).notNull().unique(),
    location: varchar("location", { length: 255 }),
    district: varchar("district", { length: 255 }),
    state: varchar("state", { length: 255 }),
    latitude: float("latitude").notNull(),
    longitude: float("longitude").notNull(),
    country: varchar("country", { length: 100 }).default("India"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("pincode_idx").on(table.pincode),
    index("pin_district_idx").on(table.district),
  ]
);

export type Pincode = typeof pincodes.$inferSelect;
export type InsertPincode = typeof pincodes.$inferInsert;

// ============ CROP KNOWLEDGE BASE ============

export const cropKnowledge = mysqlTable(
  "crop_knowledge",
  {
    id: serial("id").primaryKey(),
    cropName: varchar("crop_name", { length: 255 }).notNull(),
    cropNameTelugu: varchar("crop_name_telugu", { length: 255 }),
    cropNameHindi: varchar("crop_name_hindi", { length: 255 }),
    category: mysqlEnum("category", [
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
      .default("general")
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    contentTelugu: text("content_telugu"),
    contentHindi: text("content_hindi"),
    stage: varchar("stage", { length: 255 }), // crop growth stage
    season: varchar("season", { length: 100 }),
    region: varchar("region", { length: 255 }),
    tags: varchar("tags", { length: 500 }),
    isActive: boolean("is_active").default(true).notNull(),
    viewCount: int("view_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("crop_name_idx").on(table.cropName),
    index("category_idx").on(table.category),
    index("crop_active_idx").on(table.isActive),
  ]
);

export type CropKnowledge = typeof cropKnowledge.$inferSelect;
export type InsertCropKnowledge = typeof cropKnowledge.$inferInsert;

// ============ DAILY FARMING NEWS ============

export const dailyNews = mysqlTable(
  "daily_news",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    titleTelugu: varchar("title_telugu", { length: 500 }),
    titleHindi: varchar("title_hindi", { length: 500 }),
    summary: text("summary").notNull(),
    summaryTelugu: text("summary_telugu"),
    summaryHindi: text("summary_hindi"),
    source: varchar("source", { length: 255 }).notNull(), // e.g., "The Hindu", "Krishak Jagat"
    sourceUrl: varchar("source_url", { length: 1000 }),
    category: mysqlEnum("category", [
      "policy",
      "market",
      "weather",
      "technology",
      "schemes",
      "research",
      "general",
    ])
      .default("general")
      .notNull(),
    state: varchar("state", { length: 100 }), // state-specific news if applicable
    publishedDate: date("published_date"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    sentToFarmers: int("sent_to_farmers").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("news_category_idx").on(table.category),
    index("news_active_idx").on(table.isActive),
    index("news_fetched_idx").on(table.fetchedAt),
  ]
);

export type DailyNews = typeof dailyNews.$inferSelect;
export type InsertDailyNews = typeof dailyNews.$inferInsert;

// ============ ANALYTICS & EVENTS ============

export const analyticsEvents = mysqlTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    eventType: mysqlEnum("event_type", [
      "message_received",
      "message_sent",
      "voice_received",
      "weather_requested",
      "price_requested",
      "scheme_requested",
      "advice_requested",
      "farmer_registered",
      "conversation_started",
      "conversation_ended",
      "error",
    ]).notNull(),
    farmerId: bigint("farmer_id", { mode: "number", unsigned: true }).references(
      () => farmers.id
    ),
    conversationId: bigint("conversation_id", {
      mode: "number",
      unsigned: true,
    }).references(() => conversations.id),
    metadata: json("metadata"), // flexible metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("event_type_idx").on(table.eventType),
    index("event_farmer_idx").on(table.farmerId),
    index("event_created_idx").on(table.createdAt),
  ]
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEvents.$inferInsert;

// ============ AI INTENTS ============

export const aiIntents = mysqlTable(
  "ai_intents",
  {
    id: serial("id").primaryKey(),
    intentName: varchar("intent_name", { length: 255 }).notNull(),
    keywords: varchar("keywords", { length: 1000 }),
    description: text("description"),
    responseTemplate: text("response_template"),
    handlerType: mysqlEnum("handler_type", [
      "weather",
      "market_price",
      "scheme",
      "crop_advice",
      "general",
      "voice",
      "fallback",
    ])
      .default("general")
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    confidence: float("confidence").default(0.8),
    usageCount: int("usage_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("intent_name_idx").on(table.intentName)]
);

export type AiIntent = typeof aiIntents.$inferSelect;
export type InsertAiIntent = typeof aiIntents.$inferInsert;

// ============ SYSTEM SETTINGS ============

export const systemSettings = mysqlTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  category: varchar("category", { length: 100 }).default("general"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

// ============ DAILY BRIEFINGS ============

export const dailyBriefings = mysqlTable(
  "daily_briefings",
  {
    id: serial("id").primaryKey(),
    farmerId: bigint("farmer_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => farmers.id),
    scheduledAt: timestamp("scheduled_at").notNull(),
    sentAt: timestamp("sent_at"),
    status: mysqlEnum("status", ["pending", "sent", "failed", "skipped"])
      .default("pending")
      .notNull(),
    language: mysqlEnum("language", ["telugu", "hindi", "english"])
      .default("english")
      .notNull(),
    weatherIncluded: boolean("weather_included").default(true).notNull(),
    marketPricesIncluded: boolean("market_prices_included").default(true).notNull(),
    schemesIncluded: boolean("schemes_included").default(true).notNull(),
    cropTipIncluded: boolean("crop_tip_included").default(true).notNull(),
    personalizationUsed: boolean("personalization_used").default(false).notNull(),
    generatedMessage: text("generated_message"),
    weatherData: json("weather_data"),
    marketData: json("market_data"),
    schemesReferenced: json("schemes_referenced"),
    cropTipData: json("crop_tip_data"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("briefing_farmer_idx").on(table.farmerId),
    index("briefing_status_idx").on(table.status),
    index("briefing_scheduled_idx").on(table.scheduledAt),
  ]
);

export type DailyBriefing = typeof dailyBriefings.$inferSelect;
export type InsertDailyBriefing = typeof dailyBriefings.$inferInsert;
