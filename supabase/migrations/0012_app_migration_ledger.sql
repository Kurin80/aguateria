-- Marcador de numeración. La app lleva su propio ledger en la tabla
-- `schema_migrations` (apps/api/src/scripts/migrate.ts la crea y la puebla).
--
-- En el despliegue de Supabase, este número se usó para backfillear ese ledger
-- vía MCP (marcar 0001..0011 como aplicadas) de modo que `npm run db:migrate`
-- contra ese proyecto sea un no-op. Localmente no hace falta hacer nada.

create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
