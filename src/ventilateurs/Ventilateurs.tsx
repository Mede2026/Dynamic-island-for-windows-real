/**
 * Ventilateurs (Asus Fan Control) dans la carte de l'île : température et vitesses en direct,
 * profils, vitesse fixe, limite de charge de la batterie. Tout passe par le moteur Rust
 * (canal nommé) ; si Asus Fan Control n'est pas lancé, un message clair s'affiche.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { backend, dansTauri } from "../bridge/backend";
import { majDonnees, useDonnees } from "../bridge/donnees";
import type { StatutVentilo } from "../bridge/types";

const GRIS = "rgba(255,255,255,.58)";
const PROFILS: [string, string][] = [
  ["auto", "Auto"],
  ["silent", "Silence"],
  ["normal", "Normal"],
  ["max", "Max"],
  ["curve", "Courbe"],
];

const DEMO: StatutVentilo = {
  temperature: 58,
  rpms: [3100, 2950],
  appliedPercent: 0,
  controlOn: false,
  mode: "normal",
  unit: "percent",
  speed: 45,
  override: null,
  fansStopped: false,
  onCharger: true,
  batteryPercent: 78,
  batteryLimit: { enabled: true, percent: 80, fullChargePending: false },
  error: null,
};

/** Nom de mode d'Asus Fan Control → nos boutons (majuscules, synonymes anglais/français). */
export function normaliserMode(mode: string | null | undefined): string | null {
  const m = (mode ?? "").trim().toLowerCase();
  if (!m) return null;
  if (/^(silent|silence|silencieux|quiet|whisper)/.test(m)) return "silent";
  if (/^(normal|balanced|equilibre|équilibré|standard|default)/.test(m)) return "normal";
  if (/^(max|maximum|turbo|full|performance|perf)/.test(m)) return "max";
  if (/^(curve|courbe|custom|perso)/.test(m)) return "curve";
  if (/^(auto|automatic|automatique|bios)/.test(m)) return "auto";
  return null;
}

export function couleurTemperature(t: number | null): string {
  if (t === null) return "#fff";
  return t >= 85 ? "#ff453a" : t >= 70 ? "#ff9f0a" : "#fff";
}

/** Température courte pour la pilule (« 61° »), ou rien. */
export function TemperaturePilule() {
  const s = useDonnees().ventilo ?? (dansTauri() ? null : DEMO);
  if (!s || s.temperature === null) return null;
  return <span style={{ fontSize: 13, fontWeight: 600, color: couleurTemperature(s.temperature), fontVariantNumeric: "tabular-nums" }}>{Math.round(s.temperature)}°</span>;
}

