import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]).default("development"),
  APP_TIMEZONE: z.string().default("America/Asuncion"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().optional(),
  AUTH_SECRET: z.string().min(16).default("dev-only-not-for-production-secret"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default("aguateria_db"),
  DB_USER: z.string().default("postgres"),
  DB_PASSWORD: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("data/uploads"),
  API_PUBLIC_URL: z.string().default("http://localhost:3001"),
  STORAGE_BUCKET_PHOTOS: z.string().default("meter-photos"),
  STORAGE_BUCKET_DOCS: z.string().default("documents"),
  STORAGE_BUCKET_TAX: z.string().default("tax-xml"),
  STORAGE_BUCKET_KUDE: z.string().default("kude"),
  STORAGE_BUCKET_EXPENSES: z.string().default("expense-vouchers"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  ALLOW_DEV_SEED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  DEV_ADMIN_EMAIL: z.string().email().default("admin@aguateria.local"),
  DEV_ADMIN_PASSWORD: z.string().default("ChangeMe_DevOnly_1"),
  CRON_SECRET: z.string().optional(),
  SIFEN_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
  SIFEN_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SIFEN_HOST: z.string().default("sifen-test.set.gov.py"),
  SIFEN_MANUAL_VERSION: z.string().default("150"),
  SIFEN_CERT_BASE64: z.string().optional(),
  SIFEN_CERT_PATH: z.string().optional(),
  SIFEN_CERT_PASSWORD: z.string().optional(),
  SIFEN_CSC_ID: z.string().optional(),
  SIFEN_CSC: z.string().optional(),
  SIFEN_TIMEOUT_MS: z.coerce.number().default(30000),
  GPS_MAX_ACCURACY_METERS: z.coerce.number().default(30),
  GPS_REJECT_MOCK: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  EXCESSIVE_CONSUMPTION_MULTIPLIER: z.coerce.number().default(3),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  APP_PUBLIC_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & { DATABASE_URL: string };

let cached: Env | null = null;

export function assembleDatabaseUrl(parts: {
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD?: string;
}): string {
  const user = encodeURIComponent(parts.DB_USER);
  const pass = encodeURIComponent(parts.DB_PASSWORD ?? "");
  return `postgresql://${user}:${pass}@${parts.DB_HOST}:${parts.DB_PORT}/${parts.DB_NAME}`;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const cleaned = { ...source };
  for (const key of [
    "DATABASE_URL",
    "DIRECT_URL",
    "DB_PASSWORD",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_URL",
  ]) {
    if (cleaned[key] === "") delete cleaned[key];
  }
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Variables de entorno inválidas: ${missing}`);
  }
  const data = parsed.data;
  const databaseUrl = data.DATABASE_URL ?? assembleDatabaseUrl(data);
  if (data.APP_ENV === "production") {
    const secret = source.AUTH_SECRET ?? "";
    if (!secret || secret.startsWith("dev-only") || secret === "replace-with-long-random-secret") {
      throw new Error("AUTH_SECRET de producción inválido");
    }
    if (data.ALLOW_DEV_SEED) {
      throw new Error("ALLOW_DEV_SEED no puede estar activo en production");
    }
  }
  cached = { ...data, DATABASE_URL: databaseUrl };
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export function corsOrigin(env: Env): string | string[] | ((origin: string) => string | undefined) {
  const listed = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [env.WEB_ORIGIN];
  if (env.APP_ENV === "production") return listed.length === 1 ? listed[0]! : listed;
  return (origin: string) => {
    if (!origin) return listed[0];
    if (listed.includes(origin)) return origin;
    try {
      const { hostname, protocol } = new URL(origin);
      if (protocol !== "http:" && protocol !== "https:") return undefined;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local")) return origin;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)) return origin;
    } catch {
      return undefined;
    }
    return undefined;
  };
}
