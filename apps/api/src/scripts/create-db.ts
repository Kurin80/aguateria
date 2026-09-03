import "../load-env-file.js";
import postgres from "postgres";
import { assembleDatabaseUrl, loadEnv } from "../env.js";

const env = loadEnv();
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(env.DB_NAME)) {
  throw new Error(`DB_NAME inválido: ${env.DB_NAME}`);
}

const adminUrl = assembleDatabaseUrl({
  DB_HOST: env.DB_HOST,
  DB_PORT: env.DB_PORT,
  DB_NAME: "postgres",
  DB_USER: env.DB_USER,
  DB_PASSWORD: env.DB_PASSWORD,
});

const sql = postgres(adminUrl, {
  max: 1,
  connect_timeout: 15,
  ssl: env.DATABASE_SSL ? "require" : false,
});

try {
  const existing = await sql`select 1 from pg_database where datname = ${env.DB_NAME}`;
  if (existing.length) {
    console.log(`La base ${env.DB_NAME} ya existe en ${env.DB_HOST}:${env.DB_PORT}`);
  } else {
    await sql.unsafe(`CREATE DATABASE ${env.DB_NAME} WITH ENCODING 'UTF8'`);
    console.log(`Base ${env.DB_NAME} creada en ${env.DB_HOST}:${env.DB_PORT}`);
  }
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  if (code === "28P01") {
    throw new Error(
      `PostgreSQL rechazó DB_USER/DB_PASSWORD. En Windows, alineá .env con la clave de tu usuario ${env.DB_USER} en ${env.DB_HOST}:${env.DB_PORT} (Docker no está instalado; se usa el PostgreSQL local).`,
    );
  }
  throw err;
} finally {
  await sql.end();
}
