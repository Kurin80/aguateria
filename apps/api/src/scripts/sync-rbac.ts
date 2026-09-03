import "../load-env-file.js";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@aguateria/shared";
import { and, eq } from "drizzle-orm";
import {
  companies,
  delinquencyRules,
  paymentMethods,
  permissions,
  rolePermissions,
  roles,
  systemSettings,
} from "../db/schema.js";
import { closeDb, getDb } from "../db/client.js";

const db = getDb();
const companiesRows = await db.select().from(companies);
if (!companiesRows.length) {
  console.log("No hay empresa. Ejecutá npm run db:seed primero.");
  await closeDb();
  process.exit(1);
}

const existingPerms = await db.select().from(permissions);
const permByCode = new Map(existingPerms.map((p) => [p.code, p]));
for (const code of PERMISSIONS) {
  if (permByCode.has(code)) continue;
  const [p] = await db.insert(permissions).values({ code, description: code }).returning();
  permByCode.set(code, p!);
}

for (const company of companiesRows) {
  const existingRoles = await db.select().from(roles).where(eq(roles.companyId, company.id));
  const roleByCode = new Map(existingRoles.map((r) => [r.code, r]));
  for (const code of ROLES) {
    if (!roleByCode.has(code)) {
      const [role] = await db.insert(roles).values({ companyId: company.id, code, name: code }).returning();
      roleByCode.set(code, role!);
    }
  }
  for (const role of roleByCode.values()) {
    const allowed = ROLE_PERMISSIONS[role.code as keyof typeof ROLE_PERMISSIONS];
    if (!allowed) continue;
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    const links = allowed
      .map((code) => permByCode.get(code))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ roleId: role.id, permissionId: p.id }));
    if (links.length) await db.insert(rolePermissions).values(links);
  }

  const methods = await db.select().from(paymentMethods).where(eq(paymentMethods.companyId, company.id));
  const methodCodes = new Set(methods.map((m) => m.code));
  for (const code of ["TARJETA_CREDITO", "TARJETA_DEBITO"]) {
    if (!methodCodes.has(code)) {
      await db.insert(paymentMethods).values({ companyId: company.id, code, name: code.replaceAll("_", " ") });
    }
  }

  const settings = [
    { key: "mora.unpaidPeriods", value: 3 as unknown },
    { key: "cobranza.gpsIntervalSeconds", value: 30 as unknown },
    { key: "gps.geofencePolicy", value: "ADVERTIR" as unknown },
  ];
  for (const s of settings) {
    const [existing] = await db
      .select()
      .from(systemSettings)
      .where(and(eq(systemSettings.companyId, company.id), eq(systemSettings.key, s.key)))
      .limit(1);
    if (!existing) await db.insert(systemSettings).values({ companyId: company.id, key: s.key, value: s.value });
  }

  const [rule] = await db.select().from(delinquencyRules).where(eq(delinquencyRules.companyId, company.id)).limit(1);
  if (rule && (rule.unpaidPeriodsForDisconnect == null || rule.unpaidPeriodsForDisconnect < 1)) {
    await db.update(delinquencyRules).set({ unpaidPeriodsForDisconnect: 3 }).where(eq(delinquencyRules.id, rule.id));
  }
}

console.log(`RBAC sincronizado para ${companiesRows.length} empresa(s).`);
await closeDb();
