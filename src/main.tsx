// Inter avec l'axe de taille optique (opsz) : version « Display » automatique aux grandes tailles.
import "@fontsource-variable/inter/opsz.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Charger Inter AVANT le premier affichage : la largeur des alertes est mesurée avec la
 * police ; mesurée avec une police de secours, le texte serait tronqué.
 */
const chargement = Promise.all(
  ["300", "400", "500", "600"].map((g) => document.fonts.load(`${g} 16px 'Inter Variable'`)),
).catch(() => undefined);
const delaiMax = new Promise((r) => setTimeout(r, 1500));

void Promise.race([chargement, delaiMax]).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
