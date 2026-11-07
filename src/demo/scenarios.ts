/**
 * Scénarios de démonstration : pilotent la machine à états avec des données factices.
 * Utilisés par le panneau de réglages (boutons « déclencher ») et la validation de
 * fidélité (enregistrement de notre île, tools/enregistrer_ile.mjs).
 */

import { backend, dansTauri } from "../bridge/backend";
import { majDonnees, donnees, positionActuelle } from "../bridge/donnees";
import type { EtatMedia, EtatMinuteur, Pochette } from "../bridge/types";
import type { IslandMachine } from "../state/islandMachine";

function pochetteFactice(): Pochette | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  const d = g.createLinearGradient(0, 0, 128, 128);
  d.addColorStop(0, "#f6c445");
  d.addColorStop(1, "#d9822b");
  g.fillStyle = d;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#1f3b73";
  g.beginPath();
  g.arc(64, 70, 34, 0, Math.PI * 2);
  g.fill();
  return { id: "demo", pngBase64: c.toDataURL("image/png").split(",")[1]!, couleurDominante: [232, 168, 60] };
}

function mediaFactice(): EtatMedia {
  return {
    sources: [{ appId: "Demo.exe", statut: "lecture" }],
    sourceActive: "Demo.exe",
    sourceEpinglee: null,
    titre: "Chanson de démonstration",
    artiste: "Artiste",
    album: "Album",
    statut: "lecture",
    positionMs: 80_000,
    dureeMs: 245_000,
    positionMajAMs: Date.now(),
    peutLirePause: true,
    peutSuivant: true,
    peutPrecedent: true,
    peutAllerA: true,
    pochetteId: "demo",
  };
}

function minuteurFactice(): EtatMinuteur {
  const duree = 15 * 60_000;
  return { statut: "enCours", dureeMs: duree, restantMs: duree - 6_000, finAMs: Date.now() + duree - 6_000 };
}

/** Un minuteur lancé par un test (à annuler quand on arrête le test). */
let minuteurDeTest = false;

/** Arrêter le test : annule le minuteur lancé par le test, s'il y en a un. */
export function nettoyerTests() {
  if (minuteurDeTest && dansTauri()) void backend.minuteurAnnuler();
  minuteurDeTest = false;
}

/** La musique affichée est-elle celle d'un test ? (ses boutons agissent alors sur elle) */
export function estMusiqueDeTest(): boolean {
  return donnees().media?.sourceActive === "Demo.exe";
}

/** Boutons de la musique de test : lecture/pause sans passer par Windows. */
export function basculerMusiqueDeTest() {
  const m = donnees().media;
  if (!m) return;
  const enLecture = m.statut === "lecture";
  majDonnees({
    media: {
      ...m,
      statut: enLecture ? "pause" : "lecture",
      positionMs: enLecture ? Math.min(m.positionMs + (Date.now() - m.positionMajAMs), m.dureeMs) : m.positionMs,
      positionMajAMs: Date.now(),
    },
  });
}

export const SCENARIOS = {
  musique: "Musique : repos → compact",
  etendre: "Appui long : → étendu",
  fermer: "Clic extérieur : étendu → compact",
  minuteur: "Minuteur 15 min (vrai minuteur) : → split",
  finMinuteur: "Fin du minuteur : split → compact",
  finMusique: "Fin de la musique : → repos",
  charge: "Alerte « En charge »",
  batterieFaible: "Alerte batterie faible (20 %)",
  luminosite: "Alerte luminosité",
  capture: "Capture d'écran (Win+Maj+S)",
  appel: "Appel Teams en cours",
  finAppel: "Fin de l'appel",
  volume: "Alerte volume",
  pressePapiers: "Alerte presse-papiers",
  camera: "Point vert (caméra)",
  micro: "Point orange (micro)",
  confidentialiteOff: "Aucun point",
  verrMaj: "Verr. Maj activé",
  usb: "Clé USB branchée",
  bluetooth: "Écouteurs Bluetooth connectés (batterie)",
  bluetoothOff: "Souris Bluetooth déconnectée",
  horloge: "Horloge (survol de l'île au repos)",
  paroles: "Paroles en direct (avec la musique)",
  telechargement: "Téléchargement en cours",
  finTelechargement: "Téléchargement terminé",
  etagere: "Étagère (3 fichiers)",
  code: "Notification avec un code à copier",
  ecoute: "Quelle est cette chanson ? (écoute)",
  chansonTrouvee: "Chanson reconnue",
  appelEntrant: "Appel entrant (Teams)",
  impression: "Impression en cours",
  finImpression: "Impression terminée",
  miseAJour: "Mise à jour : redémarrage requis",
  notification: "Notification (titre + message)",
  deverrouillage: "Déverrouillage (cadenas)",
  menu: "Menu de l'île (clic droit)",
  enregistrement: "Enregistrement de l'écran",
  sortieAudio: "Écouteurs branchés",
  microCoupe: "Micro coupé",
  economie: "Économiseur de batterie",
  ecranExterne: "Écran externe branché",
  bureau: "Bureau virtuel 2",
  finHorloge: "Fin de l'horloge",
} as const;

