import { describe, expect, it } from "vitest";
import { analyserConversion } from "./conversion";

describe("convertisseur", () => {
  const r = (t: string) => {
    const c = analyserConversion(t);
    return c?.genre === "unite" ? Math.round(c.resultat * 1000) / 1000 : c;
  };
  it("unités", () => {
    expect(r("5 km en milles")).toBe(3.107);
    expect(r("100 °F en °C")).toBe(37.778);
    expect(r("3 tasses en ml")).toBe(709.765);
    expect(r("1,5 h en min")).toBe(90);
    expect(r("2 go en mo")).toBe(2048);
    expect(r("5 km en kg")).toBeNull();
    expect(r("Boucherville")).toBeNull();
  });
  it("devises", () => {
    expect(analyserConversion("20 usd en cad")).toEqual({ genre: "devise", valeur: 20, de: "USD", vers: "CAD" });
    expect(analyserConversion("50 € en $")).toEqual({ genre: "devise", valeur: 50, de: "EUR", vers: "CAD" });
  });
});
