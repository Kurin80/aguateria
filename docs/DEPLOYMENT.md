# Despliegue — Vercel + Supabase

## 0. Modelo de arquitectura en producción

```
Navegador / Android
      │  HTTPS  (Bearer token propio, no cookies)
      ▼
Vercel  ──────────────────────────────────────────────
  • SPA estática (Vite build)            apps/web/dist
  • 1 Serverless Function  /api/*        api/index.ts  → Hono
      │                         │
      │ postgres (pooler 6543)  │ service_role key
      ▼                         ▼
Supabase PostgreSQL        Supabase Storage (buckets privados, URLs firmadas)
```

- El front **nunca** habla directo con Supabase. Toda consulta pasa por `/api`.
- La Function se conecta con el rol `postgres` (BYPASSRLS). RLS está **habilitada
  en todas las tablas sin políticas** ⇒ deny total para `anon`/`authenticated`
  (PostgREST). Ver `supabase/migrations/0011_rls_hardening.sql`.
- La `SUPABASE_SERVICE_ROLE_KEY` sólo vive en variables de entorno del backend.

## 1. Supabase — YA PROVISIONADO

Proyecto: **`osjhtedpgqlwjmgluzkd`** (`https://osjhtedpgqlwjmgluzkd.supabase.co`), región `us-east-2`, Postgres 17.

Hecho (vía MCP, este proyecto):

- ✅ Esquema completo: migraciones `0001`..`0013` aplicadas (72 tablas + triggers fiscales + índices).
- ✅ Storage: 5 buckets privados creados con límite MIME/tamaño — `meter-photos`,
  `documents`, `tax-xml`, `kude`, `expense-vouchers` — + policy deny para anon/authenticated.
- ✅ RLS: habilitada en **72/72** tablas `public`, sin políticas (deny total vía
  PostgREST); grants revocados a `anon`/`authenticated` (`0011`).
- ✅ Endurecimiento de funciones (`0013`): `search_path` fijo en los triggers
  fiscales; `rls_auto_enable()` sin EXECUTE para anon/authenticated.
- ✅ Advisor de seguridad: sin hallazgos accionables. Queda 1 aviso cosmético
  (`extension_in_public` para `pg_trgm`) que no se corrige para no reconstruir el
  índice GIN de búsqueda; sin impacto real (Supabase bloquea escritura en `public`).
- ✅ Ledger `schema_migrations` backfilleado (0001..0013) para que
  `npm run db:migrate` contra este proyecto sea un no-op.

Falta (sólo se obtienen del **dashboard de Supabase**, no vía API):

| Valor | Dónde | Uso |
|---|---|---|
| **DB password** | Settings → Database → *Reset database password* (si no la tenés) | armar `DATABASE_URL` |
| **`DATABASE_URL`** | Settings → Database → Connection string → **Transaction pooler** (`:6543`) + `?sslmode=require` | conexión de la Function |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Settings → API → `service_role` (secret) | firmar URLs de Storage |

`SUPABASE_URL` = `https://osjhtedpgqlwjmgluzkd.supabase.co` ·
`SUPABASE_ANON_KEY` (opcional, hoy no se usa) = ver Settings → API → `anon public`.

Verificación (ya corrida): `select count(*) filter (where rowsecurity), count(*) from pg_tables where schemaname='public'` → `72, 72`.

## 3. Vercel — desplegar

Proyecto existente en la cuenta: **`aguateria-la-roca`** (team `dgzc26-9044s-projects`,
plan Hobby). Sin repo git conectado.

`vercel.json` ya define todo: framework Vite, `buildCommand` (shared + web),
`outputDirectory` `apps/web/dist`, la Function `api/index.ts` (`maxDuration 60`,
`memory 1024`), rewrites `/api/*` → Function y SPA fallback, headers CSP/seguridad,
y el cron `POST/GET /api/internal/cron` a las `11:00 UTC` (08:00 Asunción).
Node lo toma de `engines.node` (`22.x`).

**Opción A — Vercel CLI (recomendada, sin git):**

```bash
npm i -g vercel
vercel login
vercel link --project aguateria-la-roca          # en la raíz del repo
# cargar variables (ver tabla abajo); repetir por cada una o usar el dashboard:
vercel env add AUTH_SECRET production
# ... etc ...
vercel --prod                                     # build + deploy
```

**Opción B — conectar el repo a GitHub** y en Vercel *Import Git Repository*
apuntando a la raíz del monorepo. Redeploys automáticos en cada push a la rama de producción.

> Plan **Hobby**: 1 cron diario está dentro del límite. Uso comercial real
> requiere plan Pro según los términos de Vercel.

### Variables de entorno (Project → Settings → Environment Variables)

Marcar todas como **Production** (y Preview si se usa). Ninguna con prefijo
`VITE_` salvo las de mapas.

