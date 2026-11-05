/**
 * Configuration « vivante » : islandConfig + réglages modifiés en direct dans le
 * panneau (Ctrl+Alt+D). Les valeurs de base restent dans island.config.ts.
 */

import { useSyncExternalStore } from "react";
import { islandConfig, type IslandConfig } from "../island.config";

type Chemin = string; // ex. "formes.etendu.rayonPt"

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
  for (const [chemin, v] of Object.entries(surcharges)) ecrire(c as unknown as Record<string, unknown>, chemin, v);
  // Les tailles en DIP suivent toujours pt × ISLAND_SCALE.
  const s = c.ISLAND_SCALE ?? 1;
  for (const f of [...Object.values(c.formes), ...Object.values(c.formesContenu)]) {
    f.taille.dip.largeur = (f.taille.pt.largeur ?? 0) * s;
    f.taille.dip.hauteur = (f.taille.pt.hauteur ?? 0) * s;
  }
  return c;
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
