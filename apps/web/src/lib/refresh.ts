import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Marca y recarga ya, incluidas las consultas que no están en pantalla. */
export async function refreshNow(qc: QueryClient, ...keys: QueryKey[]): Promise<void> {
  await Promise.all(
    keys.map((queryKey) =>
      qc.invalidateQueries({
        queryKey,
        refetchType: "all",
      }),
    ),
  );
}
