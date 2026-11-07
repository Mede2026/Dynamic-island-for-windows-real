// Inter avec l'axe de taille optique (opsz) : version « Display » automatique aux grandes tailles.
import "@fontsource-variable/inter/opsz.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";

/** Les erreurs de la page vont dans le journal du backend (%APPDATA%\com.mederic.dynamicisland\journal.txt). */
function journaliser(message: string) {
  console.error(message);
  if (isTauri()) void invoke("journal_ecrire", { module: new URLSearchParams(location.search).toString() || "ile", message }).catch(() => undefined);
}
window.addEventListener("error", (e) => journaliser(`${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => journaliser(`promesse rejetée : ${String(e.reason)}`));

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

// Pas de menu « clic droit » du navigateur (Actualiser, Imprimer…) : ce n'est pas une page web.
// Dans un champ de texte, on le garde (couper / copier / coller).
document.addEventListener("contextmenu", (e) => {
  const cible = e.target as HTMLElement | null;
  if (!cible?.closest("input, textarea")) e.preventDefault();
});
// Pas de raccourcis du navigateur (actualiser, imprimer, rechercher, zoom).
document.addEventListener("keydown", (e) => {
  const touche = e.key.toLowerCase();
  if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && ["r", "p", "f", "g", "u", "s", "+", "-", "=", "0"].includes(touche))) e.preventDefault();
});

