import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Card, PageHeader } from "../components/ui";
import { captureGps, uploadEvidencePhoto } from "../lib/field-capture";
import { FieldDeviceHint, NativePhotoButton } from "../components/field-device";

type Row = {
  id: string;
  customerId: string;
  connectionId: string;
  reason: string;
  debtAmount: string | null;
  status: string;
  scheduledAt: string | null;
  executedAt: string | null;
};

export function DisconnectionsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Row | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [obs, setObs] = useState("");

  const list = useQuery({
    queryKey: ["/suspensions"],
    queryFn: () => api<{ data: Row[] }>("/suspensions"),
  });
  const scan = useMutation({
    mutationFn: () => api("/collections/scan", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/suspensions"] }),
  });
  const authorize = useMutation({
    mutationFn: (id: string) => api(`/suspensions/${id}/authorize`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/suspensions"] }),
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Seleccioná una desconexión");
      const gps = await captureGps();
      let photoFileId: string | undefined;
      if (photo) photoFileId = await uploadEvidencePhoto(photo, "disconnect-photo", "desconexion.jpg");
      return api(`/suspensions/${selected.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ gps, photoFileId, observations: obs || undefined }),
      });
    },
    onSuccess: () => {
      setSelected(null);
      setPhoto(null);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["/suspensions"] });
    },
  });

  const rows = list.data?.data ?? [];

  if (selected) {
    return (
      <>
        <PageHeader title="Ejecutar desconexión" subtitle={selected.reason} />
        <Card className="grid gap-3">
          <FieldDeviceHint />
          <p className="text-sm">Deuda: Gs. {selected.debtAmount ?? "—"}</p>
          <NativePhotoButton
            label={preview ? "Repetir fotografía" : "Tomar fotografía"}
            onFile={(file) => {
              setPhoto(file);
              setPreview(URL.createObjectURL(file));
            }}
          />
          {preview ? <img src={preview} alt="Vista previa" className="max-h-64 rounded-lg object-cover" /> : null}
          <label className="text-sm font-medium">
            Observaciones
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={obs} onChange={(e) => setObs(e.target.value)} />
          </label>
          {execute.isError ? <p className="text-sm text-red-700">{execute.error instanceof ApiError || execute.error instanceof Error ? execute.error.message : "No se pudo ejecutar"}</p> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Volver
            </Button>
            <Button className="min-h-12 flex-1" disabled={execute.isPending} onClick={() => execute.mutate()}>
              Confirmar corte (foto + GPS)
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Desconexiones"
        subtitle="La mora genera alerta y programación. El corte físico requiere autorización y evidencia."
        actions={
          can("morosidad.gestionar") ? (
            <Button variant="secondary" onClick={() => scan.mutate()} disabled={scan.isPending}>
              Escanear morosidad
            </Button>
          ) : undefined
        }
      />
      {scan.isSuccess ? <p className="mb-3 text-sm text-emerald-800">Escaneo actualizado.</p> : null}
      <div className="grid gap-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <p className="font-semibold">{row.status} · Gs. {row.debtAmount ?? "—"}</p>
            <p className="text-sm text-slate-600">{row.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {row.status === "PROGRAMADA" && can("desconexiones.programar") ? (
                <Button onClick={() => authorize.mutate(row.id)}>Autorizar</Button>
              ) : null}
              {row.status === "AUTORIZADA" && can("desconexiones.ejecutar") ? (
                <Button onClick={() => setSelected(row)}>Ejecutar en campo</Button>
              ) : null}
              {row.status === "EJECUTADA" ? <p className="text-sm text-slate-500">Ejecutada {row.executedAt}</p> : null}
            </div>
          </Card>
        ))}
        {!list.isLoading && rows.length === 0 ? <p className="text-slate-600">Sin desconexiones registradas.</p> : null}
      </div>
    </>
  );
}
