import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Field, Input, Modal, PageHeader, Select, Table, Textarea } from "../components/ui";
import { captureGps } from "../lib/field-capture";
import { CITY_OPTIONS_BY_DEPARTMENT, DEPARTMENT_OPTIONS } from "../lib/paraguay-geo";
import { formatRuc } from "@aguateria/shared";
import { refreshNow } from "../lib/refresh";

type Customer = {
  id: string;
  code: string;
  firstName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
  ci?: string | null;
  idDocumentType?: string | null;
  ruc?: string | null;
  dv?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  department?: string | null;
  neighborhood?: string | null;
  status?: string | null;
};

type Connection = {
  id: string;
  code: string;
  accountNumber: string;
  address?: string | null;
  status: string;
  customerId: string;
  customerName?: string | null;
  customerCode?: string | null;
  meterNumber?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

function customerLabel(c: Customer): string {
  return [c.code, c.legalName || [c.lastName, c.firstName].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

export function ConnectionsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["/connections", q],
    queryFn: () => api<{ data: Connection[] }>(`/connections?pageSize=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`),
    refetchInterval: 8_000,
  });
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Conexiones"
        subtitle="El código se genera automáticamente (CON-######). El medidor se carga después en Instalaciones."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void list.refetch();
              }}
            >
              <Input placeholder="Cliente, código, medidor…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button type="submit" variant="secondary">
                Buscar
              </Button>
            </form>
            {can("conexiones.crear") ? (
              <Button
                type="button"
                onClick={() => {
                  setError(null);
                  setOpen(true);
                }}
              >
                Nueva conexión
              </Button>
            ) : null}
          </div>
        }
      />
      {list.isError ? <p className="mb-3 text-sm text-red-700">Error al cargar.</p> : null}
      <Table headers={["Código", "Cliente", "Suministro", "Medidor", "Dirección", "Estado"]}>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-slate-100">
            <td className="whitespace-nowrap px-3 py-2 font-medium">{row.code}</td>
            <td className="whitespace-nowrap px-3 py-2">
              {row.customerCode} · {row.customerName}
            </td>
            <td className="whitespace-nowrap px-3 py-2">{row.accountNumber}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.meterNumber ?? "—"}</td>
            <td className="px-3 py-2">{row.address ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.status}</td>
          </tr>
        ))}
        {list.isFetching && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={6}>
              Actualizando…
            </td>
          </tr>
        ) : !list.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={6}>
              Sin registros.
            </td>
          </tr>
        ) : null}
      </Table>
      {open ? (
        <ConnectionCreateForm
          error={error}
          onClose={() => setOpen(false)}
          onError={setError}
          onCreated={() => {
            setOpen(false);
            void refreshNow(qc, ["/connections"], ["installations"], ["/notifications"]);
          }}
        />
      ) : null}
    </>
  );
}

