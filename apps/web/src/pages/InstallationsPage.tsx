import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatRuc } from "@aguateria/shared";
import { ApiError, api } from "../api/client";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { captureGps, uploadEvidencePhoto } from "../lib/field-capture";
import { FieldDeviceHint, NativePhotoButton } from "../components/field-device";
import { refreshNow } from "../lib/refresh";

type Job = {
  id: string;
  status: string;
  initialReading: string | null;
  connectionId: string;
  connectionCode: string;
  address: string | null;
  referenceNote: string | null;
  requestedAt: string | null;
  customerName: string;
  customerCode: string | null;
  customerLegalName: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  idDocumentType: string | null;
  ci: string | null;
  ruc: string | null;
  dv: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  customerAddress: string | null;
  city: string | null;
  department: string | null;
  neighborhood: string | null;
  meterNumber: string | null;
  meterBrand: string | null;
  meterModel: string | null;
  meterInitial: string | null;
  supplyLat: string | null;
  supplyLng: string | null;
};

function solicitanteDoc(row: Job): string {
  const type = (row.idDocumentType ?? "CI").toUpperCase();
  if (type === "RUC") return `RUC ${formatRuc(row.ruc, row.dv) || row.ci || "—"}`;
  if (type === "PASAPORTE") return `Pasaporte ${row.ci || "—"}`;
  return `CI ${row.ci || "—"}`;
}

function solicitantePlace(row: Job): string {
  return [row.neighborhood, row.city, row.department].filter(Boolean).join(" · ") || "—";
}

