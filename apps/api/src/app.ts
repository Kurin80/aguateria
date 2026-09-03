import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { corsOrigin, loadEnv } from "./env.js";
import { getDb, type Database } from "./db/client.js";
import { errorHandler } from "./http/error-handler.js";
import type { AppEnv } from "./http/types.js";
import { authRoutes } from "./routes/auth.js";
import { businessRoutes } from "./routes/business.js";
import { fileContentRoutes } from "./routes/files-content.js";

export function createApp(db?: Database): Hono<AppEnv> {
  const env = loadEnv();
  const app = new Hono<AppEnv>().basePath("/api");

  app.use(
    "*",
    secureHeaders({
      // La web en Vite (:5173) y Android llaman a la API en otro origen.
      crossOriginResourcePolicy: false,
    }),
  );
  app.use(
    "*",
    cors({
      origin: corsOrigin(env),
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key", "X-Device-Id", "X-App-Version"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use("*", async (c, next) => {
    c.set("db", db ?? getDb());
    await next();
  });

  app.onError(errorHandler);

  app.get("/health", async (c) => {
    let database: "up" | "down" = "down";
    try {
      await c.get("db").execute(sql`select 1`);
      database = "up";
    } catch {
      database = "down";
    }
    return c.json({
      data: {
        ok: true,
        database,
        env: env.APP_ENV,
        timezone: env.APP_TIMEZONE,
        storage: env.STORAGE_DRIVER,
        time: new Date().toISOString(),
      },
    });
  });

  app.route("/", fileContentRoutes());
  app.route("/auth", authRoutes());
  app.route("/", businessRoutes());

  return app;
}
