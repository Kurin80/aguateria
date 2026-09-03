/**
 * Dígito verificador del RUC / CI paraguayo.
 * Algoritmo módulo 11 publicado por DNIT:
 * https://www.dnit.gov.py/documents/20123/224893/Dígito+Verificador.pdf
 */
export function calculateCheckDigit(raw: string, baseMax = 11): number {
  const normalized = expandAlphanumeric(raw);
  if (!normalized) {
    throw new Error("Número vacío para dígito verificador");
  }
  let k = 2;
  let total = 0;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (k > baseMax) k = 2;
    const digit = Number(normalized[i]);
    total += digit * k;
    k += 1;
  }
  const remainder = total % 11;
  return remainder > 1 ? 11 - remainder : 0;
}

export function expandAlphanumeric(value: string): string {
  let out = "";
  for (const char of value.replace(/[-\s]/g, "").toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      out += char;
    } else if ((code >= 65 && code <= 90) || code > 127) {
      out += String(code);
    }
  }
  return out;
}

export function splitRuc(rucWithDv: string): { number: string; dv: string } {
  const cleaned = rucWithDv.replace(/\s/g, "");
  const [number, dv] = cleaned.split("-");
  if (!number) {
    return { number: cleaned, dv: "" };
  }
  return { number, dv: dv ?? "" };
}

export function isValidRuc(ruc: string, dv: string): boolean {
  const number = ruc.replace(/[-\s]/g, "");
  if (!/^\d+$/.test(number) || !/^\d$/.test(dv)) return false;
  return calculateCheckDigit(number) === Number(dv);
}

/** Acepta `80012345-6` o solo el número; si falta el DV lo calcula. */
export function parseRucInput(value: string): { number: string; dv: string } {
  const cleaned = value.replace(/\s/g, "").toUpperCase();
  if (!cleaned) return { number: "", dv: "" };
  const { number, dv } = splitRuc(cleaned);
  if (dv) return { number, dv };
  try {
    return { number, dv: String(calculateCheckDigit(number)) };
  } catch {
    return { number, dv: "" };
  }
}

export function formatRuc(ruc?: string | null, dv?: string | null): string {
  if (!ruc) return "";
  return dv ? `${ruc}-${dv}` : ruc;
}
