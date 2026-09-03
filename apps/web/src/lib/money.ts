const MONEY_KEYS = new Set([
  "amount",
  "balance",
  "cost",
  "total",
  "subtotal",
  "taxAmount",
  "unitAmount",
  "minAmount",
  "fixedCharge",
  "pricePerM3",
  "excessPricePerM3",
  "debt",
  "debtAmount",
  "connectionCost",
  "downPayment",
  "paidAmount",
  "billed_month",
  "collected_month",
  "outstanding",
]);

export function formatGs(value: string | number | null | undefined): string {
  if (value == null || value === "" || value === "—") return "Gs. 0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Gs. 0";
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

export function gsInteger(value: string | number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n));
}

export function sanitizeGsInput(raw: string): string {
  const neg = raw.trim().startsWith("-");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return neg ? "-" : "";
  return neg ? `-${digits}` : digits;
}

export function isMoneyKey(key: string): boolean {
  return MONEY_KEYS.has(key) || /(?:^|[_\s])(amount|balance|cost|total|subtotal)(?:$|[_\s])/i.test(key);
}

export function isMoneyLabel(label: string): boolean {
  return /Gs\.?/i.test(label);
}

export function formatMoneyCell(key: string, value: unknown): string | null {
  if (!isMoneyKey(key)) return null;
  if (value == null || value === "") return "—";
  return formatGs(value as string | number);
}
