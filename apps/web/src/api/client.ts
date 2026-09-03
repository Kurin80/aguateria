const TOKEN_KEY = "aguateria.access";
const REFRESH_KEY = "aguateria.refresh";

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setTokens(access: string, refresh: string): void {
  sessionStorage.setItem(TOKEN_KEY, access);
  sessionStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Refresh de un solo vuelo: varias peticiones que reciben 401 a la vez comparten la misma rotación. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const stored = sessionStorage.getItem(REFRESH_KEY);
  if (!stored) return null;
  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: stored }),
      });
      if (!res.ok) {
        clearTokens();
        return null;
      }
      const json = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
      setTokens(json.data.accessToken, json.data.refreshToken);
      return json.data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && sessionStorage.getItem(REFRESH_KEY) && path !== "/auth/refresh") {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.set("Authorization", `Bearer ${newAccess}`);
      res = await fetch(`/api${path}`, { ...init, headers });
    }
  }
  const body = await parse(res);
  if (!res.ok) {
    const err = body as { error?: { code?: string; message?: string } };
    throw new ApiError(res.status, err.error?.code ?? "ERROR", err.error?.message ?? res.statusText);
  }
  return body as T;
}
