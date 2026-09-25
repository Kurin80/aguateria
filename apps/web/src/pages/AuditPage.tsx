import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Badge, Button, Field, Input, PageHeader, Select, Table, cn } from "../components/ui";

type AuditRow = {
  id: string;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
};
type AuditResponse = { data: AuditRow[]; meta: { page: number; pageSize: number; total: number } };
type Filters = { users: Array<{ id: string; fullName: string; email: string }>; modules: string[] };
type Kind = "" | "ingresos" | "acciones";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Ingreso al sistema",
  LOGOUT: "Cierre de sesión",
  LOGIN_FAILED: "Intento de ingreso fallido",
  PASSWORD_RESET_SOLICITADO: "Solicitó recuperar contraseña",
  PASSWORD_RESET_OK: "Cambió la contraseña",
  USUARIO_CREADO: "Creó un usuario",
  USUARIO_MODIFICADO: "Modificó un usuario",
  USUARIO_ELIMINADO: "Eliminó un usuario",
  PAGO_REGISTRADO: "Registró un pago",
  PAGO_ANULADO: "Anuló un pago",
  LECTURA_INICIADA: "Inició una lectura",
  LECTURA_REGISTRADA: "Registró una lectura",
  LECTURA_MODIFICADA: "Modificó una lectura",
  INSTALACION_REGISTRADA: "Registró una instalación",
  CONEXION_CREADA: "Creó una conexión",
  FACTURA_EMITIDA: "Emitió una factura",
  NOTA_CREDITO: "Emitió nota de crédito",
  NOTA_DEBITO: "Emitió nota de débito",
  BOLETA_CREDITO: "Emitió boleta de crédito",
  DESCONEXION_AUTORIZADA: "Autorizó una desconexión",
  DESCONEXION_EJECUTADA: "Ejecutó una desconexión",
  MORA_ESCANEADA: "Revisó la morosidad",
  TARIFA_MODIFICADA: "Modificó una tarifa",
  TIMBRADO_MODIFICADO: "Modificó el timbrado",
  PERIODO_REABIERTO: "Reabrió un período",
  RECORRIDO_INICIADO: "Inició un recorrido",
  RECORRIDO_FINALIZADO: "Finalizó un recorrido",
};

const ENTITY_LABELS: Record<string, string> = {
  collection_route: "Recorrido",
  connection: "Conexión",
  connections: "Conexión",
  connection_installation: "Instalación",
  meter_readings: "Lectura",
  payment: "Pago",
  suspension: "Suspensión",
  users: "Usuario",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, " ");
}

const dateFmt = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Resumen legible del navegador/dispositivo, p. ej. "Chrome · Android". */
function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" · ") || null;
}

function actionTone(action: string): "neutral" | "ok" | "warn" | "bad" {
  if (action === "LOGIN") return "ok";
  if (action === "LOGOUT") return "neutral";
  if (action === "LOGIN_FAILED" || action.endsWith("_ANULADO") || action.endsWith("_ELIMINADO")) return "bad";
  return "warn";
}

export function AuditPage() {
  const [kind, setKind] = useState<Kind>("");
  const [userId, setUserId] = useState("");
  const [module, setModule] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [kind, userId, module, from, to, q]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (kind) params.set("kind", kind);
  if (userId) params.set("userId", userId);
  if (module) params.set("module", module);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();

  const logs = useQuery({
    queryKey: ["/audit-logs", qs],
    queryFn: () => api<AuditResponse>(`/audit-logs?${qs}`),
    refetchInterval: 15_000,
  });
  const filters = useQuery({
    queryKey: ["/audit-logs/filters"],
    queryFn: () => api<{ data: Filters }>("/audit-logs/filters"),
  });

  const rows = logs.data?.data ?? [];
  const total = logs.data?.meta.total ?? 0;
  const firstRow = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(page * PAGE_SIZE, total);
  const hasFilters = Boolean(kind || userId || module || from || to || q);

  const clear = () => {
    setKind("");
    setUserId("");
    setModule("");
    setFrom("");
    setTo("");
    setQ("");
  };

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Quién ingresó al sistema y qué hizo, con fecha y hora de Paraguay." />

      <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(
          [
            ["", "Todo"],
            ["ingresos", "Ingresos y salidas"],
            ["acciones", "Acciones"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={cn("rounded-md px-3 py-1.5", kind === value ? "bg-brand-900 text-white" : "text-slate-600 hover:bg-slate-100")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Usuario">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos</option>
            {(filters.data?.data.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Módulo">
          <Select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Todos</option>
            {(filters.data?.data.modules ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Buscar">
          <Input placeholder="Usuario, acción…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>

      {logs.isError ? <p className="mb-3 text-sm text-red-700">Error al cargar la auditoría.</p> : null}

      <Table headers={["Fecha", "Hora", "Usuario", "Acción", "Módulo", "Detalle"]}>
        {rows.map((row) => {
          const when = new Date(row.createdAt);
          const device = deviceLabel(row.userAgent);
          const detail = [row.entityType ? (ENTITY_LABELS[row.entityType] ?? row.entityType) : null, device, row.ip ? `IP ${row.ip}` : null].filter(Boolean).join(" · ");
          return (
            <tr key={row.id} className={cn("border-t border-slate-100", row.action === "LOGIN" && "bg-emerald-50/50")}>
              <td className="whitespace-nowrap px-3 py-2">{dateFmt.format(when)}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{timeFmt.format(when)}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {row.userName ? (
                  <>
                    <p className="font-medium">{row.userName}</p>
                    <p className="text-xs text-slate-500">{row.userEmail}</p>
                  </>
                ) : (
                  <span className="text-slate-400">Sistema</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge>
              </td>
              <td className="whitespace-nowrap px-3 py-2 capitalize">{row.module}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{detail || "—"}</td>
            </tr>
          );
        })}
        {!logs.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={6}>
              {hasFilters ? "No hay registros con estos filtros." : "Sin registros de auditoría."}
            </td>
          </tr>
        ) : null}
      </Table>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>{total ? `Mostrando ${firstRow}–${lastRow} de ${total}` : ""}</span>
        <div className="flex items-center gap-2">
          {hasFilters ? (
            <Button type="button" variant="ghost" onClick={clear}>
              Limpiar filtros
            </Button>
          ) : null}
          <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button type="button" variant="secondary" disabled={lastRow >= total} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      </div>
    </>
  );
}
