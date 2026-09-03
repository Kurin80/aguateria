import { formatGs } from "../lib/money-format.js";
import { createSinglePagePdf } from "../lib/pdf-doc.js";

type Company = {
  legalName: string;
  tradeName: string;
  ruc: string;
  dv: string;
  address: string | null;
  phone: string | null;
  email?: string | null;
};
type Customer = {
  code: string;
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  address: string | null;
  city?: string | null;
  department?: string | null;
  neighborhood?: string | null;
  idDocumentType?: string | null;
  ci?: string | null;
  ruc?: string | null;
  dv?: string | null;
};
type Connection = { code: string; accountNumber: string; address: string | null };
type Bill = {
  number: string;
  issuedOn: string;
  dueOn: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  balance?: string;
  status?: string;
};
type Item = { description: string; quantity: string; total: string; unitAmount?: string; code?: string };
type Reading = { previousReading: string; currentReading: string; consumptionM3: string } | undefined;
type Period = { name: string; startsOn: string; endsOn: string } | undefined;
type Establishment = { code: string; name: string; address?: string | null } | undefined;
type ChargeGrid = {
  minLiters: number;
  excessLiters: number;
  billedLiters: number;
  minPayable: string;
  excessPayable: string;
  total: string;
} | undefined;

const INK = "#0B1F2A";
const MUTED = "#5A6670";
const TEAL = "#0E5C5C";
const GOLD = "#C4A35A";
const SURFACE = "#F3F6F7";
const LINE = "#D5DDE1";
const QR_SIZE = 86;
const QR_BOX = 110;

function formatDatePy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function customerName(c: Customer): string {
  const legal = (c.legalName ?? "").trim();
  const parts = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return legal || parts || c.code;
}

function customerDocument(c: Customer): string {
  const type = (c.idDocumentType ?? "").toUpperCase();
  if (type === "RUC" || c.ruc) {
    const ruc = (c.ruc ?? "").trim();
    if (!ruc) return "RUC —";
    return c.dv ? `RUC ${ruc}-${c.dv}` : `RUC ${ruc}`;
  }
  if (type === "PASAPORTE") return `Pasaporte ${c.ci || "—"}`;
  return `CI ${c.ci || "—"}`;
}

function placeQr(
  doc: PDFKit.PDFDocument,
  png: Buffer,
  box: { x: number; y: number; w: number; h: number },
  caption: string,
) {
  doc.save();
  doc.rect(box.x, box.y, box.w, box.h).fill("#FFFFFF");
  doc.rect(box.x, box.y, box.w, box.h).lineWidth(0.8).stroke(INK);
  const pad = (box.w - QR_SIZE) / 2;
  doc.image(png, box.x + pad, box.y + 8, { width: QR_SIZE, height: QR_SIZE });
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(MUTED)
    .text(caption, box.x + 4, box.y + 8 + QR_SIZE + 4, {
      width: box.w - 8,
      align: "center",
      lineBreak: false,
    });
  doc.restore();
}

