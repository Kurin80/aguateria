import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { Button, Field, Input, PageHeader, Select, Table } from "../components/ui";
import { DEPARTMENT_OPTIONS } from "../lib/paraguay-geo";

const REPORTS = [
  ["customers", "Clientes", ["status", "department", "city", "q"]],
  ["connections", "Conexiones", ["status", "q"]],
  ["meters", "Medidores", ["status", "q"]],
  ["installations", "Instalaciones", ["status"]],
  ["readings", "Lecturas", ["status"]],
  ["anomalies", "Anomalías de lectura", []],
  ["productivity", "Productividad del lectorista", []],
  ["billing", "Boletas", ["status", "q"]],
  ["payments", "Pagos", ["q"]],
  ["delinquency", "Morosidad", []],
  ["disconnections", "Desconexiones", ["status"]],
  ["collection-routes", "Recorridos de cobradores", ["status"]],
  ["collector-productivity", "Productividad de cobradores", []],
  ["claims", "Reclamos", ["status", "q"]],
] as const;

type Extra = "status" | "department" | "city" | "q";

function queryString(params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v.trim()) qs.set(k, v.trim());
  }
  return qs.toString();
}

export function ReportsPage() {
  const [type, setType] = useState("customers");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [city, setCity] = useState("");
  const extras = useMemo(() => (REPORTS.find((r) => r[0] === type)?.[2] ?? []) as readonly Extra[], [type]);

  const params = useMemo(() => {
    const p: Record<string, string> = { from, to };
    if (extras.includes("q")) p.q = q;
    if (extras.includes("status")) p.status = status;
    if (extras.includes("department")) p.department = department;
    if (extras.includes("city")) p.city = city;
    return p;
  }, [from, to, q, status, department, city, extras]);

  const preview = useQuery({
    queryKey: ["report", type, params],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(`/reports/${type}?${queryString(params)}`),
  });
  const rows = preview.data?.data ?? [];
  const headers = rows[0] ? Object.keys(rows[0]).slice(0, 8) : [];

  async function downloadCsv() {
    const res = await fetch(`/api/reports/${type}?format=csv&${queryString(params)}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("aguateria.access") ?? ""}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Reportes" subtitle="Filtrá por fechas y datos relevantes antes de exportar." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Reporte">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setStatus("");
              setQ("");
            }}
          >
            {REPORTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha inicio">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Fecha fin">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {extras.includes("q") ? (
          <Field label="Búsqueda">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, documento…" />
          </Field>
        ) : null}
        {extras.includes("status") ? (
          <Field label="Estado">
            {type === "customers" ? (
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="ACTIVO">Activo</option>
                <option value="INOPERATIVO">Inoperativo</option>
              </Select>
            ) : (
              <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Estado" />
            )}
          </Field>
        ) : null}
        {extras.includes("department") ? (
          <Field label="Departamento">
            <Select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setCity("");
              }}
            >
              <option value="">Todos</option>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {extras.includes("city") ? (
          <Field label="Ciudad">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ciudad" />
          </Field>
        ) : null}
      </div>
      <div className="mb-4 flex gap-2">
        <Button type="button" variant="secondary" onClick={() => void preview.refetch()}>
          Aplicar filtros
        </Button>
        <Button type="button" onClick={() => void downloadCsv()}>
          Descargar CSV
        </Button>
      </div>
      {preview.isError ? <p className="mb-3 text-sm text-red-700">No se pudo cargar el reporte.</p> : null}
      <Table headers={headers.length ? headers : ["Resultado"]}>
        {rows.slice(0, 50).map((row, i) => (
          <tr key={String(row.id ?? i)} className="border-t border-slate-100">
            {(headers.length ? headers : ["_"]).map((h) => (
              <td key={h} className="whitespace-nowrap px-3 py-2">
                {h === "_" ? "Sin filas" : String(row[h] ?? "—")}
              </td>
            ))}
          </tr>
        ))}
        {!preview.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={Math.max(headers.length, 1)}>
              Sin datos para el filtro indicado.
            </td>
          </tr>
        ) : null}
      </Table>
      {rows.length > 50 ? <p className="mt-2 text-sm text-slate-600">Vista previa: 50 de {rows.length} filas. El CSV incluye todo.</p> : null}
    </>
  );
}
