import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatGs, gsInteger } from "../lib/money";
import { openAuthenticatedPdf } from "../lib/pdf";
import { refreshNow } from "../lib/refresh";

type Bill = {
  id: string;
  number: string;
  customerName?: string;
  connectionCode?: string;
  total?: string;
  balance?: string;
  kind?: string;
};

type Invoice = {
  id: string;
  customerName?: string;
  customerCode?: string;
  documentType?: string;
  fiscalNumberFormatted?: string;
  total?: string;
  businessStatus?: string;
};

export function CreditsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canBill = can("boletas.emitir");
  const canNote = can("facturas.anular");

  const [billId, setBillId] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billReason, setBillReason] = useState("");
  const [billError, setBillError] = useState<string | null>(null);
  const [billPending, setBillPending] = useState(false);

  const [invoiceId, setInvoiceId] = useState("");
  const [noteAmount, setNoteAmount] = useState("");
  const [noteReason, setNoteReason] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [notePending, setNotePending] = useState(false);

  const bills = useQuery({
    queryKey: ["/bills", "credit-sources"],
    queryFn: () => api<{ data: Bill[] }>("/bills?pageSize=100&withBalance=1"),
    enabled: canBill,
  });
  const invoices = useQuery({
    queryKey: ["/invoices"],
    queryFn: () => api<{ data: Invoice[] }>("/invoices"),
    enabled: canNote,
  });

  const billOptions = (bills.data?.data ?? []).filter((b) => b.kind !== "CREDITO" && Number(b.balance) > 0);
  const invoiceOptions = (invoices.data?.data ?? []).filter((i) => i.documentType !== "NOTA_CREDITO_ELECTRONICA");
  const selectedBill = billOptions.find((b) => b.id === billId);
  const selectedInvoice = invoiceOptions.find((i) => i.id === invoiceId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">Boleta de crédito</h2>
        <p className="mt-1 text-sm text-slate-600">
          Acredita el saldo de una boleta de consumo. Es un documento operativo de caja, no un DTE SIFEN.
        </p>
        {canBill ? (
          <div className="mt-4 grid gap-3">
            <Field label="Boleta con saldo">
              <Select
                value={billId}
                onChange={(e) => {
                  const next = e.target.value;
                  setBillId(next);
                  const row = billOptions.find((b) => b.id === next);
                  setBillAmount(row ? gsInteger(String(row.balance ?? row.total ?? "")) : "");
                  setBillError(null);
                }}
              >
                <option value="">Seleccionar boleta…</option>
                {billOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.number} · {b.customerName ?? ""} · saldo {formatGs(b.balance ?? 0)}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedBill ? (
              <p className="text-xs text-slate-500">
                {selectedBill.connectionCode ?? ""} · total {formatGs(selectedBill.total ?? 0)}
              </p>
            ) : null}
            <Field label="Importe Gs.">
              <Input
                inputMode="numeric"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field label="Motivo">
              <Input value={billReason} onChange={(e) => setBillReason(e.target.value)} placeholder="Error de lectura, ajuste, etc." />
            </Field>
            {billError ? <p className="text-sm text-red-700">{billError}</p> : null}
            {!bills.isLoading && billOptions.length === 0 ? (
              <p className="text-sm text-slate-500">No hay boletas de consumo con saldo para acreditar.</p>
            ) : null}
            <Button
              type="button"
              disabled={billPending || !billId || !billAmount}
              onClick={async () => {
                setBillPending(true);
                setBillError(null);
                try {
                  const created = await api<{ data: { id: string } }>(`/bills/${billId}/credit`, {
                    method: "POST",
                    body: JSON.stringify({ amount: billAmount, reason: billReason || undefined }),
                  });
                  setBillId("");
                  setBillAmount("");
                  setBillReason("");
                  await refreshNow(qc, ["/bills"], ["/invoices"], ["/notifications"]);
                  await openAuthenticatedPdf(`/bills/${created.data.id}/pdf`);
                } catch (err) {
                  setBillError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo emitir la boleta de crédito");
                } finally {
                  setBillPending(false);
                }
              }}
            >
              {billPending ? "Emitiendo…" : "Emitir boleta de crédito"}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-amber-800">Tu perfil no tiene permiso para emitir boletas de crédito.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Nota de crédito</h2>
        <p className="mt-1 text-sm text-slate-600">
          Documento tributario vinculado a una factura. Queda en borrador hasta emitir y enviar a SIFEN.
        </p>
        {canNote ? (
          <div className="mt-4 grid gap-3">
            <Field label="Factura origen">
              <Select
                value={invoiceId}
                onChange={(e) => {
                  const next = e.target.value;
                  setInvoiceId(next);
                  const row = invoiceOptions.find((i) => i.id === next);
                  setNoteAmount(row ? gsInteger(String(row.total ?? "")) : "");
                  setNoteError(null);
                }}
              >
                <option value="">Seleccionar factura…</option>
                {invoiceOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.fiscalNumberFormatted || "Sin timbrar"} · {i.customerName ?? i.customerCode ?? ""} · {formatGs(i.total ?? 0)}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedInvoice ? (
              <p className="text-xs text-slate-500">Estado: {selectedInvoice.businessStatus ?? "—"}</p>
            ) : null}
            <Field label="Importe Gs.">
              <Input
                inputMode="numeric"
                value={noteAmount}
                onChange={(e) => setNoteAmount(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field label="Motivo">
              <Input value={noteReason} onChange={(e) => setNoteReason(e.target.value)} placeholder="Anulación, descuento, error de facturación…" />
            </Field>
            {noteError ? <p className="text-sm text-red-700">{noteError}</p> : null}
            {!invoices.isLoading && invoiceOptions.length === 0 ? (
              <p className="text-sm text-slate-500">No hay facturas para asociar una nota de crédito.</p>
            ) : null}
            <Button
              type="button"
              disabled={notePending || !invoiceId || !noteAmount || !noteReason.trim()}
              onClick={async () => {
                setNotePending(true);
                setNoteError(null);
                try {
                  await api("/credit-notes", {
                    method: "POST",
                    body: JSON.stringify({ invoiceId, reason: noteReason.trim(), total: noteAmount }),
                  });
                  setInvoiceId("");
                  setNoteAmount("");
                  setNoteReason("");
                  await refreshNow(qc, ["/invoices"], ["/notifications"]);
                } catch (err) {
                  setNoteError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo emitir la nota de crédito");
                } finally {
                  setNotePending(false);
                }
              }}
            >
              {notePending ? "Emitiendo…" : "Emitir nota de crédito"}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-amber-800">Tu perfil no tiene permiso para emitir notas de crédito.</p>
        )}
      </Card>
    </div>
  );
}
