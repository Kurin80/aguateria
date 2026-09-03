export const CONNECTION_STATUSES = [
  "ACTIVA",
  "SUSPENDIDA",
  "CORTADA",
  "BAJA",
  "PENDIENTE",
] as const;

export const CUSTOMER_STATUSES = ["ACTIVO", "INOPERATIVO", "INACTIVO", "BAJA"] as const;

export const ID_DOCUMENT_TYPES = ["CI", "RUC", "PASAPORTE"] as const;

export const METER_STATUSES = ["INSTALADO", "RETIRADO", "DANADO", "EN_TALLER"] as const;

export const READING_ANOMALIES = [
  "NONE",
  "LOWER_THAN_PREVIOUS",
  "NEGATIVE_CONSUMPTION",
  "ZERO_CONSUMPTION",
  "EXCESSIVE_CONSUMPTION",
  "METER_CHANGED",
  "METER_RESET",
  "INITIAL_READING",
  "GPS_INACCURATE",
  "GPS_OUT_OF_RANGE",
  "MISSING_PHOTO",
  "DUPLICATE_PERIOD",
] as const;

export const SYNC_STATUSES = [
  "LOCAL",
  "PENDING_SYNC",
  "SYNCING",
  "SYNCED",
  "ERROR",
  "CONFLICT",
] as const;

export const ROUTE_STATUSES = ["CREADA", "INICIADA", "PAUSADA", "FINALIZADA"] as const;

export const BILLING_PERIOD_STATUSES = [
  "ABIERTO",
  "EN_PROCESO",
  "EN_REVISION",
  "APROBADO",
  "FACTURADO",
  "CERRADO",
] as const;

export const ACCOUNT_STATUSES = [
  "AL_DIA",
  "PENDIENTE",
  "VENCIDO",
  "MOROSO",
  "SUSPENDIDO",
] as const;

export const INVOICE_BUSINESS_STATUSES = [
  "BORRADOR",
  "EMITIDA",
  "ANULADA",
] as const;

export const SIFEN_STATUSES = [
  "NO_APLICA",
  "BORRADOR",
  "PENDIENTE",
  "ENVIADO",
  "APROBADO",
  "RECHAZADO",
  "CANCELADO",
  "ANULADO",
  "CONTINGENCIA",
  "NO_CONFIGURADO",
] as const;

export const BILL_KINDS = ["CONSUMO", "CREDITO"] as const;

export const DTE_TYPES = [
  "FACTURA_ELECTRONICA",
  "NOTA_CREDITO_ELECTRONICA",
  "NOTA_DEBITO_ELECTRONICA",
  "AUTOFACTURA_ELECTRONICA",
  "NOTA_REMISION_ELECTRONICA",
] as const;

export const PAYMENT_METHOD_CODES = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA",
  "QR",
  "OTROS",
] as const;

export const WORK_ORDER_STATUSES = [
  "PENDIENTE",
  "ASIGNADA",
  "EN_CAMINO",
  "EN_PROCESO",
  "RESUELTA",
  "CERRADA",
] as const;

export const CLAIM_TYPES = [
  "FALTA_DE_AGUA",
  "BAJA_PRESION",
  "FUGA",
  "MEDIDOR",
  "FACTURACION",
  "CALIDAD",
  "RECONEXION",
  "OTROS",
] as const;

export const INVENTORY_MOVEMENT_TYPES = [
  "ENTRADA",
  "SALIDA",
  "AJUSTE",
  "TRANSFERENCIA",
  "MERMA",
] as const;

export const SALE_CONDITIONS = ["CONTADO", "CREDITO"] as const;

export const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "FACTURA_EMITIDA",
  "FACTURA_ANULADA",
  "BOLETA_CREDITO",
  "NOTA_CREDITO",
  "NOTA_DEBITO",
  "PAGO_REGISTRADO",
  "PAGO_ANULADO",
  "LECTURA_REGISTRADA",
  "LECTURA_MODIFICADA",
  "RUTA_INICIADA",
  "TARIFA_MODIFICADA",
  "TIMBRADO_MODIFICADO",
  "USUARIO_MODIFICADO",
  "PERIODO_REABIERTO",
  "CONFLICTO_RESUELTO",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type ReadingAnomaly = (typeof READING_ANOMALIES)[number];
export type SifenStatus = (typeof SIFEN_STATUSES)[number];
export type BillingPeriodStatus = (typeof BILLING_PERIOD_STATUSES)[number];
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export type BillKind = (typeof BILL_KINDS)[number];
