/**
 * App — trois modes selon l'adresse :
 *  - (défaut)   : l'île (fenêtre transparente « ile ») ;
 *  - ?panneau   : le panneau de réglages (fenêtre « reglages », Ctrl+Alt+D) ;
 *  - ?lanceur   : le lanceur rapide de minuteur (fenêtre « lanceur », Ctrl+Alt+M) ;
 *  - ?recherche : la recherche rapide Wikipédia (fenêtre « recherche », Ctrl+Alt+Espace) ;
 *  - ?demo      : l'île dans un navigateur, sans backend (fond clair, scénarios factices).
 */

import { useEffect, useMemo } from "react";
import { backend } from "./bridge/backend";
import { demarrerPont, ecranCourant } from "./bridge/pont";
import { jouer, type NomScenario } from "./demo/scenarios";
import { Lanceur } from "./lanceur/Lanceur";
import { Recherche } from "./recherche/Recherche";
import { Historique } from "./historique/Historique";
import { Note } from "./note/Note";
import { Panneau } from "./panneau/Panneau";
import { Ile } from "./rendu/Ile";
import { IslandMachine } from "./state/islandMachine";
import { config } from "./config/store";

declare global {
  interface Window {
    /** Outils de débogage (console F12) : __ile.jouer("musique"), __ile.backend.minuteurDemarrer(5000)… */
    __ile?: {
      machine: IslandMachine;
      backend: typeof backend;
      ecran: typeof ecranCourant;
      jouer: (nom: NomScenario) => void;
    };
  }
}

const parametres = new URLSearchParams(window.location.search);

export default function App() {
  if (parametres.has("panneau")) return <Panneau />;
  if (parametres.has("lanceur")) return <Lanceur />;
  if (parametres.has("recherche")) return <Recherche />;
  if (parametres.has("historique")) return <Historique />;
  if (parametres.has("note")) return <Note />;
  return <AppIle demo={parametres.has("demo")} />;
}

function AppIle({ demo }: { demo: boolean }) {
  // Les durées suivent la configuration vivante (préférence « durée des alertes »).
  const machine = useMemo(
    () =>
      new IslandMachine(() => ({
        alerteAffichageMs: config().durees.alerteAffichageMs,
        etenduFermetureAutoMs: config().durees.etenduFermetureAutoMs,
      })),
    [],
  );

  useEffect(() => {
    if (demo) document.body.classList.add("demo");
    window.__ile = { machine, backend, ecran: ecranCourant, jouer: (nom) => jouer(machine, nom) };
    const arreter = demo ? () => machine.detruire() : demarrerPont(machine);
    return () => {
      arreter();
      delete window.__ile;
    };
  }, [machine, demo]);

  return <Ile machine={machine} />;
}
