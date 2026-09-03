-- Endurecimiento de funciones (advisors de seguridad de Supabase).
-- Idempotente y seguro en local (los bloques que tocan roles de Supabase se saltan).

-- 1) search_path fijo en las funciones trigger de inmutabilidad fiscal
--    (advisor 0011_function_search_path_mutable). Sus cuerpos no resuelven
--    identificadores por esquema, así que '' es seguro.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'prevent_fiscal_delete') then
    execute 'alter function public.prevent_fiscal_delete() set search_path = ''''';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'prevent_issued_invoice_mutation') then
    execute 'alter function public.prevent_issued_invoice_mutation() set search_path = ''''';
  end if;
end $$;

-- 2) rls_auto_enable() es un event trigger administrado (auto-habilita RLS en
--    tablas nuevas). No debe ser invocable vía PostgREST /rpc.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke all on function public.rls_auto_enable() from public';
    if exists (select 1 from pg_roles where rolname = 'anon')
       and exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.rls_auto_enable() from anon, authenticated';
    end if;
  end if;
end $$;
