/**
 * Chorégraphie : transforme une transition de la machine à états en PHASES
 * d'animation, telles que mesurées sur l'iPhone (voir docs/mesures.md) :
 *
 *  - compact → split (V4727, V4729) : l'île se rétracte en se gonflant verticalement
 *    (« bosse »), puis s'élargit ; la bulle sort de son bord droit et s'en détache ;
 *  - split → compact (V4731) : la bulle rentre dans l'île, l'île se rétracte, puis s'élargit ;
 *  - autre changement d'activité (→ alerte, changement de contenu) : « retrait » vers la
 *    taille du repos, puis élargissement sans élan (v0 ≈ 0) ;
 *  - ouverture depuis compact/split (après l'appui long) : « contraction », puis ouverture ;
 *  - fermeture vers split : un seul bloc (île + bulle), puis la bulle se détache ;
 *  - repos ↔ compact, sortie d'alerte, fermeture : une seule phase.
 *
 * Astuce : la bulle est placée par rapport au bord droit de l'île. Quand l'île et l'écart
 * de la bulle suivent le MÊME ressort, la bulle reste immobile pendant que l'île se
 * retire d'elle — exactement l'effet « goutte qui se détache » de l'iPhone.
 *
 * Fonction pure (aucun rendu, aucun temps réel) : testée dans choregraphie.test.ts.
 */

import type { FormeEtat, IslandConfig, Ressort, RessortForme } from "../island.config";
import type { EtatMachine, Transition } from "../state/islandMachine";
import { preferencesActuelles, v } from "../config/store";
import { donnees } from "../bridge/donnees";
import { hauteurAlerte, largeurAlerte, mesureConfig, specAlerte } from "./alertes";

/** Géométrie de l'île en POINTS iPhone. */
export interface Geometrie {
  largeur: number;
  hauteur: number;
  rayon: number;
  exposant: number;
  /** Décalage horizontal du centre de l'île par rapport au centre de l'écran. */
  decalage: number;
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
  /** Repartir à vitesse nulle (mesuré après un « retrait » : v0 ≈ 0 dans V4731). */
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
    decalage: v(f.decalageXPt),
  };
}

function typePrincipal(e: EtatMachine) {
  return e.activites.find((a) => a.id === e.principaleId)?.type ?? null;
}

/**
 * Paroles affichées sous la caméra ? (musique en lecture, en compact, paroles trouvées,
 * préférence activée). L'île est alors aussi large qu'une alerte et a une 2e ligne.
 */
