/**
 * island.config.ts — LE SEUL fichier qui contient des valeurs visuelles.
 *
 * Règles :
 *  - Phase 1 : toutes les valeurs valent `null` (rien n'est deviné).
 *  - Phase 2 : chaque nombre est remplacé par une mesure. Sa source
 *    (fichier vidéo/capture + numéro d'image) est notée dans docs/mesures.md.
 *  - Aucun autre fichier du projet n'a le droit de contenir une taille,
 *    un rayon, une couleur, une durée d'animation ou un ressort.
 *
 * Vocabulaire :
 *  - « pt »  = point iPhone (1 pt = 3 px sur un iPhone 15 Pro, écran @3x).
 *  - « DIP » = pixel indépendant de Windows (1 DIP = 1 px à 100 % d'échelle).
 *  - Ressort « Framer Motion » : stiffness (raideur), damping (amortissement), mass (masse).
 *  - Ressort « Apple » : response (période en s), dampingFraction (0 = rebondit sans fin, 1 = aucun rebond).
 */

/** Une valeur qui sera mesurée en phase 2. `null` = pas encore mesurée. */
export type Mesure<T> = T | null;

/** Les 5 états visuels de l'île (voir src/state/islandMachine.ts). */
export type EtatIle = "repos" | "compact" | "split" | "etendu" | "alerte";

/** Les transitions qui ont chacune leur propre ressort (ouvrir ≠ fermer). */
export type NomTransition =
  | "apparition" //       repos   → compact (une activité démarre)
  | "disparition" //      compact → repos   (fin de la dernière activité)
  | "ouvrir" //           compact → etendu  (appui long)
  | "fermer" //           etendu  → compact (clic à l'extérieur)
  | "compactVersSplit" // compact → split   (2e activité)
  | "splitVersCompact" // split   → compact (fin d'une des deux activités)
  | "alerteEntree" //     *       → alerte
  | "alerteSortie" //     alerte  → *
  | "changementContenu"; // même état, contenu différent (ex. : changement de piste)

export interface Taille {
  largeur: Mesure<number>;
  hauteur: Mesure<number>;
}

/** Une taille donnée en points iPhone ET en DIP Windows (dip = pt × ISLAND_SCALE). */
export interface TailleDouble {
  pt: Taille;
  dip: Taille;
}

export interface Ressort {
  // Format Framer Motion
  stiffness: Mesure<number>;
  damping: Mesure<number>;
  mass: Mesure<number>;
  // Équivalent Apple (SwiftUI .spring(response:dampingFraction:))
  response: Mesure<number>;
  dampingFraction: Mesure<number>;
}

export interface FormeEtat {
  taille: TailleDouble;
  /** Rayon des coins (pt). */
  rayonPt: Mesure<number>;
  /**
   * Lissage des coins continus (squircle), 0 = arc de cercle simple,
   * 1 = lissage maximal (style « continuous corners » d'Apple).
   */
  lissageCoins: Mesure<number>;
}

export interface ContenuAnimation {
  /** Délai entre le début du mouvement de la forme et l'apparition du contenu (ms). */
  delaiApparitionMs: Mesure<number>;
  /** Durée du fondu d'apparition du contenu (ms). */
  dureeFonduEntreeMs: Mesure<number>;
  /** Durée du fondu de disparition du contenu (ms). */
  dureeFonduSortieMs: Mesure<number>;
  /** Flou de départ du contenu (px CSS). */
  flouDepartPx: Mesure<number>;
  /** Échelle de départ du contenu (1 = taille normale). */
  echelleDepart: Mesure<number>;
  /**
   * Avance (ms) avec laquelle le contenu disparaît AVANT que la forme rapetisse
   * (« ordre à la fermeture »).
   */
  avanceDisparitionMs: Mesure<number>;
}

export interface IslandConfig {
  /** Facteur global iPhone (pt) → Windows (DIP). Choisi par le propriétaire en phase 2. */
  ISLAND_SCALE: Mesure<number>;

  /** Distance entre le haut de l'écran et le haut de l'île (pt). */
  margeHautPt: Mesure<number>;

  /** Couleur de la pilule (CSS, ex. "#000000"). */
  couleurPilule: Mesure<string>;

  /** Forme par état. */
  formes: Record<EtatIle, FormeEtat>;

  /** Ressort de la forme par transition. */
  ressorts: Record<NomTransition, Ressort>;

