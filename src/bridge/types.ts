/**
 * Types des données envoyées par le backend Rust (miroir des structures Rust,
 * champs en camelCase). Voir src-tauri/src/**.
 */

export interface RectPx {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export interface RectDip {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export interface InfoEcran {
  id: string;
  principal: boolean;
  rect: RectPx;
  /** 1 = 100 %, 1.25 = 125 %, 1.5 = 150 %… */
  facteurEchelle: number;
  /** Taux de rafraîchissement réel (Hz) ; null si inconnu. */
  frequenceHz: number | null;
}

export interface InfoFenetre {
  ecran: InfoEcran;
  fenetre: RectPx;
  largeurDip: number;
  hauteurDip: number;
}

export type StatutLecture = "aucun" | "ferme" | "ouverture" | "changement" | "arrete" | "lecture" | "pause";

export interface SourceMedia {
  appId: string;
  statut: StatutLecture;
}

export interface EtatMedia {
  sources: SourceMedia[];
  sourceActive: string | null;
  sourceEpinglee: string | null;
  titre: string;
  artiste: string;
  album: string;
  statut: StatutLecture;
  positionMs: number;
  dureeMs: number;
  positionMajAMs: number;
  peutLirePause: boolean;
  peutSuivant: boolean;
  peutPrecedent: boolean;
  peutAllerA: boolean;
  pochetteId: string | null;
}

export interface Pochette {
  id: string;
  pngBase64: string;
  couleurDominante: [number, number, number];
}

export interface EtatBatterie {
  presente: boolean;
  pourcentage: number | null;
  branche: boolean;
  enCharge: boolean;
  economie: boolean;
}

export interface EtatVolume {
  niveau: number;
  muet: boolean;
  /** Première lecture au démarrage (ne doit pas afficher d'alerte). */
  initial?: boolean;
}

export interface EtatNePasDeranger {
  actif: boolean;
  notificationsCoupees: boolean | null;
  sessionConcentration: boolean | null;
}

export type StatutMinuteur = "inactif" | "enCours" | "pause" | "termine";

export interface EtatMinuteur {
  statut: StatutMinuteur;
  dureeMs: number;
  restantMs: number;
  finAMs: number | null;
}

export interface Notification {
  id: number;
  application: string;
  textes: string[];
}

export interface EtatNotifications {
  disponible: boolean;
  raison: string | null;
}

/** Nom de chaque événement du backend → type de ses données (voir src-tauri/src/evenements.rs). */
export interface EvenementsBackend {
  ecran: InfoFenetre;
  "ecrans-changes": InfoEcran[];
  "plein-ecran": boolean;
  survol: boolean;
  "clic-exterieur": null;
  media: EtatMedia;
  "media-pochette": Pochette;
  batterie: EtatBatterie;
  volume: EtatVolume;
  "ne-pas-deranger": EtatNePasDeranger;
  minuteur: EtatMinuteur;
  notification: Notification;
  "presse-papiers": { type: "texte" | "image" | "fichiers" | "autre"; apercu: string };
  confidentialite: { camera: boolean; micro: boolean };
  /** Panneau de réglages → île : valeurs modifiées en direct. */
  "config-direct": Record<string, unknown>;
  /** Panneau de réglages → île : jouer un scénario de démonstration. */
  declencher: string;
}

export type NomEvenement = keyof EvenementsBackend;

export const NOMS_EVENEMENTS: NomEvenement[] = [
  "ecran",
  "ecrans-changes",
  "plein-ecran",
  "survol",
  "clic-exterieur",
  "media",
  "media-pochette",
  "batterie",
  "volume",
  "ne-pas-deranger",
  "minuteur",
  "notification",
  "presse-papiers",
  "confidentialite",
];
