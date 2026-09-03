-- Nombre de barrio en el padrón (además de neighborhood_id del catálogo).

alter table customers
  add column if not exists neighborhood text;
