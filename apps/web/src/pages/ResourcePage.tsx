import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, Field, Input, Modal, PageHeader, Select, Table, Textarea } from "../components/ui";
import { formatGs, formatMoneyCell, gsInteger, isMoneyKey, isMoneyLabel, sanitizeGsInput } from "../lib/money";
import { refreshNow } from "../lib/refresh";

export type Column = {
  key: string;
  label: string;
  money?: boolean;
  format?: (row: Record<string, unknown>) => string;
};
export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "number" | "textarea" | "select";
  required?: boolean;
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
  optionsPath?: string;
  optionValue?: string;
  optionLabel?: string | string[];
  dependsOn?: string;
  optionsBy?: Record<string, Array<{ value: string; label: string }>>;
  suggestionsPath?: string;
  suggestionParams?: string[];
  peekPath?: string;
  peekKey?: string;
  fromRow?: (row: Record<string, unknown>) => string;
  defaultValue?: string;
  money?: boolean;
  visibleWhen?: { key: string; is: string };
};

export type RowAction = {
  label: string;
  permission?: string;
  variant?: "primary" | "secondary" | "danger";
  run: (row: Record<string, unknown>) => Promise<void> | void;
};

export function ResourcePage({
  title,
  subtitle,
  path,
  columns,
  fields,
  searchPlaceholder,
  createPermission,
  editPermission,
  linkTo,
  rowActions,
  extraQuery,
  extraActions,
  hideHeader,
  transformPayload,
}: {
  title: string;
  subtitle?: string;
  path: string;
  columns: Column[];
  fields?: FieldDef[];
  searchPlaceholder?: string;
  createPermission?: string;
  editPermission?: string;
  linkTo?: (row: Record<string, unknown>) => string;
  rowActions?: RowAction[];
  extraQuery?: string;
  extraActions?: ReactNode;
  hideHeader?: boolean;
  transformPayload?: (payload: Record<string, string>, mode: "create" | "edit") => Record<string, unknown>;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [path, q, extraQuery],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (extraQuery) extraQuery.split("&").forEach((part) => {
        const [k, v] = part.split("=");
        if (k && v) params.set(k, v);
      });
      const qs = params.toString();
      return api<{ data: Array<Record<string, unknown>> }>(`${path}${qs ? `?${qs}` : ""}`);
    },
    refetchInterval: 8_000,
  });
  const rows = query.data?.data ?? [];
  const headers = useMemo(
    () => [...columns.map((c) => c.label), ...(fields || rowActions ? ["Acciones"] : [])],
    [columns, fields, rowActions],
  );

  const save = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const mode = open === "edit" ? "edit" : "create";
      const body = transformPayload ? transformPayload(payload, mode) : payload;
      if (open === "edit" && editing?.id) {
        return api(`${path}/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return api(path, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setOpen(null);
      setEditing(null);
      void refreshNow(qc, [path], ["/notifications"]);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    },
  });

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void query.refetch();
        }}
      >
        <Input placeholder={searchPlaceholder ?? "Buscar"} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      {extraActions}
      {fields && createPermission && can(createPermission) ? (
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setEditing(null);
            setOpen("create");
          }}
        >
          Nuevo
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {hideHeader ? <div className="mb-4">{toolbar}</div> : (
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={toolbar}
      />
      )}
      {query.isError ? <p className="mb-3 text-sm text-red-700">Error al cargar.</p> : null}
      <Table headers={headers}>
        {rows.map((row) => (
          <tr key={String(row.id ?? JSON.stringify(row))} className="border-t border-slate-100">
            {columns.map((col) => (
              <td key={col.key} className="whitespace-nowrap px-3 py-2">
                {linkTo && col === columns[0] ? (
                  <Link className="text-brand-800 underline" to={linkTo(row)}>
                    {formatColumn(col, row)}
                  </Link>
                ) : (
                  formatColumn(col, row)
                )}
              </td>
            ))}
            {fields || rowActions ? (
              <td className="whitespace-nowrap px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  {fields && editPermission && can(editPermission) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2 py-1"
                      onClick={() => {
                        setError(null);
                        setEditing(row);
                        setOpen("edit");
                      }}
                    >
                      Editar
                    </Button>
                  ) : null}
                  {rowActions
                    ?.filter((a) => !a.permission || can(a.permission))
                    .map((a) => (
                      <Button
                        key={a.label}
                        type="button"
                        variant={a.variant === "danger" ? "danger" : "secondary"}
                        className="px-2 py-1"
                        onClick={() => void a.run(row)}
                      >
                        {a.label}
                      </Button>
                    ))}
                </div>
              </td>
            ) : null}
          </tr>
        ))}
        {query.isFetching && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={headers.length}>
              Actualizando…
            </td>
          </tr>
        ) : !query.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={headers.length}>
              Sin registros.
            </td>
          </tr>
        ) : null}
      </Table>
      {open && fields ? (
        <EntityForm
          title={open === "create" ? `Nuevo — ${title}` : `Editar — ${title}`}
          fields={fields}
          initial={open === "edit" ? editing : null}
          error={error}
          pending={save.isPending}
          onClose={() => setOpen(null)}
          onSubmit={(payload) => {
            setError(null);
            save.mutate(payload);
          }}
        />
      ) : null}
    </>
  );
}

function EntityForm({
  title,
  fields,
  initial,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown> | null;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = f.fromRow && initial ? f.fromRow(initial) : initial?.[f.key];
      const raw = v == null || v === "" ? (f.defaultValue ?? "") : String(v);
      next[f.key] = isMoneyField(f) ? gsInteger(raw) || raw : raw;
    }
    return next;
  });

  const peekField = fields.find((f) => f.peekPath);

  useEffect(() => {
    if (!peekField?.peekPath || initial) return;
    let cancelled = false;
    void api<{ data: Record<string, string> }>(peekField.peekPath).then((res) => {
      if (cancelled) return;
      const code = res.data[peekField.peekKey ?? peekField.key];
      if (code) setValues((s) => (s[peekField.key] ? s : { ...s, [peekField.key]: code }));
    });
    return () => {
      cancelled = true;
    };
  }, [initial, peekField?.peekPath, peekField?.peekKey, peekField?.key]);

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const payload: Record<string, string> = {};
          for (const f of fields) {
            if (f.visibleWhen && values[f.visibleWhen.key] !== f.visibleWhen.is) continue;
            const v = values[f.key]?.trim() ?? "";
            if (v) payload[f.key] = v;
          }
          onSubmit(payload);
        }}
      >
        {fields.map((f) => {
          if (f.visibleWhen && values[f.visibleWhen.key] !== f.visibleWhen.is) return null;
          return (
          <Field key={f.key} label={f.label}>
            {f.type === "textarea" ? (
              <Textarea required={f.required} value={values[f.key] ?? ""} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
            ) : f.type === "select" || f.optionsPath || f.options || f.optionsBy ? (
              <RemoteSelect
                field={f}
                value={values[f.key] ?? ""}
                parentValue={f.dependsOn ? (values[f.dependsOn] ?? "") : ""}
                onChange={(v) => {
                  setValues((s) => {
                    const next = { ...s, [f.key]: v };
                    for (const child of fields) {
                      if (child.dependsOn === f.key) next[child.key] = "";
                      if (child.visibleWhen?.key === f.key && child.visibleWhen.is !== v) next[child.key] = "";
                    }
                    return next;
                  });
                }}
              />
            ) : f.suggestionsPath ? (
              <SuggestInput
                field={f}
                value={values[f.key] ?? ""}
                values={values}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              />
            ) : (
              <Input
                required={f.required}
                readOnly={f.readOnly}
                type={f.type === "number" ? "text" : f.type ?? "text"}
                inputMode={isMoneyField(f) ? "numeric" : f.type === "number" ? "decimal" : undefined}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((s) => ({
                    ...s,
                    [f.key]: isMoneyField(f) ? sanitizeGsInput(e.target.value) : e.target.value,
                  }))
                }
              />
            )}
          </Field>
          );
        })}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoteSelect({
  field,
  value,
  parentValue,
  onChange,
}: {
  field: FieldDef;
  value: string;
  parentValue: string;
  onChange: (v: string) => void;
}) {
  const q = useQuery({
    queryKey: ["opts", field.optionsPath],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(withPageSize(field.optionsPath!)),
    enabled: Boolean(field.optionsPath),
  });
  const dependent = field.dependsOn && field.optionsBy ? (field.optionsBy[parentValue] ?? []) : null;
  const opts =
    dependent ??
    field.options ??
    (q.data?.data ?? []).map((row) => ({
      value: String(row[field.optionValue ?? "id"] ?? ""),
      label: Array.isArray(field.optionLabel)
        ? field.optionLabel.map((k) => String(row[k] ?? "")).join(" ").trim()
        : String(row[field.optionLabel ?? "name"] ?? row.code ?? row.id),
    }));
  return (
    <Select required={field.required} value={value} onChange={(e) => onChange(e.target.value)} disabled={Boolean(field.dependsOn) && !parentValue}>
      <option value="">{field.dependsOn && !parentValue ? "Elegí primero el departamento" : "Seleccionar…"}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function SuggestInput({
  field,
  value,
  values,
  onChange,
}: {
  field: FieldDef;
  value: string;
  values: Record<string, string>;
  onChange: (v: string) => void;
}) {
  const parentReady = !field.dependsOn || Boolean(values[field.dependsOn]?.trim());
  const params = new URLSearchParams();
  for (const key of field.suggestionParams ?? (field.dependsOn ? [field.dependsOn] : [])) {
    const v = values[key]?.trim();
    if (v) params.set(key, v);
  }
  const qs = params.toString();
  const path = field.suggestionsPath!;
  const url = qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
  const listId = `suggest-${field.key}`;
  const q = useQuery({
    queryKey: ["opts", url],
    queryFn: () => api<{ data: Array<Record<string, unknown>> }>(url),
    enabled: parentReady,
  });
  return (
    <>
      <Input
        required={field.required}
        list={listId}
        disabled={!parentReady}
        placeholder={parentReady ? "Escribí o elegí el barrio" : "Elegí primero la ciudad"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {(q.data?.data ?? []).map((row) => {
          const name = String(row.name ?? row[field.key] ?? "");
          return name ? <option key={String(row.id ?? name)} value={name} /> : null;
        })}
      </datalist>
    </>
  );
}

function isMoneyField(f: FieldDef): boolean {
  return Boolean(f.money) || isMoneyKey(f.key) || isMoneyLabel(f.label);
}

function formatColumn(col: Column, row: Record<string, unknown>): string {
  if (col.format) return col.format(row);
  if (col.money || isMoneyKey(col.key) || isMoneyLabel(col.label)) {
    return formatMoneyCell(col.key, row[col.key]) ?? formatGs(row[col.key] as string | number);
  }
  return formatCell(row[col.key]);
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function withPageSize(path: string): string {
  return path.includes("?") ? `${path}&pageSize=100` : `${path}?pageSize=100`;
}
