/**
 * island.config.ts — LE SEUL fichier qui contient des valeurs visuelles.
 *
 * PHASE 2 : toutes les valeurs viennent des mesures faites sur les enregistrements
 * d'écran d'un iPhone 16 Pro (iOS 27, 402 x 874 pt) fournis par le propriétaire.
 * Source de chaque nombre (vidéo + numéros d'image) : docs/mesures.md
 * (données brutes : docs/mesures.json, script : tools/mesurer_reference.py).
 *
 * Vocabulaire :
 *  - « pt »  = point iPhone.   « DIP » = pixel indépendant de Windows (= px CSS dans la page).
 *  - DIP = pt × ISLAND_SCALE. Les proportions sont donc toujours exactes ; seule la taille
 *    globale dépend de ISLAND_SCALE (réglable dans le panneau Ctrl+Alt+D).
 *  - Ressort « Apple » : response (s), dampingFraction (ζ). « Framer Motion » : stiffness,
 *    damping, mass (stiffness = (2π/response)², damping = 4π·ζ/response, mass = 1).
 *  - Coins : chaque coin est une superellipse d'« étendue » a (pt) et d'exposant n
 *    (n = 2 : arc de cercle ; n > 2 : coin « continu » façon Apple).
 *
 * Abréviations des sources : V4727…V4731 = IMG_4727…4731.MP4, « img » = numéro d'image.
 */

export type Mesure<T> = T | null;

export type EtatIle = "repos" | "compact" | "split" | "etendu" | "alerte";

export type NomTransition =
  | "apparition" //       repos   → compact
  | "disparition" //      compact → repos
  | "ouvrir" //           → étendu
  | "fermer" //           étendu  → compact / split
  | "compactVersSplit" // compact → split (île principale)
  | "splitVersCompact" // split   → compact
  | "alerteEntree" //     → alerte
  | "alerteSortie" //     alerte  → compact / repos
  | "changementContenu" // même forme, autre activité
  | "retrait" //          1re phase « rétractation » avant un changement d'activité
  | "contraction" //      1re phase avant l'ouverture (après l'appui long)
  | "bosse" //            compact → split : l'île se gonfle verticalement pendant le retrait
  | "bosseRetour" //      … puis redescend
  | "croissanceSplit"; // … puis s'élargit et laisse la bulle se détacher

export interface Taille {
  largeur: Mesure<number>;
  hauteur: Mesure<number>;
}

export interface TailleDouble {
  pt: Taille;
  dip: Taille;
}

export interface Ressort {
  stiffness: Mesure<number>;
  damping: Mesure<number>;
  mass: Mesure<number>;
  response: Mesure<number>;
  dampingFraction: Mesure<number>;
}

/** iOS anime largeur et hauteur avec des ressorts parfois différents (ex. fermeture). */
export interface RessortForme {
  largeur: Ressort;
  hauteur: Ressort;
}

export interface FormeEtat {
  taille: TailleDouble;
  /** Étendue a du coin (pt) : distance sur laquelle le bord est courbé. */
  rayonPt: Mesure<number>;
  /** Exposant n de la superellipse du coin (2 = cercle, > 2 = coin continu). */
  exposantCoins: Mesure<number>;
  /** Décalage horizontal du centre de l'île par rapport au centre de l'écran (pt, négatif = à gauche). */
  decalageXPt: Mesure<number>;
}

export interface ContenuAnimation {
  /** Délai entre le début du mouvement de la forme et l'apparition du contenu (ms). */
  delaiApparitionMs: Mesure<number>;
  dureeFonduEntreeMs: Mesure<number>;
  /** Délai entre le début du mouvement de la forme et le début de la disparition (ms). */
  delaiDisparitionMs: Mesure<number>;
  dureeFonduSortieMs: Mesure<number>;
  /** Flou (écart type, pt) du contenu au début de son apparition. */
  flouDepartPt: Mesure<number>;
  echelleDepart: Mesure<number>;
}

export interface Texte {
  taillePt: Mesure<number>;
  graisse: Mesure<number>;
  couleur: Mesure<string>;
}

