-- Boleta de crédito operativa (ajuste a favor del cliente). No es DTE SIFEN.

alter table water_bills
  add column if not exists kind text not null default 'CONSUMO',
  add column if not exists related_bill_id uuid references water_bills(id),
  add column if not exists reason text;

create index if not exists water_bills_kind_idx on water_bills (company_id, kind, issued_on);
create index if not exists water_bills_related_idx on water_bills (related_bill_id);
