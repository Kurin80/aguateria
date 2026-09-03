-- Flujo principal: código de conexión único por empresa.
-- No se borran reading_routes / work_orders / maintenance_orders: quedan sin uso de aplicación
-- para no destruir historial. meter_readings.route_item_id deja de ser obligatorio.

create unique index if not exists connections_company_code_uidx
  on connections (company_id, code)
  where deleted_at is null;

create index if not exists meter_readings_connection_period_idx
  on meter_readings (company_id, connection_id, billing_period_id);

create index if not exists water_bills_issued_on_idx
  on water_bills (company_id, issued_on);
