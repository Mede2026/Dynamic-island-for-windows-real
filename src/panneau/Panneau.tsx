/**
 * Panneau de réglages — Ctrl+Alt+D (ouvre / ferme).
 *  1. Arrêter le test / Quitter ;
 *  2. Personnaliser : taille, vitesse, onde sonore, durée et choix des alertes (mémorisé) ;
 *  3. Options : écran, démarrage avec Windows, plein écran, compatibilité des clics ;
 *  4. Tester les animations (les tests s'arrêtent à la fermeture du panneau) ;
 *  5. Mode développeur (replié) : chaque valeur de island.config.ts, en direct, + Exporter.
 */
import { getVersion } from "@tauri-apps/api/app";

import { emitTo } from "@tauri-apps/api/event";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
    k === "dip" || k === "ISLAND_SCALE"
      ? []
      : cheminsNumeriques(v, prefixe ? `${prefixe}.${k}` : k),
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
  ["telechargementTermine", "Téléchargement terminé"],
  ["internet", "Connexion Internet perdue / retrouvée"],
  ["chanson", "Chanson reconnue (Ctrl+Alt+S)"],
  ["impression", "Impression terminée"],
  ["miseAJour", "Mise à jour : redémarrage requis"],
  ["deverrouillage", "Cadenas au déverrouillage"],
  ["sortieAudio", "Sortie audio changée (écouteurs…)"],
  ["micro", "Micro coupé / activé"],
  ["economie", "Économiseur de batterie"],
  ["ecranExterne", "Écran externe branché / débranché"],
  ["bureau", "Bureau virtuel"],
  ["wifiFaible", "Wi-Fi faible"],
  ["vpn", "VPN connecté / déconnecté"],
  ["compteARebours", "Comptes à rebours"],
];

type Onglet =
  | "apparence"
  | "alertes"
  | "musique"
  | "windows"
  | "raccourcis"
  | "claude"
  | "tester";
const ONGLETS: [Onglet, string][] = [
  ["apparence", "Apparence"],
  ["alertes", "Alertes"],
  ["musique", "Musique"],
  ["windows", "Windows"],
  ["raccourcis", "Raccourcis"],
  ["claude", "Claude"],
  ["tester", "Tester"],
];

const RACCOURCIS: [string, string][] = [
  ["Ctrl+Alt+D", "Ce panneau de réglages"],
  ["Ctrl+Alt+M", "Lancer un minuteur"],
  ["Ctrl+Alt+S", "Quelle est cette chanson ?"],
  ["Ctrl+Alt+E", "Étagère (fichiers sous la main)"],
  ["Ctrl+Alt+V", "Textes copiés récemment"],
  ["Ctrl+Alt+N", "Note rapide"],
  ["Ctrl+Alt+Espace", "Recherche rapide / calculatrice"],
  ["Ctrl+Alt+H", "Cacher / afficher l'île"],
];

const BOUCLES: Record<string, NomScenario[]> = {
  "Ouvrir / fermer": ["musique", "etendre", "fermer"],
  "Split (musique + minuteur)": ["musique", "minuteur", "finMinuteur"],
  Alerte: ["musique", "charge"],
  "Repos ↔ compact": ["musique", "finMusique"],
};

