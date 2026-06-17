import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { getDb } from "./queries/connection";
import { farmers, messages, conversations } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// ============ WHATSAPP WEBHOOK HTTP ENDPOINT ============
// WhatsApp sends raw HTTP requests (NOT tRPC), so we need a Hono route

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "farmer_verify_123";

// 1. Verification endpoint (GET) — Facebook calls this to verify the webhook
app.get("/api/webhook/whatsapp", async (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WhatsApp] Webhook verified successfully");
    return c.text(challenge ?? "OK");
  }

  return c.json({ error: "Verification failed" }, 403);
});

// 2. Message receiving endpoint (POST) — WhatsApp sends messages here
app.post("/api/webhook/whatsapp", async (c) => {
  try {
    const body = await c.req.json();
    console.log("[WhatsApp] Received webhook:", JSON.stringify(body, null, 2));

    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        const messages_data = change.value?.messages ?? [];
        for (const msg of messages_data) {
          const from = msg.from;           // Sender's phone number
          const text = msg.text?.body ?? ""; // Message text
          const type = msg.type ?? "text";   // Message type

          if (text) {
            await processIncomingMessage(from, text, type);
          }
        }
      }
    }

    return c.json({ status: "ok" });
  } catch (err: any) {
    console.error("[WhatsApp] Webhook error:", err.message);
    return c.json({ status: "error", message: err.message }, 500);
  }
});

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber: string, message: string, contentType: string) {
  const db = getDb();

  // 1. Find or create farmer
  let farmer = await db.select().from(farmers).where(eq(farmers.phoneNumber, phoneNumber)).limit(1);

  let farmerId: number;
  if (!farmer[0]) {
    const result = await db.insert(farmers).values({
      phoneNumber,
      preferredLanguage: "english",
      isActive: true,
    });
    farmerId = Number(result[0].insertId);
    console.log(`[WhatsApp] New farmer registered: ${phoneNumber}`);
  } else {
    farmerId = farmer[0].id;
  }

  // 2. Find or create active conversation
  let conversation = await db.select().from(conversations)
    .where(sql`${conversations.farmerId} = ${farmerId} AND ${conversations.status} = 'active'`)
    .orderBy(desc(conversations.createdAt)).limit(1);

  let conversationId: number;
  if (!conversation[0]) {
    const result = await db.insert(conversations).values({ farmerId, status: "active" });
    conversationId = Number(result[0].insertId);
  } else {
    conversationId = conversation[0].id;
  }

  // 3. Detect intent
  const intent = detectIntent(message);

  // 4. Generate AI response
  const lang = farmer[0]?.preferredLanguage ?? "english";
  const aiResponse = generateAIResponse(intent, lang);

  // 5. Save farmer message
  await db.insert(messages).values({
    conversationId, farmerId, senderType: "farmer",
    contentType: contentType as "text" | "voice" | "image" | "template",
    content: message, language: lang, intentDetected: intent,
  });

  // 6. Save AI response
  await db.insert(messages).values({
    conversationId, farmerId, senderType: "ai",
    contentType: "text", content: aiResponse,
    language: lang, aiResponse, intentDetected: intent,
  });

  // 7. Update conversation
  await db.update(conversations).set({
    intent, messageCount: sql`${conversations.messageCount} + 2`, updatedAt: new Date(),
  }).where(eq(conversations.id, conversationId));

  // 8. Update farmer stats
  await db.update(farmers).set({
    totalInteractions: sql`${farmers.totalInteractions} + 1`,
    lastInteractionAt: new Date(), updatedAt: new Date(),
  }).where(eq(farmers.id, farmerId));

  console.log(`[WhatsApp] Processed message from ${phoneNumber}: intent=${intent}`);
}

function detectIntent(message: string): string {
  const lower = message.toLowerCase();
  const intents = [
    { keywords: ["weather", "rain", "temperature", "barish", "mausam", "vaana"], intent: "weather" },
    { keywords: ["price", "rate", "mandi", "bazar", "dhara", "dar"], intent: "market_price" },
    { keywords: ["scheme", "subsidy", "loan", "yojana", "pension"], intent: "scheme" },
    { keywords: ["fertilizer", "pest", "disease", "crop", "panta"], intent: "crop_advice" },
    { keywords: ["hello", "hi", "namaste", "namaskaram"], intent: "greeting" },
    { keywords: ["voice", "audio", "speak"], intent: "voice_request" },
  ];
  for (const item of intents) {
    if (item.keywords.some((k) => lower.includes(k))) return item.intent;
  }
  return "general";
}