export interface IslandConfig {
  /** DIP Windows par point iPhone. */
  ISLAND_SCALE: Mesure<number>;
  margeHautPt: Mesure<number>;
  couleurPilule: Mesure<string>;
  police: Mesure<string>;
  /**
   * Espacement des lettres selon la taille (comme le « tracking » de SF Pro sur iPhone) :
   * espacement (em) = a + b · e^(c · taille en px) — formule « Dynamic Metrics » d'Inter.
   */
  typographie: {
    suiviA: Mesure<number>;
    suiviB: Mesure<number>;
    suiviC: Mesure<number>;
  };
  /**
   * Zone de la CAMÉRA : au centre-haut de l'île, de la taille du repos. Sur iPhone, aucun
   * contenu n'y est jamais dessiné (les capteurs sont là) : le contenu va à gauche et à droite.
   */
  zoneCamera: {
    largeurPt: Mesure<number>;
    hauteurPt: Mesure<number>;
    margePt: Mesure<number>;
  };

  formes: Record<EtatIle, FormeEtat>;
  /** Formes particulières selon le contenu. */
  formesContenu: {
    /** Compact avec contenu des deux côtés (musique, minuteur). */
    compactDeuxCotes: FormeEtat;
    /** Étendu du minuteur (moins haut que la musique). */
    etenduMinuteur: FormeEtat;
  };

  ressorts: Record<NomTransition, RessortForme>;

  /** Chorégraphie mesurée : iOS se rétracte avant de changer d'activité. */
  choregraphie: {
    /** Durée de la phase « retrait » avant de s'élargir vers la nouvelle forme (ms). */
    retraitDureeMs: Mesure<number>;
    /** Durée de la « contraction » entre l'appui long et l'ouverture (ms). */
    contractionDureeMs: Mesure<number>;
    /** Après le début de la fermeture vers le mode split : moment où la bulle se détache (ms). */
    separationBulleMs: Mesure<number>;
    /** compact → split : la « bosse » verticale (hauteur visée, début, pic) puis l'élargissement. */
    split: {
      bosseHauteurPt: Mesure<number>;
      bosseDebutMs: Mesure<number>;
      bossePicMs: Mesure<number>;
      croissanceDebutMs: Mesure<number>;
    };
    /** split → compact : la bulle rentre, puis l'île se rétracte, puis s'élargit. */
    fusion: {
      retraitDebutMs: Mesure<number>;
      croissanceDebutMs: Mesure<number>;
    };
  };

  contenu: ContenuAnimation;

  bulle: {
    diametrePt: Mesure<number>;
    ecartPt: Mesure<number>;
    ressort: Ressort;
    /** Effet goutte : flou du filtre SVG (pt, multiplié par ISLAND_SCALE). */
    goutteFlouPt: Mesure<number>;
    goutteAlphaMultiplicateur: Mesure<number>;
    goutteAlphaDecalage: Mesure<number>;
  };

  appui: {
    /** Échelle atteinte en maintenant l'appui (iOS : l'île GONFLE, elle ne se comprime pas). */
    echelleAppui: Mesure<number>;
    /** Durée du gonflement (linéaire) pendant l'appui (ms). */
    dureeGonflementMs: Mesure<number>;
    ressortRetour: Ressort;
  };

  ombreEtendu: {
    flouPt: Mesure<number>;
    decalageYPt: Mesure<number>;
    opacite: Mesure<number>;
  };

