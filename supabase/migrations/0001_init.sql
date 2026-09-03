-- Plataforma Aguatería — esquema inicial
-- Zona horaria de sesión la aplica la API (America/Asuncion).
-- Montos: numeric(18,2). IDs internos: uuid. Numeración fiscal: columnas propias.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null,
  ruc text not null,
  dv text not null,
  address text,
  phone text,
  email text,
  logo_file_id uuid,
  timezone text not null default 'America/Asuncion',
  currency text not null default 'PYG',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  email text not null,
  username text not null,
  password_hash text not null,
  full_name text not null,
  phone text,
  active boolean not null default true,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, email),
  unique (company_id, username)
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  system boolean not null default true,
  unique (company_id, code)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  family_id uuid not null,
  device_id text,
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table login_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  identifier text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);

create table customer_portal_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null,
  email text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table system_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  key text not null,
  value jsonb not null,
  unique (company_id, key)
);

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  rate numeric(8,4) not null,
  exempt boolean not null default false,
  active boolean not null default true,
  unique (company_id, code)
);

create table customer_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (company_id, code)
);

create table zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (company_id, code)
);

create table neighborhoods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  city text,
  department text,
  unique (company_id, name, city)
);

create table tariffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  category_id uuid not null references customer_categories(id),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_by uuid references users(id)
);

create table tariff_rules (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references tariffs(id) on delete cascade,
  fixed_charge numeric(18,2) not null default 0,
  min_consumption_m3 numeric(12,3) not null default 0,
  min_amount numeric(18,2) not null default 0,
  price_per_m3 numeric(18,4) not null default 0,
  excess_price_per_m3 numeric(18,4),
  surcharge_percent numeric(8,4) not null default 0,
  discount_percent numeric(8,4) not null default 0,
  tax_rate_id uuid references tax_rates(id),
  excessive_multiplier numeric(8,4)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  first_name text,
  last_name text,
  legal_name text,
  ruc text,
  dv text,
  ci text,
  phone text,
  mobile text,
  email text,
  address text,
  neighborhood_id uuid references neighborhoods(id),
  city text,
  department text,
  reference_note text,
  zone_id uuid references zones(id),
  latitude numeric(10,7),
  longitude numeric(10,7),
  category_id uuid references customer_categories(id),
  status text not null default 'ACTIVO',
  activated_at date,
  deactivated_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  unique (company_id, code)
);

create index customers_search_idx on customers using gin (
  (coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(legal_name,'') || ' ' || coalesce(address,'')) gin_trgm_ops
);
create index customers_ruc_idx on customers (company_id, ruc);
create index customers_ci_idx on customers (company_id, ci);
create index customers_mobile_idx on customers (company_id, mobile);

create table connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  code text not null,
  account_number text not null,
  address text,
  neighborhood_id uuid references neighborhoods(id),
  zone_id uuid references zones(id),
  category_id uuid references customer_categories(id),
  tariff_id uuid references tariffs(id),
  status text not null default 'PENDIENTE',
  installed_at date,
  latitude numeric(10,7),
  longitude numeric(10,7),
  qr_token text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, code),
  unique (company_id, account_number)
);

create table meters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  connection_id uuid references connections(id),
  number text not null,
  brand text,
  model text,
  serial text,
  diameter_mm numeric(8,2),
  installed_at date,
  initial_reading numeric(14,3) not null default 0,
  status text not null default 'INSTALADO',
  location_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, number)
);

create table meter_events (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references meters(id),
  event_type text not null,
  event_at timestamptz not null default now(),
  reading numeric(14,3),
  notes text,
  user_id uuid references users(id)
);

create table billing_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  due_on date,
  status text not null default 'ABIERTO',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table reading_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  zone_id uuid references zones(id),
  billing_period_id uuid references billing_periods(id),
  status text not null default 'CREADA',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code, billing_period_id)
);

create table reading_route_assignments (
  route_id uuid not null references reading_routes(id) on delete cascade,
  user_id uuid not null references users(id),
  primary key (route_id, user_id)
);

create table reading_route_items (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references reading_routes(id) on delete cascade,
  connection_id uuid not null references connections(id),
  sort_order int not null default 0,
  completed_at timestamptz,
  unique (route_id, connection_id)
);

create table meter_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  connection_id uuid not null references connections(id),
  meter_id uuid not null references meters(id),
  billing_period_id uuid references billing_periods(id),
  route_item_id uuid references reading_route_items(id),
  previous_reading numeric(14,3) not null,
  current_reading numeric(14,3) not null,
  consumption_m3 numeric(14,3) not null,
  reader_id uuid references users(id),
  observations text,
  photo_file_id uuid,
  latitude numeric(10,7),
  longitude numeric(10,7),
  gps_accuracy_m numeric(10,2),
  gps_mocked boolean,
  anomaly_code text not null default 'NONE',
  requires_review boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references users(id),
  billed boolean not null default false,
  idempotency_key uuid not null,
  client_uuid uuid,
  device_captured_at timestamptz,
  server_captured_at timestamptz not null default now(),
  sync_status text not null default 'SYNCED',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create index meter_readings_connection_period_idx on meter_readings (connection_id, billing_period_id);

