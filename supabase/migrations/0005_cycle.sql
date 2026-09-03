-- Ciclo integral: cuotas, instalaciones, cobranza GPS, mora y desconexión programada.
-- No se duplican clientes, lecturas, boletas ni facturación tributaria.

alter table connections
  add column if not exists requested_at date,
  add column if not exists approved_at date,
  add column if not exists city text,
  add column if not exists reference_note text,
  add column if not exists connection_cost numeric(18, 2),
  add column if not exists payment_mode text;

alter table delinquency_rules
  add column if not exists unpaid_periods_for_disconnect integer not null default 3;

alter table payments
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists gps_accuracy_m numeric(10, 2),
  add column if not exists collection_route_id uuid;

alter table suspensions
  add column if not exists status text not null default 'EJECUTADA',
  add column if not exists scheduled_at timestamptz,
  add column if not exists authorized_by uuid,
  add column if not exists authorized_at timestamptz,
  add column if not exists gps_accuracy_m numeric(10, 2);

create table if not exists installment_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  connection_id uuid,
  kind text not null,
  total numeric(18, 2) not null,
  down_payment numeric(18, 2) not null default 0,
  installment_count integer not null,
  status text not null default 'VIGENTE',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists installment_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references installment_plans(id),
  number integer not null,
  due_on date not null,
  amount numeric(18, 2) not null,
  paid_amount numeric(18, 2) not null default 0,
  status text not null default 'PENDIENTE',
  payment_id uuid
);

create table if not exists connection_installations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  customer_id uuid not null,
  meter_id uuid,
  installer_id uuid,
  initial_reading numeric(14, 3),
  observations text,
  photo_file_id uuid,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy_m numeric(10, 2),
  distance_m numeric(12, 2),
  status text not null default 'PENDIENTE',
  assigned_to uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists collection_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  collector_id uuid not null,
  status text not null default 'ACTIVO',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists collection_route_points (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references collection_routes(id),
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  accuracy_m numeric(10, 2),
  captured_at timestamptz not null default now()
);

create table if not exists collection_visits (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references collection_routes(id),
  customer_id uuid not null,
  result text not null,
  payment_id uuid,
  notes text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  created_at timestamptz not null default now()
);

create unique index if not exists customers_company_code_uidx
  on customers (company_id, code)
  where deleted_at is null;

create unique index if not exists meters_company_number_uidx
  on meters (company_id, number)
  where deleted_at is null;

create unique index if not exists water_bills_company_number_uidx
  on water_bills (company_id, number);

create unique index if not exists payments_company_idempotency_uidx
  on payments (company_id, idempotency_key);

create index if not exists installment_items_plan_idx on installment_items (plan_id, due_on);
create index if not exists connection_installations_status_idx on connection_installations (company_id, status);
create index if not exists collection_route_points_route_idx on collection_route_points (route_id, captured_at);
create index if not exists water_bills_customer_status_idx on water_bills (customer_id, status, due_on);

alter table suspensions alter column executed_at drop not null;

create unique index if not exists connection_installations_pending_uidx
  on connection_installations (connection_id)
  where status = 'PENDIENTE';