  /** Animation du contenu (fondu + flou + échelle). */
  contenu: ContenuAnimation;

  /** Mode split : bulle séparée à droite de l'île principale. */
  bulle: {
    diametrePt: Mesure<number>;
    /** Espace entre l'île principale et la bulle (pt). */
    ecartPt: Mesure<number>;
    /** Effet goutte (metaball) : flou du filtre SVG feGaussianBlur (stdDeviation, px). */
    goutteFlouPx: Mesure<number>;
    /** Effet goutte : feColorMatrix, multiplicateur du canal alpha. */
    goutteAlphaMultiplicateur: Mesure<number>;
    /** Effet goutte : feColorMatrix, décalage du canal alpha. */
    goutteAlphaDecalage: Mesure<number>;
  };

  /** Appui court : compression puis rebond. */
  appui: {
    /** Échelle au moment le plus compressé (ex. 0.9x). */
    echelleCompression: Mesure<number>;
    ressortCompression: Ressort;
    ressortRetour: Ressort;
  };

  /** Contenu média. */
  media: {
    /** Taille de la pochette en mode compact (pt). */
    pochetteCompactPt: Mesure<number>;
    /** Taille de la pochette en mode étendu (pt). */
    pochetteEtenduPt: Mesure<number>;
    /** Rayon des coins de la pochette (pt). */
    pochetteRayonPt: Mesure<number>;
    /** Lueur autour de l'île, à la couleur de la pochette : opacité 0–1. */
    lueurOpacite: Mesure<number>;
    /** Lueur : rayon de flou (pt). */
    lueurFlouPt: Mesure<number>;
    /** Onde sonore : nombre de barres. */
    ondeNombreBarres: Mesure<number>;
    /** Onde sonore : largeur d'une barre (pt). */
    ondeLargeurBarrePt: Mesure<number>;
    /** Onde sonore : hauteur min / max d'une barre (pt). */
    ondeHauteurMinPt: Mesure<number>;
    ondeHauteurMaxPt: Mesure<number>;
    /** Taille du texte titre / artiste (pt). Police : Inter. */
    policeTitrePt: Mesure<number>;
    policeArtistePt: Mesure<number>;
  };

  /** Durées de comportement (utilisées par la machine à états). */
  durees: {
    /** Seuil d'un appui long (ms). */
    clicLongSeuilMs: Mesure<number>;
    /** Temps d'affichage d'une alerte avant le retour automatique (ms). */
    alerteAffichageMs: Mesure<number>;
    /** Fermeture automatique de la vue étendue quand le curseur la quitte (ms). */
    etenduFermetureAutoMs: Mesure<number>;
  };
}

// ---------------------------------------------------------------------------
// Fabriques (pour ne pas répéter 40 fois les mêmes blocs de `null`)
// ---------------------------------------------------------------------------

const ressortNonMesure = (): Ressort => ({
  stiffness: null, // MESURÉ EN PHASE 2 — vidéo (voir la transition)
  damping: null, // MESURÉ EN PHASE 2 — vidéo (voir la transition)
  mass: null, // MESURÉ EN PHASE 2 — vidéo (voir la transition)
  response: null, // MESURÉ EN PHASE 2 — vidéo (voir la transition)
  dampingFraction: null, // MESURÉ EN PHASE 2 — vidéo (voir la transition)
});

const formeNonMesuree = (): FormeEtat => ({
  taille: {
    pt: { largeur: null, hauteur: null }, // MESURÉ EN PHASE 2 — capture Cx
    dip: { largeur: null, hauteur: null }, // MESURÉ EN PHASE 2 — pt × ISLAND_SCALE
  },
  rayonPt: null, // MESURÉ EN PHASE 2 — capture Cx
  lissageCoins: null, // MESURÉ EN PHASE 2 — capture Cx (profil des coins)
});

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

