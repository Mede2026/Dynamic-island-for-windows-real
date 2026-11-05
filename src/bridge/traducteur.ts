/**
 * Traduit les événements du backend (données brutes) en événements de la
 * machine à états (ACTIVITE_DEBUT, ALERTE…). Logique pure, testée.
 *
 * Les seuils ci-dessous sont des règles de COMPORTEMENT (pas des valeurs visuelles).
 */

import type { Evenement } from "../state/islandMachine";
import type { EtatBatterie, EtatMedia, EtatMinuteur, EtatNePasDeranger, EtatVolume, Notification } from "./types";

/** Seuils d'alerte de batterie faible (%), comme sur iPhone. */
export const SEUILS_BATTERIE_FAIBLE = [20, 10] as const;

export const ID_MUSIQUE = "musique";
export const ID_MINUTEUR = "minuteur";

/** La musique est une activité tant qu'une source joue ou est en pause avec un titre. */
function musiqueActive(m: EtatMedia): boolean {
  if (!m.sourceActive) return false;
  return m.statut === "lecture" || m.statut === "changement" || (m.statut === "pause" && m.titre !== "");
}

export class Traducteur {
  private musique = false;
  private minuteur = false;
  private batterie: EtatBatterie | null = null;
  private nePasDeranger: boolean | null = null;

  media(m: EtatMedia): Evenement[] {
    const actif = musiqueActive(m);
    const avant = this.musique;
    this.musique = actif;
    if (actif && !avant) return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_MUSIQUE, type: "musique", donnees: m } }];
    if (actif && avant) return [{ type: "ACTIVITE_MAJ", id: ID_MUSIQUE, donnees: m }];
    if (!actif && avant) return [{ type: "ACTIVITE_FIN", id: ID_MUSIQUE }];
    return [];
  }

  minuteurEtat(e: EtatMinuteur): Evenement[] {
    const actif = e.statut === "enCours" || e.statut === "pause";
    const avant = this.minuteur;
    this.minuteur = actif;
    if (e.statut === "termine") {
      const evs: Evenement[] = [{ type: "ALERTE", alerte: { type: "minuteurTermine", donnees: e } }];
      if (avant) evs.unshift({ type: "ACTIVITE_FIN", id: ID_MINUTEUR });
      return evs;
    }
    if (actif && !avant) return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_MINUTEUR, type: "minuteur", donnees: e } }];
    if (actif && avant) return [{ type: "ACTIVITE_MAJ", id: ID_MINUTEUR, donnees: e }];
    if (!actif && avant) return [{ type: "ACTIVITE_FIN", id: ID_MINUTEUR }];
    return [];
  }

  batterieEtat(b: EtatBatterie): Evenement[] {
    const avant = this.batterie;
    this.batterie = b;
    if (!avant) return []; // première lecture : pas d'alerte
    const evs: Evenement[] = [];
    if (b.branche !== avant.branche) {
      evs.push({ type: "ALERTE", alerte: { type: "chargeur", donnees: b } });
    } else if (!b.branche && b.pourcentage !== null && avant.pourcentage !== null) {
      const franchi = SEUILS_BATTERIE_FAIBLE.some((s) => avant.pourcentage! > s && b.pourcentage! <= s);
      if (franchi) evs.push({ type: "ALERTE", alerte: { type: "batterie", donnees: b } });
    }
    return evs;
  }

  volume(v: EtatVolume): Evenement[] {
    if (v.initial) return [];
    return [{ type: "ALERTE", alerte: { type: "volume", donnees: v } }];
  }

  nePasDerangerEtat(n: EtatNePasDeranger): Evenement[] {
    const avant = this.nePasDeranger;
    this.nePasDeranger = n.actif;
    if (avant === null || avant === n.actif) return [];
    return [{ type: "ALERTE", alerte: { type: "neDerangePas", donnees: n } }];
  }

  notification(n: Notification): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "notification", donnees: n } }];
  }

  survol(dedans: boolean): Evenement[] {
    return [{ type: dedans ? "SURVOL_DEBUT" : "SURVOL_FIN" }];
  }

  clicExterieur(): Evenement[] {
    return [{ type: "CLIC_EXTERIEUR" }];
  }
}
