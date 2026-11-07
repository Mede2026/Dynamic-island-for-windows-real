/**
 * Traduit les événements du backend (données brutes) en événements de la
 * machine à états (ACTIVITE_DEBUT, ALERTE…). Logique pure, testée.
 *
 * Les seuils ci-dessous sont des règles de COMPORTEMENT (pas des valeurs visuelles).
 */

import type { Evenement } from "../state/islandMachine";
import type { AppareilBluetooth, EtatTelechargements, LecteurUsb, Reconnaissance, TravailImpression, Verrouillage } from "./types";
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

const ID_TELECHARGEMENT = "telechargement";
const ID_ETAGERE = "etagere";
const ID_ECOUTE = "ecoute";
const ID_IMPRESSION = "impression";
export const ID_APPEL_ENTRANT = "appelEntrant";

const MOTS_APPEL = /appel entrant|appel (vocal|vidéo|video) entrant|incoming (voice |video )?call|vous appelle|t'appelle|is calling|calling you|appel de groupe entrant/i;

/** App « Lien avec Windows » (Phone Link) : le téléphone relié au PC. */
export const estLienTelephone = (app: string) => /lien avec windows|phone link|votre téléphone|your phone/i.test(app);

/** Notification d'appel qui sonne → nom de l'appelant et app, sinon null. */
export function appelEntrant(n: Notification): { nom: string; application: string } | null {
  const texte = n.textes.join(" ");
  if (!MOTS_APPEL.test(texte)) return null;
  if (estLienTelephone(n.application)) n = { ...n, application: "Téléphone" };
  // Le nom : le premier texte qui n'est pas la phrase « appel entrant ».
  const nom =
    n.textes.find((t) => t.trim() && !MOTS_APPEL.test(t))?.trim() ??
    texte.replace(MOTS_APPEL, "").replace(/[:\-–—]/g, " ").trim() ??
    "";
  return { nom: nom || n.application || "Appel", application: n.application || "Appel" };
}

/**
 * Code de vérification dans une notification (« Votre code : 482 913 », « 123456 is your
 * verification code »). Il faut un mot-clé ET un nombre de 4 à 8 chiffres.
 */
export function codeVerification(texte: string): string | null {
  if (!/code|otp|v[ée]rification|verification|s[ée]curit[ée]|passcode|2fa|connexion|login|sign.?in|confirm/i.test(texte)) return null;
  const m = /(?<![\d\w])(\d{3}[ -]\d{3}|\d{4,8})(?![\d\w])/.exec(texte);
  return m ? m[1]!.replace(/[ -]/g, "") : null;
}

export class Traducteur {
  private telechargement = false;
  private impressionActive = false;
  private etagerePleine = false;
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
    // Économiseur de batterie : alerte jaune, comme le mode économie d'énergie de l'iPhone.
    if (b.economie !== avant.economie) evs.push({ type: "ALERTE", alerte: { type: "economie", donnees: b } });
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

  telechargements(t: EtatTelechargements): Evenement[] {
    const evs: Evenement[] = [];
    const actif = t.enCours.length > 0;
    if (actif && !this.telechargement) evs.push({ type: "ACTIVITE_DEBUT", activite: { id: ID_TELECHARGEMENT, type: "telechargement" } });
    if (!actif && this.telechargement) evs.push({ type: "ACTIVITE_FIN", id: ID_TELECHARGEMENT });
    this.telechargement = actif;
    if (t.termine) {
      evs.push({
        type: "ALERTE",
        alerte: { type: "telechargementTermine", donnees: { nom: t.termine[0], chemin: t.termine[1] }, dureeFacteur: 1.7 },
      });
    }
    return evs;
  }

  etagere(fichiers: string[]): Evenement[] {
    const actif = fichiers.length > 0;
    const avant = this.etagerePleine;
    this.etagerePleine = actif;
    if (actif && !avant) return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_ETAGERE, type: "etagere" } }];
    if (!actif && avant) return [{ type: "ACTIVITE_FIN", id: ID_ETAGERE }];
    return [];
  }

  impression(i: { enCours: TravailImpression[]; fini: TravailImpression | null }): Evenement[] {
    const evs: Evenement[] = [];
    const actif = i.enCours.length > 0;
    if (actif && !this.impressionActive) evs.push({ type: "ACTIVITE_DEBUT", activite: { id: ID_IMPRESSION, type: "impression" } });
    if (!actif && this.impressionActive) evs.push({ type: "ACTIVITE_FIN", id: ID_IMPRESSION });
    this.impressionActive = actif;
    if (i.fini) evs.push({ type: "ALERTE", alerte: { type: "impression", donnees: i.fini } });
    return evs;
  }

  notification(n: Notification): Evenement[] {
    // L'outil de capture envoie une notification à chaque capture : l'alerte « Capture »
    // (avec miniature) s'affiche déjà, on ne la double pas.
    if (/capture|snipping|screen ?clip/i.test(n.application)) return [];
    // Appel qui sonne (Teams, WhatsApp, Discord…) : carte d'appel, pas une notification.
    const appel = appelEntrant(n);
    if (appel) return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_APPEL_ENTRANT, type: "appelEntrant", donnees: appel } }, { type: "CLIC_LONG" }];
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
    // SMS et notifications du téléphone relié : affichés comme venant du « Téléphone ».
    if (estLienTelephone(n.application)) n = { ...n, application: "Téléphone" };
    const code = codeVerification(n.textes.join(" "));
    if (code) return [{ type: "ALERTE", alerte: { type: "notification", donnees: { ...n, code }, dureeFacteur: 2.5 } }];
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

  reconnaissance(r: Reconnaissance): Evenement[] {
    if (r.etape === "ecoute") return [{ type: "ACTIVITE_DEBUT", activite: { id: ID_ECOUTE, type: "ecoute", donnees: r } }];
    if (r.etape === "recherche") return [{ type: "ACTIVITE_MAJ", id: ID_ECOUTE, donnees: r }];
    return [
      { type: "ACTIVITE_FIN", id: ID_ECOUTE },
      { type: "ALERTE", alerte: { type: "chanson", donnees: r, dureeFacteur: r.etape === "trouvee" ? 2.5 : 1 } },
    ];
  }

  internet(i: { connecte: boolean; nom: string | null }): Evenement[] {
    return [{ type: "ALERTE", alerte: { type: "internet", donnees: i } }];
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
