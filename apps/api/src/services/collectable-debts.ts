import { DateTime } from "luxon";

/** Tope para cobrar cuotas: mes en curso o los próximos 10 días. No incluye el resto del plan. */
export function installmentCollectableUntil(today: string, timezone = "America/Asuncion"): string {
  const d = DateTime.fromISO(today, { zone: timezone });
  const base = d.isValid ? d : DateTime.now().setZone(timezone);
  const endMonth = base.endOf("month");
  const plus10 = base.plus({ days: 10 });
  const cut = endMonth > plus10 ? endMonth : plus10;
  return cut.toISODate() ?? today;
}

export function isCollectableInstallment(dueOn: string, today: string, timezone = "America/Asuncion"): boolean {
  return dueOn <= installmentCollectableUntil(today, timezone);
}

export function formatM3(value: string | number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("es-PY", { maximumFractionDigits: 3 });
}
