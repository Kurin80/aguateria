# Seguridad

## 1. Superficie

- Web (Vercel, HTTPS).
- API (mismo origen `/api` o dominio API, HTTPS).
- Android → API solamente.
- PostgreSQL y Storage: red de Supabase; **service role solo en el servidor**.

## 2. Secretos

Nunca en git, APK, frontend ni logs.

`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, certificados SIFEN (PKCS#12) y contraseñas se leen de variables de entorno / secret store. El certificado se monta como archivo o base64 en el entorno de la API, no en el cliente.

`.env.example` lista nombres, no valores.

## 3. Autenticación

- Argon2id para contraseñas (parámetros de memoria acotados a serverless).
- JWT access (p. ej. 15 min) firmado con `AUTH_SECRET`.
- Refresh opaco, hasheado (SHA-256), rotación: reutilizar un refresh revocado invalida la familia (posible robo).
- Web: access + refresh token en `sessionStorage` (por pestaña, se borra al cerrar),
  enviados en `Authorization: Bearer`. Sin cookies ⇒ sin superficie CSRF clásica.
  Refresh de un solo vuelo en el cliente para evitar cierres de sesión espurios.
- Android usa el body y almacenamiento cifrado.
- JWT access: HS256 con algoritmo fijado en la verificación (`algorithms: ["HS256"]`).
- Lockout progresivo + `login_attempts` + rate limit IP.
- Reset de contraseña: token de un solo uso, expiración corta.

## 4. Autorización (RBAC)

Middleware `requirePermission('facturas.anular')`. El SUPER_ADMIN no bypasea de forma implícita en código de negocio: también tiene el set de permisos asignado (seed).

Permisos granulares (`clientes.ver|crear|editar`, `lecturas.aprobar`, `facturas.anular`, `timbrados.editar`, `billing_periods.reopen`, …).

## 5. API

- Validación Zod en todos los inputs (body, query, params).
- SQL solo parametrizado (Drizzle ≥ 0.45.2 — corrige GHSA-gpj5-g38j-94v9).
- **Multi-tenancy**: cada endpoint filtra por `company_id` del token; los endpoints
  que direccionan por `:id` verifican pertenencia a la empresa antes de leer/mutar
  (evita IDOR entre prestadores). Los `PATCH` usan schemas Zod `.strict()`
  (sin mass-assignment de `company_id`, `status`, etc.).
- Rate limit por IP (primera entrada de `x-forwarded-for`, no falsificable tras el
  proxy de Vercel) + lockout por cuenta en login; también en `/refresh`, `/forgot`,
  `/reset` y `/sync/push`.
- CORS: orígenes de `CORS_ORIGINS` / `WEB_ORIGIN` (lista blanca exacta en producción).
- Cabeceras (`vercel.json`): `Content-Security-Policy` (`script-src 'self'`),
  `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`.
- Reportes CSV: se neutraliza la inyección de fórmulas (`=`,`+`,`-`,`@`).
- Payloads y uploads: MIME allowlist y límite de tamaño por bucket (`0002_storage.sql`).
- XSS: React escapa por defecto; no `dangerouslySetInnerHTML`.
- CSRF: no aplica (Bearer token, sin cookies).

## 6. Datos

- RLS en Supabase: habilitada en **todas** las tablas `public` sin políticas para
  `anon`/`authenticated` ⇒ deny total vía PostgREST; además se revocan los GRANT
  por defecto (`supabase/migrations/0011_rls_hardening.sql`). La API se conecta con
  el rol `postgres` (BYPASSRLS) tras autenticar y autorizar al empleado.
- Storage: buckets privados; el cliente obtiene URL firmada de corta vida.
- Soft delete; fiscales sin delete físico (trigger).
- PII (CI, RUC, teléfono): acceso según permiso; auditoría de lecturas sensibles opcional en configuración.

## 7. Sesiones y dispositivos

- Lista de sesiones / refresh por dispositivo.
- Logout remoto revoca todos los refresh del usuario (`users.logout-all` permiso admin).

## 8. SIFEN

- mTLS solo servidor a servidor.
- Clave del PKCS#12 nunca se envía al browser.
- Respuestas SIFEN se guardan; no se reescribe un APROBADO a mano.

## 9. Auditoría

`audit_logs` para: login fallido, factura emitida/anulada, NC/ND, pago, lectura modificada, tarifa, timbrado, usuario, reapertura de periodo, resolución de conflicto.

Campos: actor, IP, user-agent, módulo, entidad, old/new, device id.

## 10. Reloj y dinero

Operaciones críticas: `now()` del servidor (PostgreSQL `timestamptz`).
PYG: `NUMERIC`; redondeo configurable (por defecto 0 decimales de cobro, 2 en cálculo intermedio si se configura).

## 11. Amenazas móviles

- Rechazo de ubicaciones mock si está configurado.
- Pinning TLS opcional.
- Idempotencia contra replay de lecturas/pagos.

## 12. Dependencias y despliegue

- HTTPS obligatorio en preview/production (Vercel).
- No debug en production.
- Rotación de `AUTH_SECRET` invalida access tokens (refresh sigue hasta rotar).