create table consumption_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  connection_id uuid not null references connections(id),
  billing_period_id uuid not null references billing_periods(id),
  reading_id uuid references meter_readings(id),
  tariff_id uuid references tariffs(id),
  consumption_m3 numeric(14,3) not null,
  min_m3 numeric(14,3) not null default 0,
  excess_m3 numeric(14,3) not null default 0,
  fixed_charge numeric(18,2) not null default 0,
  consumption_amount numeric(18,2) not null default 0,
  excess_amount numeric(18,2) not null default 0,
  surcharge_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  subtotal numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (connection_id, billing_period_id)
);

create table water_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  customer_id uuid not null references customers(id),
  connection_id uuid not null references connections(id),
  billing_period_id uuid not null references billing_periods(id),
  calculation_id uuid references consumption_calculations(id),
  issued_on date not null,
  due_on date not null,
  subtotal numeric(18,2) not null,
  tax_amount numeric(18,2) not null,
  total numeric(18,2) not null,
  balance numeric(18,2) not null,
  status text not null default 'EMITIDA',
  pdf_file_id uuid,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

create table water_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references water_bills(id) on delete cascade,
  code text not null,
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit_amount numeric(18,2) not null,
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null
);

create table establishments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  address text,
  active boolean not null default true,
  unique (company_id, code)
);

create table sales_points (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (establishment_id, code)
);

create table tax_stamps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  document_type text not null,
  establishment_id uuid not null references establishments(id),
  sales_point_id uuid not null references sales_points(id),
  valid_from date not null,
  valid_to date not null,
  range_from int not null,
  range_to int not null,
  next_number int not null,
  status text not null default 'ACTIVO',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number, document_type, establishment_id, sales_point_id)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  water_bill_id uuid references water_bills(id),
  customer_id uuid not null references customers(id),
  tax_stamp_id uuid references tax_stamps(id),
  establishment_id uuid references establishments(id),
  sales_point_id uuid references sales_points(id),
  document_type text not null default 'FACTURA_ELECTRONICA',
  fiscal_number int,
  fiscal_number_formatted text,
  issued_at timestamptz,
  sale_condition text not null default 'CREDITO',
  currency text not null default 'PYG',
  subtotal numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  business_status text not null default 'BORRADOR',
  sifen_status text not null default 'NO_CONFIGURADO',
  related_invoice_id uuid references invoices(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tax_stamp_id, fiscal_number)
);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete restrict,
  description text not null,
  quantity numeric(14,3) not null,
  unit_amount numeric(18,2) not null,
  tax_rate_id uuid references tax_rates(id),
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null
);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  invoice_id uuid not null references invoices(id),
  tax_document_id uuid references invoices(id),
  reason text,
  total numeric(18,2) not null,
  created_at timestamptz not null default now()
);

create table debit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  invoice_id uuid not null references invoices(id),
  tax_document_id uuid references invoices(id),
  reason text,
  total numeric(18,2) not null,
  created_at timestamptz not null default now()
);

create table dte_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  invoice_id uuid not null references invoices(id),
  environment text not null,
  cdc text,
  xml_file_id uuid,
  kude_file_id uuid,
  qr_payload text,
  contingency boolean not null default false,
  created_at timestamptz not null default now()
);

create table dte_events (
  id uuid primary key default gen_random_uuid(),
  dte_id uuid not null references dte_documents(id),
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table sifen_transmissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  invoice_id uuid references invoices(id),
  environment text not null,
  operation text not null,
  request_body text,
  response_body text,
  response_code text,
  success boolean,
  created_at timestamptz not null default now()
);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  unique (company_id, code)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  method_id uuid not null references payment_methods(id),
  amount numeric(18,2) not null,
  paid_on date not null,
  reference_note text,
  notes text,
  user_id uuid references users(id),
  reversed_at timestamptz,
  reverse_of uuid references payments(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  water_bill_id uuid references water_bills(id),
  invoice_id uuid references invoices(id),
  amount numeric(18,2) not null
);

create table customer_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id) unique,
  balance numeric(18,2) not null default 0,
  status text not null default 'AL_DIA',
  updated_at timestamptz not null default now()
);

create table account_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references customer_accounts(id),
  movement_type text not null,
  amount numeric(18,2) not null,
  water_bill_id uuid references water_bills(id),
  invoice_id uuid references invoices(id),
  payment_id uuid references payments(id),
  created_at timestamptz not null default now()
);

