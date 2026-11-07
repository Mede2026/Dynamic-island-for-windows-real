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
  Parametres,
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
  /**
   * `zones` : où l'île réagit (survol, clics) ; `region` : zone d'affichage — hors de celle-ci,
   * la fenêtre n'existe pas pour Windows et les clics passent aux applications en dessous.
   */
  zonesTouchables: (zones: RectDip[], region?: RectDip) =>
    invoke<void>("fenetre_zones_touchables", { zones, region: region ?? null }),
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
  confidentialite: () => invoke<{ camera: boolean; micro: boolean } | null>("systeme_confidentialite"),

  // Préférences mémorisées
  parametres: () => invoke<Parametres | null>("parametres_lire"),
  definirTaille: (taille: number) => invoke<Parametres>("parametres_definir_taille", { taille }),
  definirAffichage: (affichage: Record<string, unknown>) => invoke<Parametres>("parametres_definir_affichage", { affichage }),
  definirClicsRegion: (actif: boolean) => invoke<Parametres>("parametres_definir_clics_region", { actif }),
  /** Arrêter le test : prévient l'île (et toutes les fenêtres). */
  reinitialiser: () => invoke<void>("ile_reinitialiser"),
  quitter: () => invoke<void>("app_quitter"),
  /** Couper / rétablir le micro (appel en cours). `null` = lire l'état. */
  microMuet: (muet: boolean | null) => invoke<boolean>("micro_muet", { muet }),
  /** L'île demande le niveau sonore réel (onde de la musique). */
  copierTexte: (texte: string) => invoke<void>("copier_texte", { texte }),
  copierFichiers: (chemins: string[]) => invoke<void>("copier_fichiers", { chemins }),
  ouvrirFichier: (chemin: string, dansExplorateur = false) => invoke<void>("ouvrir_fichier", { chemin, dansExplorateur }),
  etagereLire: () => invoke<string[]>("etagere_lire"),
  etagereColler: () => invoke<string[]>("etagere_coller"),
  etagereAjouter: (chemins: string[]) => invoke<string[]>("etagere_ajouter", { chemins }),
  etagereRetirer: (chemin: string | null) => invoke<string[]>("etagere_retirer", { chemin }),
  inactiviteMs: () => invoke<number>("systeme_inactivite_ms"),
  cacherAuPartage: (actif: boolean) => invoke<void>("fenetre_cacher_au_partage", { actif }),
  ileMenu: () => invoke<void>("ile_menu"),
  appelEntrantRepondre: (application: string, accepter: boolean) => invoke<void>("appel_entrant_repondre", { application, accepter }),
  historiqueLire: () => invoke<string[]>("historique_lire"),
  historiqueCopier: (indice: number) => invoke<void>("historique_copier", { indice }),
  historiqueVider: () => invoke<void>("historique_vider"),
  historiqueColler: (indice: number) => invoke<void>("historique_coller", { indice }),
  rechercheRapide: (terme: string) => invoke<unknown>("recherche_rapide", { terme }),
  ouvrirLien: (lien: string) => invoke<void>("ouvrir_lien", { lien }),
  parolesChercher: (artiste: string, titre: string, album: string, dureeS: number | null) =>
    invoke<{ synchronisees: string | null; instrumental: boolean } | null>("paroles_chercher", { artiste, titre, album, dureeS }),
  niveauAudio: (actif: boolean) => invoke<void>("audio_niveau_actif", { actif }),

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
