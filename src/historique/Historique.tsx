/**
 * Presse-papiers récent — Ctrl+Alt+V : les 10 derniers textes copiés (en mémoire seulement).
 * Clic ou Entrée : le texte est recopié et collé dans l'app d'avant (comme Windows + V).
 * Flèches pour choisir, Échap pour fermer.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type CSSProperties } from "react";
import { backend, dansTauri } from "../bridge/backend";

const s = {
  page: {
    height: "100vh",
    boxSizing: "border-box",
    padding: 14,
    background: "#1c1c1e",
    color: "#fff",
    fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
    fontSize: 14,
    colorScheme: "dark",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    userSelect: "none",
  } satisfies CSSProperties,
  entete: { display: "flex", alignItems: "center", fontWeight: 650, fontSize: 16 } satisfies CSSProperties,
  liste: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  element: {
    border: 0,
    borderRadius: 12,
    padding: "9px 12px",
    background: "#2c2c2e",
    color: "#fff",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    lineHeight: 1.35,
  } satisfies CSSProperties,
  gris: { color: "#98989f" } satisfies CSSProperties,
};

const fermerFenetre = () => {
  if (dansTauri()) void getCurrentWindow().close();
};

/** `dansIle` : affiché dans l'île (fond transparent, sans titre) au lieu d'une fenêtre. */
export function Historique({ fermer = fermerFenetre, dansIle = false }: { fermer?: () => void; dansIle?: boolean } = {}) {
  const coller = (i: number) => {
    fermer();
    void backend.historiqueColler(i);
  };
  const [textes, setTextes] = useState<string[]>([]);
  const [choix, setChoix] = useState(0);

  useEffect(() => {
    void backend.historiqueLire().then((t) => setTextes(t ?? []));
  }, []);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
      if (e.key === "ArrowDown") setChoix((c) => Math.min(c + 1, textes.length - 1));
      if (e.key === "ArrowUp") setChoix((c) => Math.max(c - 1, 0));
      if (e.key === "Enter" && textes.length > 0) coller(choix);
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [textes, choix]);

  return (
    <div style={dansIle ? { ...s.page, height: "100%", padding: 0, background: "transparent" } : s.page}>
      <div style={{ ...s.entete, ...(dansIle ? { position: "absolute", right: 0, top: -30 } : {}) }}>
        {!dansIle && <span style={{ flex: 1 }}>Copiés récemment</span>}
        {textes.length > 0 && (
          <button
            onClick={() => {
              void backend.historiqueVider();
              setTextes([]);
            }}
            style={{ border: 0, background: "none", color: "#98989f", font: "inherit", fontSize: 13, cursor: "pointer" }}
          >
            Tout effacer
          </button>
        )}
      </div>
      <div style={s.liste}>
        {textes.length === 0 && <p style={s.gris}>Rien pour l'instant. Les textes copiés apparaissent ici (gardés en mémoire seulement, jamais sur le disque).</p>}
        {textes.map((t, i) => (
          <button
            key={i}
            onClick={() => coller(i)}
            onMouseEnter={() => setChoix(i)}
            style={{ ...s.element, outline: i === choix ? "2px solid #0a84ff" : "none" }}
          >
            {t.length > 300 ? `${t.slice(0, 300)}…` : t}
          </button>
        ))}
      </div>
      {!dansIle && <div style={{ ...s.gris, fontSize: 12 }}>Entrée ou clic : coller · ↑ ↓ : choisir · Échap : fermer</div>}
    </div>
  );
}
