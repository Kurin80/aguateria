import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Card, PageHeader } from "../components/ui";

export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<{ data: Record<string, string | null> }>(`/customers/${id}`),
    enabled: Boolean(id),
  });
  const connections = useQuery({
    queryKey: ["customer-connections", id],
    queryFn: () => api<{ data: Array<Record<string, string | null>> }>(`/connections?customerId=${id}&pageSize=50`),
    enabled: Boolean(id),
  });
  const readings = useQuery({
    queryKey: ["customer-readings", id],
    queryFn: () => api<{ data: Array<Record<string, string | null>> }>(`/readings?customerId=${id}&pageSize=20`),
    enabled: Boolean(id),
  });
  const account = useQuery({
    queryKey: ["account", id],
    queryFn: () =>
      api<{
        data: {
          account: Record<string, string> | null;
          movements: Array<Record<string, string>>;
          bills: Array<Record<string, string>>;
          payments: Array<Record<string, string>>;
        };
      }>(`/accounts/${id}`),
    enabled: Boolean(id),
  });
  const c = customer.data?.data;
  const name = c?.legalName || [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.code;

  return (
    <>
      <PageHeader title={name ?? "Cliente"} subtitle="Ficha, cuenta corriente y documentos" />
      <p className="mb-4">
        <Link className="text-sm text-brand-800 underline" to="/clientes">
          ← Volver a clientes
        </Link>
      </p>
      {customer.isError ? <p className="text-red-700">No se encontró el cliente.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Datos</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Código</dt>
            <dd>{c?.code}</dd>
            <dt className="text-slate-500">
              {c?.idDocumentType === "PASAPORTE" ? "Pasaporte" : c?.idDocumentType === "RUC" ? "RUC" : "CI"}
            </dt>
            <dd>
              {c?.idDocumentType === "RUC"
                ? c?.ruc
                  ? `${c.ruc}${c.dv ? `-${c.dv}` : ""}`
                  : (c?.ci ?? "—")
                : (c?.ci ?? "—")}
            </dd>
            {c?.legalName ? (
              <>
                <dt className="text-slate-500">Razón social</dt>
                <dd>{c.legalName}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Celular</dt>
            <dd>{c?.mobile ?? "—"}</dd>
            <dt className="text-slate-500">Departamento</dt>
            <dd>{c?.department ?? "—"}</dd>
            <dt className="text-slate-500">Ciudad</dt>
            <dd>{c?.city ?? "—"}</dd>
            <dt className="text-slate-500">Barrio</dt>
            <dd>{c?.neighborhood ?? "—"}</dd>
            <dt className="text-slate-500">Dirección</dt>
            <dd className="col-span-1">{c?.address ?? "—"}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd>
              <Badge tone={c?.status === "ACTIVO" ? "ok" : "neutral"}>
                {c?.status === "INACTIVO" || c?.status === "INOPERATIVO" ? "Inoperativo" : c?.status}
              </Badge>
            </dd>
          </dl>
        </Card>
        <Card>
          <h2 className="font-semibold">Cuenta corriente</h2>
          <p className="mt-2 text-2xl font-semibold">Gs. {account.data?.data.account?.balance ?? "0.00"}</p>
          <p className="text-sm text-slate-600">Estado: {account.data?.data.account?.status ?? "—"}</p>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-semibold">Suministros</h2>
          <ul className="mt-2 text-sm">
            {(connections.data?.data ?? []).map((row) => (
              <li key={row.id ?? row.code} className="flex justify-between border-b border-slate-100 py-2">
                <span>{row.code} · {row.accountNumber} · medidor {row.meterNumber ?? "—"}</span>
                <span>{row.status} · {row.address ?? "—"}</span>
              </li>
            ))}
            {(connections.data?.data ?? []).length === 0 ? <li className="text-slate-500">Sin conexiones.</li> : null}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-semibold">Lecturas</h2>
          <ul className="mt-2 text-sm">
            {(readings.data?.data ?? []).map((r) => (
              <li key={r.id} className="flex justify-between border-b border-slate-100 py-2">
                <span>{r.previousReading} → {r.currentReading}</span>
                <span>{r.consumptionM3} m³</span>
              </li>
            ))}
            {(readings.data?.data ?? []).length === 0 ? <li className="text-slate-500">Sin lecturas.</li> : null}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-semibold">Boletas</h2>
          <ul className="mt-2 text-sm">
            {(account.data?.data.bills ?? []).map((b) => (
              <li key={b.id} className="flex justify-between border-b border-slate-100 py-2">
                <span>{b.number}</span>
                <span>
                  Gs. {b.total} · saldo {b.balance}
                </span>
              </li>
            ))}
            {(account.data?.data.bills ?? []).length === 0 ? <li className="text-slate-500">Sin boletas.</li> : null}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-semibold">Pagos</h2>
          <ul className="mt-2 text-sm">
            {(account.data?.data.payments ?? []).map((p) => (
              <li key={p.id} className="flex justify-between border-b border-slate-100 py-2">
                <span>{p.paidOn}</span>
                <span>Gs. {p.amount}</span>
              </li>
            ))}
            {(account.data?.data.payments ?? []).length === 0 ? <li className="text-slate-500">Sin pagos.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}
