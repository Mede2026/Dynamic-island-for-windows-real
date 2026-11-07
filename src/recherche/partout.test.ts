import { describe, expect, it } from "vitest";
import { correspondance, estQuestion, reglagesPour } from "./partout";

describe("recherche partout", () => {
  it("reconnaît les questions", () => {
    expect(estQuestion("comment marche un arc-en-ciel")).toBe(true);
    expect(estQuestion("capitale du Japon ?")).toBe(true);
    expect(estQuestion("why is the sky blue")).toBe(true);
    expect(estQuestion("spotify")).toBe(false);
    expect(estQuestion("15 % de 80")).toBe(false);
  });
  it("trouve les réglages de Windows, avec ou sans accents", () => {
    expect(reglagesPour("bluetooth")[0]?.uri).toBe("ms-settings:bluetooth");
    expect(reglagesPour("luminosite")[0]?.uri).toBe("ms-settings:display");
    expect(correspondance("Paramètres", "param")).toBe(80);
    expect(correspondance("Spotify", "xyz")).toBe(0);
  });
});
