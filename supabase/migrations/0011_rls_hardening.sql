-- Refuerzo RLS / permisos para el despliegue en Supabase.
--
-- Modelo de acceso: el frontend y Android NUNCA hablan directo con PostgreSQL ni
-- con PostgREST. Toda consulta pasa por la API (Serverless en Vercel), que se
-- conecta con el rol `postgres` (BYPASSRLS) y aplica autorización por permiso +
-- filtro por company_id en cada endpoint.
--
-- Por lo tanto: RLS habilitado en TODAS las tablas de negocio, SIN políticas para
-- `anon` / `authenticated`  ⇒  deny-by-default para cualquier acceso directo.
-- Además se revocan los GRANT por defecto que Supabase da a esos roles.
--
-- Idempotente y seguro en local: los bloques que tocan roles/relaciones de
-- Supabase (`anon`, `authenticated`, `storage.objects`) se saltan si no existen.
-- No se usa `force row level security`: rompería el acceso de la API.

-- 1) Habilitar RLS en cada tabla del schema public (incluye las creadas después de 0001).
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 2) Quitar permisos directos y por defecto de los roles expuestos por PostgREST.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables    in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke all on all functions in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables    from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on functions from anon, authenticated';
  end if;
end $$;

-- 3) Storage: reafirmar el deny para acceso anónimo/autenticado a objetos.
--    (Los buckets y esta policy se crean en 0002_storage.sql cuando STORAGE_DRIVER=supabase.)
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists "deny_anon_objects" on storage.objects';
    execute 'create policy "deny_anon_objects" on storage.objects for all to anon, authenticated using (false) with check (false)';
  end if;
end $$;
