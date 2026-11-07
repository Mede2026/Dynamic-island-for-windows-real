/**
 * Recherche rapide — Ctrl+Alt+Espace : un mot ou un sujet → résumé Wikipédia (français,
 * sinon anglais) ; un calcul → son résultat. Le texte copié (s'il est court) est proposé d'avance. Échap ferme.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { backend, dansTauri } from "../bridge/backend";
import { calculer, estCalcul, formaterNombre } from "./calcul";

interface Resultat {
  titre: string;
  description: string | null;
  resume: string;
  lien: string;
  image: string | null;
  langue: string;
}

const s = {
  page: {
    height: "100vh",
    boxSizing: "border-box",
    padding: 16,
    background: "#1c1c1e",
    color: "#fff",
    fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
    fontSize: 14,
    colorScheme: "dark",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  champ: {
    border: 0,
    borderRadius: 12,
    padding: "11px 14px",
    background: "#2c2c2e",
    color: "#fff",
    font: "inherit",
    fontSize: 16,
    outline: "none",
  } satisfies CSSProperties,
  carte: { overflowY: "auto", flex: 1, lineHeight: 1.45 } satisfies CSSProperties,
  titre: { fontSize: 19, fontWeight: 650, margin: "0 0 2px" } satisfies CSSProperties,
  gris: { color: "#98989f" } satisfies CSSProperties,
  lien: { border: 0, background: "none", color: "#64a8ff", font: "inherit", padding: 0, cursor: "pointer" } satisfies CSSProperties,
};

export function Recherche() {
  const [terme, setTerme] = useState("");
  const [etat, setEtat] = useState<"attente" | "recherche" | "rien" | "erreur">("attente");
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    champ.current?.focus();
    // Texte copié court : proposé d'avance (sélectionné, on peut taper par-dessus).
    void navigator.clipboard
      ?.readText?.()
      .then((t) => {
        const court = t.trim();
        if (court && court.length <= 60 && !court.includes("\n")) {
          setTerme(court);
          requestAnimationFrame(() => champ.current?.select());
        }
      })
      .catch(() => undefined);
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dansTauri()) void getCurrentWindow().close();
    };
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, []);

  const resultatCalcul = estCalcul(terme) ? calculer(terme) : null;

  const chercher = async () => {
    if (!terme.trim()) return;
    if (resultatCalcul !== null) {
      void backend.copierTexte(String(resultatCalcul));
      return;
    }
    setEtat("recherche");
    setResultat(null);
    try {
      const r = (await backend.rechercheRapide(terme)) as Resultat | null;
      setResultat(r);
      setEtat(r ? "attente" : "rien");
    } catch {
      setEtat("erreur");
    }
  };

  return (
    <div style={s.page}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void chercher();
        }}
      >
        <input
          ref={champ}
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
          placeholder="Un mot, une personne, un lieu…"
          style={{ ...s.champ, width: "100%", boxSizing: "border-box" }}
        />
      </form>
      <div style={s.carte}>
        {resultatCalcul !== null && (
          <div>
            <div style={{ fontSize: 34, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>= {formaterNombre(resultatCalcul)}</div>
            <div style={s.gris}>Entrée pour copier le résultat</div>
          </div>
        )}
        {etat === "recherche" && <p style={s.gris}>Recherche…</p>}
        {etat === "rien" && <p style={s.gris}>Rien trouvé sur Wikipédia.</p>}
        {etat === "erreur" && <p style={s.gris}>Pas de connexion à Wikipédia.</p>}
        {etat === "attente" && !resultat && resultatCalcul === null && <p style={s.gris}>Entrée pour chercher · un calcul aussi (« 15 % de 80 ») · Échap pour fermer</p>}
        {resultat && (
          <>
            {resultat.image && (
              <img src={resultat.image} alt="" style={{ float: "right", width: 84, height: 84, objectFit: "cover", borderRadius: 12, marginLeft: 12 }} />
            )}
            <h1 style={s.titre}>{resultat.titre}</h1>
            {resultat.description && <div style={{ ...s.gris, marginBottom: 8 }}>{resultat.description}</div>}
            <p style={{ margin: "0 0 10px" }}>{resultat.resume}</p>
            {resultat.lien && (
              <button style={s.lien} onClick={() => void backend.ouvrirLien(resultat.lien)}>
                Lire sur Wikipédia{resultat.langue === "en" ? " (anglais)" : ""} →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
