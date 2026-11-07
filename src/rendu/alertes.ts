/**
 * Alertes : contenu (à GAUCHE et à DROITE de la caméra) et largeur de l'île.
 *
 * Règle mesurée sur l'alerte « En charge 98 % » (V4731 img 706) :
 *   largeur = caméra + 2 × max(côté gauche, côté droit)
 *   côté = marge du bord + contenu + écart avant la caméra (18,9 pt)
 * → 340,3 pt calculés pour 340,16 pt mesurés. Rien n'est jamais dessiné devant la caméra.
 *
 * Module pur (testé) : la mesure du texte est injectée.
 */

import type { EtatBatterie, EtatNePasDeranger, EtatVolume, Notification } from "../bridge/types";
import type { PressePapiers } from "../bridge/donnees";
import type { IslandConfig } from "../island.config";
import type { Alerte } from "../state/islandMachine";
import { v } from "../config/store";

export type NomIcone = "volume" | "muet" | "lune" | "cloche" | "pressePapiers" | "minuteur" | "soleil";

export interface SpecAlerte {
  /** À gauche : miniature (capture d'écran), PNG base64. */
  miniature?: string;
  /** À gauche : icône et/ou libellé. */
  icone?: NomIcone;
  couleurIcone?: string;
  libelle?: string;
  /** À droite : valeur (et batterie). */
  valeur?: string;
  couleurValeur?: string;
  /** Deuxième ligne, SOUS la caméra (toute la largeur) : texte d'une notification. */
  detail?: string;
  /** Texte servant à mesurer la valeur (ex. « 100 % ») pour une largeur stable. */
  valeurReference?: string;
  batterie?: { niveau: number; couleur: string; enCharge: boolean };
}

/** Largeur d'un texte (pt) : (texte, taille pt, graisse, chiffres à chasse fixe) → largeur pt. */
export type Mesureur = (texte: string, taillePt: number, graisse: number, tabulaire?: boolean) => number;

/** Mesure approximative (tests, ou avant le chargement de la police). */
export const mesureApprox: Mesureur = (t, taille) => t.length * taille * 0.56;

let sonde: HTMLSpanElement | null = null;
/**
 * Mesure réelle, dans la page, d'un texte stylé EXACTEMENT comme à l'affichage (contenus.tsx) :
 * même police, même taille en px (Inter change de dessin selon la taille : axe « taille
 * optique »), même espacement des lettres, mêmes chiffres. `echelle` = px CSS par point
 * (taille de l'île choisie) : mesurer en points purs donnait un texte plus étroit qu'à
 * l'affichage dès que l'île est agrandie → « Texte co… ».
 */
export function mesureNavigateur(
  police: string,
  suiviEm: (taillePx: number) => number = () => 0,
  echelle = 1,
): Mesureur {
  return (t, taille, graisse, tabulaire = false) => {
    if (typeof document === "undefined" || !document.body) return mesureApprox(t, taille, graisse);
    if (!sonde) {
      sonde = document.createElement("span");
      sonde.setAttribute("aria-hidden", "true");
      Object.assign(sonde.style, {
        position: "absolute",
        left: "-10000px",
        top: "0",
        visibility: "hidden",
        whiteSpace: "nowrap",
        lineHeight: "1",
        pointerEvents: "none",
      });
    }
    if (!sonde.isConnected) document.body.appendChild(sonde);
    const px = taille * echelle;
    sonde.style.fontFamily = police;
    sonde.style.fontSize = `${px}px`;
    sonde.style.fontWeight = String(graisse);
    sonde.style.letterSpacing = `${suiviEm(px)}em`;
    sonde.style.fontVariantNumeric = tabulaire ? "tabular-nums" : "normal";
    sonde.textContent = t;
    const largeur = sonde.getBoundingClientRect().width;
    return largeur > 0 ? largeur / echelle : mesureApprox(t, taille, graisse);
  };
}