export type NomScenario = keyof typeof SCENARIOS;

export function jouer(machine: IslandMachine, nom: NomScenario) {
  switch (nom) {
    case "musique":
      majDonnees({ media: mediaFactice(), pochette: donnees().pochette ?? pochetteFactice() });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "musique", type: "musique", donnees: donnees().media } });
      break;
    case "etendre":
      machine.envoyer({ type: "CLIC_LONG" });
      break;
    case "fermer":
      machine.envoyer({ type: "CLIC_EXTERIEUR" });
      break;
    case "minuteur":
      if (dansTauri()) {
        // Le VRAI minuteur de l'app : pause, reprise et annulation fonctionnent.
        minuteurDeTest = true;
        void backend.minuteurDemarrer(15 * 60_000);
      } else {
        majDonnees({ minuteur: minuteurFactice() });
        machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "minuteur", type: "minuteur" } });
      }
      break;
    case "finMinuteur":
      if (dansTauri()) {
        minuteurDeTest = false;
        void backend.minuteurAnnuler();
      } else machine.envoyer({ type: "ACTIVITE_FIN", id: "minuteur" });
      break;
    case "finMusique":
      machine.envoyer({ type: "ACTIVITE_FIN", id: "musique" });
      break;
    case "charge":
      machine.envoyer({
        type: "ALERTE",
        alerte: { type: "chargeur", donnees: { presente: true, pourcentage: 98, branche: true, enCharge: true, economie: false } },
      });
      break;
    case "batterieFaible":
      machine.envoyer({
        type: "ALERTE",
        alerte: { type: "batterie", donnees: { presente: true, pourcentage: 20, branche: false, enCharge: false, economie: false } },
      });
      break;
    case "luminosite":
      machine.envoyer({ type: "ALERTE", alerte: { type: "luminosite", donnees: 62 } });
      break;
    case "capture": {
      const p = pochetteFactice();
      machine.envoyer({ type: "ALERTE", alerte: { type: "capture", donnees: { type: "capture", apercu: "", miniature: p?.pngBase64 ?? null } } });
      break;
    }
    case "appel":
      majDonnees({ appel: { application: "Teams", debutMs: Date.now() - 83_000, muet: false } });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "appel", type: "appel" } });
      break;
    case "finAppel":
      machine.envoyer({ type: "ACTIVITE_FIN", id: "appel" });
      majDonnees({ appel: null });
      break;
    case "volume":
      machine.envoyer({ type: "ALERTE", alerte: { type: "volume", donnees: { niveau: 0.62, muet: false } } });
      break;
    case "pressePapiers":
      machine.envoyer({ type: "ALERTE", alerte: { type: "pressePapiers", donnees: { type: "texte", apercu: "Bonjour de Boucherville" } } });
      break;
    case "camera":
      majDonnees({ confidentialite: { camera: true, micro: true } });
      break;
    case "micro":
      majDonnees({ confidentialite: { camera: false, micro: true } });
      break;
    case "confidentialiteOff":
      majDonnees({ confidentialite: { camera: false, micro: false } });
      break;
    case "paroles": {
      if (!donnees().media) jouer(machine, "musique");
      const m = donnees().media!;
      const t0 = positionActuelle(m);
      const textes = ["Sous le ciel de Boucherville", "Les baguettes frappent la caisse claire", "On descend le sous-bois à Charlevoix", "Et la musique ne s'arrête jamais"];
      majDonnees({ paroles: { cle: "demo", lignes: textes.map((texte, i) => ({ t: t0 + i * 2500, texte })) } });
      break;
    }
    case "telechargement":
      majDonnees({ telechargements: [{ nom: "setup-jeu.exe", octets: 48_200_000, vitesse: 6_300_000 }] });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "telechargement", type: "telechargement" } });
      break;
    case "finTelechargement":
      majDonnees({ telechargements: [] });
      machine.envoyer({ type: "ACTIVITE_FIN", id: "telechargement" });
      machine.envoyer({ type: "ALERTE", alerte: { type: "telechargementTermine", donnees: { nom: "setup-jeu.exe", chemin: "C:\\setup-jeu.exe" } } });
      break;
    case "etagere":
      majDonnees({ etagere: ["C:\\Users\\Mederic\\Documents\\Partition batterie.pdf", "C:\\Users\\Mederic\\Pictures\\Charlevoix.jpg", "C:\\Users\\Mederic\\Music\\set-dj.mp3"] });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "etagere", type: "etagere" } });
      break;
    case "code":
      machine.envoyer({
        type: "ALERTE",
        alerte: { type: "notification", donnees: { id: 1, application: "Desjardins", textes: ["Votre code de vérification est 482913"], code: "482913" }, dureeFacteur: 2.5 },
      });
      break;
    case "appelEntrant":
      majDonnees({ appelEntrant: { nom: "Marie Tremblay", application: "Microsoft Teams" } });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "appelEntrant", type: "appelEntrant" } });
      machine.envoyer({ type: "CLIC_LONG" });
      break;
    case "impression":
      majDonnees({ impressions: [{ id: 1, document: "Devoir de sciences.pdf", imprimante: "HP DeskJet", pagesImprimees: 1, pagesTotal: 4, erreur: null }] });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "impression", type: "impression" } });
      break;
    case "finImpression":
      majDonnees({ impressions: [] });
      machine.envoyer({ type: "ACTIVITE_FIN", id: "impression" });
      machine.envoyer({ type: "ALERTE", alerte: { type: "impression", donnees: { id: 1, document: "Devoir de sciences.pdf", imprimante: "HP DeskJet", pagesImprimees: 4, pagesTotal: 4, erreur: null } } });
      break;
    case "miseAJour":
      machine.envoyer({ type: "ALERTE", alerte: { type: "miseAJour", dureeFacteur: 3 } });
      break;
    case "notification":
      machine.envoyer({ type: "ALERTE", alerte: { type: "notification", donnees: { id: 9, application: "Messages", textes: ["Papa", "On soupe à 18 h, tu ramènes du pain ?"] } } });
      break;
    case "menu":
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "menu", type: "menu" } });
      machine.envoyer({ type: "CLIC_LONG" });
      break;
    case "deverrouillage":
      machine.envoyer({ type: "ALERTE", alerte: { type: "deverrouillage", dureeFacteur: 0.5 } });
      break;
    case "enregistrement":
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "enregistrement", type: "enregistrement", donnees: { debutMs: Date.now() - 12_000 } } });
      break;
    case "sortieAudio":
      machine.envoyer({ type: "ALERTE", alerte: { type: "sortieAudio", donnees: { nom: "AirPods Pro", genre: "casque" } } });
      break;
    case "microCoupe":
      machine.envoyer({ type: "ALERTE", alerte: { type: "micro", donnees: true } });
      break;
    case "economie":
      machine.envoyer({ type: "ALERTE", alerte: { type: "economie", donnees: { presente: true, pourcentage: 34, branche: false, enCharge: false, economie: true } } });
      break;
    case "ecranExterne":
      machine.envoyer({ type: "ALERTE", alerte: { type: "ecranExterne", donnees: { branche: true, nom: "Écran 2 · 2560×1440" } } });
      break;
    case "bureau":
      machine.envoyer({ type: "ALERTE", alerte: { type: "bureau", donnees: { numero: 2, total: 3, nom: null } } });
      break;
    case "ecoute":
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "ecoute", type: "ecoute", donnees: { etape: "ecoute" } } });
      break;
    case "chansonTrouvee":
      machine.envoyer({ type: "ACTIVITE_FIN", id: "ecoute" });
      machine.envoyer({
        type: "ALERTE",
        alerte: {
          type: "chanson",
          donnees: { etape: "trouvee", titre: "Pedro", artiste: "Jaxomy, Agatino Romero & Raffaella Carrà", pochette: pochetteFactice() ? `data:image/png;base64,${pochetteFactice()!.pngBase64}` : null, lien: null },
          dureeFacteur: 2.5,
        },
      });
      break;
    case "horloge":
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "horloge", type: "horloge" } });
      break;
    case "finHorloge":
      machine.envoyer({ type: "ACTIVITE_FIN", id: "horloge" });
      break;
    case "verrMaj":
      machine.envoyer({ type: "ALERTE", alerte: { type: "verrouillage", donnees: { touche: "majuscules", actif: true } } });
      break;
    case "usb":
      machine.envoyer({ type: "ALERTE", alerte: { type: "usb", donnees: { branche: true, lettre: "E:", nom: "KINGSTON", amovible: true } } });
      break;
    case "bluetooth":
      machine.envoyer({
        type: "ALERTE",
        alerte: { type: "bluetooth", donnees: { nom: "Écouteurs de Médéric", connecte: true, categorie: "audio", batterie: 80 } },
      });
      break;
    case "bluetoothOff":
      machine.envoyer({
        type: "ALERTE",
        alerte: { type: "bluetooth", donnees: { nom: "MX Master 3S", connecte: false, categorie: "souris", batterie: null } },
      });
      break;
  }
}
