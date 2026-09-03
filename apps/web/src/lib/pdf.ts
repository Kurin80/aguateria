export async function openAuthenticatedPdf(path: string): Promise<void> {
  const token = sessionStorage.getItem("aguateria.access") ?? "";
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("No se pudo abrir el documento");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}
