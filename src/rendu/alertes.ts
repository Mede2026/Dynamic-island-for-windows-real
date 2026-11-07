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

import type {
  AppareilBluetooth,
  CategorieBluetooth,
  EtatBatterie,
  EtatNePasDeranger,
  EtatVolume,
  LecteurUsb,
  Notification,
  Reconnaissance,
  Verrouillage,
} from "../bridge/types";
import type { PressePapiers } from "../bridge/donnees";
import type { IslandConfig } from "../island.config";
import type { Alerte } from "../state/islandMachine";
import { v } from "../config/store";

export type NomIcone =
  | "volume"
  | "muet"
  | "lune"
  | "cloche"
  | "pressePapiers"
  | "minuteur"
  | "soleil"
  | "majuscules"
  | "numerique"
  | "usb"
  | "casque"
  | "clavier"
  | "souris"
  | "manette"
  | "telephone"
  | "bluetooth"
  | "telechargement"
  | "wifi"
  | "wifiCoupe"
  | "oeil"
  | "note";

const ICONES_BLUETOOTH: Record<CategorieBluetooth, NomIcone> = {
  audio: "casque",
  clavier: "clavier",
  souris: "souris",
  manette: "manette",
  telephone: "telephone",
  autre: "bluetooth",
};

export interface SpecAlerte {
  /** À gauche : miniature (capture d'écran), PNG base64. */
  miniature?: string;
  /** À gauche : image carrée depuis une adresse (pochette d'une chanson reconnue). */
  pochetteUrl?: string;
  /** À gauche : icône et/ou libellé. */
  icone?: NomIcone;
  couleurIcone?: string;
  libelle?: string;
  /** À droite : valeur (et batterie). */
  valeur?: string;
  couleurValeur?: string;
  /** Deuxième ligne, SOUS la caméra (toute la largeur) : texte d'une notification. */
  detail?: string;
  /** Détail en blanc et gras (nom d'appareil déplacé sous la caméra) plutôt qu'en gris. */
  detailFort?: boolean;
  /** Texte servant à mesurer la valeur (ex. « 100 % ») pour une largeur stable. */
  valeurReference?: string;
  batterie?: { niveau: number; couleur: string; enCharge: boolean };
  /** La valeur est un bouton : copier un code, ouvrir un fichier téléchargé. */
  action?: { type: "copier"; texte: string } | { type: "ouvrir"; chemin: string } | { type: "lien"; url: string };
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

/**
 * Contenu d'une alerte. Si le libellé (nom d'un appareil, d'une clé USB…) ne tient pas à
 * gauche de la caméra, il passe sur une 2e ligne SOUS la caméra au lieu d'être coupé.
 */
export function specAlerte(alerte: Alerte, cfg: IslandConfig, mesurer: Mesureur = mesureConfig(cfg)): SpecAlerte {
  const spec = specBrute(alerte, cfg);
  if (!spec.libelle || spec.detail || spec.miniature) return spec;
  const t = v(cfg.alerte.texte.taillePt);
  const coteMax = (v(cfg.formes.etendu.taille.pt.largeur) - v(cfg.zoneCamera.largeurPt)) / 2;
  const debut = v(cfg.alerte.texteXPt) + (spec.icone ? tailleIcone(cfg) + ECART_ICONE_PT : 0);
  const besoin = debut + mesurer(spec.libelle, t, v(cfg.alerte.texte.graisse)) + v(cfg.zoneCamera.margePt);
  if (besoin <= coteMax) return spec;
  return { ...spec, libelle: undefined, detail: spec.libelle, detailFort: true };
}

function specBrute(alerte: Alerte, cfg: IslandConfig): SpecAlerte {
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
      const n = { application: "", textes: [], ...(alerte.donnees as Partial<Notification & { code: string }>) } as Notification & {
        code?: string;
      };
      // Ligne 1 (à côté de la caméra) : l'app ; ligne 2 (sous la caméra) : le texte.
      // Pas d'icône : le nom de l'app a besoin de toute la place à gauche de la caméra.
      const spec: SpecAlerte = { libelle: n.application || "Notification", detail: n.textes.join(" — ") || undefined };
      // Code de vérification : à droite, en vert, un clic le copie.
      if (n.code) return { ...spec, valeur: n.code, couleurValeur: v(a.valeurCouleur), action: { type: "copier", texte: n.code } };
      return spec;
    }
    case "chanson": {
      const r = { etape: "erreur", titre: null, artiste: null, pochette: null, lien: null, ...(alerte.donnees as Partial<Reconnaissance>) } as Reconnaissance;
      const gris = v(cfg.media.etendu.artiste.couleur);
      if (r.etape !== "trouvee") {
        return {
          icone: "note",
          couleurIcone: gris,
          libelle: "Chanson",
          valeur: r.etape === "introuvable" ? "Introuvable" : "Pas de connexion",
          couleurValeur: gris,
        };
      }
      // Pochette à gauche, « Trouvée » à droite (clic : la page de la chanson), titre et
      // artiste sur la 2e ligne, sous la caméra.
      return {
        pochetteUrl: r.pochette ?? undefined,
        icone: r.pochette ? undefined : "note",
        valeur: "Trouvée",
        couleurValeur: v(a.valeurCouleur),
        detail: [r.titre, r.artiste].filter(Boolean).join(" — ") || "Chanson",
        detailFort: true,
        action: r.lien ? { type: "lien", url: r.lien } : undefined,
      };
    }
    case "internet": {
      const i = { connecte: true, nom: null, ...(alerte.donnees as Partial<{ connecte: boolean; nom: string | null }>) };
      return i.connecte
        ? { icone: "wifi", libelle: i.nom || "Internet", valeur: "Connecté", couleurValeur: v(a.valeurCouleur) }
        : { icone: "wifiCoupe", couleurIcone: v(a.batterieFaibleCouleur), libelle: "Internet", valeur: "Hors ligne", couleurValeur: v(a.batterieFaibleCouleur) };
    }
    case "pause": {
      const bouger = (alerte.donnees as { genre?: string } | undefined)?.genre === "bouger";
      return bouger
        ? { icone: "oeil", libelle: "Pause", valeur: "1 heure", detail: "Lève-toi et bouge un peu, l'écran peut attendre." }
        : { icone: "oeil", libelle: "Pause des yeux", valeur: "20 s", detail: "Regarde au loin (6 m) pendant 20 secondes." };
    }
    case "telechargementTermine": {
      const t = { nom: "", chemin: "", ...(alerte.donnees as Partial<{ nom: string; chemin: string }>) };
      return {
        icone: "telechargement",
        couleurIcone: v(a.valeurCouleur),
        libelle: t.nom || "Téléchargement",
        valeur: "Ouvrir",
        couleurValeur: v(a.valeurCouleur),
        action: t.chemin ? { type: "ouvrir", chemin: t.chemin } : undefined,
      };
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
    case "verrouillage": {
      const k = { touche: "majuscules", actif: true, ...(alerte.donnees as Partial<Verrouillage>) } as Verrouillage;
      return {
        icone: k.touche === "majuscules" ? "majuscules" : "numerique",
        couleurIcone: k.actif ? blanc : v(cfg.media.etendu.artiste.couleur),
        libelle: k.touche === "majuscules" ? "Verr. Maj" : "Verr. Num",
        valeur: k.actif ? "Activé" : "Désactivé",
        couleurValeur: k.actif ? blanc : v(cfg.media.etendu.artiste.couleur),
        valeurReference: "Désactivé",
      };
    }
    case "usb": {
      const u = { branche: true, lettre: "", nom: "", amovible: true, ...(alerte.donnees as Partial<LecteurUsb>) } as LecteurUsb;
      return {
        icone: "usb",
        couleurIcone: u.branche ? blanc : v(cfg.media.etendu.artiste.couleur),
        libelle: u.nom || (u.amovible ? "Clé USB" : "Disque externe"),
        valeur: u.branche ? u.lettre || "Branché" : "Retiré",
        couleurValeur: u.branche ? blanc : v(cfg.media.etendu.artiste.couleur),
      };
    }
    case "bluetooth": {
      const b = {
        nom: "Appareil",
        connecte: true,
        categorie: "autre",
        batterie: null,
        ...(alerte.donnees as Partial<AppareilBluetooth>),
      } as AppareilBluetooth;
      const gris = v(cfg.media.etendu.artiste.couleur);
      // Comme les écouteurs sur iPhone : nom à gauche, batterie à droite (si connue).
      if (b.connecte && b.batterie !== null) {
        const faible = b.batterie <= 20;
        const couleur = faible ? v(a.batterieFaibleCouleur) : v(a.batterieCouleur);
        return {
          icone: ICONES_BLUETOOTH[b.categorie],
          libelle: b.nom,
          valeur: `${b.batterie} %`,
          couleurValeur: faible ? couleur : blanc,
          valeurReference: "100 %",
          batterie: { niveau: b.batterie / 100, couleur, enCharge: false },
        };
      }
      return {
        icone: ICONES_BLUETOOTH[b.categorie],
        couleurIcone: b.connecte ? blanc : gris,
        libelle: b.nom,
        valeur: b.connecte ? "Connecté" : "Déconnecté",
        couleurValeur: b.connecte ? blanc : gris,
      };
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

  const debutGauche = spec.pochetteUrl
    ? v(cfg.media.compact.pochetteXPt) + hauteurMiniature(cfg)
    : spec.miniature
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
