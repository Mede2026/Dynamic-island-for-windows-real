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
  /** "horloge" : minuteur lu dans l'app Horloge de Windows (pas de boutons). */
  source?: "app" | "horloge";
}

export interface Appel {
  actif: boolean;
  application: string | null;
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
  "presse-papiers": { type: "texte" | "image" | "capture" | "fichiers" | "autre"; apercu: string; miniature?: string | null };
  /** Niveau sonore réel de la sortie (0–1), 30 fois par seconde pendant la musique. */
  "niveau-audio": number;
  /** Luminosité de l'écran intégré (0–100). */
  luminosite: number;
  appel: Appel;
  /** Minuteur lu dans l'app Horloge de Windows. */
  "minuteur-horloge": EtatMinuteur;
  confidentialite: { camera: boolean; micro: boolean; ecran?: boolean };
  /** Session verrouillée (true) ou déverrouillée (false). */
  session: boolean;
  /** Nouvelle sortie audio par défaut. */
  "sortie-audio": { nom: string; genre: "casque" | "haut-parleurs" | "ecran" };
  /** Micro coupé (true) ou rétabli. */
  "micro-muet": boolean;
  /** Bureau virtuel affiché. */
  bureau: { numero: number; total: number; nom: string | null };
  /** Verr. Maj / Verr. Num activé ou désactivé. */
  verrouillage: Verrouillage;
  /** Clé USB ou disque externe branché / retiré. */
  usb: LecteurUsb;
  /** Appareil Bluetooth connecté / déconnecté. */
  bluetooth: AppareilBluetooth;
  /** Téléchargements en cours (dossier Téléchargements) et fichier tout juste terminé. */
  telechargements: EtatTelechargements;
  /** Fichiers de l'étagère (chemins). */
  etagere: string[];
  /** « Quelle est cette chanson ? » : écoute, recherche, résultat. */
  reconnaissance: Reconnaissance;
  /** Impressions en cours et travail tout juste fini. */
  impression: { enCours: TravailImpression[]; fini: TravailImpression | null };
  /** Windows Update attend un redémarrage. */
  "redemarrage-requis": boolean;
  /** Menu de l'icône ou Ctrl+Alt+E : ouvrir l'étagère. */
  "ouvrir-etagere": null;
  /** Ouvrir un outil DANS l'île : « recherche », « minuteur », « copies », « note ». */
  "ouvrir-outil": string;
  /** Bouton gauche enfoncé et curseur amené près de l'île (glisser-déposer probable). */
  "glisser-proche": null;
  /** Nouvelle version de l'île disponible sur GitHub. */
  "nouvelle-version": { version: string; url: string };
  /** VPN connecté / déconnecté. */
  vpn: { connecte: boolean; nom: string | null };
  /** Asus Fan Control (statut en direct) ; null = l'app n'est pas lancée. */
  ventilateurs: StatutVentilo | null;
  /** Météo (position de Windows ou Boucherville), toutes les 15 min. */
  meteo: Meteo;
  /** Pipette : couleur sous la souris (en direct), puis celle cliquée (copiée). */
  pipette: { hex: string; fini: boolean; annule: boolean };
  /** Signal Wi-Fi tombé à 1 barre ou moins. */
  "wifi-faible": { barres: number; nom: string | null };
  /** Connexion Internet perdue / retrouvée. */
  internet: { connecte: boolean; nom: string | null };
  /** Panneau de réglages → île : valeurs modifiées en direct. */
  "config-direct": Record<string, unknown>;
  /** Panneau de réglages → île : jouer un scénario de démonstration. */
  declencher: string;
  /** Arrêter le test : effacer les activités factices et revenir aux vraies données. */
  reinitialiser: null;
  /** Préférences mémorisées (taille de l'île…). */
  parametres: Parametres;
}

export interface Verrouillage {
  touche: "majuscules" | "numerique";
  actif: boolean;
}

export interface LecteurUsb {
  branche: boolean;
  /** « E: » */
  lettre: string;
  /** Nom du volume, ou vide. */
  nom: string;
  amovible: boolean;
}

export type CategorieBluetooth = "audio" | "clavier" | "souris" | "telephone" | "manette" | "autre";

export interface AppareilBluetooth {
  nom: string;
  connecte: boolean;
  categorie: CategorieBluetooth;
  batterie: number | null;
}

export interface Telechargement {
  nom: string;
  octets: number;
  /** Octets par seconde. */
  vitesse: number;
}

export interface EtatTelechargements {
  enCours: Telechargement[];
  /** [nom, chemin] du fichier tout juste terminé. */
  termine: [string, string] | null;
}

export interface Reconnaissance {
  etape: "ecoute" | "recherche" | "trouvee" | "introuvable" | "erreur";
  titre: string | null;
  artiste: string | null;
  pochette: string | null;
  lien: string | null;
}

export interface TravailImpression {
  id: number;
  document: string;
  imprimante: string;
  pagesImprimees: number;
  pagesTotal: number;
  erreur: string | null;
}

export interface Parametres {
  /** Taille de l'île : DIP par point iPhone (ISLAND_SCALE). */
  taille: number;
  ecran: string | null;
  cacherEnPleinEcran: boolean;
  /** Clics traversants par région de fenêtre (expérimental, au redémarrage). */
  clicsRegion: boolean;
  /** Préférences d'affichage (voir src/config/store.ts, `Preferences`). */
  affichage: Record<string, unknown>;
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
  "luminosite",
  "appel",
  "minuteur-horloge",
  "verrouillage",
  "usb",
  "bluetooth",
  "telechargements",
  "etagere",
  "internet",
  "reconnaissance",
  "session",
  "sortie-audio",
  "micro-muet",
  "bureau",
  "wifi-faible",
  "nouvelle-version",
  "vpn",
  "impression",
  "redemarrage-requis",
  "ventilateurs",
  "meteo",
  "pipette",
];

/** Statut d'Asus Fan Control (canal nommé \\.\pipe\AsusFanControl, lu par le moteur Rust). */
export interface StatutVentilo {
  temperature: number | null;
  rpms: number[];
  /** 0 = automatique, -1 = arrêtés, sinon pourcentage appliqué. */
  appliedPercent: number | null;
  controlOn: boolean;
  mode: string | null;
  unit: string | null;
  speed: number | null;
  override: unknown;
  fansStopped: boolean;
  onCharger: boolean | null;
  batteryPercent: number | null;
  batteryLimit: { enabled: boolean; percent: number | null; fullChargePending: boolean } | null;
  error: string | null;
}

export interface Meteo {
  temperature: number;
  /** Code météo de l'OMM (0 = clair, 61 = pluie, 71 = neige…). */
  code: number;
  jour: boolean;
  /** Minutes avant la pluie ou la neige (dans l'heure), sinon null. */
  precipitationDans: number | null;
  neige: boolean;
  positionReelle: boolean;
}