/** Mesureur avec la police, l'espacement des lettres ET la taille de l'île de la config. */
export function mesureConfig(cfg: IslandConfig): Mesureur {
  const ty = cfg.typographie;
  return mesureNavigateur(
    v(cfg.police),
    (taille) => v(ty.suiviA) + v(ty.suiviB) * Math.exp(v(ty.suiviC) * taille),
    v(cfg.ISLAND_SCALE),
  );
}

export function specAlerte(alerte: Alerte, cfg: IslandConfig): SpecAlerte {
  const a = cfg.alerte;
  const blanc = v(a.texte.couleur);
  switch (alerte.type) {
    case "chargeur": {
      const b = { pourcentage: null, branche: true, ...(alerte.donnees as Partial<EtatBatterie>) } as EtatBatterie;
      const niveau = (b.pourcentage ?? 100) / 100;
      return {
        libelle: b.branche ? "En charge" : "Sur batterie",
        valeur: b.pourcentage !== null ? `${b.pourcentage} %` : undefined,
        couleurValeur: b.branche ? v(a.valeurCouleur) : blanc,
        batterie: { niveau, couleur: b.branche ? v(a.batterieCouleur) : blanc, enCharge: b.branche },
      };
    }
    case "batterie": {
      const b = { pourcentage: null, ...(alerte.donnees as Partial<EtatBatterie>) } as EtatBatterie;
      return {
        libelle: "Batterie", // « Batterie faible » ne tient pas à côté de la caméra
        valeur: `${b.pourcentage ?? "?"} %`,
        couleurValeur: v(a.batterieFaibleCouleur),
        batterie: { niveau: (b.pourcentage ?? 0) / 100, couleur: v(a.batterieFaibleCouleur), enCharge: false },
      };
    }
    case "volume": {
      const vol = { niveau: 0, muet: false, ...(alerte.donnees as Partial<EtatVolume>) };
      return {
        icone: vol.muet ? "muet" : "volume",
        valeur: vol.muet ? "Muet" : `${Math.round(vol.niveau * 100)} %`,
        valeurReference: "100 %",
      };
    }
    case "neDerangePas": {
      const n = { actif: true, ...(alerte.donnees as Partial<EtatNePasDeranger>) };
      return {
        icone: "lune",
        valeur: n.actif ? "Ne pas déranger" : "Désactivé",
        couleurValeur: n.actif ? blanc : v(cfg.media.etendu.artiste.couleur),
      };
    }
    case "notification": {
      const n = { application: "", textes: [], ...(alerte.donnees as Partial<Notification>) } as Notification;
      // Ligne 1 (à côté de la caméra) : l'app ; ligne 2 (sous la caméra) : le texte.
      // Pas d'icône : le nom de l'app a besoin de toute la place à gauche de la caméra.
      return { libelle: n.application || "Notification", detail: n.textes.join(" — ") || undefined };
    }
    case "pressePapiers": {
      const p = { type: "autre", apercu: "", ...(alerte.donnees as Partial<PressePapiers>) } as PressePapiers;
      const libelles = { texte: "Texte copié", image: "Image copiée", capture: "Capture copiée", fichiers: "Fichiers copiés", autre: "Copié" };
      return { icone: "pressePapiers", valeur: libelles[p.type] };
    }
    case "capture": {
      const p = { miniature: null, ...(alerte.donnees as Partial<PressePapiers>) };
      return p.miniature ? { miniature: p.miniature, valeur: "Capture" } : { icone: "pressePapiers", valeur: "Capture" };
    }
    case "luminosite": {
      const n = typeof alerte.donnees === "number" ? alerte.donnees : 50;
      return { icone: "soleil", valeur: `${Math.round(n)} %`, valeurReference: "100 %" };
    }
    case "minuteurTermine":
      return {
        icone: "minuteur",
        couleurIcone: v(cfg.minuteur.couleur),
        valeur: "Terminé",
        couleurValeur: v(cfg.minuteur.couleur),
      };
  }
}

/** Taille d'une icône d'alerte (pt) : un peu plus grande que le texte. */
export function tailleIcone(cfg: IslandConfig): number {
  return v(cfg.alerte.texte.taillePt) * 1.15;
}

