/**
 * Note rapide — Ctrl+Alt+N ou le menu de l'île : un bloc-notes toujours sous la main,
 * enregistré au fil de la frappe (sur ce PC seulement). Échap ferme.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { dansTauri } from "../bridge/backend";

const CLE = "ile-note";

export function Note() {
  const [texte, setTexte] = useState(() => localStorage.getItem(CLE) ?? "");
  useEffect(() => {
    localStorage.setItem(CLE, texte);
  }, [texte]);
  useEffect(() => {
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dansTauri()) void getCurrentWindow().close();
    };
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, []);
  return (
    <div
      style={{
        height: "100vh",
        boxSizing: "border-box",
        padding: 14,
        background: "#1c1c1e",
        color: "#fff",
        fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        colorScheme: "dark",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontWeight: 650, fontSize: 16 }}>
        <span style={{ flex: 1, color: "#ffd60a" }}>Note</span>
        <span style={{ color: "#98989f", fontSize: 12, fontWeight: 400 }}>{texte.length} caractères · enregistrée</span>
      </div>
      <textarea
        autoFocus
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder="Écris ici… (enregistré automatiquement)"
        style={{
          flex: 1,
          resize: "none",
          border: 0,
          borderRadius: 12,
          padding: 12,
          background: "#2c2c2e",
          color: "#fff",
          font: "inherit",
          fontSize: 14,
          lineHeight: 1.45,
          outline: "none",
        }}
      />
    </div>
  );
}
