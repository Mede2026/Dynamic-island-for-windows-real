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

import { normaliserMode } from "../ventilateurs/Ventilateurs";
describe("modes d'Asus Fan Control", () => {
  it("reconnaît les noms de mode, quelle que soit l'écriture", () => {
    expect(normaliserMode("Silent")).toBe("silent");
    expect(normaliserMode("MAX")).toBe("max");
    expect(normaliserMode("Curve")).toBe("curve");
    expect(normaliserMode("balanced")).toBe("normal");
    expect(normaliserMode("manual")).toBeNull();
    expect(normaliserMode(null)).toBeNull();
  });
});
