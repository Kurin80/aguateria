import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Field, Input, Modal } from "../components/ui";
import { ResourcePage } from "./ResourcePage";

export function MetersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [replacing, setReplacing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ResourcePage
        title="Medidores"
        subtitle="El historial de lecturas del medidor retirado se conserva."
        path="/meters"
        createPermission="medidores.crear"
        editPermission="medidores.editar"
        columns={[
          { key: "number", label: "Número" },
          { key: "brand", label: "Marca" },
          { key: "model", label: "Modelo" },
          { key: "serial", label: "Serie" },
          { key: "status", label: "Estado" },
          { key: "installedAt", label: "Instalación" },
        ]}
        fields={[
          { key: "connectionId", label: "Conexión", optionsPath: "/connections", optionLabel: ["code", "accountNumber"] },
          { key: "number", label: "Número", required: true },
          { key: "brand", label: "Marca" },
          { key: "model", label: "Modelo" },
          { key: "serial", label: "Serie" },
          { key: "installedAt", label: "Fecha de instalación", type: "date" },
          { key: "initialReading", label: "Lectura inicial", type: "number" },
          { key: "notes", label: "Observaciones", type: "textarea" },
        ]}
        rowActions={
          can("medidores.editar")
            ? [
                {
                  label: "Cambiar medidor",
                  permission: "medidores.editar",
                  run: (row) => {
                    if (row.status === "RETIRADO") return;
                    setError(null);
                    setReplacing(row);
                  },
                },
              ]
            : []
        }
      />
      {replacing ? (
        <ReplaceMeterForm
          meter={replacing}
          error={error}
          onClose={() => setReplacing(null)}
          onError={setError}
          onDone={() => {
            setReplacing(null);
            void qc.invalidateQueries({ queryKey: ["/meters"] });
          }}
        />
      ) : null}
    </>
  );
}

function ReplaceMeterForm({
  meter,
  error,
  onClose,
  onError,
  onDone,
}: {
  meter: Record<string, unknown>;
  error: string | null;
  onClose: () => void;
  onError: (m: string | null) => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    number: "",
    brand: "",
    model: "",
    finalReading: "",
    initialReading: "0",
    notes: "",
  });
  const events = useQuery({
    queryKey: ["meter-events", meter.id],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(`/meters/${meter.id}/events`),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/meters/${meter.id}/replace`, {
        method: "POST",
        body: JSON.stringify({
          number: form.number,
          brand: form.brand || undefined,
          model: form.model || undefined,
          finalReading: form.finalReading,
          initialReading: form.initialReading || "0",
          notes: form.notes || undefined,
        }),
      }),
    onSuccess: onDone,
    onError: (err: unknown) => onError(err instanceof ApiError ? err.message : "No se pudo cambiar el medidor"),
  });

  return (
    <Modal title={`Cambio de medidor ${String(meter.number ?? "")}`} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onError(null);
          save.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          El medidor anterior queda RETIRADO. Las lecturas históricas no se borran.
        </p>
        <Field label="Lectura final del medidor anterior">
          <Input required inputMode="decimal" value={form.finalReading} onChange={(e) => setForm((s) => ({ ...s, finalReading: e.target.value }))} />
        </Field>
        <Field label="Número del medidor nuevo">
          <Input required value={form.number} onChange={(e) => setForm((s) => ({ ...s, number: e.target.value }))} />
        </Field>
        <Field label="Marca">
          <Input value={form.brand} onChange={(e) => setForm((s) => ({ ...s, brand: e.target.value }))} />
        </Field>
        <Field label="Modelo">
          <Input value={form.model} onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))} />
        </Field>
        <Field label="Lectura inicial del nuevo">
          <Input inputMode="decimal" value={form.initialReading} onChange={(e) => setForm((s) => ({ ...s, initialReading: e.target.value }))} />
        </Field>
        <Field label="Observaciones">
          <Input value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </Field>
        {(events.data?.data ?? []).length > 0 ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">Historial</p>
            <ul className="mt-1 space-y-1">
              {events.data!.data.map((ev) => (
                <li key={String(ev.id)}>
                  {String(ev.eventType)} · {ev.reading ? String(ev.reading) : "—"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Guardando…" : "Registrar cambio"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
