/**
 * Recherche DANS l'île, sur le modèle de la recherche du Mac (vidéos fournies) :
 *  - l'île devient une barre en pilule (le champ) ;
 *  - une carte séparée dessous liste les résultats : apps, réglages de Windows, fichiers,
 *    calcul / conversion, textes copiés, Wikipédia, web ;
 *  - une question → « Demander à Claude » (clé API dans les réglages), la carte devient une
 *    conversation.
 * L'état est partagé entre la pilule (dans l'île) et la carte (sous l'île).
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { backend, dansTauri } from "../bridge/backend";
import { IconeDossier, IconeLoupe, IconePressePapiers, IconeReglages } from "../rendu/icones";
import { calculer, estCalcul, formaterNombre } from "./calcul";
import { analyserConversion } from "./conversion";
import { correspondance, estQuestion, reglagesPour } from "./partout";

// ---------------------------------------------------------------------------
// État partagé
// ---------------------------------------------------------------------------

type Icone = { genre: "image"; cle: string } | { genre: "glyphe"; dessin: (t: number) => ReactNode; fond: string };

export interface Ligne {
  cle: string;
  titre: string;
  sous?: string;
  icone: Icone;
  /** Texte gris à droite de la ligne choisie (« Ouvrir », « Copier »…). */
  indice: string;
  agir: () => void;
}

interface Wiki {
  titre: string;
  description: string | null;
  resume: string;
  lien: string;
  image: string | null;
  langue: string;
}

type Message = { role: "user" | "assistant"; content: string };

interface Etat {
  terme: string;
  lignes: Ligne[];
  choix: number;
  vue: "liste" | "wiki" | "chat";
  wiki: Wiki | null;
  wikiEtat: "" | "recherche" | "rien" | "erreur";
  chat: Message[];
  chatEtat: "pret" | "attente";
  chatErreur: string;
  cle: boolean | null;
}

const VIDE: Etat = { terme: "", lignes: [], choix: 0, vue: "liste", wiki: null, wikiEtat: "", chat: [], chatEtat: "pret", chatErreur: "", cle: null };
let etat: Etat = VIDE;
const abonnes = new Set<() => void>();
function maj(p: Partial<Etat>) {
  etat = { ...etat, ...p };
  abonnes.forEach((f) => f());
}
function abonner(f: () => void) {
  abonnes.add(f);
  return () => abonnes.delete(f);
}
export function useRecherche(): Etat {
  return useSyncExternalStore(abonner, () => etat);
}
export function etatRecherche(): Etat {
  return etat;
}
export function reinitialiserRecherche() {
  jeton++;
  maj({ ...VIDE, cle: etat.cle });
}

/** La pilule a-t-elle une 2e ligne (« — Demander à Claude ») ? */
export function piluleDeuxLignes(e: Etat = etat): boolean {
  return e.vue === "liste" && estQuestion(e.terme);
}

/** La carte des résultats est-elle affichée ? */
export function carteRechercheVisible(e: Etat = etat): boolean {
  return e.vue !== "liste" || e.terme.trim().length > 0;
}

/** Hauteur naturelle de la carte (pt), avant que l'utilisateur la tire à la main. */
export function hauteurAutoRecherche(e: Etat = etat): number {
  if (e.vue === "chat") return 330;
  if (e.vue === "wiki") return 300;
  // Comme dans la vidéo : la liste montre environ 5 lignes et demie (plus si elle déborde, on défile).
  return Math.min(Math.max(e.lignes.length, 5.5), 6.5) * LIGNE_PT + 2 * MARGE_PT + 8;
}

export const LIGNE_PT = 44;
const MARGE_PT = 9;

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

let jeton = 0;
let fermerOutilIle: () => void = () => undefined;
export function definirFermeture(f: () => void) {
  fermerOutilIle = f;
}

const glyphe = (dessin: (t: number) => ReactNode, fond: string): Icone => ({ genre: "glyphe", dessin, fond });

const APPS_DEMO = ["Calculatrice", "Capture d'écran", "Spotify", "Paramètres", "Discord", "Microsoft Edge", "Photos"];

export function definirTerme(terme: string) {
  maj({ terme, vue: "liste", choix: 0 });
  void chercher(terme);
}

