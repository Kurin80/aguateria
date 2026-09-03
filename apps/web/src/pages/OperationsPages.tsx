import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { isFieldOnlyUser } from "../layout/nav";
import { Button, Field, Input, Modal, PageHeader, Select, Table } from "../components/ui";
import { ResourcePage } from "./ResourcePage";
import { openAuthenticatedPdf } from "../lib/pdf";
import { formatGs, gsInteger } from "../lib/money";
import { refreshNow } from "../lib/refresh";

export function ReadingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fieldOnly = isFieldOnlyUser(user?.roles);
  return (
    <ResourcePage
      title="Lecturas"
      subtitle="Alta desde oficina o sync de campo. Las anómalas no facturan hasta ser revisadas."
      path="/readings"
      createPermission={fieldOnly ? undefined : "lecturas.crear"}
      searchPlaceholder="—"
      columns={[
        { key: "previousReading", label: "Anterior" },
        { key: "currentReading", label: "Actual" },
        { key: "consumptionM3", label: "Consumo m³" },
        { key: "anomalyCode", label: "Anomalía" },
        { key: "requiresReview", label: "Revisión" },
        { key: "syncStatus", label: "Sync" },
      ]}
      fields={[
        { key: "connectionId", label: "Conexión", required: true, optionsPath: "/connections", optionLabel: ["code", "accountNumber"] },
        { key: "meterId", label: "Medidor", required: true, optionsPath: "/meters", optionLabel: ["number", "serial"] },
        { key: "currentReading", label: "Lectura actual", required: true, type: "number" },
        { key: "observations", label: "Observaciones", type: "textarea" },
      ]}
      transformPayload={(p) => ({
        connectionId: p.connectionId,
        meterId: p.meterId,
        currentReading: p.currentReading,
        observations: p.observations,
        idempotencyKey: crypto.randomUUID(),
      })}
      rowActions={[
        {
          label: "Aprobar",
          permission: "lecturas.aprobar",
          run: async (row) => {
            await api(`/readings/${row.id}/approve`, { method: "POST" });
            await refreshNow(qc, ["/readings"], ["/notifications"]);
          },
        },
      ]}
    />
  );
}

