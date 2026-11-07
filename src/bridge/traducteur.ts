/**
 * Traduit les événements du backend (données brutes) en événements de la
 * machine à états (ACTIVITE_DEBUT, ALERTE…). Logique pure, testée.
 *
 * Les seuils ci-dessous sont des règles de COMPORTEMENT (pas des valeurs visuelles).
 */

import type { Evenement } from "../state/islandMachine";
import type { AppareilBluetooth, LecteurUsb, Verrouillage } from "./types";
import type { Appel, EtatBatterie, EtatMedia, EtatMinuteur, EtatNePasDeranger, EtatVolume, Notification } from "./types";
import type { PressePapiers } from "./donnees";

/** Seuils d'alerte de batterie faible (%), comme sur iPhone. */
export const SEUILS_BATTERIE_FAIBLE = [20, 10] as const;

export const ID_MUSIQUE = "musique";
export const ID_MINUTEUR = "minuteur";
export const ID_APPEL = "appel";

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
  private appelActif = false;

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
    if (!avant) {
      // Au démarrage : alerte si la batterie est déjà faible (et pas en charge).
      const faible = !b.branche && b.pourcentage !== null && b.pourcentage <= SEUILS_BATTERIE_FAIBLE[0];
      return faible ? [{ type: "ALERTE", alerte: { type: "batterie", donnees: b } }] : [];
    }
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
    // L'outil de capture envoie une notification à chaque capture : l'alerte « Capture »
    // (avec miniature) s'affiche déjà, on ne la double pas.
    if (/capture|snipping|screen ?clip/i.test(n.application)) return [];
    // Notification Windows de l'île elle-même (« Minuteur terminé ») : l'île l'affiche déjà.
    if (/^dynamic island$/i.test(n.application.trim())) return [];
    // App Horloge de Windows : la fin d'un minuteur devient la VRAIE alerte « Minuteur
    // terminé » (orange, comme sur iPhone). Alarmes et sessions de concentration : notification.
    if (/^(horloge|clock|alarmes? et horloge|alarms? & clock)$/i.test(n.application.trim())) {
      const texte = n.textes.join(" ");
      if (!/alarm|réveil|concentration|focus/i.test(texte)) {
        return [{ type: "ALERTE", alerte: { type: "minuteurTermine", donnees: null } }];
      }
    }
    return [{ type: "ALERTE", alerte: { type: "notification", donnees: n } }];
  }

  pressePapiers(p: PressePapiers): Evenement[] {
    // Win+Maj+S : alerte « Capture d'écran » avec sa miniature.
    if (p.type === "capture") return [{ type: "ALERTE", alerte: { type: "capture", donnees: p } }];
    return [{ type: "ALERTE", alerte: { type: "pressePapiers", donnees: p } }];
  }

  verrouillage(v: Verrouillage): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "verrouillage", donnees: v } }];
  }

  usb(u: LecteurUsb): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "usb", donnees: u } }];
  }

  bluetooth(b: AppareilBluetooth): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "bluetooth", donnees: b } }];
  }

  luminosite(niveau: number): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "luminosite", donnees: niveau } }];
  }

  appel(a: Appel): Evenement[] {
    const avant = this.appelActif;
    this.appelActif = a.actif;
    if (a.actif && !avant) return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_APPEL, type: "appel", donnees: a } }];
    if (!a.actif && avant) return [{ type: "ACTIVITE_FIN", id: ID_APPEL }];
    return [];
  }

  survol(dedans: boolean): Evenement[] {
    return [{ type: dedans ? "SURVOL_DEBUT" : "SURVOL_FIN" }];
  }

  clicExterieur(): Evenement[] {
    return [{ type: "CLIC_EXTERIEUR" }];
  }
}
