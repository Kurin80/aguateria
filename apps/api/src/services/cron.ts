import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { scanDelinquency } from "./delinquency.js";

export type CronRunResult = {
  ranAt: string;
  companies: number;
  delinquency: Array<
    { companyId: string; scanned: number; scheduled: number } | { companyId: string; error: string }
  >;
};

/**
 * Trabajo diario disparado por Vercel Cron (`/api/internal/cron`, 08:00 America/Asuncion).
 * Idempotente y acotado: recorre las empresas activas y actualiza el estado de mora.
 * No emite documentos fiscales ni cobra: sólo recalcula estados y programa desconexiones
 * según las reglas de cada empresa (igual que el botón "Escanear mora" del panel).
 */
export async function runDailyCron(db: Database): Promise<CronRunResult> {
  const companies = await db
    .select({ id: t.companies.id })
    .from(t.companies)
    .where(eq(t.companies.active, true));

  const delinquency: CronRunResult["delinquency"] = [];
  for (const company of companies) {
    try {
      const res = await scanDelinquency(db, company.id, null);
      delinquency.push({ companyId: company.id, scanned: res.scanned, scheduled: res.scheduled });
      await audit(db, {
        companyId: company.id,
        userId: null,
        action: "MORA_ESCANEADA",
        module: "cron",
        newValues: res,
      });
    } catch (err) {
      delinquency.push({ companyId: company.id, error: err instanceof Error ? err.message : "error" });
    }
  }

  return { ranAt: new Date().toISOString(), companies: companies.length, delinquency };
}
