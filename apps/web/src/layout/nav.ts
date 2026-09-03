import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Droplets,
  FileText,
  Gauge,
  LayoutDashboard,
  Map,
  Package,
  Receipt,
  Settings,
  Shield,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  audience?: "field" | "office" | "both";
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "inicio",
    label: "Principal",
    items: [
      { to: "/", label: "Panel principal", icon: LayoutDashboard, permission: "dashboard.ver", audience: "office" },
      { to: "/campo", label: "Lectura de campo", icon: Smartphone, permission: "lecturas.crear", audience: "both" },
      { to: "/instalaciones", label: "Instalaciones", icon: Wrench, permission: "instalaciones.ver", audience: "both" },
      { to: "/cobranza", label: "Cobranza y facturación", icon: Wallet, permission: "cobranza.ver", audience: "both" },
      { to: "/boletas", label: "Boletas mes", icon: FileText, permission: "boletas.ver", audience: "office" },
    ],
  },
  {
    id: "padron",
    label: "Padrón",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users, permission: "clientes.ver", audience: "office" },
      { to: "/conexiones", label: "Conexiones", icon: Droplets, permission: "conexiones.ver", audience: "office" },
      { to: "/medidores", label: "Medidores", icon: Gauge, permission: "medidores.ver", audience: "office" },
      { to: "/lecturas", label: "Historial de lecturas", icon: ClipboardList, permission: "lecturas.ver", audience: "both" },
      { to: "/mapa", label: "Mapa", icon: Map, permission: "mapa.ver", audience: "both" },
    ],
  },
  {
    id: "facturacion",
    label: "Facturación",
    items: [
      { to: "/tarifas", label: "Tarifas", icon: Receipt, permission: "tarifas.ver", audience: "office" },
      { to: "/periodos", label: "Periodos", icon: FileText, permission: "periodos.ver", audience: "office" },
      { to: "/timbrados", label: "Timbrados", icon: Shield, permission: "timbrados.ver", audience: "office" },
      { to: "/cuentas", label: "Estado de cuenta", icon: Wallet, permission: "cuentas.ver", audience: "office" },
      { to: "/morosidad", label: "Morosidad", icon: AlertTriangle, permission: "morosidad.ver", audience: "office" },
    ],
  },
  {
    id: "campo-extra",
    label: "Servicio",
    items: [
      { to: "/suspensiones", label: "Desconexiones", icon: AlertTriangle, permission: "suspensiones.ver", audience: "office" },
      { to: "/reconexiones", label: "Reconexiones", icon: Activity, permission: "reconexiones.ver", audience: "office" },
      { to: "/reclamos", label: "Reclamos", icon: ClipboardList, permission: "reclamos.ver", audience: "office" },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    items: [
      { to: "/inventario", label: "Inventario", icon: Package, permission: "inventario.ver", audience: "office" },
      { to: "/proveedores", label: "Proveedores", icon: Package, permission: "proveedores.ver", audience: "office" },
      { to: "/gastos", label: "Gastos", icon: Wallet, permission: "gastos.ver", audience: "office" },
    ],
  },
  {
    id: "admin",
    label: "Administración",
    items: [
      { to: "/reportes", label: "Reportes", icon: BarChart3, permission: "reportes.ver", audience: "office" },
      { to: "/usuarios", label: "Usuarios", icon: Users, permission: "usuarios.ver", audience: "office" },
      { to: "/auditoria", label: "Auditoría", icon: Shield, permission: "auditoria.ver", audience: "office" },
      { to: "/regulacion", label: "Regulación", icon: FileText, permission: "regulacion.ver", audience: "office" },
      { to: "/configuracion", label: "Configuración", icon: Settings, permission: "configuracion.ver", audience: "office" },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function fieldHomePath(roles: string[] | undefined): "/campo" | "/instalaciones" | "/cobranza" | null {
  if (!roles?.length) return null;
  const privileged = ["SUPER_ADMIN", "ADMINISTRADOR", "GERENTE", "SUPERVISOR"];
  if (roles.some((r) => privileged.includes(r))) return null;
  if (roles.includes("COBRADOR")) return "/cobranza";
  if (roles.includes("INSTALADOR")) return "/instalaciones";
  if (roles.includes("LECTOR") || roles.includes("LECTORISTA")) return "/campo";
  return null;
}

export function isFieldOnlyUser(roles: string[] | undefined): boolean {
  return fieldHomePath(roles) != null;
}