function generateAIResponse(intent: string, lang: string): string {
  const responses: Record<string, Record<string, string>> = {
    weather: {
      english: "Here's the weather forecast for your area:\n\nToday: 32C, Humidity 65%, Rain probability 20%\nTomorrow: 30C, Rain probability 45%\n\nLight rain expected tomorrow afternoon. Good conditions for field work today.",
      hindi: "Aapke kshetra ke mausam ki jaankari:\n\nAaj: 32C, Nami 65%, Barish ki sambhavna 20%\nKal: 30C, Barish ki sambhavna 45%\n\nKal dopahar mein halki barish ki ashanka hai.",
      telugu: "Me priantam vaataavaran samacharam:\n\nEroju: 32C, Tegovata 65%, Varsham avakasam 20%\nRepu: 30C, Varsham avakasam 45%\n\nRepu madhyanam jalla vana sambhavam undi.",
    },
    market_price: {
      english: "Current market prices:\n\nRice: INR 2,150/quintal\nWheat: INR 2,450/quintal\nCotton: INR 6,800/quintal\n\nPrices are trending upward this week. Good time to sell.",
      hindi: "Vartaman bazar bhav:\n\nChawal: INR 2,150/quintal\nGehun: INR 2,450/quintal\nKapas: INR 6,800/quintal\n\nIs hafte bhav badhte hue hain. Bechne ka achha samay hai.",
      telugu: "Praastuta marketu dharalu:\n\nBiyyam: INR 2,150/quintal\nGodhumalu: INR 2,450/quintal\nPathi: INR 6,800/quintal\n\nEe vaaram dharalu penchu vaduna unnaay.",
    },
    scheme: {
      english: "Available government schemes:\n\n1. PM-KISAN: Rs 6,000/year income support\n2. Soil Health Card: Free soil testing\n3. Kisan Credit Card: Low-interest loans at 4%\n4. PMFBY: Crop insurance with 50% subsidy\n\nReply with scheme name for more details.",
      hindi: "Sarkari yojnaayein:\n\n1. PM-KISAN: Rs 6,000/saal aay sahaayta\n2. Soil Health Card: Muft mitti jaanch\n3. Kisan Credit Card: 4% par kam byaaj loan\n4. PMFBY: Fasal bima 50% subsidy ke saath\n\nAur jaankari ke liye yojna ka naam bhejein.",
      telugu: "Praabhutva paddhatulu:\n\n1. PM-KISAN: Rs 6,000/samvatsaram aadaya madad\n2. Soil Health Card: Uchita mruttika pariksha\n3. Kisan Credit Card: 4% takku veyyi runam\n4. PMFBY: 50% subsidy tho panta beema\n\nEkkuva vivaraalaku paddhati peru reply ivvandi.",
    },
    crop_advice: {
      english: "For your crop, here are the recommendations:\n\nFertilizer: Apply NPK 20-20-20 at 50kg/acre\nPest Control: Monitor for stem borer. Use neem-based spray if needed.\nIrrigation: Water every 7-10 days depending on soil moisture.\n\nWould you like advice on a specific crop stage?",
      hindi: "Aapki fasal ke liye salah:\n\nKhud: NPK 20-20-20, 50kg/acre lagayein\nKeet niyantran: Stem borer ki nigraani rakhein. Neem spray istemal karein.\nSinchai: 7-10 din mein paani den.\n\nKisi vishesh avastha ki jaankari chahiye?",
      telugu: "Me panta ku sifarsula:\n\nYeruvu: NPK 20-20-20, 50kg/acre vadesi\nPuru niyantranam: Stem borer ku sikan chesi.\nNiti purugu: 7-10 rojula ku niti ivvandi.\n\nKoni visista dasa gurinchi salaha kavala?",
    },
    greeting: {
      english: "Hello! Welcome to AI Farmer Assistant.\n\nI can help you with:\n- Weather updates\n- Market prices\n- Government schemes\n- Farming advice\n\nWhat would you like to know?",
      hindi: "Namaste! AI Farmer Assistant mein aapka swagat hai.\n\nMain aapki madad kar sakta hoon:\n- Mausam ki jaankari\n- Bazar bhav\n- Sarkari yojnaayein\n- Kheti salah\n\nAap kya jaanna chahte hain?",
      telugu: "Namaskaram! AI Farmer Assistant ku swagatam.\n\nNenu meeku sahayam cheyagalan vishayaalu:\n- Vataavaran paridi\n- Marketu dharalu\n- Praabhutva paddhatulu\n- Vyavasaaya salaha\n\nMeeku emi telusukovalani undi?",
    },
    general: {
      english: "I understand. I'm here to help farmers with weather, market prices, government schemes, and farming advice.\n\nWhat specific information do you need?",
      hindi: "Main samajh gaya. Main kisaanon ki madad ke liye yahan hoon.\n\nAapko kis vishesh jaankari ki zaroorat hai?",
      telugu: "Ardamaindi. Nenu rytulaku sahayam cheyadaniki vunnaanu.\n\nMeeku emi visista samacharam kavali?",
    },
  };

  const langMap: Record<string, string> = { telugu: "telugu", hindi: "hindi", english: "english" };
  const responsesForIntent = responses[intent] ?? responses.general;
  return responsesForIntent[langMap[lang] ?? "english"] ?? responsesForIntent.english;
}

// ============ tRPC ROUTER ============
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