| Variable | Valor | Ámbito |
|---|---|---|
| `APP_ENV` | `production` | privada |
| `APP_TIMEZONE` | `America/Asuncion` | privada |
| `AUTH_SECRET` | cadena aleatoria de 32+ chars (`openssl rand -base64 48`) | privada |
| `CRON_SECRET` | cadena aleatoria (`openssl rand -hex 32`) | privada |
| `DATABASE_URL` | pooler Supabase del proyecto `osjhtedpgqlwjmgluzkd`, **Transaction** `:6543`, con `?sslmode=require` | privada |
| `DIRECT_URL` | *(opcional en runtime)* directa `:5432?sslmode=require` | privada |
| `DATABASE_SSL` | `true` | privada |
| `WEB_ORIGIN` | `https://aguateria-la-roca.vercel.app` (o el dominio final) | privada |
| `CORS_ORIGINS` | `https://aguateria-la-roca.vercel.app` (dominios exactos, coma) | privada |
| `API_PUBLIC_URL` | `https://aguateria-la-roca.vercel.app` | privada |
| `APP_PUBLIC_URL` | `https://aguateria-la-roca.vercel.app` | privada |
| `STORAGE_DRIVER` | `supabase` | privada |
| `SUPABASE_URL` | `https://osjhtedpgqlwjmgluzkd.supabase.co` | privada |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret (Supabase → Settings → API) | **privada** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | credenciales SMTP reales (recuperación de contraseña) | privada |
| `ALLOW_DEV_SEED` | *(omitir / `false`)* | privada |
| `SIFEN_*` | ver `.env.example` (sólo con certificado PKCS#12 + CSC reales) | privada |

> `APP_ENV=production` hace que la API **falle al arrancar** si `AUTH_SECRET`
> es el placeholder o si `ALLOW_DEV_SEED=true`. Es intencional.

### Cron

Vercel Cron envía `Authorization: Bearer $CRON_SECRET` a `/api/internal/cron`.
El handler recorre las empresas activas y recalcula el estado de mora
(`scanDelinquency`) — mismo efecto que el botón "Escanear mora". Idempotente.

## 4. Post-deploy — verificación

```bash
curl https://<app>.vercel.app/api/health
# → { data: { ok: true, database: "up", env: "production", storage: "supabase" } }
```

- Login con un usuario real → navegar dashboard, clientes, boletas.
- Subida de foto de lectura → debe devolver una URL firmada de Supabase (no `/api/files/...`).
- `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/internal/cron` → `{ ok: true, ... }`.
- Revisar **Supabase → Advisors** (Security + Performance) y **Vercel → Logs**.

## 5. Android

- `API_BASE_URL` en `local.properties` / CI apuntando a `https://<app>.vercel.app/api`.
- Release: signing por variables de CI. `google-services.json` fuera de git.

## 6. SIFEN en producción

1. Completar pruebas en `sifen-test.set.gov.py` según guía DNIT.
2. Timbrado de producción vía Marangatu.
3. Cargar `SIFEN_CERT_BASE64` (o `SIFEN_CERT_PATH`), `SIFEN_CERT_PASSWORD`,
   `SIFEN_CSC`, `SIFEN_CSC_ID` como secretos. `SIFEN_ENVIRONMENT=production`,
   `SIFEN_ENABLED=true`.
4. Sin esos secretos el envío queda en `SIFEN_NOT_CONFIGURED` y la UI **no**
   muestra "factura electrónica válida". No se simula una aprobación.

## 7. Backups / rollback (Supabase)

- **Backups**: plan Free = diarios 7 días; Pro = PITR configurable. Activar PITR
  para producción real.
- **Restore**: Supabase Dashboard → Database → Backups. Para un cambio de schema
  arriesgado, crear un **branch** de Supabase, migrar y probar ahí primero.
- **Rollback de migración**: las migraciones son forward-only (no hay `down`).
  Escribir una nueva migración correctiva; no editar una ya aplicada.
- Nunca correr `db:seed` ni operaciones destructivas contra producción.

## 8. Checklist de go-live

- [ ] `AUTH_SECRET` y `CRON_SECRET` aleatorios y sólo en env del backend
- [ ] `SUPABASE_SERVICE_ROLE_KEY` ausente del bundle web y del APK
- [ ] `APP_ENV=production`, `ALLOW_DEV_SEED` sin definir
- [ ] `DATABASE_URL` = pooler `:6543`, `DATABASE_SSL=true`
- [ ] Migraciones `0001..0011` aplicadas; `rls_on == total` de tablas
- [ ] `STORAGE_DRIVER=supabase`, buckets privados creados
- [ ] `WEB_ORIGIN` / `CORS_ORIGINS` = dominio exacto de Vercel
- [ ] `/api/health` → `database: up`, `storage: supabase`
- [ ] Cron responde 200 con el secreto y 401 sin él
- [ ] Empresa, roles/permisos, tarifas, timbrado reales cargados
- [ ] `npm run lint && npm run typecheck && npm run test && npm run build` en verde
- [ ] `npm audit` sin vulnerabilidades
- [ ] Backups / PITR de Supabase activados
