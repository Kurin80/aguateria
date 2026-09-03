# Aguatería — plataforma de gestión de agua potable (Paraguay)

Sistema de producción para prestadores de agua potable: operación comercial, trabajo de campo (Android), boletas de consumo y facturación tributaria paraguaya (DNIT / SIFEN).

**Desarrollo local:** la aplicación y PostgreSQL corren en tu PC. No hace falta Vercel ni Supabase para desarrollar.

**No es un prototipo.** La boleta de consumo y el comprobante tributario son módulos distintos. Un documento **nunca** se marca como aceptado por SIFEN si la DNIT no respondió.

Documentación:

- [Arquitectura](docs/ARCHITECTURE.md)
- [Base de datos](docs/DATABASE.md)
- [API](docs/API.md)
- [Android](docs/MOBILE.md)
- [Facturación Paraguay](docs/BILLING_PARAGUAY.md)
- [Seguridad](docs/SECURITY.md)
- [Despliegue](docs/DEPLOYMENT.md)

## 1. Requisitos (Windows)

- [Node.js](https://nodejs.org/) 20.11 o posterior
- PostgreSQL 16 **o** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recomendado para la base)
- Git (opcional)
- Android Studio (Koala o posterior) solo si vas a compilar la app de campo
- Certificado digital PSC y timbrado Marangatu **solo** cuando vaya a transmitir DTE reales

En PowerShell usá `;` para encadenar comandos si tu versión no admite `&&`.

## 2. Instalación

Desde la raíz del repositorio:

```powershell
npm install
Copy-Item .env.example .env
```

Editá `.env` y definí al menos:

- `DB_PASSWORD` — contraseña de PostgreSQL local
- `AUTH_SECRET` — cadena aleatoria de 16+ caracteres (no uses `secret`)
- `ALLOW_DEV_SEED=true` — solo en desarrollo, para el usuario de demostración

`.env` no se sube a Git.

## 3. Configuración de PostgreSQL

Valores por defecto (modificables en `.env`):

| Variable | Valor típico |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` (si ese puerto es un PostgreSQL antiguo, usá el puerto de la versión 15+, p. ej. `5433`) |
| `DB_NAME` | `aguateria_db` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | la de tu usuario PostgreSQL local |

Este proyecto necesita **PostgreSQL 14 o posterior** (`pgcrypto`, `pg_trgm`, `gen_random_uuid()`). PostgreSQL 9.x en el puerto 5432 no sirve.

### Opción A — Docker (recomendada)

```powershell
npm run db:up
```

Esperá a que el contenedor `aguateria-postgres` esté healthy. Si el puerto 5432 ya está ocupado por un PostgreSQL de Windows, cambiá `DB_PORT` en `.env` (por ejemplo `5433`) y volvé a levantar.

### Opción B — PostgreSQL instalado en Windows

1. Asegurate de que el servicio esté en el puerto de `DB_PORT`.
2. Creá la base (o usá el script):

```powershell
npm run db:create
```

El script se conecta a la base `postgres` y ejecuta `CREATE DATABASE aguateria_db` si no existe.

## 4. Variables de entorno

Ver `.env.example`. Las más importantes en local:

```env
NODE_ENV no es obligatorio; usamos APP_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aguateria_db
DB_USER=postgres
DB_PASSWORD=...
DATABASE_URL=postgresql://postgres:...@localhost:5432/aguateria_db
DATABASE_SSL=false
STORAGE_DRIVER=local
API_PORT=3001
WEB_ORIGIN=http://localhost:5173
API_PUBLIC_URL=http://localhost:3001
```

Si `DATABASE_URL` está vacío, la API la arma desde `DB_*`.

`SUPABASE_*` es opcional y **no se usa** con `STORAGE_DRIVER=local`. No pongas la service role en Vite ni en el APK.

SIFEN/DNIT: si vas a transmitir DTE reales necesitás `SIFEN_ENABLED=true`, certificado PKCS#12, CSC y host oficial (`sifen-test.set.gov.py` o `sifen.set.gov.py`). Sin eso el envío queda en `SIFEN_NOT_CONFIGURED`; no se simula una aprobación tributaria.

## 5. Migraciones

ORM: **Drizzle** (no Prisma). El esquema SQL está en `supabase/migrations/` (nombre histórico de carpeta; se aplica contra PostgreSQL local).

```powershell
npm run db:migrate
```

La migración `0002_storage.sql` (catálogo Storage de Supabase) se omite en local.

## 6. Seed (solo desarrollo)

```powershell
npm run db:seed
```

Equivale a `npm run seed`. Requiere `ALLOW_DEV_SEED=true` y `APP_ENV` distinto de `production`.

Crea empresa, roles, permisos, IVA, métodos de pago y un administrador de **demostración**:

- Usuario: el de `DEV_ADMIN_EMAIL` (por defecto `admin@aguateria.local`)
- Contraseña: la de `DEV_ADMIN_PASSWORD` (por defecto `ChangeMe_DevOnly_1`)

Esos valores son de desarrollo, no de producción. Si ya hay filas en `companies`, el seed no se vuelve a ejecutar.

## 7. Ejecutar la aplicación

Un solo comando inicia API y web:

```powershell
npm run dev
```

Por separado:

```powershell
npm run dev:server
npm run dev:client
```

Build de producción (local, sin Vercel):

```powershell
npm run build
```

API compilada: `npm run start -w @aguateria/api` (requiere PostgreSQL y `.env`).

## 8. URLs locales

```text
Frontend:  https://localhost:5173
Backend:   http://localhost:3001
API health: http://localhost:3001/api/health
Database:  DB_HOST:DB_PORT (por defecto localhost:5432, base aguateria_db)
Archivos:  data/uploads
```

Si `npm run db:migrate` falla con error de sintaxis cerca de `not` o no reconoce `pgcrypto`, el puerto apunta a un PostgreSQL demasiado viejo (p. ej. 9.0 en 5432). Usá el puerto de PostgreSQL 15+ (en muchas PCs Windows es `5433`).

Tras cambiar `.env`, reiniciá `npm run dev` (tsx no recarga el archivo `.env` solo).

La web (Vite) proxea `/api` hacia `http://localhost:3001`. En desarrollo Vite sirve **HTTPS** para que el GPS del celular funcione.