async function chercher(terme: string) {
  const mon = ++jeton;
  const t = terme.trim();
  if (!t) return maj({ lignes: [] });
  if (etat.cle === null) void backend.claudeClePresente().then((c) => maj({ cle: Boolean(c) }));

  const debut: Ligne[] = [];
  if (estQuestion(t)) {
    debut.push({
      cle: "claude",
      titre: t,
      sous: "Demander à Claude",
      icone: glyphe((n) => <IconeEtincelle taille={n} couleur="#fff" />, "linear-gradient(160deg,#e08a5f,#c2643c)"),
      indice: "Demander",
      agir: () => void demanderClaude(t),
    });
  }
  const conversion = analyserConversion(t);
  if (conversion?.genre === "unite") {
    const r = `${formaterNombre(Math.round(conversion.resultat * 1000) / 1000)} ${conversion.vers}`;
    debut.push(ligneCopie("conv", r, `${formaterNombre(conversion.valeur)} ${conversion.de} =`));
  } else if (conversion?.genre === "devise") {
    const de = conversion.de;
    const vers = conversion.vers;
    const valeur = conversion.valeur;
    void backend.tauxDeChange(de, vers).then((taux) => {
      if (mon !== jeton || !taux) return;
      const r = `${formaterNombre(Math.round(valeur * taux * 100) / 100)} ${vers}`;
      maj({ lignes: [ligneCopie("conv", r, `${formaterNombre(valeur)} ${de} = · Banque centrale européenne`), ...etat.lignes.filter((l) => l.cle !== "conv")] });
    });
  } else if (estCalcul(t)) {
    const r = calculer(t);
    if (r !== null) debut.push(ligneCopie("calc", formaterNombre(r), `${t} =`));
  }
  const reglages: Ligne[] = reglagesPour(t).map((r) => ({
    cle: `reglage:${r.uri}`,
    titre: r.nom,
    sous: "Paramètres de Windows",
    icone: glyphe((n) => <IconeReglages taille={n} couleur="#fff" />, "linear-gradient(160deg,#8e8e93,#5a5a5e)"),
    indice: "Ouvrir",
    agir: () => {
      void backend.ouvrirLien(r.uri);
      fermerOutilIle();
    },
  }));
  const fin: Ligne[] = [
    {
      cle: "wiki",
      titre: `Rechercher « ${t} »`,
      sous: "Définition, Wikipédia",
      icone: glyphe((n) => <IconeLoupe taille={n} couleur="#fff" />, "linear-gradient(160deg,#64a8ff,#2f6fdb)"),
      indice: "Lire",
      agir: () => void ouvrirWiki(t),
    },
    {
      cle: "web",
      titre: `Chercher « ${t} » sur le web`,
      sous: "Navigateur",
      icone: glyphe((n) => <IconeGlobe taille={n} couleur="#fff" />, "linear-gradient(160deg,#5ac8fa,#1f8fd6)"),
      indice: "Ouvrir",
      agir: () => {
        void backend.ouvrirLien(`https://www.google.com/search?q=${encodeURIComponent(t)}`);
        fermerOutilIle();
      },
    },
  ];
  maj({ lignes: [...debut, ...reglages, ...fin] });

  // Apps (rapide), puis fichiers (index de Windows) et textes copiés.
  const apps = dansTauri()
    ? ((await backend.partoutApps(t).catch(() => [])) ?? [])
    : APPS_DEMO.filter((n) => correspondance(n, t) > 0).map((nom) => ({ nom, id: nom }));
  if (mon !== jeton) return;
  const lignesApps: Ligne[] = apps.slice(0, 6).map((a) => ({
    cle: `app:${a.id}`,
    titre: a.nom,
    sous: "Application",
    icone: { genre: "image", cle: `app:${a.id}` },
    indice: "Ouvrir",
    agir: () => {
      void backend.partoutLancerApp(a.id);
      fermerOutilIle();
    },
  }));
  maj({ lignes: [...debut, ...lignesApps, ...reglages, ...fin] });

  const [fichiers, copies] = await Promise.all([
    dansTauri() ? backend.partoutFichiers(t).catch(() => []) : Promise.resolve([]),
    dansTauri() ? backend.historiqueLire().catch(() => []) : Promise.resolve([] as string[]),
  ]);
  if (mon !== jeton) return;
  const lignesFichiers: Ligne[] = (fichiers ?? []).slice(0, 6).map((f) => ({
    cle: `fichier:${f.chemin}`,
    titre: f.nom,
    sous: f.dossier || f.chemin,
    icone: { genre: "image", cle: `fichier:${f.chemin}` },
    indice: "Ouvrir",
    agir: () => {
      void backend.partoutOuvrirFichier(f.chemin);
      fermerOutilIle();
    },
  }));
  const lignesCopies: Ligne[] = (copies ?? [])
    .filter((c) => correspondance(c.slice(0, 200), t) > 0)
    .slice(0, 2)
    .map((c, i) => ({
      cle: `copie:${i}`,
      titre: c.replace(/\s+/g, " ").slice(0, 80),
      sous: "Copié récemment",
      icone: glyphe((n) => <IconePressePapiers taille={n} couleur="#fff" />, "linear-gradient(160deg,#bf5af2,#8e3cc4)"),
      indice: "Copier",
      agir: () => {
        void backend.copierTexte(c);
        fermerOutilIle();
      },
    }));
  maj({ lignes: [...debut, ...lignesApps, ...reglages, ...lignesFichiers, ...lignesCopies, ...fin] });
}

