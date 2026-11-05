import { describe, expect, it } from "vitest";
import { islandConfig, toutesLesValeurs, valeursNonMesurees } from "./island.config";

describe("contrat de configuration (phase 1)", () => {
  it("contient des valeurs à mesurer", () => {
    expect(toutesLesValeurs().length).toBeGreaterThan(50);
  });

  // PHASE 1 : aucune valeur visuelle ne doit être devinée.
  // PHASE 2 : remplacer ce test par `expect(valeursNonMesurees()).toEqual([])`.
  it("PHASE 1 — toutes les valeurs sont encore null", () => {
    expect(valeursNonMesurees()).toEqual(toutesLesValeurs());
  });

  it("valeursNonMesurees donne des chemins lisibles", () => {
    expect(valeursNonMesurees()).toContain("formes.repos.rayonPt");
    expect(valeursNonMesurees()).toContain("ressorts.ouvrir.stiffness");
    expect(islandConfig.ISLAND_SCALE).toBeNull();
  });
});
