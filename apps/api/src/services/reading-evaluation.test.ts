import { describe, expect, it } from "vitest";
import { evaluateReading } from "./reading-evaluation.js";

const base = {
  previousReading: 100,
  currentReading: 125,
  meterReset: false,
  isFirstReading: false,
  meterChangedInPeriod: false,
  excessiveMultiplier: 2,
  historicalAverageM3: 25,
  gpsAccuracyMeters: 8,
  gpsMaxAccuracyMeters: 30,
  gpsMocked: false,
  rejectMockLocation: true,
  photoRequired: false,
  hasPhoto: true,
  geofenceDistanceM: 10,
  geofenceMaxMeters: 50,
  geofenceBlock: false,
};

describe("evaluación de lectura", () => {
  it("calcula consumo normal", () => {
    const r = evaluateReading(base);
    expect(r.consumptionM3).toBe(25);
    expect(r.anomalyCode).toBe("NONE");
    expect(r.requiresReview).toBe(false);
  });

  it("no acepta lectura menor como consumo normal", () => {
    const r = evaluateReading({ ...base, currentReading: 80 });
    expect(r.anomalyCode).toBe("LOWER_THAN_PREVIOUS");
    expect(r.requiresReview).toBe(true);
    expect(r.blockAutoBilling).toBe(true);
    expect(r.consumptionM3).toBe(0);
  });
});
