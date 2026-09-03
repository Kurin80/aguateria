# Facturación Paraguay — boleta vs comprobante tributario

Este documento **no inventa normativa**. Toda regla tributaria que pueda cambiar está parametrizada. La integración SIFEN se implementa como adaptador; un documento **no** se etiqueta como DTE válido si SIFEN no lo aprobó.

## 1. Fuentes oficiales consultadas (diseño)

| Tema | Fuente |
|---|---|
| Documentación técnica e-Kuatia / SIFEN, Manual Técnico v150 y NT 001–027 | [DNIT — Documentación técnica e-Kuatia](https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica) |
| Ambientes, SOAP 1.2, TLS 1.2, mTLS, lotes, consulta CDC | [Guía de mejores prácticas de envío de DE](https://www.dnit.gov.py/documents/20123/420592/Gu%C3%ADa+de+Mejores+Pr%C3%A1cticas+para+la+Gesti%C3%B3n+del+Env%C3%ADo+de+DE.pdf/38fe5830-98c0-2241-9895-671f86f1225f?t=1729856023709) |
| Ambiente test vs producción, CSC de prueba, KuDE, eventos | [Guía de Pruebas SIFEN (voluntariedad)](https://www.dnit.gov.py/documents/20123/424160/Gu%C3%ADa+de+Pruebas+Fase+de+Voluntariedad+Abierta+para+el+Sistema+Integrado+de+Facturaci%C3%B3n+Electr%C3%B3nica+Nacional.pdf/e5f90cba-c4e4-5c99-30df-53d2dd54ce58?t=1687295358175) |
| Habilitación facturador electrónico, timbrado, establecimientos, puntos de expedición | [Guía habilitación FE](https://www.dnit.gov.py/documents/20123/424160/1.+Gu%C3%ADa+de+Paso+a+Paso+-+Habilitaci%C3%B3n+como+Facturador+Electr%C3%B3nico.pdf/30da73a9-3a30-7f6b-8f66-3ee5ab12458c?t=1720012336817) |
| XSD oficiales | `http://ekuatia.set.gov.py/sifen/xsd` |
| Prevalidador | `https://ekuatia.set.gov.py/validador/` (según guía DNIT) |
| DV RUC | [DNIT — Dígito verificador](https://www.dnit.gov.py/documents/20123/224893/D%C3%ADgito+Verificador.pdf/fb9f86c8-245d-9dad-2dc1-ac3b3dc307a7?t=1683343426554.pdf) |
| Servicio de agua | Ley N.º 1614/2000, Decreto N.º 18880/2002, [ERSSAN](https://erssan.gov.py/institucional/) |

El Manual Técnico v150 y sus notas técnicas son la **fuente de estructura XML**. El software debe actualizarse cuando DNIT publique una NT nueva; la versión del manual se guarda en configuración (`sifen.manualVersion`).

## 2. Boleta de consumo ≠ comprobante tributario

| | Boleta de consumo | Comprobante tributario (factura / DE) |
|---|---|---|
| Propósito | Informar consumo y monto a cobrar al usuario del servicio | Documento con efectos tributarios ante DNIT |
| Módulo | `water_bills` | `invoices` + `dte_documents` |
| Numeración | Interna de la aguatería | Timbrado + establecimiento + punto + número fiscal |
| SIFEN | No se envía | Solo si el prestador está habilitado como facturador electrónico y el certificado está configurado |
| Referencia visual | Estructura típica de boleta de aguatería (empresa, cliente, medidor, lecturas, cargos, vencimiento, total). **No copiar datos personales de muestras.** | KuDE según Manual Técnico **solo** para DTE aprobado |

Una boleta **puede** originar una factura. No son el mismo registro.

Campos conceptuales de la boleta (operativos, no fiscales por sí solos):

- Empresa: nombre, dirección, teléfono, RUC (de `companies`)
- Cliente: código, nombre, dirección, barrio, zona, categoría
- Medidor, periodo, días
- Lectura anterior / actual / consumo
- Detalle: mínimo, excedente, cargo fijo, otros
- Impuestos **según tarifa configurada** (no asumir IVA de un ejemplo impreso)
- Subtotal, impuestos, total, emisión, vencimiento

## 3. Motor de consumo (backend)

`ConsumptionCalculationService` (única implementación):

1. Consumo = lectura actual − anterior (si anomalía → no calcular factura automática).
2. Aplicar `tariff_rules` vigentes para la categoría/conexión en la fecha del periodo.
3. Cargo fijo, m³ mínimo, excedente, recargos, descuentos.
4. Impuestos según `tax_rates` asociados a la regla.
5. Persistencia en `consumption_calculations` (snapshot). Recalcular un periodo abierto regenera snapshot; uno cerrado no.

Tarifas y categorías son datos, no constantes de código.

## 4. Periodos

`ABIERTO` → lecturas → `EN_PROCESO` (cálculo) → `EN_REVISION` → `APROBADO` → generación de boletas → `FACTURADO` → `CERRADO`.

Reapertura: permiso especial + auditoría.

## 5. Timbrado y numeración

Campos: número de timbrado, vigencia, establecimiento, punto de expedición, tipo de documento, rango, siguiente número, estado.

Controles:

- Rechazar emisión si vencido o agotado.
- `SELECT … FOR UPDATE` para el siguiente número.
- Unique fiscal: jamás reutilizar número.
- El UUID interno nunca se imprime como número de factura.

Tipos de DE que el sistema **prepara** (códigos según documentación SIFEN / e-Kuatia; confirmar siempre contra el Manual Técnico vigente al implementar el XML):

- Factura electrónica
- Nota de crédito electrónica
- Nota de débito electrónica
- Autofactura y nota de remisión: tablas/adaptador listos; no son el flujo diario de la aguatería

La habilitación real de tipos la define el timbrado otorgado al contribuyente en Marangatu, no este software.

## 6. Arquitectura tributaria desacoplada

```
InvoiceService
    → TaxProvider (interfaz)
        → ParaguayTaxProvider
            → SifenProvider        transmisión SOAP/mTLS
            → DteService           armado XML según XSD vigente
            → CdcService           CDC según Manual Técnico
            → QrService            payload QR + CSC
            → KudeService          representación gráfica de un DTE *aprobado*
```

### Ambientes (oficiales)

- Pruebas: host `sifen-test.set.gov.py` — documentos **sin valor jurídico**.
- Producción: host `sifen.set.gov.py` — solo DTE aprobados tienen valor tributario.

Servicios documentados por DNIT (obtener WSDL con `?wsdl`):

- Recepción lote: `https://{ambiente}/de/ws/async/recibe-lote.wsdl`
- Consulta lote: `https://{ambiente}/de/ws/consultas/consulta-lote.wsdl`
- Consulta por CDC: `https://{ambiente}/de/ws/consultas/consulta.wsdl`
- Recepción síncrona: según Manual Técnico vigente (mismo dominio)

Transporte: SOAP 1.2, TLS 1.2, **autenticación mutua** con certificado de una PSC habilitada, `clientAuth`, XMLDSig enveloped.

### Estados internos (nunca “APROBADO” falso)

`BORRADOR` → `PENDIENTE` → `ENVIADO` → (`APROBADO` | `RECHAZADO`) ; también `CANCELADO` `ANULADO` `CONTINGENCIA`.

- Sin certificado / CSC / endpoints: `SIFEN_NOT_CONFIGURED`. El documento puede existir como factura interna **no enviada**. La UI dice “No enviado a SIFEN”, nunca “Aceptada por SIFEN”.
- SIFEN caído: `SIFEN_UNAVAILABLE`; reintento y registro del error. No se inventa aprobación.
- Rechazo: se guarda XML/código de respuesta; corrección según eventos/documentos rectificativos, no editando la factura emitida.

## 7. Integridad fiscal

Prohibido: borrar facturas emitidas, mutar montos/números, reutilizar numeración, duplicar pagos.

Corrección: nota de crédito / débito y eventos SIFEN aplicables (cancelación, inutilización, contingencia) según el Manual Técnico y la situación del DTE.

Trazabilidad: quién, cuándo, dispositivo, IP, XML, respuesta, eventos.

## 8. IVA y receptor

Tasas y tratamiento se leen de `tax_rates` y de la tarifa. El software no asume que el servicio de agua es siempre gravado al 10 % o siempre exento: eso lo configura el prestador con asesoría fiscal, alineado a la normativa vigente.

Receptor: RUC+DV (algoritmo módulo 11 publicado por DNIT) o CI según tipo de operacion configurado. Validar DV; no inventar RUC.

## 9. Contingencia

Campo y flujo preparados (`dte_documents.contingency`, numeración de contingencia). El uso real debe seguir el Manual Técnico vigente; no se activa un “modo contingencia” informal que finja validez.

## 10. Lo que el contribuyente debe aportar (no lo puede inventar el software)

1. Habilitación como facturador electrónico en Marangatu.
2. Timbrado electrónico de producción (el de test lo provee el equipo SIFEN).
3. Certificado digital PKCS#12 de PSC habilitada, con `clientAuth`.
4. CSC (Código de Seguridad del Contribuyente) para el QR.
5. Datos de establecimiento y puntos de expedición coincidentes con el RUC.
6. Decisión fiscal sobre gravamen del servicio de agua y textos legales de la boleta/factura.

Hasta entonces, el módulo emite **boletas de consumo** y **facturas internas en borrador/pendiente**, y deja explícito que no hay DTE aprobado.

## 11. ERSSAN

Marco: Ley 1614/2000 y Decreto 18880/2002. ERSSAN regula calidad, tarifas y derechos de usuarios.

El módulo `regulation` guarda documentos, tarifas presentadas/aprobadas e informes. **No genera automáticamente “obligaciones ERSSAN”** que no estén cargadas como documentos o parámetros configurados por la empresa.
