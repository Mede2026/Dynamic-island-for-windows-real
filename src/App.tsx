/**
 * App — PHASE 1 : la fenêtre existe mais n'affiche RIEN.
 * Le rendu de l'île (pilule, animations) sera écrit en phase 2, avec les mesures.
 */

import { useEffect } from "react";
import { backend } from "./bridge/backend";
import { demarrerPont, ecranCourant } from "./bridge/pont";
import { IslandMachine } from "./state/islandMachine";

declare global {
  interface Window {
    /** Outils de débogage accessibles dans la console (F12) : __ile.backend.minuteurDemarrer(5000)… */
    __ile?: { machine: IslandMachine; backend: typeof backend; ecran: typeof ecranCourant };
  }
}

export default function App() {
  useEffect(() => {
    const machine = new IslandMachine();
    window.__ile = { machine, backend, ecran: ecranCourant };
    const arreter = demarrerPont(machine);
    return () => {
      arreter();
      delete window.__ile;
    };
  }, []);

  // Canevas vide et transparent.
  return <div id="ile-canevas" aria-hidden="true" />;
}
