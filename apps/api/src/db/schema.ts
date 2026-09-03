import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name").notNull(),
  ruc: text("ruc").notNull(),
  dv: text("dv").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  timezone: text("timezone").notNull().default("America/Asuncion"),
  currency: text("currency").notNull().default("PYG"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  email: text("email").notNull(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  system: boolean("system").notNull().default(true),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  description: text("description"),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
});

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  familyId: uuid("family_id").notNull(),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id"),
  identifier: text("identifier").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
});

export const taxRates = pgTable("tax_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 8, scale: 4 }).notNull(),
  exempt: boolean("exempt").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const customerCategories = pgTable("customer_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const neighborhoods = pgTable("neighborhoods", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  city: text("city"),
  department: text("department"),
});

export const tariffs = pgTable("tariffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  categoryId: uuid("category_id").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const tariffRules = pgTable("tariff_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tariffId: uuid("tariff_id").notNull(),
  fixedCharge: money("fixed_charge").notNull(),
  minConsumptionM3: qty("min_consumption_m3").notNull(),
  minAmount: money("min_amount").notNull(),
  pricePerM3: numeric("price_per_m3", { precision: 18, scale: 4 }).notNull(),
  excessPricePerM3: numeric("excess_price_per_m3", { precision: 18, scale: 4 }),
  surchargePercent: numeric("surcharge_percent", { precision: 8, scale: 4 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 8, scale: 4 }).notNull(),
  taxRateId: uuid("tax_rate_id"),
  excessiveMultiplier: numeric("excessive_multiplier", { precision: 8, scale: 4 }),
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  legalName: text("legal_name"),
  ruc: text("ruc"),
  dv: text("dv"),
  idDocumentType: text("id_document_type").notNull().default("CI"),
  ci: text("ci"),
  phone: text("phone"),
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"),
  neighborhoodId: uuid("neighborhood_id"),
  neighborhood: text("neighborhood"),
  city: text("city"),
  department: text("department"),
  referenceNote: text("reference_note"),
  zoneId: uuid("zone_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  categoryId: uuid("category_id"),
  status: text("status").notNull().default("ACTIVO"),
  activatedAt: date("activated_at"),
  deactivatedAt: date("deactivated_at"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: ts("deleted_at"),
});

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  code: text("code").notNull(),
  accountNumber: text("account_number").notNull(),
  address: text("address"),
  neighborhoodId: uuid("neighborhood_id"),
  zoneId: uuid("zone_id"),
  categoryId: uuid("category_id"),
  tariffId: uuid("tariff_id"),
  status: text("status").notNull().default("PENDIENTE"),
  installedAt: date("installed_at"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  qrToken: text("qr_token").notNull(),
  notes: text("notes"),
  requestedAt: date("requested_at"),
  approvedAt: date("approved_at"),
  city: text("city"),
  referenceNote: text("reference_note"),
  connectionCost: money("connection_cost"),
  paymentMode: text("payment_mode"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const meters = pgTable("meters", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  connectionId: uuid("connection_id"),
  number: text("number").notNull(),
  brand: text("brand"),
  model: text("model"),
  serial: text("serial"),
  diameterMm: numeric("diameter_mm", { precision: 8, scale: 2 }),
  installedAt: date("installed_at"),
  initialReading: qty("initial_reading").notNull(),
  status: text("status").notNull().default("INSTALADO"),
  locationNote: text("location_note"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const meterEvents = pgTable("meter_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  meterId: uuid("meter_id").notNull(),
  eventType: text("event_type").notNull(),
  eventAt: ts("event_at").notNull().defaultNow(),
  reading: qty("reading"),
  notes: text("notes"),
  userId: uuid("user_id"),
});

export const billingPeriods = pgTable("billing_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  dueOn: date("due_on"),
  status: text("status").notNull().default("ABIERTO"),
  closedAt: ts("closed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const meterReadings = pgTable("meter_readings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  meterId: uuid("meter_id").notNull(),
  billingPeriodId: uuid("billing_period_id"),
  routeItemId: uuid("route_item_id"),
  previousReading: qty("previous_reading").notNull(),
  currentReading: qty("current_reading").notNull(),
  consumptionM3: qty("consumption_m3").notNull(),
  readerId: uuid("reader_id"),
  observations: text("observations"),
  photoFileId: uuid("photo_file_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  gpsAccuracyM: numeric("gps_accuracy_m", { precision: 10, scale: 2 }),
  gpsMocked: boolean("gps_mocked"),
  gpsDistanceM: numeric("gps_distance_m", { precision: 12, scale: 2 }),
  anomalyCode: text("anomaly_code").notNull().default("NONE"),
  requiresReview: boolean("requires_review").notNull().default(false),
  reviewedAt: ts("reviewed_at"),
  reviewedBy: uuid("reviewed_by"),
  billed: boolean("billed").notNull().default(false),
  idempotencyKey: uuid("idempotency_key").notNull(),
  clientUuid: uuid("client_uuid"),
  deviceCapturedAt: ts("device_captured_at"),
  serverCapturedAt: ts("server_captured_at").notNull().defaultNow(),
  syncStatus: text("sync_status").notNull().default("SYNCED"),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const consumptionCalculations = pgTable("consumption_calculations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  billingPeriodId: uuid("billing_period_id").notNull(),
  readingId: uuid("reading_id"),
  tariffId: uuid("tariff_id"),
  consumptionM3: qty("consumption_m3").notNull(),
  minM3: qty("min_m3").notNull(),
  excessM3: qty("excess_m3").notNull(),
  fixedCharge: money("fixed_charge").notNull(),
  consumptionAmount: money("consumption_amount").notNull(),
  excessAmount: money("excess_amount").notNull(),
  surchargeAmount: money("surcharge_amount").notNull(),
  discountAmount: money("discount_amount").notNull(),
  taxAmount: money("tax_amount").notNull(),
  subtotal: money("subtotal").notNull(),
  total: money("total").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (table) => [unique().on(table.connectionId, table.billingPeriodId)]);

export const waterBills = pgTable("water_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  number: text("number").notNull(),
  customerId: uuid("customer_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  billingPeriodId: uuid("billing_period_id").notNull(),
  calculationId: uuid("calculation_id"),
  issuedOn: date("issued_on").notNull(),
  dueOn: date("due_on").notNull(),
  subtotal: money("subtotal").notNull(),
  taxAmount: money("tax_amount").notNull(),
  total: money("total").notNull(),
  balance: money("balance").notNull(),
  status: text("status").notNull().default("EMITIDA"),
  kind: text("kind").notNull().default("CONSUMO"),
  relatedBillId: uuid("related_bill_id"),
  reason: text("reason"),
  pdfFileId: uuid("pdf_file_id"),
  invoiceId: uuid("invoice_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const waterBillItems = pgTable("water_bill_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  billId: uuid("bill_id").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  unitAmount: money("unit_amount").notNull(),
  taxAmount: money("tax_amount").notNull(),
  total: money("total").notNull(),
});

export const establishments = pgTable("establishments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  active: boolean("active").notNull().default(true),
});

export const salesPoints = pgTable("sales_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  establishmentId: uuid("establishment_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const taxStamps = pgTable("tax_stamps", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  number: text("number").notNull(),
  documentType: text("document_type").notNull(),
  establishmentId: uuid("establishment_id").notNull(),
  salesPointId: uuid("sales_point_id").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to").notNull(),
  rangeFrom: integer("range_from").notNull(),
  rangeTo: integer("range_to").notNull(),
  nextNumber: integer("next_number").notNull(),
  status: text("status").notNull().default("ACTIVO"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  waterBillId: uuid("water_bill_id"),
  customerId: uuid("customer_id").notNull(),
  taxStampId: uuid("tax_stamp_id"),
  establishmentId: uuid("establishment_id"),
  salesPointId: uuid("sales_point_id"),
  documentType: text("document_type").notNull().default("FACTURA_ELECTRONICA"),
  fiscalNumber: integer("fiscal_number"),
  fiscalNumberFormatted: text("fiscal_number_formatted"),
  issuedAt: ts("issued_at"),
  saleCondition: text("sale_condition").notNull().default("CREDITO"),
  currency: text("currency").notNull().default("PYG"),
  subtotal: money("subtotal").notNull(),
  taxAmount: money("tax_amount").notNull(),
  total: money("total").notNull(),
  businessStatus: text("business_status").notNull().default("BORRADOR"),
  sifenStatus: text("sifen_status").notNull().default("NO_CONFIGURADO"),
  relatedInvoiceId: uuid("related_invoice_id"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  unitAmount: money("unit_amount").notNull(),
  taxRateId: uuid("tax_rate_id"),
  taxAmount: money("tax_amount").notNull(),
  total: money("total").notNull(),
});

export const creditNotes = pgTable("credit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  taxDocumentId: uuid("tax_document_id"),
  reason: text("reason"),
  total: money("total").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const debitNotes = pgTable("debit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  taxDocumentId: uuid("tax_document_id"),
  reason: text("reason"),
  total: money("total").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const dteDocuments = pgTable("dte_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  environment: text("environment").notNull(),
  cdc: text("cdc"),
  xmlFileId: uuid("xml_file_id"),
  kudeFileId: uuid("kude_file_id"),
  qrPayload: text("qr_payload"),
  contingency: boolean("contingency").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sifenTransmissions = pgTable("sifen_transmissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  invoiceId: uuid("invoice_id"),
  environment: text("environment").notNull(),
  operation: text("operation").notNull(),
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  responseCode: text("response_code"),
  success: boolean("success"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  methodId: uuid("method_id").notNull(),
  amount: money("amount").notNull(),
  paidOn: date("paid_on").notNull(),
  referenceNote: text("reference_note"),
  notes: text("notes"),
  userId: uuid("user_id"),
  reversedAt: ts("reversed_at"),
  reverseOf: uuid("reverse_of"),
  idempotencyKey: uuid("idempotency_key").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  gpsAccuracyM: numeric("gps_accuracy_m", { precision: 10, scale: 2 }),
  collectionRouteId: uuid("collection_route_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull(),
  waterBillId: uuid("water_bill_id"),
  invoiceId: uuid("invoice_id"),
  amount: money("amount").notNull(),
});

export const customerAccounts = pgTable("customer_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  balance: money("balance").notNull(),
  status: text("status").notNull().default("AL_DIA"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const accountMovements = pgTable("account_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  movementType: text("movement_type").notNull(),
  amount: money("amount").notNull(),
  waterBillId: uuid("water_bill_id"),
  invoiceId: uuid("invoice_id"),
  paymentId: uuid("payment_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const delinquencyRules = pgTable("delinquency_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  graceDays: integer("grace_days").notNull(),
  surchargePercent: numeric("surcharge_percent", { precision: 8, scale: 4 }).notNull(),
  interestPercentMonthly: numeric("interest_percent_monthly", { precision: 8, scale: 4 }).notNull(),
  suspendAfterDays: integer("suspend_after_days").notNull(),
  notifyBeforeDueDays: integer("notify_before_due_days").notNull(),
  unpaidPeriodsForDisconnect: integer("unpaid_periods_for_disconnect").notNull().default(3),
});

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  number: text("number").notNull(),
  customerId: uuid("customer_id"),
  connectionId: uuid("connection_id"),
  type: text("type").notNull(),
  priority: text("priority").notNull().default("MEDIA"),
  description: text("description").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  assigneeId: uuid("assignee_id"),
  status: text("status").notNull().default("ABIERTO"),
  resolution: text("resolution"),
  closedAt: ts("closed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const suspensions = pgTable("suspensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  reason: text("reason").notNull(),
  debtAmount: money("debt_amount"),
  executedAt: ts("executed_at"),
  userId: uuid("user_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  photoFileId: uuid("photo_file_id"),
  notes: text("notes"),
  status: text("status").notNull().default("EJECUTADA"),
  scheduledAt: ts("scheduled_at"),
  authorizedBy: uuid("authorized_by"),
  authorizedAt: ts("authorized_at"),
  gpsAccuracyM: numeric("gps_accuracy_m", { precision: 10, scale: 2 }),
});

export const reconnections = pgTable("reconnections", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  suspensionId: uuid("suspension_id"),
  executedAt: ts("executed_at").notNull().defaultNow(),
  userId: uuid("user_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  photoFileId: uuid("photo_file_id"),
  cost: money("cost"),
  invoiceId: uuid("invoice_id"),
  notes: text("notes"),
});

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("UN"),
  stock: qty("stock").notNull(),
  minStock: qty("min_stock").notNull(),
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull(),
  movementType: text("movement_type").notNull(),
  quantity: qty("quantity").notNull(),
  notes: text("notes"),
  userId: uuid("user_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  legalName: text("legal_name").notNull(),
  ruc: text("ruc"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  productsNote: text("products_note"),
  terms: text("terms"),
  status: text("status").notNull().default("ACTIVO"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  supplierId: uuid("supplier_id"),
  category: text("category").notNull(),
  concept: text("concept").notNull(),
  expenseDate: date("expense_date").notNull(),
  amount: money("amount").notNull(),
  voucherFileId: uuid("voucher_file_id"),
  userId: uuid("user_id"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id"),
  customerId: uuid("customer_id"),
  channel: text("channel").notNull().default("IN_APP"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload"),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notificationDismissals = pgTable(
  "notification_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id").notNull(),
    alertKey: text("alert_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    dismissedAt: ts("dismissed_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.alertKey)],
);

export const pushDevices = pgTable("push_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  token: text("token").notNull(),
  platform: text("platform").notNull().default("android"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  bucket: text("bucket").notNull(),
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  uploadedBy: uuid("uploaded_by"),
  metadata: jsonb("metadata").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  deviceId: text("device_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const regulatoryDocuments = pgTable("regulatory_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  source: text("source"),
  fileId: uuid("file_id"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    key: uuid("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.key)],
);

export const syncConflicts = pgTable("sync_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  clientPayload: jsonb("client_payload").notNull(),
  serverPayload: jsonb("server_payload").notNull(),
  status: text("status").notNull().default("OPEN"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rateLimitEvents = pgTable("rate_limit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const installmentPlans = pgTable("installment_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  connectionId: uuid("connection_id"),
  kind: text("kind").notNull(),
  total: money("total").notNull(),
  downPayment: money("down_payment").notNull().default("0"),
  installmentCount: integer("installment_count").notNull(),
  status: text("status").notNull().default("VIGENTE"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const installmentItems = pgTable("installment_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull(),
  number: integer("number").notNull(),
  dueOn: date("due_on").notNull(),
  amount: money("amount").notNull(),
  paidAmount: money("paid_amount").notNull().default("0"),
  status: text("status").notNull().default("PENDIENTE"),
  paymentId: uuid("payment_id"),
});

export const connectionInstallations = pgTable("connection_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  meterId: uuid("meter_id"),
  installerId: uuid("installer_id"),
  initialReading: qty("initial_reading"),
  observations: text("observations"),
  photoFileId: uuid("photo_file_id"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  gpsAccuracyM: numeric("gps_accuracy_m", { precision: 10, scale: 2 }),
  distanceM: numeric("distance_m", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("PENDIENTE"),
  assignedTo: uuid("assigned_to"),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const collectionRoutes = pgTable("collection_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  collectorId: uuid("collector_id").notNull(),
  status: text("status").notNull().default("ACTIVO"),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
});

export const collectionRoutePoints = pgTable("collection_route_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracyM: numeric("accuracy_m", { precision: 10, scale: 2 }),
  capturedAt: ts("captured_at").notNull().defaultNow(),
});

export const collectionVisits = pgTable("collection_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  result: text("result").notNull(),
  paymentId: uuid("payment_id"),
  notes: text("notes"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});
