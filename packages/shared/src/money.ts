/**
 * Aritmética monetaria en string/enteros para evitar IEEE-754.
 * PYG suele cobrarse en enteros; se permiten 2 decimales internos.
 */
export function parseMoney(value: string | number): bigint {
  const str = typeof value === "number" ? value.toFixed(2) : value.trim();
  const negative = str.startsWith("-");
  const [whole = "0", frac = ""] = (negative ? str.slice(1) : str).split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const units = BigInt(whole) * 100n + BigInt(fracPadded);
  return negative ? -units : units;
}

export function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const formatted = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

export function addMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a) + parseMoney(b));
}

export function subMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a) - parseMoney(b));
}

export function mulMoney(amount: string, factor: number): string {
  const units = parseMoney(amount);
  const scaled = Number(units) * factor;
  return formatMoney(BigInt(Math.round(scaled)));
}

export function maxMoney(a: string, b: string): string {
  return parseMoney(a) >= parseMoney(b) ? formatMoney(parseMoney(a)) : formatMoney(parseMoney(b));
}

export function roundPyg(amount: string, decimals = 0): string {
  const units = parseMoney(amount);
  if (decimals === 2) return formatMoney(units);
  if (decimals === 0) {
    const whole = units / 100n;
    const frac = units % 100n;
    const rounded = frac >= 50n ? whole + 1n : whole;
    return formatMoney(rounded * 100n);
  }
  return formatMoney(units);
}
