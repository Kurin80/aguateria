# Modelo de datos — PostgreSQL

En desarrollo local el motor es PostgreSQL en `localhost` (base `aguateria_db`). La carpeta `supabase/migrations` conserva el esquema SQL; no implica que la app necesite el producto Supabase.

Zona horaria de aplicación: `America/Asuncion`.
Montos: `NUMERIC(18,2)` (nunca `float`/`double`).
IDs internos: `uuid`. Numeración fiscal: columnas dedicadas, nunca el UUID.
Baja lógica: `deleted_at`. Auditoría de fila: `created_at`, `updated_at`, `created_by`, `updated_by`.
Multiempresa preparada: `company_id` en entidades de negocio. v1 opera un solo `company`.

## 1. Convenciones

- PK: `id uuid primary key default gen_random_uuid()`.
- FK con `on delete restrict` en documentos fiscales; `on delete restrict` o `set null` según el caso operativo.
- Índices en búsquedas (código, RUC, CI, teléfono, medidor) y en `(company_id, …)`.
- Unique compuestos incluyen `company_id` y respetan `deleted_at` con índices parciales.
- RLS habilitado. El API usa service role **solo en servidor**. Políticas: usuario autenticado de portal (futuro) y denegación por defecto para `anon`.

## 2. Identidad y acceso

| Tabla | Rol |
|---|---|
| `companies` | Prestador (aguatería). Datos comerciales, RUC, logo. |
| `users` | Empleados. Email, username, hash Argon2, lockout. |
| `roles` | SUPER_ADMIN, ADMINISTRADOR, GERENTE, SUPERVISOR, FACTURACION, CAJA, LECTOR, TECNICO, CONSULTA |
| `permissions` | Claves `recurso.accion` |
| `role_permissions` | N:N |
| `user_roles` | N:N |
| `refresh_tokens` | Hash del token, rotación, revocación, dispositivo |
| `login_attempts` | Rate limit / lockout |
| `customer_portal_users` | Futuro portal (email, customer_id). Sin UI en v1. |

## 3. Catálogo operativo

| Tabla | Notas |
|---|---|
| `customer_categories` | RESIDENCIAL, COMERCIAL, INDUSTRIAL, INSTITUCIONAL, ESPECIAL — configurables, no fijas en código |
| `zones` | Zona operativa / lectura |
| `neighborhoods` | Barrio, ciudad, departamento |
| `tariffs` | Cabecera: vigencia, estado, categoría |
| `tariff_rules` | Cargo fijo, mínimo m³, precio m³, excedente, recargos, descuentos, IVA aplicable (FK a tax_rate) |
| `tax_rates` | Tasas parametrizadas (p. ej. IVA 10, IVA 5, exento). **No hardcodear en lógica de UI.** |
| `system_settings` | JSON/key-value: umbral GPS, días de gracia, lockout, etc. |

## 4. Clientes, conexiones, medidores

### `customers`

código, nombre, apellido, razón social, RUC, DV, CI, teléfonos, email, dirección, barrio, ciudad, departamento, referencia, zona, lat/lng, categoría, estado, alta/baja, observaciones, `company_id`.

Búsqueda: índices + `pg_trgm` en nombre/apellido/dirección.

### `connections`

código, `customer_id`, número de cuenta, dirección, barrio, zona, categoría, `tariff_id`, estado (`ACTIVA|SUSPENDIDA|CORTADA|BAJA|PENDIENTE`), instalación, coordenadas, QR token único, observaciones.

### `meters`

número, marca, modelo, serie, diámetro, instalación, lectura inicial, estado, `connection_id`, ubicación, observaciones.

### `meter_events`

instalación, retiro, cambio, mantenimiento, lectura, anomalía. Historial inmutable.

## 5. Lecturas y rutas

### `meter_readings`

`customer_id`, `connection_id`, `meter_id`, `billing_period_id`, fecha/hora **servidor** y fecha/hora **dispositivo** (auditoría), lectura anterior/actual, consumo calculado en backend, `reader_id`, observaciones, foto (storage path), GPS (lat, lng, accuracy_m), `anomaly_code`, `requires_review`, `idempotency_key`, `sync_status`, `client_uuid`.

Anomalías **no** facturan en automático.

### `reading_routes` / `reading_route_items` / `reading_route_assignments`

Ruta, zona, estado (CREADA, INICIADA, PAUSADA, FINALIZADA), orden de visita, empleado asignado, conteos derivados.

### `sync_operations` / `sync_conflicts`

Cola de operaciones móviles. Conflicto si versión de fila web > versión enviada. Nunca overwrite silencioso.

## 6. Facturación operativa (boletas)

Separado de facturación tributaria.

| Tabla | Rol |
|---|---|
| `billing_periods` | ABIERTO → EN_PROCESO → EN_REVISION → APROBADO → FACTURADO → CERRADO |
| `consumption_calculations` | Snapshot inmutable del motor por conexión/periodo |
| `water_bills` | Boleta de consumo |
| `water_bill_items` | Conceptos: mínimo, excedente, cargo fijo, otros |
| `water_bill_events` | emisión, PDF, email |

