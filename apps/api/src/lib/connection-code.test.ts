import { describe, expect, it } from "vitest";
import { formatConnectionCode } from "./connection-code.js";

describe("código de conexión", () => {
  it("genera CON-000001", () => {
    expect(formatConnectionCode(1)).toBe("CON-000001");
  });

  it("sigue la secuencia", () => {
    expect(formatConnectionCode(12)).toBe("CON-000012");
  });
});
