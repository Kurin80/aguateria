# Arquitectura general — Plataforma de gestión de aguatería

## 1. Contexto

Plataforma de producción para una empresa prestadora de agua potable en Paraguay. Cubre operación comercial (clientes, medidores, lecturas, boletas), cobranza, trabajo de campo (Android) y facturación tributaria (DNIT / SIFEN), con separación estricta entre **boleta de consumo** (documento operativo) y **comprobante tributario** (documento fiscal).

El repositorio partió vacío. Esta arquitectura se diseñó desde cero.

## 2. Principios

- Un único backend es la fuente de verdad. La web y Android consumen la misma API REST HTTPS.
- La app móvil **nunca** accede a PostgreSQL ni a claves de servidor.
- La lógica de tarifas, consumo, mora, numeración fiscal y envío a SIFEN vive solo en el backend.
- Identificadores internos = UUID. Numeración fiscal = secuencia independiente por timbrado / establecimiento / punto de expedición / tipo de documento.
- Operaciones móviles son idempotentes (`idempotency_key`).
- Configuración de negocio (tarifas, IVA, GPS, mora, empresa) **nunca** se hardcodea.
- Documentos tributarios no se borran ni se editan libremente una vez emitidos.
- Un documento **no** se marca como aceptado por SIFEN salvo respuesta real de la autoridad.
- Zona horaria de negocio: `America/Asuncion`. Moneda principal: `PYG` con `NUMERIC` (sin float).
- Extensible: iOS, portal de clientes, WhatsApp, SMS, pagos electrónicos, multiempresa (`company_id`).

## 3. Diagrama

```
┌─────────────────────────┐         ┌─────────────────────┐
│  APP WEB (React + TS)   │         │  APP ANDROID        │
│  Vite · Tailwind        │         │  Kotlin · Compose   │
│  local :5173            │         │  GPS · Cámara · QR  │
└────────────┬────────────┘         │  Room (offline)     │
             │ HTTP REST             └──────────┬──────────┘
             │                                  │ HTTP REST
             └───────────────┬──────────────────┘
                             ▼
                ┌────────────────────────┐
                │  BACKEND API (Node TS) │
                │  Auth · RBAC · módulos │
                │  TaxProvider (SIFEN)   │
                │  local :3001           │
                └────────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        PostgreSQL     Archivos        Secretos
        local :5432    data/uploads    (.env)
```

## 4. Monorepo

```
/
  apps/web          Aplicación administrativa (Vite + React + TypeScript)
  apps/api          API REST (Node + TypeScript, capas)
  apps/android      App de campo (Kotlin + Jetpack Compose)
  packages/shared   Contratos: Zod, tipos, permisos, estados
  supabase/         Migraciones SQL (nombre histórico; se aplican a PostgreSQL)
  docs/             Arquitectura y operación
```

La API se ejecuta como proceso Node local (`:3001`). El adaptador Vercel (`apps/api/src/vercel.ts`) se conserva por si más adelante se publica en esa plataforma. En local los archivos van a disco (`STORAGE_DRIVER=local`).

## 5. Capas del backend

```
HTTP (Hono)
  → middleware (auth, rbac, rate-limit, idempotency, audit)
    → validators (Zod)
      → services (reglas de negocio)
        → repositories (SQL)
          → PostgreSQL / Storage
```

Servicios de dominio (implementados en `apps/api/src/routes` y `apps/api/src/services`, no como clases homónimas):

| Servicio | Responsabilidad |
|---|---|
| `AuthService` | Login, refresh, logout, lockout |
| `CustomerService` | Clientes, búsqueda, baja lógica |
| `ReadingService` | Lecturas, anomalías, fotos, GPS |
| `ConsumptionCalculationService` | Motor oficial de consumo y cargos |
| `BillingPeriodService` | Ciclo de facturación |
| `WaterBillService` | Boletas de consumo (no fiscales) |
| `InvoiceService` | Comprobantes tributarios internos |
| `TaxStampService` | Timbrados y numeración |
| `SifenProvider` | Transmisión real a SIFEN (o no-op si no hay certificado) |
| `PaymentService` | Pagos, parciales, no duplicados |
| `AccountService` | Cuenta corriente |
| `DelinquencyService` | Mora configurable |
| `SyncService` | Cola móvil, conflictos |
| `AuditService` | Trazabilidad |

## 6. Frontend web

- React 18 + TypeScript + Vite + React Router.
- Tailwind CSS. UI propia, accesible, sobria (empresa de servicio público).
- TanStack Query para servidor.
- MapLibre + teselas OpenStreetMap.
- Sidebar en desktop; navegación táctil en viewport estrecho.
- Breakpoints objetivo: 320, 375, 414, 768, 1024, 1366, 1920.
- **Cero lógica fiscal o tarifaria en componentes.** Solo presentan datos de la API.

## 7. Autenticación y autorización

- Empleados: email o username + contraseña (Argon2id).
- Access token JWT de corta vida + refresh token rotativo almacenado hasheado.
- Lockout tras intentos fallidos (configurable).
- RBAC: roles del sistema + permisos granulares (`recurso.accion`).

Detalle en [SECURITY.md](./SECURITY.md).

## 8. Almacenamiento

Por defecto `STORAGE_DRIVER=local` (`data/uploads`). Con `STORAGE_DRIVER=supabase` se usan buckets privados, acceso solo vía API (URL firmada de corta duración):

- `meter-photos`
- `work-order-photos`
- `documents` (PDF boletas, recibos, reportes)
- `tax-xml` (XML DE / respuestas SIFEN)
- `kude` (representación gráfica cuando exista DTE aprobado)
- `expense-vouchers`

Las imágenes **no** se guardan en PostgreSQL; solo metadatos y path.

## 9. Extensibilidad

| Futuro | Punto de extensión |
|---|---|
| iOS | Nuevo cliente de la misma API |
| Portal clientes | `customer_portal_users` + scope `portal` |
| WhatsApp / SMS | `NotificationChannel` |
| Pagos electrónicos | `PaymentGateway` |
| OCR de medidor | post-proceso de foto, no cambia la lectura oficial |
| Multiempresa | `company_id` ya presente; un tenant activo en v1 |
| SIFEN | `TaxProvider` / `SifenProvider` |

## 10. Fases de implementación

1. Fundación: DB, auth, RBAC, seguridad.
2. Clientes, conexiones, medidores.
3. Lecturas, GPS, cámara, Android, offline.
4. Tarifas, consumo, periodos, boletas.
5. Cuenta corriente, pagos, mora.
6. Facturación interna, timbrado, NC/ND.
7. Adaptador SIFEN / DTE / CDC / KuDE / QR (sin fingir aceptación).
8. Reclamos, suspensiones, reconexiones.
9. Inventario, proveedores, gastos.
10. Dashboard, reportes, auditoría, notificaciones.
11. Tests, hardening, producción.

## 11. Criterio de “listo para producción”

Build, lint y tests OK; migraciones aplicables; auth/RBAC reales; API validada; UI responsive; Android habla solo con la API; GPS/cámara nativos; sync idempotente; PDF de boleta; documentos fiscales inmutables; SIFEN no simulado; secretos solo en env; despliegue Vercel + Supabase documentado.
