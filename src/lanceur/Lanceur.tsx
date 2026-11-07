/**
 * Lanceur rapide — Ctrl+Alt+M : démarrer un minuteur en deux clics (ou Entrée).
 * Si un minuteur tourne déjà : pause / reprise / annulation.
 * Échap ferme la fenêtre ; elle se ferme aussi dès qu'un minuteur démarre.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { backend, dansTauri } from "../bridge/backend";
import { formaterDuree } from "../bridge/donnees";
import type { EtatMinuteur } from "../bridge/types";
import { islandConfig } from "../island.config";

const DUREES_MIN = [1, 3, 5, 10, 15, 20, 25, 30, 45, 60];
const ORANGE = islandConfig.minuteur.couleur ?? "#ff8c2b";

function fermerFenetre() {
  if (dansTauri()) void getCurrentWindow().close();
}

/** « 5 », « 5:30 », « 1:05:00 », « 90s », « 1h30 » → millisecondes. */
export function lireDuree(texte: string): number | null {
  const t = texte.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const hm = /^(\d+)h(\d{1,2})?$/.exec(t);
  if (hm) return (Number(hm[1]) * 60 + Number(hm[2] ?? 0)) * 60_000;
  const s = /^(\d+)s$/.exec(t);
  if (s) return Number(s[1]) * 1000;
  const parties = t.split(":").map(Number);
  if (parties.some((x) => !Number.isFinite(x) || x < 0)) return null;
  if (parties.length === 1) return parties[0]! * 60_000; // minutes
  if (parties.length === 2) return (parties[0]! * 60 + parties[1]!) * 1000;
  if (parties.length === 3) return ((parties[0]! * 60 + parties[1]!) * 60 + parties[2]!) * 1000;
  return null;
}

const s = {
  page: {
    height: "100vh",
    boxSizing: "border-box",
    padding: 18,
    background: "#1c1c1e",
    color: "#fff",
    fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
    fontSize: 14,
    colorScheme: "dark",
    userSelect: "none",
  } satisfies CSSProperties,
  titre: { fontSize: 20, fontWeight: 600, margin: "0 0 14px", color: ORANGE } satisfies CSSProperties,
  grille: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 } satisfies CSSProperties,
  pastille: {
    border: 0,
    borderRadius: 999,
    padding: "10px 0",
    background: "rgba(255,255,255,.12)",
    color: "#fff",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  principal: {
    border: 0,
    borderRadius: 999,
    padding: "10px 18px",
    background: ORANGE,
    color: "#000",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
};

/** `dansIle` : affiché dans l'île (fond transparent, sans titre) au lieu d'une fenêtre. */
export function Lanceur({ fermer = fermerFenetre, dansIle = false }: { fermer?: () => void; dansIle?: boolean } = {}) {
  const [saisie, setSaisie] = useState("");
  const [minuteur, setMinuteur] = useState<EtatMinuteur | null>(null);
  const [erreur, setErreur] = useState("");
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dansIle) document.body.style.background = "#1c1c1e";
    champ.current?.focus();
    void backend.minuteur().then((m) => m && setMinuteur(m));
    const touche = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);

  const demarrer = (ms: number | null) => {
    if (!ms || ms <= 0) {
      setErreur("Durée non comprise (ex. 5, 2:30, 1h15, 90s)");
      return;
    }
    void backend.minuteurDemarrer(ms).then(fermer);
  };

  const enCours = minuteur && (minuteur.statut === "enCours" || minuteur.statut === "pause");

  return (
    <div style={dansIle ? { ...s.page, height: "100%", padding: 0, background: "transparent" } : s.page}>
      {!dansIle && <p style={s.titre}>Minuteur</p>}
      {enCours ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 34, fontWeight: 300, margin: "0 0 10px", color: ORANGE, fontVariantNumeric: "tabular-nums" }}>
            {formaterDuree(minuteur.restantMs)}
            {minuteur.statut === "pause" && <span style={{ fontSize: 14, color: "#8e8e93" }}> en pause</span>}
          </p>
          <button
            style={{ ...s.principal, marginRight: 8 }}
            onClick={() => void (minuteur.statut === "pause" ? backend.minuteurReprendre() : backend.minuteurPause()).then(fermer)}
          >
            {minuteur.statut === "pause" ? "Reprendre" : "Pause"}
          </button>
          <button style={{ ...s.pastille, padding: "10px 18px" }} onClick={() => void backend.minuteurAnnuler().then(fermer)}>
            Annuler
          </button>
          <p style={{ color: "#8e8e93", margin: "14px 0 6px" }}>Ou en lancer un nouveau :</p>
        </div>
      ) : null}
      <div style={s.grille}>
        {DUREES_MIN.map((m) => (
          <button key={m} style={s.pastille} onClick={() => demarrer(m * 60_000)}>
            {m < 60 ? `${m} min` : "1 h"}
          </button>
        ))}
      </div>
      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          demarrer(lireDuree(saisie));
        }}
      >
        <input
          ref={champ}
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
            setErreur("");
          }}
          placeholder="Autre durée : 7, 2:30, 1h15…"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ flex: 1, minWidth: 0, borderRadius: 999, border: 0, padding: "10px 14px", background: "rgba(255,255,255,.12)", color: "#fff", font: "inherit" }}
        />
        <button type="submit" style={s.principal}>
          Démarrer
        </button>
      </form>
      {erreur && <p style={{ color: "#ff453a", margin: "8px 0 0", fontSize: 12 }}>{erreur}</p>}
      {!dansIle && <p style={{ color: "#636366", fontSize: 11, margin: "12px 0 0" }}>Entrée pour démarrer · Échap pour fermer · Ctrl+Alt+M</p>}
    </div>
  );
}
