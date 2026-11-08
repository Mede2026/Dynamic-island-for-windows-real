/**
 * Tableau blanc (clic droit → Dessin), presque tout l'écran, pour expliquer un schéma pendant
 * le tutorat.
 *  - Tablette Wacom / tout stylet Windows Ink : la PRESSION change l'épaisseur ; le bout gomme
 *    du stylet efface ; traits lissés (courbes entre les points intermédiaires).
 *  - Outils : stylo, surligneur, ligne, flèche, rectangle, ellipse, gomme (Maj = droit / carré).
 *  - Couleurs (palette + « Autre couleur », retenues), taille réglable.
 *  - Annuler / rétablir (Ctrl+Z / Ctrl+Y), tout effacer, fond uni / quadrillé / ligné.
 *  - Copier l'image, l'enregistrer en PNG (Images › Dynamic Island).
 *  - Wacom : courbe de pression (douce / normale / ferme), lissage du trait (stabilisateur),
 *    bouton latéral du stylet = gomme, la paume (tactile) est ignorée quand le stylet est là,
 *    aperçu de la pointe au survol, tracé à faible latence (canevas « desynchronized »).
 *  - Raccourcis : P stylo, H surligneur, L ligne, A flèche, R rectangle, O ellipse, E gomme,
 *    [ ] taille, Ctrl+Z / Ctrl+Y, Ctrl+C copier, Ctrl+S enregistrer.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { backend } from "../bridge/backend";

type Outil = "stylo" | "surligneur" | "ligne" | "fleche" | "rectangle" | "ellipse" | "gomme";
type Fond = "uni" | "quadrille" | "ligne";
type Courbe = "douce" | "normale" | "ferme";
const GAMMA: Record<Courbe, number> = { douce: 0.55, normale: 1, ferme: 1.7 };

const COULEURS = ["#ffffff", "#8e8e93", "#000000", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#bf5af2"];
const CLE_PERSO = "ile-dessin-couleurs";
const FOND_COULEUR = "#1c1c1e";

/** Dessin gardé en mémoire entre deux ouvertures (PNG). */
let sauvegarde: string | null = null;

