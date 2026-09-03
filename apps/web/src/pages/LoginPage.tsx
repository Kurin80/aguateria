import { Link, Navigate } from "react-router-dom";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, api } from "../api/client";
import { BrandLogo } from "../components/BrandLogo";
import { Button, Input } from "../components/ui";

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4 pb-[env(safe-area-inset-bottom)]">
      <form
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          setInfo(null);
          setResetUrl(null);
          try {
            if (mode === "login") {
              await login(identifier, password);
            } else {
              const r = await api<{ data: { ok: boolean; message: string; resetUrl?: string } }>(
                "/auth/forgot-password",
                { method: "POST", body: JSON.stringify({ email }) },
              );
              setInfo(r.data.message);
              if (r.data.resetUrl) setResetUrl(r.data.resetUrl);
            }
          } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo completar");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-brand-800">Aguatería</p>
          <BrandLogo className="h-14 w-14" />
        </div>
        {mode === "login" ? (
          <>
            <h1 className="mt-1 text-2xl font-semibold">Ingreso al sistema</h1>
            <p className="mt-1 text-sm text-slate-600">Personal autorizado del prestador.</p>
            <label className="mt-6 block text-sm">
              Email o usuario
              <Input className="mt-1" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
            </label>
            <label className="mt-4 block text-sm">
              Contraseña
              <span className="relative mt-1 block">
                <Input
                  className="pr-11"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-brand-800"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </span>
            </label>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            <Button className="mt-6 w-full" disabled={pending} type="submit">
              {pending ? "Ingresando…" : "Ingresar"}
            </Button>
            <button
              type="button"
              className="mt-4 text-sm text-brand-800 underline"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setEmail(identifier.includes("@") ? identifier : "");
              }}
            >
              Olvidé mi contraseña
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-1 text-2xl font-semibold">Recuperar contraseña</h1>
            <p className="mt-1 text-sm text-slate-600">Ingresá el email de tu usuario. Si está registrado, se genera un enlace de restablecimiento.</p>
            <label className="mt-6 block text-sm">
              Email
              <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            {info ? <p className="mt-3 text-sm text-emerald-800">{info}</p> : null}
            {resetUrl ? (
              <p className="mt-3 text-sm">
                Entorno de desarrollo:{" "}
                <Link className="text-brand-800 underline" to={resetUrl.replace(/^https?:\/\/[^/]+/, "")}>
                  abrir enlace de restablecimiento
                </Link>
              </p>
            ) : null}
            <Button className="mt-6 w-full" disabled={pending} type="submit">
              {pending ? "Enviando…" : "Enviar enlace"}
            </Button>
            <button type="button" className="mt-4 text-sm text-brand-800 underline" onClick={() => setMode("login")}>
              Volver al ingreso
            </button>
          </>
        )}
      </form>
    </div>
  );
}
