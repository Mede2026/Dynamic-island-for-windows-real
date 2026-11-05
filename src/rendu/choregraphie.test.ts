import { describe, expect, it } from "vitest";
import { islandConfig } from "../island.config";
import { etatInitial, reduire, type Durees, type EtatMachine, type Evenement } from "../state/islandMachine";
import { cleContenu, geometrieCible, planifier } from "./choregraphie";

const D: Durees = { alerteAffichageMs: 1000, etenduFermetureAutoMs: 500 };

function suite(...evs: Evenement[]): EtatMachine[] {
  const etats = [etatInitial()];
  for (const e of evs) etats.push(reduire(etats[etats.length - 1]!, e, D).etat);
  return etats;
}

const musique: Evenement = { type: "ACTIVITE_DEBUT", activite: { id: "musique", type: "musique" } };
const minuteur: Evenement = { type: "ACTIVITE_DEBUT", activite: { id: "minuteur", type: "minuteur" } };
const cfg = islandConfig;

describe("géométrie cible", () => {
  it("décalages horizontaux mesurés (split : île à gauche du centre)", () => {
    const [repos, , split] = suite(musique, minuteur);
    expect(geometrieCible(repos!, cfg).decalage).toBe(0);
    expect(geometrieCible(split!, cfg).decalage).toBe(cfg.formes.split.decalageXPt);
    expect(cfg.formes.split.decalageXPt!).toBeLessThan(0);
  });

  it("chaque état a la taille mesurée", () => {
    const [repos, compact, split, etendu] = suite(musique, minuteur, { type: "CLIC_LONG" });
    expect(geometrieCible(repos!, cfg).largeur).toBe(cfg.formes.repos.taille.pt.largeur);
    expect(geometrieCible(compact!, cfg).largeur).toBe(cfg.formesContenu.compactDeuxCotes.taille.pt.largeur);
    const g = geometrieCible(split!, cfg);
    expect(g.largeur).toBe(cfg.formes.split.taille.pt.largeur);
    expect(g.bulleVisible).toBe(true);
    expect(g.bulleEcart).toBe(cfg.bulle.ecartPt);
    expect(geometrieCible(etendu!, cfg).hauteur).toBe(cfg.formes.etendu.taille.pt.hauteur);
  });

  it("minuteur étendu : forme moins haute", () => {
    const etats = suite(minuteur, { type: "CLIC_LONG" });
    expect(geometrieCible(etats[2]!, cfg).hauteur).toBe(cfg.formesContenu.etenduMinuteur.taille.pt.hauteur);
  });
});

describe("plans", () => {
  it("repos → compact : une seule phase (ressort « apparition »)", () => {
    const [a, b] = suite(musique);
    const p = planifier(b!.transition!, a!, b!, cfg);
    expect(p.phases).toHaveLength(1);
    expect(p.phases[0]!.ressort).toBe(cfg.ressorts.apparition);
  });

  it("compact → split : retrait, bosse verticale, puis élargissement (V4727/V4729)", () => {
    const [, a, b] = suite(musique, minuteur);
    const p = planifier(b!.transition!, a!, b!, cfg);
    const s = cfg.choregraphie.split;
    expect(p.phases.map((x) => x.debutMs)).toEqual([0, s.bosseDebutMs, s.bossePicMs, s.croissanceDebutMs]);
    expect(p.phases[0]!.cible.largeur).toBe(cfg.formes.repos.taille.pt.largeur);
    expect(p.phases[1]!.cible.hauteur).toBe(s.bosseHauteurPt);
    expect(p.phases[3]!.cible.bulleVisible).toBe(true);
    expect(p.phases[3]!.cible.decalage).toBe(cfg.formes.split.decalageXPt);
    // L'île et la bulle suivent le même ressort : la bulle se détache sans glisser.
    expect(p.phases[3]!.ressortBulle).toBe(p.phases[3]!.ressort.largeur);
    expect(p.debutContenuMs).toBe(s.croissanceDebutMs);
  });

  it("split → compact : la bulle rentre, retrait, puis élargissement sans élan (V4731)", () => {
    const [, , a, b] = suite(musique, minuteur, { type: "ACTIVITE_FIN", id: "minuteur" });
    const p = planifier(b!.transition!, a!, b!, cfg);
    const f = cfg.choregraphie.fusion;
    expect(p.phases.map((x) => x.debutMs)).toEqual([0, f.retraitDebutMs, f.croissanceDebutMs]);
    expect(p.phases[0]!.cible.largeur).toBe(cfg.formes.split.taille.pt.largeur);
    expect(p.phases[0]!.cible.bulleEcart).toBe(-cfg.bulle.diametrePt!);
    expect(p.phases[2]!.vitesseNulle).toBe(true);
  });

  it("appui long en split : contraction (bulle fondue) puis ouverture", () => {
    const [, , a, b] = suite(musique, minuteur, { type: "CLIC_LONG" });
    const p = planifier(b!.transition!, a!, b!, cfg);
    expect(p.phases[0]!.cible.bulleEcart).toBe(-cfg.bulle.diametrePt!);
    expect(p.phases[0]!.ressort).toBe(cfg.ressorts.contraction);
    expect(p.phases[1]!.debutMs).toBe(cfg.choregraphie.contractionDureeMs);
    expect(p.phases[1]!.ressort).toBe(cfg.ressorts.ouvrir);
  });

  it("fermeture vers split : bloc unique (île + bulle) puis la bulle se détache", () => {
    const [, , , a, b] = suite(musique, minuteur, { type: "CLIC_LONG" }, { type: "CLIC_EXTERIEUR" });
    const p = planifier(b!.transition!, a!, b!, cfg);
    expect(p.phases[0]!.cible.bulleEcart).toBe(-cfg.bulle.diametrePt!);
    // Le bloc couvre l'île + l'écart + la bulle, et son bord droit = celui de la bulle finale.
    const bloc = p.phases[0]!.cible;
    const fin = p.phases[1]!.cible;
    expect(bloc.decalage + bloc.largeur / 2).toBeCloseTo(fin.decalage + fin.largeur / 2 + fin.bulleEcart + cfg.bulle.diametrePt!, 6);
    expect(p.phases[1]!.debutMs).toBe(cfg.choregraphie.separationBulleMs);
    expect(p.phases[1]!.cible.bulleEcart).toBe(cfg.bulle.ecartPt);
  });

  it("alerte depuis le repos : directe ; depuis compact : retrait d'abord", () => {
    const [a, b] = suite({ type: "ALERTE", alerte: { type: "chargeur" } });
    expect(planifier(b!.transition!, a!, b!, cfg).phases).toHaveLength(1);
    const [, c, d] = suite(musique, { type: "ALERTE", alerte: { type: "chargeur" } });
    expect(planifier(d!.transition!, c!, d!, cfg).phases).toHaveLength(2);
  });

  it("clé de contenu : change avec l'activité affichée", () => {
    const [r, c, s] = suite(musique, minuteur);
    expect(new Set([cleContenu(r!), cleContenu(c!), cleContenu(s!)]).size).toBe(3);
  });
});
