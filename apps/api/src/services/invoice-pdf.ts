import { formatGs } from "../lib/money-format.js";
import { createSinglePagePdf, drawQrWithSideText } from "../lib/pdf-doc.js";

type Company = { legalName: string; tradeName: string; ruc: string; dv: string; address: string | null; phone: string | null };
type Customer = {
  code: string;
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  address: string | null;
  ruc: string | null;
  dv: string | null;
  ci: string | null;
};
type Invoice = {
  id: string;
  fiscalNumberFormatted: string | null;
  businessStatus: string;
  sifenStatus: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  issuedAt: Date | null;
};
type Item = { description: string; quantity: string; unitAmount: string; total: string };
type Debt = { description: string; amount: string };
type Payment = { amount: string; paidOn: string } | undefined;
type Method = { name: string } | undefined;

export function buildInvoicePdf(input: {
  company: Company;
  customer: Customer;
  invoice: Invoice;
  items: Item[];
  debts: Debt[];
  payment?: Payment;
  method?: Method;
  verifyUrl?: string;
  qrPng?: Buffer | null;
}): Promise<Buffer> {
  const customerName =
    input.customer.legalName ||
    [input.customer.firstName, input.customer.lastName].filter(Boolean).join(" ") ||
    input.customer.code;
  const ruc = input.customer.ruc ? `${input.customer.ruc}${input.customer.dv ? `-${input.customer.dv}` : ""}` : "—";

  return new Promise((resolve, reject) => {
    const doc = createSinglePagePdf();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).fillColor("#0f4c5c").text(input.company.tradeName);
    doc.fontSize(10).fillColor("#1a2332").text(input.company.legalName);
    doc.text(`RUC ${input.company.ruc}-${input.company.dv}`);
    if (input.company.address) doc.text(input.company.address);
    if (input.company.phone) doc.text(`Tel. ${input.company.phone}`);
    doc.moveDown();
    doc.fontSize(13).fillColor("#0f4c5c").text("FACTURA");
    if (input.invoice.businessStatus !== "EMITIDA") {
      doc.fontSize(9).fillColor("#5c6b73").text("Borrador interno. No es comprobante tributario DNIT/SIFEN hasta emitir con timbrado.");
    } else if (input.invoice.sifenStatus !== "APROBADO") {
      doc.fontSize(9).fillColor("#5c6b73").text("Documento interno emitido. SIFEN no está aprobado por DNIT.");
    }
    doc.moveDown();
    doc.fontSize(10).fillColor("#1a2332");
    if (input.invoice.fiscalNumberFormatted) doc.text(`N.º ${input.invoice.fiscalNumberFormatted}`);
    doc.text(`Estado: ${input.invoice.businessStatus}`);
    if (input.invoice.issuedAt) doc.text(`Emisión: ${input.invoice.issuedAt.toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text(`Cliente: ${customerName}    Código: ${input.customer.code}`);
    doc.text(`RUC: ${ruc}    CI/Pasaporte: ${input.customer.ci ?? "—"}`);
    doc.text(`Dirección: ${input.customer.address ?? "—"}`);
    if (input.payment) {
      doc.moveDown(0.4);
      doc.text(`Pago registrado: ${formatGs(input.payment.amount)}    Fecha: ${input.payment.paidOn}`);
      if (input.method) doc.text(`Forma de pago: ${input.method.name}`);
    }
    doc.moveDown();
    doc.fontSize(11).fillColor("#0f4c5c").text("Detalle de consumo y costos");
    doc.fontSize(10).fillColor("#1a2332");
    for (const item of input.items) {
      doc.text(`${item.description}    cant. ${item.quantity}    ${formatGs(item.total)}`);
    }
    doc.moveDown();
    doc.text(`Subtotal: ${formatGs(input.invoice.subtotal)}`);
    doc.text(`IVA: ${formatGs(input.invoice.taxAmount)}`);
    doc.fontSize(12).text(`TOTAL FACTURA: ${formatGs(input.invoice.total)}`);
    doc.moveDown();
    doc.fontSize(11).fillColor("#0f4c5c").text("Pendiente: consumo, cuotas próximas y conexión/instalación");
    doc.fontSize(8).fillColor("#5c6b73").text("No forma parte del total de esta factura. El anticipo ya se descontó del costo; las cuotas son el saldo.");
    doc.fontSize(10).fillColor("#1a2332");
    if (!input.debts.length) {
      doc.text("Sin saldos pendientes de conexión, cuotas u otras boletas.");
    } else {
      for (const d of input.debts) {
        doc.text(`${d.description}    ${formatGs(d.amount)}`);
      }
    }
    doc.moveDown();
    drawQrWithSideText(doc, {
      png: input.qrPng,
      lines: [
        "Factura interna del cobro. El código QR verifica este documento.",
        "No se marca como aprobada en SIFEN salvo respuesta de la DNIT.",
      ],
    });
    doc.end();
  });
}
