import { getDb } from "../api/queries/connection";
import {
  marketPrices,
  governmentSchemes,
  cropKnowledge,
  aiIntents,
  localUsers,
} from "./schema";
import { sql } from "drizzle-orm";

async function seed() {
  const db = getDb();
  console.log("🌱 Seeding database...");

  // ============ 1. SEED LOCAL ADMIN USER ============
  const existingAdmin = await db.select().from(localUsers).limit(1);
  if (existingAdmin.length === 0) {
    console.log("  Creating admin user...");
    await db.insert(localUsers).values({
      username: "admin",
      passwordHash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      displayName: "Admin",
      role: "admin",
    });
  }

  // ============ 2. SEED MARKET PRICES ============
  const existingPrices = await db.select({ count: sql<number>`count(*)` }).from(marketPrices);
  if ((existingPrices[0]?.count ?? 0) === 0) {
    console.log("  Seeding market prices...");
    const pricesData = [
      { commodity: "Rice", variety: "Sona Masoori", mandiName: "Kurnool", district: "Kurnool", state: "Andhra Pradesh", pricePerQuintal: 2150, minPrice: 2100, maxPrice: 2200, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Rice", variety: "Sona Masoori", mandiName: "Bangalore", district: "Bangalore Urban", state: "Karnataka", pricePerQuintal: 2280, minPrice: 2200, maxPrice: 2350, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Agmarknet" },
      { commodity: "Wheat", variety: "Lokwan", mandiName: "Indore", district: "Indore", state: "Madhya Pradesh", pricePerQuintal: 2450, minPrice: 2400, maxPrice: 2500, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Wheat", variety: "Sharbati", mandiName: "Sehore", district: "Sehore", state: "Madhya Pradesh", pricePerQuintal: 2600, minPrice: 2550, maxPrice: 2650, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Agmarknet" },
      { commodity: "Cotton", variety: "Shankar-6", mandiName: "Rajkot", district: "Rajkot", state: "Gujarat", pricePerQuintal: 6800, minPrice: 6700, maxPrice: 6900, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "down" as const, source: "Agmarknet" },
      { commodity: "Cotton", variety: "MCU-5", mandiName: "Adoni", district: "Kurnool", state: "Andhra Pradesh", pricePerQuintal: 7200, minPrice: 7100, maxPrice: 7300, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Groundnut", variety: "G-20", mandiName: "Guntur", district: "Guntur", state: "Andhra Pradesh", pricePerQuintal: 5800, minPrice: 5700, maxPrice: 5900, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Agmarknet" },
      { commodity: "Groundnut", variety: "G-20", mandiName: "Bellary", district: "Bellary", state: "Karnataka", pricePerQuintal: 5900, minPrice: 5800, maxPrice: 6000, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Turmeric", variety: "Salem", mandiName: "Nizamabad", district: "Nizamabad", state: "Telangana", pricePerQuintal: 8500, minPrice: 8400, maxPrice: 8600, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Chilli", variety: "Guntur Sannam", mandiName: "Guntur", district: "Guntur", state: "Andhra Pradesh", pricePerQuintal: 12000, minPrice: 11800, maxPrice: 12200, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Agmarknet" },
      { commodity: "Onion", variety: "Red", mandiName: "Lasalgaon", district: "Nashik", state: "Maharashtra", pricePerQuintal: 1800, minPrice: 1700, maxPrice: 1900, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "down" as const, source: "Agmarknet" },
      { commodity: "Tomato", variety: "Hybrid", mandiName: "Kolar", district: "Kolar", state: "Karnataka", pricePerQuintal: 2400, minPrice: 2200, maxPrice: 2600, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Maize", variety: "Yellow", mandiName: "Davanagere", district: "Davanagere", state: "Karnataka", pricePerQuintal: 2100, minPrice: 2050, maxPrice: 2150, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Agmarknet" },
      { commodity: "Soybean", variety: "JS-335", mandiName: "Indore", district: "Indore", state: "Madhya Pradesh", pricePerQuintal: 4200, minPrice: 4100, maxPrice: 4300, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "up" as const, source: "Agmarknet" },
      { commodity: "Sugarcane", variety: "CO-0238", mandiName: "Pune", district: "Pune", state: "Maharashtra", pricePerQuintal: 340, minPrice: 330, maxPrice: 350, currency: "INR", unit: "Quintal", priceDate: new Date("2026-06-25"), priceTrend: "stable" as const, source: "Fair Remunerative Price" },
    ];
    await db.insert(marketPrices).values(pricesData);
    console.log(`    ${pricesData.length} prices inserted`);
  }

  // ============ 3. SEED GOVERNMENT SCHEMES ============
  const existingSchemes = await db.select({ count: sql<number>`count(*)` }).from(governmentSchemes);
  if ((existingSchemes[0]?.count ?? 0) === 0) {
    console.log("  Seeding government schemes...");
    const schemesData = [
      { title: "PM-KISAN", titleTelugu: "పీఎం-కిసాన్", titleHindi: "पीएम-किसान", description: "Rs 6,000 per year income support to farmer families. Amount is transferred in three installments of Rs 2,000 directly to bank account.", descriptionTelugu: "రైతు కుటుంబాలకు సంవత్సరానికి రూ.6,000 ఆదాయ మద్దతు. రూ.2,000 చొప్పున మూడు కిస్తులుగా నేరుగా బ్యాంకు ఖాతాకు బదిలీ.", descriptionHindi: "किसान परिवारों को सालाना 6,000 रुपये की आय सहायता। 2,000 रुपये की तीन किश्तों में सीधे बैंक खाते में स्थानांतरित।", category: "grant" as const, eligibility: "All farmer families with cultivable land", benefits: "Rs 6,000/year", documentsRequired: "Aadhaar, Land records, Bank account", applicationProcess: "Apply online at pmkisan.gov.in or visit CSC center", department: "Ministry of Agriculture" },
      { title: "Soil Health Card Scheme", titleTelugu: "నేల ఆరోగ్య కార్డు పథకం", titleHindi: "स्वस्थ मृदा कार्ड योजना", description: "Free soil testing and recommendation of nutrients/fertilizers based on soil quality for improved productivity.", descriptionTelugu: "ఉత్పాదకత పెంచడానికి నేల నాణ్యత ఆధారంగా ఉచిత నేల పరీక్ష మరియు పోషకాలు/ఎరువుల సిఫార్సు.", descriptionHindi: "उत्पादकता बढ़ाने के लिए मिट्टी की गुणवत्ता के आधार पर मुफ्त मिट्टी परीक्षण और उर्वरकों की सिफारिश।", category: "grant" as const, eligibility: "All farmers", benefits: "Free soil testing every 2 years", documentsRequired: "Aadhaar, Land details", applicationProcess: "Register at agriculture department or Krishi Vigyan Kendra" },
      { title: "Kisan Credit Card (KCC)", titleTelugu: "రైతు క్రెడిట్ కార్డు", titleHindi: "किसान क्रेडिट कार्ड", description: "Short-term crop loan at 4% interest rate for farmers. Covers cultivation expenses, post-harvest needs, and marketing.", descriptionTelugu: "రైతులకు 4% వడ్డీ రేటుతో స్వల్పకాలిక పంట రుణం. సాగు ఖర్చులు, కోత తర్వాత అవసరాలు మరియు మార్కెటింగ్ కవర్ చేస్తుంది.", descriptionHindi: "किसानों के लिए 4% ब्याज दर पर अल्पकालिक फसल ऋण। खेती के खर्च, कटाई के बाद की जरूरतों और विपणन को कवर करता है।", category: "loan" as const, eligibility: "Farmers, tenant farmers, sharecroppers", benefits: "Loan up to Rs 3 lakh at 4% interest", documentsRequired: "Aadhaar, Land records, Bank account" },
      { title: "PM Fasal Bima Yojana (PMFBY)", titleTelugu: "పీఎం ఫసల్ బీమా యోజన", titleHindi: "पीएम फसल बीमा योजना", description: "Crop insurance with subsidized premium. Farmers pay only 1.5-5% of premium depending on crop type.", descriptionTelugu: "రైతులకు మాత్రమే 1.5-5% ప్రీమియం చెల్లించే పంట బీమా. పంట రకం ఆధారంగా మారుతుంది.", descriptionHindi: "सब्सिडी वाला फसल बीमा। किसान केवल 1.5-5% प्रीमियम देते हैं।", category: "insurance" as const, eligibility: "All farmers growing notified crops", benefits: "Full crop loss coverage at subsidized premium", documentsRequired: "Aadhaar, Land records, Sowing certificate" },
      { title: "National Horticulture Mission", titleTelugu: "నేషనల్ హార్టికల్చర్ మిషన్", titleHindi: "राष्ट्रीय बागवानी मिशन", description: "Promotes holistic growth of horticulture sector through area-based regionally differentiated strategies.", descriptionTelugu: "ప్రాంతీయ వ్యత్యాస战略 ద్వారా పుష్పోద్యాన రంగం యొక్క సమగ్ర వృద్ధిని ప్రోత్సహిస్తుంది.", descriptionHindi: "क्षेत्रीय रणनीतियों के माध्यम से बागवानी क्षेत्र के समग्र विकास को बढ़ावा देता है।", category: "subsidy" as const, eligibility: "Farmers growing fruits, vegetables, spices, flowers", benefits: "50% subsidy on planting material and equipment", documentsRequired: "Aadhaar, Land records" },
      { title: "Paramparagat Krishi Vikas Yojana", titleTelugu: "పారంపర్య వ్యవసాయ అభివృద్ధి పథకం", titleHindi: "पारंपरिक कृषि विकास योजना", description: "Promotes organic farming through cluster approach. Provides certification and market linkage support.", descriptionTelugu: "క్లస్టర్ విధానం ద్వారా సేంద్రీయ వ్యవసాయాన్ని ప్రోత్సహిస్తుంది. సర్టిఫికేషన్ మరియు మార్కెట్ లింకేజ్ మద్దతు అందిస్తుంది.", descriptionHindi: "क्लस्टर दृष्टिकोण के माध्यम से जैविक खेती को बढ़ावा देता है। प्रमाणन और बाजार संपर्क सहायता प्रदान करता है।", category: "subsidy" as const, eligibility: "Farmers willing to adopt organic farming", benefits: "Rs 20,000/hectare for 3 years", documentsRequired: "Aadhaar, Land records" },
      { title: "Agricultural Mechanization Scheme", titleTelugu: "వ్యవసాయ యాంత్రీకరణ పథకం", titleHindi: "कृषि यांत्रीकरण योजना", description: "Subsidies for purchase of agricultural machinery and equipment like tractors, harvesters, tillers.", descriptionTelugu: "ట్రాక్టర్లు, హార్వెస్టర్లు, టిల్లర్లు వంటి వ్యవసాయ యంత్రాలు మరియు పరికరాల కొనుగోలుకు సబ్సిడీలు.", descriptionHindi: "ट्रैक्टर, हार्वेस्टर, टिलर जैसे कृषि यंत्रों और उपकरणों की खरीद पर सब्सिडी।", category: "equipment" as const, eligibility: "Individual farmers, FPOs, Cooperatives", benefits: "40-60% subsidy on machinery cost", documentsRequired: "Aadhaar, Land records, Quotation from dealer" },
      { title: "Micro Irrigation Fund", titleTelugu: "సూక్ష్మ సేందన నిధి", titleHindi: "सूक्ष्म सिंचाई निधि", description: "Financial assistance for installing drip irrigation and sprinkler systems at subsidized rates.", descriptionTelugu: "సబ్సిడీ రేట్లలో డ్రిప్ ఇరిగేషన్ మరియు స్ప్రింక్లర్ సిస్టమ్‌లను ఏర్పాటు చేయడానికి ఆర్థిక సహాయం.", descriptionHindi: "सब्सिडी दरों पर ड्रिप सिंचाई और स्प्रिंकलर सिस्टम स्थापित करने के लिए वित्तीय सहायता।", category: "subsidy" as const, eligibility: "All farmers", benefits: "55-75% subsidy on drip/sprinkler installation", documentsRequired: "Aadhaar, Land records, Bank account" },
      { title: "Rashtriya Krishi Vikas Yojana", titleTelugu: "రాష్ట్రీయ వ్యవసాయ అభివృద్ధి పథకం", titleHindi: "राष्ट्रीय कृषि विकास योजना", description: "Provides states flexibility to develop agriculture and allied sectors as per local needs.", descriptionTelugu: "స్థానిక అవసరాలకు అనుగుణంగా వ్యవసాయ మరియు సంబంధిత రంగాలను అభివృద్ధి చేయడానికి రాష్ట్రాలకు స్వేచ్ఛ అందిస్తుంది.", descriptionHindi: "स्थानीय जरूरतों के अनुसार कृषि और संबद्ध क्षेत्रों के विकास के लिए राज्यों को लचीलापन प्रदान करता है।", category: "grant" as const, eligibility: "State agriculture departments, farmers via states" },
      { title: "Kisan Pension Yojana", titleTelugu: "రైతు పెన్షన్ పథకం", titleHindi: "किसान पेंशन योजना (PM-KMY)", description: "Pension scheme for small and marginal farmers. Monthly contribution of Rs 55-200 based on age, get Rs 3,000/month after 60 years.", descriptionTelugu: "చిన్న మరియు సीమాంత రైతులకు పెన్షన్ పథకం. వయస్సు ఆధారంగా నెలకు రూ.55-200 చొప్పున, 60 సంవత్సరాల తర్వాత నెలకు రూ.3,000.", descriptionHindi: "छोटे और सीमांत किसानों के लिए पेंशन योजना। उम्र के अनुसार मासिक योगदान 55-200 रुपये, 60 वर्ष के बाद 3,000 रुपये/माह।", category: "grant" as const, eligibility: "Small/marginal farmers aged 18-40 years", benefits: "Rs 3,000/month pension after age 60", documentsRequired: "Aadhaar, Age proof, Bank account" },
    ];
    await db.insert(governmentSchemes).values(schemesData);
    console.log(`    ${schemesData.length} schemes inserted`);
  }

  // ============ 4. SEED CROP KNOWLEDGE ============
  const existingCrops = await db.select({ count: sql<number>`count(*)` }).from(cropKnowledge);
  if ((existingCrops[0]?.count ?? 0) === 0) {
    console.log("  Seeding crop knowledge...");
    const cropData = [
      { cropName: "Rice", cropNameTelugu: "వరి", cropNameHindi: "चावल", category: "planting" as const, title: "Rice Planting Guide - Kharif Season", content: "Best time for Kharif rice planting: June-July. Use 25-30 kg seeds per acre for transplanting method. Maintain 2-3 cm water depth during initial growth. Recommended varieties: MTU-1010, Sona Masoori.", contentTelugu: "ఖరీఫ్ వరి నాట్ల కోసం ఉత్తమ సమయం: జూన్-జులై. నాట్ల పద్ధతికి ఎకరాకు 25-30 కేజీల విత్తనాలు ఉపయోగించండి. ప్రారంభ వృద్ధిలో 2-3 సెం.మీ. నీటి లోతు నిర్వహించండి.", contentHindi: "खरीफ धान रोपाई का सर्वोत्तम समय: जून-जुलाई। रोपाई विधि के लिए प्रति एकड़ 25-30 किलो बीज का उपयोग करें। प्रारंभिक विकास के दौरान 2-3 सेमी पानी की गहराई बनाए रखें।", stage: "planting", season: "kharif", region: "South India", tags: "rice,variety,planting,kharif" },
      { cropName: "Rice", cropNameTelugu: "వరి", cropNameHindi: "चावल", category: "fertilizer" as const, title: "Rice Fertilizer Schedule", content: "Apply basal dose: 40kg DAP + 20kg Urea + 20kg MOP per acre. Top dressing at tillering: 30kg Urea. At panicle initiation: 20kg Urea. Total NPK: 100:50:50 kg/acre.", contentTelugu: "బేసల్ డోస్: ఎకరాకు 40కేజీ DAP + 20కేజీ యూరియా + 20కేజీ MOP. క్షిత్రీణ సమయంలో: 30కేజీ యూరియా. పుష్పించడం ప్రారంభంలో: 20కేజీ యూరియా.", contentHindi: "बेसल डोज: प्रति एकड़ 40 किलो DAP + 20 किलो यूरिया + 20 किलो MOP। कल्ले फूटने पर: 30 किलो यूरिया। बाली निकलने पर: 20 किलो यूरिया।", stage: "vegetative", season: "all", region: "All India", tags: "rice,fertilizer,npk,schedule" },
      { cropName: "Cotton", cropNameTelugu: "పత్తి", cropNameHindi: "कपास", category: "pest_control" as const, title: "Cotton Pest Management - Bollworm", content: "Monitor for pink bollworm and American bollworm. Use pheromone traps (5/acre). Spray neem oil 5ml/L or Bacillus thuringiensis at first sign of larvae. Rotate with non-host crops.", contentTelugu: "పింక్ బోల్వర్మ్ మరియు అమెరికన్ బోల్వర్మ్ కోసం పర్యవేక్షణ. ఫెరోమోన్ ట్రాప్స్ (5/ఎకరా). లార్వల మొదటి సంకేతంపై వేప నూనె 5మి.లీ/లీటర్ లేదా బాసిలస్ థురింజియన్సిస్ స్ప్రే చేయండి.", contentHindi: "गुलाबी बोलवर्म और अमेरिकी बोलवर्म की निगरानी। फेरोमोन जाल (5/एकड़)। लार्वा के पहले संकेत पर नीम तेल 5मिली/लीटर या बैसिलस थुरिंजिएन्सिस का छिड़काव करें।", stage: "flowering", season: "kharif", region: "Central India", tags: "cotton,bollworm,pest,neem" },
      { cropName: "Groundnut", cropNameTelugu: "వేరుశనగ", cropNameHindi: "मूंगफली", category: "planting" as const, title: "Groundnut Planting - Rabi Season", content: "Planting time: October-November. Seed rate: 80-100 kg/acre. Spacing: 30x10 cm. Ensure adequate moisture at planting. Treat seeds with Rhizobium culture for better nitrogen fixation.", contentTelugu: "నాట్ల సమయం: అక్టోబర్-నవంబర్. విత్తనాల రేటు: ఎకరాకు 80-100 కేజీ. దూరం: 30x10 సెం.మీ. నాట్ల సమయంలో తగిన తేమ నిర్వహించండి.", contentHindi: "रोपाई का समय: अक्टूबर-नवंबर। बीज दर: प्रति एकड़ 80-100 किलो। दूरी: 30x10 सेमी। रोपाई के समय पर्याप्त नमी सुनिश्चित करें।", stage: "planting", season: "rabi", region: "South India", tags: "groundnut,planting,rabi,spacing" },
      { cropName: "Wheat", cropNameTelugu: "గోధుమ", cropNameHindi: "गेहूं", category: "irrigation" as const, title: "Wheat Irrigation Schedule", content: "Critical irrigation stages: Crown root initiation, Tillering, Jointing, Flowering, Grain filling. Total 4-6 irrigations depending on soil type. Avoid waterlogging.", contentTelugu: "నీటిపారుదల కీలక దశలు: కిరీట మూల ప్రారంభం, క్షిత్రీణం, కలయిక, పుష్పించడం, గింజల నింపడం. మొత్తం 4-6 నీటిపారుదల.", contentHindi: "सिंचाई की महत्वपूर्ण अवस्थाएं: क्राउन रूट इनिशिएशन, कल्ले फूटना, जोइंटिंग, फूलना, दाना भरना। कुल 4-6 सिंचाई।", stage: "vegetative", season: "rabi", region: "North India", tags: "wheat,irrigation,schedule" },
      { cropName: "Turmeric", cropNameTelugu: "పసుపు", cropNameHindi: "हल्दी", category: "disease" as const, title: "Turmeric Disease - Rhizome Rot Management", content: "Rhizome rot is major disease. Use disease-free seed rhizomes. Treat with mancozeb 0.3% before planting. Ensure good drainage. Apply Trichoderma viride @ 5g/kg rhizome.", contentTelugu: "రైజోమ్ రాట్ ప్రధాన వ్యాధి. వ్యాధి-రహిత విత్తన రైజోమ్‌లను ఉపయోగించండి. నాట్లకు ముందు మ్యాంకోజెబ్ 0.3% తో చికిత్స చేయండి.", contentHindi: "राइजोम रोट प्रमुख रोग है। रोग-मुक्त बीज राइजोम का उपयोग करें। रोपाई से पहले मैंकोजेब 0.3% से उपचार करें।", stage: "planting", season: "kharif", region: "South India", tags: "turmeric,rhizome rot,disease" },
      { cropName: "Tomato", cropNameTelugu: "టమాటో", cropNameHindi: "टमाटर", category: "pest_control" as const, title: "Tomato Pest - Fruit Borer Management", content: "Fruit borer causes 30-40% damage. Install pheromone traps (8-10/acre). Spray NSKE 5% or HaNPV @ 250 LE/ha at egg laying stage. Remove and destroy infested fruits.", contentTelugu: "పండ్ల తెగులు 30-40% నష్టం కలిగిస్తుంది. ఫెరోమోన్ ట్రాప్స్ (8-10/ఎకరా) ఏర్పాటు చేయండి. గుడ్లు పెట్టే దశలో NSKE 5% లేదా HaNPV @ 250 LE/ha స్ప్రే చేయండి.", contentHindi: "फल बोरर 30-40% नुकसान करता है। फेरोमोन जाल (8-10/एकड़) लगाएं। अंडे देने की अवस्था में NSKE 5% या HaNPV @ 250 LE/ha का छिड़काव करें।", stage: "fruiting", season: "all", region: "All India", tags: "tomato,fruit borer,pest" },
      { cropName: "Sugarcane", cropNameTelugu: "చెరకు", cropNameHindi: "गन्ना", category: "fertilizer" as const, title: "Sugarcane Nutrient Management", content: "Apply 120kg N, 60kg P2O5, 60kg K2O per acre. Split N application: 1/3 at planting, 1/3 at tillering, 1/3 at grand growth. Apply micronutrients (Zn, Fe) if deficient.", contentTelugu: "ఎకరాకు 120కేజీ N, 60కేజీ P2O5, 60కేజీ K2O వర్తించండి. N విభజన: నాట్లకు 1/3, క్షిత్రీణానికి 1/3, గ్రాండ్ గ్రోత్‌కు 1/3.", contentHindi: "प्रति एकड़ 120 किलो N, 60 किलो P2O5, 60 किलो K2O लगाएं। N विभाजन: रोपाई पर 1/3, कल्ले फूटने पर 1/3, ग्रांड ग्रोथ पर 1/3।", stage: "vegetative", season: "all", region: "All India", tags: "sugarcane,fertilizer,npk" },
      { cropName: "Maize", cropNameTelugu: "మొక్కజొన్న", cropNameHindi: "मक्का", category: "harvesting" as const, title: "Maize Harvesting Tips", content: "Harvest when husks turn brown and grains are hard. Moisture content should be 20-25% at harvest. Dry to 13-14% moisture for safe storage. Expected yield: 25-35 quintals/acre for hybrids.", contentTelugu: "తొగలు ముదురు రంగులోకి మారి గింజలు గట్టిపడినప్పుడు కోత చేయండి. కోత సమయంలో తేమ శాతం 20-25% ఉండాలి. సురక్షిత నిల్వ కోసం 13-14% తేమకు ఆరవేయండి.", contentHindi: "जब भूसे भूरे हो जाएं और दाने कठोर हो जाएं तो कटाई करें। कटाई पर नमी 20-25% होनी चाहिए। सुरक्षित भंडारण के लिए 13-14% नमी तक सुखाएं।", stage: "harvesting", season: "kharif", region: "All India", tags: "maize,harvesting,storage" },
      { cropName: "Onion", cropNameTelugu: "ఉల్లిపాయ", cropNameHindi: "प्याज", category: "storage" as const, title: "Onion Storage Guidelines", content: "Cure onions in field for 5-7 days after harvest. Store in well-ventilated, dark place. Ideal storage conditions: temperature 25-30C, humidity 65-70%. Use ventilated crates or nylon mesh bags.", contentTelugu: "కోత తర్వాత పొలంలో 5-7 రోజులు ఎండబెట్టండి. గాలిగద్దరం, చీకటి ప్రదేశంలో నిల్వ చేయండి. ఆదర్శ నిల్వ పరిస్థితులు: ఉష్ణోగ్రత 25-30C, తేమ 65-70%.", contentHindi: "कटाई के बाद खेत में 5-7 दिन इलाज करें। हवादार, अंधेरी जगह में स्टोर करें। आदर्श भंडारण: तापमान 25-30C, नमी 65-70%।", stage: "harvesting", season: "rabi", region: "All India", tags: "onion,storage,curing" },
    ];
    await db.insert(cropKnowledge).values(cropData);
    console.log(`    ${cropData.length} crop entries inserted`);
  }

  // ============ 5. SEED AI INTENTS ============
  const existingIntents = await db.select({ count: sql<number>`count(*)` }).from(aiIntents);
  if ((existingIntents[0]?.count ?? 0) === 0) {
    console.log("  Seeding AI intents...");
    const intentsData = [
      { intentName: "weather_query", keywords: "weather,vaana,mausam,barish,temperature,rain forecast", description: "Farmer asking about weather forecast", handlerType: "weather" as const, responseTemplate: "Here's the weather forecast for your area. Today's conditions and 3-day outlook.", confidence: 0.95 },
      { intentName: "market_price_query", keywords: "price,bhav,dhar,rate,mandi,bazar,market", description: "Farmer asking about crop prices", handlerType: "market_price" as const, responseTemplate: "Current market prices for your crop in nearby mandis with trend analysis.", confidence: 0.92 },
      { intentName: "scheme_info", keywords: "scheme,yojana,subsidy,loan,pension,scheme info,government", description: "Farmer asking about government schemes", handlerType: "scheme" as const, responseTemplate: "Available government schemes matching your profile with eligibility and application process.", confidence: 0.90 },
      { intentName: "crop_advice", keywords: "crop,advice,salah,tips,fertilizer,pest,disease,planting", description: "Farmer asking for farming advice", handlerType: "crop_advice" as const, responseTemplate: "Personalized crop advice based on your crop type, stage, and location.", confidence: 0.88 },
      { intentName: "greeting", keywords: "hello,hi,namaste,namaskaram,good morning,good evening", description: "Farmer greeting the bot", handlerType: "general" as const, responseTemplate: "Hello! How can I help you today? Ask me about weather, prices, schemes, or farming advice.", confidence: 0.99 },
      { intentName: "voice_request", keywords: "voice,audio,speak,call", description: "Farmer requesting voice/call support", handlerType: "voice" as const, responseTemplate: "I can provide voice support. Please let me know what information you need.", confidence: 0.85 },
      { intentName: "fallback", keywords: "", description: "Default handler for unrecognized intents", handlerType: "fallback" as const, responseTemplate: "I understand. I can help with weather, market prices, government schemes, and farming advice. What would you like to know?", confidence: 0.5 },
    ];
    await db.insert(aiIntents).values(intentsData);
    console.log(`    ${intentsData.length} intents inserted`);
  }

  console.log("✅ Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
