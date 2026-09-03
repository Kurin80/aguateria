import "../load-env-file.js";
import { and, eq } from "drizzle-orm";
import {
  billingPeriods,
  companies,
  connections,
  customerAccounts,
  customers,
  meters,
  roles,
  userRoles,
  users,
  zones,
} from "../db/schema.js";
import { closeDb, getDb } from "../db/client.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "../lib/password.js";

const env = loadEnv();
if (env.APP_ENV === "production" || !env.ALLOW_DEV_SEED) {
  throw new Error("Seed DEMO solo permitido con ALLOW_DEV_SEED=true y APP_ENV != production");
}

const db = getDb();
const [company] = await db.select().from(companies).limit(1);
if (!company) {
  console.log("No hay empresa. Ejecutá primero npm run db:seed");
  await closeDb();
  process.exit(1);
}
const companyId = company.id;

const [existing] = await db
  .select({ id: customers.id })
  .from(customers)
  .where(and(eq(customers.companyId, company.id), eq(customers.code, "DEMO-001")))
  .limit(1);
if (existing) {
  console.log("Cliente DEMO-001 ya existe");
} else {
  const [zone] = await db.select().from(zones).where(eq(zones.companyId, company.id)).limit(1);
  const [lectorRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.companyId, company.id), eq(roles.code, "LECTOR")))
    .limit(1);
  if (!lectorRole) throw new Error("Falta el rol LECTOR");

  const [lector] = await db
    .insert(users)
    .values({
      companyId: company.id,
      email: "lector@aguateria.local",
      username: "lector",
      passwordHash: await hashPassword(env.DEV_ADMIN_PASSWORD),
      fullName: "Lector DEMO",
    })
    .returning();
  await db.insert(userRoles).values({ userId: lector!.id, roleId: lectorRole.id });

  const [customer] = await db
    .insert(customers)
    .values({
      companyId: company.id,
      code: "DEMO-001",
      firstName: "María",
      lastName: "Benítez",
      ci: "0000001",
      address: "Calle DEMO 100, Asunción",
      city: "Asunción",
      department: "Central",
      latitude: "-25.2867460",
      longitude: "-57.6471630",
      notes: "Cliente de demostración. No es un abonado real.",
      status: "ACTIVO",
    })
    .returning();
  await db.insert(customerAccounts).values({ companyId: company.id, customerId: customer!.id, balance: "0.00" });

  const [connection] = await db
    .insert(connections)
    .values({
      companyId: company.id,
      customerId: customer!.id,
      code: "SUM-DEMO-001",
      accountNumber: "100001",
      address: "Calle DEMO 100, Asunción",
      zoneId: zone?.id,
      status: "ACTIVA",
      latitude: "-25.2867460",
      longitude: "-57.6471630",
      qrToken: crypto.randomUUID(),
      notes: "Suministro DEMO",
    })
    .returning();

  await db.insert(meters).values({
    companyId: company.id,
    connectionId: connection!.id,
    number: "00012345",
    brand: "DEMO",
    serial: "DEMO-MTR-1",
    initialReading: "100.000",
    status: "INSTALADO",
    notes: "Medidor DEMO. Lectura anterior de prueba: 100",
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  await db.insert(billingPeriods).values({
    companyId: company.id,
    code: `${y}-${m}-DEMO`,
    name: `Periodo DEMO ${m}/${y}`,
    startsOn: `${y}-${m}-01`,
    endsOn: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
    status: "ABIERTO",
  });

  console.log("Seed DEMO de campo OK: cliente DEMO-001, usuario lector@aguateria.local (misma clave DEV que el admin).");
}

const [existing2] = await db
  .select({ id: customers.id })
  .from(customers)
  .where(and(eq(customers.companyId, company.id), eq(customers.code, "DEMO-002")))
  .limit(1);
if (!existing2) {
  const [zone] = await db.select().from(zones).where(eq(zones.companyId, company.id)).limit(1);
  const [customer2] = await db
    .insert(customers)
    .values({
      companyId: company.id,
      code: "DEMO-002",
      firstName: "Juan",
      lastName: "Giménez",
      ci: "0000002",
      address: "Calle DEMO 200, Asunción",
      city: "Asunción",
      department: "Central",
      latitude: "-25.2869000",
      longitude: "-57.6473000",
      notes: "Cliente de demostración. No es un abonado real.",
      status: "ACTIVO",
    })
    .returning();
  await db.insert(customerAccounts).values({ companyId: company.id, customerId: customer2!.id, balance: "0.00" });
  const [connection2] = await db
    .insert(connections)
    .values({
      companyId: company.id,
      customerId: customer2!.id,
      code: "SUM-DEMO-002",
      accountNumber: "100002",
      address: "Calle DEMO 200, Asunción",
      zoneId: zone?.id,
      status: "ACTIVA",
      latitude: "-25.2869000",
      longitude: "-57.6473000",
      qrToken: crypto.randomUUID(),
      notes: "Suministro DEMO",
    })
    .returning();
  await db.insert(meters).values({
    companyId: company.id,
    connectionId: connection2!.id,
    number: "00067890",
    brand: "DEMO",
    serial: "DEMO-MTR-2",
    initialReading: "50.000",
    status: "INSTALADO",
    notes: "Medidor DEMO. Lectura anterior de prueba: 50",
  });
  console.log("Seed DEMO-002 OK: Juan Giménez / medidor 00067890 pendiente de lectura.");
}

async function ensureUser(code: string, email: string, username: string, fullName: string) {
  const [role] = await db.select().from(roles).where(and(eq(roles.companyId, companyId), eq(roles.code, code))).limit(1);
  if (!role) return;
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) return;
  const [u] = await db
    .insert(users)
    .values({
      companyId,
      email,
      username,
      passwordHash: await hashPassword(env.DEV_ADMIN_PASSWORD),
      fullName,
    })
    .returning();
  await db.insert(userRoles).values({ userId: u!.id, roleId: role.id });
  console.log(`Usuario de campo ${email} (${code})`);
}

await ensureUser("INSTALADOR", "instalador@aguateria.local", "instalador", "Instalador DEMO");
await ensureUser("COBRADOR", "cobrador@aguateria.local", "cobrador", "Cobrador DEMO");
await ensureUser("LECTORISTA", "lectorista@aguateria.local", "lectorista", "Lectorista DEMO");

await closeDb();
