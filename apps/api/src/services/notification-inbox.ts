import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { AuthUser } from "../http/types.js";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { jsonError } from "../lib/errors.js";
import { buildOperationalAlerts, loadOperationalAlertCounts, type OperationalAlert } from "./operational-alerts.js";

export type InboxItem = {
  id: string;
  kind: "OPERATIONAL" | "IN_APP";
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  count?: number;
};

export function isOperationalAlertDismissed(
  alert: Pick<OperationalAlert, "key" | "count">,
  dismissals: Array<{ alertKey: string; fingerprint: string }>,
): boolean {
  const row = dismissals.find((item) => item.alertKey === alert.key);
  return Boolean(row && row.fingerprint === String(alert.count));
}

function canSee(user: AuthUser, permission: string): boolean {
  return user.permissions.includes(permission as AuthUser["permissions"][number]);
}

async function loadVisibleOperational(db: Database, user: AuthUser): Promise<OperationalAlert[]> {
  const counts = await loadOperationalAlertCounts(db, user.companyId);
  return buildOperationalAlerts(counts, (permission) => canSee(user, permission));
}

async function loadDismissals(db: Database, user: AuthUser) {
  return db
    .select({
      alertKey: t.notificationDismissals.alertKey,
      fingerprint: t.notificationDismissals.fingerprint,
    })
    .from(t.notificationDismissals)
    .where(and(eq(t.notificationDismissals.companyId, user.companyId), eq(t.notificationDismissals.userId, user.id)));
}

async function upsertDismissal(db: Database, user: AuthUser, alertKey: string, fingerprint: string) {
  await db
    .insert(t.notificationDismissals)
    .values({
      companyId: user.companyId,
      userId: user.id,
      alertKey,
      fingerprint,
    })
    .onConflictDoUpdate({
      target: [t.notificationDismissals.userId, t.notificationDismissals.alertKey],
      set: { fingerprint, dismissedAt: new Date() },
    });
}

export async function listNotificationInbox(
  db: Database,
  user: AuthUser,
): Promise<{ data: InboxItem[]; unreadCount: number }> {
  const [alerts, dismissals] = await Promise.all([loadVisibleOperational(db, user), loadDismissals(db, user)]);
  const operational = alerts.filter((alert) => !isOperationalAlertDismissed(alert, dismissals)).map((alert) => ({
    id: `op:${alert.key}`,
    kind: "OPERATIONAL" as const,
    title: "Alerta operativa",
    body: alert.message,
    href: alert.href,
    readAt: null,
    createdAt: new Date().toISOString(),
    count: alert.count,
  }));

  const stored = user.permissions.includes("notificaciones.ver")
    ? await db
        .select()
        .from(t.notifications)
        .where(
          and(
            eq(t.notifications.companyId, user.companyId),
            or(eq(t.notifications.userId, user.id), isNull(t.notifications.userId)),
            isNull(t.notifications.readAt),
          ),
        )
        .orderBy(desc(t.notifications.createdAt))
        .limit(50)
    : [];

  const messages = stored.map((row) => {
    const payload = (row.payload ?? {}) as { href?: string };
    return {
      id: row.id,
      kind: "IN_APP" as const,
      title: row.title,
      body: row.body,
      href: payload.href ?? null,
      readAt: null,
      createdAt: row.createdAt.toISOString(),
    };
  });

  const data = [...operational, ...messages];
  return { data, unreadCount: data.length };
}

export async function markNotificationRead(db: Database, user: AuthUser, id: string): Promise<{ id: string }> {
  if (id.startsWith("op:")) {
    const key = id.slice(3);
    const alerts = await loadVisibleOperational(db, user);
    const alert = alerts.find((item) => item.key === key);
    await upsertDismissal(db, user, key, String(alert?.count ?? 0));
    return { id };
  }

  const [row] = await db
    .update(t.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(t.notifications.id, id),
        eq(t.notifications.companyId, user.companyId),
        or(eq(t.notifications.userId, user.id), isNull(t.notifications.userId)),
      ),
    )
    .returning({ id: t.notifications.id });
  if (!row) throw jsonError("NOT_FOUND", "Notificación no encontrada", 404);
  return { id: row.id };
}

export async function markAllNotificationsRead(db: Database, user: AuthUser): Promise<{ unreadCount: number }> {
  const alerts = await loadVisibleOperational(db, user);
  for (const alert of alerts) {
    await upsertDismissal(db, user, alert.key, String(alert.count));
  }
  if (user.permissions.includes("notificaciones.ver")) {
    await db
      .update(t.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(t.notifications.companyId, user.companyId),
          or(eq(t.notifications.userId, user.id), isNull(t.notifications.userId)),
          isNull(t.notifications.readAt),
        ),
      );
  }
  return { unreadCount: 0 };
}
