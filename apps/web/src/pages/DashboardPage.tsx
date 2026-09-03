import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Card, PageHeader } from "../components/ui";
import { fieldHomePath } from "../layout/nav";
import { formatGs } from "../lib/money";

type Dash = Record<string, string | number>;

function num(data: Dash, key: string): string {
  const v = data[key];
  if (Array.isArray(v) || v == null) return "0";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  const decimals = Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function gs(data: Dash, key: string): string {
  return formatGs(data[key] ?? 0);
}

export function HomePage() {
  const { user } = useAuth();
  const home = fieldHomePath(user?.roles);
  if (home) return <Navigate to={home} replace />;
  return <DashboardPage />;
}

export function DashboardPage() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{ data: Dash }>("/dashboard"),
    refetchInterval: 8_000,
  });
  const data = q.data?.data ?? {};
  const prev = Number(data.consumption_prev_month ?? 0);
  const curr = Number(data.consumption_month ?? 0);
  const variation = prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : null;

  const groups: Array<{ title: string; items: Array<{ key: string; label: string; money?: boolean }> }> = [
    {
      title: "Clientes",
      items: [
        { key: "customers_total", label: "Total" },
        { key: "customers", label: "Activos" },
        { key: "customers_inactive", label: "Suspendidos / inactivos" },
        { key: "customers_disconnected", label: "Desconectados" },
        { key: "customers_new", label: "Nuevos del mes" },
      ],
    },
    {
      title: "Conexiones",
      items: [
        { key: "connections_total", label: "Total" },
        { key: "connections", label: "Activas" },
        { key: "connections_pending", label: "Pendientes" },
        { key: "connections_suspended", label: "Suspendidas" },
        { key: "connections_disconnected", label: "Desconectadas" },
        { key: "connections_without_meter", label: "Sin medidor" },
        { key: "installations_pending", label: "Instalaciones pendientes" },
      ],
    },
    {
      title: "Medidores",
      items: [
        { key: "meters_total", label: "Total" },
        { key: "meters_active", label: "Activos" },
        { key: "meters_incident", label: "Con incidencias" },
        { key: "field_pending", label: "Pendientes de lectura" },
      ],
    },
    {
      title: "Lecturas",
      items: [
        { key: "readings_done", label: "Del período" },
        { key: "field_pending", label: "Pendientes" },
        { key: "field_done_today", label: "Realizadas hoy" },
        { key: "field_observed", label: "Observadas" },
        { key: "readings_anomalous", label: "Con anomalía" },
      ],
    },
    {
      title: "Consumo",
      items: [
        { key: "consumption_month", label: "Total del período (m³)" },
        { key: "consumption_avg", label: "Promedio (m³)" },
        { key: "consumption_prev_month", label: "Período anterior (m³)" },
      ],
    },
    {
      title: "Boletas",
      items: [
        { key: "bills_issued", label: "Emitidas" },
        { key: "bills_pending", label: "Pendientes" },
        { key: "bills_partial", label: "Parciales" },
        { key: "bills_overdue", label: "Vencidas" },
        { key: "bills_paid", label: "Pagadas" },
        { key: "billed_month", label: "Total facturado (Gs.)", money: true },
        { key: "collected_month", label: "Total cobrado (Gs.)", money: true },
      ],
    },
    {
      title: "Morosidad y cortes",
      items: [
        { key: "delinquent", label: "Cuentas morosas" },
        { key: "outstanding", label: "Saldo pendiente (Gs.)", money: true },
        { key: "disconnect_scheduled", label: "Desconexiones programadas" },
        { key: "suspensions", label: "Cortes del mes" },
        { key: "reconnections", label: "Reconexiones del mes" },
      ],
    },
  ];

  return (
    <>
      <PageHeader
        title="Panel principal"
        subtitle="Indicadores reales del período en curso"
        actions={
          user?.permissions.includes("lecturas.crear") ? (
            <Link className="text-sm text-brand-800 underline" to="/campo">
              Ir a lectura de campo
            </Link>
          ) : user?.permissions.includes("cobranza.ver") ? (
            <Link className="text-sm text-brand-800 underline" to="/cobranza">
              Ir a cobranza
            </Link>
          ) : null
        }
      />
      {q.isError ? <p className="text-red-700">No se pudo cargar el tablero.</p> : null}
      {variation ? (
        <p className="mb-4 text-sm text-slate-600">
          Consumo vs. período anterior: <strong>{Number(variation) > 0 ? "+" : ""}{variation}%</strong>
        </p>
      ) : null}
      <div className="grid gap-6">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{group.title}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {group.items.map((card) => (
                <Card key={`${group.title}-${card.key}`} className="min-w-0 overflow-hidden">
                  <p className="truncate text-sm text-slate-600">{card.label}</p>
                  <p className="mt-2 break-words text-xl font-semibold leading-tight text-brand-900 sm:text-2xl">
                    {q.isLoading ? "…" : card.money ? gs(data, card.key) : num(data, card.key)}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
