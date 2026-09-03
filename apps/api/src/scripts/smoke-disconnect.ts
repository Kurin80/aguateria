import "../load-env-file.js";
import { and, eq } from "drizzle-orm";
import {
  billingPeriods,
  companies,
  connections,
  customerAccounts,
  customers,
  files,
  suspensions,
  users,
  waterBills,
} from "../db/schema.js";
import { closeDb, getDb } from "../db/client.js";
import { loadEnv } from "../env.js";
import { nextConnectionCode, nextCustomerCode } from "../lib/connection-code.js";
import { scanDelinquency } from "../services/delinquency.js";

const env = loadEnv();
if (env.APP_ENV === "production") {
  throw new Error("Prueba de desconexión no se ejecuta en production");
}

const db = getDb();
const [company] = await db.select().from(companies).limit(1);
if (!company) throw new Error("No hay empresa");
const [admin] = await db.select().from(users).where(eq(users.email, env.DEV_ADMIN_EMAIL)).limit(1);
if (!admin) throw new Error("No hay admin de desarrollo");

const code = await nextCustomerCode(db, company.id);
const [customer] = await db
  .insert(customers)
  .values({
    companyId: company.id,
    code,
    firstName: "Mora",
    lastName: "TresMeses",
    ci: `SMK-${Date.now().toString().slice(-6)}`,
    address: "Calle prueba desconexión",
    city: "Asunción",
    latitude: "-25.2867460",
    longitude: "-57.6471630",
    status: "ACTIVO",
    notes: "Abonado de prueba de mora/desconexión. No es un cliente real.",
  })
  .returning();
await db.insert(customerAccounts).values({ companyId: company.id, customerId: customer!.id, balance: "450000.00", status: "MOROSO" });

const connCode = await nextConnectionCode(db, company.id);
const [connection] = await db
  .insert(connections)
  .values({
    companyId: company.id,
    customerId: customer!.id,
    code: connCode,
    accountNumber: connCode,
    address: "Calle prueba desconexión",
    status: "ACTIVA",
    latitude: "-25.2867460",
    longitude: "-57.6471630",
    qrToken: crypto.randomUUID(),
  })
  .returning();

const periods = [
  { code: `SMK-P1-${Date.now()}`, name: "Prueba mora 1", startsOn: "2026-04-01", endsOn: "2026-04-30", dueOn: "2026-05-10" },
  { code: `SMK-P2-${Date.now()}`, name: "Prueba mora 2", startsOn: "2026-05-01", endsOn: "2026-05-31", dueOn: "2026-06-10" },
  { code: `SMK-P3-${Date.now()}`, name: "Prueba mora 3", startsOn: "2026-06-01", endsOn: "2026-06-30", dueOn: "2026-07-10" },
];
let n = 1;
for (const p of periods) {
  const [period] = await db
    .insert(billingPeriods)
    .values({ companyId: company.id, code: p.code, name: p.name, startsOn: p.startsOn, endsOn: p.endsOn, dueOn: p.dueOn, status: "CERRADO" })
    .returning();
  await db.insert(waterBills).values({
    companyId: company.id,
    number: `SMK-${connCode}-${n}`,
    customerId: customer!.id,
    connectionId: connection!.id,
    billingPeriodId: period!.id,
    issuedOn: p.endsOn,
    dueOn: p.dueOn,
    subtotal: "150000.00",
    taxAmount: "0.00",
    total: "150000.00",
    balance: "150000.00",
    status: "VENCIDA",
  });
  n += 1;
}

const scan = await scanDelinquency(db, company.id, admin.id);
const [scheduled] = await db
  .select()
  .from(suspensions)
  .where(and(eq(suspensions.connectionId, connection!.id), eq(suspensions.status, "PROGRAMADA")))
  .limit(1);
if (!scheduled) {
  await closeDb();
  throw new Error(`No se programó desconexión. scan=${JSON.stringify(scan)}`);
}

await db
  .update(suspensions)
  .set({ status: "AUTORIZADA", authorizedBy: admin.id, authorizedAt: new Date() })
  .where(eq(suspensions.id, scheduled.id));

const [photo] = await db
  .insert(files)
  .values({
    companyId: company.id,
    bucket: env.STORAGE_BUCKET_PHOTOS,
    path: `smoke/disconnect-${scheduled.id}.jpg`,
    mimeType: "image/jpeg",
    uploadedBy: admin.id,
    metadata: { purpose: "disconnect-photo", fileName: "desconexion.jpg", smoke: true },
  })
  .returning();

await db
  .update(suspensions)
  .set({
    status: "EJECUTADA",
    executedAt: new Date(),
    userId: admin.id,
    photoFileId: photo!.id,
    latitude: "-25.2867460",
    longitude: "-57.6471630",
    gpsAccuracyM: "8.00",
    notes: "Ejecución de prueba con evidencia asociada. Coordenadas del suministro de prueba.",
  })
  .where(eq(suspensions.id, scheduled.id));
await db.update(connections).set({ status: "CORTADA", updatedAt: new Date() }).where(eq(connections.id, connection!.id));
await db.update(customers).set({ status: "DESCONECTADO", updatedAt: new Date() }).where(eq(customers.id, customer!.id));

const [done] = await db.select().from(suspensions).where(eq(suspensions.id, scheduled.id)).limit(1);
const [cn] = await db.select().from(connections).where(eq(connections.id, connection!.id)).limit(1);
const [cu] = await db.select().from(customers).where(eq(customers.id, customer!.id)).limit(1);

console.log(
  JSON.stringify(
    {
      ok: done?.status === "EJECUTADA" && cn?.status === "CORTADA" && cu?.status === "DESCONECTADO",
      scan,
      customer: cu?.code,
      connection: cn?.code,
      suspension: done?.status,
      photoFileId: done?.photoFileId,
      gps: { lat: done?.latitude, lng: done?.longitude, accuracy: done?.gpsAccuracyM },
    },
    null,
    2,
  ),
);

await closeDb();
if (done?.status !== "EJECUTADA") process.exit(1);
