import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, api } from "../api/client";
import { Button, Card, Input, PageHeader } from "../components/ui";
import { captureGps, uploadEvidencePhoto, type GpsFix } from "../lib/field-capture";
import { FieldDeviceHint, NativePhotoButton } from "../components/field-device";
import { openAuthenticatedPdf } from "../lib/pdf";
import { refreshNow } from "../lib/refresh";

type Stop = {
  connectionId: string;
  connectionCode: string;
  accountNumber: string | null;
  connectionStatus: string | null;
  address: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerLegalName: string | null;
  customerRuc: string | null;
  customerCi: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  meterId: string | null;
  meterNumber: string | null;
  meterBrand: string | null;
  meterModel: string | null;
  meterStatus: string | null;
  meterInstalledAt: string | null;
  previousReading: string | null;
  initialReading: string | null;
  lastReadAt: string | null;
  itemStatus: "PENDIENTE" | "REGISTRADA";
  lastRequiresReview?: boolean;
  lastAnomaly?: string | null;
  supplyLat?: string | null;
  supplyLng?: string | null;
};

type FieldConfig = {
  gpsMaxAccuracyMeters: number;
  gpsGeofenceMeters: number;
  gpsGeofenceBlock: boolean;
  photoRequired: boolean;
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function stopName(stop: Stop): string {
  const fromParts = [stop.customerFirstName, stop.customerLastName].filter(Boolean).join(" ").trim();
  return (stop.customerName ?? "").trim() || fromParts || (stop.customerLegalName ?? "").trim() || stop.customerCode || stop.connectionCode;
}

function severityLabel(code: string | undefined, lower: boolean): string {
  if (lower) return "REQUIERE REVISIÓN";
  if (!code || code === "NONE") return "NORMAL";
  if (code.includes("GPS") || code.includes("PHOTO") || code.includes("HIGH") || code.includes("LOW")) return "ADVERTENCIA";
  return "REQUIERE REVISIÓN";
}

export function FieldReadingsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "done" | "observed" | "incident">("pending");
  const [selected, setSelected] = useState<Stop | null>(null);
  const [current, setCurrent] = useState("");
  const [incident, setIncident] = useState(false);
  const [observations, setObservations] = useState("");
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    reading: string;
    consumption: string;
    gps?: GpsFix;
    next?: Stop;
    severity: string;
    billId?: string | null;
    billNumber?: string | null;
    readingId?: string | null;
  } | null>(null);

  const queue = useQuery({
    queryKey: ["field-queue", q, status],
    queryFn: () =>
      api<{ data: Stop[]; meta: { pending: number; done: number; observed: number } }>(
        `/field/queue?status=${status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`,
      ),
    refetchInterval: 8_000,
  });
  const config = useQuery({
    queryKey: ["field-config"],
    queryFn: () => api<{ data: FieldConfig }>("/field/config"),
  });
  const cfg = config.data?.data;
  const stops = queue.data?.data ?? [];
  const meta = queue.data?.meta ?? { pending: 0, done: 0, observed: 0 };

  const previous = useMemo(() => {
    if (!selected) return 0;
    return Number(selected.previousReading ?? selected.initialReading ?? 0);
  }, [selected]);
  const currentN = Number(current);
  const consumption = Number.isFinite(currentN) && current !== "" ? currentN - previous : null;
  const lower = consumption != null && consumption < 0;
  const firstPending = stops.find((s) => s.itemStatus === "PENDIENTE" && s.meterId);

  function resetCapture() {
    setCurrent("");
    setIncident(false);
    setObservations("");
    setGps(null);
    setGpsError(null);
    setPhoto(null);
    setPreview(null);
  }

  const start = useMutation({
    mutationFn: async (stop: Stop) => {
      if (!stop.meterId) throw new Error("El suministro no tiene medidor para leer");
      setSaved(null);
      resetCapture();
      setSelected(stop);
      const res = await api<{ data: { meterId: string; previousReading: string } }>("/field/start", {
        method: "POST",
        body: JSON.stringify({ connectionId: stop.connectionId }),
      });
      return { stop, data: res.data };
    },
    onSuccess: ({ stop, data }) => {
      setSelected({
        ...stop,
        meterId: data.meterId ?? stop.meterId,
        previousReading: data.previousReading ?? stop.previousReading,
        meterStatus: "INSTALADO",
        connectionStatus: stop.connectionStatus === "PENDIENTE" ? "ACTIVA" : stop.connectionStatus,
      });
      void refreshNow(qc, ["field-queue"], ["/notifications"]);
    },
    onError: () => {
      setSelected(null);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!selected?.meterId) throw new Error("El suministro no tiene medidor instalado");
      if (cfg?.photoRequired && !photo) throw new Error("La fotografía del medidor es obligatoria");
      if (lower && !incident) throw new Error("La lectura es menor. Confirmá si hubo cambio de medidor o incidencia");
      setGpsError(null);
      const fix = await captureGps();
      setGps(fix);
      let photoFileId: string | undefined;
      if (photo) photoFileId = await uploadEvidencePhoto(photo, "meter-photo", "medidor.jpg");
      const res = await api<{
        data: {
          id?: string;
          evaluation?: { consumptionM3: number; warnings: string[]; anomalyCode: string };
          billId?: string | null;
          billNumber?: string | null;
        };
      }>(
        "/readings",
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            connectionId: selected.connectionId,
            meterId: selected.meterId,
            currentReading: current,
            meterReset: incident,
            photoFileId,
            observations: observations || undefined,
            gps: {
              latitude: fix.latitude,
              longitude: fix.longitude,
              accuracyMeters: fix.accuracyMeters,
              mocked: fix.mocked ?? false,
              capturedAt: fix.capturedAt,
            },
            deviceCapturedAt: new Date().toISOString(),
          }),
        },
      );
      return { res, fix };
    },
    onSuccess: async ({ res, fix }) => {
      const next = stops.find((s) => s.connectionId !== selected?.connectionId && s.itemStatus === "PENDIENTE");
      setSaved({
        reading: current,
        consumption: String(res.data.evaluation?.consumptionM3 ?? consumption ?? ""),
        gps: fix,
        next,
        severity: severityLabel(res.data.evaluation?.anomalyCode, lower),
        billId: res.data.billId,
        billNumber: res.data.billNumber,
        readingId: res.data.id ?? null,
      });
      setSelected(null);
      resetCapture();
      await refreshNow(qc, ["field-queue"], ["/notifications"]);
    },
    onError: (err: unknown) => {
      if (err instanceof Error && /geoloc|ubicación|GPS|permission/i.test(err.message)) {
        setGpsError(err.message);
      }
    },
  });

  if (saved) {
    return (
      <>
        <PageHeader title="Lectura registrada" />
        <Card className="mx-auto max-w-lg text-center">
          <p className="text-lg font-semibold text-emerald-800">Lectura registrada</p>
          <p className="mt-3 text-sm">Lectura: {saved.reading}</p>
          <p className="text-sm">Consumo: {saved.consumption} m³</p>
          <p className="text-sm">Estado: {saved.severity}</p>
          {saved.gps ? (
            <p className="text-sm">
              GPS ✓ · Precisión: {Math.round(saved.gps.accuracyMeters)} metros
            </p>
          ) : null}
          {saved.billNumber ? <p className="mt-2 text-sm">Boleta {saved.billNumber} generada</p> : null}
          <div className="mt-6 flex flex-col gap-2">
            {saved.readingId && saved.billId ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-12"
                onClick={() => void openAuthenticatedPdf(`/readings/${saved.readingId}/boleta-pdf`)}
              >
                Descargar boleta (QR)
              </Button>
            ) : null}
            {saved.next ? (
              <Button className="min-h-12 text-base" type="button" disabled={start.isPending} onClick={() => start.mutate(saved.next!)}>
                {start.isPending ? "Iniciando…" : "Siguiente lectura"}
              </Button>
            ) : null}
            {start.isError ? (
              <p className="text-sm text-red-700">
                {start.error instanceof ApiError || start.error instanceof Error ? start.error.message : "No se pudo iniciar"}
              </p>
            ) : null}
            <Button variant="secondary" className="min-h-12" onClick={() => setSaved(null)}>
              Volver al listado
            </Button>
          </div>
        </Card>
      </>
    );
  }

  if (selected) {
    const dist =
      gps && selected.supplyLat && selected.supplyLng
        ? haversine(gps.latitude, gps.longitude, Number(selected.supplyLat), Number(selected.supplyLng))
        : null;
    const outOfRange = dist != null && cfg ? dist > cfg.gpsGeofenceMeters : false;
    const gpsOk = gps && cfg ? gps.accuracyMeters <= cfg.gpsMaxAccuracyMeters : Boolean(gps);
    const doc = selected.customerRuc || selected.customerCi || "—";

    return (
      <>
        <button type="button" className="mb-3 text-sm text-brand-800 underline" onClick={() => setSelected(null)}>
          ← Lecturas del día
        </button>
        <PageHeader title={stopName(selected)} subtitle={`${selected.connectionCode} · ${selected.address ?? "Sin dirección"}`} />
        <div className="mx-auto grid max-w-lg gap-3">
          <FieldDeviceHint />
          <Card>
            <h2 className="font-medium">Cliente</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Código</dt>
              <dd>{selected.customerCode ?? "—"}</dd>
              <dt className="text-slate-500">Nombre</dt>
              <dd>{selected.customerLegalName || selected.customerFirstName || stopName(selected)}</dd>
              <dt className="text-slate-500">Apellido / razón</dt>
              <dd>{selected.customerLegalName || selected.customerLastName || "—"}</dd>
              <dt className="text-slate-500">Documento / RUC</dt>
              <dd>{doc}</dd>
              <dt className="text-slate-500">Teléfono</dt>
              <dd>{selected.customerPhone ?? "—"}</dd>
              <dt className="text-slate-500">Dirección</dt>
              <dd>{selected.customerAddress ?? selected.address ?? "—"}</dd>
            </dl>
          </Card>
          <Card>
            <h2 className="font-medium">Conexión</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Código</dt>
              <dd>{selected.connectionCode}</dd>
              <dt className="text-slate-500">N.º suministro</dt>
              <dd>{selected.accountNumber ?? selected.connectionCode}</dd>
              <dt className="text-slate-500">Estado</dt>
              <dd>{selected.connectionStatus ?? "ACTIVA"}</dd>
              <dt className="text-slate-500">Dirección</dt>
              <dd>{selected.address ?? "—"}</dd>
            </dl>
          </Card>
          <Card>
            <h2 className="font-medium">Medidor</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Número</dt>
              <dd>{selected.meterNumber ?? "—"}</dd>
              <dt className="text-slate-500">Marca</dt>
              <dd>{selected.meterBrand ?? "—"}</dd>
              <dt className="text-slate-500">Modelo</dt>
              <dd>{selected.meterModel ?? "—"}</dd>
              <dt className="text-slate-500">Instalación</dt>
              <dd>{selected.meterInstalledAt ?? "—"}</dd>
              <dt className="text-slate-500">Estado</dt>
              <dd>{selected.meterStatus ?? "—"}</dd>
              <dt className="text-slate-500">Lectura anterior</dt>
              <dd className="text-lg font-semibold">{previous}</dd>
              <dt className="text-slate-500">Fecha anterior</dt>
              <dd>{selected.lastReadAt ? new Date(selected.lastReadAt).toLocaleString("es-PY") : "Sin historial"}</dd>
            </dl>
          </Card>
          <Card>
            <label className="block text-sm font-medium">
              Lectura actual
              <Input
                className="mt-2 min-h-14 text-center text-2xl tracking-widest"
                inputMode="decimal"
                type="text"
                value={current}
                onChange={(e) => setCurrent(e.target.value.replace(/[^\d.]/g, ""))}
                autoFocus
              />
            </label>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-sm">
              <div>
                <p className="text-slate-500">Anterior</p>
                <p className="font-semibold">{previous}</p>
              </div>
              <div>
                <p className="text-slate-500">Actual</p>
                <p className="font-semibold">{current || "—"}</p>
              </div>
              <div>
                <p className="text-slate-500">Consumo</p>
                <p className="font-semibold">{consumption != null && !Number.isNaN(consumption) ? `${consumption.toFixed(3)} m³` : "—"}</p>
              </div>
            </div>
            {lower ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">ADVERTENCIA</p>
                <p>La lectura actual es menor que la anterior. Verifique el medidor o registre una incidencia.</p>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={incident} onChange={(e) => setIncident(e.target.checked)} />
                  Sí, registrar incidencia / cambio de medidor
                </label>
                <Input
                  className="mt-2"
                  placeholder="Motivo"
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                />
              </div>
            ) : (
              <Input
                className="mt-3"
                placeholder="Observación (opcional)"
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
              />
            )}
          </Card>
          <Card>
            <p className="font-medium">GPS</p>
            <p className="mt-1 text-sm text-slate-600">Se captura automáticamente al guardar. No hace falta escribir coordenadas.</p>
            {gps ? (
              <p className={`mt-2 text-sm ${gpsOk ? "text-emerald-800" : "text-amber-800"}`}>
                GPS {gpsOk ? "✓" : "⚠"} · Precisión: {Math.round(gps.accuracyMeters)} metros
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">GPS pendiente de captura</p>
            )}
            {dist != null ? (
              <p className={`text-sm ${outOfRange ? "text-amber-800" : "text-emerald-800"}`}>
                {outOfRange ? `⚠ Ubicación fuera del área esperada (${Math.round(dist)} m)` : `✓ Ubicación correcta (${Math.round(dist)} m)`}
              </p>
            ) : null}
            {gpsError ? <p className="mt-2 text-sm text-red-700">{gpsError}</p> : null}
          </Card>
          <Card>
            <p className="font-medium">Fotografía del medidor {cfg?.photoRequired ? "*" : ""}</p>
            <NativePhotoButton
              label={preview ? "Repetir fotografía" : "Tomar fotografía"}
              onFile={(file) => {
                setPhoto(file);
                setPreview(URL.createObjectURL(file));
              }}
            />
            {preview ? <img src={preview} alt="Fotografía del medidor" className="mt-3 max-h-56 w-full rounded-lg object-cover" /> : null}
            {preview ? <p className="mt-2 text-sm text-emerald-800">Fotografía del medidor ✓</p> : null}
          </Card>
          {save.isError ? (
            <p className="text-sm text-red-700">
              {save.error instanceof ApiError || save.error instanceof Error ? save.error.message : "No se pudo guardar"}
            </p>
          ) : null}
          <Button className="min-h-14 text-base" disabled={save.isPending || !current || !selected.meterId} onClick={() => save.mutate()}>
            {save.isPending ? "Capturando GPS y guardando…" : "Guardar lectura"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Lectura de campo"
        subtitle="Buscá el cliente o la conexión. En el celular, GPS y cámara nativos al guardar."
        actions={
          firstPending ? (
            <Button className="min-h-12" type="button" disabled={start.isPending} onClick={() => start.mutate(firstPending)}>
              {start.isPending ? "Iniciando…" : "Iniciar lecturas"}
            </Button>
          ) : null
        }
      />
      <FieldDeviceHint />
      <div className="mb-4 mt-3 grid grid-cols-3 gap-2">
        <Card>
          <p className="text-xs text-slate-500">Pendientes</p>
          <p className="text-2xl font-semibold">{meta.pending}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Realizadas</p>
          <p className="text-2xl font-semibold">{meta.done}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Observadas</p>
          <p className="text-2xl font-semibold">{meta.observed}</p>
        </Card>
      </div>
      <Input
        className="min-h-12"
        placeholder="Buscar cliente, CI, RUC, medidor o dirección"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["pending", "Pendientes"],
            ["done", "Realizadas"],
            ["observed", "Observadas"],
            ["incident", "Con incidencia"],
            ["all", "Todas"],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} type="button" variant={status === id ? "primary" : "secondary"} onClick={() => setStatus(id)}>
            {label}
          </Button>
        ))}
      </div>
      {queue.isError ? <p className="mt-4 text-red-700">No se pudo cargar la cola de lecturas.</p> : null}
      {start.isError && !selected && !saved ? (
        <p className="mt-3 text-sm text-red-700">
          {start.error instanceof ApiError || start.error instanceof Error ? start.error.message : "No se pudo iniciar la lectura"}
        </p>
      ) : null}
      <ul className="mt-4 space-y-2">
        {stops.map((stop) => (
          <li key={`${stop.connectionId}-${stop.meterId ?? "x"}`}>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold">{stopName(stop)}</p>
              <p className="text-sm text-slate-600">{stop.address ?? "Sin dirección"}</p>
              <p className="text-sm">
                {stop.connectionCode} · Medidor {stop.meterNumber ?? "—"} · {stop.itemStatus}
              </p>
              {stop.itemStatus === "PENDIENTE" ? (
                <Button
                  type="button"
                  className="mt-3 min-h-12 w-full text-base"
                  disabled={start.isPending || !stop.meterId}
                  onClick={() => start.mutate(stop)}
                >
                  {start.isPending ? "Iniciando…" : "Iniciar lectura"}
                </Button>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Ya registrada en este período</p>
              )}
              {!stop.meterId && stop.itemStatus === "PENDIENTE" ? (
                <p className="mt-2 text-sm text-amber-800">Sin medidor. Completá la instalación o cargá el medidor en oficina.</p>
              ) : null}
            </div>
          </li>
        ))}
        {stops.length === 0 && !queue.isLoading ? (
          <li className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No hay suministros con medidor para este filtro. Si el alta quedó pendiente de instalación, completala en
            Instalaciones o cargá el número de medidor en la conexión.
          </li>
        ) : null}
      </ul>
    </>
  );
}
