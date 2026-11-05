/**
 * Appels vers le backend Rust (commandes) et écoute de ses événements.
 * Hors de Tauri (ex. `npm run dev` dans un navigateur), tout est désactivé proprement.
 */

import { invoke as invokeTauri, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EtatBatterie,
  EtatMedia,
  EtatMinuteur,
  EtatNePasDeranger,
  EtatNotifications,
  EtatVolume,
  EvenementsBackend,
  InfoEcran,
  InfoFenetre,
  NomEvenement,
  Pochette,
  RectDip,
} from "./types";

export const dansTauri = (): boolean => isTauri();

/** Hors de Tauri (démo dans un navigateur), les commandes ne font rien. */
function invoke<T>(commande: string, args?: Record<string, unknown>): Promise<T> {
  if (!dansTauri()) return Promise.resolve(undefined as T);
  return invokeTauri<T>(commande, args);
}

export function ecouter<N extends NomEvenement>(
  nom: N,
  rappel: (donnees: EvenementsBackend[N]) => void,
): Promise<UnlistenFn> {
  return listen<EvenementsBackend[N]>(nom, (e) => rappel(e.payload));
}

export const backend = {
  // Fenêtre
  ecrans: () => invoke<InfoEcran[]>("fenetre_ecrans"),
  infoFenetre: () => invoke<InfoFenetre | null>("fenetre_info"),
  choisirEcran: (id: string | null) => invoke<InfoFenetre>("fenetre_choisir_ecran", { id }),
  definirCanevas: (taille: [number, number] | null) => invoke<InfoFenetre>("fenetre_definir_canevas", { taille }),
  zonesTouchables: (zones: RectDip[]) => invoke<void>("fenetre_zones_touchables", { zones }),
  ecouterClicExterieur: (actif: boolean) => invoke<void>("fenetre_ecouter_clic_exterieur", { actif }),
  cacherEnPleinEcran: (actif: boolean) => invoke<void>("fenetre_cacher_en_plein_ecran", { actif }),

  // Média
  media: () => invoke<EtatMedia>("media_etat"),
  pochette: () => invoke<Pochette | null>("media_pochette"),
  lecturePause: () => invoke<void>("media_lecture_pause"),
  suivant: () => invoke<void>("media_suivant"),
  precedent: () => invoke<void>("media_precedent"),
  allerA: (positionMs: number) => invoke<void>("media_aller_a", { positionMs }),
  choisirSource: (appId: string | null) => invoke<void>("media_choisir_source", { appId }),
  /** Met au premier plan l'application qui joue (Spotify, navigateur…). */
  ouvrirSource: () => invoke<void>("media_ouvrir_source"),

  // Système
  batterie: () => invoke<EtatBatterie>("systeme_batterie"),
  volume: () => invoke<EtatVolume | null>("systeme_volume"),
  nePasDeranger: () => invoke<EtatNePasDeranger>("systeme_ne_pas_deranger"),
  notifications: () => invoke<EtatNotifications>("notifications_etat"),

  // Minuteur
  minuteurDemarrer: (dureeMs: number) => invoke<EtatMinuteur>("minuteur_demarrer", { dureeMs }),
  minuteurPause: () => invoke<EtatMinuteur>("minuteur_pause"),
  minuteurReprendre: () => invoke<EtatMinuteur>("minuteur_reprendre"),
  minuteurAnnuler: () => invoke<EtatMinuteur>("minuteur_annuler"),
  minuteur: () => invoke<EtatMinuteur>("minuteur_etat"),

  // Démarrage automatique avec Windows (à l'ouverture de session)
  demarrageAuto: () => invoke<boolean>("demarrage_auto_etat"),
  definirDemarrageAuto: (actif: boolean) => invoke<boolean>("demarrage_auto_definir", { actif }),
};

export type Backend = typeof backend;
