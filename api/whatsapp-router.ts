import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { farmers, messages, conversations } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";

// Simulated AI intent detection
function detectIntent(message: string): { intent: string; confidence: number } {
  const lower = message.toLowerCase();
  const intents = [
    { keywords: ["weather", "rain", "temperature", "barish", "mausam", "vaana"], intent: "weather" },
    { keywords: ["price", "rate", "mandi", "bazar", "dhara", "dar"], intent: "market_price" },
    { keywords: ["scheme", "subsidy", "loan", "yojana", "pension", "vaddi"], intent: "scheme" },
    { keywords: ["fertilizer", "pest", "disease", "crop", "panta", "panta paddati"], intent: "crop_advice" },
    { keywords: ["hello", "hi", "namaste", "namaskaram"], intent: "greeting" },
    { keywords: ["voice", "audio", "speak", "vinnapam"], intent: "voice_request" },
  ];

  for (const item of intents) {
    if (item.keywords.some((k) => lower.includes(k))) {
      return { intent: item.intent, confidence: 0.85 + Math.random() * 0.1 };
    }
  }
  return { intent: "general", confidence: 0.6 };
}

// Simulated AI response generator
function generateResponse(intent: string, language: string): string {
  const responses: Record<string, Record<string, string>> = {
    weather: {
      english: "Here's the weather forecast for your area:\n\nToday: 32C, Humidity 65%, Rain probability 20%\nTomorrow: 30C, Rain probability 45%\n\nLight rain expected tomorrow afternoon. Good conditions for field work today.",
      hindi: "Aapke kshetra ke mausam ki jaankari:\n\nAaj: 32C, Nami 65%, Barish ki sambhavna 20%\nKal: 30C, Barish ki sambhavna 45%\n\nKal dopahar mein halki barish ki ashanka hai. Aaj kheti ke kaam ke liye achhe din hain.",
      telugu: "Me priantam vaataavaran samacharam:\n\nEroju: 32C, Tegovata 65%, Varsham avakasam 20%\nRepu: 30C, Varsham avakasam 45%\n\nRepu madhyanam jalla vana sambhavam undi. Eroju panta panulu cheyataniki manchi roju.",
    },
    market_price: {
      english: "Current market prices:\n\nRice: INR 2,150/quintal\nWheat: INR 2,450/quintal\nCotton: INR 6,800/quintal\nGroundnut: INR 5,900/quintal\n\nPrices are trending upward this week. Good time to sell.",
      hindi: "Vartaman bazar bhav:\n\nChawal: INR 2,150/quintal\nGehun: INR 2,450/quintal\nKapas: INR 6,800/quintal\nMoongfali: INR 5,900/quintal\n\nIs hafte bhav badhte hue hain. Bechne ka achha samay hai.",
      telugu: "Praastuta marketu dharalu:\n\nBiyyam: INR 2,150/quintal\nGodhumalu: INR 2,450/quintal\nPathi: INR 6,800/quintal\nVerusenagalu: INR 5,900/quintal\n\nEe vaaram dharalu penchu vaduna unnaay. Ammaniki manchi samayam.",
    },
    scheme: {
      english: "Available government schemes:\n\n1. PM-KISAN: Rs 6,000/year income support\n2. Soil Health Card: Free soil testing\n3. Kisan Credit Card: Low-interest loans at 4%\n4. PMFBY: Crop insurance with 50% subsidy\n\nReply with scheme name for more details.",
      hindi: "Sarkari yojnaayein:\n\n1. PM-KISAN: Rs 6,000/saal aay sahaayta\n2. Soil Health Card: Muft mitti jaanch\n3. Kisan Credit Card: 4% par kam byaaj loan\n4. PMFBY: Fasal bima 50% subsidy ke saath\n\nAur jaankari ke liye yojna ka naam bhejein.",
      telugu: "Praabhutva paddhatulu:\n\n1. PM-KISAN: Rs 6,000/samvatsaram aadaya madad\n2. Soil Health Card: Uchita mruttika pariksha\n3. Kisan Credit Card: 4% takku veyyi runam\n4. PMFBY: 50% subsidy tho panta beema\n\nEkkuva vivaraalaku paddhati peru reply ivvandi.",
    },
    crop_advice: {
      english: "For your crop, here are the recommendations:\n\nFertilizer: Apply NPK 20-20-20 at 50kg/acre\nPest Control: Monitor for stem borer. Use neem-based spray if needed.\nIrrigation: Water every 7-10 days depending on soil moisture.\n\nWould you like advice on a specific crop stage?",
      hindi: "Aapki fasal ke liye salah:\n\nKhud: NPK 20-20-20, 50kg/acre lagayein\nKeet niyantran: Stem borer ki nigraani rakhein. Zaroorat par neem spray istemal karein.\nSinchai: 7-10 din mein paani den, mitti ki nami ke anusaar.\n\nKisi vishesh avastha ki jaankari chahiye?",
      telugu: "Me panta ku sifarsula:\n\nYeruvu: NPK 20-20-20, 50kg/acre vadesi\nPuru niyantranam: Stem borer ku sikan chesi avasaramaithe veppa aaku spray vadandi.\nNiti purugu: 7-10 rojula ku niti ivvandi, mruttika tatavan batti.\n\nKoni visista dasa gurinchi salaha kavala?",
    },
    greeting: {
      english: "Hello! Welcome to AI Farmer Assistant.\n\nI can help you with:\n- Weather updates\n- Market prices\n- Government schemes\n- Farming advice\n\nWhat would you like to know?",
      hindi: "Namaste! AI Farmer Assistant mein aapka swagat hai.\n\nMain aapki madad kar sakta hoon:\n- Mausam ki jaankari\n- Bazar bhav\n- Sarkari yojnaayein\n- Kheti salah\n\nAap kya jaanna chahte hain?",
      telugu: "Namaskaram! AI Farmer Assistant ku swagatam.\n\nNenu meeku sahayam cheyagalan vishayaalu:\n- Vataavaran paridi\n- Marketu dharalu\n- Praabhutva paddhatulu\n- Vyavasaaya salaha\n\nMeeku emi telusukovalani undi?",
    },
    voice_request: {
      english: "I understand you'd like voice support. Please send a voice message and I'll process it for you.",
      hindi: "Main samajh gaya ki aap awaaz sahaayta chahte hain. Kripaya ek voice message bhejein, main usse process karunga.",
      telugu: "Meeku voice sahayam kavalo ardamaindi. Dayachesi oka voice message pampandi, nenu dani process chestanu.",
    },
    general: {
      english: "I understand. I'm here to help farmers with weather, market prices, government schemes, and farming advice.\n\nWhat specific information do you need?",
      hindi: "Main samajh gaya. Main kisaanon ki madad ke liye yahan hoon - mausam, bazar bhav, sarkari yojnaayein, aur kheti salah.\n\nAapko kis vishesh jaankari ki zaroorat hai?",
      telugu: "Ardamaindi. Nenu rytulaku sahayam cheyadaniki vunnaanu - vataavaran, marketu dharalu, praabhutva paddhatulu, mariyu vyavasaaya salaha.\n\nMeeku emi visista samacharam kavali?",
    },
  };

  const langMap: Record<string, string> = {
    telugu: "telugu",
    hindi: "hindi",
    english: "english",
  };

  const lang = langMap[language] ?? "english";
  const intentResponses = responses[intent] ?? responses.general;
  return intentResponses[lang] ?? intentResponses.english;
}