create table delinquency_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) unique,
  grace_days int not null default 5,
  surcharge_percent numeric(8,4) not null default 0,
  interest_percent_monthly numeric(8,4) not null default 0,
  suspend_after_days int not null default 60,
  notify_before_due_days int not null default 3
);

create table delinquency_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  water_bill_id uuid references water_bills(id),
  alert_type text not null,
  created_at timestamptz not null default now()
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  customer_id uuid references customers(id),
  connection_id uuid references connections(id),
  type text not null,
  priority text not null default 'MEDIA',
  description text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  assignee_id uuid references users(id),
  status text not null default 'ABIERTO',
  resolution text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  claim_id uuid references claims(id),
  customer_id uuid references customers(id),
  connection_id uuid references connections(id),
  title text not null,
  problem text,
  priority text not null default 'MEDIA',
  assignee_id uuid references users(id),
  status text not null default 'PENDIENTE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);

create table work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  status text not null,
  notes text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  photo_file_id uuid,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table suspensions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  connection_id uuid not null references connections(id),
  reason text not null,
  debt_amount numeric(18,2),
  executed_at timestamptz not null default now(),
  user_id uuid references users(id),
  latitude numeric(10,7),
  longitude numeric(10,7),
  photo_file_id uuid,
  notes text
);

create table reconnections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_id uuid not null references customers(id),
  connection_id uuid not null references connections(id),
  suspension_id uuid references suspensions(id),
  executed_at timestamptz not null default now(),
  user_id uuid references users(id),
  latitude numeric(10,7),
  longitude numeric(10,7),
  photo_file_id uuid,
  cost numeric(18,2),
  invoice_id uuid references invoices(id),
  notes text
);

create table maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  number text not null,
  title text not null,
  description text,
  status text not null default 'PENDIENTE',
  assignee_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  sku text not null,
  name text not null,
  unit text not null default 'UN',
  stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  unique (company_id, sku)
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id),
  movement_type text not null,
  quantity numeric(14,3) not null,
  notes text,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  legal_name text not null,
  ruc text,
  contact_name text,
  phone text,
  email text,
  address text,
  products_note text,
  terms text,
  status text not null default 'ACTIVO',
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  supplier_id uuid references suppliers(id),
  category text not null,
  concept text not null,
  expense_date date not null,
  amount numeric(18,2) not null,
  voucher_file_id uuid,
  user_id uuid references users(id),
  notes text,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  user_id uuid references users(id),
  customer_id uuid references customers(id),
  channel text not null default 'IN_APP',
  title text not null,
  body text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

create table files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  bucket text not null,
  path text not null,
  mime_type text not null,
  size_bytes int,
  uploaded_by uuid references users(id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  user_id uuid references users(id),
  action text not null,
  module text not null,
  entity_type text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip text,
  user_agent text,
  device_id text,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);

create table regulatory_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  category text not null,
  source text,
  file_id uuid references files(id),
  notes text,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  key uuid not null,
  request_hash text not null,
  response_status int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  entity_type text not null,
  entity_id uuid,
  client_payload jsonb not null,
  server_payload jsonb not null,
  status text not null default 'OPEN',
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  job_type text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- Inmutabilidad fiscal
create or replace function prevent_fiscal_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'No se permite eliminar documentos fiscales';
end;
$$;

create trigger invoices_no_delete before delete on invoices
  for each row execute procedure prevent_fiscal_delete();
create trigger credit_notes_no_delete before delete on credit_notes
  for each row execute procedure prevent_fiscal_delete();
create trigger debit_notes_no_delete before delete on debit_notes
  for each row execute procedure prevent_fiscal_delete();
create trigger dte_no_delete before delete on dte_documents
  for each row execute procedure prevent_fiscal_delete();
create trigger account_movements_no_delete before delete on account_movements
  for each row execute procedure prevent_fiscal_delete();

create or replace function prevent_issued_invoice_mutation()
returns trigger language plpgsql as $$
begin
  if old.business_status <> 'BORRADOR' then
    if new.fiscal_number is distinct from old.fiscal_number
      or new.total is distinct from old.total
      or new.subtotal is distinct from old.subtotal
      or new.tax_amount is distinct from old.tax_amount
      or new.document_type is distinct from old.document_type then
      raise exception 'Documento fiscal emitido inmutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_immutable before update on invoices
  for each row execute procedure prevent_issued_invoice_mutation();

alter table customer_portal_users
  add constraint customer_portal_users_customer_fk
  foreign key (customer_id) references customers(id);

alter table water_bills
  add constraint water_bills_invoice_fk
  foreign key (invoice_id) references invoices(id);

create table rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_key_idx on rate_limit_events (key, created_at);

-- RLS: denegar acceso directo de anon/authenticated. La API usa service_role.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Storage buckets se crean en el dashboard o via API de Supabase; ver DEPLOYMENT.md
