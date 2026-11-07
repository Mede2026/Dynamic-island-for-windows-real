/**
 * Panneau de réglages — Ctrl+Alt+D (ouvre / ferme).
 *  1. Arrêter le test / Quitter ;
 *  2. Personnaliser : taille, vitesse, onde sonore, durée et choix des alertes (mémorisé) ;
 *  3. Options : écran, démarrage avec Windows, plein écran, compatibilité des clics ;
 *  4. Tester les animations (les tests s'arrêtent à la fermeture du panneau) ;
 *  5. Mode développeur (replié) : chaque valeur de island.config.ts, en direct, + Exporter.
 */

import { emitTo } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { backend, dansTauri } from "../bridge/backend";
import type { InfoEcran } from "../bridge/types";
import { lire, type Preferences } from "../config/store";
import { SCENARIOS, type NomScenario } from "../demo/scenarios";
import { islandConfig } from "../island.config";

/** Chemins de toutes les valeurs numériques de la config (mode développeur). */
function cheminsNumeriques(obj: unknown, prefixe = ""): string[] {
  if (typeof obj === "number") return [prefixe];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    k === "dip" || k === "ISLAND_SCALE" ? [] : cheminsNumeriques(v, prefixe ? `${prefixe}.${k}` : k),
  );
}

async function envoyer(nom: "config-direct" | "declencher", donnees: unknown) {
  if (dansTauri()) await emitTo("ile", nom, donnees);
}

const TAILLES: [string, number][] = [
  ["Petite", 0.85],
  ["Normale", 1.0],
  ["Grande", 1.25],
  ["Très grande", 1.5],
];

const ALERTES: [string, string][] = [
  ["chargeur", "Chargeur branché / débranché"],
  ["batterie", "Batterie faible (20 % et 10 %)"],
  ["volume", "Volume"],
  ["luminosite", "Luminosité"],
  ["pressePapiers", "Presse-papiers"],
  ["capture", "Capture d'écran"],
  ["notification", "Notifications"],
  ["neDerangePas", "Ne pas déranger"],
  ["minuteurTermine", "Fin du minuteur"],
  ["bluetooth", "Appareils Bluetooth"],
  ["usb", "Clé USB / disque externe"],
  ["verrouillage", "Verr. Maj / Verr. Num"],
];

const BOUCLES: Record<string, NomScenario[]> = {
  "Ouvrir / fermer": ["musique", "etendre", "fermer"],
  "Split (musique + minuteur)": ["musique", "minuteur", "finMinuteur"],
  "Alerte": ["musique", "charge"],
  "Repos ↔ compact": ["musique", "finMusique"],
};

const c = {
  page: {
    fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
    fontSize: 13,
    color: "#1c1c1e",
    background: "#f2f2f7",
    height: "100vh",
    overflowY: "auto",
    padding: 14,
    boxSizing: "border-box",
    userSelect: "text",
    colorScheme: "light",
  } satisfies CSSProperties,
  section: { background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12 } satisfies CSSProperties,
  titre: { fontSize: 15, fontWeight: 600, margin: "0 0 10px" } satisfies CSSProperties,
  note: { color: "#6e6e73", fontSize: 12, margin: "4px 0 0" } satisfies CSSProperties,
  bouton: {
    border: 0,
    borderRadius: 8,
    padding: "7px 11px",
    margin: "0 6px 6px 0",
    background: "#e5e5ea",
    color: "#1c1c1e",
    cursor: "pointer",
    font: "inherit",
  } satisfies CSSProperties,
  ligne: { display: "flex", alignItems: "center", gap: 10, margin: "8px 0" } satisfies CSSProperties,
};

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div style={c.section}>
      <p style={c.titre}>{titre}</p>
      {children}
    </div>
  );
}

