/**
 * Scénarios de démonstration : pilotent la machine à états avec des données factices.
 * Utilisés par le panneau de réglages (boutons « déclencher ») et la validation de
 * fidélité (enregistrement de notre île, tools/enregistrer_ile.mjs).
 */

import { majDonnees, donnees } from "../bridge/donnees";
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

export const SCENARIOS = {
  musique: "Musique : repos → compact",
  etendre: "Appui long : → étendu",
  fermer: "Clic extérieur : étendu → compact",
  minuteur: "Minuteur : → split",
  finMinuteur: "Fin du minuteur : split → compact",
  finMusique: "Fin de la musique : → repos",
  charge: "Alerte « En charge »",
  volume: "Alerte volume",
  pressePapiers: "Alerte presse-papiers",
  camera: "Point vert (caméra)",
  micro: "Point orange (micro)",
  confidentialiteOff: "Aucun point",
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
      majDonnees({ minuteur: minuteurFactice() });
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "minuteur", type: "minuteur" } });
      break;
    case "finMinuteur":
      machine.envoyer({ type: "ACTIVITE_FIN", id: "minuteur" });
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
  }
}
