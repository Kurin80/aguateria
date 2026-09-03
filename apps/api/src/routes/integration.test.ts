/**
 * Pruebas de integración HTTP contra una base PostgreSQL real.
 *
 * Se ejecutan sólo si hay una DB alcanzable (usa `DATABASE_URL` / `DB_*` del `.env`).
 * En CI sin base, el bloque entero se marca como `skipped` — no rompe la suite.
 *
 * Local:  npm run db:up && npm run db:migrate && npm run db:seed
 *         npm run test -w @aguateria/api
 *
 * No mutan datos: son verificaciones de auth, validación e IDOR (todas terminan en
 * 4xx antes de escribir). El único caso con efecto (cron) se prueba sólo su rechazo.
 */
import "../load-env-file.js";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { closeDb, getDb } from "../db/client.js";
import { loadEnv } from "../env.js";

const RANDOM_UUID = "11111111-1111-1111-1111-111111111111";

let dbUp = false;
try {
  await getDb().execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}

let token = "";
let sampleCustomerId = "";
if (dbUp) {
  const app = createApp();
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: loadEnv().DEV_ADMIN_EMAIL,
      password: loadEnv().DEV_ADMIN_PASSWORD,
    }),
  });
  if (res.ok) {
    token = ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
    const list = await app.request("/api/customers?page=1&pageSize=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (list.ok) {
      const body = (await list.json()) as { data: Array<{ id: string }> };
      sampleCustomerId = body.data[0]?.id ?? "";
    }
  }
}

afterAll(async () => {
  if (dbUp) await closeDb();
});

describe.skipIf(!dbUp)("integración HTTP — infraestructura", () => {
  const app = createApp();

  it("GET /api/health → 200 y database: up", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { database: string } };
    expect(body.data.database).toBe("up");
  });

  it("login con credenciales inválidas → 401", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "nadie@ejemplo.test", password: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("endpoint de negocio sin token → 401", async () => {
    const res = await app.request("/api/customers");
    expect(res.status).toBe(401);
  });

  it("cron sin secreto → 401", async () => {
    const res = await app.request("/api/internal/cron");
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbUp || !token)("integración HTTP — auth y aislamiento multi-tenant", () => {
  const app = createApp();
  const auth = () => ({ authorization: `Bearer ${token}` });

  it("GET /api/auth/me con token → 200 y trae permisos", async () => {
    const res = await app.request("/api/auth/me", { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { permissions: string[]; companyId: string } };
    expect(Array.isArray(body.data.permissions)).toBe(true);
    expect(body.data.companyId).toBeTruthy();
  });

  it("GET /api/accounts/:id con UUID inexistente → 404 (no fuga entre empresas)", async () => {
    const res = await app.request(`/api/accounts/${RANDOM_UUID}`, { headers: auth() });
    expect(res.status).toBe(404);
  });

  it("GET /api/accounts/:id con param no-UUID → 400", async () => {
    const res = await app.request("/api/accounts/no-es-uuid", { headers: auth() });
    expect(res.status).toBe(400);
  });

  it("GET /api/accounts/:id con cliente propio → 200", async () => {
    if (!sampleCustomerId) return;
    const res = await app.request(`/api/accounts/${sampleCustomerId}`, { headers: auth() });
    expect(res.status).toBe(200);
  });

  it("GET /api/meters/:id/events con UUID ajeno → 404", async () => {
    const res = await app.request(`/api/meters/${RANDOM_UUID}/events`, { headers: auth() });
    expect(res.status).toBe(404);
  });

  it("PATCH /api/connections/:id con campo no permitido → 400 (sin mass-assignment)", async () => {
    const res = await app.request(`/api/connections/${RANDOM_UUID}`, {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ companyId: "otra-empresa" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/meters/:id con status fuera del enum → 400", async () => {
    const res = await app.request(`/api/meters/${RANDOM_UUID}`, {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ status: "HACKED" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/billing-periods/:id/transition con estado inválido → 400", async () => {
    const res = await app.request(`/api/billing-periods/${RANDOM_UUID}/transition`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ status: "CUALQUIERA" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/reports/customers?format=csv → 200 text/csv adjunto", async () => {
    const res = await app.request("/api/reports/customers?format=csv", { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });
});
