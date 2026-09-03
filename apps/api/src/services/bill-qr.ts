import QRCode from "qrcode";

/** PNG del QR sin leyendas. El texto de verificación va fuera del código, en el PDF. */
export async function billQrPng(payload: string): Promise<Buffer | null> {
  const value = payload.trim();
  if (!value) return null;
  try {
    return await QRCode.toBuffer(value, {
      type: "png",
      margin: 2,
      width: 220,
      errorCorrectionLevel: "M",
      color: { dark: "#0B1F2A", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}
