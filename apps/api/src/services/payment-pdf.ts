import { formatGs } from "../lib/money-format.js";
import { createSinglePagePdf, drawQrWithSideText } from "../lib/pdf-doc.js";

type Company = { legalName: string; tradeName: string; ruc: string; dv: string; address: string | null; phone: string | null };
type Customer = { code: string; firstName: string | null; lastName: string | null; legalName: string | null; address: string | null };
type Payment = { id: string; amount: string; paidOn: string; referenceNote: string | null; notes: string | null };
type Method = { name: string; code: string } | undefined;
type Allocation = { billNumber?: string | null; amount: string };

export function buildPaymentReceiptPdf(input: {
  company: Company;
  customer: Customer;
  payment: Payment;
  method?: Method;
  allocations: Allocation[];
  verifyUrl?: string;
  qrPng?: Buffer | null;
}): Promise<Buffer> {
  const customerName =
    input.customer.legalName ||
    [input.customer.firstName, input.customer.lastName].filter(Boolean).join(" ") ||
    input.customer.code;

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
    doc.fontSize(13).fillColor("#0f4c5c").text("COMPROBANTE DE PAGO / COBRO");
    doc.fontSize(9).fillColor("#5c6b73").text("Documento operativo de caja. No es factura electrónica DNIT/SIFEN.");
    doc.moveDown();
    doc.fontSize(10).fillColor("#1a2332");
    doc.text(`Comprobante: PAGO-${input.payment.id.slice(0, 8).toUpperCase()}`);
    doc.text(`Fecha: ${input.payment.paidOn}`);
    doc.text(`Cliente: ${customerName}    Código: ${input.customer.code}`);
    doc.text(`Forma de pago: ${input.method?.name ?? input.method?.code ?? "—"}`);
    if (input.payment.referenceNote) doc.text(`Referencia: ${input.payment.referenceNote}`);
    doc.moveDown();
    if (input.allocations.length) {
      doc.text("Aplicado a:");
      for (const row of input.allocations) {
        doc.text(`  ${row.billNumber ? `Boleta ${row.billNumber}` : "Cuenta / cuota"}    ${formatGs(row.amount)}`);
      }
      doc.moveDown();
    }
    doc.fontSize(12).text(`IMPORTE RECIBIDO: ${formatGs(input.payment.amount)}`);
    if (input.payment.notes) {
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Observación: ${input.payment.notes}`);
    }
    doc.moveDown();
    drawQrWithSideText(doc, {
      png: input.qrPng,
      lines: [
        "Comprobante de caja. El código QR verifica este cobro.",
        "La factura tributaria se emite en el mismo módulo de cobranza y facturación.",
        "No es factura electrónica DNIT/SIFEN.",
      ],
    });
    doc.end();
  });
}
