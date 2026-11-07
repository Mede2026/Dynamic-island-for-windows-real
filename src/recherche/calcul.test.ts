import { describe, expect, it } from "vitest";
import { calculer, estCalcul } from "./calcul";

describe("calculatrice", () => {
  it("reconnaît un calcul", () => {
    expect(estCalcul("12*(3+4)")).toBe(true);
    expect(estCalcul("15 % de 80")).toBe(true);
    expect(estCalcul("Boucherville")).toBe(false);
    expect(estCalcul("2026")).toBe(false);
  });
  it("calcule", () => {
    expect(calculer("12*(3+4)")).toBe(84);
    expect(calculer("2^10")).toBe(1024);
    expect(calculer("3,5 × 2")).toBe(7);
    expect(calculer("15 % de 80")).toBe(12);
    expect(calculer("-4+10/4")).toBe(-1.5);
    expect(calculer("50%*200")).toBe(100);
    expect(calculer("2+")).toBeNull();
  });
});
