import type { Database } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export async function audit(
  db: Database,
  entry: {
    companyId?: string | null;
    userId?: string | null;
    action: string;
    module: string;
    entityType?: string;
    entityId?: string;
    oldValues?: unknown;
    newValues?: unknown;
    ip?: string | null;
    userAgent?: string | null;
    deviceId?: string | null;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    companyId: entry.companyId ?? null,
    userId: entry.userId ?? null,
    action: entry.action,
    module: entry.module,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    deviceId: entry.deviceId ?? null,
  });
}
