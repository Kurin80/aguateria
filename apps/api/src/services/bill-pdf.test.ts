import { describe, expect, it } from "vitest";
import { pdfPageCount } from "../lib/pdf-doc.js";
import { buildWaterBillPdf } from "./bill-pdf.js";
import { billQrPng } from "./bill-qr.js";

describe("PDF de boleta", () => {
  it("genera un PDF con QR sin superponer el texto de verificación", async () => {
    const qrPng = await billQrPng("https://aguateria.local/api/bills/00000000-0000-0000-0000-000000000001/verify");
    expect(qrPng).toBeTruthy();
    const pdf = await buildWaterBillPdf({
      company: {
        legalName: "Prestador de Agua Potable S.A.",
        tradeName: "Aguatería",
        ruc: "80000000",
        dv: "8",
        address: "Asunción, Paraguay",
        phone: "021000000",
        email: "dev@aguateria.local",
      },
      customer: {
        code: "CLI-000001",
        firstName: "Wilson",
        lastName: "Zarate",
        legalName: "",
        address: "América casi Cañada",
        city: "Asunción",
        idDocumentType: "CI",
        ci: "3258999",
      },
      connection: { code: "CON-000008", accountNumber: "CON-000008", address: "América casi Cañada" },
      bill: {
        number: "BOL-2026-0001",
        issuedOn: "2026-09-02",
        dueOn: "2026-09-15",
        subtotal: "45000.00",
        taxAmount: "4500.00",
        total: "49500.00",
        balance: "49500.00",
        status: "EMITIDA",
      },
      items: [{ description: "Consumo de agua potable", quantity: "12.000", total: "45000.00" }],
      reading: { previousReading: "20.000", currentReading: "32.000", consumptionM3: "12.000" },
      period: { name: "Septiembre 2026", startsOn: "2026-09-01", endsOn: "2026-09-30" },
      establishment: { code: "001", name: "Casa central", address: "Asunción" },
      verifyUrl: "https://aguateria.local/api/bills/00000000-0000-0000-0000-000000000001/verify",
      qrPng,
    });
    expect(pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(4000);
    expect(pdfPageCount(pdf)).toBe(1);
    expect(pdf.includes(Buffer.from("Saldo pendiente"))).toBe(false);
    expect(pdf.includes(Buffer.from("https://aguateria.local/api/bills"))).toBe(false);
  });
});