export function Ventilateurs() {
  const direct = useDonnees().ventilo;
  const [erreur, setErreur] = useState("");
  const [vitesse, setVitesse] = useState<number | null>(null);
  // Dernier profil cliqué (retenu) : reste en bleu tant qu'Asus Fan Control n'annonce pas un AUTRE mode.
  const [choisi, setChoisi] = useState<string | null>(() => localStorage.getItem("ile-ventilo-profil"));
  const s: StatutVentilo | null | undefined = dansTauri() ? direct : DEMO;

  const agir = (p: Promise<StatutVentilo>) =>
    void p
      .then((n) => {
        setErreur("");
        if (n) majDonnees({ ventilo: n });
      })
      .catch((e) => setErreur(String(e)));

  useEffect(() => {
    if (dansTauri()) agir(backend.ventiloStatut());
  }, []);

  if (!s) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Asus Fan Control n'est pas lancé</div>
        <div style={{ color: GRIS, lineHeight: 1.4 }}>{erreur || "Ouvre Asus Fan Control : la température et les ventilateurs s'afficheront ici, en direct."}</div>
        <Pastille onClick={() => agir(backend.ventiloStatut())}>Réessayer</Pastille>
      </div>
    );
  }

  // Profil actif : le mode annoncé (quel que soit son nom exact), sinon le dernier cliqué, sinon auto.
  const modeConnu = normaliserMode(s.mode);
  const rienDeForce = s.appliedPercent === 0 && !s.controlOn;
  const profilActif =
    choisi === "auto" && rienDeForce ? "auto" : modeConnu && modeConnu !== "auto" ? modeConnu : (choisi ?? (rienDeForce ? "auto" : (modeConnu ?? "")));
  // Vitesse APPLIQUÉE par le mode (pas la vitesse manuelle réglée) : 0 = automatique, -1 = arrêtés.
  const applique = s.appliedPercent ?? 0;
  const pourcent = vitesse ?? (applique > 0 ? applique : (s.speed ?? 50));
  const texteVitesse = vitesse !== null ? `${Math.round(vitesse)} %` : s.fansStopped || applique < 0 ? "Arrêtés" : applique > 0 ? `${Math.round(applique)} %` : "Auto";
  const limite = s.batteryLimit;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 34, fontWeight: 300, color: couleurTemperature(s.temperature), fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {s.temperature === null ? "—" : `${Math.round(s.temperature)} °C`}
        </span>
        <span style={{ color: GRIS, flex: 1 }}>
          {s.fansStopped ? "Ventilateurs arrêtés" : s.rpms.length ? `${s.rpms.map((r) => Math.round(r)).join(" · ")} tr/min` : ""}
        </span>
        <span onClick={() => void backend.ventiloMontrer().catch((e) => setErreur(String(e)))} style={{ color: "#64a8ff", fontSize: 12, cursor: "pointer" }}>
          Ouvrir l'app
        </span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {PROFILS.map(([id, nom]) => (
          <Pastille
            key={id}
            actif={profilActif === id}
            onClick={() => {
              setChoisi(id);
              localStorage.setItem("ile-ventilo-profil", id);
              agir(id === "auto" ? backend.ventiloAuto() : backend.ventiloProfil(id as "silent"));
            }}
          >
            {nom}
          </Pastille>
        ))}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: GRIS, width: 62 }}>Vitesse</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pourcent}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setVitesse(Number(e.target.value))}
          onPointerUp={() => {
            if (vitesse !== null) agir(backend.ventiloVitesse(vitesse));
            setVitesse(null);
          }}
          style={{ flex: 1, accentColor: "#64d2ff", opacity: applique > 0 || vitesse !== null ? 1 : 0.55 }}
        />
        <span style={{ width: 62, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{texteVitesse}</span>
      </label>

      {limite && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: GRIS, width: 62 }}>Batterie</span>
          <Pastille actif={limite.enabled} onClick={() => agir(backend.ventiloLimiteBatterie(!limite.enabled, limite.percent ?? 80))}>
            Limite {limite.percent ?? 80} %
          </Pastille>
          {[60, 80, 100].map((p) => (
            <Pastille key={p} petit actif={limite.enabled && limite.percent === p} onClick={() => agir(backend.ventiloLimiteBatterie(true, p))}>
              {p}
            </Pastille>
          ))}
          <Pastille actif={limite.fullChargePending} onClick={() => agir(backend.ventiloChargeComplete(!limite.fullChargePending))}>
            Charge complète
          </Pastille>
          {s.batteryPercent !== null && <span style={{ color: GRIS }}>{Math.round(s.batteryPercent)} %{s.onCharger ? " · branché" : ""}</span>}
        </div>
      )}
      {(erreur || s.error) && <div style={{ color: "#ff9f8a", fontSize: 12 }}>{erreur || s.error}</div>}
    </div>
  );
}

function Pastille({ children, actif = false, petit = false, onClick }: { children: ReactNode; actif?: boolean; petit?: boolean; onClick: () => void }) {
  const style: CSSProperties = {
    border: 0,
    borderRadius: 999,
    padding: petit ? "5px 9px" : "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: actif ? "#000" : "#fff",
    background: actif ? "#64d2ff" : "rgba(255,255,255,.13)",
    boxShadow: actif ? "none" : "inset 0 0.5px 0 rgba(255,255,255,.18)",
    cursor: "default",
  };
  return (
    <button style={style} onPointerDown={(e) => e.stopPropagation()} onClick={onClick}>
      {children}
    </button>
  );
}
