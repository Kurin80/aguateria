import { useEffect, useState } from "react";
import { gpsBlockReason } from "../lib/field-capture";

export function FieldDeviceHint() {
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  useEffect(() => setGpsMsg(gpsBlockReason()), []);
  if (gpsMsg) {
    return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{gpsMsg}</p>;
  }
  return (
    <p className="text-sm text-slate-600">
      En el celular se usa el GPS y la cámara nativos. El navegador va a pedir permiso al guardar o al tomar la foto.
    </p>
  );
}

export function NativePhotoButton({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="relative mt-2 flex min-h-12 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-brand-800 px-4 text-sm font-medium text-white">
      <span className="pointer-events-none">{label}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 15 * 1024 * 1024) return;
          onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}
