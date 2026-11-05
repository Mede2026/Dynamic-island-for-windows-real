/**
 * Panneau de réglages (développement) — ouvert avec Ctrl+Alt+D.
 *  - un curseur par valeur numérique de island.config.ts, appliqué EN DIRECT à l'île ;
 *  - des boutons pour déclencher chaque transition (une fois ou en boucle) ;
 *  - Exporter : copie les valeurs modifiées en JSON (à recopier dans island.config.ts) ;
 *  - options : écran, démarrage avec Windows, cacher en plein écran.
 */

import { emitTo } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { backend, dansTauri } from "../bridge/backend";
import type { InfoEcran } from "../bridge/types";
import { lire } from "../config/store";
import { SCENARIOS, type NomScenario } from "../demo/scenarios";
import { islandConfig } from "../island.config";

/** Chemins de toutes les valeurs numériques de la config. */
function cheminsNumeriques(obj: unknown, prefixe = ""): string[] {
  if (typeof obj === "number") return [prefixe];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    // Les tailles « dip » sont calculées (pt × ISLAND_SCALE) : pas de curseur.
    k === "dip" ? [] : cheminsNumeriques(v, prefixe ? `${prefixe}.${k}` : k),
  );
}

async function envoyer(nom: "config-direct" | "declencher", donnees: unknown) {
  if (dansTauri()) await emitTo("ile", nom, donnees);
}

const BOUCLES: Record<string, NomScenario[]> = {
  "Ouvrir / fermer (V3)": ["musique", "etendre", "fermer"],
  "Split (V4)": ["musique", "minuteur", "finMinuteur"],
  "Alerte (V7)": ["musique", "charge"],
  "Repos ↔ compact (V2/V7)": ["musique", "finMusique"],
};

const style = {
  page: { fontFamily: "'Inter Variable', 'Segoe UI', sans-serif", fontSize: 13, color: "#1c1c1e", background: "#f5f5f7", minHeight: "100vh", padding: 16, boxSizing: "border-box" as const, userSelect: "text" as const, overflow: "auto", height: "100vh" },
  section: { background: "#fff", borderRadius: 12, padding: 12, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
  titre: { fontSize: 15, fontWeight: 600, margin: "0 0 8px" },
  bouton: { border: 0, borderRadius: 8, padding: "6px 10px", margin: "0 6px 6px 0", background: "#e8e8ed", cursor: "pointer", font: "inherit" },
  ligne: { display: "grid", gridTemplateColumns: "1fr 140px 64px", gap: 8, alignItems: "center", padding: "2px 0" },
};

export function Panneau() {
  const chemins = useMemo(() => cheminsNumeriques(islandConfig), []);
  const [surcharges, setSurcharges] = useState<Record<string, number>>({});
  const [filtre, setFiltre] = useState("");
  const [boucle, setBoucle] = useState<string | null>(null);
  const [ecrans, setEcrans] = useState<InfoEcran[]>([]);
  const [auto, setAuto] = useState(false);
  const [cacher, setCacher] = useState(false);
  const [message, setMessage] = useState("");
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.style.background = "#f5f5f7";
    document.documentElement.style.overflow = "auto";
    void backend.ecrans().then((e) => e && setEcrans(e));
    void backend.demarrageAuto().then((a) => setAuto(Boolean(a)));
  }, []);

  useEffect(() => {
    void envoyer("config-direct", surcharges);
  }, [surcharges]);

  // Boucle de scénario : un pas toutes les 1,6 s.
  useEffect(() => {
    if (!boucle) return;
    const pas = BOUCLES[boucle]!;
    let i = 0;
    const suivant = () => {
      void envoyer("declencher", pas[i % pas.length]);
      i++;
      minuterie.current = setTimeout(suivant, 1600);
    };
    suivant();
    return () => {
      if (minuterie.current) clearTimeout(minuterie.current);
    };
  }, [boucle]);

  const visibles = chemins.filter((c) => c.toLowerCase().includes(filtre.toLowerCase()));

  return (
    <div style={style.page}>
      <div style={style.section}>
        <p style={style.titre}>Déclencher</p>
        {(Object.keys(SCENARIOS) as NomScenario[]).map((n) => (
          <button key={n} style={style.bouton} onClick={() => void envoyer("declencher", n)} title={SCENARIOS[n]}>
            {SCENARIOS[n]}
          </button>
        ))}
        <p style={{ ...style.titre, marginTop: 8 }}>En boucle</p>
        {Object.keys(BOUCLES).map((b) => (
          <button key={b} style={{ ...style.bouton, background: boucle === b ? "#0a84ff" : "#e8e8ed", color: boucle === b ? "#fff" : undefined }} onClick={() => setBoucle(boucle === b ? null : b)}>
            {b}
          </button>
        ))}
      </div>

      <div style={style.section}>
        <p style={style.titre}>Options</p>
        <label style={{ display: "block", marginBottom: 6 }}>
          Écran :{" "}
          <select onChange={(e) => void backend.choisirEcran(e.target.value || null)} defaultValue="">
            <option value="">Écran principal</option>
            {ecrans.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} — {e.rect.largeur}×{e.rect.hauteur}, {Math.round(e.facteurEchelle * 100)} %, {e.frequenceHz ?? "?"} Hz
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={auto} onChange={(e) => void backend.definirDemarrageAuto(e.target.checked).then((a) => setAuto(Boolean(a)))} /> Démarrer avec Windows
        </label>
        <label style={{ display: "block" }}>
          <input
            type="checkbox"
            checked={cacher}
            onChange={(e) => {
              setCacher(e.target.checked);
              void backend.cacherEnPleinEcran(e.target.checked);
            }}
          />{" "}
          Cacher quand une app est en plein écran
        </label>
      </div>

      <div style={style.section}>
        <p style={style.titre}>Valeurs (island.config.ts)</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input placeholder="Filtrer (ex. ressorts.ouvrir)" value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ flex: 1, font: "inherit", padding: 6, borderRadius: 8, border: "1px solid #d2d2d7" }} />
          <button style={style.bouton} onClick={() => setSurcharges({})}>
            Réinitialiser
          </button>
          <button
            style={{ ...style.bouton, background: "#0a84ff", color: "#fff" }}
            onClick={() => {
              const json = JSON.stringify(surcharges, null, 2);
              void navigator.clipboard.writeText(json).then(
                () => setMessage(`Copié : ${Object.keys(surcharges).length} valeur(s) modifiée(s)`),
                () => setMessage(json),
              );
            }}
          >
            Exporter
          </button>
        </div>
        {message && <p style={{ color: "#52514e", whiteSpace: "pre-wrap" }}>{message}</p>}
        {visibles.map((c) => {
          const base = lire(islandConfig, c) as number;
          const valeur = surcharges[c] ?? base;
          const max = base === 0 ? 1 : Math.abs(base) * 2;
          const min = base < 0 ? -max : 0;
          return (
            <div key={c} style={style.ligne}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: surcharges[c] !== undefined ? "#0a84ff" : "#52514e" }}>{c}</span>
              <input type="range" min={min} max={max} step={max / 400} value={valeur} onChange={(e) => setSurcharges({ ...surcharges, [c]: Number(e.target.value) })} />
              <input
                type="number"
                value={Number(valeur.toFixed(4))}
                step={max / 400}
                onChange={(e) => setSurcharges({ ...surcharges, [c]: Number(e.target.value) })}
                style={{ width: 64, font: "inherit", fontSize: 11 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