function ligneCopie(cle: string, resultat: string, sous: string): Ligne {
  return {
    cle,
    titre: resultat,
    sous,
    icone: glyphe((n) => <IconeCalcul taille={n} couleur="#fff" />, "linear-gradient(160deg,#ff9f0a,#e07800)"),
    indice: "Copier",
    agir: () => {
      void backend.copierTexte(resultat.split(" ")[0] ?? resultat);
      fermerOutilIle();
    },
  };
}

async function ouvrirWiki(t: string) {
  maj({ vue: "wiki", wiki: null, wikiEtat: "recherche" });
  try {
    const r = (await backend.rechercheRapide(t)) as Wiki | null;
    maj(r ? { wiki: r, wikiEtat: "" } : { wikiEtat: "rien" });
  } catch {
    maj({ wikiEtat: "erreur" });
  }
}

export async function demanderClaude(question: string) {
  const q = question.trim();
  if (!q || etat.chatEtat === "attente") return;
  const chat: Message[] = [...etat.chat, { role: "user", content: q }];
  maj({ vue: "chat", chat, chatEtat: "attente", chatErreur: "" });
  if (!dansTauri()) {
    await new Promise((r) => setTimeout(r, 900));
    return maj({ chat: [...chat, { role: "assistant", content: "(Démo) Ici s'affiche la réponse de Claude, courte et directe." }], chatEtat: "pret" });
  }
  const cle = etat.cle ?? (await backend.claudeClePresente().catch(() => false));
  if (!cle) {
    return maj({ cle: false, chatEtat: "pret", chatErreur: "Ajoute ta clé API Anthropic dans Réglages → Claude." });
  }
  try {
    const reponse = await backend.claudeDemander(chat);
    if (etat.vue !== "chat") return; // conversation fermée entre-temps
    maj({ chat: [...chat, { role: "assistant", content: reponse }], chatEtat: "pret", cle: true });
  } catch (e) {
    maj({ chatEtat: "pret", chatErreur: String(e) });
  }
}

// ---------------------------------------------------------------------------
// Pilule (le champ, dans l'île)
// ---------------------------------------------------------------------------

/** Clavier commun à la pilule : ↑ ↓ choisir, Entrée agir, Échap revenir / fermer. */
function touche(e: React.KeyboardEvent) {
  const s = etat;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    maj({ choix: Math.min(s.choix + 1, s.lignes.length - 1) });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    maj({ choix: Math.max(s.choix - 1, 0) });
  } else if (e.key === "Enter") {
    e.preventDefault();
    s.lignes[s.choix]?.agir();
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (s.vue !== "liste") maj({ vue: "liste" });
    else fermerOutilIle();
  }
}

