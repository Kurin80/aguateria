import { describe, expect, it } from "vitest";
import { bucketForPurpose } from "./storage.js";
import { assembleDatabaseUrl, type Env } from "../env.js";

const base = {
  APP_ENV: "development",
  APP_TIMEZONE: "America/Asuncion",
  API_HOST: "0.0.0.0",
  API_PORT: 3001,
  WEB_ORIGIN: "http://localhost:5173",
  AUTH_SECRET: "dev-only-not-for-production-secret",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 14,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15,
  DB_HOST: "localhost",
  DB_PORT: 5432,
  DB_NAME: "aguateria_db",
  DB_USER: "postgres",
  DATABASE_URL: "postgresql://postgres:local@localhost:5432/aguateria_db",
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: "data/uploads",
  API_PUBLIC_URL: "http://localhost:3001",
  STORAGE_BUCKET_PHOTOS: "meter-photos",
  STORAGE_BUCKET_DOCS: "documents",
  STORAGE_BUCKET_TAX: "tax-xml",
  STORAGE_BUCKET_KUDE: "kude",
  STORAGE_BUCKET_EXPENSES: "expense-vouchers",
  DEV_ADMIN_EMAIL: "admin@aguateria.local",
  DEV_ADMIN_PASSWORD: "x",
  SIFEN_ENVIRONMENT: "test",
  SIFEN_HOST: "sifen-test.set.gov.py",
  SIFEN_MANUAL_VERSION: "150",
  SIFEN_TIMEOUT_MS: 30000,
  GPS_MAX_ACCURACY_METERS: 30,
  EXCESSIVE_CONSUMPTION_MULTIPLIER: 3,
} as unknown as Env;

describe("storage", () => {
  it("enruta buckets por propósito", () => {
    expect(bucketForPurpose(base, "meter-photo")).toBe("meter-photos");
    expect(bucketForPurpose(base, "install-photo")).toBe("meter-photos");
    expect(bucketForPurpose(base, "disconnect-photo")).toBe("meter-photos");
    expect(bucketForPurpose(base, "regulation")).toBe("documents");
    expect(bucketForPurpose(base, "tax")).toBe("tax-xml");
  });
});

describe("assembleDatabaseUrl", () => {
  it("codifica usuario y contraseña", () => {
    expect(
      assembleDatabaseUrl({
        DB_HOST: "localhost",
        DB_PORT: 5432,
        DB_NAME: "aguateria_db",
        DB_USER: "postgres",
        DB_PASSWORD: "p@ss:word",
      }),
    ).toBe("postgresql://postgres:p%40ss%3Aword@localhost:5432/aguateria_db");
  });
});
