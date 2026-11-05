/**
 * Pont backend ↔ machine à états :
 *  - écoute TOUS les événements du backend et les affiche dans la console (journal de débogage) ;
 *  - les traduit en événements de la machine à états ;
 *  - exécute les effets de la machine qui concernent le backend.
 *
 * Phase 1 : rien n'est dessiné, donc rien n'est touchable (zones = []) :
 * tous les clics traversent la fenêtre.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import type { IslandMachine } from "../state/islandMachine";
import { backend, dansTauri, ecouter } from "./backend";
import { Traducteur } from "./traducteur";
import { NOMS_EVENEMENTS, type InfoFenetre } from "./types";

const STYLE = "color:#0a84ff;font-weight:bold";

function log(module: string, ...valeurs: unknown[]) {
  console.log(`%c[${module}]`, STYLE, ...valeurs);
}

/** Dernières infos d'écran (taux de rafraîchissement, échelle…), lisibles par le rendu. */
export const ecranCourant: { info: InfoFenetre | null } = { info: null };

export function demarrerPont(machine: IslandMachine): () => void {
  if (!dansTauri()) {
    log("pont", "hors de Tauri (navigateur) : backend désactivé");
    return () => machine.detruire();
  }

  const traducteur = new Traducteur();
  const arrets: Promise<UnlistenFn>[] = [];
  const envoyer = (evs: ReturnType<Traducteur["media"]>) => evs.forEach((e) => machine.envoyer(e));

  // 1. Journal de tous les événements du backend.
  for (const nom of NOMS_EVENEMENTS) {
    arrets.push(
      ecouter(nom, (donnees) => {
        if (nom === "media-pochette") {
          const p = donnees as { id: string; couleurDominante: number[]; pngBase64: string };
          log(nom, { id: p.id, couleurDominante: p.couleurDominante, tailleBase64: p.pngBase64.length });
        } else {
          log(nom, donnees);
        }
      }),
    );
  }

  // 2. Traduction vers la machine à états.
  arrets.push(ecouter("media", (m) => envoyer(traducteur.media(m))));
  arrets.push(ecouter("minuteur", (m) => envoyer(traducteur.minuteurEtat(m))));
  arrets.push(ecouter("batterie", (b) => envoyer(traducteur.batterieEtat(b))));
  arrets.push(ecouter("volume", (v) => envoyer(traducteur.volume(v))));
  arrets.push(ecouter("ne-pas-deranger", (n) => envoyer(traducteur.nePasDerangerEtat(n))));
  arrets.push(ecouter("notification", (n) => envoyer(traducteur.notification(n))));
  arrets.push(ecouter("survol", (s) => envoyer(traducteur.survol(s))));
  arrets.push(ecouter("clic-exterieur", () => envoyer(traducteur.clicExterieur())));
  arrets.push(
    ecouter("ecran", (info) => {
      ecranCourant.info = info;
    }),
  );

  // 3. Effets de la machine vers le backend + journal des transitions.
  let ecouteExterieur = false;
  const desabonner = machine.abonner((etat, effets, ev) => {
    for (const effet of effets) {
      if (effet.type === "transition") {
        const t = effet.transition;
        log("machine", `${t.de} → ${t.vers} (ressort « ${t.ressort} »${t.interrompt ? `, interrompt #${t.interrompt}` : ""})`, {
          evenement: ev.type,
          principale: etat.principaleId,
          bulle: etat.bulleId,
        });
      } else if (effet.type === "activer") {
        log("machine", `activer « ${effet.activiteId} » (ouvrir l'app source : phase 2)`);
      }
    }
    // Les clics hors de l'île ne sont écoutés qu'en mode étendu.
    const voulu = etat.mode === "etendu";
    if (voulu !== ecouteExterieur) {
      ecouteExterieur = voulu;
      void backend.ecouterClicExterieur(voulu);
    }
  });

  // 4. État initial.
  void backend.zonesTouchables([]); // phase 1 : rien de visible → rien de touchable
  void Promise.all([
    backend.infoFenetre(),
    backend.media(),
    backend.batterie(),
    backend.volume(),
    backend.nePasDeranger(),
    backend.notifications(),
    backend.minuteur(),
  ]).then(([fenetre, media, batterie, volume, npd, notifs, minuteur]) => {
    ecranCourant.info = fenetre;
    log("init", {
      fenetre,
      tauxRafraichissementHz: fenetre?.ecran.frequenceHz ?? "inconnu",
      media,
      batterie,
      volume,
      nePasDeranger: npd,
      notifications: notifs,
      minuteur,
    });
    envoyer(traducteur.batterieEtat(batterie));
    envoyer(traducteur.nePasDerangerEtat(npd));
    envoyer(traducteur.media(media));
    envoyer(traducteur.minuteurEtat(minuteur));
  });

  return () => {
    desabonner();
    machine.detruire();
    arrets.forEach((p) => void p.then((arreter) => arreter()));
  };
}
