import { api } from "../api/client";

export type GpsFix = { latitude: number; longitude: number; accuracyMeters: number; mocked?: boolean; capturedAt: string };

export function toSameOriginApiUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname.startsWith("/api/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return url;
  } catch {
    return url;
  }
}

function asGpsError(err: unknown): Error {
  const code = typeof err === "object" && err !== null && "code" in err ? Number((err as { code: number }).code) : NaN;
  if (code === 1) return new Error("Permiso de ubicación denegado. Habilitalo en el navegador para guardar.");
  if (code === 2) return new Error("No hay señal GPS. Activá la ubicación e intentá de nuevo.");
  if (code === 3) return new Error("El GPS tardó demasiado. Intentá de nuevo al aire libre.");
  if (err instanceof Error && err.message) return err;
  return new Error("No se pudo obtener GPS del dispositivo");
}

export function gpsBlockReason(): string | null {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return "Este dispositivo no ofrece geolocalización";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "El GPS del celular requiere HTTPS. En la PC, npm run dev muestra una URL https://…; abrila desde el teléfono y aceptá el certificado. En producción usá el dominio con HTTPS o la app Android.";
  }
  return null;
}

export async function captureGps(): Promise<GpsFix> {
  const blocked = gpsBlockReason();
  if (blocked) throw new Error(blocked);
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (err) => reject(asGpsError(err)), {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracyMeters: pos.coords.accuracy,
    mocked: Boolean((pos.coords as GeolocationCoordinates & { mocked?: boolean }).mocked),
    capturedAt: new Date().toISOString(),
  };
}

export async function compressPhoto(file: File, name = "evidencia.jpg"): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob) return file;
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadEvidencePhoto(
  file: File,
  purpose: "meter-photo" | "install-photo" | "disconnect-photo",
  fileName: string,
): Promise<string> {
  const compressed = await compressPhoto(file, fileName);
  const signed = await api<{ data: { fileId: string; uploadUrl: string } }>("/files/upload-url", {
    method: "POST",
    body: JSON.stringify({
      purpose,
      contentType: compressed.type || "image/jpeg",
      fileName: compressed.name || fileName,
    }),
  });
  const put = await fetch(toSameOriginApiUrl(signed.data.uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": compressed.type || "image/jpeg" },
    body: compressed,
  });
  if (!put.ok) {
    let detail = `HTTP ${put.status}`;
    try {
      const body = (await put.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(`No se pudo subir la fotografía (${detail})`);
  }
  return signed.data.fileId;
}
