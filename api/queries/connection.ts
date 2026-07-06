import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let rawPool: mysql.Pool;

export function getDb() {
  if (!instance) {
    instance = drizzle(env.databaseUrl, {
      mode: "planetscale",
      schema: fullSchema,
    });
  }
  return instance;
}

// Raw mysql2 pool for bypassing Drizzle ORM entirely
export function getRawPool(): mysql.Pool {
  if (!rawPool) {
    rawPool = mysql.createPool(env.databaseUrl);
  }
  return rawPool;
}