function ConnectionCreateForm({
  error,
  onClose,
  onError,
  onCreated,
}: {
  error: string | null;
  onClose: () => void;
  onError: (m: string | null) => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [docType, setDocType] = useState<"CI" | "RUC" | "PASAPORTE">("CI");
  const [docNumber, setDocNumber] = useState("");
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [found, setFound] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({
    firstName: "",
    lastName: "",
    legalName: "",
    idDocumentType: "CI",
    ci: "",
    neighborhood: "",
    mobile: "",
    phone: "",
    email: "",
    address: "",
    department: "",
    city: "",
    status: "ACTIVO",
  });
  const [conn, setConn] = useState({
    address: "",
    notes: "",
    latitude: "",
    longitude: "",
    city: "",
    referenceNote: "",
    status: "PENDIENTE",
    tariffId: "",
    connectionCost: "",
    paymentMode: "CONTADO",
    downPayment: "",
    installmentCount: "5",
    firstDueOn: "",
    methodId: "",
  });
  const customers = useQuery({
    queryKey: ["opts", "/customers"],
    queryFn: () => api<{ data: Customer[] }>("/customers?pageSize=100"),
  });
  const methods = useQuery({
    queryKey: ["opts", "/payment-methods"],
    queryFn: () => api<{ data: Array<{ id: string; name: string }> }>("/payment-methods"),
  });
  const tariffs = useQuery({
    queryKey: ["opts", "/tariffs"],
    queryFn: () => api<{ data: Array<{ id: string; name: string }> }>("/tariffs"),
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        address: conn.address || undefined,
        notes: conn.notes || undefined,
        city: conn.city || undefined,
        referenceNote: conn.referenceNote || undefined,
        latitude: conn.latitude || undefined,
        longitude: conn.longitude || undefined,
        status: conn.status,
        tariffId: conn.tariffId || undefined,
        connectionCost: conn.connectionCost || undefined,
        paymentMode: conn.paymentMode || undefined,
        downPayment: conn.downPayment || undefined,
        installmentCount: conn.paymentMode === "CUOTAS" ? Number(conn.installmentCount) : undefined,
        firstDueOn: conn.firstDueOn || undefined,
        methodId: conn.methodId || undefined,
      };
      if (mode === "existing") payload.customerId = customerId;
      else {
        payload.newCustomer = Object.fromEntries(
          Object.entries({
            ...newCustomer,
            rucWithDv: newCustomer.idDocumentType === "RUC" ? newCustomer.ci : undefined,
            legalName: newCustomer.idDocumentType === "RUC" ? newCustomer.legalName : undefined,
          }).filter(([, v]) => typeof v === "string" && v.trim()),
        );
      }
      return api("/connections", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: onCreated,
    onError: (err: unknown) => onError(err instanceof ApiError ? err.message : "No se pudo guardar"),
  });

  return (
    <Modal title="Nueva conexión" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onError(null);
          save.mutate();
        }}
      >
        <p className="text-sm text-slate-600">Código: se asignará automáticamente al guardar (CON-######).</p>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
          <Field label="Documento">
            <Select value={docType} onChange={(e) => setDocType(e.target.value as "CI" | "RUC" | "PASAPORTE")}>
              <option value="CI">CI</option>
              <option value="RUC">RUC</option>
              <option value="PASAPORTE">Pasaporte</option>
            </Select>
          </Field>
          <Field label="Número">
            <Input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="Buscar por CI, RUC o pasaporte"
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                setLookupMsg(null);
                setFound(null);
                const number = docNumber.trim();
                if (!number) {
                  setLookupMsg("Ingresá el número de documento.");
                  return;
                }
                try {
                  const res = await api<{ data: Customer | null }>(
                    `/customers/by-document?type=${encodeURIComponent(docType)}&number=${encodeURIComponent(number)}`,
                  );
                  if (res.data) {
                    setMode("existing");
                    setCustomerId(res.data.id);
                    setFound(res.data);
                    setLookupMsg("Cliente encontrado. Se cargaron los datos.");
                  } else {
                    setMode("new");
                    setCustomerId("");
                    setNewCustomer((s) => ({
                      ...s,
                      idDocumentType: docType,
                      ci: number,
                    }));
                    setLookupMsg("No hay cliente con ese documento. Completá el alta.");
                  }
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : "No se pudo buscar");
                }
              }}
            >
              Cargar CI
            </Button>
          </div>
        </div>
        {lookupMsg ? <p className="text-sm text-slate-600">{lookupMsg}</p> : null}
        {found ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium">{customerLabel(found)}</p>
            <p>
              Documento:{" "}
              {found.idDocumentType === "PASAPORTE" ? "Pasaporte" : found.idDocumentType === "RUC" ? "RUC" : "CI"}{" "}
              {found.idDocumentType === "RUC" ? formatRuc(found.ruc, found.dv) || found.ci || "—" : found.ci ?? "—"}
            </p>
            {found.legalName ? <p>Razón social: {found.legalName}</p> : null}
            <p>Celular: {found.mobile ?? found.phone ?? "—"}</p>
            <p>Dirección: {found.address ?? "—"}</p>
            <p>
              {found.city ?? "—"}
              {found.neighborhood ? ` · ${found.neighborhood}` : ""}
            </p>
            <p>Estado: {found.status === "INACTIVO" || found.status === "INOPERATIVO" ? "Inoperativo" : found.status ?? "—"}</p>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant={mode === "existing" ? "primary" : "secondary"} onClick={() => setMode("existing")}>
            Cliente existente
          </Button>
          <Button type="button" variant={mode === "new" ? "primary" : "secondary"} onClick={() => setMode("new")}>
            + Nuevo cliente
          </Button>
        </div>
        {mode === "existing" ? (
          <Field label="Cliente">
            <Select
              required
              value={customerId}
              onChange={(e) => {
                const id = e.target.value;
                setCustomerId(id);
                const c = (customers.data?.data ?? []).find((x) => x.id === id) ?? null;
                setFound(c);
              }}
            >
              <option value="">Seleccionar…</option>
              {(customers.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {customerLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={newCustomer.firstName} onChange={(e) => setNewCustomer((s) => ({ ...s, firstName: e.target.value }))} />
            </Field>
            <Field label="Apellido">
              <Input value={newCustomer.lastName} onChange={(e) => setNewCustomer((s) => ({ ...s, lastName: e.target.value }))} />
            </Field>
            <Field label="Tipo de documento">
              <Select
                value={newCustomer.idDocumentType}
                onChange={(e) =>
                  setNewCustomer((s) => ({
                    ...s,
                    idDocumentType: e.target.value,
                    legalName: e.target.value === "RUC" ? s.legalName : "",
                  }))
                }
              >
                <option value="CI">CI</option>
                <option value="RUC">RUC</option>
                <option value="PASAPORTE">Pasaporte</option>
              </Select>
            </Field>
            <Field label="Número de documento">
              <Input value={newCustomer.ci} onChange={(e) => setNewCustomer((s) => ({ ...s, ci: e.target.value }))} />
            </Field>
            {newCustomer.idDocumentType === "RUC" ? (
              <Field label="Razón social">
                <Input value={newCustomer.legalName} onChange={(e) => setNewCustomer((s) => ({ ...s, legalName: e.target.value }))} />
              </Field>
            ) : null}
            <Field label="Celular">
              <Input type="tel" value={newCustomer.mobile} onChange={(e) => setNewCustomer((s) => ({ ...s, mobile: e.target.value }))} />
            </Field>
            <Field label="Dirección">
              <Input value={newCustomer.address} onChange={(e) => setNewCustomer((s) => ({ ...s, address: e.target.value }))} />
            </Field>
            <Field label="Departamento">
              <Select
                value={newCustomer.department}
                onChange={(e) => setNewCustomer((s) => ({ ...s, department: e.target.value, city: "" }))}
              >
                <option value="">Seleccionar…</option>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ciudad">
              <Select
                value={newCustomer.city}
                disabled={!newCustomer.department}
                onChange={(e) => setNewCustomer((s) => ({ ...s, city: e.target.value, neighborhood: "" }))}
              >
                <option value="">{newCustomer.department ? "Seleccionar…" : "Elegí primero el departamento"}</option>
                {(CITY_OPTIONS_BY_DEPARTMENT[newCustomer.department] ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Barrio">
              <NeighborhoodSuggest
                city={newCustomer.city}
                department={newCustomer.department}
                value={newCustomer.neighborhood}
                onChange={(neighborhood) => setNewCustomer((s) => ({ ...s, neighborhood }))}
              />
            </Field>
            <Field label="Estado">
              <Select value={newCustomer.status} onChange={(e) => setNewCustomer((s) => ({ ...s, status: e.target.value }))}>
                <option value="ACTIVO">Activo</option>
                <option value="INOPERATIVO">Inoperativo</option>
              </Select>
            </Field>
          </div>
        )}
        <h3 className="pt-2 font-medium">Datos de la conexión</h3>
        <Field label="Dirección del suministro">
          <Input value={conn.address} onChange={(e) => setConn((s) => ({ ...s, address: e.target.value }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ciudad">
            <Input value={conn.city} onChange={(e) => setConn((s) => ({ ...s, city: e.target.value }))} />
          </Field>
          <Field label="Referencia">
            <Input value={conn.referenceNote} onChange={(e) => setConn((s) => ({ ...s, referenceNote: e.target.value }))} />
          </Field>
        </div>
        <Field label="Tarifa">
          <Select value={conn.tariffId} onChange={(e) => setConn((s) => ({ ...s, tariffId: e.target.value }))}>
            <option value="">Seleccionar…</option>
            {(tariffs.data?.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Costo de conexión Gs.">
          <Input inputMode="decimal" value={conn.connectionCost} onChange={(e) => setConn((s) => ({ ...s, connectionCost: e.target.value }))} />
        </Field>
        <Field label="Forma de pago del costo">
          <Select value={conn.paymentMode} onChange={(e) => setConn((s) => ({ ...s, paymentMode: e.target.value }))}>
            <option value="CONTADO">Contado</option>
            <option value="CUOTAS">Cuotas</option>
          </Select>
        </Field>
        {conn.paymentMode === "CUOTAS" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Anticipo">
              <Input inputMode="decimal" value={conn.downPayment} onChange={(e) => setConn((s) => ({ ...s, downPayment: e.target.value }))} />
            </Field>
            <Field label="Cantidad de cuotas">
              <Input type="number" value={conn.installmentCount} onChange={(e) => setConn((s) => ({ ...s, installmentCount: e.target.value }))} />
            </Field>
            <Field label="Primera cuota">
              <Input type="date" value={conn.firstDueOn} onChange={(e) => setConn((s) => ({ ...s, firstDueOn: e.target.value }))} />
            </Field>
          </div>
        ) : null}
        <Field label="Medio de pago (si cobra ahora)">
          <Select value={conn.methodId} onChange={(e) => setConn((s) => ({ ...s, methodId: e.target.value }))}>
            <option value="">Registrar después</option>
            {(methods.data?.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Latitud">
            <Input value={conn.latitude} onChange={(e) => setConn((s) => ({ ...s, latitude: e.target.value }))} />
          </Field>
          <Field label="Longitud">
            <Input value={conn.longitude} onChange={(e) => setConn((s) => ({ ...s, longitude: e.target.value }))} />
          </Field>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              const gps = await captureGps();
              setConn((s) => ({
                ...s,
                latitude: String(gps.latitude),
                longitude: String(gps.longitude),
              }));
            } catch {
              /* el usuario ve el permiso del navegador */
            }
          }}
        >
          Usar GPS del dispositivo
        </Button>
        <Field label="Observaciones">
          <Textarea value={conn.notes} onChange={(e) => setConn((s) => ({ ...s, notes: e.target.value }))} />
        </Field>
        <p className="text-sm text-slate-600">El medidor no se carga acá. Queda como instalación pendiente.</p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NeighborhoodSuggest({
  city,
  department,
  value,
  onChange,
}: {
  city: string;
  department: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const q = useQuery({
    queryKey: ["opts", "/neighborhoods", city, department],
    queryFn: () => {
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      if (department) params.set("department", department);
      return api<{ data: Array<{ id: string; name: string }> }>(`/neighborhoods?${params.toString()}`);
    },
    enabled: Boolean(city),
  });
  return (
    <>
      <Input
        list="conexion-barrios"
        disabled={!city}
        placeholder={city ? "Escribí o elegí el barrio" : "Elegí primero la ciudad"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="conexion-barrios">
        {(q.data?.data ?? []).map((row) => (
          <option key={row.id} value={row.name} />
        ))}
      </datalist>
    </>
  );
}
