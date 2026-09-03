import dns from "node:dns";
import postgres from "postgres";
import { loadEnv } from "../env.js";

dns.setDefaultResultOrder("ipv4first");

export function createSql(max = 4) {
  const env = loadEnv();
  const url = env.DIRECT_URL || env.DATABASE_URL;
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
    ssl: env.DATABASE_SSL ? "require" : false,
  });
}
