import { describe, expect, it } from "vitest";
import { resolveCreditAmount } from "./water-bills.js";

describe("boleta de crédito", () => {
  it("usa el saldo entero si no se indica importe", () => {
    expect(resolveCreditAmount(undefined, "33000.00")).toBe(33000);
  });

  it("acepta un crédito parcial en Guaraníes enteros", () => {
    expect(resolveCreditAmount("10000", "33000.40")).toBe(10000);
  });

  it("rechaza un crédito mayor al saldo", () => {
    expect(() => resolveCreditAmount("40000", "33000")).toThrow();
  });
});