/**
 * Miniature d'une capture : même hauteur que la pochette compacte (V4728 img 417), format
 * d'écran 16:9 (la vraie image est recadrée pour tenir dedans).
 */
export function hauteurMiniature(cfg: IslandConfig): number {
  return v(cfg.media.compact.pochetteTaillePt);
}
export function largeurMiniature(cfg: IslandConfig): number {
  return (hauteurMiniature(cfg) * 16) / 9;
}

/** Écart entre l'icône et le libellé (pt). */
export const ECART_ICONE_PT = 6;

export interface Cotes {
  gauche: number;
  droite: number;
  /** Place maximale pour le texte de chaque côté (pt). */
  libelleMax: number;
  valeurMax: number;
}

/** Largeur de chaque côté (pt), de la bordure de l'île jusqu'à la caméra. */
export function cotesAlerte(spec: SpecAlerte, cfg: IslandConfig, mesurer: Mesureur): Cotes {
  const a = cfg.alerte;
  const t = v(a.texte.taillePt);
  const g = v(a.texte.graisse);
  const ecart = v(cfg.zoneCamera.margePt);
  // Au plus la largeur de la vue étendue (mesurée) : Inter est un peu plus large que SF Pro.
  const largeurMax = v(cfg.formes.etendu.taille.pt.largeur);
  const coteMax = (largeurMax - v(cfg.zoneCamera.largeurPt)) / 2;

  const debutGauche = spec.miniature
    ? v(cfg.media.compact.pochetteXPt) + largeurMiniature(cfg)
    : v(a.texteXPt) + (spec.icone ? tailleIcone(cfg) + (spec.libelle ? ECART_ICONE_PT : 0) : 0);
  const libelle = spec.libelle ? mesurer(spec.libelle, t, g) : 0;
  const finDroite = v(a.batterieDroitePt) + (spec.batterie ? v(a.batterieLargeurPt) + v(a.ecartValeurBatteriePt) : 0);
  const valeur = spec.valeur ? Math.max(mesurer(spec.valeur, t, g, true), spec.valeurReference ? mesurer(spec.valeurReference, t, g, true) : 0) : 0;
  const gauche = Math.min(debutGauche + libelle + ecart, coteMax);
  const droite = Math.min(finDroite + valeur + ecart, coteMax);
  // Place réelle de chaque côté = moitié de l'île moins la caméra (+2 pt : arrondis de rendu,
  // pris sur l'écart de 18,9 pt avant la caméra).
  // Notification sur deux lignes : l'île prend toute la largeur → toute la place du côté.
  const cote = spec.detail ? coteMax : Math.max(gauche, droite);
  return {
    gauche,
    droite,
    libelleMax: cote - debutGauche - ecart + 2,
    valeurMax: cote - finDroite - ecart + 2,
  };
}

/** Largeur de l'île pour cette alerte (pt) : jamais plus large que l'alerte mesurée. */
/** Hauteur de l'alerte : une ligne (mesurée) ou deux lignes (texte sous la caméra). */
export function hauteurAlerte(spec: SpecAlerte, cfg: IslandConfig): number {
  const h = v(cfg.formes.alerte.taille.pt.hauteur);
  if (!spec.detail) return h;
  // Ligne sous la caméra + même marge en bas que la marge gauche du texte.
  return h + v(cfg.alerte.texte.taillePt) * 1.25 + v(cfg.alerte.texteXPt) * 0.6;
}

/** Ligne de base du détail (pt depuis le haut de l'île). */
export function baselineDetail(cfg: IslandConfig): number {
  return v(cfg.zoneCamera.hauteurPt) + v(cfg.alerte.texte.taillePt) * 0.95;
}

export function largeurAlerte(spec: SpecAlerte, cfg: IslandConfig, mesurer: Mesureur): number {
  if (spec.detail) return v(cfg.formes.etendu.taille.pt.largeur); // texte sur toute la largeur
  const c = cotesAlerte(spec, cfg, mesurer);
  const camera = v(cfg.zoneCamera.largeurPt);
  const min = v(cfg.formes.compact.taille.pt.largeur);
  return Math.max(min, camera + 2 * Math.max(c.gauche, c.droite));
}