const c = {
  page: {
    fontFamily: "'Inter Variable', Inter, 'Segoe UI', sans-serif",
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
  section: {
    background: "#fff",
    borderRadius: 12,
    padding: "12px 14px",
    marginBottom: 12,
  } satisfies CSSProperties,
  titre: {
    fontSize: 15,
    fontWeight: 600,
    margin: "0 0 10px",
  } satisfies CSSProperties,
  note: {
    color: "#6e6e73",
    fontSize: 12,
    margin: "4px 0 0",
  } satisfies CSSProperties,
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
  ligne: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "8px 0",
  } satisfies CSSProperties,
  onglets: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    background: "#e5e5ea",
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    position: "sticky",
    top: 0,
    zIndex: 1,
  } satisfies CSSProperties,
  onglet: {
    flex: 1,
    border: 0,
    borderRadius: 8,
    padding: "6px 8px",
    background: "transparent",
    font: "inherit",
    cursor: "pointer",
    color: "#1c1c1e",
  } satisfies CSSProperties,
  ongletActif: {
    background: "#fff",
    fontWeight: 600,
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  } satisfies CSSProperties,
  touche: {
    minWidth: 120,
    fontFamily: "inherit",
    fontSize: 12,
    background: "#f2f2f7",
    border: "1px solid #d2d2d7",
    borderRadius: 6,
    padding: "2px 6px",
    textAlign: "center",
  } satisfies CSSProperties,
};

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div style={c.section}>
      <p style={c.titre}>{titre}</p>
      {children}
    </div>
  );
}

