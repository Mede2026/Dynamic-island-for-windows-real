/**
 * Configuration « vivante » : islandConfig + réglages modifiés en direct dans le
 * panneau (Ctrl+Alt+D). Les valeurs de base restent dans island.config.ts.
 */

import { useSyncExternalStore } from "react";
import { islandConfig, type IslandConfig } from "../island.config";

type Chemin = string; // ex. "formes.etendu.rayonPt"

/** Préférences de l'utilisateur (mémorisées par le backend), ex. la taille de l'île. */
export interface Preferences {
  ISLAND_SCALE?: number;
  /** Vitesse des animations : 1 = mesurée sur iPhone ; 1,5 = 50 % plus rapide. */
  vitesse?: number;
  /** Afficher l'onde sonore de la musique. */
  onde?: boolean;
  /** Durée d'affichage des alertes : 1 = mesurée sur iPhone. */
  dureeAlertes?: number;
  /** Types d'alertes à ne pas afficher (ex. "volume", "pressePapiers"). */
  alertesMasquees?: string[];
  /** Notification Windows (avec « Répéter ») à la fin du minuteur — lue par le backend. */
  notificationMinuteur?: boolean;
  /** Horloge quand la souris passe sur l'île au repos (activée par défaut). */
  horlogeSurvol?: boolean;
  /** Forme : île de l'iPhone (par défaut) ou encoche collée en haut de l'écran (style Mac). */
  forme?: "ile" | "encoche";
  /** Apps ignorées par l'île (musique et notifications), ex. "TikTok", "chrome". */
  appsIgnorees?: string[];
  /** Paroles synchronisées sous la caméra pendant la musique (activé par défaut). */
  paroles?: boolean;
  /** Remplacer l'indicateur de volume / luminosité de Windows par l'île (lu par le backend). */
  remplacerOsd?: boolean;
  /** Cacher l'île dans les partages d'écran et enregistrements (Teams, Discord, OBS). */
  cacherPartage?: boolean;
  /** Rappels de pause : yeux toutes les 20 min, bouger toutes les heures (temps devant l'écran). */
  pauses?: boolean;
}

/** L'app (identifiant ou nom affiché) est-elle dans la liste des apps ignorées ? */
export function appIgnoree(nom: string | null | undefined): boolean {
  if (!nom) return false;
  const n = nom.toLowerCase();
  return (preferences.appsIgnorees ?? []).some((a) => a.trim() !== "" && n.includes(a.trim().toLowerCase()));
}

let preferences: Preferences = {};
/** Réglages de développement du panneau (temporaires). */
let surcharges: Record<Chemin, unknown> = {};
let courante: IslandConfig = calculer();
const abonnes = new Set<() => void>();

function cloner<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function ecrire(obj: Record<string, unknown>, chemin: string, valeur: unknown) {
  const parties = chemin.split(".");
  let o: Record<string, unknown> = obj;
  for (const p of parties.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parties[parties.length - 1]!] = valeur;
}

export function lire(obj: unknown, chemin: string): unknown {
  return chemin.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], obj);
}

function calculer(): IslandConfig {
  const c = cloner(islandConfig);
  if (preferences.ISLAND_SCALE) c.ISLAND_SCALE = preferences.ISLAND_SCALE;
  const k = preferences.vitesse && preferences.vitesse > 0 ? 1 / preferences.vitesse : 1;
  if (k !== 1) accelerer(c, k);
  if (preferences.dureeAlertes) c.durees.alerteAffichageMs = (c.durees.alerteAffichageMs ?? 0) * preferences.dureeAlertes;
  // Mode encoche : collée au bord de l'écran (pas d'espace au-dessus), comme l'encoche d'un Mac.
  if (preferences.forme === "encoche") c.margeHautPt = 0;
  for (const [chemin, v] of Object.entries(surcharges)) ecrire(c as unknown as Record<string, unknown>, chemin, v);
  // Les tailles en DIP suivent toujours pt × ISLAND_SCALE.
  const s = c.ISLAND_SCALE ?? 1;
  for (const f of [...Object.values(c.formes), ...Object.values(c.formesContenu)]) {
    f.taille.dip.largeur = (f.taille.pt.largeur ?? 0) * s;
    f.taille.dip.hauteur = (f.taille.pt.hauteur ?? 0) * s;
  }
  return c;
}

/**
 * Change la vitesse de TOUTES les animations d'un facteur k (durée × k) en gardant leur forme :
 * response × k (stiffness ÷ k², damping ÷ k) et chaque durée d'animation (…Ms) × k.
 */
function accelerer(c: IslandConfig, k: number) {
  const parcourir = (o: unknown, cle = "") => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return;
    const r = o as Record<string, unknown>;
    if (typeof r.stiffness === "number" && typeof r.damping === "number" && typeof r.response === "number") {
      r.stiffness /= k * k;
      r.damping /= k;
      r.response *= k;
      return;
    }
    for (const [n, val] of Object.entries(r)) {
      if (typeof val === "number" && n.endsWith("Ms") && cle !== "durees") r[n] = val * k;
      else parcourir(val, n);
    }
  };
  parcourir(c);
}

export function preferencesActuelles(): Preferences {
  return preferences;
}

export function config(): IslandConfig {
  return courante;
}

export function surchargesActuelles(): Record<Chemin, unknown> {
  return { ...surcharges };
}

export function definirSurcharges(s: Record<Chemin, unknown>) {
  surcharges = { ...s };
  courante = calculer();
  abonnes.forEach((f) => f());
}

export function definirPreferences(p: Preferences) {
  preferences = { ...p };
  courante = calculer();
  abonnes.forEach((f) => f());
}

export function modifier(chemin: Chemin, valeur: unknown) {
  definirSurcharges({ ...surcharges, [chemin]: valeur });
}

export function abonnerConfig(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

export function useConfig(): IslandConfig {
  return useSyncExternalStore(abonnerConfig, config, config);
}

/** Valeur obligatoire (phase 2 : jamais null). */
export function v<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("valeur de configuration manquante");
  return x;
}
