import { Menu, X } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { NotificationBell } from "../components/NotificationBell";
import { useAuth } from "../auth/AuthProvider";
import { NAV_GROUPS, isFieldOnlyUser } from "./nav";

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const fieldOnly = isFieldOnlyUser(user?.roles);
  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!can(item.permission)) return false;
          const audience = item.audience ?? "office";
          if (fieldOnly) return audience === "field" || audience === "both";
          return audience === "office" || audience === "both";
        }),
      })).filter((g) => g.items.length > 0),
    [can, fieldOnly],
  );

  return (
    <div className="min-h-screen bg-slate-100 lg:flex">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-900 px-4 py-3 text-white lg:hidden">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Aguatería</span>
          <BrandLogo className="h-8 w-8" />
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell tone="dark" />
          <button type="button" aria-label={open ? "Cerrar menú" : "Abrir menú"} onClick={() => setOpen((v) => !v)}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {open ? (
        <button type="button" className="fixed inset-0 z-20 bg-black/40 lg:hidden" aria-label="Cerrar" onClick={() => setOpen(false)} />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-brand-900 text-white transition lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-6">
          <div>
            <p className="text-lg font-semibold tracking-tight">Aguatería</p>
            <p className="text-xs text-white/70">{fieldOnly ? "Operación de campo" : "Gestión del servicio de agua"}</p>
          </div>
          <BrandLogo className="h-12 w-12" />
        </div>
        <nav className="sidebar-scroll h-[calc(100vh-8rem)] overflow-y-auto px-3 pb-8 pt-4 lg:h-[calc(100vh-9rem)]">
          {groups.map((group) => (
            <div key={group.id} className="mb-4">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `mb-1 flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-white/15" : "hover:bg-white/10"}`
                  }
                >
                  <item.icon size={18} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4 text-xs">
          <p className="truncate font-medium">{user?.fullName}</p>
          <p className="truncate text-white/60">{user?.roles.join(", ")}</p>
          <button type="button" className="mt-2 text-white/80 underline" onClick={() => logout()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 hidden items-center justify-end border-b border-slate-200 bg-slate-100/95 px-8 py-2 backdrop-blur lg:flex">
          <NotificationBell />
        </header>
        <div className="p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