export function buildWaterBillPdf(input: {
  company: Company;
  customer: Customer;
  connection: Connection;
  bill: Bill;
  items: Item[];
  reading?: Reading;
  period?: Period;
  establishment?: Establishment;
  charges?: ChargeGrid;
  kind?: "CONSUMO" | "CREDITO";
  relatedBillNumber?: string;
  reason?: string | null;
  verifyUrl?: string;
  qrPng?: Buffer | null;
}): Promise<Buffer> {
  const isCredit = input.kind === "CREDITO";
  const name = customerName(input.customer);
  const supply = input.connection.address ?? input.customer.address ?? "—";
  const locality = [input.customer.neighborhood, input.customer.city, input.customer.department].filter(Boolean).join(" · ");

  return new Promise((resolve, reject) => {
    const doc = createSinglePagePdf({
      info: { Title: `Boleta ${input.bill.number}`, Author: input.company.legalName },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const left = 36;
    const right = pageW - 36;
    const contentW = right - left;
    const qrBox = { x: right - QR_BOX, y: 36, w: QR_BOX, h: 118 };
    const typeW = 150;
    const typeX = qrBox.x - 12 - typeW;
    const companyW = typeX - left - 12;

    const paintChrome = () => {
      const savedX = doc.x;
      const savedY = doc.y;
      doc.save();
      doc.rect(0, 0, pageW, 8).fill(TEAL);
      doc.rect(0, 8, pageW, 1.5).fill(GOLD);
      doc.rect(0, pageH - 48, pageW, 48).fill(INK);
      doc.rect(0, pageH - 48, pageW, 2).fill(GOLD);
      doc.font("Helvetica").fontSize(6.5).fillColor("#D5DEE2");
      doc.text(
        isCredit
          ? "Documento operativo de crédito. No es DTE ni factura electrónica SIFEN."
          : "Documento operativo de consumo. No es DTE ni factura electrónica SIFEN.",
        left,
        pageH - 36,
        {
        width: contentW,
        lineBreak: false,
        ellipsis: true,
      });
      doc.text("Identificación del emisor: RUC-DV DNIT. Moneda PYG. La factura con timbrado se emite al cobro.", left, pageH - 26, {
        width: contentW,
        lineBreak: false,
        ellipsis: true,
      });
      doc.restore();
      doc.x = savedX;
      doc.y = savedY;
    };
    paintChrome();

    let y = 22;
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(input.company.tradeName, left, y, { width: companyW });
    y = doc.y + 2;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(input.company.legalName, left, y, { width: companyW });
    y = doc.y + 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(`RUC ${input.company.ruc}-${input.company.dv}`, left, y, { width: companyW });
    y = doc.y + 3;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    if (input.establishment) {
      doc.text(`Establecimiento ${input.establishment.code} · ${input.establishment.name}`, left, y, { width: companyW });
      y = doc.y;
    }
    const issuerLines = [input.company.address, input.company.phone ? `Tel. ${input.company.phone}` : null, input.company.email].filter(Boolean).join("  ·  ");
    if (issuerLines) {
      doc.text(issuerLines, left, y, { width: companyW });
      y = doc.y;
    }

    const typeY = 22;
    const numOpts = { width: typeW - 12, align: "center" as const };
    doc.font("Helvetica-Bold").fontSize(7);
    const numH = Math.ceil(doc.heightOfString(input.bill.number, numOpts));
    const boxH = Math.max(86, 34 + numH + 22);
    doc.rect(typeX, typeY, typeW, boxH).lineWidth(1).stroke(INK);
    doc.rect(typeX, typeY, typeW, 16).fill(TEAL);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF").text(isCredit ? "BOLETA DE CRÉDITO" : "BOLETA DE CONSUMO", typeX, typeY + 4, { width: typeW, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(isCredit ? "Ajuste a favor · PYG" : "Agua potable · PYG", typeX, typeY + 20, { width: typeW, align: "center" });
    doc.font("Helvetica-Bold").fontSize(7).fillColor(INK).text(input.bill.number, typeX + 6, typeY + 34, numOpts);
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(`Emisión ${formatDatePy(input.bill.issuedOn)}`, typeX + 6, typeY + 34 + numH + 4, {
      width: typeW - 12,
      align: "center",
    });

    if (input.qrPng) {
      placeQr(doc, input.qrPng, qrBox, "Verificación");
    } else {
      doc.rect(qrBox.x, qrBox.y, qrBox.w, qrBox.h).lineWidth(0.8).stroke(LINE);
      doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("QR no disponible", qrBox.x, qrBox.y + 50, { width: qrBox.w, align: "center" });
    }

    y = Math.max(y, typeY + boxH, qrBox.y + qrBox.h) + 10;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).stroke(GOLD);
    y += 10;

    doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL).text("RECEPTOR", left, y);
    y = doc.y + 4;
    doc.rect(left, y, contentW, 62).fill(SURFACE);
    const col = contentW / 2;
    const row1 = y + 8;
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Nombre / razón social", left + 8, row1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(name, left + 8, row1 + 10, { width: col - 16 });
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Documento", left + col, row1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(customerDocument(input.customer), left + col, row1 + 10, { width: col - 16 });
    const row2 = y + 34;
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Código de cliente", left + 8, row2);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(input.customer.code, left + 8, row2 + 10);
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Cuenta / conexión", left + col, row2);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`${input.connection.accountNumber}  ·  ${input.connection.code}`, left + col, row2 + 10, { width: col - 16 });
    y += 70;
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(`Suministro: ${supply}`, left, y, { width: contentW });
    y = doc.y;
    if (locality) {
      doc.fontSize(8).fillColor(MUTED).text(locality, left, y, { width: contentW });
      y = doc.y;
    }
    if (isCredit && input.relatedBillNumber) {
      y = doc.y + 4;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(`Referencia: boleta ${input.relatedBillNumber}`, left, y, { width: contentW });
      y = doc.y;
    }
    if (isCredit && input.reason) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Motivo: ${input.reason}`, left, y, { width: contentW });
      y = doc.y;
    }

    y += 10;
    const meta = [
      ["Periodo", input.period ? `${input.period.name}  (${formatDatePy(input.period.startsOn)} – ${formatDatePy(input.period.endsOn)})` : "—"],
      ["Vencimiento", formatDatePy(input.bill.dueOn)],
      ["Estado", input.bill.status ?? "EMITIDA"],
    ];
    const metaW = contentW / 3;
    for (let i = 0; i < meta.length; i++) {
      const x = left + i * metaW;
      doc.rect(x, y, metaW - (i < 2 ? 6 : 0), 28).lineWidth(0.5).stroke(LINE);
      doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(meta[i]![0]!, x + 6, y + 4);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(meta[i]![1]!, x + 6, y + 14, { width: metaW - 14 });
    }
    y += 40;

    if (input.reading) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL).text("CONSUMO MEDIDO", left, y);
      y = doc.y + 4;
      const tiles = [
        ["Lectura anterior", input.reading.previousReading],
        ["Lectura actual", input.reading.currentReading],
        ["Consumo (m3)", input.reading.consumptionM3],
      ];
      const tw = contentW / 3;
      for (let i = 0; i < tiles.length; i++) {
        const x = left + i * tw;
        doc.rect(x, y, tw - (i < 2 ? 6 : 0), 36).fill(i === 2 ? TEAL : SURFACE);
        const color = i === 2 ? "#FFFFFF" : INK;
        const muted = i === 2 ? "#C9E4E4" : MUTED;
        doc.font("Helvetica").fontSize(7).fillColor(muted).text(tiles[i]![0]!, x + 8, y + 6);
        doc.font("Helvetica-Bold").fontSize(12).fillColor(color).text(tiles[i]![1]!, x + 8, y + 16);
      }
      y += 48;
    }

    if (input.charges && !isCredit) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL).text("CONSUMO EN LITROS E IMPORTES", left, y);
      y = doc.y + 4;
      const grid = [
        ["", "Mínimo", "Excedente", "Total"],
        ["Litros", String(input.charges.minLiters), String(input.charges.excessLiters), String(input.charges.billedLiters)],
        ["Importe", formatGs(input.charges.minPayable), formatGs(input.charges.excessPayable), formatGs(input.charges.total)],
      ];
      const gw = contentW / 4;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const x = left + col * gw;
          const h = 18;
          if (row === 0) doc.rect(x, y, gw, h).fill(INK);
          else if (row % 2 === 0) doc.rect(x, y, gw, h).fill(SURFACE);
          else doc.rect(x, y, gw, h).fill("#FFFFFF");
          doc.rect(x, y, gw, h).lineWidth(0.3).stroke(LINE);
          doc.font(row === 0 || col === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7);
          doc.fillColor(row === 0 ? "#FFFFFF" : INK).text(grid[row]![col]!, x + 4, y + 5, { width: gw - 8, align: col === 0 ? "left" : "right" });
        }
        y += 18;
      }
      y += 10;
    }

    doc.font("Helvetica-Bold").fontSize(7).fillColor(TEAL).text("DETALLE DE CARGOS", left, y);
    y = doc.y + 4;
    const cols = { desc: left, qty: left + 320, amount: right };
    doc.rect(left, y, contentW, 16).fill(INK);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#FFFFFF");
    doc.text("Descripción", cols.desc + 8, y + 4);
    doc.text("Cant.", cols.qty, y + 4, { width: 50, align: "right" });
    doc.text("Importe", cols.amount - 70, y + 4, { width: 62, align: "right" });
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor(INK);
    for (const [idx, item] of input.items.entries()) {
      if (idx % 2 === 1) doc.rect(left, y, contentW, 18).fill(SURFACE);
      doc.fillColor(INK).text(item.description, cols.desc + 8, y + 4, { width: 300 });
      doc.text(item.quantity, cols.qty, y + 4, { width: 50, align: "right" });
      doc.text(formatGs(item.total), cols.amount - 78, y + 4, { width: 70, align: "right" });
      y += 18;
    }
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.4).stroke(LINE);
    y += 10;

    const totalsX = right - 220;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 8).fillColor(INK);
      doc.text(label, totalsX, y, { width: 110 });
      doc.text(value, right - 90, y, { width: 90, align: "right" });
      y += bold ? 16 : 13;
    };
    line("Subtotal", formatGs(input.bill.subtotal));
    line("IVA / tributos (tarifa)", formatGs(input.bill.taxAmount));
    doc.rect(totalsX - 8, y - 2, 228, 22).fill(TEAL);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF");
    doc.text(isCredit ? "TOTAL ACREDITADO" : "TOTAL A PAGAR", totalsX, y + 4, { width: 110 });
    doc.text(formatGs(input.bill.total), right - 90, y + 4, { width: 90, align: "right" });

    doc.end();
  });
}
