import "../load-env-file.js";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@aguateria/shared";
import {
  companies,
  customerCategories,
  delinquencyRules,
  establishments,
  paymentMethods,
  permissions,
  rolePermissions,
  roles,
  salesPoints,
  systemSettings,
  taxRates,
  userRoles,
  users,
  zones,
} from "../db/schema.js";
import { closeDb, getDb } from "../db/client.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "../lib/password.js";

const env = loadEnv();
if (env.APP_ENV === "production" || !env.ALLOW_DEV_SEED) {
  throw new Error("Seed solo permitido con ALLOW_DEV_SEED=true y APP_ENV != production");
}

const db = getDb();

const already = await db.select({ id: companies.id }).from(companies).limit(1);
if (already.length) {
  console.log("Seed omitido: ya hay datos en companies. Usuario DEV no se recrea.");
  await closeDb();
  process.exit(0);
}

const [company] = await db
  .insert(companies)
  .values({
    legalName: "Prestador de Agua Potable (DESARROLLO)",
    tradeName: "Aguatería",
    ruc: "80000000",
    dv: "8",
    address: "Asunción, Paraguay",
    phone: "021000000",
    email: "dev@aguateria.local",
  })
  .returning();

if (!company) throw new Error("No se pudo crear empresa");

const permRows = [];
for (const code of PERMISSIONS) {
  const [p] = await db.insert(permissions).values({ code, description: code }).returning();
  permRows.push(p!);
}

const roleRows = [];
for (const code of ROLES) {
  const [role] = await db.insert(roles).values({ companyId: company.id, code, name: code }).returning();
  roleRows.push(role!);
  const allowed = ROLE_PERMISSIONS[code];
  const links = permRows.filter((p) => allowed.includes(p.code as (typeof allowed)[number])).map((p) => ({
    roleId: role!.id,
    permissionId: p.id,
  }));
  if (links.length) await db.insert(rolePermissions).values(links);
}

const [admin] = await db
  .insert(users)
  .values({
    companyId: company.id,
    email: env.DEV_ADMIN_EMAIL,
    username: "admin",
    passwordHash: await hashPassword(env.DEV_ADMIN_PASSWORD),
    fullName: "Administrador desarrollo",
  })
  .returning();

const superRole = roleRows.find((r) => r.code === "SUPER_ADMIN")!;
await db.insert(userRoles).values({ userId: admin!.id, roleId: superRole.id });

await db.insert(customerCategories).values(
  ["RESIDENCIAL", "COMERCIAL", "INDUSTRIAL", "INSTITUCIONAL", "ESPECIAL"].map((code) => ({
    companyId: company.id,
    code,
    name: code,
  })),
);

await db.insert(taxRates).values([
  { companyId: company.id, code: "IVA10", name: "IVA 10%", rate: "0.1000", exempt: false },
  { companyId: company.id, code: "IVA5", name: "IVA 5%", rate: "0.0500", exempt: false },
  { companyId: company.id, code: "EXENTO", name: "Exento", rate: "0.0000", exempt: true },
]);

await db.insert(paymentMethods).values(
  ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "QR", "OTROS"].map((code) => ({
    companyId: company.id,
    code,
    name: code,
  })),
);

await db.insert(zones).values({ companyId: company.id, code: "Z01", name: "Zona Centro" });
const [est] = await db.insert(establishments).values({ companyId: company.id, code: "001", name: "Casa matriz" }).returning();
await db.insert(salesPoints).values({ establishmentId: est!.id, code: "001", name: "Punto 001" });
await db.insert(delinquencyRules).values({ companyId: company.id, graceDays: 5, surchargePercent: "0", interestPercentMonthly: "0", suspendAfterDays: 60, notifyBeforeDueDays: 3 });
await db.insert(systemSettings).values([
  { companyId: company.id, key: "gps.maxAccuracyMeters", value: 30 },
  { companyId: company.id, key: "gps.rejectMock", value: true },
  { companyId: company.id, key: "gps.geofenceMeters", value: 50 },
  { companyId: company.id, key: "gps.geofenceBlock", value: false },
  { companyId: company.id, key: "photo.required", value: true },
]);

console.log(`Seed DEV OK. Usuario ${env.DEV_ADMIN_EMAIL} (solo desarrollo). Empresa ${company.id}`);
await closeDb();
