export type StampState = {
  status: string;
  validFrom: string;
  validTo: string;
  rangeFrom: number;
  rangeTo: number;
  nextNumber: number;
  today: string;
};

export function assertStampUsable(stamp: StampState): void {
  if (stamp.status !== "ACTIVO") {
    throw Object.assign(new Error("Timbrado inactivo"), { code: "STAMP_INACTIVE" });
  }
  if (stamp.today < stamp.validFrom || stamp.today > stamp.validTo) {
    throw Object.assign(new Error("Timbrado vencido o aún no vigente"), { code: "STAMP_EXPIRED" });
  }
  if (stamp.nextNumber > stamp.rangeTo) {
    throw Object.assign(new Error("Rango de numeración agotado"), { code: "STAMP_EXHAUSTED" });
  }
  if (stamp.nextNumber < stamp.rangeFrom) {
    throw Object.assign(new Error("Numeración fuera de rango"), { code: "STAMP_RANGE" });
  }
}

export function allocateFiscalNumber(stamp: StampState): { number: number; nextNumber: number } {
  assertStampUsable(stamp);
  const number = stamp.nextNumber;
  return { number, nextNumber: number + 1 };
}

export function formatFiscalNumber(establishmentCode: string, salesPointCode: string, n: number): string {
  return `${establishmentCode}-${salesPointCode}-${String(n).padStart(7, "0")}`;
}