  media: {
    compact: {
      pochetteXPt: Mesure<number>;
      pochetteYPt: Mesure<number>;
      pochetteTaillePt: Mesure<number>;
      pochetteRayonPt: Mesure<number>;
      ondeLargeurBarrePt: Mesure<number>;
      ondePasPt: Mesure<number>;
      ondeHauteurMaxPt: Mesure<number>;
      ondeDroitePt: Mesure<number>;
    };
    etendu: {
      pochetteXPt: Mesure<number>;
      pochetteYPt: Mesure<number>;
      pochetteTaillePt: Mesure<number>;
      pochetteRayonPt: Mesure<number>;
      texteXPt: Mesure<number>;
      titreBaselinePt: Mesure<number>;
      artisteBaselinePt: Mesure<number>;
      titre: Texte;
      artiste: Texte;
      ondeXPt: Mesure<number>;
      ondeCentreYPt: Mesure<number>;
      ondeNombreBarres: Mesure<number>;
      ondeLargeurBarrePt: Mesure<number>;
      ondePasPt: Mesure<number>;
      ondeHauteurMinPt: Mesure<number>;
      ondeHauteurMaxPt: Mesure<number>;
      tempsBaselinePt: Mesure<number>;
      tempsGauchePt: Mesure<number>;
      tempsDroitePt: Mesure<number>;
      temps: Texte;
      barreXPt: Mesure<number>;
      barreFinPt: Mesure<number>;
      barreCentreYPt: Mesure<number>;
      barreHauteurPt: Mesure<number>;
      barrePleineCouleur: Mesure<string>;
      barreVideCouleur: Mesure<string>;
      boutonsCentreYPt: Mesure<number>;
      boutonsCentresXPt: Mesure<number[]>;
      iconeLecturePt: Mesure<number>;
      iconeSautPt: Mesure<number>;
      iconeSecondairePt: Mesure<number>;
      iconeCouleur: Mesure<string>;
      iconeSecondaireCouleur: Mesure<string>;
    };
  };

  minuteur: {
    couleur: Mesure<string>;
    compactIconeXPt: Mesure<number>;
    compactIconeTaillePt: Mesure<number>;
    compactTexteDroitePt: Mesure<number>;
    compactTexte: Texte;
    etenduBoutonXPt: Mesure<number[]>;
    etenduBoutonYPt: Mesure<number>;
    etenduBoutonDiametrePt: Mesure<number>;
    etenduBoutonPauseFond: Mesure<string>;
    etenduBoutonAnnulerFond: Mesure<string>;
    etenduLibelleXPt: Mesure<number>;
    etenduBaselinePt: Mesure<number>;
    etenduLibelle: Texte;
    etenduChiffresDroitePt: Mesure<number>;
    etenduChiffres: Texte;
  };

  alerte: {
    texteXPt: Mesure<number>;
    baselinePt: Mesure<number>;
    texte: Texte;
    valeurCouleur: Mesure<string>;
    valeurDroitePt: Mesure<number>;
    ecartValeurBatteriePt: Mesure<number>;
    batterieLargeurPt: Mesure<number>;
    batterieHauteurPt: Mesure<number>;
    batterieDroitePt: Mesure<number>;
    batterieCouleur: Mesure<string>;
    batterieFaibleCouleur: Mesure<string>;
  };

  indicateurs: {
    enregistrementCouleur: Mesure<string>;
    pointXPt: Mesure<number>;
    pointDiametrePt: Mesure<number>;
    /** Point de confidentialité (caméra = vert, micro = orange). */
    confidentialiteDiametrePt: Mesure<number>;
    confidentialiteDroitePt: Mesure<number>;
    cameraCouleur: Mesure<string>;
    microCouleur: Mesure<string>;
  };

  durees: {
    clicLongSeuilMs: Mesure<number>;
    alerteAffichageMs: Mesure<number>;
    etenduFermetureAutoMs: Mesure<number>;
  };
}

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

/** Ressort à partir des deux formats (déjà convertis : voir l'en-tête). */
const r = (response: number, dampingFraction: number, stiffness: number, damping: number): Ressort => ({
  stiffness,
  damping,
  mass: 1,
  response,
  dampingFraction,
});

const memeRessort = (x: Ressort): RessortForme => ({ largeur: x, hauteur: x });

const ISLAND_SCALE = 1.0; // choix par défaut, voir docs/mesures.md (« Facteur d'échelle »)

const forme = (
  largeur: number,
  hauteur: number,
  rayonPt: number,
  exposantCoins: number,
  decalageXPt = 0,
): FormeEtat => ({
  taille: {
    pt: { largeur, hauteur },
    dip: { largeur: largeur * ISLAND_SCALE, hauteur: hauteur * ISLAND_SCALE },
  },
  rayonPt,
  exposantCoins,
  decalageXPt,
});

