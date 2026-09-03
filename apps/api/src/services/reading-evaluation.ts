import type { ReadingAnomaly } from "@aguateria/shared";

export type AnomalySeverity = "INFORMATIVA" | "ADVERTENCIA" | "CRITICA";

export type AnomalyInput = {
  previousReading: number;
  currentReading: number;
  meterReset: boolean;
  isFirstReading: boolean;
  meterChangedInPeriod: boolean;
  excessiveMultiplier: number;
  historicalAverageM3: number | null;
  gpsAccuracyMeters: number | null;
  gpsMaxAccuracyMeters: number;
  gpsMocked: boolean | undefined;
  rejectMockLocation: boolean;
  photoRequired: boolean;
  hasPhoto: boolean;
  geofenceDistanceM?: number | null;
  geofenceMaxMeters?: number;
  geofenceBlock?: boolean;
};

export type AnomalyResult = {
  consumptionM3: number;
  anomalyCode: ReadingAnomaly;
  requiresReview: boolean;
  blockAutoBilling: boolean;
  warnings: string[];
  severity: AnomalySeverity;
};

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function evaluateReading(input: AnomalyInput): AnomalyResult {
  const warnings: string[] = [];
  let anomaly: ReadingAnomaly = "NONE";
  let requiresReview = false;
  let blockAutoBilling = false;
  let consumption = 0;
  let severity: AnomalySeverity = "INFORMATIVA";

  if (input.gpsMocked && input.rejectMockLocation) {
    warnings.push("Ubicación simulada rechazada");
    requiresReview = true;
    blockAutoBilling = true;
    anomaly = "GPS_INACCURATE";
    severity = "CRITICA";
  }

  if (input.gpsAccuracyMeters != null && input.gpsAccuracyMeters > input.gpsMaxAccuracyMeters) {
    warnings.push(`Precisión GPS insuficiente (${input.gpsAccuracyMeters} m)`);
    if (anomaly === "NONE") anomaly = "GPS_INACCURATE";
    if (severity === "INFORMATIVA") severity = "ADVERTENCIA";
  }

  const fenceMax = input.geofenceMaxMeters ?? 50;
  if (input.geofenceDistanceM != null && input.geofenceDistanceM > fenceMax) {
    warnings.push(`Ubicación fuera del área esperada (${Math.round(input.geofenceDistanceM)} m)`);
    if (anomaly === "NONE") anomaly = "GPS_OUT_OF_RANGE";
    requiresReview = true;
    if (severity === "INFORMATIVA") severity = "ADVERTENCIA";
  }

  if (input.photoRequired && !input.hasPhoto) {
    warnings.push("Falta fotografía del medidor");
    if (anomaly === "NONE") anomaly = "MISSING_PHOTO";
    requiresReview = true;
    if (severity === "INFORMATIVA") severity = "ADVERTENCIA";
  }

  if (input.isFirstReading) {
    consumption = Math.max(0, input.currentReading - input.previousReading);
    anomaly = anomaly === "NONE" ? "INITIAL_READING" : anomaly;
  }

  if (input.meterReset) {
    consumption = input.currentReading;
    anomaly = "METER_RESET";
    requiresReview = true;
    blockAutoBilling = true;
    severity = "ADVERTENCIA";
  } else if (input.currentReading < input.previousReading) {
    consumption = 0;
    anomaly = "LOWER_THAN_PREVIOUS";
    requiresReview = true;
    blockAutoBilling = true;
    severity = "CRITICA";
  } else {
    consumption = input.currentReading - input.previousReading;
  }

  if (input.meterChangedInPeriod) {
    anomaly = "METER_CHANGED";
    requiresReview = true;
    blockAutoBilling = true;
    severity = "ADVERTENCIA";
  }

  if (consumption === 0 && anomaly === "NONE") {
    anomaly = "ZERO_CONSUMPTION";
    if (severity === "INFORMATIVA") severity = "ADVERTENCIA";
  }

  if (
    input.historicalAverageM3 != null &&
    input.historicalAverageM3 > 0 &&
    consumption > input.historicalAverageM3 * input.excessiveMultiplier
  ) {
    anomaly = "EXCESSIVE_CONSUMPTION";
    requiresReview = true;
    blockAutoBilling = true;
    severity = "CRITICA";
  }

  if (consumption < 0) {
    consumption = 0;
    anomaly = "NEGATIVE_CONSUMPTION";
    requiresReview = true;
    blockAutoBilling = true;
    severity = "CRITICA";
  }

  return {
    consumptionM3: Number(consumption.toFixed(3)),
    anomalyCode: anomaly,
    requiresReview,
    blockAutoBilling,
    warnings,
    severity,
  };
}
