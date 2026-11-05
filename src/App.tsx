/**
 * App — trois modes selon l'adresse :
 *  - (défaut)   : l'île (fenêtre transparente « ile ») ;
 *  - ?panneau   : le panneau de réglages (fenêtre « reglages », Ctrl+Alt+D) ;
 *  - ?demo      : l'île dans un navigateur, sans backend (fond clair, scénarios factices).
 */

import { useEffect, useMemo } from "react";
import { backend } from "./bridge/backend";
import { demarrerPont, ecranCourant } from "./bridge/pont";
import { jouer, type NomScenario } from "./demo/scenarios";
import { Panneau } from "./panneau/Panneau";
import { Ile } from "./rendu/Ile";
import { IslandMachine } from "./state/islandMachine";

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
  return <AppIle demo={parametres.has("demo")} />;
}

function AppIle({ demo }: { demo: boolean }) {
  const machine = useMemo(() => new IslandMachine(), []);

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
