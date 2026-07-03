# AI Farmer Assistant — Final Architecture & Workflow

## 1. System Architecture

```
                                    +------------------+
                                    |   Indian Farmer  |
                                    |  (WhatsApp App)  |
                                    +--------+---------+
                                             |
                                             | HTTPS POST
                                             v
+------------------+    Webhook     +--------+---------+     +------------------+
|  Facebook/Meta   |-------------->|   AWS EC2        |     |   MySQL DB       |
|  WhatsApp Cloud  |   /api/webhook|   Ubuntu 24.04   |<--->|   farmer_assist  |
|  API             |    /whatsapp  |   Port 3000      |     |                  |
+--------+---------+               |                  |     +------------------+
         |                         |  +------------+  |
         |                         |  | Hono Server|  |
         |<-- Send Reply ---------|  | tRPC Router|  |
         |                         |  +------------+  |
         |                         |        |         |
         |                         +--------+---------+
         |                                  |
         |                         +--------+---------+
         |                         |  Nginx (SSL)     |
         |                         |  itechdevops.    |
         |                         |     online       |
         |                         +--------+---------+
         |                                  |
         |                         +--------+---------+
         |                         |  Admin Dashboard |
         |                         |  React + tRPC    |
         +------------------------>+------------------+
```

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 + TypeScript + Tailwind CSS + shadcn/ui | Admin Dashboard |
| **Backend** | Hono + tRPC 11.x + Drizzle ORM | API Server |
| **Database** | MySQL 8.0 | Data Storage |
| **Auth** | Local username/password (SHA256) | Admin Login |
| **WhatsApp** | Facebook Cloud API v18.0 | Messaging |
| **Weather** | Open-Meteo API (Free) | Live Weather |
| **Server** | AWS EC2 Ubuntu 24.04 | Hosting |
| **SSL** | Let's Encrypt (Certbot) | HTTPS |
| **Proxy** | Nginx | Reverse Proxy |
| **Process** | PM2 | App Management |

## 3. Database Schema (13 Tables)

```
+-------------------+     +-------------------+     +------------------+
|     farmers       |<--->|  conversations    |<--->|    messages      |
+-------------------+     +-------------------+     +------------------+
| id (PK)           |     | id (PK)           |     | id (PK)          |
| phoneNumber (UNQ) |     | farmerId (FK)     |     | conversationId   |
| name              |     | status            |     | farmerId (FK)    |
| preferredLanguage |     | intent            |     | senderType       |
| location          |     | messageCount      |     | content          |
| district          |     | createdAt         |     | intentDetected   |
| state             |     +-------------------+     | aiResponse       |
| primaryCrop       |                               | language         |
| isActive          |     +-------------------+     +------------------+
| totalInteractions |     |  daily_briefings  |
| createdAt         |     +-------------------+
+-------------------+     | id (PK)           |
                          | farmerId (FK)     |
+-------------------+     | status            |
|   local_users     |     | language          |
+-------------------+     | generatedMessage  |
| id (PK)           |     | sentAt            |
| username (UNQ)    |     +-------------------+
| passwordHash      |
| role (admin/user) |     +-------------------+
+-------------------+     |  analytics_events |
                          +-------------------+
+-------------------+     | id (PK)           |
|   market_prices   |     | farmerId (FK)     |
+-------------------+     | eventType         |
| id (PK)           |     | metadata          |
| commodity         |     +-------------------+
| variety           |
| mandiName         |     +-------------------+
| pricePerQuintal   |     |    ai_intents     |
| priceTrend        |     +-------------------+
| priceDate         |     | id (PK)           |
+-------------------+     | intentName        |
                          | keywords          |
+-------------------+     | handlerType       |
| government_schemes|     | responseTemplate  |
+-------------------+     +-------------------+
| id (PK)           |
| title             |     +-------------------+
| titleTelugu       |     |  weather_cache    |
| titleHindi        |     +-------------------+
| category          |     | id (PK)           |
| eligibility       |     | location          |
| benefits          |     | temperature       |
+-------------------+     | humidity          |
                          | rainProbability   |
+-------------------+     | fetchedAt         |
|  crop_knowledge   |     +-------------------+
+-------------------+
| id (PK)           |
| cropName          |
| cropNameTelugu    |
| category          |
| content           |
| stage             |
| season            |
+-------------------+

+-------------------+
| system_settings   |
+-------------------+
| id (PK)           |
| key (UNQ)         |
| value             |
+-------------------+
```