export function Dessin() {
  const toile = useRef<HTMLCanvasElement>(null);
  const [outil, setOutil] = useState<Outil>("stylo");
  const [couleur, setCouleur] = useState(COULEURS[0]!);
  const [taille, setTaille] = useState(4);
  const [fond, setFond] = useState<Fond>(() => (localStorage.getItem("ile-dessin-fond") as Fond) ?? "quadrille");
  const [perso, setPerso] = useState<string[]>(() => JSON.parse(localStorage.getItem(CLE_PERSO) ?? "[]") as string[]);
  const [message, setMessage] = useState("");
  const annuler = useRef<ImageData[]>([]);
  const retablir = useRef<ImageData[]>([]);
  const geste = useRef<{ depart: { x: number; y: number }; points: { x: number; y: number; p: number }[]; avant: ImageData } | null>(null);
  const [, forcer] = useState(0);
  const [courbe, setCourbe] = useState<Courbe>(() => (localStorage.getItem("ile-dessin-courbe") as Courbe) ?? "normale");
  const [lissage, setLissage] = useState(() => Number(localStorage.getItem("ile-dessin-lissage") ?? 3));
  /** Aperçu de la pointe (position et diamètre en px écran) quand le stylet survole. */
  const [pointe, setPointe] = useState<{ x: number; y: number; d: number } | null>(null);
  /** Dernier passage du stylet : le tactile (la paume) est ignoré pendant 1,5 s. */
  const styletVu = useRef(0);

  // « desynchronized » : le dessin s'affiche sans attendre l'image suivante (moins de retard
  // entre la pointe du stylet et le trait).
  const ctx = () => (toile.current?.getContext("2d", { desynchronized: true, willReadFrequently: true }) as CanvasRenderingContext2D | null) ?? null;
  const instantane = () => {
    const c = toile.current!;
    return ctx()!.getImageData(0, 0, c.width, c.height);
  };

  // Taille réelle de la toile = sa taille à l'écran × densité (net, quel que soit le zoom).
  useEffect(() => {
    const c = toile.current;
    if (!c) return;
    const ajuster = () => {
      const r = c.getBoundingClientRect();
      const l = Math.round(r.width * devicePixelRatio);
      const h = Math.round(r.height * devicePixelRatio);
      if (l < 2 || h < 2 || (c.width === l && c.height === h)) return;
      const avant = c.width > 1 ? c.toDataURL() : sauvegarde;
      c.width = l;
      c.height = h;
      if (avant) {
        const img = new Image();
        img.onload = () => (c.getContext("2d", { desynchronized: true, willReadFrequently: true }) as CanvasRenderingContext2D | null)?.drawImage(img, 0, 0);
        img.src = avant;
      }
    };
    ajuster();
    const obs = new ResizeObserver(ajuster);
    obs.observe(c);
    return () => {
      obs.disconnect();
      if (c.width > 1) sauvegarde = c.toDataURL();
    };
  }, []);

  const memoriser = () => {
    annuler.current.push(instantane());
    if (annuler.current.length > 40) annuler.current.shift();
    retablir.current = [];
    forcer((n) => n + 1);
  };
  const defaire = useCallback(() => {
    const d = annuler.current.pop();
    if (!d) return;
    retablir.current.push(instantane());
    ctx()?.putImageData(d, 0, 0);
    forcer((n) => n + 1);
  }, []);
  const refaire = useCallback(() => {
    const d = retablir.current.pop();
    if (!d) return;
    annuler.current.push(instantane());
    ctx()?.putImageData(d, 0, 0);
    forcer((n) => n + 1);
  }, []);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (!e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const outils: Record<string, Outil> = { p: "stylo", h: "surligneur", l: "ligne", a: "fleche", r: "rectangle", o: "ellipse", e: "gomme" };
        if (outils[k]) setOutil(outils[k]!);
        else if (k === "[") setTaille((t) => Math.max(1, t - 1));
        else if (k === "]") setTaille((t) => Math.min(40, t + 1));
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void backend.copierImage(exporterRef.current()).then(() => setMessage("Copiée"));
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void backend.enregistrerImage(exporterRef.current()).then(() => setMessage("Enregistrée dans Images › Dynamic Island"));
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        defaire();
      } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        refaire();
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [defaire, refaire]);

  const point = (e: { clientX: number; clientY: number; pointerType?: string; pressure?: number }) => {
    const c = toile.current!;
    const r = c.getBoundingClientRect();
    const stylet = e.pointerType === "pen";
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
      p: stylet ? Math.max(0.03, Math.pow(e.pressure || 0.5, GAMMA[courbe])) : 0.5,
    };
  };

  /** Trait à main levée lissé (courbes passant par les milieux), épaisseur selon la pression. */
  const tracerLibre = (g: CanvasRenderingContext2D, pts: { x: number; y: number; p: number }[], efface: boolean, surligneur: boolean) => {
    const base = taille * devicePixelRatio;
    g.globalCompositeOperation = efface ? "destination-out" : surligneur ? "source-over" : "source-over";
    g.globalAlpha = surligneur ? 0.35 : 1;
    g.strokeStyle = couleur;
    g.lineCap = surligneur ? "butt" : "round";
    g.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const m0 = i > 1 ? { x: (pts[i - 2]!.x + a.x) / 2, y: (pts[i - 2]!.y + a.y) / 2 } : a;
      const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const largeur = efface ? base * 4 : surligneur ? base * 4 : base * (0.35 + ((a.p + b.p) / 2) * 1.3);
      g.lineWidth = largeur;
      g.beginPath();
      g.moveTo(m0.x, m0.y);
      g.quadraticCurveTo(a.x, a.y, m1.x, m1.y);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  };

  /** Formes : ligne, flèche, rectangle, ellipse (Maj = droite / carré / cercle). */
  const tracerForme = (g: CanvasRenderingContext2D, a: { x: number; y: number }, b0: { x: number; y: number }, maj: boolean) => {
    let b = b0;
    if (maj) {
      const dx = b0.x - a.x;
      const dy = b0.y - a.y;
      if (outil === "ligne" || outil === "fleche") {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const d = Math.hypot(dx, dy);
        b = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
      } else {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        b = { x: a.x + Math.sign(dx || 1) * d, y: a.y + Math.sign(dy || 1) * d };
      }
    }
    g.strokeStyle = couleur;
    g.lineWidth = taille * devicePixelRatio;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    if (outil === "rectangle") g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    else if (outil === "ellipse") g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    else {
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      if (outil === "fleche") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const t = Math.max(12, taille * 3.5) * devicePixelRatio;
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - t * Math.cos(ang - 0.45), b.y - t * Math.sin(ang - 0.45));
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - t * Math.cos(ang + 0.45), b.y - t * Math.sin(ang + 0.45));
      }
    }
    g.stroke();
  };

  /** Image finale : le fond choisi + le dessin. */
  const exporter = () => {
    const c = toile.current!;
    const f = document.createElement("canvas");
    f.width = c.width;
    f.height = c.height;
    const g = f.getContext("2d")!;
    g.fillStyle = FOND_COULEUR;
    g.fillRect(0, 0, f.width, f.height);
    const pas = 28 * devicePixelRatio;
    if (fond !== "uni") {
      g.strokeStyle = "rgba(255,255,255,.08)";
      g.lineWidth = 1;
      for (let y = pas; y < f.height; y += pas) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(f.width, y);
        g.stroke();
      }
      if (fond === "quadrille")
        for (let x = pas; x < f.width; x += pas) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, f.height);
          g.stroke();
        }
    }
    g.drawImage(c, 0, 0);
    return f.toDataURL("image/png").split(",")[1] ?? "";
  };

  const exporterRef = useRef(exporter);
  exporterRef.current = exporter;

  const grille =
    fond === "uni"
      ? "none"
      : fond === "quadrille"
        ? "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)"
        : "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px)";

  const changerCouleur = (c: string) => {
    setCouleur(c);
    if (outil === "gomme") setOutil("stylo");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", color: "#fff", fontSize: 12 }}>
      {/* Barre d'outils */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Groupe>
          {(
            [
              ["stylo", "Stylo", <path key="s" d="M4 20l4-1 10-10-3-3L5 16l-1 4zM14 6l3 3" />],
              ["surligneur", "Surligneur", <path key="h" d="M5 19h6M9 15l-3 3M8 13l7-7 3 3-7 7H8z" />],
              ["ligne", "Ligne", <path key="l" d="M5 19L19 5" />],
              ["fleche", "Flèche", <path key="f" d="M5 19L19 5M11 5h8v8" />],
              ["rectangle", "Rectangle", <rect key="r" x="4.5" y="6.5" width="15" height="11" rx="1.5" />],
              ["ellipse", "Ellipse", <ellipse key="e" cx="12" cy="12" rx="8" ry="6" />],
              ["gomme", "Gomme (ou le bout gomme du stylet)", <path key="g" d="M8 19h11M4.5 15.5l9-9 5 5-6.5 6.5H8z" />],
            ] as [Outil, string, ReactNode][]
          ).map(([id, titre, dessin]) => (
            <BoutonOutil key={id} actif={outil === id} titre={titre} onClick={() => setOutil(id)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                {dessin}
              </svg>
            </BoutonOutil>
          ))}
        </Groupe>

        <Groupe>
          {[...COULEURS, ...perso.filter((p) => !COULEURS.includes(p))].map((c) => (
            <span
              key={c}
              title={c}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => changerCouleur(c)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                background: c,
                cursor: "pointer",
                boxShadow: couleur === c && outil !== "gomme" ? "0 0 0 2px #1c1c1e, 0 0 0 3.5px #fff" : "inset 0 0 0 1px rgba(255,255,255,.28)",
              }}
            />
          ))}
          <label title="Autre couleur" onPointerDown={(e) => e.stopPropagation()} style={{ position: "relative", width: 20, height: 20, borderRadius: 10, background: "conic-gradient(#ff453a,#ffd60a,#30d158,#64d2ff,#0a84ff,#bf5af2,#ff453a)", cursor: "pointer" }}>
            <input
              type="color"
              value={couleur.length === 7 ? couleur : "#ffffff"}
              onChange={(e) => changerCouleur(e.target.value)}
              onBlur={(e) => {
                const l = [e.target.value, ...perso.filter((x) => x !== e.target.value)].slice(0, 4);
                setPerso(l);
                localStorage.setItem(CLE_PERSO, JSON.stringify(l));
              }}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
          </label>
        </Groupe>

        <Groupe>
          <span style={{ color: "rgba(255,255,255,.6)" }}>Taille</span>
          <input type="range" min={1} max={40} value={taille} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setTaille(Number(e.target.value))} style={{ width: 110, accentColor: "#0a84ff" }} />
          <span style={{ width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{taille}</span>
        </Groupe>

        <Groupe>
          <span title="Courbe de pression du stylet (Wacom)" style={{ color: "rgba(255,255,255,.6)" }}>Pression</span>
          {(
            [
              ["douce", "Douce"],
              ["normale", "Normale"],
              ["ferme", "Ferme"],
            ] as [Courbe, string][]
          ).map(([id, nom]) => (
            <BoutonOutil
              key={id}
              titre={id === "douce" ? "Trait épais même en appuyant peu" : id === "ferme" ? "Il faut appuyer fort pour un trait épais" : "Pression normale"}
              actif={courbe === id}
              onClick={() => {
                setCourbe(id);
                localStorage.setItem("ile-dessin-courbe", id);
              }}
            >
              {nom}
            </BoutonOutil>
          ))}
          <span title="Stabilisateur : lisse les tremblements du trait" style={{ color: "rgba(255,255,255,.6)", marginLeft: 4 }}>Lissage</span>
          <input
            type="range"
            min={0}
            max={9}
            value={lissage}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              setLissage(Number(e.target.value));
              localStorage.setItem("ile-dessin-lissage", e.target.value);
            }}
            style={{ width: 70, accentColor: "#0a84ff" }}
          />
        </Groupe>

        <Groupe>
          <BoutonOutil titre="Annuler (Ctrl+Z)" actif={false} inactif={annuler.current.length === 0} onClick={defaire}>
            ↶
          </BoutonOutil>
          <BoutonOutil titre="Rétablir (Ctrl+Y)" actif={false} inactif={retablir.current.length === 0} onClick={refaire}>
            ↷
          </BoutonOutil>
          <BoutonOutil
            titre="Tout effacer"
            actif={false}
            onClick={() => {
              const c = toile.current;
              if (!c) return;
              memoriser();
              ctx()?.clearRect(0, 0, c.width, c.height);
            }}
          >
            Effacer
          </BoutonOutil>
        </Groupe>

        <Groupe>
          {(
            [
              ["uni", "Uni"],
              ["quadrille", "Quadrillé"],
              ["ligne", "Ligné"],
            ] as [Fond, string][]
          ).map(([id, nom]) => (
            <BoutonOutil
              key={id}
              titre={`Fond ${nom.toLowerCase()}`}
              actif={fond === id}
              onClick={() => {
                setFond(id);
                localStorage.setItem("ile-dessin-fond", id);
              }}
            >
              {nom}
            </BoutonOutil>
          ))}
        </Groupe>

        <span style={{ flex: 1 }} />
        {message && <span style={{ color: "rgba(255,255,255,.65)" }}>{message}</span>}
        <Groupe>
          <BoutonOutil
            titre="Copier l'image (à coller dans Discord, Word…)"
            actif={false}
            onClick={() => void backend.copierImage(exporter()).then(() => setMessage("Copiée"))}
          >
            Copier
          </BoutonOutil>
          <BoutonOutil
            titre="Enregistrer en PNG (Images › Dynamic Island)"
            actif={false}
            onClick={() =>
              void backend
                .enregistrerImage(exporter())
                .then((chemin) => setMessage(chemin ? "Enregistrée dans Images › Dynamic Island" : "Enregistrée"))
                .catch((e) => setMessage(String(e)))
            }
          >
            Enregistrer
          </BoutonOutil>
        </Groupe>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <canvas
        ref={toile}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => setPointe(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.pointerType === "pen") styletVu.current = Date.now();
          // La paume posée sur la tablette tactile pendant qu'on dessine au stylet : ignorée.
          if (e.pointerType === "touch" && Date.now() - styletVu.current < 1500) return;
          const g = ctx();
          if (!g || toile.current!.width < 2) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          memoriser();
          const p = point(e);
          geste.current = { depart: p, points: [p], avant: instantane() };
          setMessage("");
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "pen") styletVu.current = Date.now();
          // Aperçu de la pointe : un cercle de la taille du trait suit le stylet ou la souris.
          {
            const r = toile.current!.getBoundingClientRect();
            const d = (outil === "gomme" ? taille * 4 : outil === "surligneur" ? taille * 4 : taille) * (r.width / (toile.current!.width / devicePixelRatio || 1));
            setPointe({ x: e.clientX - r.left, y: e.clientY - r.top, d: Math.max(4, d) });
          }
          const g = ctx();
          const ge = geste.current;
          if (!g || !ge) return;
          if (e.pointerType === "touch" && Date.now() - styletVu.current < 1500) return;
          // Bout gomme (32) ou bouton latéral du stylet (2) : on efface.
          const efface = outil === "gomme" || (e.buttons & 32) !== 0 || (e.pointerType === "pen" && (e.buttons & 2) !== 0);
          if (efface || outil === "stylo" || outil === "surligneur") {
            const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
            const k = 1 - Math.min(lissage, 9) / 10.5; // stabilisateur (moyenne glissante)
            for (const ev of evs.length ? evs : [e.nativeEvent]) {
              const brut = point(ev);
              const prec = ge.points[ge.points.length - 1];
              ge.points.push(prec ? { x: prec.x + (brut.x - prec.x) * k, y: prec.y + (brut.y - prec.y) * k, p: brut.p } : brut);
            }
            if (outil === "surligneur" && !efface) {
              // Le surligneur se redessine d'un bloc : pas de surépaisseur aux recouvrements.
              g.putImageData(ge.avant, 0, 0);
              tracerLibre(g, ge.points, false, true);
            } else {
              tracerLibre(g, ge.points.slice(-4), efface, false);
            }
          } else {
            g.putImageData(ge.avant, 0, 0);
            tracerForme(g, ge.depart, point(e), e.shiftKey);
          }
        }}
        onPointerUp={() => (geste.current = null)}
        style={{
          flex: 1,
          width: "100%",
          minHeight: 0,
          borderRadius: 14,
          backgroundColor: "rgba(0,0,0,.32)",
          backgroundImage: grille,
          backgroundSize: "28px 28px",
          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,.14)",
          cursor: "none",
          touchAction: "none",
        }}
      />
      {pointe && (
        <div
          style={{
            position: "absolute",
            left: pointe.x - pointe.d / 2,
            top: pointe.y - pointe.d / 2,
            width: pointe.d,
            height: pointe.d,
            borderRadius: pointe.d,
            pointerEvents: "none",
            boxShadow: "0 0 0 1px rgba(255,255,255,.85), 0 0 0 2px rgba(0,0,0,.5)",
            background: outil === "gomme" ? "transparent" : `${couleur}55`,
          }}
        />
      )}
      </div>
    </div>
  );
}

function Groupe({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 12, background: "rgba(255,255,255,.07)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.12)" }}>
      {children}
    </div>
  );
}

function BoutonOutil({ children, actif, inactif = false, titre, onClick }: { children: ReactNode; actif: boolean; inactif?: boolean; titre: string; onClick: () => void }) {
  return (
    <button
      title={titre}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      disabled={inactif}
      style={{
        border: 0,
        height: 28,
        minWidth: 28,
        padding: "0 8px",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: actif ? "#0a84ff" : "transparent",
        color: inactif ? "rgba(255,255,255,.3)" : "#fff",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}
