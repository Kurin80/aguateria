import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { cn } from "./ui";

type InboxItem = {
  id: string;
  kind: "OPERATIONAL" | "IN_APP";
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type InboxResponse = { data: InboxItem[]; meta?: { unreadCount: number } };

export function NotificationBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const inbox = useQuery({
    queryKey: ["/notifications"],
    queryFn: () => api<InboxResponse>("/notifications"),
    refetchInterval: 8_000,
  });
  const items = inbox.data?.data ?? [];
  const unread = inbox.data?.meta?.unreadCount ?? items.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const applyInbox = (next: InboxItem[]) => {
    qc.setQueryData<InboxResponse>(["/notifications"], { data: next, meta: { unreadCount: next.length } });
  };

  const markOne = async (item: InboxItem) => {
    const next = items.filter((row) => row.id !== item.id);
    await qc.cancelQueries({ queryKey: ["/notifications"] });
    applyInbox(next);
    try {
      await api(`/notifications/${encodeURIComponent(item.id)}/read`, { method: "PATCH" });
    } catch {
      await qc.invalidateQueries({ queryKey: ["/notifications"] });
    }
  };

  const markAll = async () => {
    if (!unread || markingAll) return;
    setMarkingAll(true);
    await qc.cancelQueries({ queryKey: ["/notifications"] });
    applyInbox([]);
    try {
      await api("/notifications/read-all", { method: "PATCH" });
    } catch {
      await qc.invalidateQueries({ queryKey: ["/notifications"] });
    } finally {
      setMarkingAll(false);
    }
  };

  const dark = tone === "dark";
  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={cn(
          "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg",
          dark ? "text-white hover:bg-white/10" : "text-slate-700 hover:bg-white",
        )}
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={20} aria-hidden />
        {unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-4 text-brand-950">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notificaciones del sistema"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Notificaciones</p>
              <p className="text-xs text-slate-500">{unread ? `${unread} sin leer` : "Nada pendiente"}</p>
            </div>
            {unread > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-brand-800 focus:ring-brand-700"
                  checked={false}
                  disabled={markingAll}
                  aria-label="Marcar todas como leídas"
                  onChange={(e) => {
                    if (e.target.checked) void markAll();
                  }}
                />
                Marcar todas
              </label>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item) => {
              const inner = (
                <>
                  <p className="text-sm font-medium text-slate-900">{item.body}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.kind === "OPERATIONAL" ? "Alerta operativa" : item.title}</p>
                </>
              );
              const className = "min-w-0 flex-1 px-1 py-1";
              return (
                <li key={item.id} className="flex items-start gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 rounded border-slate-300 text-brand-800 focus:ring-brand-700"
                    checked={false}
                    aria-label={`Marcar como leída: ${item.body}`}
                    onChange={() => void markOne(item)}
                  />
                  {item.href ? (
                    <Link
                      to={item.href}
                      className={cn(className, "rounded-md hover:bg-slate-50")}
                      onClick={() => {
                        setOpen(false);
                        void markOne(item);
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" className={cn(className, "text-left")} onClick={() => void markOne(item)}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
            {!inbox.isLoading && !items.length ? (
              <li className="px-4 py-6 text-sm text-slate-500">No hay notificaciones pendientes.</li>
            ) : null}
            {inbox.isError ? <li className="px-4 py-6 text-sm text-red-700">No se pudieron cargar las notificaciones.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