## 4. WhatsApp Message Flow

```
1. Farmer sends "Weather" on WhatsApp
           |
           v
2. Meta WhatsApp Cloud API receives message
           |
           v
3. POST https://iteachdevops.online/api/webhook/whatsapp
           |
           v
4. Hono Server (boot.ts)
   - Verify webhook signature
   - Extract: phoneNumber, message, contentType
           |
           v
5. processIncomingMessage()
   a. Find/create farmer by phoneNumber
   b. Find/create active conversation
   c. detectIntent(message) → "weather"
   d. If farmer has district+state:
      → fetchWeather() from Open-Meteo API
   e. generateAIResponse() in farmer's language
   f. Save both farmer message + AI response to DB
   g. Update conversation stats
   h. sendWhatsAppMessage() → reply back to farmer
           |
           v
6. Farmer receives AI response in their language!
```

## 5. Language Support

| Language | Script | Keywords Detected | Response Language |
|----------|--------|-------------------|-------------------|
| **Telugu** | Telugu script | వాతావరణం, ధర, పంట | Native Telugu |
| **Hindi** | Devanagari | मौसम, भाव, फसल | Native Hindi |
| **Kannada** | Kannada script | ಹವಾಮಾನ, ಬೆಲೆ, ಬೆಳೆ | Native Kannada |
| **English** | Latin | weather, price, crop | English |

## 6. API Endpoints (tRPC Routers)

### Auth
| Router | Procedure | Auth |
|--------|-----------|------|
| `localAuth.login` | mutation | public |
| `localAuth.register` | mutation | admin |
| `localAuth.me` | query | local token |

### Farmers
| Router | Procedure | Auth |
|--------|-----------|------|
| `farmers.list` | query | public |
| `farmers.get` | query | public |
| `farmers.create` | mutation | admin |
| `farmers.update` | mutation | admin |
| `farmers.delete` | mutation | admin |
| `farmers.toggleActive` | mutation | admin |
| `farmers.importBulk` | mutation | admin |
| `farmers.exportAll` | query | admin |
| `farmers.stats` | query | public |

### Conversations
| Router | Procedure | Auth |
|--------|-----------|------|
| `conversations.list` | query | public |
| `conversations.get` | query | public |

### Messages
| Router | Procedure | Auth |
|--------|-----------|------|
| `messages.list` | query | public |
| `messages.send` | mutation | admin |

### Briefings
| Router | Procedure | Auth |
|--------|-----------|------|
| `briefings.generate` | query | public |
| `briefings.send` | mutation | public |
| `briefings.sendToAll` | mutation | public |
| `briefings.list` | query | public |
| `briefings.stats` | query | public |

### Market Prices
| Router | Procedure | Auth |
|--------|-----------|------|
| `marketPrices.list` | query | public |
| `marketPrices.create` | mutation | admin |

### Schemes
| Router | Procedure | Auth |
|--------|-----------|------|
| `schemes.list` | query | public |
| `schemes.create` | mutation | admin |

### Crop Knowledge
| Router | Procedure | Auth |
|--------|-----------|------|
| `cropKnowledge.list` | query | public |
| `cropKnowledge.create` | mutation | admin |

### Weather
| Router | Procedure | Auth |
|--------|-----------|------|
| `weather.list` | query | public |
| `weather.getForLocation` | query | public |
| `weather.create` | mutation | admin |

