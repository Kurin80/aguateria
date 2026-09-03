import { describe, expect, it } from "vitest";
import { calculateConsumption } from "./consumption.js";
import { evaluateReading, haversineMeters } from "./reading-evaluation.js";
import { allocateFiscalNumber, assertStampUsable, formatFiscalNumber } from "./tax-stamp.js";

/** Tarifa tipo aviso La Roca: 10 m³ / 10.000 L = Gs. 33.000 a pagar. */
const laRoca = {
  fixedCharge: "0.00",
  minConsumptionM3: 10,
  minAmount: "33000.00",
  pricePerM3: "3300.00",
  excessPricePerM3: "3300.00",
  surchargePercent: 2,
  discountPercent: 0,
  taxRate: 0.1,
  taxExempt: false,
  pricesIncludeTax: true,
  erssanPercent: 2,
};

describe("ConsumptionCalculationService", () => {
  it("reproduce la boleta real: 10 m³ → Gs. 33.000 (agua 32.411 + ERSSAN 589)", () => {
    const r = calculateConsumption(10, laRoca);
    expect(r.minLiters).toBe(10_000);
    expect(r.excessM3).toBe(0);
    expect(r.total).toBe("33000.00");
    expect(r.waterGross).toBe("32411.00");
    expect(r.erssanAmount).toBe("589.00");
    expect(r.taxAmount).toBe("2946.00");
    expect(r.subtotal).toBe("29465.00");
  });

  it("cobra el mínimo aunque el consumo sea cero", () => {
    const r = calculateConsumption(0, laRoca);
    expect(r.total).toBe("33000.00");
    expect(r.excessM3).toBe(0);
  });

  it("suma excedente por m³ sobre el mínimo", () => {
    const r = calculateConsumption(12, laRoca);
    expect(r.excessM3).toBe(2);
    expect(r.excessLiters).toBe(2_000);
    expect(r.total).toBe("39600.00");
  });

  it("sin IVA ni ERSSAN deja el importe a pagar intacto", () => {
    const r = calculateConsumption(10, { ...laRoca, taxExempt: true, taxRate: 0, erssanPercent: 0, surchargePercent: 0 });
    expect(r.taxAmount).toBe("0.00");
    expect(r.erssanAmount).toBe("0.00");
    expect(r.total).toBe("33000.00");
  });
});

describe("evaluación de lecturas", () => {
  const gps = {
    gpsAccuracyMeters: 8,
    gpsMaxAccuracyMeters: 30,
    gpsMocked: false,
    rejectMockLocation: true,
    photoRequired: false,
    hasPhoto: true,
    excessiveMultiplier: 3,
    historicalAverageM3: 15,
    meterChangedInPeriod: false,
    isFirstReading: false,
    meterReset: false,
  };

  it("lectura normal", () => {
    const r = evaluateReading({ ...gps, previousReading: 100, currentReading: 112 });
    expect(r.consumptionM3).toBe(12);
    expect(r.blockAutoBilling).toBe(false);
  });

  it("lectura menor a la anterior no factura", () => {
    const r = evaluateReading({ ...gps, previousReading: 100, currentReading: 90 });
    expect(r.anomalyCode).toBe("LOWER_THAN_PREVIOUS");
    expect(r.blockAutoBilling).toBe(true);
    expect(r.consumptionM3).toBe(0);
  });

  it("consumo cero", () => {
    const r = evaluateReading({ ...gps, previousReading: 50, currentReading: 50 });
    expect(r.anomalyCode).toBe("ZERO_CONSUMPTION");
    expect(r.consumptionM3).toBe(0);
  });

  it("consumo excesivo", () => {
    const r = evaluateReading({
      ...gps,
      previousReading: 10,
      currentReading: 80,
      historicalAverageM3: 10,
    });
    expect(r.anomalyCode).toBe("EXCESSIVE_CONSUMPTION");
    expect(r.blockAutoBilling).toBe(true);
  });

  it("cambio de medidor exige revisión", () => {
    const r = evaluateReading({
      ...gps,
      previousReading: 0,
      currentReading: 5,
      meterChangedInPeriod: true,
    });
    expect(r.anomalyCode).toBe("METER_CHANGED");
    expect(r.blockAutoBilling).toBe(true);
  });

  it("reinicio de medidor", () => {
    const r = evaluateReading({
      ...gps,
      previousReading: 9990,
      currentReading: 12,
      meterReset: true,
    });
    expect(r.anomalyCode).toBe("METER_RESET");
    expect(r.consumptionM3).toBe(12);
    expect(r.blockAutoBilling).toBe(true);
  });

  it("lectura 100 a 125 consume 25", () => {
    const r = evaluateReading({ ...gps, previousReading: 100, currentReading: 125 });
    expect(r.consumptionM3).toBe(25);
    expect(r.anomalyCode).toBe("NONE");
  });

  it("lectura 100 a 80 no se acepta como normal", () => {
    const r = evaluateReading({ ...gps, previousReading: 100, currentReading: 80 });
    expect(r.anomalyCode).toBe("LOWER_THAN_PREVIOUS");
    expect(r.blockAutoBilling).toBe(true);
    expect(r.consumptionM3).toBe(0);
    expect(r.severity).toBe("CRITICA");
  });

  it("fotografía faltante cuando es obligatoria", () => {
    const r = evaluateReading({ ...gps, previousReading: 100, currentReading: 110, photoRequired: true, hasPhoto: false });
    expect(r.anomalyCode).toBe("MISSING_PHOTO");
    expect(r.requiresReview).toBe(true);
  });

  it("geovalla fuera de rango", () => {
    const r = evaluateReading({
      ...gps,
      previousReading: 100,
      currentReading: 110,
      geofenceDistanceM: 120,
      geofenceMaxMeters: 50,
      geofenceBlock: false,
    });
    expect(r.anomalyCode).toBe("GPS_OUT_OF_RANGE");
    expect(r.requiresReview).toBe(true);
    expect(r.blockAutoBilling).toBe(false);
  });

  it("haversine ~111 km en 1 grado de latitud", () => {
    const d = haversineMeters(-25.3, -57.6, -24.3, -57.6);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("timbrado", () => {
  it("rechaza vencido", () => {
    expect(() =>
      assertStampUsable({
        status: "ACTIVO",
        validFrom: "2020-01-01",
        validTo: "2020-12-31",
        rangeFrom: 1,
        rangeTo: 100,
        nextNumber: 1,
        today: "2026-08-31",
      }),
    ).toThrow();
  });

  it("rechaza rango agotado", () => {
    expect(() =>
      allocateFiscalNumber({
        status: "ACTIVO",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        rangeFrom: 1,
        rangeTo: 10,
        nextNumber: 11,
        today: "2026-08-31",
      }),
    ).toThrow();
  });

  it("asigna número y no reutiliza", () => {
    const stamp = {
      status: "ACTIVO",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      rangeFrom: 1,
      rangeTo: 1000,
      nextNumber: 42,
      today: "2026-08-31",
    };
    const a = allocateFiscalNumber(stamp);
    expect(a.number).toBe(42);
    expect(a.nextNumber).toBe(43);
    expect(formatFiscalNumber("001", "001", a.number)).toBe("001-001-0000042");
  });
});