function Curseur(props: { libelle: string; min: number; max: number; pas: number; valeur: number; texte: string; changer: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{props.libelle}</span>
        <span style={{ color: "#6e6e73" }}>{props.texte}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.pas}
        value={props.valeur}
        onChange={(e) => props.changer(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}

function Case({ coche, changer, children }: { coche: boolean; changer: (v: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ ...c.ligne, margin: "6px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={coche} onChange={(e) => changer(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Panneau() {
  const chemins = useMemo(() => cheminsNumeriques(islandConfig), []);
  const [surcharges, setSurcharges] = useState<Record<string, number>>({});
  const [filtre, setFiltre] = useState("");
  const [boucle, setBoucle] = useState<string | null>(null);
  const [ecrans, setEcrans] = useState<InfoEcran[]>([]);
  const [auto, setAuto] = useState(false);
  const [cacher, setCacher] = useState(false);
  const [clicsRegion, setClicsRegion] = useState(false);
  const [taille, setTaille] = useState(1);
  const [prefs, setPrefs] = useState<Preferences>({});
  const [message, setMessage] = useState("");
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.style.background = "#f2f2f7";
    void backend.ecrans().then((e) => e && setEcrans(e));
    void backend.demarrageAuto().then((a) => setAuto(Boolean(a)));
    void backend.parametres().then((p) => {
      if (!p) return;
      setTaille(p.taille);
      setCacher(p.cacherEnPleinEcran);
      setClicsRegion(p.clicsRegion);
      setPrefs((p.affichage ?? {}) as Preferences);
    });
  }, []);

  useEffect(() => {
    void envoyer("config-direct", surcharges);
  }, [surcharges]);

  // Boucle de test : un pas toutes les 1,6 s.
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

  const changerPrefs = (p: Partial<Preferences>) => {
    const nouvelles = { ...prefs, ...p };
    setPrefs(nouvelles);
    void backend.definirAffichage(p as Record<string, unknown>);
  };
  const changerTaille = (t: number) => {
    setTaille(t);
    void backend.definirTaille(t);
  };
  const arreterTest = () => {
    setBoucle(null);
    setSurcharges({});
    void backend.reinitialiser();
    setMessage("Test arrêté : l'île affiche de nouveau ce qui se passe vraiment sur ton PC.");
  };
  const masquees = prefs.alertesMasquees ?? [];

  return (
    <div style={c.page}>
      <div style={{ ...c.section, display: "flex", gap: 8 }}>
        <button style={{ ...c.bouton, flex: 1, margin: 0, padding: "10px 12px", background: "#ff3b30", color: "#fff", fontWeight: 600 }} onClick={arreterTest}>
          Arrêter le test (tout remettre comme avant)
        </button>
        <button style={{ ...c.bouton, margin: 0 }} onClick={() => void backend.quitter()}>
          Quitter l'île
        </button>
      </div>
      {message && <p style={{ ...c.note, margin: "0 0 12px" }}>{message}</p>}

      <Section titre="Personnaliser">
        <div style={{ marginBottom: 6 }}>
          {TAILLES.map(([nom, t]) => {
            const actif = Math.abs(taille - t) < 0.001;
            return (
              <button key={nom} style={{ ...c.bouton, background: actif ? "#0a84ff" : "#e5e5ea", color: actif ? "#fff" : "#1c1c1e" }} onClick={() => changerTaille(t)}>
                {nom}
              </button>
            );
          })}
        </div>
        <Curseur libelle="Taille de l'île" min={0.6} max={2} pas={0.05} valeur={taille} texte={`${Math.round(taille * 100)} %`} changer={changerTaille} />
        <Curseur
          libelle="Vitesse des animations"
          min={0.5}
          max={2}
          pas={0.05}
          valeur={prefs.vitesse ?? 1}
          texte={(prefs.vitesse ?? 1) === 1 ? "comme l'iPhone" : `× ${(prefs.vitesse ?? 1).toFixed(2)}`}
          changer={(v) => changerPrefs({ vitesse: v })}
        />
        <Curseur
          libelle="Durée des alertes"
          min={0.5}
          max={3}
          pas={0.1}
          valeur={prefs.dureeAlertes ?? 1}
          texte={`${(3 * (prefs.dureeAlertes ?? 1)).toFixed(1)} s`}
          changer={(v) => changerPrefs({ dureeAlertes: v })}
        />
        <Case coche={prefs.onde ?? true} changer={(v) => changerPrefs({ onde: v })}>
          Onde sonore pendant la musique (suit le vrai son)
        </Case>
        <Case coche={prefs.horlogeSurvol ?? true} changer={(v) => changerPrefs({ horlogeSurvol: v })}>
          Horloge quand la souris passe sur l'île au repos
        </Case>
        <label style={c.ligne}>
          <span>Forme</span>
          <select
            value={prefs.forme ?? "ile"}
            onChange={(e) => changerPrefs({ forme: e.target.value as "ile" | "encoche" })}
            style={{ flex: 1, font: "inherit" }}
          >
            <option value="ile">Île (iPhone)</option>
            <option value="encoche">Encoche collée en haut (Mac)</option>
          </select>
        </label>
        <p style={c.note}>Mémorisé au redémarrage. Les proportions et les courbes restent celles de l'iPhone.</p>
      </Section>

      <Section titre="Alertes à afficher">
        {ALERTES.map(([type, nom]) => (
          <Case
            key={type}
            coche={!masquees.includes(type)}
            changer={(v) => changerPrefs({ alertesMasquees: v ? masquees.filter((x) => x !== type) : [...masquees, type] })}
          >
            {nom}
          </Case>
        ))}
      </Section>

      <Section titre="Options">
        <label style={c.ligne}>
          <span>Écran</span>
          <select onChange={(e) => void backend.choisirEcran(e.target.value || null)} defaultValue="" style={{ flex: 1, font: "inherit" }}>
            <option value="">Écran principal</option>
            {ecrans.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} — {e.rect.largeur}×{e.rect.hauteur}, {Math.round(e.facteurEchelle * 100)} %, {e.frequenceHz ?? "?"} Hz
              </option>
            ))}
          </select>
        </label>
        <Case coche={auto} changer={(v) => void backend.definirDemarrageAuto(v).then((a) => setAuto(Boolean(a)))}>
          Démarrer avec Windows
        </Case>
        <Case
          coche={cacher}
          changer={(v) => {
            setCacher(v);
            void backend.cacherEnPleinEcran(v);
          }}
        >
          Cacher quand une app est en plein écran
        </Case>
        <Case coche={prefs.notificationMinuteur ?? true} changer={(v) => changerPrefs({ notificationMinuteur: v })}>
          Notification Windows à la fin du minuteur (bouton « Répéter »)
        </Case>
        <Case
          coche={clicsRegion}
          changer={(v) => {
            setClicsRegion(v);
            void backend.definirClicsRegion(v);
          }}
        >
          Clics « région » (expérimental, peut-être plus fluide ; si un rectangle clair apparaît, décoche ; au prochain démarrage)
        </Case>
      </Section>

      <Section titre="Tester (s'arrête en fermant ce panneau)">
        {(Object.keys(SCENARIOS) as NomScenario[]).map((n) => (
          <button key={n} style={c.bouton} onClick={() => void envoyer("declencher", n)}>
            {SCENARIOS[n]}
          </button>
        ))}
        <p style={{ ...c.note, margin: "6px 0" }}>En boucle :</p>
        {Object.keys(BOUCLES).map((b) => (
          <button
            key={b}
            style={{ ...c.bouton, background: boucle === b ? "#0a84ff" : "#e5e5ea", color: boucle === b ? "#fff" : "#1c1c1e" }}
            onClick={() => setBoucle(boucle === b ? null : b)}
          >
            {b}
          </button>
        ))}
      </Section>

      <details style={c.section}>
        <summary style={{ ...c.titre, margin: 0, cursor: "pointer" }}>Mode développeur (valeurs mesurées brutes)</summary>
        <p style={c.note}>Chaque valeur de island.config.ts, appliquée en direct (non mémorisée). « Exporter » copie les valeurs modifiées.</p>
        <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
          <input
            placeholder="Filtrer (ex. ressorts.ouvrir)"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            style={{ flex: 1, minWidth: 0, font: "inherit", padding: 6, borderRadius: 8, border: "1px solid #d2d2d7" }}
          />
          <button style={{ ...c.bouton, margin: 0 }} onClick={() => setSurcharges({})}>
            Réinitialiser
          </button>
          <button
            style={{ ...c.bouton, margin: 0, background: "#0a84ff", color: "#fff" }}
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
        {chemins
          .filter((ch) => ch.toLowerCase().includes(filtre.toLowerCase()))
          .map((ch) => {
            const base = lire(islandConfig, ch) as number;
            const valeur = surcharges[ch] ?? base;
            const max = base === 0 ? 1 : Math.abs(base) * 2;
            const min = base < 0 ? -max : 0;
            return (
              <div key={ch} style={{ padding: "6px 0", borderBottom: "1px solid #f2f2f7" }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: surcharges[ch] !== undefined ? "#0a84ff" : "#3a3a3c", wordBreak: "break-all" }}>
                  {ch}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={max / 400}
                    value={valeur}
                    onChange={(e) => setSurcharges({ ...surcharges, [ch]: Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    value={Number(valeur.toFixed(4))}
                    step={max / 400}
                    onChange={(e) => setSurcharges({ ...surcharges, [ch]: Number(e.target.value) })}
                    style={{ width: 84, flex: "none", font: "inherit", fontSize: 12, color: "#1c1c1e", background: "#fff", border: "1px solid #d2d2d7", borderRadius: 6, padding: "2px 4px" }}
                  />
                </div>
              </div>
            );
          })}
      </details>
    </div>
  );
}
