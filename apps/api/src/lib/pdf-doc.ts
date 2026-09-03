import PDFDocument from "pdfkit";

/** PDF de una sola hoja: no inserta páginas en blanco por desborde del cursor. */
export function createSinglePagePdf(options: PDFKit.PDFDocumentOptions = {}): PDFKit.PDFDocument {
  const { margin: _ignored, margins: _ignoredMargins, ...rest } = options;
  const doc = new PDFDocument({
    size: "A4",
    autoFirstPage: true,
    bufferPages: false,
    margins: { top: 36, left: 36, right: 36, bottom: 0 },
    ...rest,
  });
  if (doc.page) {
    doc.page.margins.top = 36;
    doc.page.margins.left = 36;
    doc.page.margins.right = 36;
    doc.page.margins.bottom = 0;
  }
  doc.addPage = function addPageLocked(this: PDFKit.PDFDocument) {
    return this;
  };
  return doc;
}

export function pdfPageCount(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g);
  return matches?.length ?? 0;
}

/** QR a la derecha; el texto queda a la izquierda, nunca encima ni detrás. */
export function drawQrWithSideText(
  doc: PDFKit.PDFDocument,
  opts: { png?: Buffer | null; lines: string[] },
): void {
  const left = doc.page.margins.left || 36;
  const right = doc.page.width - (doc.page.margins.right || 36);
  const qrSize = 96;
  const gap = 14;
  const qrX = right - qrSize;
  const qrY = doc.y;
  const textW = Math.max(120, qrX - left - gap);

  if (opts.png) {
    doc.save();
    doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 18).fill("#FFFFFF");
    doc.image(opts.png, qrX, qrY, { width: qrSize, height: qrSize });
    doc.font("Helvetica").fontSize(7).fillColor("#5c6b73").text("Verificación", qrX, qrY + qrSize + 2, {
      width: qrSize,
      align: "center",
      lineBreak: false,
    });
    doc.restore();
  }

  doc.font("Helvetica").fontSize(8).fillColor("#5c6b73");
  let textY = qrY;
  for (const line of opts.lines) {
    doc.text(line, left, textY, { width: textW });
    textY = doc.y + 4;
  }
  doc.y = Math.max(textY, qrY + qrSize + (opts.png ? 18 : 0)) + 8;
  doc.x = left;
}
