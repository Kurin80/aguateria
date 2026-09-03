import { and, eq, gt, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { rateLimitEvents } from "../db/schema.js";
import { jsonError } from "../lib/errors.js";
import type { AppEnv } from "./types.js";

type HeaderReader = { req: { header: (name: string) => string | undefined } };

/**
 * IP real del cliente. En Vercel el proxy antepone la IP real en `x-forwarded-for`,
 * así que se toma la primera entrada (las siguientes las puede falsificar el cliente).
 */
export function clientIp(c: HeaderReader): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || "local";
}

export function rateLimit(keyFn: (c: { req: { header: (n: string) => string | undefined }; get: (k: string) => unknown }) => string, limit: number, windowSeconds: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const db = c.get("db");
    const key = keyFn(c);
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    await db.insert(rateLimitEvents).values({ key });
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.key, key), gt(rateLimitEvents.createdAt, cutoff)));
    if ((row?.count ?? 0) > limit) {
      throw jsonError("RATE_LIMITED", "Demasiadas solicitudes", 429);
    }
    await next();
  };
}