export const whatsappRouter = createRouter({
  // Simulate receiving a WhatsApp message (webhook)
  receiveMessage: publicQuery
    .input(
      z.object({
        phoneNumber: z.string(),
        message: z.string(),
        contentType: z.enum(["text", "voice", "image"]).default("text"),
        mediaUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Find or create farmer
      let farmer = await db
        .select()
        .from(farmers)
        .where(eq(farmers.phoneNumber, input.phoneNumber))
        .limit(1);

      let farmerId: number;

      if (!farmer[0]) {
        // Auto-register new farmer
        const result = await db.insert(farmers).values({
          phoneNumber: input.phoneNumber,
          preferredLanguage: "english",
          isActive: true,
        });
        farmerId = Number(result[0].insertId);
      } else {
        farmerId = farmer[0].id;
      }

      // Find or create active conversation
      let conversation = await db
        .select()
        .from(conversations)
        .where(
          sql`${conversations.farmerId} = ${farmerId} AND ${conversations.status} = 'active'`
        )
        .orderBy(desc(conversations.createdAt))
        .limit(1);

      let conversationId: number;

      if (!conversation[0]) {
        const result = await db.insert(conversations).values({
          farmerId,
          status: "active",
        });
        conversationId = Number(result[0].insertId);
      } else {
        conversationId = conversation[0].id;
      }

      // Detect intent
      const { intent, confidence } = detectIntent(input.message);

      // Save farmer message
      const lang = farmer[0]?.preferredLanguage ?? "english";
      await db.insert(messages).values({
        conversationId,
        farmerId,
        senderType: "farmer",
        contentType: input.contentType,
        content: input.message,
        mediaUrl: input.mediaUrl,
        language: lang,
        intentDetected: intent,
      });

      // Generate AI response
      const aiResponse = generateResponse(intent, lang);

      // Save AI response
      await db.insert(messages).values({
        conversationId,
        farmerId,
        senderType: "ai",
        contentType: "text",
        content: aiResponse,
        language: lang,
        aiResponse,
        intentDetected: intent,
      });

      // Update conversation
      await db
        .update(conversations)
        .set({
          intent,
          messageCount: sql`${conversations.messageCount} + 2`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));

      // Update farmer stats
      await db
        .update(farmers)
        .set({
          totalInteractions: sql`${farmers.totalInteractions} + 1`,
          lastInteractionAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(farmers.id, farmerId));

      return {
        success: true,
        farmerId,
        conversationId,
        intent,
        confidence,
        aiResponse,
        language: lang,
      };
    }),

  // Get simulated response without saving
  simulateResponse: publicQuery
    .input(
      z.object({
        message: z.string(),
        language: z.enum(["telugu", "hindi", "english"]).default("english"),
      })
    )
    .mutation(async ({ input }) => {
      const { intent, confidence } = detectIntent(input.message);
      const aiResponse = generateResponse(intent, input.language);

      return {
        intent,
        confidence,
        aiResponse,
        language: input.language,
      };
    }),

  // Get webhook status/info
  status: publicQuery.query(() => {
    return {
      status: "active",
      webhookUrl: "/api/trpc/whatsapp.receiveMessage",
      supportedContentTypes: ["text", "voice", "image"],
      supportedLanguages: ["telugu", "hindi", "english"],
      features: [
        "intent_detection",
        "multilingual_responses",
        "weather_info",
        "market_prices",
        "government_schemes",
        "crop_advice",
        "voice_support",
      ],
    };
  }),
});
