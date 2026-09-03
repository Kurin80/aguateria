-- Lectura de campo: distancia GPS, índices y parámetros configurables.
-- No crea tablas nuevas: reutiliza meter_readings, rutas y system_settings.

alter table meter_readings add column if not exists gps_distance_m numeric(12, 2);

create index if not exists meter_readings_meter_period_idx
  on meter_readings (company_id, meter_id, billing_period_id);

create index if not exists meter_readings_reader_captured_idx
  on meter_readings (company_id, reader_id, server_captured_at desc);

create index if not exists reading_route_assignments_user_idx
  on reading_route_assignments (user_id);

create unique index if not exists system_settings_company_key_uidx
  on system_settings (company_id, key);

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'dashboard.ver'
where r.code = 'LECTOR'
on conflict do nothing;

insert into system_settings (id, company_id, key, value)
select gen_random_uuid(), c.id, v.key, v.value
from companies c
cross join (
  values
    ('gps.geofenceMeters', '50'::jsonb),
    ('gps.geofenceBlock', 'false'::jsonb),
    ('photo.required', 'true'::jsonb)
) as v(key, value)
where not exists (
  select 1 from system_settings s where s.company_id = c.id and s.key = v.key
);