export const islandConfig: IslandConfig = {
  ISLAND_SCALE: null, // MESURÉ EN PHASE 2 — choisi par le propriétaire

  margeHautPt: null, // MESURÉ EN PHASE 2 — capture C1 / vidéo V1
  couleurPilule: null, // MESURÉ EN PHASE 2 — capture C1 / vidéo V1

  formes: {
    repos: formeNonMesuree(), // MESURÉ EN PHASE 2 — capture C1, vidéo V1
    compact: formeNonMesuree(), // MESURÉ EN PHASE 2 — capture C2, vidéo V2
    split: formeNonMesuree(), // MESURÉ EN PHASE 2 — capture C4, vidéo V4
    etendu: formeNonMesuree(), // MESURÉ EN PHASE 2 — capture C3, vidéo V3
    alerte: formeNonMesuree(), // MESURÉ EN PHASE 2 — vidéo réelle (iPhone) si disponible
  },

  ressorts: {
    apparition: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V2
    disparition: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V7
    ouvrir: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V3
    fermer: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V3
    compactVersSplit: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V4
    splitVersCompact: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V4
    alerteEntree: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo réelle (iPhone) si disponible
    alerteSortie: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo réelle (iPhone) si disponible
    changementContenu: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V6
  },

  contenu: {
    delaiApparitionMs: null, // MESURÉ EN PHASE 2 — vidéo V2 / V3
    dureeFonduEntreeMs: null, // MESURÉ EN PHASE 2 — vidéo V2 / V3
    dureeFonduSortieMs: null, // MESURÉ EN PHASE 2 — vidéo V3 / V7
    flouDepartPx: null, // MESURÉ EN PHASE 2 — vidéo V3
    echelleDepart: null, // MESURÉ EN PHASE 2 — vidéo V3
    avanceDisparitionMs: null, // MESURÉ EN PHASE 2 — vidéo V3 / V7
  },

  bulle: {
    diametrePt: null, // MESURÉ EN PHASE 2 — capture C4, vidéo V4
    ecartPt: null, // MESURÉ EN PHASE 2 — capture C4, vidéo V4
    goutteFlouPx: null, // MESURÉ EN PHASE 2 — vidéo V4
    goutteAlphaMultiplicateur: null, // MESURÉ EN PHASE 2 — vidéo V4
    goutteAlphaDecalage: null, // MESURÉ EN PHASE 2 — vidéo V4
  },

  appui: {
    echelleCompression: null, // MESURÉ EN PHASE 2 — vidéo V5
    ressortCompression: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V5
    ressortRetour: ressortNonMesure(), // MESURÉ EN PHASE 2 — vidéo V5
  },

  media: {
    pochetteCompactPt: null, // MESURÉ EN PHASE 2 — capture C2
    pochetteEtenduPt: null, // MESURÉ EN PHASE 2 — capture C3
    pochetteRayonPt: null, // MESURÉ EN PHASE 2 — capture C3
    lueurOpacite: null, // MESURÉ EN PHASE 2 — capture C3
    lueurFlouPt: null, // MESURÉ EN PHASE 2 — capture C3
    ondeNombreBarres: null, // MESURÉ EN PHASE 2 — capture C2
    ondeLargeurBarrePt: null, // MESURÉ EN PHASE 2 — capture C2
    ondeHauteurMinPt: null, // MESURÉ EN PHASE 2 — vidéo V2
    ondeHauteurMaxPt: null, // MESURÉ EN PHASE 2 — vidéo V2
    policeTitrePt: null, // MESURÉ EN PHASE 2 — capture C3
    policeArtistePt: null, // MESURÉ EN PHASE 2 — capture C3
  },

  durees: {
    clicLongSeuilMs: null, // MESURÉ EN PHASE 2 — vidéo V3
    alerteAffichageMs: null, // MESURÉ EN PHASE 2 — vidéo réelle (iPhone) si disponible
    etenduFermetureAutoMs: null, // MESURÉ EN PHASE 2 — vidéo V3
  },
};

// ---------------------------------------------------------------------------
// Outils de vérification
// ---------------------------------------------------------------------------

/**
 * Liste les chemins des valeurs encore `null` (ex. "formes.repos.rayonPt").
 * En phase 2, le test de complétude exige une liste vide.
 */
export function valeursNonMesurees(obj: unknown = islandConfig, prefixe = ""): string[] {
  if (obj === null) return [prefixe];
  if (typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([cle, val]) =>
    valeursNonMesurees(val, prefixe ? `${prefixe}.${cle}` : cle),
  );
}

/** Liste les chemins de toutes les feuilles (valeurs finales) de la configuration. */
export function toutesLesValeurs(obj: unknown = islandConfig, prefixe = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefixe];
  return Object.entries(obj as Record<string, unknown>).flatMap(([cle, val]) =>
    toutesLesValeurs(val, prefixe ? `${prefixe}.${cle}` : cle),
  );
}
