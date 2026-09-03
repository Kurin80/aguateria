import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ApiError, api } from "../api/client";
import { BrandLogo } from "../components/BrandLogo";
import { Button, Input } from "../components/ui";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (password !== confirm) {
            setError("Las contraseñas no coinciden");
            return;
          }
          setPending(true);
          try {
            await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
            setOk(true);
          } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo restablecer");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-brand-800">Aguatería</p>
          <BrandLogo className="h-14 w-14" />
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Nueva contraseña</h1>
        {!token ? <p className="mt-3 text-sm text-red-700">Falta el token del enlace.</p> : null}
        {ok ? (
          <>
            <p className="mt-4 text-sm text-emerald-800">Contraseña actualizada. Ya podés ingresar.</p>
            <Link className="mt-6 inline-block text-sm text-brand-800 underline" to="/login">
              Ir al ingreso
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">Mínimo 10 caracteres.</p>
            <label className="mt-6 block text-sm">
              Nueva contraseña
              <Input className="mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required />
            </label>
            <label className="mt-4 block text-sm">
              Confirmar
              <Input className="mt-1" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} required />
            </label>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            <Button className="mt-6 w-full" disabled={pending || !token} type="submit">
              {pending ? "Guardando…" : "Restablecer"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