Un periodo CERRADO no se modifica sin permiso `billing_periods.reopen` + auditoría.

## 7. Facturación tributaria

| Tabla | Rol |
|---|---|
| `establishments` | Establecimiento DNIT (001…) |
| `sales_points` | Punto de expedición |
| `tax_stamps` | Timbrado: número, vigencia, tipo DE, rango, siguiente número |
| `invoices` | Cabecera interna. Número fiscal ≠ UUID. Estado de negocio y estado SIFEN separados |
| `invoice_items` | Ítems con tasa IVA parametrizada |
| `credit_notes` / `debit_notes` | Relacionadas a invoice; no editan la factura original |
| `dte_documents` | XML, CDC, QR payload, KuDE path, ambiente (test/prod) |
| `dte_events` | Eventos SIFEN (cancelación, inutilización, etc.) + respuesta cruda |
| `sifen_transmissions` | Request/response SOAP, códigos `dCodRes`, lote, reintentos |

**Invariantes**

- No `DELETE` físico de `invoices` emitidas.
- Unique `(company_id, tax_stamp_id, establishment_id, sales_point_id, document_type, fiscal_number)`.
- `sifen_status` solo cambia a `APROBADO` si hay respuesta de SIFEN almacenada que así lo indique.
- Ambiente test: documentos **sin valor jurídico** (según Guía de Pruebas SIFEN).

## 8. Cobranzas

| Tabla | Rol |
|---|---|
| `payment_methods` | EFECTIVO, TRANSFERENCIA, TARJETA, QR, OTROS (catálogo) |
| `payments` | Importe, fecha servidor, referencia, `idempotency_key` |
| `payment_allocations` | Aplicación a boleta y/o factura (parcial/total) |
| `customer_accounts` | Saldo cacheado + estado (AL_DIA, PENDIENTE, VENCIDO, MOROSO, SUSPENDIDO) |
| `account_movements` | Libro mayor del cliente (inmutable) |
| `delinquency_rules` | Días de gracia, recargo, interés, avisos, umbral suspensión |
| `delinquency_alerts` | Alertas generadas |

## 9. Campo y operación

`claims`, `claim_photos`, `work_orders`, `work_order_events`, `suspensions`, `reconnections`, `maintenance_orders`.

GPS + foto en suspensión/reconexión/OT cuando el origen es móvil.

## 10. Inventario y finanzas internas

`inventory_items`, `inventory_movements` (ENTRADA, SALIDA, AJUSTE, TRANSFERENCIA, MERMA), `suppliers`, `expenses`, `expense_categories`.

## 11. Notificaciones, archivos, auditoría, regulación

| Tabla | Rol |
|---|---|
| `notifications` | Cola: email/push (WhatsApp/SMS preparados) |
| `push_devices` | Token FCM futuro |
| `files` | Metadatos Storage |
| `audit_logs` | actor, IP, módulo, acción, old/new JSON, device |
| `regulatory_documents` | Módulo ERSSAN: documentos, tarifas aprobadas, informes. **No inventa obligaciones.** |
| `idempotency_keys` | Respuesta cacheada por clave + usuario |

## 12. Relaciones principales

```
company
  ├─ customers ─┬─ connections ─┬─ meters ── meter_events
  │             │               └─ meter_readings ── billing_periods
  │             ├─ customer_accounts ── account_movements
  │             ├─ claims ── work_orders
  │             └─ suspensions / reconnections
  ├─ tariffs ── tariff_rules ── tax_rates
  ├─ water_bills ── water_bill_items
  ├─ tax_stamps ── establishments ── sales_points
  ├─ invoices ── invoice_items ── dte_documents ── dte_events
  └─ payments ── payment_allocations
```

## 13. Índices críticos (mínimo)

- `customers (company_id, code)` unique parcial
- `customers` gin_trgm nombre, apellido, dirección
- `meters (company_id, serial)` unique
- `meter_readings (idempotency_key)` unique
- `meter_readings (connection_id, billing_period_id)`
- `invoices` unique fiscal
- `payments (idempotency_key)` unique
- `audit_logs (created_at)`, `(entity_type, entity_id)`

## 14. Triggers

- `updated_at` automático.
- Impedir `DELETE` en `invoices`, `credit_notes`, `debit_notes`, `dte_documents`, `account_movements` (función + trigger).
- Impedir update de campos fiscales de una invoice no-BORRADOR.
- `next_fiscal_number` se obtiene con `SELECT … FOR UPDATE` del timbrado (en transacción de aplicación; el trigger solo valida rango/vigencia).

## 15. Seed

`npm run db:seed` (`apps/api/src/scripts/seed.ts`) con `ALLOW_DEV_SEED=true`. Nunca se ejecuta en production (la API lo rechaza).
