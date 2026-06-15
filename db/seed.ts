import { getDb } from "../api/queries/connection";
import {
  farmers,
  conversations,
  messages,
  marketPrices,
  governmentSchemes,
  weatherCache,
  cropKnowledge,
  aiIntents,
} from "./schema";

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // Seed farmers
  const farmerData = [
    { phoneNumber: "+919876543210", name: "Ramesh Kumar", preferredLanguage: "hindi" as const, location: "Nizamabad", district: "Nizamabad", state: "Telangana", landSize: 5.5, primaryCrop: "Rice" },
    { phoneNumber: "+919876543211", name: "Lakshmi Devi", preferredLanguage: "telugu" as const, location: "Guntur", district: "Guntur", state: "Andhra Pradesh", landSize: 3.2, primaryCrop: "Cotton" },
    { phoneNumber: "+919876543212", name: "Suresh Reddy", preferredLanguage: "telugu" as const, location: "Karimnagar", district: "Karimnagar", state: "Telangana", landSize: 8.0, primaryCrop: "Soybean" },
    { phoneNumber: "+919876543213", name: "Priya Patel", preferredLanguage: "english" as const, location: "Anand", district: "Anand", state: "Gujarat", landSize: 12.5, primaryCrop: "Wheat" },
    { phoneNumber: "+919876543214", name: "Mohammed Ali", preferredLanguage: "hindi" as const, location: "Lucknow", district: "Lucknow", state: "Uttar Pradesh", landSize: 4.0, primaryCrop: "Sugarcane" },
    { phoneNumber: "+919876543215", name: "Anita Sharma", preferredLanguage: "hindi" as const, location: "Jaipur", district: "Jaipur", state: "Rajasthan", landSize: 6.8, primaryCrop: "Bajra" },
    { phoneNumber: "+919876543216", name: "Krishna Rao", preferredLanguage: "telugu" as const, location: "Warangal", district: "Warangal", state: "Telangana", landSize: 10.0, primaryCrop: "Chilli" },
    { phoneNumber: "+919876543217", name: "David Thomas", preferredLanguage: "english" as const, location: "Kochi", district: "Ernakulam", state: "Kerala", landSize: 2.5, primaryCrop: "Coconut" },
  ];

  for (const f of farmerData) {
    try {
      await db.insert(farmers).values(f);
      console.log(`  Added farmer: ${f.name}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  // Seed market prices
  const priceData = [
    { commodity: "Rice", variety: "Sona Masoori", mandiName: "Hyderabad", district: "Ranga Reddy", state: "Telangana", pricePerQuintal: 2150, minPrice: 2100, maxPrice: 2200, priceTrend: "up" as const, source: "Agmarknet" },
    { commodity: "Wheat", variety: "Lokwan", mandiName: "Indore", district: "Indore", state: "Madhya Pradesh", pricePerQuintal: 2450, minPrice: 2400, maxPrice: 2500, priceTrend: "stable" as const, source: "Agmarknet" },
    { commodity: "Cotton", variety: "Shankar-6", mandiName: "Rajkot", district: "Rajkot", state: "Gujarat", pricePerQuintal: 6800, minPrice: 6700, maxPrice: 6900, priceTrend: "down" as const, source: "Agmarknet" },
    { commodity: "Groundnut", variety: "Bold", mandiName: "Guntur", district: "Guntur", state: "Andhra Pradesh", pricePerQuintal: 5900, minPrice: 5800, maxPrice: 6000, priceTrend: "up" as const, source: "Agmarknet" },
    { commodity: "Soybean", variety: "Yellow", mandiName: "Nagpur", district: "Nagpur", state: "Maharashtra", pricePerQuintal: 4200, minPrice: 4100, maxPrice: 4300, priceTrend: "stable" as const, source: "Agmarknet" },
    { commodity: "Turmeric", variety: "Salem", mandiName: "Nizamabad", district: "Nizamabad", state: "Telangana", pricePerQuintal: 8500, minPrice: 8400, maxPrice: 8600, priceTrend: "up" as const, source: "Agmarknet" },
    { commodity: "Chilli", variety: "Guntur Sannam", mandiName: "Guntur", district: "Guntur", state: "Andhra Pradesh", pricePerQuintal: 12000, minPrice: 11800, maxPrice: 12200, priceTrend: "down" as const, source: "Agmarknet" },
    { commodity: "Sugarcane", variety: "CO-0238", mandiName: "Meerut", district: "Meerut", state: "Uttar Pradesh", pricePerQuintal: 340, minPrice: 330, maxPrice: 350, priceTrend: "stable" as const, source: "Direct" },
    { commodity: "Maize", variety: "Hybrid", mandiName: "Adoni", district: "Kurnool", state: "Andhra Pradesh", pricePerQuintal: 2100, minPrice: 2050, maxPrice: 2150, priceTrend: "up" as const, source: "Agmarknet" },
    { commodity: "Bajra", variety: "Hybrid", mandiName: "Jaipur", district: "Jaipur", state: "Rajasthan", pricePerQuintal: 2350, minPrice: 2300, maxPrice: 2400, priceTrend: "stable" as const, source: "Agmarknet" },
  ];

  for (const p of priceData) {
    try {
      await db.insert(marketPrices).values({ ...p, priceDate: new Date() });
      console.log(`  Added price: ${p.commodity} @ ${p.mandiName}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  // Seed government schemes
  const schemeData = [
    { title: "PM-KISAN", titleHindi: "पीएम-किसान", titleTelugu: "పీఎం-కిసాన్", category: "grant" as const, description: "Income support of Rs 6,000 per year to farmer families", eligibility: "Small and marginal farmers with less than 2 hectares", benefits: "Rs 6,000/year in 3 installments", documentsRequired: "Aadhaar, Land records, Bank passbook" },
    { title: "Soil Health Card Scheme", titleHindi: "स्वस्थ मृदा कार्ड योजना", titleTelugu: "మృద ఆరోగ్య కార్డ్ పథకం", category: "subsidy" as const, description: "Free soil testing and health card issuance", eligibility: "All farmers", benefits: "Soil test report and crop-specific recommendations", documentsRequired: "Aadhaar, Land documents" },
    { title: "Kisan Credit Card", titleHindi: "किसान क्रेडिट कार्ड", titleTelugu: "రైతు క్రెడిట్ కార్డ్", category: "loan" as const, description: "Short-term credit at 4% interest for farmers", eligibility: "All farmers, tenant farmers, sharecroppers", benefits: "Loan up to Rs 3 lakh at 4% interest", documentsRequired: "Aadhaar, Land records, Photo" },
    { title: "PMFBY Crop Insurance", titleHindi: "प्रधानमंत्री फसल बीमा योजना", titleTelugu: "ప్రధానమంత్రి పంట బీమా పథకం", category: "insurance" as const, description: "Comprehensive crop insurance with 50% subsidy on premium", eligibility: "All farmers growing notified crops", benefits: "Full coverage against crop loss with subsidized premium", documentsRequired: "Aadhaar, Land records, Sowing certificate" },
    { title: "Agricultural Equipment Subsidy", titleHindi: "कृषि उपकरण अनुदान", titleTelugu: "వ్యవసాయ పరికరాల సబ్సిడీ", category: "equipment" as const, description: "40-50% subsidy on farm machinery purchase", eligibility: "Individual farmers, FPOs, Cooperatives", benefits: "Up to 50% subsidy on tractors, harvesters, etc.", documentsRequired: "Aadhaar, Land records, Quotation from dealer" },
    { title: "MIDH Horticulture Mission", titleHindi: "एमआईडीएच बागवानी मिशन", titleTelugu: "ఎంఐడీహెచ్ తోటపని మిషన్", category: "subsidy" as const, description: "Subsidy for horticulture crops and post-harvest infrastructure", eligibility: "Farmers growing fruits, vegetables, spices", benefits: "50% subsidy on planting material and infrastructure", documentsRequired: "Aadhaar, Land documents, Bank details" },
  ];

  for (const s of schemeData) {
    try {
      await db.insert(governmentSchemes).values(s);
      console.log(`  Added scheme: ${s.title}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  // Seed weather data
  const weatherData = [
    { location: "Hyderabad", district: "Ranga Reddy", state: "Telangana", temperature: 32, feelsLike: 35, humidity: 65, windSpeed: 12, rainProbability: 20, weatherCondition: "Partly cloudy" },
    { location: "Hyderabad", district: "Ranga Reddy", state: "Telangana", temperature: 30, feelsLike: 33, humidity: 70, windSpeed: 14, rainProbability: 45, weatherCondition: "Light rain expected", forecastDays: 1 },
    { location: "Guntur", district: "Guntur", state: "Andhra Pradesh", temperature: 34, feelsLike: 38, humidity: 58, windSpeed: 10, rainProbability: 10, weatherCondition: "Sunny" },
    { location: "Lucknow", district: "Lucknow", state: "Uttar Pradesh", temperature: 28, feelsLike: 30, humidity: 72, windSpeed: 8, rainProbability: 60, weatherCondition: "Thunderstorms likely" },
    { location: "Jaipur", district: "Jaipur", state: "Rajasthan", temperature: 36, feelsLike: 38, humidity: 35, windSpeed: 15, rainProbability: 5, weatherCondition: "Hot and dry" },
    { location: "Indore", district: "Indore", state: "Madhya Pradesh", temperature: 31, feelsLike: 34, humidity: 62, windSpeed: 11, rainProbability: 30, weatherCondition: "Partly cloudy" },
  ];

  for (const w of weatherData) {
    try {
      await db.insert(weatherCache).values({
        ...w,
        forecastDate: new Date(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      });
      console.log(`  Added weather: ${w.location}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  // Seed crop knowledge
  const knowledgeData = [
    { cropName: "Rice", cropNameTelugu: "బియ్యం", cropNameHindi: "चावल", category: "planting" as const, title: "Best time for paddy planting", content: "Plant paddy during June-July for Kharif season. Use 20-25 day old seedlings. Maintain 2-3 cm water depth during transplantation. Space seedlings 20x15 cm apart.", stage: "Transplanting", season: "Kharif", tags: "paddy,rice,planting,monsoon" },
    { cropName: "Rice", cropNameTelugu: "బియ్యం", cropNameHindi: "चावल", category: "fertilizer" as const, title: "Fertilizer schedule for paddy", content: "Apply basal dose: 40kg N, 20kg P, 20kg K per acre. Top dress with 20kg N at tillering and 20kg N at panicle initiation. Use neem-coated urea for better efficiency.", stage: "Vegetative", season: "Kharif", tags: "paddy,fertilizer,NPK,urea" },
    { cropName: "Cotton", cropNameTelugu: "పత్తి", cropNameHindi: "कपास", category: "pest_control" as const, title: "Managing pink bollworm in cotton", content: "Monitor for pink bollworm from flowering stage. Use pheromone traps (5/acre). Spray NSKE 5% or Bacillus thuringiensis at 15-day intervals. Avoid excessive nitrogen which attracts pests.", stage: "Flowering", season: "Kharif", tags: "cotton,pink bollworm,IPM,organic" },
    { cropName: "Wheat", cropNameTelugu: "గోధుమ", cropNameHindi: "गेहूं", category: "irrigation" as const, title: "Irrigation management for wheat", content: "Wheat needs 4-5 irrigations. Critical stages: Crown root initiation (20 DAS), tillering (40 DAS), flowering (70 DAS), and grain filling (90 DAS). Avoid waterlogging.", stage: "Vegetative", season: "Rabi", tags: "wheat,irrigation,Rabi,water" },
    { cropName: "Chilli", cropNameTelugu: "మిర్చి", cropNameHindi: "मिर्च", category: "harvesting" as const, title: "When to harvest chilli", content: "Harvest when fruits turn dark red and fully mature. Pick at 10-15 day intervals. Dry in shade for 3-4 days. Store at 8-10% moisture content for better shelf life.", stage: "Maturity", season: "Year-round", tags: "chilli,harvesting,drying,storage" },
    { cropName: "Groundnut", cropNameTelugu: "వేరుశెనగ", cropNameHindi: "मूंगफली", category: "planting" as const, title: "Groundnut planting guide", content: "Sow at 30x10 cm spacing, 5-6 cm depth. Use 80-100 kg seed per acre. Treat seeds with Rhizobium culture. Best sowing time: June-July (Kharif) or January (Rabi).", stage: "Sowing", season: "Kharif", tags: "groundnut,planting,Rhizobium,seeds" },
  ];

  for (const k of knowledgeData) {
    try {
      await db.insert(cropKnowledge).values(k);
      console.log(`  Added knowledge: ${k.title}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  // Seed AI intents
  const intentData = [
    { intentName: "weather_query", keywords: "weather,rain,temperature,mausam,vaana,barish", handlerType: "weather" as const, description: "User asking about weather conditions", responseTemplate: "Here's the weather forecast for your area:", confidence: 0.9 },
    { intentName: "price_query", keywords: "price,rate,mandi,bazar,dhara,bhav", handlerType: "market_price" as const, description: "User asking about commodity prices", responseTemplate: "Current market prices are:", confidence: 0.85 },
    { intentName: "scheme_query", keywords: "scheme,subsidy,loan,yojana,pension", handlerType: "scheme" as const, description: "User asking about government schemes", responseTemplate: "Available schemes for farmers:", confidence: 0.85 },
    { intentName: "crop_advice", keywords: "fertilizer,pest,disease,crop,panta,paddati", handlerType: "crop_advice" as const, description: "User asking farming advice", responseTemplate: "For your crop, here are recommendations:", confidence: 0.8 },
    { intentName: "greeting", keywords: "hello,hi,namaste,namaskaram", handlerType: "general" as const, description: "User greeting", responseTemplate: "Hello! Welcome to AI Farmer Assistant.", confidence: 0.95 },
    { intentName: "voice_request", keywords: "voice,audio,speak,vinnapam", handlerType: "voice" as const, description: "User requesting voice support", responseTemplate: "Please send a voice message.", confidence: 0.9 },
    { intentName: "fallback", keywords: "", handlerType: "fallback" as const, description: "When no intent matches", responseTemplate: "I'm not sure I understood. I can help with weather, prices, schemes, and farming advice.", confidence: 0.5 },
  ];

  for (const i of intentData) {
    try {
      await db.insert(aiIntents).values(i);
      console.log(`  Added intent: ${i.intentName}`);
    } catch (e) {
      // Skip duplicates
    }
  }

  console.log("Seeding complete!");
}

seed().catch(console.error);
