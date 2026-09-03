-- Tipo de documento de identidad y estado operativo del cliente.

alter table customers
  add column if not exists id_document_type text not null default 'CI';

update customers
   set id_document_type = 'CI'
 where id_document_type is null or id_document_type = '';

update customers
   set status = 'INOPERATIVO'
 where status = 'INACTIVO';

create index if not exists customers_document_idx
  on customers (company_id, id_document_type, ci)
  where deleted_at is null;
