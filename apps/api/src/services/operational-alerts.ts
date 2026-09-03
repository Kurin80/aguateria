import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

export type OperationalAlert = {
  key: string;
  message: string;
  href: string;
  permission: string;
  count: number;
};

function n(data: Record<string, unknown>, key: string): number {
  return Number(data[key] ?? 0);
}

function qty(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const DEFS: Array<{
  key: string;
  countKey: string;
  singular: string;
  plural: string;
  href: string;
  permission: string;
}> = [
  { key: "field_pending", countKey: "field_pending", singular: "lectura pendiente del período", plural: "lecturas pendientes del período", href: "/campo", permission: "lecturas.ver" },
  { key: "anomalous", countKey: "readings_anomalous", singular: "lectura con anomalía", plural: "lecturas con anomalía", href: "/lecturas", permission: "lecturas.ver" },
  { key: "photo", countKey: "readings_missing_photo", singular: "lectura sin fotografía", plural: "lecturas sin fotografía", href: "/lecturas", permission: "lecturas.ver" },
  { key: "gps", countKey: "readings_gps_out", singular: "lectura fuera de geovalla", plural: "lecturas fuera de geovalla", href: "/lecturas", permission: "lecturas.ver" },
  { key: "delinquent", countKey: "delinquent", singular: "cuenta morosa", plural: "cuentas morosas", href: "/morosidad", permission: "morosidad.ver" },
  { key: "no_meter", countKey: "connections_without_meter", singular: "conexión sin medidor", plural: "conexiones sin medidor", href: "/conexiones", permission: "conexiones.ver" },
  { key: "overdue", countKey: "bills_overdue", singular: "boleta vencida", plural: "boletas vencidas", href: "/boletas", permission: "boletas.ver" },
  { key: "disconnect", countKey: "disconnect_scheduled", singular: "desconexión programada", plural: "desconexiones programadas", href: "/suspensiones", permission: "suspensiones.ver" },
  { key: "install", countKey: "installations_pending", singular: "instalación pendiente", plural: "instalaciones pendientes", href: "/instalaciones", permission: "instalaciones.ver" },
];

export function buildOperationalAlerts(
  data: Record<string, unknown>,
  can?: (permission: string) => boolean,
): OperationalAlert[] {
  return DEFS.flatMap((def) => {
    const count = n(data, def.countKey);
    if (count <= 0) return [];
    if (can && !can(def.permission)) return [];
    const href = def.key === "field_pending" && can?.("lecturas.crear") ? "/campo" : def.key === "field_pending" ? "/lecturas" : def.href;
    return [{ key: def.key, message: qty(count, def.singular, def.plural), href, permission: def.permission, count }];
  });
}

export async function loadOperationalAlertCounts(db: Database, companyId: string): Promise<Record<string, unknown>> {
  const result = await db.execute(sql`
    select
      (select count(*) from customer_accounts where company_id = ${companyId} and status in ('VENCIDO','MOROSO')) as delinquent,
      (select count(*) from connections cn where cn.company_id = ${companyId} and cn.deleted_at is null and cn.status = 'ACTIVA'
         and not exists (select 1 from meters m where m.connection_id = cn.id and m.status = 'INSTALADO' and m.deleted_at is null)) as connections_without_meter,
      (select count(*) from connections cn
         join meters m on m.connection_id = cn.id and m.status = 'INSTALADO' and m.deleted_at is null
        where cn.company_id = ${companyId} and cn.deleted_at is null and cn.status = 'ACTIVA'
          and not exists (
            select 1 from meter_readings mr
            join billing_periods bp on bp.id = mr.billing_period_id
            where mr.meter_id = m.id and bp.company_id = ${companyId} and bp.status in ('ABIERTO','EN_PROCESO','EN_REVISION')
          )) as field_pending,
      (select count(*) from meter_readings where company_id = ${companyId} and requires_review = true and reviewed_at is null) as readings_anomalous,
      (select count(*) from meter_readings where company_id = ${companyId} and photo_file_id is null and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as readings_missing_photo,
      (select count(*) from meter_readings where company_id = ${companyId} and anomaly_code = 'GPS_OUT_OF_RANGE' and reviewed_at is null) as readings_gps_out,
      (select count(*) from water_bills where company_id = ${companyId} and due_on < (now() at time zone 'America/Asuncion')::date and balance::numeric > 0) as bills_overdue,
      (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status = 'DESCONEXION_PROGRAMADA') as disconnect_scheduled,
      (select count(*) from connection_installations where company_id = ${companyId} and status = 'PENDIENTE') as installations_pending
  `);
  const rows = result as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? {};
}
