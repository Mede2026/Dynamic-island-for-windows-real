/**
 * Chorégraphie : transforme une transition de la machine à états en PHASES
 * d'animation, telles que mesurées sur l'iPhone (voir docs/mesures.md) :
 *
 *  - changement d'activité (compact ↔ split, → alerte, changement de contenu) :
 *      1) « retrait » vers la taille du repos pendant retraitDureeMs,
 *      2) élargissement vers la nouvelle forme ;
 *  - ouverture depuis compact/split (après l'appui long) :
 *      1) « contraction » (la bulle se refond dans l'île) pendant contractionDureeMs,
 *      2) ouverture ;
 *  - fermeture vers split : la bulle se détache après separationBulleMs ;
 *  - repos ↔ compact, sortie d'alerte, fermeture : une seule phase.
 *
 * Fonction pure (aucun rendu, aucun temps réel) : testée dans choregraphie.test.ts.
 */

import type { FormeEtat, IslandConfig, Ressort, RessortForme } from "../island.config";
import type { EtatMachine, Transition } from "../state/islandMachine";
import { v } from "../config/store";

/** Géométrie de l'île en POINTS iPhone. */
export interface Geometrie {
  largeur: number;
  hauteur: number;
  rayon: number;
  exposant: number;
  /** Écart entre l'île et la bulle ; −diamètre = bulle fondue dans l'île. */
  bulleEcart: number;
  bulleVisible: boolean;
}

export interface Phase {
  debutMs: number;
  cible: Geometrie;
  ressort: RessortForme;
  /** Ressort de la bulle pour cette phase (sinon : celui de la forme). */
  ressortBulle?: Ressort;
  /**
   * Repartir à vitesse nulle : mesuré sur iPhone après un « retrait » (l'île repart de son
   * point bas sans élan, v0 ≈ 0 dans V4731).
   */
  vitesseNulle?: boolean;
}

export interface Plan {
  phases: Phase[];
  /** Instant (ms depuis le début) à partir duquel le NOUVEAU contenu peut apparaître. */
  debutContenuMs: number;
}

function geometrieForme(f: FormeEtat): Omit<Geometrie, "bulleEcart" | "bulleVisible"> {
  return {
    largeur: v(f.taille.pt.largeur),
    hauteur: v(f.taille.pt.hauteur),
    rayon: v(f.rayonPt),
    exposant: v(f.exposantCoins),
  };
}

function typePrincipal(e: EtatMachine) {
  return e.activites.find((a) => a.id === e.principaleId)?.type ?? null;
}

/** Forme finale pour un état de la machine. */
export function geometrieCible(e: EtatMachine, cfg: IslandConfig): Geometrie {
  const fondue = -v(cfg.bulle.diametrePt);
  const base = (f: FormeEtat, bulle = false): Geometrie => ({
    ...geometrieForme(f),
    bulleEcart: bulle ? v(cfg.bulle.ecartPt) : fondue,
    bulleVisible: bulle,
  });
  switch (e.mode) {
    case "repos":
      return base(cfg.formes.repos);
    case "compact":
      // Musique et minuteur ont du contenu des deux côtés (capture « 14m »).
      return base(cfg.formesContenu.compactDeuxCotes);
    case "split":
      return base(cfg.formes.split, true);
    case "etendu":
      return base(typePrincipal(e) === "minuteur" ? cfg.formesContenu.etenduMinuteur : cfg.formes.etendu);
    case "alerte":
      return base(cfg.formes.alerte);
  }
}

/** Le contenu affiché change-t-il d'identité (autre activité, autre alerte) ? */
export function cleContenu(e: EtatMachine): string {
  if (e.mode === "alerte") return `alerte:${e.alerte?.type}`;
  if (e.mode === "repos") return "repos";
  return `${e.mode}:${e.principaleId}:${e.bulleId ?? ""}`;
}

export function planifier(t: Transition, avant: EtatMachine, apres: EtatMachine, cfg: IslandConfig): Plan {
  const cible = geometrieCible(apres, cfg);
  const reposForme = geometrieForme(cfg.formes.repos);
  const ressort = cfg.ressorts[t.ressort];
  const retrait = v(cfg.choregraphie.retraitDureeMs);
  const contraction = v(cfg.choregraphie.contractionDureeMs);
  const bulle = cfg.bulle.ressort;
  const fondue = -v(cfg.bulle.diametrePt);

  const uneSeule = (): Plan => ({ phases: [{ debutMs: 0, cible, ressort, ressortBulle: bulle }], debutContenuMs: 0 });

  // Phase 1 commune : rétrécir vers le repos, bulle refondue dans l'île.
  const versRepos = (r: RessortForme): Phase => ({
    debutMs: 0,
    cible: { ...reposForme, bulleEcart: fondue, bulleVisible: avant.mode === "split" },
    ressort: r,
    ressortBulle: bulle,
  });

  switch (t.ressort) {
    case "ouvrir":
      if (avant.mode === "compact" || avant.mode === "split") {
        return {
          phases: [versRepos(cfg.ressorts.contraction), { debutMs: contraction, cible, ressort, ressortBulle: bulle }],
          debutContenuMs: contraction,
        };
      }
      return uneSeule();

    case "fermer":
      if (apres.mode === "split") {
        // La forme se ferme d'abord en un seul bloc (bulle fondue), puis la bulle se détache.
        const separation = v(cfg.choregraphie.separationBulleMs);
        return {
          phases: [
            // Bulle cachée pendant que la grande forme se referme (elle dépasserait des coins).
            { debutMs: 0, cible: { ...cible, bulleEcart: fondue, bulleVisible: false }, ressort, ressortBulle: bulle },
            { debutMs: separation, cible, ressort: cfg.ressorts.compactVersSplit, ressortBulle: bulle },
          ],
          debutContenuMs: 0,
        };
      }
      return uneSeule();

    case "alerteEntree":
    case "compactVersSplit":
    case "splitVersCompact":
    case "changementContenu":
      if (avant.mode === "repos") return uneSeule();
      return {
        phases: [versRepos(cfg.ressorts.retrait), { debutMs: retrait, cible, ressort, ressortBulle: bulle, vitesseNulle: true }],
        debutContenuMs: retrait,
      };

    default:
      return uneSeule();
  }
}
