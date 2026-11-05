import { describe, expect, it } from "vitest";
import { islandConfig, toutesLesValeurs, valeursNonMesurees } from "./island.config";

describe("contrat de configuration (phase 2)", () => {
  it("PHASE 2 — plus aucune valeur null", () => {
    expect(valeursNonMesurees()).toEqual([]);
    expect(toutesLesValeurs().length).toBeGreaterThan(100);
  });

  it("DIP = pt × ISLAND_SCALE pour chaque forme", () => {
    const s = islandConfig.ISLAND_SCALE!;
    for (const f of [...Object.values(islandConfig.formes), ...Object.values(islandConfig.formesContenu)]) {
      expect(f.taille.dip.largeur).toBeCloseTo(f.taille.pt.largeur! * s, 6);
      expect(f.taille.dip.hauteur).toBeCloseTo(f.taille.pt.hauteur! * s, 6);
    }
  });

  it("chaque ressort est cohérent entre format Apple et Framer Motion", () => {
    const ressorts = [
      ...Object.values(islandConfig.ressorts).flatMap((r) => [r.largeur, r.hauteur]),
      islandConfig.bulle.ressort,
      islandConfig.appui.ressortRetour,
    ];
    for (const r of ressorts) {
      const w = (2 * Math.PI) / r.response!;
      expect(r.stiffness! / (w * w)).toBeCloseTo(1, 2);
      expect(r.damping! / (2 * r.dampingFraction! * w)).toBeCloseTo(1, 2);
      expect(r.mass).toBe(1);
    }
  });
});
