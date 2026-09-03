/** Importe PYG entero para pantalla y PDF. */
export function formatGs(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Gs. 0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Gs. 0";
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}