export function BillsPage({ embedded }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditPending, setCreditPending] = useState(false);

  const extra = [`year=${year}`, `month=${month}`, q.trim() ? `q=${encodeURIComponent(q.trim())}` : "", "pageSize=100"]
    .filter(Boolean)
    .join("&");

  const list = useQuery({
    queryKey: ["/bills", extra],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(`/bills?${extra}`),
  });
  const history = useQuery({
    queryKey: ["/bills/history", selected?.connectionId],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(`/bills/history?connectionId=${selected!.connectionId}`),
    enabled: Boolean(selected?.connectionId),
  });
  const rows = list.data?.data ?? [];
  const hist = history.data?.data ?? [];
  const maxCons = Math.max(1, ...hist.map((h) => Number(h.consumptionM3 ?? 0)));
  const avg = hist.length ? hist.reduce((s, h) => s + Number(h.consumptionM3 ?? 0), 0) / hist.length : 0;

  async function openPdf(id: unknown) {
    const token = sessionStorage.getItem("aguateria.access");
    const res = await fetch(`/api/bills/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <>
      {embedded ? null : (
      <PageHeader
        title="Boletas mes"
        subtitle="Boleta de consumo o de crédito. No es comprobante tributario DNIT/SIFEN."
      />
      )}
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Año" />
        <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes">
          {Array.from({ length: 12 }, (_, i) => {
            const m = String(i + 1).padStart(2, "0");
            return (
              <option key={m} value={m}>
                {new Date(2000, i, 1).toLocaleString("es-PY", { month: "long" })}
              </option>
            );
          })}
        </Select>
        <Input placeholder="Cliente, conexión, medidor o código" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="secondary" onClick={() => void list.refetch()}>
          Filtrar
        </Button>
      </div>
      {list.isError ? <p className="mb-3 text-sm text-red-700">No se pudieron cargar las boletas.</p> : null}
      <Table headers={["Boleta", "Tipo", "Cliente", "Conexión", "Medidor", "Anterior", "Actual", "Consumo", "Total", "Estado", ""]}>
        {rows.map((row) => (
          <tr key={String(row.id)} className="border-t border-slate-100">
            <td className="whitespace-nowrap px-3 py-2">{String(row.number)}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.kind === "CREDITO" ? "Crédito" : "Consumo"}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.customerName ?? "—")}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.connectionCode ?? "—")}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.meterNumber ?? "—")}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.previousReading ?? "—")}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.currentReading ?? "—")}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.consumptionM3 != null ? `${row.consumptionM3} m³` : "—"}</td>
            <td className="whitespace-nowrap px-3 py-2">{formatGs(String(row.total ?? 0))}</td>
            <td className="whitespace-nowrap px-3 py-2">{String(row.status)}</td>
            <td className="whitespace-nowrap px-3 py-2">
              <div className="flex flex-wrap gap-1">
                <Button type="button" variant="ghost" className="px-2 py-1" onClick={() => setSelected(row)}>
                  Ver
                </Button>
                {row.kind !== "CREDITO" && can("boletas.emitir") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1"
                    onClick={() => {
                      setSelected(row);
                      setCreditError(null);
                      setCreditAmount(gsInteger(String(row.balance ?? row.total ?? "")));
                      setCreditReason("");
                      setCreditOpen(true);
                    }}
                  >
                    Boleta de crédito
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
        {!list.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={11}>
              Sin boletas en el período filtrado.
            </td>
          </tr>
        ) : null}
      </Table>
      {selected ? (
        <Modal title={`${selected.kind === "CREDITO" ? "Boleta de crédito" : "Boleta"} ${String(selected.number)}`} onClose={() => { setSelected(null); setCreditOpen(false); }}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Tipo</dt>
            <dd>{selected.kind === "CREDITO" ? "Crédito" : "Consumo"}</dd>
            <dt className="text-slate-500">Cliente</dt>
            <dd>{String(selected.customerName)}</dd>
            <dt className="text-slate-500">Documento / RUC</dt>
            <dd>{String(selected.customerDoc ?? "—")}</dd>
            <dt className="text-slate-500">Dirección</dt>
            <dd>{String(selected.customerAddress ?? selected.connectionAddress ?? "—")}</dd>
            <dt className="text-slate-500">Conexión</dt>
            <dd>
              {String(selected.connectionCode)} · {String(selected.connectionStatus ?? "")}
            </dd>
            <dt className="text-slate-500">Suministro</dt>
            <dd>{String(selected.accountNumber ?? "—")}</dd>
            <dt className="text-slate-500">Medidor</dt>
            <dd>{String(selected.meterNumber ?? "—")}</dd>
            <dt className="text-slate-500">Lectura anterior</dt>
            <dd>{String(selected.previousReading ?? "—")}</dd>
            <dt className="text-slate-500">Lectura actual</dt>
            <dd>
              {String(selected.currentReading ?? "—")}
              {selected.currentReadAt || selected.lastReadAt
                ? ` · ${new Date(String(selected.currentReadAt ?? selected.lastReadAt)).toLocaleDateString("es-PY")}`
                : ""}
            </dd>
            <dt className="text-slate-500">Consumo</dt>
            <dd>{selected.consumptionM3 != null ? `${selected.consumptionM3} m³` : "—"}</dd>
            <dt className="text-slate-500">Tarifa</dt>
            <dd>{String(selected.tariffName ?? "Según cálculo de período")}</dd>
            <dt className="text-slate-500">Cargo fijo</dt>
            <dd>{String(selected.fixedCharge ?? "—")}</dd>
            <dt className="text-slate-500">Importe consumo</dt>
            <dd>{String(selected.consumptionAmount ?? selected.subtotal)}</dd>
            <dt className="text-slate-500">IVA</dt>
            <dd>{String(selected.taxAmount)}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="font-semibold">{formatGs(String(selected.total ?? 0))}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd>{String(selected.status)}</dd>
          </dl>
          {hist.length > 0 ? (
            <div className="mt-4">
              <p className="font-medium">Historial de consumo</p>
              <p className="text-xs text-slate-500">Promedio {avg.toFixed(1)} m³</p>
              <div className="mt-2 flex h-28 items-end gap-1">
                {[...hist].reverse().map((h) => (
                  <div key={String(h.id)} className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-t bg-brand-800"
                      style={{ height: `${Math.max(8, (Number(h.consumptionM3 ?? 0) / maxCons) * 100)}%` }}
                      title={`${h.periodName}: ${h.consumptionM3} m³`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Anterior</th>
                      <th>Actual</th>
                      <th>Consumo</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hist.map((h) => (
                      <tr key={String(h.id)} className="border-t border-slate-100">
                        <td className="py-1">{String(h.periodName)}</td>
                        <td>{String(h.previousReading ?? "—")}</td>
                        <td>{String(h.currentReading ?? "—")}</td>
                        <td>{h.consumptionM3 != null ? `${h.consumptionM3} m³` : "—"}</td>
                        <td>{String(h.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {creditOpen ? (
            <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">Emitir boleta de crédito</p>
              <p className="text-xs text-slate-500">Acredita el saldo de esta boleta. No es nota de crédito SIFEN.</p>
              <Field label="Importe Gs.">
                <Input
                  inputMode="numeric"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value.replace(/[^\d]/g, ""))}
                />
              </Field>
              <Field label="Motivo">
                <Input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
              </Field>
              {creditError ? <p className="text-sm text-red-700">{creditError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setCreditOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  disabled={creditPending || !creditAmount}
                  onClick={async () => {
                    setCreditPending(true);
                    setCreditError(null);
                    try {
                      const created = await api<{ data: { id: string; number: string } }>(`/bills/${selected.id}/credit`, {
                        method: "POST",
                        body: JSON.stringify({ amount: creditAmount, reason: creditReason || undefined }),
                      });
                      setCreditOpen(false);
                      setSelected(null);
                      await refreshNow(qc, ["/bills"], ["/notifications"]);
                      await openPdf(created.data.id);
                    } catch (err) {
                      setCreditError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo emitir el crédito");
                    } finally {
                      setCreditPending(false);
                    }
                  }}
                >
                  {creditPending ? "Emitiendo…" : "Emitir crédito"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {selected.kind !== "CREDITO" && can("boletas.emitir") && !creditOpen ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreditError(null);
                  setCreditAmount(gsInteger(String(selected.balance ?? selected.total ?? "")));
                  setCreditReason("");
                  setCreditOpen(true);
                }}
              >
                Boleta de crédito
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void openPdf(selected.id)}>
              PDF
            </Button>
            <Button type="button" onClick={() => { setSelected(null); setCreditOpen(false); }}>
              Cerrar
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function InvoicesPage({ embedded }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  return (
    <ResourcePage
      title="Comprobantes tributarios"
      subtitle="La aceptación SIFEN solo aparece si la DNIT respondió. Sin certificado el estado es NO_CONFIGURADO."
      hideHeader={embedded}
      path="/invoices"
      createPermission="facturas.crear"
      columns={[
        { key: "customerName", label: "Cliente", format: (row) => `${row.customerCode ?? ""} · ${row.customerName ?? ""}`.trim() },
        {
          key: "documentType",
          label: "Tipo",
          format: (row) =>
            String(row.documentType) === "NOTA_CREDITO_ELECTRONICA"
              ? "Nota de crédito"
              : String(row.documentType) === "NOTA_DEBITO_ELECTRONICA"
                ? "Nota de débito"
                : "Factura",
        },
        { key: "statusLabel", label: "Estado", format: (row) => String(row.statusLabel ?? (row.businessStatus === "BORRADOR" ? "Pendiente" : row.businessStatus)) },
        { key: "fiscalNumberFormatted", label: "Número fiscal", format: (row) => String(row.fiscalNumberFormatted || "Pendiente de timbrado") },
        { key: "sifenStatus", label: "SIFEN" },
        { key: "total", label: "Total Gs.", format: (row) => formatGs(String(row.total ?? 0)) },
      ]}
      fields={[
        { key: "customerId", label: "Cliente", required: true, optionsPath: "/customers", optionLabel: ["code", "lastName", "firstName"] },
        {
          key: "documentType",
          label: "Tipo de documento",
          type: "select",
          options: [
            { value: "FACTURA_ELECTRONICA", label: "Factura electrónica" },
            { value: "NOTA_CREDITO_ELECTRONICA", label: "Nota de crédito electrónica" },
          ],
          defaultValue: "FACTURA_ELECTRONICA",
        },
        { key: "waterBillId", label: "Boleta (opcional)", optionsPath: "/bills", optionLabel: "number" },
        { key: "description", label: "Concepto", required: true },
        { key: "quantity", label: "Cantidad", required: true, type: "number" },
        { key: "unitAmount", label: "Precio unitario Gs.", required: true, type: "number" },
      ]}
      transformPayload={(p) => {
        const qty = Number(p.quantity);
        const unit = Number(p.unitAmount);
        const line = Number.isFinite(qty * unit) ? (qty * unit).toFixed(2) : "0.00";
        return {
          customerId: p.customerId,
          documentType: p.documentType || "FACTURA_ELECTRONICA",
          waterBillId: p.waterBillId,
          items: [
            {
              description: p.description,
              quantity: p.quantity,
              unitAmount: p.unitAmount,
              taxAmount: "0",
              total: line,
            },
          ],
          subtotal: line,
          taxAmount: "0",
          total: line,
        };
      }}
      rowActions={[
        {
          label: "PDF",
          permission: "facturas.ver",
          run: (row) => openAuthenticatedPdf(`/invoices/${row.id}/pdf`),
        },
        {
          label: "Emitir",
          permission: "facturas.emitir",
          run: async (row) => {
            await api(`/invoices/${row.id}/issue`, { method: "POST" });
            await refreshNow(qc, ["/invoices"], ["/notifications"]);
          },
        },
        {
          label: "Enviar SIFEN",
          permission: "sifen.enviar",
          run: async (row) => {
            await api(`/invoices/${row.id}/send-sifen`, { method: "POST" });
            await refreshNow(qc, ["/invoices"], ["/notifications"]);
          },
        },
        {
          label: "Nota de crédito",
          permission: "facturas.anular",
          run: async (row) => {
            if (String(row.documentType) === "NOTA_CREDITO_ELECTRONICA") {
              throw new Error("Esta fila ya es una nota de crédito");
            }
            const reason = window.prompt("Motivo de la nota de crédito", "Ajuste de facturación") ?? "";
            if (!reason.trim()) return;
            await api("/credit-notes", {
              method: "POST",
              body: JSON.stringify({
                invoiceId: row.id,
                reason: reason.trim(),
                total: String(row.total ?? "0"),
              }),
            });
            await refreshNow(qc, ["/invoices"], ["/notifications"]);
          },
        },
      ]}
    />
  );
}

export function PeriodsPage() {
  const qc = useQueryClient();
  return (
    <ResourcePage
      title="Periodos de facturación"
      path="/billing-periods"
      createPermission="periodos.crear"
      fields={[
        { key: "code", label: "Código", required: true },
        { key: "name", label: "Nombre", required: true },
        { key: "startsOn", label: "Desde", type: "date", required: true },
        { key: "endsOn", label: "Hasta", type: "date", required: true },
        { key: "dueOn", label: "Vencimiento", type: "date" },
      ]}
      columns={[
        { key: "code", label: "Código" },
        { key: "name", label: "Nombre" },
        { key: "startsOn", label: "Desde" },
        { key: "endsOn", label: "Hasta" },
        { key: "status", label: "Estado" },
      ]}
      rowActions={[
        {
          label: "Calcular",
          permission: "periodos.editar",
          run: async (row) => {
            await api(`/billing-periods/${row.id}/calculate`, { method: "POST" });
            await refreshNow(qc, ["/billing-periods"], ["/notifications"]);
          },
        },
        {
          label: "Generar boletas",
          permission: "boletas.emitir",
          run: async (row) => {
            await api(`/billing-periods/${row.id}/generate-bills`, { method: "POST" });
          },
        },
        {
          label: "Cerrar",
          permission: "periodos.editar",
          variant: "danger",
          run: async (row) => {
            await api(`/billing-periods/${row.id}/transition`, {
              method: "POST",
              body: JSON.stringify({ status: "CERRADO" }),
            });
            await refreshNow(qc, ["/billing-periods"], ["/notifications"]);
          },
        },
      ]}
    />
  );
}

export function PaymentsPage() {
  const qc = useQueryClient();
  return (
    <ResourcePage
      title="Pagos"
      subtitle="Comprobante de caja (PDF). Anular restaura saldo y boletas. No es factura SIFEN."
      path="/payments"
      createPermission="pagos.crear"
      columns={[
        { key: "amount", label: "Importe" },
        { key: "paidOn", label: "Fecha" },
        { key: "referenceNote", label: "Referencia" },
        { key: "reversedAt", label: "Anulado" },
      ]}
      fields={[
        { key: "customerId", label: "Cliente", required: true, optionsPath: "/customers", optionLabel: ["code", "lastName", "firstName"] },
        { key: "methodId", label: "Método", required: true, optionsPath: "/payment-methods", optionLabel: "name" },
        { key: "amount", label: "Importe Gs.", required: true, type: "number" },
        { key: "paidOn", label: "Fecha", type: "date", required: true },
        { key: "waterBillId", label: "Boleta (opcional)", optionsPath: "/bills", optionLabel: "number" },
        { key: "referenceNote", label: "Referencia" },
      ]}
      transformPayload={(p) => ({ ...p, idempotencyKey: crypto.randomUUID() })}
      rowActions={[
        {
          label: "Comprobante",
          permission: "pagos.ver",
          run: (row) => openAuthenticatedPdf(`/payments/${row.id}/pdf`),
        },
        {
          label: "Anular",
          permission: "pagos.anular",
          variant: "danger",
          run: async (row) => {
            if (row.reversedAt) return;
            await api(`/payments/${row.id}/reverse`, { method: "POST" });
            await refreshNow(qc, ["/payments"], ["/invoices"], ["/notifications"]);
          },
        },
      ]}
    />
  );
}