## Lectura de campo (LECTOR)

Rol `LECTOR`: login, cola de lecturas, GPS, fotografía y historial propio. No ve facturación, usuarios ni configuración.

Flujo web (móvil): `https://<IP-de-la-PC>:5173/campo` (Vite con HTTPS). El celular usa GPS y cámara nativos; el navegador pide permiso.

```text
Login → Lecturas del día → Iniciar lectura → Cliente → Lectura actual → Foto (cámara) → Guardar (GPS) → Siguiente
```

Desde el teléfono, en la misma Wi‑Fi que la PC:

1. `npm run dev` (API + web). Vite muestra una URL **https://192.168.…:5173/**
2. Abrila en Chrome/Safari. Aceptá el certificado de desarrollo (Advertencia → Avanzado → continuar).
3. Ingresá con `lector@aguateria.local` (seed de campo) u otro usuario.
4. Al tomar la foto se abre la cámara trasera. Al guardar se pide el GPS. No se simulan coordenadas ni fotos.

En producción el sitio debe estar en HTTPS. Offline de campo: app Android.

- Consumo = lectura actual − anterior (el backend es la fuente de verdad).
- GPS nativo del dispositivo; se compara con las coordenadas del suministro (geovalla configurable, default 50 m). Fuera de rango: se registra incidencia. El bloqueo duro es opcional (`gps.geofenceBlock`).
- El rol LECTOR (sin rol de oficina) entra directo a `/campo`. No puede abrir facturación, usuarios ni configuración aunque conozca la URL.
- Foto en `data/uploads` (local) asociada a la lectura (`purpose: meter-photo`).
- Lectura menor que la anterior no se acepta como normal: hay que marcar incidencia / cambio de medidor.
- Duplicado del mismo medidor en el mismo período: HTTP 409.
- El lector de campo no puede registrar una lectura sin GPS (validado en API).
- Offline completo: app Android (Room + WorkManager). La web de campo requiere conexión.

Parámetros en Configuración (admin): precisión GPS, geovalla, foto obligatoria.

La cola de campo lista conexiones activas con medidor. Datos DEMO locales (idempotente): `npm run db:seed-demo-field` crea el cliente `DEMO-001`, medidor `00012345` y el usuario `lector@aguateria.local` (misma clave DEV que el admin).

Migración: `npm run db:migrate` aplica `0003_field_readings.sql`.

## Calidad

```powershell
npm run lint
npm run test
npm run build
```

## SIFEN

Fuentes oficiales: [Documentación técnica e-Kuatia](https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica) (Manual Técnico v150 + notas técnicas).

Ambientes DNIT:

- Pruebas: `sifen-test.set.gov.py` (sin valor jurídico)
- Producción: `sifen.set.gov.py`

Hasta cargar certificado PKCS#12, CSC y `SIFEN_ENABLED=true`, el envío queda en `SIFEN_NOT_CONFIGURED`. La UI no muestra “factura electrónica válida”.

## Android

Proyecto en `apps/android`. Configurar `API_BASE_URL` en `local.properties` (por ejemplo `http://10.0.2.2:3001/api` en emulador). La app usa Room + WorkManager para offline e `idempotency_key` en cada operación.

## Despliegue: Vercel + Supabase

Runbook completo en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- Web: build estático de Vite servido por Vercel.
- API: una Serverless Function (`api/index.ts` → Hono) para todo `/api/*`.
- DB: Supabase PostgreSQL vía pooler (`DATABASE_URL` puerto 6543, `DATABASE_SSL=true`).
  La API se conecta con el rol `postgres`; RLS está habilitada en todas las tablas
  sin políticas (deny total para acceso directo). `supabase/migrations/0011_rls_hardening.sql`.
- Archivos: `STORAGE_DRIVER=supabase` → URLs firmadas de Supabase Storage. El
  driver `local` (disco) **no** funciona en Vercel (FS efímero).
- Tarea diaria: Vercel Cron → `POST /api/internal/cron` (protegido con `CRON_SECRET`),
  recalcula el estado de mora de cada empresa.

El desarrollo local sigue sin depender de Vercel ni Supabase (PostgreSQL local + disco).

## ERSSAN

Marco: Ley 1614/2000 y Decreto 18880/2002. El módulo Regulación almacena documentos; no inventa obligaciones.

## Licencia

Uso interno del prestador. Ajustar según el contrato del proyecto.
