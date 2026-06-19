import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { farmersRouter } from "./farmers-router";
import { conversationsRouter } from "./conversations-router";
import { messagesRouter } from "./messages-router";
import { marketPricesRouter } from "./market-prices-router";
import { schemesRouter } from "./schemes-router";
import { weatherRouter } from "./weather-router";
import { cropKnowledgeRouter } from "./crop-knowledge-router";
import { analyticsRouter } from "./analytics-router";
import { aiIntentsRouter } from "./ai-intents-router";
import { settingsRouter } from "./settings-router";
import { whatsappRouter } from "./whatsapp-router";
import { briefingsRouter } from "./briefings-router";
import { localAuthRouter } from "./local-auth-router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  localAuth: localAuthRouter,
  farmers: farmersRouter,
  conversations: conversationsRouter,
  messages: messagesRouter,
  marketPrices: marketPricesRouter,
  schemes: schemesRouter,
  weather: weatherRouter,
  cropKnowledge: cropKnowledgeRouter,
  analytics: analyticsRouter,
  aiIntents: aiIntentsRouter,
  settings: settingsRouter,
  whatsapp: whatsappRouter,
  briefings: briefingsRouter,
});

export type AppRouter = typeof appRouter;
