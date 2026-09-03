import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Card, Field, Input, PageHeader, Select } from "../components/ui";
import { BillsPage, InvoicesPage, PaymentsPage } from "./OperationsPages";
import { CreditsPage } from "./CreditsPage";
import { captureGps, type GpsFix } from "../lib/field-capture";
import { FieldDeviceHint } from "../components/field-device";
import { openAuthenticatedPdf } from "../lib/pdf";
import { formatGs, gsInteger } from "../lib/money";
import { refreshNow } from "../lib/refresh";

// maplibre-gl (~800 kB) sólo se descarga al abrir un recorrido con traza.
const RouteTrailMap = lazy(() =>
  import("../components/RouteTrailMap").then((m) => ({ default: m.RouteTrailMap })),
);

type Debtor = {
  customerId: string;
  customerCode: string;
  customerName: string;
  address: string | null;
  connectionCode: string | null;
  connectionAddress: string | null;
  debt: string;
  accountStatus: string;
  pendingBills: number;
  lastPaidOn: string | null;
  latitude: string | null;
  longitude: string | null;
};

type Method = { id: string; name: string; code: string };
type Debt = { kind: "CONSUMO" | "BOLETA" | "CUOTA" | "CONEXION"; description: string; amount: string; consumptionM3?: string | null; dueOn?: string | null };
type Account = {
  account: { balance: string; status: string } | null;
  bills: Array<{ id: string; number: string; total: string; balance: string; status: string; dueOn: string }>;
  payments: Array<{ id: string; amount: string; paidOn: string }>;
  debts?: Debt[];
};