export function InstallationsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Job | null>(null);
  const [meter, setMeter] = useState({ number: "", brand: "", model: "", serial: "", initialReading: "0", installedAt: "" });
  const [obs, setObs] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState<{ distanceM: number | null; withinFence: boolean; initialReading: string } | null>(null);

  const queue = useQuery({
    queryKey: ["installations"],
    queryFn: () => api<{ data: Job[] }>("/installations?status=PENDIENTE"),
    refetchInterval: 5_000,
  });
  const rows = queue.data?.data ?? [];

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Seleccioná una instalación");
      if (!meter.number.trim()) throw new Error("El número de medidor es obligatorio");
      const gps = await captureGps();
      let photoFileId: string | undefined;
      if (photo) photoFileId = await uploadEvidencePhoto(photo, "install-photo", "instalacion.jpg");
      return api<{ data: { distanceM: number | null; withinFence: boolean; initialReading: string } }>(`/installations/${selected.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          meterNumber: meter.number.trim(),
          meterBrand: meter.brand || undefined,
          meterModel: meter.model || undefined,
          meterSerial: meter.serial || undefined,
          initialReading: meter.initialReading || "0",
          installedAt: meter.installedAt || undefined,
          observations: obs || undefined,
          photoFileId,
          gps,
        }),
      });
    },
    onSuccess: (res) => {
      setDone(res.data);
      setSelected(null);
      setPhoto(null);
      setPreview(null);
      void refreshNow(qc, ["installations"], ["/connections"], ["/meters"], ["/notifications"]);
    },
  });

  if (selected) {
    return (
      <>
        <PageHeader title="Registrar instalación" subtitle={`${selected.connectionCode} · pendiente`} />
        <Card className="mb-4 grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Solicitante</p>
          <p className="font-semibold">{selected.customerName}</p>
          <p className="text-sm text-slate-600">
            {selected.customerCode} · {solicitanteDoc(selected)}
          </p>
          <p className="text-sm text-slate-600">Celular: {selected.mobile ?? selected.phone ?? "—"}</p>
          {selected.email ? <p className="text-sm text-slate-600">Correo: {selected.email}</p> : null}
          <p className="text-sm text-slate-600">Dirección: {selected.address ?? selected.customerAddress ?? "—"}</p>
          <p className="text-sm text-slate-600">{solicitantePlace(selected)}</p>
          {selected.referenceNote ? <p className="text-sm text-slate-600">Referencia: {selected.referenceNote}</p> : null}
          {selected.requestedAt ? <p className="text-sm text-slate-600">Solicitud: {selected.requestedAt}</p> : null}
        </Card>
        <Card className="grid gap-3">
          <FieldDeviceHint />
          <h2 className="font-medium">Medidor</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Número">
              <Input required value={meter.number} onChange={(e) => setMeter((s) => ({ ...s, number: e.target.value }))} />
            </Field>
            <Field label="Marca">
              <Input value={meter.brand} onChange={(e) => setMeter((s) => ({ ...s, brand: e.target.value }))} />
            </Field>
            <Field label="Modelo">
              <Input value={meter.model} onChange={(e) => setMeter((s) => ({ ...s, model: e.target.value }))} />
            </Field>
            <Field label="Serie">
              <Input value={meter.serial} onChange={(e) => setMeter((s) => ({ ...s, serial: e.target.value }))} />
            </Field>
            <Field label="Lectura inicial">
              <Input inputMode="decimal" value={meter.initialReading} onChange={(e) => setMeter((s) => ({ ...s, initialReading: e.target.value }))} />
            </Field>
            <Field label="Fecha de instalación">
              <Input type="date" value={meter.installedAt} onChange={(e) => setMeter((s) => ({ ...s, installedAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Observaciones">
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </Field>
          <NativePhotoButton
            label={preview ? "Repetir fotografía" : "Tomar fotografía"}
            onFile={(file) => {
              setPhoto(file);
              setPreview(URL.createObjectURL(file));
            }}
          />
          {preview ? <img src={preview} alt="Vista previa" className="max-h-64 rounded-lg object-cover" /> : null}
          {save.isError ? (
            <p className="text-sm text-red-700">{save.error instanceof ApiError || save.error instanceof Error ? save.error.message : "No se pudo guardar"}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
              Volver
            </Button>
            <Button type="button" className="min-h-12 flex-1" disabled={save.isPending || !meter.number.trim()} onClick={() => save.mutate()}>
              {save.isPending ? "Guardando…" : "Guardar (foto + GPS)"}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Instalaciones" subtitle="Pendientes de medidor. Al abrir se cargan los datos del solicitante y los campos del medidor." />
      {done ? (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <p className="font-semibold text-emerald-950">Instalación registrada</p>
          <p className="text-sm">Lectura inicial: {done.initialReading}</p>
          <p className="text-sm">
            Distancia: {done.distanceM == null ? "sin referencia" : `${Math.round(done.distanceM)} m`} {done.withinFence ? "✓" : "⚠"}
          </p>
        </Card>
      ) : null}
      <div className="grid gap-3">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm"
            onClick={() => {
              setSelected(row);
              setMeter({
                number: row.meterNumber ?? "",
                brand: row.meterBrand ?? "",
                model: row.meterModel ?? "",
                serial: "",
                initialReading: row.meterInitial ?? row.initialReading ?? "0",
                installedAt: "",
              });
              setObs("");
              setDone(null);
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Pendiente</p>
            <p className="font-semibold">
              {row.connectionCode} · {row.customerName}
            </p>
            <p className="text-sm text-slate-600">{solicitanteDoc(row)}</p>
            <p className="text-sm text-slate-600">{row.mobile ?? row.phone ?? "Sin teléfono"}</p>
            <p className="text-sm text-slate-600">{row.address ?? row.customerAddress ?? "Sin dirección"}</p>
            <p className="text-xs text-slate-500">{solicitantePlace(row)}</p>
          </button>
        ))}
        {queue.isFetching && rows.length === 0 ? (
          <p className="text-slate-600">Actualizando…</p>
        ) : !queue.isLoading && rows.length === 0 ? (
          <p className="text-slate-600">No hay instalaciones pendientes.</p>
        ) : null}
      </div>
    </>
  );
}
