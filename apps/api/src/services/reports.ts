import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";

export type ReportFilters = {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  department?: string;
  city?: string;
};

function dateRange(column: SQL, from?: string, to?: string): SQL | undefined {
  if (from && to) return sql`${column} >= ${from}::date and ${column} < (${to}::date + interval '1 day')`;
  if (from) return sql`${column} >= ${from}::date`;
  if (to) return sql`${column} < (${to}::date + interval '1 day')`;
  return undefined;
}

export async function loadReportRows(
  db: Database,
  companyId: string,
  type: string,
  filters: ReportFilters,
): Promise<unknown[]> {
  const { from, to, q, status, department, city } = filters;
  const like = q ? `%${q}%` : null;

  if (type === "customers") {
    const clauses = [eq(t.customers.companyId, companyId)];
    const dr = dateRange(sql`${t.customers.createdAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status === "INOPERATIVO") clauses.push(sql`${t.customers.status} in ('INOPERATIVO','INACTIVO')`);
    else if (status) clauses.push(eq(t.customers.status, status));
    if (department) clauses.push(eq(t.customers.department, department));
    if (city) clauses.push(eq(t.customers.city, city));
    if (like) {
      clauses.push(
        or(
          ilike(t.customers.code, like),
          ilike(t.customers.firstName, like),
          ilike(t.customers.lastName, like),
          ilike(t.customers.legalName, like),
          ilike(t.customers.ruc, like),
          ilike(t.customers.ci, like),
        )!,
      );
    }
    return db.select().from(t.customers).where(and(...clauses));
  }

  if (type === "connections") {
    const clauses = [eq(t.connections.companyId, companyId)];
    const dr = dateRange(sql`${t.connections.createdAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.connections.status, status));
    if (city) clauses.push(eq(t.connections.city, city));
    if (like) clauses.push(or(ilike(t.connections.code, like), ilike(t.connections.address, like), ilike(t.connections.accountNumber, like))!);
    return db.select().from(t.connections).where(and(...clauses));
  }

  if (type === "meters") {
    const clauses = [eq(t.meters.companyId, companyId)];
    const dr = dateRange(sql`${t.meters.createdAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.meters.status, status));
    if (like) clauses.push(or(ilike(t.meters.number, like), ilike(t.meters.serial, like), ilike(t.meters.brand, like))!);
    return db.select().from(t.meters).where(and(...clauses));
  }

  if (type === "installations") {
    const clauses = [eq(t.connectionInstallations.companyId, companyId)];
    const dr = dateRange(sql`${t.connectionInstallations.createdAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.connectionInstallations.status, status));
    return db.select().from(t.connectionInstallations).where(and(...clauses));
  }

  if (type === "readings" || type === "anomalies") {
    const clauses = [eq(t.meterReadings.companyId, companyId)];
    const dr = dateRange(sql`${t.meterReadings.serverCapturedAt}`, from, to);
    if (dr) clauses.push(dr);
    if (type === "anomalies") clauses.push(sql`${t.meterReadings.anomalyCode} <> 'NONE'`);
    if (status === "revision") clauses.push(eq(t.meterReadings.requiresReview, true));
    return db.select().from(t.meterReadings).where(and(...clauses));
  }

  if (type === "productivity") {
    const fromSql = from ? sql`and r.server_captured_at >= ${from}::date` : sql``;
    const toSql = to ? sql`and r.server_captured_at < (${to}::date + interval '1 day')` : sql``;
    return db.execute(sql`
      select
        u.full_name as reader,
        u.email,
        count(*)::int as done,
        count(*) filter (where r.requires_review)::int as observed,
        count(*) filter (where r.anomaly_code <> 'NONE')::int as anomalies
      from meter_readings r
      join users u on u.id = r.reader_id
      where r.company_id = ${companyId}
      ${fromSql}
      ${toSql}
      group by u.full_name, u.email
      order by done desc
    `);
  }

  if (type === "billing") {
    const clauses = [eq(t.waterBills.companyId, companyId)];
    const dr = dateRange(sql`${t.waterBills.issuedOn}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.waterBills.status, status));
    if (like) clauses.push(ilike(t.waterBills.number, like));
    return db.select().from(t.waterBills).where(and(...clauses));
  }

  if (type === "payments") {
    const clauses = [eq(t.payments.companyId, companyId)];
    const dr = dateRange(sql`${t.payments.paidOn}`, from, to);
    if (dr) clauses.push(dr);
    if (like) clauses.push(ilike(t.payments.referenceNote, like));
    return db.select().from(t.payments).where(and(...clauses));
  }

  if (type === "claims") {
    const clauses = [eq(t.claims.companyId, companyId)];
    const dr = dateRange(sql`${t.claims.createdAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.claims.status, status));
    return db.select().from(t.claims).where(and(...clauses));
  }

  if (type === "delinquency") {
    const { unpaidPeriodCounts, moraBucket } = await import("./delinquency.js");
    const counts = await unpaidPeriodCounts(db, companyId);
    return counts.map((row) => ({ ...row, bucket: moraBucket(Number(row.unpaidPeriods)) }));
  }

  if (type === "disconnections") {
    const clauses = [eq(t.suspensions.companyId, companyId)];
    const dr = dateRange(sql`coalesce(${t.suspensions.executedAt}, ${t.suspensions.scheduledAt})`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.suspensions.status, status));
    return db.select().from(t.suspensions).where(and(...clauses));
  }

  if (type === "collection-routes") {
    const clauses = [eq(t.collectionRoutes.companyId, companyId)];
    const dr = dateRange(sql`${t.collectionRoutes.startedAt}`, from, to);
    if (dr) clauses.push(dr);
    if (status) clauses.push(eq(t.collectionRoutes.status, status));
    return db.select().from(t.collectionRoutes).where(and(...clauses));
  }

  if (type === "collector-productivity") {
    const fromSql = from ? sql`and r.started_at >= ${from}::date` : sql``;
    const toSql = to ? sql`and r.started_at < (${to}::date + interval '1 day')` : sql``;
    return db.execute(sql`
      select
        u.full_name as collector,
        u.email,
        count(distinct r.id)::int as routes,
        count(v.id)::int as visits,
        count(v.id) filter (where v.result in ('COBRADO','PARCIAL'))::int as collected_visits
      from collection_routes r
      join users u on u.id = r.collector_id
      left join collection_visits v on v.route_id = r.id
      where r.company_id = ${companyId}
      ${fromSql}
      ${toSql}
      group by u.full_name, u.email
      order by collected_visits desc
    `);
  }

  throw new Error("UNSUPPORTED");
}
