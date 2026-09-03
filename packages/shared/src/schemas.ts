import { z } from "zod";
import { READING_ANOMALIES } from "./enums.js";

export const moneyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "Importe inválido");

export const uuidSchema = z.string().uuid();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
});

export const gpsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(50000),
  capturedAt: z.string().datetime().optional(),
  mocked: z.boolean().optional(),
});

export const readingInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  connectionId: z.string().uuid(),
  meterId: z.string().uuid(),
  billingPeriodId: z.string().uuid().optional(),
  currentReading: z.string().regex(/^\d+(\.\d{1,3})?$/),
  meterReset: z.boolean().default(false),
  photoFileId: z.string().uuid().optional(),
  gps: gpsSchema.optional(),
  observations: z.string().max(2000).optional(),
  deviceCapturedAt: z.string().datetime().optional(),
  clientUuid: z.string().uuid().optional(),
  baseVersion: z.number().int().optional(),
});

export const anomalySchema = z.enum(READING_ANOMALIES);

export type ReadingInput = z.infer<typeof readingInputSchema>;
export type GpsPayload = z.infer<typeof gpsSchema>;
