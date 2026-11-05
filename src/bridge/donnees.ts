/**
 * Dernières données reçues du backend (média, pochette, minuteur…), lisibles par le rendu.
 * Petit magasin externe compatible avec React (useSyncExternalStore).
 */

import { useSyncExternalStore } from "react";
import type { EtatBatterie, EtatMedia, EtatMinuteur, EtatVolume, InfoFenetre, Pochette } from "./types";

export interface Confidentialite {
  camera: boolean;
  micro: boolean;
}

export interface PressePapiers {
  type: "texte" | "image" | "fichiers" | "autre";
  apercu: string;
}

export interface Donnees {
  media: EtatMedia | null;
  pochette: Pochette | null;
  minuteur: EtatMinuteur | null;
  batterie: EtatBatterie | null;
  volume: EtatVolume | null;
  confidentialite: Confidentialite;
  fenetre: InfoFenetre | null;
}

let etat: Donnees = {
  media: null,
  pochette: null,
  minuteur: null,
  batterie: null,
  volume: null,
  confidentialite: { camera: false, micro: false },
  fenetre: null,
};
const abonnes = new Set<() => void>();

export function donnees(): Donnees {
  return etat;
}

export function majDonnees(partiel: Partial<Donnees>) {
  etat = { ...etat, ...partiel };
  abonnes.forEach((f) => f());
}

export function useDonnees(): Donnees {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    donnees,
    donnees,
  );
}

/** Position de lecture actuelle (ms), extrapolée depuis la dernière mise à jour. */
export function positionActuelle(m: EtatMedia, maintenant = Date.now()): number {
  if (m.statut !== "lecture") return m.positionMs;
  return Math.min(m.positionMs + (maintenant - m.positionMajAMs), m.dureeMs || Infinity);
}

/** « 1:20 », « 12:05 », « 1:02:03 ». */
export function formaterDuree(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Texte compact du minuteur : « 14m » au-delà d'une minute, sinon « 0:42 ». */
export function formaterMinuteurCompact(ms: number): string {
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)}m` : formaterDuree(ms);
}
