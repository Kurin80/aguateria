# API REST

Base URL (producción): `https://<dominio>/api`
Base URL (local): `http://localhost:3001/api`

Todas las entradas se validan con Zod. Respuestas JSON `{ data }` o `{ error: { code, message, details? } }`.
Fechas en ISO-8601 UTC; el servidor interpreta negocio en `America/Asuncion`.
Montos como string decimal (`"15000.00"`) para evitar errores de IEEE-754.

## 1. Autenticación

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/login` | no | email/username + password |
| POST | `/auth/refresh` | refresh | rota tokens |
| POST | `/auth/logout` | sí | revoca refresh |
| POST | `/auth/forgot-password` | no | envía email de reset (si SMTP configurado) |
| POST | `/auth/reset-password` | no | token de un solo uso |
| GET | `/auth/me` | sí | usuario, roles, permisos |

Login responde access token (corto) + refresh token (httpOnly cookie en web; body en Android nativo).
Lockout: 5 fallos (configurable) → cuenta bloqueada temporalmente.

Header Android: `Authorization: Bearer <access>` y `X-Idempotency-Key` / `X-Device-Id` / `X-App-Version`.

## 2. Convenciones

- Paginación: `?page=1&pageSize=20` → `{ data, meta: { page, pageSize, total } }`
- Filtros: query params tipados.
- Baja lógica: `DELETE` → soft delete cuando el recurso lo permite. Recursos fiscales: no hay DELETE.
- Permiso requerido documentado por ruta (`clientes.ver`, etc.).

## 3. Recursos

### Organización
`GET/PATCH /company` · `GET/PATCH /settings` · CRUD `/users` `/roles`

### Catálogo
CRUD `/zones` `/neighborhoods` `/categories` `/tariffs` `/tax-rates`

### Operación comercial
CRUD+search `/customers`  
CRUD `/connections`  
CRUD `/meters` · `GET /meters/:id/events`  
CRUD `/readings` (crear desde web o sync)  
`GET /field/queue` · `POST /field/start` · `POST /readings`

### Facturación operativa
CRUD `/billing-periods` · transiciones de estado  
`POST /billing-periods/:id/calculate` → `ConsumptionCalculationService`  
`POST /billing-periods/:id/generate-bills`  
CRUD `/bills` · `GET /bills?year=&month=&q=&customerId=&connectionId=&meter=` · `GET /bills/history?connectionId=` · `GET /bills/:id/pdf`

### Tributario
CRUD `/establishments` `/sales-points` `/tax-stamps`  
`POST /invoices` (borrador) · `POST /invoices/:id/issue` (numera + inmutable)  
`POST /invoices/:id/send-sifen` → **solo si TaxProvider está configurado**  
`GET /invoices/:id` incluye `sifenStatus` real  
`POST /credit-notes` `/debit-notes`  
`GET /tax/sifen/status` — configuración (test/prod, certificado presente o no)  
`POST /tax/sifen/consult` — consulta por CDC (si hay mTLS)

Nunca un endpoint “simular aprobación”.

### Cobranzas
CRUD `/payments` (anulación = contrapunteo, no delete) · `GET /payments/:id/pdf` · `POST /payments/:id/reverse`  
`GET /accounts/:customerId`  
`GET /collections/delinquency`

### Campo
CRUD `/claims` `/suspensions` `/reconnections`

`GET /field/config` — umbrales GPS, geovalla y foto (permiso `lecturas.ver`)  
`GET /field/queue?q=&status=pending|done|observed|incident|all` — cola de lecturas de conexiones activas con medidor  
`POST /field/start` — inicia la lectura de una conexión (`{ connectionId }`, permiso `lecturas.crear`)  
`POST /readings` — registra lectura, GPS, foto, consumo y auditoría  
`PATCH /settings` — `gps.maxAccuracyMeters`, `gps.geofenceMeters`, `gps.geofenceBlock`, `photo.required` (`configuracion.editar`)  
`GET /reports/anomalies` · `GET /reports/productivity`

### Inventario / gastos
CRUD `/inventory` `/inventory/movements` `/suppliers` `/expenses`

### Mapa y reportes
`GET /map/features?layers=customers,connections,meters,claims,suspensions`  
`GET /reports/:type` · `?format=json|csv|xlsx|pdf`  
`GET /dashboard`

### Sync móvil
`POST /sync/push` — lote de operaciones con `idempotency_key`  
`GET /sync/pull?since=<cursor>`  
`GET /sync/conflicts`

### Archivos
`POST /files/upload-url` — URL de subida (disco local o Storage remoto según `STORAGE_DRIVER`)  
`PUT /files/:id/content?token=` — cuerpo del archivo (token de un solo uso; no exige Bearer)  
`GET /files/:id/download-url` · `GET /files/:id/download?token=`

### Auditoría y notificaciones
`GET /audit-logs`  
`GET /notifications` · `POST /notifications/:id/read`  
`POST /devices/push-token` (FCM futuro)

### Regulación (ERSSAN)
CRUD `/regulation/documents` — almacén de documentos; no calcula obligaciones inventadas.

## 4. Idempotencia

Si llega `Idempotency-Key` (header o body) en POST de lecturas, pagos, sync, reclamos, OT:

1. Buscar clave del usuario (24 h).
2. Si existe y el hash del body coincide → devolver la misma respuesta.
3. Si existe y el body difiere → `409 IDEMPOTENCY_KEY_REUSED`.
4. Si no existe → ejecutar, persistir respuesta.

## 5. Conflictos de sync

Cada fila versionada (`version` integer). El cliente envía `baseVersion`.

- `baseVersion == server` → apply, `version++`
- `baseVersion < server` → `409 CONFLICT` con `{ server, client }`, sin overwrite.

## 6. Códigos de error

`UNAUTHORIZED` `FORBIDDEN` `VALIDATION_ERROR` `NOT_FOUND` `CONFLICT` `IDEMPOTENCY_KEY_REUSED` `STAMP_EXPIRED` `STAMP_EXHAUSTED` `FISCAL_IMMUTABLE` `READING_ANOMALY` `SIFEN_NOT_CONFIGURED` `SIFEN_REJECTED` `SIFEN_UNAVAILABLE` `ACCOUNT_LOCKED` `RATE_LIMITED`

## 7. Versión

Prefijo actual: `/api` (v1 implícita). Cambios breaking → `/api/v2`. Contratos compartidos en `packages/shared`.
