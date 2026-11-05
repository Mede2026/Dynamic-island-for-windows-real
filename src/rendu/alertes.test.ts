import { describe, expect, it } from "vitest";
import { islandConfig as cfg } from "../island.config";
import { cotesAlerte, largeurAlerte, mesureApprox, specAlerte, type Mesureur } from "./alertes";

describe("alertes rangées autour de la caméra", () => {
  // Largeurs mesurées sur V4731 img 706 : « En charge » 66,7 pt, « 98 % » 33,3 pt.
  const mesureIphone: Mesureur = (t) => (t === "En charge" ? 66.7 : 33.3);

  it("retrouve la largeur mesurée de l'alerte « En charge 98 % » (340,16 pt)", () => {
    const spec = specAlerte({ type: "chargeur", donnees: { presente: true, pourcentage: 98, branche: true, enCharge: true, economie: false } }, cfg);
    expect(largeurAlerte(spec, cfg, mesureIphone)).toBeCloseTo(340.16, 0);
  });

  it("une alerte courte est plus étroite, jamais plus large que l'alerte mesurée", () => {
    const vol = specAlerte({ type: "volume", donnees: { niveau: 0.62, muet: false } }, cfg);
    expect(largeurAlerte(vol, cfg, mesureApprox)).toBeLessThan(300);
    const notif = specAlerte({ type: "notification", donnees: { id: 1, application: "Une application au nom très long", textes: ["Un texte vraiment très très long"] } }, cfg);
    expect(largeurAlerte(notif, cfg, mesureApprox)).toBeLessThanOrEqual(cfg.formes.etendu.taille.pt.largeur! + 1e-9);
  });

  it("rien n'empiète sur la caméra", () => {
    const notif = specAlerte({ type: "notification", donnees: { id: 1, application: "Outil Capture d'écran", textes: ["Capture d'écran enregistrée"] } }, cfg);
    const c = cotesAlerte(notif, cfg, mesureApprox);
    const L = largeurAlerte(notif, cfg, mesureApprox);
    const bordCamera = (L - cfg.zoneCamera.largeurPt!) / 2;
    expect(c.gauche).toBeLessThanOrEqual(bordCamera + 1e-9);
    expect(c.droite).toBeLessThanOrEqual(bordCamera + 1e-9);
  });

  it("données absentes : pas de plantage", () => {
    for (const type of ["chargeur", "batterie", "volume", "neDerangePas", "notification", "pressePapiers", "minuteurTermine"] as const) {
      expect(largeurAlerte(specAlerte({ type }, cfg), cfg, mesureApprox)).toBeGreaterThan(0);
    }
  });
});
