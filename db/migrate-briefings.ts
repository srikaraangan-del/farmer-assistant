import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function migrate() {
  const db = getDb();
  console.log("Creating daily_briefings table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS \`daily_briefings\` (
      \`id\` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
      \`farmer_id\` bigint unsigned NOT NULL,
      \`scheduled_at\` timestamp NOT NULL,
      \`sent_at\` timestamp,
      \`status\` enum('pending','sent','failed','skipped') DEFAULT 'pending' NOT NULL,
      \`language\` enum('telugu','hindi','english') DEFAULT 'english' NOT NULL,
      \`weather_included\` boolean DEFAULT true NOT NULL,
      \`market_prices_included\` boolean DEFAULT true NOT NULL,
      \`schemes_included\` boolean DEFAULT true NOT NULL,
      \`crop_tip_included\` boolean DEFAULT true NOT NULL,
      \`personalization_used\` boolean DEFAULT false NOT NULL,
      \`generated_message\` text,
      \`weather_data\` json,
      \`market_data\` json,
      \`schemes_referenced\` json,
      \`crop_tip_data\` json,
      \`error_message\` text,
      \`created_at\` timestamp DEFAULT NOW() NOT NULL
    )
  `);

  // Create indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS \`briefing_farmer_idx\` ON \`daily_briefings\` (\`farmer_id\`)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS \`briefing_status_idx\` ON \`daily_briefings\` (\`status\`)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS \`briefing_scheduled_idx\` ON \`daily_briefings\` (\`scheduled_at\`)`);

  console.log("daily_briefings table created successfully!");
}

migrate().catch(console.error);
