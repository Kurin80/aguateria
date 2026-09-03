import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Datos inválidos", details: err.flatten() } },
      400,
    );
  }
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
  }
  console.error(err);
  const message =
    (process.env.APP_ENV ?? "development") !== "production" && err instanceof Error
      ? err.message
      : "Error interno";
  return c.json({ error: { code: "INTERNAL", message } }, 500);
};
