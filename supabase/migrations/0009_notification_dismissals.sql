-- Lectura/descarte por usuario de alertas operativas (campana).

create table if not exists notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  user_id uuid not null references users(id) on delete cascade,
  alert_key text not null,
  fingerprint text not null,
  dismissed_at timestamptz not null default now(),
  unique (user_id, alert_key)
);

create index if not exists notification_dismissals_company_user_idx
  on notification_dismissals (company_id, user_id);