## 7. Admin Dashboard Pages

| Route | Features |
|-------|----------|
| `/` (Login) | Username/password auth |
| `/dashboard` | Stats cards, charts, analytics |
| `/farmers` | List, search, add, edit, delete, import CSV, export CSV |
| `/conversations` | All chats, filter by farmer |
| `/messages` | Full message history |
| `/market-prices` | Market price data (auto-seeded) |
| `/schemes` | Government schemes (auto-seeded) |
| `/crop-knowledge` | Crop advice (auto-seeded) |
| `/ai-intents` | Intent patterns (auto-seeded) |
| `/daily-briefings` | Preview, send to farmer, broadcast all |
| `/settings` | App configuration |
| `/profile` | Admin profile |

## 8. Environment Variables (.env)

```env
APP_ID=19ec91da-b582-82f1-8000-00008fa5de27
APP_SECRET=nDukAj9YEqLO7cjWRlxvvZDAUOiqigtS
VITE_APP_ID=19ec91da-b582-82f1-8000-00008fa5de27
DATABASE_URL=mysql://farmer_user:YourStrongPassword123!@localhost:3306/farmer_assistant
WHATSAPP_VERIFY_TOKEN=farmer_verify_123
WHATSAPP_ACCESS_TOKEN=EAAW9gA4Tf1MBR... (your token)
WHATSAPP_PHONE_NUMBER_ID=1176507718880004 (your phone ID)
NODE_ENV=production
PORT=3000
```

## 9. Server Commands

```bash
# SSH into server
ssh -i farmer-assistant.pem ubuntu@13.62.103.70

# Navigate to app
cd /var/www/farmer-assistant

# Pull latest code
git pull origin main

# Push schema changes
npm run db:push

# Run seed (first time only)
npx tsx db/seed.ts

# Build
npm run build

# Restart app
pm2 restart farmer-assistant

# View logs
pm2 logs farmer-assistant

# Check status
pm2 status
```

## 10. File Structure

```
/var/www/farmer-assistant/
├── api/
│   ├── boot.ts                 # Hono server + WhatsApp webhook
│   ├── router.ts               # tRPC router registration
│   ├── middleware.ts           # Auth middleware (publicQuery, adminQuery)
│   ├── context.ts              # tRPC context builder
│   ├── farmers-router.ts       # Farmer CRUD + import/export
│   ├── conversations-router.ts # Chat management
│   ├── messages-router.ts      # Message history
│   ├── briefings-router.ts     # Daily briefing (native language + WhatsApp send)
│   ├── market-prices-router.ts # Market data
│   ├── schemes-router.ts       # Government schemes
│   ├── crop-knowledge-router.ts# Crop advice
│   ├── weather-router.ts       # Weather cache
│   ├── analytics-router.ts     # Analytics events
│   ├── ai-intents-router.ts    # Intent patterns
│   ├── settings-router.ts      # App settings
│   ├── whatsapp-router.ts      # WhatsApp status
│   ├── queries/
│   │   └── connection.ts       # MySQL connection
│   └── lib/
│       └── env.ts              # Environment config
├── db/
│   ├── schema.ts               # All 13 tables
│   └── seed.ts                 # Seed data
├── src/
│   ├── pages/                  # Dashboard pages
│   ├── components/             # Reusable UI
│   ├── hooks/                  # Custom hooks
│   └── providers/              # tRPC provider
├── contracts/                  # Shared types
├── dist/                       # Production build
├── .env                        # Environment variables
├── ecosystem.config.cjs        # PM2 config
└── package.json
```

---

## Quick Update Guide

When you make changes:

```bash
ssh -i farmer-assistant.pem ubuntu@13.62.103.70
cd /var/www/farmer-assistant
git pull origin main
npm run build
pm2 restart farmer-assistant
pm2 logs farmer-assistant --lines 10
```

**Your app URL:** https://iteachdevops.online/
