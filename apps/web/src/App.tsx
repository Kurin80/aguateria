import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./layout/AppLayout";
import { fieldHomePath } from "./layout/nav";
import { HomePage } from "./pages/DashboardPage";
import { FieldReadingsPage } from "./pages/FieldReadingsPage";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ResourcePage } from "./pages/ResourcePage";
import { CITY_OPTIONS_BY_DEPARTMENT, DEPARTMENT_OPTIONS } from "./lib/paraguay-geo";
import { formatRuc } from "@aguateria/shared";
import { SettingsPage } from "./pages/SettingsPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { MetersPage } from "./pages/MetersPage";
import { BillsPage, PeriodsPage, ReadingsPage } from "./pages/OperationsPages";
import { InstallationsPage } from "./pages/InstallationsPage";
import { CollectionPage } from "./pages/CollectionPage";
import { DisconnectionsPage } from "./pages/DisconnectionsPage";
import { UsersPage } from "./pages/UsersPage";

const MapPage = lazy(() => import("./pages/MapPage").then((m) => ({ default: m.MapPage })));

function Guard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-slate-600">Cargando…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function FieldGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  const home = fieldHomePath(user?.roles);
  if (!home) return children;
  const allowed =
    loc.pathname === "/" ||
    loc.pathname === home ||
    loc.pathname === "/mapa" ||
    (home === "/campo" && loc.pathname === "/lecturas") ||
    (home === "/cobranza" && loc.pathname.startsWith("/clientes"));
  if (!allowed) return <Navigate to={home} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <FieldGate>
              <AppLayout />
            </FieldGate>
          </Guard>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="campo" element={<FieldReadingsPage />} />
        <Route path="instalaciones" element={<InstallationsPage />} />
        <Route path="cobranza" element={<CollectionPage />} />
        <Route path="facturas" element={<Navigate to="/cobranza?vista=facturas" replace />} />
        <Route path="pagos" element={<Navigate to="/cobranza?vista=pagos" replace />} />
        <Route
          path="clientes"
          element={
            <ResourcePage
              title="Clientes"
              path="/customers"
              searchPlaceholder="Nombre, RUC, CI, código, teléfono…"
              createPermission="clientes.crear"
              editPermission="clientes.editar"
              linkTo={(row) => `/clientes/${row.id}`}
              columns={[
                { key: "code", label: "Código" },
                { key: "firstName", label: "Nombre" },
                { key: "lastName", label: "Apellido" },
                { key: "legalName", label: "Razón social" },
                {
                  key: "ci",
                  label: "Documento",
                  format: (row) => {
                    const type = String(row.idDocumentType ?? "CI");
                    const kind = type === "PASAPORTE" ? "Pasaporte" : type === "RUC" ? "RUC" : "CI";
                    const number =
                      type === "RUC"
                        ? formatRuc(String(row.ruc ?? ""), String(row.dv ?? "")) || String(row.ci ?? "")
                        : String(row.ci ?? "");
                    return number ? `${kind} ${number}` : "—";
                  },
                },
                { key: "mobile", label: "Celular" },
                {
                  key: "status",
                  label: "Estado",
                  format: (row) => (row.status === "INACTIVO" || row.status === "INOPERATIVO" ? "Inoperativo" : String(row.status ?? "—")),
                },
              ]}
              fields={[
                { key: "code", label: "Código", readOnly: true, peekPath: "/customers/next-code", peekKey: "code" },
                { key: "firstName", label: "Nombre" },
                { key: "lastName", label: "Apellido" },
                {
                  key: "idDocumentType",
                  label: "Tipo de documento",
                  type: "select",
                  options: [
                    { value: "CI", label: "CI" },
                    { value: "RUC", label: "RUC" },
                    { value: "PASAPORTE", label: "Pasaporte" },
                  ],
                  fromRow: (row) => {
                    const t = String(row.idDocumentType ?? "");
                    if (t === "RUC" || t === "PASAPORTE" || t === "CI") return t;
                    return row.ruc ? "RUC" : "CI";
                  },
                  defaultValue: "CI",
                },
                {
                  key: "ci",
                  label: "Número de documento",
                  fromRow: (row) => {
                    const t = String(row.idDocumentType ?? "");
                    if (t === "RUC" || row.ruc) {
                      return formatRuc(String(row.ruc ?? ""), String(row.dv ?? "")) || String(row.ci ?? "");
                    }
                    return String(row.ci ?? "");
                  },
                },
                {
                  key: "legalName",
                  label: "Razón social",
                  visibleWhen: { key: "idDocumentType", is: "RUC" },
                },
                { key: "phone", label: "Teléfono", type: "tel" },
                { key: "mobile", label: "Celular", type: "tel" },
                { key: "email", label: "Email", type: "email" },
                { key: "address", label: "Dirección" },
                {
                  key: "department",
                  label: "Departamento",
                  type: "select",
                  options: [...DEPARTMENT_OPTIONS],
                },
                {
                  key: "city",
                  label: "Ciudad",
                  type: "select",
                  dependsOn: "department",
                  optionsBy: CITY_OPTIONS_BY_DEPARTMENT,
                },
                {
                  key: "neighborhood",
                  label: "Barrio",
                  dependsOn: "city",
                  suggestionsPath: "/neighborhoods",
                  suggestionParams: ["city", "department"],
                },
                { key: "referenceNote", label: "Referencia" },
                {
                  key: "status",
                  label: "Estado",
                  type: "select",
                  options: [
                    { value: "ACTIVO", label: "Activo" },
                    { value: "INOPERATIVO", label: "Inoperativo" },
                  ],
                  fromRow: (row) => (row.status === "INACTIVO" ? "INOPERATIVO" : String(row.status ?? "ACTIVO")),
                  defaultValue: "ACTIVO",
                },
                { key: "notes", label: "Observaciones", type: "textarea" },
              ]}
              transformPayload={(p, mode) => {
                const body = Object.fromEntries(Object.entries(p).filter(([, v]) => String(v ?? "").trim() !== ""));
                if (mode === "create") {
                  delete body.code;
                }
                if (body.idDocumentType === "RUC" && body.ci) {
                  body.rucWithDv = body.ci;
                } else if (body.idDocumentType !== "RUC") {
                  body.ruc = "";
                  body.dv = "";
                  delete body.legalName;
                }
                return body;
              }}
            />
          }
        />
        <Route path="clientes/:id" element={<CustomerDetailPage />} />
        <Route path="conexiones" element={<ConnectionsPage />} />
        <Route path="medidores" element={<MetersPage />} />
        <Route path="lecturas" element={<ReadingsPage />} />
        <Route
          path="tarifas"
          element={
            <ResourcePage
              title="Tarifas"
              subtitle="Según boleta real: mínimo (p. ej. 10 m³ = 10.000 L), excedente, IVA 10% e ERSSAN 2%."
              path="/tariffs"
              createPermission="tarifas.crear"
              columns={[
                { key: "name", label: "Nombre" },
                { key: "validFrom", label: "Vigencia desde" },
                { key: "validTo", label: "Hasta" },
                { key: "active", label: "Activa" },
              ]}
              fields={[
                { key: "name", label: "Nombre", required: true },
                { key: "categoryId", label: "Categoría", required: true, optionsPath: "/categories", optionLabel: "name" },
                { key: "validFrom", label: "Vigente desde", type: "date", required: true },
                { key: "validTo", label: "Vigente hasta", type: "date" },
                { key: "fixedCharge", label: "Cargo fijo Gs. (si no hay, 0)", type: "number", required: true },
                { key: "minConsumptionM3", label: "Consumo mínimo m³ (p. ej. 10)", type: "number", required: true },
                { key: "minAmount", label: "Importe mínimo a pagar Gs. (p. ej. 33000)", type: "number", required: true },
                { key: "pricePerM3", label: "Precio m³ Gs. del bloque mínimo", type: "number", required: true },
                { key: "excessPricePerM3", label: "Precio m³ excedente Gs." },
                { key: "surchargePercent", label: "ERSSAN % (2 en la boleta real)", type: "number" },
                { key: "taxRateId", label: "Tasa IVA (10%)", optionsPath: "/tax-rates", optionLabel: "name" },
                { key: "notes", label: "Notas", type: "textarea" },
              ]}
              transformPayload={(p) => ({
                name: p.name,
                categoryId: p.categoryId,
                validFrom: p.validFrom,
                validTo: p.validTo,
                notes: p.notes,
                rule: {
                  fixedCharge: p.fixedCharge ?? "0",
                  minConsumptionM3: p.minConsumptionM3 ?? "10",
                  minAmount: p.minAmount ?? "33000",
                  pricePerM3: p.pricePerM3 ?? "3300",
                  excessPricePerM3: p.excessPricePerM3 || p.pricePerM3 || "3300",
                  surchargePercent: p.surchargePercent || "2",
                  taxRateId: p.taxRateId,
                },
              })}
            />
          }
        />
        <Route path="periodos" element={<PeriodsPage />} />
        <Route path="boletas" element={<BillsPage />} />
        <Route
          path="timbrados"
          element={
            <ResourcePage
              title="Timbrados"
              path="/tax-stamps"
              createPermission="timbrados.crear"
              columns={[
                { key: "number", label: "Timbrado" },
                { key: "documentType", label: "Tipo" },
                { key: "validFrom", label: "Desde" },
                { key: "validTo", label: "Hasta" },
                { key: "nextNumber", label: "Próximo N.º" },
                { key: "status", label: "Estado" },
              ]}
              fields={[
                { key: "number", label: "Número de timbrado", required: true },
                {
                  key: "documentType",
                  label: "Tipo documento",
                  required: true,
                  type: "select",
                  options: [
                    { value: "FACTURA_ELECTRONICA", label: "Factura electrónica" },
                    { value: "NOTA_CREDITO_ELECTRONICA", label: "Nota de crédito electrónica" },
                    { value: "NOTA_DEBITO_ELECTRONICA", label: "Nota de débito electrónica" },
                    { value: "AUTOFACTURA_ELECTRONICA", label: "Autofactura electrónica" },
                    { value: "NOTA_REMISION_ELECTRONICA", label: "Nota de remisión electrónica" },
                  ],
                },
                { key: "establishmentId", label: "Establecimiento", required: true, optionsPath: "/establishments", optionLabel: ["code", "name"] },
                { key: "salesPointId", label: "Punto de expedición", required: true, optionsPath: "/sales-points", optionLabel: ["code", "name"] },
                { key: "validFrom", label: "Inicio", type: "date", required: true },
                { key: "validTo", label: "Vencimiento", type: "date", required: true },
                { key: "rangeFrom", label: "Numeración inicial", type: "number", required: true },
                { key: "rangeTo", label: "Numeración final", type: "number", required: true },
              ]}
              transformPayload={(p) => ({
                ...p,
                rangeFrom: Number(p.rangeFrom),
                rangeTo: Number(p.rangeTo),
              })}
            />
          }
        />
        <Route
          path="cuentas"
          element={
            <ResourcePage
              title="Cuentas corrientes"
              path="/accounts"
              linkTo={(row) => `/clientes/${row.customerId}`}
              columns={[
                { key: "code", label: "Cliente" },
                { key: "firstName", label: "Nombre" },
                { key: "lastName", label: "Apellido" },
                { key: "balance", label: "Saldo Gs." },
                { key: "status", label: "Estado" },
              ]}
            />
          }
        />
        <Route
          path="morosidad"
          element={
            <ResourcePage
              title="Morosidad"
              path="/collections/delinquency"
              columns={[
                { key: "code", label: "Cliente" },
                { key: "connectionCode", label: "Conexión" },
                { key: "unpaidPeriods", label: "Meses" },
                { key: "balance", label: "Saldo" },
                { key: "bucket", label: "Tramo" },
                { key: "status", label: "Estado" },
              ]}
            />
          }
        />
        <Route path="suspensiones" element={<DisconnectionsPage />} />
        <Route
          path="reconexiones"
          element={
            <ResourcePage
              title="Reconexiones"
              path="/reconnections"
              createPermission="reconexiones.crear"
              columns={[
                { key: "executedAt", label: "Fecha" },
                { key: "cost", label: "Costo" },
              ]}
              fields={[
                { key: "customerId", label: "Cliente", required: true, optionsPath: "/customers", optionLabel: ["code", "lastName"] },
                { key: "connectionId", label: "Conexión", required: true, optionsPath: "/connections", optionLabel: "code" },
                { key: "cost", label: "Costo Gs.", type: "number" },
                { key: "notes", label: "Observación", type: "textarea" },
              ]}
            />
          }
        />
        <Route
          path="reclamos"
          element={
            <ResourcePage
              title="Reclamos"
              path="/claims"
              createPermission="reclamos.crear"
              columns={[
                { key: "number", label: "Número" },
                { key: "type", label: "Tipo" },
                { key: "priority", label: "Prioridad" },
                { key: "status", label: "Estado" },
              ]}
              fields={[
                { key: "customerId", label: "Cliente", optionsPath: "/customers", optionLabel: ["code", "lastName"] },
                { key: "connectionId", label: "Conexión", optionsPath: "/connections", optionLabel: "code" },
                { key: "type", label: "Tipo", required: true, type: "select", options: ["FALTA_DE_AGUA", "BAJA_PRESION", "FUGA", "MEDIDOR", "FACTURACION", "CALIDAD", "RECONEXION", "OTROS"].map((v) => ({ value: v, label: v })) },
                { key: "priority", label: "Prioridad", type: "select", options: ["BAJA", "MEDIA", "ALTA"].map((v) => ({ value: v, label: v })) },
                { key: "description", label: "Descripción", required: true, type: "textarea" },
              ]}
            />
          }
        />
        <Route
          path="inventario"
          element={
            <ResourcePage
              title="Inventario"
              path="/inventory"
              createPermission="inventario.movimiento"
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Nombre" },
                { key: "stock", label: "Stock" },
                { key: "unit", label: "Unidad" },
              ]}
              fields={[
                { key: "sku", label: "SKU", required: true },
                { key: "name", label: "Nombre", required: true },
                { key: "unit", label: "Unidad" },
                { key: "stock", label: "Stock inicial", type: "number" },
                { key: "minStock", label: "Stock mínimo", type: "number" },
              ]}
            />
          }
        />
        <Route
          path="proveedores"
          element={
            <ResourcePage
              title="Proveedores"
              path="/suppliers"
              createPermission="proveedores.crear"
              columns={[
                { key: "legalName", label: "Razón social" },
                { key: "ruc", label: "RUC" },
                { key: "phone", label: "Teléfono" },
                { key: "status", label: "Estado" },
              ]}
              fields={[
                { key: "legalName", label: "Razón social", required: true },
                { key: "ruc", label: "RUC" },
                { key: "contactName", label: "Contacto" },
                { key: "phone", label: "Teléfono" },
                { key: "email", label: "Email", type: "email" },
                { key: "address", label: "Dirección" },
              ]}
            />
          }
        />
        <Route
          path="gastos"
          element={
            <ResourcePage
              title="Gastos"
              path="/expenses"
              createPermission="gastos.crear"
              columns={[
                { key: "concept", label: "Concepto" },
                { key: "category", label: "Categoría" },
                { key: "expenseDate", label: "Fecha" },
                { key: "amount", label: "Importe" },
              ]}
              fields={[
                { key: "category", label: "Categoría", required: true },
                { key: "concept", label: "Concepto", required: true },
                { key: "expenseDate", label: "Fecha", type: "date", required: true },
                { key: "amount", label: "Importe Gs.", type: "number", required: true },
                { key: "notes", label: "Observación", type: "textarea" },
              ]}
            />
          }
        />
        <Route
          path="mapa"
          element={
            <Suspense fallback={<p>Cargando mapa…</p>}>
              <MapPage />
            </Suspense>
          }
        />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="usuarios" element={<UsersPage />} />
        <Route
          path="auditoria"
          element={
            <ResourcePage
              title="Auditoría"
              path="/audit-logs"
              columns={[
                { key: "action", label: "Acción" },
                { key: "module", label: "Módulo" },
                { key: "createdAt", label: "Fecha" },
              ]}
            />
          }
        />
        <Route
          path="regulacion"
          element={
            <ResourcePage
              title="Regulación ERSSAN"
              subtitle="Repositorio documental. No inventa obligaciones."
              path="/regulation/documents"
              createPermission="regulacion.editar"
              columns={[
                { key: "title", label: "Título" },
                { key: "category", label: "Categoría" },
                { key: "source", label: "Fuente" },
              ]}
              fields={[
                { key: "title", label: "Título", required: true },
                { key: "category", label: "Categoría", required: true },
                { key: "source", label: "Fuente (Ley, decreto, resolución)" },
                { key: "notes", label: "Notas", type: "textarea" },
              ]}
            />
          }
        />
        <Route path="configuracion" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