function Curseur(props: {
  libelle: string;
  min: number;
  max: number;
  pas: number;
  valeur: number;
  texte: string;
  changer: (v: number) => void;
}) {
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

function Case({
  coche,
  changer,
  children,
}: {
  coche: boolean;
  changer: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label style={{ ...c.ligne, margin: "6px 0", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => changer(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Panneau() {
  const chemins = useMemo(() => cheminsNumeriques(islandConfig), []);
  const [surcharges, setSurcharges] = useState<Record<string, number>>({});
  const [filtre, setFiltre] = useState("");
  const [nouvelleApp, setNouvelleApp] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("apparence");
  const [nouveauCompte, setNouveauCompte] = useState({ nom: "", date: "" });
  const [version, setVersion] = useState("");
  const [maj, setMaj] = useState("");
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  const [boucle, setBoucle] = useState<string | null>(null);
  const [ecrans, setEcrans] = useState<InfoEcran[]>([]);
  const [auto, setAuto] = useState(false);
  const [cacher, setCacher] = useState(false);
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
    setMessage(
      "Test arrêté : l'île affiche de nouveau ce qui se passe vraiment sur ton PC.",
    );
  };
  const masquees = prefs.alertesMasquees ?? [];

  return (
    <div style={c.page}>
      <div style={{ ...c.section, display: "flex", gap: 8 }}>
        <button
          style={{
            ...c.bouton,
            flex: 1,
            margin: 0,
            padding: "10px 12px",
            background: "#ff3b30",
            color: "#fff",
            fontWeight: 600,
          }}
          onClick={arreterTest}
        >
          Arrêter le test (tout remettre comme avant)
        </button>
        <button
          style={{ ...c.bouton, margin: 0 }}
          onClick={() => void backend.quitter()}
        >
          Quitter l'île
        </button>
      </div>
      {message && <p style={{ ...c.note, margin: "0 0 12px" }}>{message}</p>}

      <nav style={c.onglets}>
        {ONGLETS.map(([id, nom]) => (
          <button
            key={id}
            onClick={() => setOnglet(id)}
            style={{ ...c.onglet, ...(onglet === id ? c.ongletActif : {}) }}
          >
            {nom}
          </button>
        ))}
      </nav>

      {onglet === "apparence" && (
        <Section titre="Apparence">
          <div style={{ marginBottom: 6 }}>
            {TAILLES.map(([nom, t]) => {
              const actif = Math.abs(taille - t) < 0.001;
              return (
                <button
                  key={nom}
                  style={{
                    ...c.bouton,
                    background: actif ? "#0a84ff" : "#e5e5ea",
                    color: actif ? "#fff" : "#1c1c1e",
                  }}
                  onClick={() => changerTaille(t)}
                >
                  {nom}
                </button>
              );
            })}
          </div>
          <Curseur
            libelle="Taille de l'île"
            min={0.6}
            max={2}
            pas={0.05}
            valeur={taille}
            texte={`${Math.round(taille * 100)} %`}
            changer={changerTaille}
          />
          <Curseur
            libelle="Vitesse des animations"
            min={0.5}
            max={2}
            pas={0.05}
            valeur={prefs.vitesse ?? 1}
            texte={
              (prefs.vitesse ?? 1) === 1
                ? "comme l'iPhone"
                : `× ${(prefs.vitesse ?? 1).toFixed(2)}`
            }
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
          <Case
            coche={prefs.horlogeSurvol ?? true}
            changer={(v) => changerPrefs({ horlogeSurvol: v })}
          >
            Horloge quand la souris passe sur l'île au repos
          </Case>
          <label style={c.ligne}>
            <span>Forme</span>
            <select
              value={prefs.forme ?? "ile"}
              onChange={(e) =>
                changerPrefs({ forme: e.target.value as "ile" | "encoche" })
              }
              style={{ flex: 1, font: "inherit" }}
            >
              <option value="ile">Île (iPhone)</option>
              <option value="encoche">Encoche collée en haut (Mac)</option>
            </select>
          </label>
          <label style={c.ligne}>
            <span>Afficher l'île</span>
            <select
              value={prefs.visibilite ?? "toujours"}
              onChange={(e) =>
                changerPrefs({ visibilite: e.target.value as "toujours" | "activites" | "alertes" })
              }
              style={{ flex: 1, font: "inherit" }}
            >
              <option value="toujours">Toujours</option>
              <option value="activites">Seulement quand il se passe quelque chose</option>
              <option value="alertes">Seulement pour les alertes</option>
            </select>
          </label>
          <p style={c.note}>
            Mémorisé au redémarrage. Les proportions et les courbes restent
            celles de l'iPhone.
          </p>
        </Section>
      )}

      {onglet === "claude" && <OngletClaude />}

      {onglet === "musique" && (
        <Section titre="Musique">
          <Case
            coche={prefs.onde ?? true}
            changer={(v) => changerPrefs({ onde: v })}
          >
            Onde sonore pendant la musique (suit le vrai son)
          </Case>
          <Case
            coche={prefs.paroles ?? true}
            changer={(v) => changerPrefs({ paroles: v })}
          >
            Paroles en direct sous la caméra pendant la musique (LRCLIB)
          </Case>
          <Curseur
            libelle="Paroles en retard ou en avance ?"
            min={-3000}
            max={3000}
            pas={100}
            valeur={prefs.decalageParolesMs ?? 0}
            texte={(prefs.decalageParolesMs ?? 0) === 0 ? "Synchronisées" : `${(prefs.decalageParolesMs ?? 0) > 0 ? "+" : ""}${((prefs.decalageParolesMs ?? 0) / 1000).toFixed(1)} s plus tôt`}
            changer={(v) => changerPrefs({ decalageParolesMs: v })}
          />
          <p style={c.note}>
            Les paroles viennent de LRCLIB (gratuit) ; seuls le titre,
            l'artiste, l'album et la durée sont envoyés. « Quelle est cette
            chanson ? » : Ctrl+Alt+S ou le menu de l'île (clic droit).
          </p>
        </Section>
      )}

      {onglet === "alertes" && (
        <>
          <Section titre="Comptes à rebours">
            <p style={c.note}>
              L'île te le rappelle chaque jour (au démarrage et au premier
              déverrouillage), jusqu'à 30 jours avant.
            </p>
            <form
              style={c.ligne}
              onSubmit={(e) => {
                e.preventDefault();
                if (!nouveauCompte.nom.trim() || !nouveauCompte.date) return;
                changerPrefs({
                  comptesARebours: [
                    ...(prefs.comptesARebours ?? []),
                    { nom: nouveauCompte.nom.trim(), date: nouveauCompte.date },
                  ],
                });
                setNouveauCompte({ nom: "", date: "" });
              }}
            >
              <input
                value={nouveauCompte.nom}
                onChange={(e) =>
                  setNouveauCompte({ ...nouveauCompte, nom: e.target.value })
                }
                placeholder="Examen de sciences"
                style={{ flex: 1, font: "inherit" }}
              />
              <input
                type="date"
                value={nouveauCompte.date}
                onChange={(e) =>
                  setNouveauCompte({ ...nouveauCompte, date: e.target.value })
                }
                style={{ font: "inherit" }}
              />
              <button type="submit">Ajouter</button>
            </form>
            {(prefs.comptesARebours ?? []).map((cr, i) => (
              <div key={`${cr.nom}${cr.date}${i}`} style={c.ligne}>
                <span style={{ flex: 1 }}>
                  {cr.nom} —{" "}
                  {new Date(`${cr.date}T00:00:00`).toLocaleDateString("fr-CA", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <button
                  onClick={() =>
                    changerPrefs({
                      comptesARebours: (prefs.comptesARebours ?? []).filter(
                        (_, j) => j !== i,
                      ),
                    })
                  }
                >
                  Retirer
                </button>
              </div>
            ))}
          </Section>
          <Section titre="Apps ignorées (musique et notifications)">
            <p style={c.note}>
              L'île ne réagit pas à ces apps : ni musique, ni notifications. Un
              morceau du nom suffit (« tiktok », « chrome »).
            </p>
            <form
              style={c.ligne}
              onSubmit={(e) => {
                e.preventDefault();
                const nom = nouvelleApp.trim();
                if (!nom) return;
                changerPrefs({
                  appsIgnorees: [
                    ...new Set([...(prefs.appsIgnorees ?? []), nom]),
                  ],
                });
                setNouvelleApp("");
              }}
            >
              <input
                value={nouvelleApp}
                onChange={(e) => setNouvelleApp(e.target.value)}
                placeholder="Nom de l'app"
                style={{ flex: 1, font: "inherit" }}
              />
              <button type="submit">Ajouter</button>
            </form>
            {(prefs.appsIgnorees ?? []).map((app) => (
              <div key={app} style={c.ligne}>
                <span style={{ flex: 1 }}>{app}</span>
                <button
                  onClick={() =>
                    changerPrefs({
                      appsIgnorees: (prefs.appsIgnorees ?? []).filter(
                        (a) => a !== app,
                      ),
                    })
                  }
                >
                  Retirer
                </button>
              </div>
            ))}
          </Section>

          <Section titre="Alertes à afficher">
            {ALERTES.map(([type, nom]) => (
              <Case
                key={type}
                coche={!masquees.includes(type)}
                changer={(v) =>
                  changerPrefs({
                    alertesMasquees: v
                      ? masquees.filter((x) => x !== type)
                      : [...masquees, type],
                  })
                }
              >
                {nom}
              </Case>
            ))}
          </Section>
        </>
      )}

      {onglet === "windows" && (
        <Section titre="Windows">
          <label style={c.ligne}>
            <span>Écran</span>
            <select
              onChange={(e) =>
                void backend.choisirEcran(e.target.value || null)
              }
              defaultValue=""
              style={{ flex: 1, font: "inherit" }}
            >
              <option value="">Écran principal</option>
              {ecrans.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id} — {e.rect.largeur}×{e.rect.hauteur},{" "}
                  {Math.round(e.facteurEchelle * 100)} %, {e.frequenceHz ?? "?"}{" "}
                  Hz
                </option>
              ))}
            </select>
          </label>
          <Case
            coche={auto}
            changer={(v) =>
              void backend
                .definirDemarrageAuto(v)
                .then((a) => setAuto(Boolean(a)))
            }
          >
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
          <Case
            coche={prefs.remplacerOsd ?? true}
            changer={(v) => changerPrefs({ remplacerOsd: v })}
          >
            Remplacer l'indicateur de volume et de luminosité de Windows par
            l'île
          </Case>
          <Case
            coche={prefs.cacherPartage ?? false}
            changer={(v) => {
              changerPrefs({ cacherPartage: v });
              void backend.cacherAuPartage(v);
            }}
          >
            Cacher l'île dans les partages d'écran (Teams, Discord, OBS) — aussi
            dans les captures
          </Case>
          <Case
            coche={prefs.pauses ?? false}
            changer={(v) => changerPrefs({ pauses: v })}
          >
            Rappels de pause : yeux toutes les 20 min, bouger toutes les heures
          </Case>
          <Case
            coche={prefs.notificationMinuteur ?? true}
            changer={(v) => changerPrefs({ notificationMinuteur: v })}
          >
            Notification Windows à la fin du minuteur (bouton « Répéter »)
          </Case>
        </Section>
      )}

      {onglet === "raccourcis" && (
        <>
          <Section titre="Raccourcis">
            {RACCOURCIS.map(([touches, quoi]) => (
              <div key={touches} style={c.ligne}>
                <kbd style={c.touche}>{touches}</kbd>
                <span>{quoi}</span>
              </div>
            ))}
            <p style={c.note}>
              Clic droit sur l'île : tous les outils. Clic : ouvre l'app qui
              joue. Appui long : vue étendue.
            </p>
          </Section>
          <Section titre="Mises à jour">
            <div style={c.ligne}>
              <span style={{ flex: 1 }}>
                Version installée : {version || "…"}
              </span>
              <button
                style={{ ...c.bouton, margin: 0 }}
                onClick={() => {
                  setMaj("Vérification…");
                  void backend
                    .verifierMaj()
                    .then((n) => {
                      if (!n) return setMaj("L'île est à jour.");
                      setMaj(`Nouvelle version ${n.version} : téléchargement…`);
                      return backend.installerMaj(n.url);
                    })
                    .catch(() => setMaj("Impossible de joindre GitHub."));
                }}
              >
                Vérifier et installer
              </button>
            </div>
            {maj && <p style={c.note}>{maj}</p>}
            <p style={c.note}>
              L'île vérifie aussi toute seule (au démarrage puis toutes les 6 h)
              et propose « Installer » dans l'île.
            </p>
          </Section>
        </>
      )}

      {onglet === "tester" && (
        <>
          <Section titre="Tester (s'arrête en fermant ce panneau)">
            {(Object.keys(SCENARIOS) as NomScenario[]).map((n) => (
              <button
                key={n}
                style={c.bouton}
                onClick={() => void envoyer("declencher", n)}
              >
                {SCENARIOS[n]}
              </button>
            ))}
            <p style={{ ...c.note, margin: "6px 0" }}>En boucle :</p>
            {Object.keys(BOUCLES).map((b) => (
              <button
                key={b}
                style={{
                  ...c.bouton,
                  background: boucle === b ? "#0a84ff" : "#e5e5ea",
                  color: boucle === b ? "#fff" : "#1c1c1e",
                }}
                onClick={() => setBoucle(boucle === b ? null : b)}
              >
                {b}
              </button>
            ))}
          </Section>

          <details style={c.section}>
            <summary style={{ ...c.titre, margin: 0, cursor: "pointer" }}>
              Mode développeur (valeurs mesurées brutes)
            </summary>
            <p style={c.note}>
              Chaque valeur de island.config.ts, appliquée en direct (non
              mémorisée). « Exporter » copie les valeurs modifiées.
            </p>
            <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
              <input
                placeholder="Filtrer (ex. ressorts.ouvrir)"
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: "inherit",
                  padding: 6,
                  borderRadius: 8,
                  border: "1px solid #d2d2d7",
                }}
              />
              <button
                style={{ ...c.bouton, margin: 0 }}
                onClick={() => setSurcharges({})}
              >
                Réinitialiser
              </button>
              <button
                style={{
                  ...c.bouton,
                  margin: 0,
                  background: "#0a84ff",
                  color: "#fff",
                }}
                onClick={() => {
                  const json = JSON.stringify(surcharges, null, 2);
                  void navigator.clipboard.writeText(json).then(
                    () =>
                      setMessage(
                        `Copié : ${Object.keys(surcharges).length} valeur(s) modifiée(s)`,
                      ),
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
                  <div
                    key={ch}
                    style={{
                      padding: "6px 0",
                      borderBottom: "1px solid #f2f2f7",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color:
                          surcharges[ch] !== undefined ? "#0a84ff" : "#3a3a3c",
                        wordBreak: "break-all",
                      }}
                    >
                      {ch}
                    </div>
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={max / 400}
                        value={valeur}
                        onChange={(e) =>
                          setSurcharges({
                            ...surcharges,
                            [ch]: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        value={Number(valeur.toFixed(4))}
                        step={max / 400}
                        onChange={(e) =>
                          setSurcharges({
                            ...surcharges,
                            [ch]: Number(e.target.value),
                          })
                        }
                        style={{
                          width: 84,
                          flex: "none",
                          font: "inherit",
                          fontSize: 12,
                          color: "#1c1c1e",
                          background: "#fff",
                          border: "1px solid #d2d2d7",
                          borderRadius: 6,
                          padding: "2px 4px",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </details>
        </>
      )}
    </div>
  );
}

/** Onglet « Claude » : clé API (gardée dans le coffre de Windows), test, effacement. */
function OngletClaude() {
  const [presente, setPresente] = useState<boolean | null>(null);
  const [cle, setCle] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    void backend.claudeClePresente().then((p) => setPresente(Boolean(p)));
  }, []);
  const enregistrer = () =>
    void backend
      .claudeCleDefinir(cle)
      .then(() => {
        setCle("");
        setPresente(true);
        setMessage("Clé enregistrée. Teste-la ci-dessous.");
      })
      .catch((e) => setMessage(String(e)));
  return (
    <Section titre="Claude dans la recherche">
      <p style={c.note}>
        Quand ce que tu écris dans la recherche de l'île (Ctrl+Alt+Espace) ressemble à une
        question, l'île propose « Demander à Claude ». Rien n'est envoyé avant que tu appuies sur
        Entrée. Modèle : Claude Sonnet 5.5, effort moyen. Les questions sont facturées sur ton
        compte Anthropic.
      </p>
      <p style={{ ...c.note, fontWeight: 600, color: presente ? "#248a3d" : "#6e6e73" }}>
        {presente === null ? "…" : presente ? "✓ Une clé est enregistrée (dans le coffre de Windows)." : "Aucune clé enregistrée."}
      </p>
      <label style={c.ligne}>
        <span>Clé API</span>
        <input
          type="password"
          value={cle}
          onChange={(e) => setCle(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, font: "inherit", padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d1d6" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={c.bouton} disabled={!cle.trim()} onClick={enregistrer}>
          Enregistrer
        </button>
        <button
          style={c.bouton}
          disabled={!presente}
          onClick={() => {
            setMessage("Test en cours…");
            void backend
              .claudeCleTester()
              .then((r) => setMessage(`✓ La clé fonctionne (réponse : « ${r} »).`))
              .catch((e) => setMessage(String(e)));
          }}
        >
          Tester la clé
        </button>
        <button
          style={c.bouton}
          disabled={!presente}
          onClick={() =>
            void backend.claudeCleDefinir("").then(() => {
              setPresente(false);
              setMessage("Clé effacée.");
            })
          }
        >
          Effacer
        </button>
      </div>
      {message && <p style={{ ...c.note, marginTop: 8 }}>{message}</p>}
      <p style={c.note}>
        Pour créer une clé : console.anthropic.com → API Keys. La clé reste sur ce PC, dans le
        Gestionnaire d'informations d'identification de Windows ; seul le moteur de l'app
        l'utilise, pour parler à api.anthropic.com.
      </p>
    </Section>
  );
}
