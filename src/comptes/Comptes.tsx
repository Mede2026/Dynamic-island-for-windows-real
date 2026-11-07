/**
 * Comptes à rebours (examens…) dans la carte de l'île, ouverte par le clic droit : ajouter un
 * nom et une date, voir les jours qui restent, supprimer. Enregistrés dans les réglages ;
 * l'île les rappelle chaque jour pendant les 30 jours d'avant.
 */

import { useState } from "react";
import { backend } from "../bridge/backend";
import { definirPreferences, preferencesActuelles, useConfig } from "../config/store";

const ORANGE = "#ff9f0a";
const GRIS = "rgba(255,255,255,.58)";

export function joursRestants(date: string, maintenant = new Date()): number {
  const jour = new Date(`${date}T00:00:00`).getTime();
  const auj = new Date(maintenant.toDateString()).getTime();
  return Math.round((jour - auj) / 86_400_000);
}

export function quand(j: number): string {
  if (j < 0) return "Passé";
  if (j === 0) return "Aujourd'hui";
  if (j === 1) return "Demain";
  return `Dans ${j} jours`;
}

export function Comptes() {
  useConfig(); // se redessine quand les réglages changent
  const comptes = [...(preferencesActuelles().comptesARebours ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const [nom, setNom] = useState("");
  const [date, setDate] = useState("");

  const enregistrer = (liste: { nom: string; date: string }[]) => {
    definirPreferences({ ...preferencesActuelles(), comptesARebours: liste });
    void backend.definirAffichage({ comptesARebours: liste });
  };
  const champ = { background: "rgba(255,255,255,.12)", border: 0, outline: "none", borderRadius: 10, padding: "8px 10px", color: "#fff", fontSize: 13, colorScheme: "dark" as const };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", fontSize: 13 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!nom.trim() || !date) return;
          enregistrer([...(preferencesActuelles().comptesARebours ?? []), { nom: nom.trim(), date }]);
          setNom("");
          setDate("");
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input autoFocus className="champ-ile" value={nom} onChange={(e) => setNom(e.target.value)} onPointerDown={(e) => e.stopPropagation()} placeholder="Examen de sciences" style={{ ...champ, flex: 1, minWidth: 0 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onPointerDown={(e) => e.stopPropagation()} style={champ} />
        <button type="submit" onPointerDown={(e) => e.stopPropagation()} style={{ border: 0, borderRadius: 999, padding: "0 14px", background: ORANGE, color: "#000", fontWeight: 600, fontSize: 13 }}>
          Ajouter
        </button>
      </form>
      <div className="defile-ile" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {comptes.length === 0 && <div style={{ color: GRIS }}>Ajoute un examen ou un événement : l'île te le rappelle chaque jour, 30 jours avant.</div>}
        {comptes.map((c) => {
          const j = joursRestants(c.date);
          return (
            <div key={`${c.nom}-${c.date}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,.08)", borderRadius: 12, padding: "8px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nom}</div>
                <div style={{ color: GRIS, fontSize: 11.5 }}>{new Date(`${c.date}T00:00:00`).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</div>
              </div>
              <div style={{ color: j <= 3 && j >= 0 ? ORANGE : "#fff", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{quand(j)}</div>
              <span
                title="Supprimer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => enregistrer((preferencesActuelles().comptesARebours ?? []).filter((x) => !(x.nom === c.nom && x.date === c.date)))}
                style={{ color: GRIS, fontSize: 15, padding: "0 2px", cursor: "pointer" }}
              >
                ✕
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
