import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit.js";

function ctx(headers: Record<string, string>) {
  return { req: { header: (n: string) => headers[n.toLowerCase()] } };
}

describe("clientIp", () => {
  it("toma la primera IP de x-forwarded-for (la que pone el proxy de Vercel)", () => {
    expect(clientIp(ctx({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
  });

  it("no se deja envenenar por entradas extra que agregue el cliente", () => {
    // El cliente antepone basura; Vercel igual pone la IP real primero.
    expect(clientIp(ctx({ "x-forwarded-for": "198.51.100.9,evil" }))).toBe("198.51.100.9");
  });

  it("cae a x-real-ip cuando no hay x-forwarded-for", () => {
    expect(clientIp(ctx({ "x-real-ip": "192.0.2.5" }))).toBe("192.0.2.5");
  });

  it("devuelve 'local' cuando no hay cabeceras de IP", () => {
    expect(clientIp(ctx({}))).toBe("local");
  });
});