export function PiluleRecherche({ hauteur }: { hauteur: number }) {
  const s = useRecherche();
  const champ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => champ.current?.focus(), 30);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => () => reinitialiserRecherche(), []);
  const deux = piluleDeuxLignes(s);
  const chat = s.vue === "chat";
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 20px 0 22px", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", height: hauteur }}>
        <input
          ref={champ}
          className="champ-ile"
          value={chat ? "" : s.terme}
          placeholder={chat ? "Claude" : "Rechercher ou demander des infos"}
          onChange={(e) => definirTerme(e.target.value)}
          onKeyDown={touche}
          onPointerDown={(e) => e.stopPropagation()}
          readOnly={chat}
          spellCheck={false}
          style={{ background: "none", border: 0, outline: "none", color: "#fff", fontSize: 15, fontWeight: 400, letterSpacing: -0.1, padding: 0, width: "100%" }}
        />
        {deux && <div style={{ color: "rgba(255,255,255,.62)", fontSize: 15, marginTop: 3, whiteSpace: "nowrap" }}>— Demander à Claude</div>}
      </div>
      <IconeEtincelle taille={18} couleur={deux || chat ? "#fff" : "rgba(255,255,255,.55)"} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte (sous l'île)
// ---------------------------------------------------------------------------

const GRIS = "rgba(255,255,255,.58)";

export function CarteRecherche() {
  const s = useRecherche();
  if (s.vue === "chat") return <VueChat />;
  if (s.vue === "wiki") return <VueWiki />;
  return (
    <div className="defile-ile" style={{ position: "absolute", inset: 0, overflowY: "auto", padding: `${MARGE_PT}px 9px ${MARGE_PT + 8}px` }}>
      {s.lignes.map((l, i) => (
        <div
          key={l.cle}
          onPointerEnter={() => maj({ choix: i })}
          onClick={() => l.agir()}
          style={{
            height: LIGNE_PT,
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "0 10px",
            borderRadius: 11,
            background: i === s.choix ? "rgba(255,255,255,.13)" : "transparent",
            boxShadow: i === s.choix ? "inset 0 0.5px 0 rgba(255,255,255,.12)" : "none",
            cursor: "default",
          }}
        >
          <IconeLigne icone={l.icone} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.titre}</div>
            {l.sous && <div style={{ fontSize: 11, color: GRIS, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{l.sous}</div>}
          </div>
          {i === s.choix && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: GRIS }}>{l.indice}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,.75)", background: "rgba(255,255,255,.16)", borderRadius: 4, padding: "1px 5px" }}>↵</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function IconeLigne({ icone }: { icone: Icone }) {
  const T = 26;
  const [png, setPng] = useState<string | null>(null);
  const cle = icone.genre === "image" ? icone.cle : "";
  useEffect(() => {
    if (!cle || !dansTauri()) return;
    let vivant = true;
    void backend
      .partoutIcone(cle)
      .then((p) => vivant && setPng(p ?? null))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [cle]);
  if (icone.genre === "glyphe") {
    return (
      <div style={{ width: T, height: T, borderRadius: 7, background: icone.fond, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.35)" }}>
        {icone.dessin(T * 0.58)}
      </div>
    );
  }
  if (png) return <img src={`data:image/png;base64,${png}`} alt="" style={{ width: T, height: T, flexShrink: 0, objectFit: "contain" }} />;
  return (
    <div style={{ width: T, height: T, borderRadius: 7, background: "rgba(255,255,255,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {cle.startsWith("fichier:") ? <IconeDossier taille={15} couleur="#fff" /> : <IconeApp taille={15} />}
    </div>
  );
}

function VueWiki() {
  const s = useRecherche();
  const w = s.wiki;
  return (
    <div className="defile-ile" style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "16px 18px", fontSize: 13, lineHeight: 1.45, color: "#fff" }}>
      {s.wikiEtat === "recherche" && <p style={{ color: GRIS, margin: 0 }}>Recherche…</p>}
      {s.wikiEtat === "rien" && <p style={{ color: GRIS, margin: 0 }}>Rien trouvé sur Wikipédia.</p>}
      {s.wikiEtat === "erreur" && <p style={{ color: GRIS, margin: 0 }}>Pas de connexion à Wikipédia.</p>}
      {w && (
        <>
          {w.image && <img src={w.image} alt="" style={{ float: "right", width: 76, height: 76, objectFit: "cover", borderRadius: 12, marginLeft: 12 }} />}
          <div style={{ fontSize: 17, fontWeight: 650, marginBottom: 2 }}>{w.titre}</div>
          {w.description && <div style={{ color: GRIS, marginBottom: 8 }}>{w.description}</div>}
          <p style={{ margin: "0 0 10px", whiteSpace: "pre-line" }}>{w.resume}</p>
          {w.lien && (
            <span onClick={() => void backend.ouvrirLien(w.lien)} style={{ color: "#64a8ff", cursor: "pointer" }}>
              {w.lien.includes("wiktionary") ? "Lire sur le Wiktionnaire" : `Lire sur Wikipédia${w.langue === "en" ? " (anglais)" : ""}`} →
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Conversation avec Claude (comme la carte « Demander à… » du Mac). */
function VueChat() {
  const s = useRecherche();
  const [suite, setSuite] = useState("");
  const fil = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fil.current?.scrollTo({ top: fil.current.scrollHeight, behavior: "smooth" });
  }, [s.chat.length, s.chatEtat]);
  useEffect(() => {
    champ.current?.focus();
  }, []);
  const rond = (contenu: ReactNode, agir: () => void, titre: string) => (
    <div
      title={titre}
      onClick={agir}
      style={{ width: 26, height: 26, borderRadius: 13, background: "rgba(255,255,255,.13)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, cursor: "default", flexShrink: 0 }}
    >
      {contenu}
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 12px 0" }}>
        {rond("✕", () => maj({ vue: "liste", chat: [], chatErreur: "" }), "Fermer la conversation")}
        {rond("↗", () => window.dispatchEvent(new CustomEvent("ile-carte-agrandir")), "Agrandir")}
      </div>
      <div ref={fil} className="defile-ile" style={{ flex: 1, overflowY: "auto", padding: "6px 18px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        {s.chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "78%", background: "rgba(255,255,255,.16)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.18)", borderRadius: 14, padding: "6px 11px", fontSize: 12, color: "#fff" }}>
              {m.content}
            </div>
          ) : (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.47, color: "#fff", whiteSpace: "pre-wrap", userSelect: "text" }}>
              {m.content.replace(/\*\*(.+?)\*\*/g, "$1")}
            </div>
          ),
        )}
        {s.chatEtat === "attente" && <Points />}
        {s.chatErreur && <div style={{ fontSize: 12, color: "#ff9f8a" }}>{s.chatErreur}</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void demanderClaude(suite);
          setSuite("");
        }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 13px" }}
      >
        <input
          ref={champ}
          className="champ-ile"
          value={suite}
          onChange={(e) => setSuite(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              maj({ vue: "liste" });
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Demander à Claude"
          style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,.12)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.14)", border: 0, outline: "none", borderRadius: 15, padding: "7px 12px", color: "#fff", fontSize: 12 }}
        />
        {rond(<IconeEtincelle taille={13} couleur="#fff" />, () => {
          void demanderClaude(suite);
          setSuite("");
        }, "Envoyer")}
      </form>
    </div>
  );
}

function Points() {
  return (
    <div style={{ display: "flex", gap: 5, padding: "4px 0" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: "rgba(255,255,255,.7)", animation: `ile-point 1s ${i * 0.15}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Petites icônes (dessinées pour le projet)
// ---------------------------------------------------------------------------

/** Étincelle à quatre branches (« demander à l'IA »). */
export function IconeEtincelle({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5c.5 4.6 2.4 7 7.5 8.1v1.0c-5.1 1.1-7 3.5-7.5 8.1h-1c-.5-4.6-2.4-7-7.5-8.1v-1C8.6 9.5 10.5 7.1 11 2.5z" fill={couleur} />
    </svg>
  );
}

function IconeGlobe({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="1.9" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" />
    </svg>
  );
}

function IconeCalcul({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <path d="M6 8h5M8.5 5.5v5M13.5 8h5M6 16.5h5M13.5 15h5M13.5 18h5" />
    </svg>
  );
}

function IconeApp({ taille }: { taille: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </svg>
  );
}
