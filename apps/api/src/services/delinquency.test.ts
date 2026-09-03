import { describe, expect, it } from "vitest";
import { moraBucket } from "./delinquency.js";

describe("tramos de mora", () => {
  it("clasifica 0/1/2/3 meses", () => {
    expect(moraBucket(0)).toBe("AL_DIA");
    expect(moraBucket(1)).toBe("1_MES");
    expect(moraBucket(2)).toBe("2_MESES");
    expect(moraBucket(3)).toBe("3_O_MAS");
  });
});
