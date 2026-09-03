import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";

export function SettingsPage() {
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ["company"], queryFn: () => api<{ data: Record<string, string> }>("/company") });
  const sifen = useQuery({ queryKey: ["sifen"], queryFn: () => api<{ data: Record<string, unknown> }>("/tax/sifen/status") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<{ data: Record<string, unknown> }>("/settings") });
  const c = company.data?.data;
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const values = form ?? {
    legalName: c?.legalName ?? "",
    tradeName: c?.tradeName ?? "",
    ruc: c?.ruc ?? "",
    dv: c?.dv ?? "",
    address: c?.address ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
  };
  const save = useMutation({
    mutationFn: () => api("/company", { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["company"] }),
  });

  return (
    <>
      <PageHeader title="Configuración" subtitle="Datos del prestador y estado de integración tributaria" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Empresa</h2>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {(["legalName", "tradeName", "ruc", "dv", "address", "phone", "email"] as const).map((key) => (
              <Field key={key} label={key === "legalName" ? "Razón social" : key === "tradeName" ? "Nombre comercial" : key.toUpperCase()}>
                <Input
                  value={values[key] ?? ""}
                  onChange={(e) => setForm({ ...values, [key]: e.target.value })}
                />
              </Field>
            ))}
            <Button type="submit" disabled={save.isPending}>
              Guardar empresa
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">SIFEN / DNIT</h2>
          <p className="mt-2 text-sm">Ambiente: {String(sifen.data?.data.environment ?? "—")}</p>
          <p className="text-sm">Host: {String(sifen.data?.data.host ?? "—")}</p>
          <p className="text-sm">Manual técnico: v{String(sifen.data?.data.manualVersion ?? "150")}</p>
          <p className="text-sm">Configurado: {String(sifen.data?.data.configured ?? false)}</p>
          <p className="mt-3 text-xs text-slate-600">
            Un documento no se muestra como aceptado por SIFEN salvo respuesta real de la DNIT. La boleta de consumo es un documento operativo, distinta de la factura electrónica.
          </p>
          <h3 className="mt-6 font-semibold">Lectura de campo</h3>
          <p className="mt-1 text-sm text-slate-600">
            Precisión máxima GPS: {String(settings.data?.data["gps.maxAccuracyMeters"] ?? 30)} m · Geovalla:{" "}
            {String(settings.data?.data["gps.geofenceMeters"] ?? 50)} m · Foto obligatoria:{" "}
            {String(settings.data?.data["photo.required"] ?? true)}
          </p>
          <FieldSettingsForm initial={settings.data?.data ?? {}} />
        </Card>
      </div>
    </>
  );
}

function FieldSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const qc = useQueryClient();
  const [accuracy, setAccuracy] = useState(String(initial["gps.maxAccuracyMeters"] ?? 30));
  const [geofence, setGeofence] = useState(String(initial["gps.geofenceMeters"] ?? 50));
  const [block, setBlock] = useState(Boolean(initial["gps.geofenceBlock"]));
  const [photo, setPhoto] = useState(initial["photo.required"] !== false);
  const [mora, setMora] = useState(String(initial["mora.unpaidPeriods"] ?? 3));
  const [interval, setInterval] = useState(String(initial["cobranza.gpsIntervalSeconds"] ?? 30));
  const [policy, setPolicy] = useState(String(initial["gps.geofencePolicy"] ?? (block ? "BLOQUEAR" : "ADVERTIR")));
  const save = useMutation({
    mutationFn: () =>
      api("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          "gps.maxAccuracyMeters": Number(accuracy),
          "gps.geofenceMeters": Number(geofence),
          "gps.geofenceBlock": block,
          "photo.required": photo,
          "mora.unpaidPeriods": Number(mora),
          "cobranza.gpsIntervalSeconds": Number(interval),
          "gps.geofencePolicy": policy,
        }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  return (
    <form
      className="mt-4 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Precisión GPS máxima (m)">
        <Input type="number" value={accuracy} onChange={(e) => setAccuracy(e.target.value)} />
      </Field>
      <Field label="Geovalla (m)">
        <Input type="number" value={geofence} onChange={(e) => setGeofence(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
        Bloquear el registro si está fuera de geovalla (si no, se guarda con incidencia)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
        Fotografía del medidor obligatoria
      </label>
      <Field label="Política de geovalla">
        <select className="w-full rounded-lg border border-slate-300 px-3 py-2" value={policy} onChange={(e) => setPolicy(e.target.value)}>
          <option value="PERMITIR">Permitir</option>
          <option value="ADVERTIR">Advertir</option>
          <option value="BLOQUEAR">Bloquear</option>
        </select>
      </Field>
      <Field label="Meses impagos para desconexión programada">
        <Input type="number" value={mora} onChange={(e) => setMora(e.target.value)} />
      </Field>
      <Field label="Intervalo GPS de cobranza (segundos)">
        <Input type="number" value={interval} onChange={(e) => setInterval(e.target.value)} />
      </Field>
      <Button type="submit" disabled={save.isPending}>
        Guardar parámetros de campo
      </Button>
    </form>
  );
}