function ModuleTabs({
  vista,
  onChange,
  tabs,
}: {
  vista: string;
  onChange: (v: string) => void;
  tabs: Array<{ id: string; label: string }>;
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`min-h-11 rounded-lg px-4 text-sm font-medium ${
            vista === tab.id ? "bg-brand-800 text-white" : "border border-slate-300 bg-white text-slate-800"
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function CollectionPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canInvoices = can("facturas.ver");
  const canPayments = can("pagos.ver");
  const canBills = can("boletas.ver");
  const canCredits = can("boletas.emitir") || can("facturas.anular") || can("facturas.crear") || canBills;
  const moduleTabs = [
    { id: "cobrar", label: "Cobrar" },
    ...(canBills ? [{ id: "boletas", label: "Boletas" }] : []),
    ...(canInvoices ? [{ id: "facturas", label: "Facturas" }] : []),
    ...(canCredits ? [{ id: "creditos", label: "Créditos" }] : []),
    ...(canPayments ? [{ id: "pagos", label: "Pagos" }] : []),
  ];
  const rawVista = params.get("vista") ?? "cobrar";
  const allowedVistas = new Set(moduleTabs.map((t) => t.id));
  const vista = allowedVistas.has(rawVista) ? rawVista : "cobrar";
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Debtor | null>(null);
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [intervalId, setIntervalId] = useState<number | null>(null);
  const [lastPaymentId, setLastPaymentId] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const goVista = (v: string) => {
    setSelected(null);
    setParams(v === "cobrar" ? {} : { vista: v });
  };

  const queue = useQuery({
    queryKey: ["collection-queue", q],
    queryFn: () => api<{ data: Debtor[] }>(`/collections/queue${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
    refetchInterval: 8_000,
  });
  const methods = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api<{ data: Method[] }>("/payment-methods"),
  });
  const cfg = useQuery({
    queryKey: ["collection-config"],
    queryFn: () => api<{ data: { gpsIntervalSeconds: number } }>("/collections/config"),
  });
  const route = useQuery({
    queryKey: ["collection-route"],
    queryFn: () =>
      api<{ data: { id: string; status: string; points: Array<{ latitude: string; longitude: string; capturedAt?: string }>; visits: Array<{ customerId: string; result: string }> } | null }>(
        "/collections/routes/active",
      ),
    refetchInterval: 8_000,
  });
  const account = useQuery({
    queryKey: ["account", selected?.customerId],
    queryFn: () => api<{ data: Account }>(`/accounts/${selected!.customerId}`),
    enabled: Boolean(selected),
  });

  const start = useMutation({
    mutationFn: async () => {
      const gps = await captureGps();
      return api("/collections/routes/start", { method: "POST", body: JSON.stringify(gps) });
    },
    onSuccess: () => void refreshNow(qc, ["collection-route"]),
  });
  const finish = useMutation({
    mutationFn: () => api(`/collections/routes/${route.data?.data?.id}/finish`, { method: "POST" }),
    onSuccess: () => {
      if (intervalId) window.clearInterval(intervalId);
      setIntervalId(null);
      void refreshNow(qc, ["collection-route"]);
    },
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Cliente requerido");
      let gps: GpsFix | undefined;
      try {
        gps = await captureGps();
      } catch {
        gps = undefined;
      }
      return api<{ data: { id: string; invoiceId?: string | null } }>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customerId: selected.customerId,
          methodId,
          amount,
          paidOn: new Date().toISOString().slice(0, 10),
          idempotencyKey: crypto.randomUUID(),
          collectionRouteId: route.data?.data?.id,
          latitude: gps?.latitude,
          longitude: gps?.longitude,
          gpsAccuracyM: gps?.accuracyMeters,
        }),
      });
    },
    onSuccess: (res) => {
      setAmount("");
      setLastPaymentId(res.data.id);
      setLastInvoiceId(res.data.invoiceId ?? null);
      void refreshNow(qc, ["collection-queue"], ["account", selected?.customerId], ["/invoices"], ["/accounts/outstanding"], ["/notifications"]);
    },
  });

  useEffect(() => {
    const activeId = route.data?.data?.id;
    const seconds = Math.max(15, cfg.data?.data.gpsIntervalSeconds ?? 30);
    if (!activeId) return;
    const id = window.setInterval(() => {
      void captureGps()
        .then((gps) => api(`/collections/routes/${activeId}/ping`, { method: "POST", body: JSON.stringify(gps) }))
        .catch(() => undefined);
    }, seconds * 1000);
    setIntervalId(id);
    return () => window.clearInterval(id);
  }, [route.data?.data?.id, cfg.data?.data.gpsIntervalSeconds]);

  const points = route.data?.data?.points ?? [];
  const visits = route.data?.data?.visits ?? [];
  const visitByCustomer = new Map(visits.map((v) => [v.customerId, v.result]));
  const collectable = account.data?.data.debts ?? [];
  const collectableTotal = collectable.reduce((s, d) => s + Number(d.amount), 0);

  const selectedCustomerId = selected?.customerId;
  useEffect(() => {
    const debts = account.data?.data.debts;
    if (!selectedCustomerId || !debts) return;
    const total = debts.reduce((s, d) => s + Number(d.amount), 0);
    setAmount(total > 0 ? gsInteger(total) : "");
  }, [selectedCustomerId, account.data?.data.debts]);

  if (vista === "boletas") {
    return (
      <>
        <PageHeader title="Cobranza y facturación" subtitle="Boletas de consumo y de crédito. No son DTE SIFEN." />
        <ModuleTabs vista={vista} tabs={moduleTabs} onChange={goVista} />
        <BillsPage embedded />
      </>
    );
  }
  if (vista === "facturas") {
    return (
      <>
        <PageHeader title="Cobranza y facturación" subtitle="Comprobantes tributarios y nota de crédito." />
        <ModuleTabs vista={vista} tabs={moduleTabs} onChange={goVista} />
        <InvoicesPage embedded />
      </>
    );
  }
  if (vista === "creditos") {
    return (
      <>
        <PageHeader
          title="Cobranza y facturación"
          subtitle="Boleta de crédito (caja) y nota de crédito (factura / SIFEN)."
        />
        <ModuleTabs vista={vista} tabs={moduleTabs} onChange={goVista} />
        <CreditsPage />
      </>
    );
  }
  if (vista === "pagos") {
    return (
      <>
        <PageHeader title="Cobranza y facturación" subtitle="Cobros registrados y anulación." />
        <ModuleTabs vista={vista} tabs={moduleTabs} onChange={goVista} />
        <PaymentsPage />
      </>
    );
  }

  if (selected) {
    const acc = account.data?.data;
    return (
      <>
        <PageHeader title={selected.customerName} subtitle={`${selected.customerCode} · ${selected.connectionCode ?? ""}`} />
        <ModuleTabs vista="cobrar" tabs={moduleTabs} onChange={goVista} />
        <Card className="grid gap-3">
          <p className="text-sm">{selected.connectionAddress ?? selected.address}</p>
          <p className="text-3xl font-semibold">{formatGs(collectable.length ? collectableTotal : (acc?.account?.balance ?? selected.debt))}</p>
          <p className="text-sm text-slate-600">
            Estado: {acc?.account?.status ?? selected.accountStatus} · A cobrar ahora: {formatGs(collectableTotal)} · Último
            pago: {selected.lastPaidOn ?? "—"}
          </p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle del cobro</p>
            <p className="mt-1 text-xs text-slate-500">Consumo del período, cuotas próximas a vencer y costos de conexión/instalación adeudados.</p>
            <ul className="mt-1 text-sm">
              {collectable.map((d) => (
                <li key={`${d.kind}-${d.description}`} className="flex justify-between gap-3 border-b border-slate-100 py-2">
                  <span>
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {d.kind === "CONSUMO" || d.kind === "BOLETA" ? "Consumo" : d.kind === "CUOTA" ? "Cuota" : "Conexión / instalación"}
                    </span>
                    {d.description}
                  </span>
                  <span className="shrink-0 font-medium">{formatGs(d.amount)}</span>
                </li>
              ))}
              {!account.isLoading && !collectable.length ? (
                <li className="py-2 text-slate-500">Sin consumo pendiente, cuotas próximas ni costos de conexión/instalación.</li>
              ) : null}
            </ul>
          </div>
          {(acc?.payments ?? []).length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cobros registrados</p>
              <ul className="mt-1 text-sm">
                {[...acc!.payments]
                  .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
                  .slice(0, 5)
                  .map((p) => (
                    <li key={p.id} className="flex justify-between border-b border-slate-100 py-2">
                      <span>{p.paidOn}</span>
                      <span>{formatGs(p.amount)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <Field label="Forma de pago">
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)} required>
              <option value="">Seleccionar…</option>
              {(methods.data?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Importe Gs.">
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          {pay.isError ? <p className="text-sm text-red-700">{pay.error instanceof ApiError ? pay.error.message : "No se pudo cobrar"}</p> : null}
          <div className="flex flex-col gap-2">
            <Button className="min-h-12" disabled={pay.isPending || !methodId || !amount} onClick={() => pay.mutate()}>
              Registrar cobro
            </Button>
          {lastPaymentId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void openAuthenticatedPdf(`/payments/${lastPaymentId}/pdf`)}
            >
              Ver / imprimir comprobante
            </Button>
          ) : null}
          {lastInvoiceId && lastPaymentId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void openAuthenticatedPdf(`/payments/${lastPaymentId}/invoice-pdf`)}
            >
              Ver factura (consumo y deudas)
            </Button>
          ) : null}
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Volver al recorrido
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Cobranza y facturación"
        subtitle="Cobro, factura del pago y comprobantes en el mismo módulo. El recorrido usa GPS nativo."
        actions={
          route.data?.data ? (
            <Button variant="danger" onClick={() => finish.mutate()}>
              Finalizar recorrido
            </Button>
          ) : (
            <Button onClick={() => start.mutate()}>Iniciar recorrido</Button>
          )
        }
      />
      <ModuleTabs vista="cobrar" tabs={moduleTabs} onChange={goVista} />
      {start.isError ? <p className="mb-3 text-sm text-red-700">{start.error instanceof ApiError || start.error instanceof Error ? start.error.message : "No se pudo iniciar"}</p> : null}
      <div className="mb-4">
        <FieldDeviceHint />
      </div>
      {route.data?.data ? (
        <Card className="mb-4">
          <p className="font-semibold">Recorrido activo</p>
          <p className="text-sm text-slate-600">{points.length} puntos GPS · {visits.length} visitas</p>
          {points.length > 1 ? (
            <div className="mt-3">
              <Suspense fallback={<div className="h-56 w-full animate-pulse rounded-xl bg-slate-100" />}>
                <RouteTrailMap
                  points={points.map((p) => ({
                    lat: p.latitude,
                    lng: p.longitude,
                    capturedAt: p.capturedAt,
                    routeId: route.data?.data?.id,
                  }))}
                  className="h-56 w-full overflow-hidden rounded-xl border border-slate-200"
                />
              </Suspense>
            </div>
          ) : points.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              Última posición: {points[points.length - 1]?.latitude}, {points[points.length - 1]?.longitude}
            </p>
          ) : null}
        </Card>
      ) : (
        <p className="mb-4 text-sm text-amber-800">Iniciá el recorrido para guardar la trayectoria.</p>
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void queue.refetch();
        }}
      >
        <Input placeholder="Cliente, conexión…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      <div className="grid gap-3">
        {(queue.data?.data ?? []).map((row) => {
          const visit = visitByCustomer.get(row.customerId);
          return (
            <button
              key={row.customerId}
              type="button"
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm"
              onClick={() => {
                setSelected(row);
                setAmount(gsInteger(row.debt));
                setLastPaymentId(null);
                setLastInvoiceId(null);
              }}
            >
              <p className="font-semibold">{row.customerName}</p>
              <p className="text-sm text-slate-600">{row.connectionCode} · {row.connectionAddress ?? row.address}</p>
              <p className="text-sm">Deuda {formatGs(row.debt)} · {row.pendingBills} boletas</p>
              {visit ? <p className="text-xs text-emerald-800">Visita: {visit}</p> : <p className="text-xs text-slate-500">Pendiente de visita</p>}
            </button>
          );
        })}
      </div>
    </>
  );
}
