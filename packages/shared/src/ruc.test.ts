import { describe, expect, it } from "vitest";
import { calculateCheckDigit, formatRuc, isValidRuc, parseRucInput } from "./ruc.js";
import { addMoney, formatMoney, parseMoney, roundPyg } from "./money.js";

describe("RUC DV (algoritmo DNIT módulo 11)", () => {
  it("calcula DV conocido 80009735-1", () => {
    expect(calculateCheckDigit("80009735")).toBe(1);
  });

  it("calcula DV conocido 1946520-3", () => {
    expect(calculateCheckDigit("1946520")).toBe(3);
  });

  it("valida par número/DV", () => {
    expect(isValidRuc("80009735", "1")).toBe(true);
    expect(isValidRuc("80009735", "0")).toBe(false);
  });

  it("parsea RUC con DV o calcula el faltante", () => {
    expect(parseRucInput("80009735-1")).toEqual({ number: "80009735", dv: "1" });
    expect(parseRucInput("80009735")).toEqual({ number: "80009735", dv: "1" });
    expect(formatRuc("80009735", "1")).toBe("80009735-1");
  });
});

describe("dinero PYG", () => {
  it("suma sin errores de float", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(formatMoney(parseMoney("15000"))).toBe("15000.00");
  });

  it("redondea a guaraní entero", () => {
    expect(roundPyg("10.40", 0)).toBe("10.00");
    expect(roundPyg("10.50", 0)).toBe("11.00");
  });
});
