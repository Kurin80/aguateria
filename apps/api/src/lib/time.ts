import { DateTime } from "luxon";
import { loadEnv } from "../env.js";

export function nowAsuncion(): DateTime {
  const tz = loadEnv().APP_TIMEZONE || "America/Asuncion";
  return DateTime.now().setZone(tz);
}

export function todayAsuncion(): string {
  return nowAsuncion().toISODate() ?? "";
}

export function nextMonthAsuncion(from = todayAsuncion()): string {
  return DateTime.fromISO(from, { zone: loadEnv().APP_TIMEZONE || "America/Asuncion" }).plus({ months: 1 }).toISODate() ?? from;
}

export function serverNow(): Date {
  return new Date();
}