export function parolesVisibles(e: EtatMachine): boolean {
  if (e.mode !== "compact" || typePrincipal(e) !== "musique") return false;
  if (preferencesActuelles().paroles === false) return false;
  const d = donnees();
  return d.media?.statut === "lecture" && (d.paroles?.lignes.length ?? 0) > 0;
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
    case "compact": {
      // Musique et minuteur ont du contenu des deux côtés (capture « 14m »).
      const g = base(cfg.formesContenu.compactDeuxCotes);
      if (!parolesVisibles(e)) return g;
      // Paroles : largeur de l'alerte mesurée, ligne de texte sous la caméra.
      return {
        ...g,
        largeur: v(cfg.formes.alerte.taille.pt.largeur),
        hauteur: g.hauteur + v(cfg.alerte.texte.taillePt) * 1.25 + v(cfg.alerte.texteXPt) * 0.6,
      };
    }
    case "split":
      return base(cfg.formes.split, true);
    case "etendu":
      // Minuteur et appel : vue étendue basse (mesurée sur le minuteur, V4729).
      return base(typePrincipal(e) === "musique" ? cfg.formes.etendu : cfg.formesContenu.etenduMinuteur);
    case "alerte": {
      // Largeur selon le contenu, rangé de part et d'autre de la caméra (alertes.ts).
      const g = base(cfg.formes.alerte);
      if (!e.alerte) return g;
      const spec = specAlerte(e.alerte, cfg);
      return { ...g, largeur: largeurAlerte(spec, cfg, mesureConfig(cfg)), hauteur: hauteurAlerte(spec, cfg) };
    }
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
  const depart = geometrieCible(avant, cfg);
  const reposForme = geometrieForme(cfg.formes.repos);
  const ressort = cfg.ressorts[t.ressort];
  const retrait = v(cfg.choregraphie.retraitDureeMs);
  const contraction = v(cfg.choregraphie.contractionDureeMs);
  const bulle = cfg.bulle.ressort;
  const fondue = -v(cfg.bulle.diametrePt);
  const R = cfg.ressorts;

  const uneSeule = (): Plan => ({ phases: [{ debutMs: 0, cible, ressort, ressortBulle: bulle }], debutContenuMs: 0 });

  /** Taille du repos, bulle fondue dans l'île. */
  const versRepos = (r: RessortForme, bulleVisible = avant.mode === "split"): Phase => ({
    debutMs: 0,
    cible: { ...reposForme, bulleEcart: fondue, bulleVisible },
    ressort: r,
    ressortBulle: bulle,
  });

  switch (t.ressort) {
    case "ouvrir":
      if (avant.mode === "compact" || avant.mode === "split") {
        return {
          phases: [versRepos(R.contraction), { debutMs: contraction, cible, ressort, ressortBulle: bulle }],
          debutContenuMs: contraction,
        };
      }
      return uneSeule();

    case "fermer":
      if (apres.mode === "split") {
        // 1) Un seul bloc couvrant l'île ET la bulle (largeur et centre de l'ensemble),
        // 2) la bulle se détache : l'île se retire d'elle avec le même ressort.
        const ecart = v(cfg.bulle.ecartPt);
        const diam = v(cfg.bulle.diametrePt);
        const ensemble = cible.largeur + ecart + diam;
        const centreEnsemble = cible.decalage - cible.largeur / 2 + ensemble / 2;
        const separation = v(cfg.choregraphie.separationBulleMs);
        return {
          phases: [
            {
              debutMs: 0,
              cible: { ...cible, largeur: ensemble, decalage: centreEnsemble, bulleEcart: fondue, bulleVisible: false },
              ressort,
              ressortBulle: bulle,
            },
            {
              debutMs: separation,
              cible,
              ressort: { largeur: R.compactVersSplit.largeur, hauteur: ressort.hauteur },
              ressortBulle: R.compactVersSplit.largeur,
            },
          ],
          debutContenuMs: 0,
        };
      }
      return uneSeule();

    case "compactVersSplit": {
      if (avant.mode !== "compact") break;
      const s = cfg.choregraphie.split;
      const bosse = v(s.bosseHauteurPt);
      // Coins de la bosse : même proportion que le repos (forme de capsule).
      const rayonBosse = (reposForme.rayon / reposForme.hauteur) * bosse;
      const base = { ...reposForme, bulleEcart: fondue, bulleVisible: false };
      const enRetrait = { largeur: R.retrait.largeur, hauteur: R.retrait.hauteur };
      return {
        phases: [
          { debutMs: 0, cible: { ...base, hauteur: depart.hauteur, rayon: depart.rayon }, ressort: enRetrait },
          {
            debutMs: v(s.bosseDebutMs),
            cible: { ...base, hauteur: bosse, rayon: rayonBosse },
            ressort: { largeur: R.retrait.largeur, hauteur: R.bosse.hauteur },
          },
          {
            debutMs: v(s.bossePicMs),
            cible: { ...base, hauteur: cible.hauteur, rayon: cible.rayon },
            ressort: { largeur: R.retrait.largeur, hauteur: R.bosseRetour.hauteur },
          },
          {
            // L'île s'élargit et la bulle sort de son bord droit avec le même ressort.
            debutMs: v(s.croissanceDebutMs),
            cible,
            ressort: { largeur: R.croissanceSplit.largeur, hauteur: R.bosseRetour.hauteur },
            ressortBulle: R.croissanceSplit.largeur,
          },
        ],
        debutContenuMs: v(s.croissanceDebutMs),
      };
    }

    case "splitVersCompact": {
      if (avant.mode !== "split") break;
      const f = cfg.choregraphie.fusion;
      return {
        phases: [
          // 1) La bulle rentre dans l'île (l'île ne bouge pas encore).
          { debutMs: 0, cible: { ...depart, bulleEcart: fondue, bulleVisible: true }, ressort: R.retrait, ressortBulle: bulle },
          // 2) L'île se rétracte vers le repos.
          { debutMs: v(f.retraitDebutMs), cible: { ...reposForme, bulleEcart: fondue, bulleVisible: false }, ressort: R.retrait, ressortBulle: bulle },
          // 3) Puis s'élargit sans élan vers la nouvelle forme.
          { debutMs: v(f.croissanceDebutMs), cible, ressort, ressortBulle: bulle, vitesseNulle: true },
        ],
        debutContenuMs: v(f.croissanceDebutMs),
      };
    }

    default:
      break;
  }

  // Autres changements d'activité : retrait puis élargissement.
  if (["alerteEntree", "compactVersSplit", "splitVersCompact", "changementContenu"].includes(t.ressort)) {
    if (avant.mode === "repos") return uneSeule();
    return {
      phases: [versRepos(R.retrait), { debutMs: retrait, cible, ressort, ressortBulle: bulle, vitesseNulle: true }],
      debutContenuMs: retrait,
    };
  }
  return uneSeule();
}

/** Toutes les géométries par lesquelles passe un plan (pour réserver la zone d'affichage). */
export function geometriesDuPlan(plan: Plan): Geometrie[] {
  return plan.phases.map((p) => p.cible);
}
