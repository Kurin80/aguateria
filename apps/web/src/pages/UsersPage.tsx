import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Table } from "../components/ui";
import { refreshNow } from "../lib/refresh";

type UserRow = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone: string | null;
  active: boolean;
  lastLoginAt: string | null;
  roleCode: string | null;
};
type Role = { id: string; code: string; name: string };

export function UsersPage() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("usuarios.editar");
  const canCreate = can("usuarios.crear");
  const [modal, setModal] = useState<{ mode: "create" | "edit"; row?: UserRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["/users"],
    queryFn: () => api<{ data: UserRow[] }>("/users"),
    refetchInterval: 15_000,
  });
  const roles = useQuery({
    queryKey: ["/roles"],
    queryFn: () => api<{ data: Role[] }>("/roles"),
  });

  const mutate = useMutation({
    mutationFn: async (op: { method: "POST" | "PATCH" | "DELETE"; id?: string; body?: unknown }) =>
      api(op.id ? `/users/${op.id}` : "/users", {
        method: op.method,
        body: op.body ? JSON.stringify(op.body) : undefined,
      }),
    onSuccess: async () => {
      setModal(null);
      setError(null);
      await refreshNow(qc, ["/users"], ["/notifications"]);
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "No se pudo guardar"),
  });

  const rows = users.data?.data ?? [];
  const roleOptions = roles.data?.data ?? [];

  const toggleActive = (row: UserRow) => {
    setError(null);
    mutate.mutate({ method: "PATCH", id: row.id, body: { active: !row.active } });
  };
  const remove = (row: UserRow) => {
    if (!window.confirm(`¿Eliminar a ${row.fullName}? No podrá volver a ingresar.`)) return;
    setError(null);
    mutate.mutate({ method: "DELETE", id: row.id });
  };

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Personal autorizado del prestador. Editar, desactivar y eliminar sólo para Administrador y Super Admin."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => { setError(null); setModal({ mode: "create" }); }}>
              Nuevo usuario
            </Button>
          ) : null
        }
      />
      {error && !modal ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {users.isError ? <p className="mb-3 text-sm text-red-700">Error al cargar usuarios.</p> : null}
      <Table headers={["Nombre", "Usuario", "Email", "Rol", "Estado", "Último ingreso", "Acciones"]}>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-slate-100">
            <td className="whitespace-nowrap px-3 py-2">{row.fullName}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.username}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.email}</td>
            <td className="whitespace-nowrap px-3 py-2">{row.roleCode ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2">
              <Badge tone={row.active ? "ok" : "bad"}>{row.active ? "Activo" : "Inactivo"}</Badge>
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString("es-PY") : "Nunca"}
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" className="px-2 py-1" onClick={() => { setError(null); setModal({ mode: "edit", row }); }}>
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1"
                    disabled={mutate.isPending || row.id === me?.id}
                    onClick={() => toggleActive(row)}
                  >
                    {row.active ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="px-2 py-1"
                    disabled={mutate.isPending || row.id === me?.id}
                    onClick={() => remove(row)}
                  >
                    Eliminar
                  </Button>
                </div>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
          </tr>
        ))}
        {!users.isLoading && rows.length === 0 ? (
          <tr>
            <td className="px-3 py-6 text-slate-500" colSpan={7}>
              Sin usuarios.
            </td>
          </tr>
        ) : null}
      </Table>

      {modal ? (
        <UserForm
          mode={modal.mode}
          row={modal.row}
          roles={roleOptions}
          error={error}
          pending={mutate.isPending}
          onClose={() => setModal(null)}
          onSubmit={(body) =>
            mutate.mutate(
              modal.mode === "create"
                ? { method: "POST", body }
                : { method: "PATCH", id: modal.row!.id, body },
            )
          }
        />
      ) : null}
    </>
  );
}

function UserForm({
  mode,
  row,
  roles,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  row?: UserRow;
  roles: Role[];
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [email, setEmail] = useState(row?.email ?? "");
  const [username, setUsername] = useState(row?.username ?? "");
  const [fullName, setFullName] = useState(row?.fullName ?? "");
  const [phone, setPhone] = useState(row?.phone ?? "");
  const [roleCode, setRoleCode] = useState(row?.roleCode ?? "");
  const [password, setPassword] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "create") {
      onSubmit({ email: email.trim(), username: username.trim(), fullName: fullName.trim(), roleCode, password });
      return;
    }
    const body: Record<string, unknown> = { fullName: fullName.trim(), phone: phone.trim() || null };
    if (roleCode && roleCode !== row?.roleCode) body.roleCode = roleCode;
    if (password) body.password = password;
    onSubmit(body);
  };

  return (
    <Modal title={mode === "create" ? "Nuevo usuario" : `Editar — ${row?.fullName ?? ""}`} onClose={onClose}>
      <form className="grid gap-3" onSubmit={submit}>
        <Field label="Nombre completo">
          <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        {mode === "create" ? (
          <>
            <Field label="Email">
              <Input required type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Usuario (para ingresar)">
              <Input required minLength={3} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Email">
              <Input value={email} readOnly className="bg-slate-50 text-slate-500" />
            </Field>
            <Field label="Teléfono">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Rol">
          <Select required={mode === "create"} value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
            <option value="">Seleccionar…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.code}>
                {r.name || r.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={mode === "create" ? "Contraseña (mínimo 10 caracteres)" : "Nueva contraseña (opcional, mínimo 10)"}>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={mode === "create" ? 10 : undefined}
            required={mode === "create"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
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