// Ressorts mesurés (Apple → Framer).
const R_APPARITION = r(0.459, 0.847, 187.38, 23.189); //       V4727 img 341–385
const R_RETRAIT = r(0.528, 0.758, 141.61, 18.04); //           V4731 img 592–604
const R_OUVRIR_L = r(0.522, 0.817, 144.88, 19.668); //         moyenne V4730 147–203, V4731 114–167, V4728 543–596
const R_OUVRIR_H = r(0.527, 0.815, 142.15, 19.434); //         idem
const R_FERMER_L = r(0.374, 0.742, 282.24, 24.931); //         moyenne V4730 447–467, V4731 204–224
const R_FERMER_H = r(0.493, 0.869, 162.43, 22.149); //         moyenne V4731 img 204–252 et V4730 img 447–493
const R_SPLIT_ILE = r(0.524, 0.509, 143.78, 12.207); //        V4728 img 377–428
const R_BULLE = r(0.487, 0.696, 166.46, 17.959); //            V4730 img 86–120
const R_SPLIT_VERS_COMPACT = r(0.477, 0.868, 173.51, 22.867); // V4731 img 309–341
const R_ALERTE_ENTREE = r(0.536, 0.81, 137.41, 18.99); //      V4731 img 604–651
const R_ALERTE_SORTIE = r(0.495, 0.562, 161.12, 14.267); //    V4731 img 772–813
const R_FUSION = r(0.471, 0.829, 177.96, 22.118); //           V4728 img 452–472

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

