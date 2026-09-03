-- Buckets privados de Storage (schema storage de Supabase).
-- Idempotente: no falla si ya existen.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('meter-photos', 'meter-photos', false, 10485760, array['image/jpeg','image/png','image/webp']::text[]),
  ('documents', 'documents', false, 26214400, null),
  ('tax-xml', 'tax-xml', false, 5242880, array['application/xml','text/xml']::text[]),
  ('kude', 'kude', false, 10485760, array['application/pdf']::text[]),
  ('expense-vouchers', 'expense-vouchers', false, 10485760, array['image/jpeg','image/png','application/pdf']::text[])
on conflict (id) do nothing;

-- Nadie entra por anon; la API firma URLs con la clave de servidor.
drop policy if exists "deny_anon_objects" on storage.objects;
create policy "deny_anon_objects"
  on storage.objects
  for all
  to anon, authenticated
  using (false)
  with check (false);