export const islandConfig: IslandConfig = {
  ISLAND_SCALE,
  margeHautPt: 14.06, // V4727 img 280–338 (médiane)
  couleurPilule: "#000000", // V4727 img 338, pixels intérieurs
  police: "'Inter Variable', Inter, 'Segoe UI Variable', 'Segoe UI', sans-serif",
  typographie: {
    // https://rsms.me/inter/dynmetrics/ — l'équivalent pour Inter du tableau de tracking d'Apple.
    suiviA: -0.0223,
    suiviB: 0.185,
    suiviC: -0.1745,
  },
  zoneCamera: {
    largeurPt: 125.48, // = largeur du repos (V4727 img 280–338) : la forme matérielle de la caméra
    hauteurPt: 36.81, //  = hauteur du repos
    margePt: 18.9, //     V4731 img 706 : « 98 % » commence à 251,7 pt, la caméra finit à 232,8 pt
  },

  formes: {
    repos: forme(125.48, 36.81, 22.39, 2.553), //    V4727 img 280–338
    compact: forme(172.13, 36.81, 23.96, 2.722, -3.33), //  V4728 img 0–33 et V4731 (décalage : 140 images)
    split: forme(159.49, 36.82, 24.29, 2.767, -17.01), //   V4728/4730/4731/4727 : île à −17,01 pt du centre
    etendu: forme(374.24, 204.71, 69.46, 3.119), //  V4730 img 177–437
    alerte: forme(340.16, 36.81, 23.48, 2.659), //   V4731 img 634–753
  },
  formesContenu: {
    compactDeuxCotes: forme(197.5, 36.81, 23.96, 2.722), // capture « 14m » fournie (largeur), hauteur/coins = compact
    etenduMinuteur: forme(374.21, 88.33, 62.96, 3.084), //   V4729 img 1099–1200
  },

  ressorts: {
    apparition: memeRessort(R_APPARITION),
    disparition: memeRessort(R_RETRAIT),
    ouvrir: { largeur: R_OUVRIR_L, hauteur: R_OUVRIR_H },
    fermer: { largeur: R_FERMER_L, hauteur: R_FERMER_H },
    compactVersSplit: memeRessort(R_SPLIT_ILE),
    splitVersCompact: memeRessort(R_SPLIT_VERS_COMPACT),
    alerteEntree: memeRessort(R_ALERTE_ENTREE),
    alerteSortie: memeRessort(R_ALERTE_SORTIE),
    changementContenu: memeRessort(R_ALERTE_ENTREE),
    retrait: memeRessort(R_RETRAIT),
    contraction: memeRessort(R_FUSION),
    bosse: memeRessort(r(0.24, 0.531, 685.39, 27.803)), //           V4727 img 478–486 (montée de la bosse)
    bosseRetour: memeRessort(r(0.232, 1.4, 733.47, 75.832)), //      V4727 img 486–503 (descente)
    croissanceSplit: memeRessort(r(0.516, 0.501, 148.27, 12.201)), // V4729 img 299–310 (élargissement, erreur 0,1 %)
  },

  choregraphie: {
    retraitDureeMs: 210, //     V4731 10,60 → 10,81 s (img 592 → 604)
    contractionDureeMs: 270, // V4730 2,18 → 2,45 s (img 130 → 147)
    separationBulleMs: 370, //  V4730 7,44 → 7,82 s (380 ms) et V4731 3,39 → 3,75 s (360 ms)
    split: {
      bosseHauteurPt: 52.7, //    V4727 img 478–486 (cible ; pic mesuré 55 avec le dépassement, V4729 img 293 : 55)
      bosseDebutMs: 85, //        V4727 img 474 → 478 (+85 ms), V4729 img 282 → 286 (+79 ms)
      bossePicMs: 210, //         V4727 img 486 (+220 ms), V4729 img 293 (+200 ms)
      croissanceDebutMs: 315, //  largeur minimale : V4727 img 492 (+320 ms), V4729 img 299 (+300 ms)
    },
    fusion: {
      retraitDebutMs: 110, //     V4731 img 290 → 296 : la bulle rentre dans l'île
      croissanceDebutMs: 330, //  V4731 img 290 → 309 : largeur minimale
    },
  },

  contenu: {
    delaiApparitionMs: 56, //   mesuré 83 (ouvrir ×2 + alerteEntree), corrigé de −27 ms par la validation (docs/fidelite.md)
    dureeFonduEntreeMs: 262, //  idem
    delaiDisparitionMs: 36, //  moyenne fermer ×2 + alerteSortie
    dureeFonduSortieMs: 105, // idem
    flouDepartPt: 15.1, //       V4730 img 150–155 comparé à img 192
    echelleDepart: 0.75, //      idem
  },

  bulle: {
    diametrePt: 36.83, // V4728 img 400–440
    ecartPt: 7.84, //     V4728 img 400–440 ; capture split fournie : 8,3 pt
    ressort: R_BULLE,
    goutteFlouPt: 1.5, // déduit : la bulle fusionne quand l'écart tombe sous ~2 pt (V4728 img 450–452)
    goutteAlphaMultiplicateur: 8, // seuil à 50 % (−3,5/8 → 0,44–0,56) : garde ~1 px d'anticrénelage
    goutteAlphaDecalage: -3.5,
  },

  appui: {
    echelleAppui: 1.1, //       V4728 img 452 : 176,1/159,5 (l.) et 40,35/36,81 (h.)
    dureeGonflementMs: 180, //  V4728 img 441 → 452
    ressortRetour: R_FUSION,
  },

  ombreEtendu: {
    flouPt: 18, //       estimation visuelle V4730 img 192 (non mesurée précisément)
    decalageYPt: 6, //   idem
    opacite: 0.22, //    idem
  },

  media: {
    compact: {
      pochetteXPt: 8.8, //      V4728 img 417
      pochetteYPt: 6.6,
      pochetteTaillePt: 23.6,
      pochetteRayonPt: 6.11,
      ondeLargeurBarrePt: 2.2, // estimation : onde étendue (V4730) réduite à la hauteur compacte
      ondePasPt: 3.6, //          estimation
      ondeHauteurMaxPt: 12.0, //  estimation
      ondeDroitePt: 11.0, //      estimation
    },
    etendu: {
      pochetteXPt: 21.8, //      V4730 img 192
      pochetteYPt: 24.1,
      pochetteTaillePt: 66.0,
      pochetteRayonPt: 12.74,
      texteXPt: 108.3,
      titreBaselinePt: 51.4,
      artisteBaselinePt: 72.7,
      titre: { taillePt: 16.6, graisse: 600, couleur: "#ffffff" },
      artiste: { taillePt: 16.6, graisse: 400, couleur: "#8f8f90" },
      ondeXPt: 319.6,
      ondeCentreYPt: 49.3,
      ondeNombreBarres: 6,
      ondeLargeurBarrePt: 2.7,
      ondePasPt: 4.72,
      ondeHauteurMinPt: 2.4,
      ondeHauteurMaxPt: 22.5,
      tempsBaselinePt: 118.8,
      tempsGauchePt: 25.4,
      tempsDroitePt: 349.5,
      temps: { taillePt: 10.9, graisse: 500, couleur: "#919092" },
      barreXPt: 57.5,
      barreFinPt: 308.8,
      barreCentreYPt: 115.2,
      barreHauteurPt: 6.0,
      barrePleineCouleur: "#919098", // couleurs : cœur saturé des formes (90e centile chroma + luminosité)
      barreVideCouleur: "#212022",
      boutonsCentreYPt: 157.8,
      boutonsCentresXPt: [45.4, 116.9, 187.9, 258.5, 330.0],
      iconeLecturePt: 32.0,
      iconeSautPt: 36.0,
      iconeSecondairePt: 22.0,
      iconeCouleur: "#ffffff",
      iconeSecondaireCouleur: "#8f8f90",
    },
  },

  minuteur: {
    couleur: "#ff8c2b", //         V4729 img 1153 (cœur des chiffres ; ancienne mesure délavée #f29b59)
    compactIconeXPt: 8.7, //        capture « 14m » fournie (estimation visuelle)
    compactIconeTaillePt: 21.0,
    compactTexteDroitePt: 7.5,
    compactTexte: { taillePt: 16.6, graisse: 500, couleur: "#ff8c2b" },
    etenduBoutonXPt: [16.8, 75.0], // V4729 img 1153
    etenduBoutonYPt: 19.3,
    etenduBoutonDiametrePt: 49.6,
    etenduBoutonPauseFond: "#512b12",
    etenduBoutonAnnulerFond: "#2e2e2e",
    etenduLibelleXPt: 176.1,
    etenduBaselinePt: 57.0,
    etenduLibelle: { taillePt: 16.6, graisse: 500, couleur: "#ff8c2b" },
    etenduChiffresDroitePt: 357.4,
    etenduChiffres: { taillePt: 35.0, graisse: 300, couleur: "#ff8c2b" },
  },

  alerte: {
    texteXPt: 13.1, //            V4731 img 706
    baselinePt: 23.5,
    texte: { taillePt: 15.0, graisse: 500, couleur: "#ffffff" },
    valeurCouleur: "#52ffa9", // V4731 img 706 (cœur des chiffres)
    valeurDroitePt: 55.16, // V4731 img 706 : « 98 % » finit à 285,0 pt (7,8 pt avant la batterie)
    ecartValeurBatteriePt: 7.8, // V4731 img 706
    batterieLargeurPt: 33.3,
    batterieHauteurPt: 17.6,
    batterieDroitePt: 14.06,
    batterieCouleur: "#56fe36", // V4731 img 706
    batterieFaibleCouleur: "#d3382a", // même rouge que l'indicateur mesuré
  },

  indicateurs: {
    enregistrementCouleur: "#d3382a", // V4728 img 18
    pointXPt: 11.2,
    pointDiametrePt: 14.5,
    confidentialiteDiametrePt: 6.0, //  estimation (non présent dans les vidéos)
    confidentialiteDroitePt: 15.4, //   estimation : centré sur la même position que le point d'enregistrement, à droite
    cameraCouleur: "#56fe36", //        vert : couleur verte mesurée (V4731)
    microCouleur: "#ff8c2b", //         orange : couleur orange mesurée (V4729)
  },

  durees: {
    clicLongSeuilMs: 180, //        V4728 img 441 → 452 (gonflement → ouverture)
    alerteAffichageMs: 3000, //     V4731 10,60 → 13,60 s (img 592 → 772)
    etenduFermetureAutoMs: 3000, // pas d'équivalent iOS (pas de survol) : même durée que l'alerte
  },
};

// ---------------------------------------------------------------------------
// Outils de vérification
// ---------------------------------------------------------------------------

export function valeursNonMesurees(obj: unknown = islandConfig, prefixe = ""): string[] {
  if (obj === null) return [prefixe];
  if (typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([cle, val]) =>
    valeursNonMesurees(val, prefixe ? `${prefixe}.${cle}` : cle),
  );
}

export function toutesLesValeurs(obj: unknown = islandConfig, prefixe = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefixe];
  return Object.entries(obj as Record<string, unknown>).flatMap(([cle, val]) =>
    toutesLesValeurs(val, prefixe ? `${prefixe}.${cle}` : cle),
  );
}
