/**
 * Contenus de l'île. Toutes les positions et tailles viennent de island.config.ts
 * (en points, convertis en px CSS = DIP avec ISLAND_SCALE).
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type ReactNode } from "react";
import { backend } from "../bridge/backend";
import { donnees, formaterDuree, formaterMinuteurCompact, majDonnees, positionActuelle, type Donnees } from "../bridge/donnees";
import type { EtatMinuteur } from "../bridge/types";
import type { IslandConfig, Texte } from "../island.config";
import {
  baselineDetail,
  cotesAlerte,
  ECART_ICONE_PT,
  hauteurMiniature,
  largeurAlerte,
  largeurMiniature,
  cadreApercu,
  mesureConfig,
  specAlerte,
  tailleIcone,
} from "./alertes";
import type { Alerte, EtatMachine } from "../state/islandMachine";
import { preferencesActuelles, v } from "../config/store";
import { Onde } from "./onde";
import { IconeCalendrier, IconePipette, IconeVentilo } from "./outils";
import { animate, AnimatePresence, motion } from "framer-motion";
import { geometrieCible, LIGNE_PAROLES, parolesVisibles } from "./choregraphie";
import { indiceLigne } from "../bridge/paroles";
import { basculerMusiqueDeTest, estMusiqueDeTest } from "../demo/scenarios";
import { IconeMeteo, IconeNeige, IconePluie } from "./icones";
import {
  IconeBatterie,
  IconeBluetooth,
  IconeCasque,
  IconeClavier,
  IconeMajuscules,
  IconeManette,
  IconeNumerique,
  IconeSouris,
  IconeUsb,
  IconeCloche,
  IconeCopier,
  IconeDossier,
  IconeFermer,
  IconeFichier,
  IconeImprimante,
  IconeCadenas,
  IconeEcran,
  IconeBureaux,
  IconeHautParleur,
  IconeMiseAJour,
  IconeNote,
  IconeBouclier,
  IconeChrono,
  IconeCrayon,
  IconeTexteImage,
  IconeLoupe,
  IconeReglages,
  IconeOeil,
  IconeWifi,
  IconeTelechargement,
  IconeHorloge,
  IconeLecture,
  IconeLune,
  IconeMicro,
  IconeMinuteur,
  IconeOuvrir,
  IconePause,
  IconePressePapiers,
  IconeSaut,
  IconeSoleil,
  IconeSource,
  IconeTelephone,
  IconeVolume,
} from "./icones";

/** Inter : ligne de base à 0,8633 em du haut d'une boîte de hauteur de ligne 1. */
const BASELINE_INTER = 0.8633;

export interface Ctx {
  cfg: IslandConfig;
  /** px CSS par point. */
  S: number;
  d: Donnees;
  etat: EtatMachine;
}

/** Espacement des lettres selon la taille (équivalent du « tracking » de SF Pro). */
export function suivi(cfg: IslandConfig, taillePx: number): string {
  const ty = cfg.typographie;
  return `${v(ty.suiviA) + v(ty.suiviB) * Math.exp(v(ty.suiviC) * taillePx)}em`;
}

let cfgTypo: IslandConfig | null = null;
/** Mémorise la config pour `texte` (appelé par le rendu). */
export function definirTypographie(cfg: IslandConfig) {
  cfgTypo = cfg;
}

export function texte(t: Texte, S: number, extra: CSSProperties = {}): CSSProperties {
  return {
    position: "absolute",
    letterSpacing: cfgTypo ? suivi(cfgTypo, v(t.taillePt) * S) : undefined,
    fontSize: v(t.taillePt) * S,
    fontWeight: v(t.graisse),
    color: v(t.couleur),
    lineHeight: 1,
    whiteSpace: "nowrap",
    ...extra,
  };
}

const haut = (baselinePt: number, t: Texte, S: number) => (baselinePt - BASELINE_INTER * v(t.taillePt)) * S;

function couleurPochette(d: Donnees, defaut: string): string {
  const c = d.pochette?.couleurDominante;
  return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : defaut;
}

/**
 * URL d'image de la pochette, créée UNE fois par pochette (et non un long « data: » base64
 * décodé à chaque apparition du contenu, ce qui provoquait des saccades au début des animations).
 */
const urlsPochettes = new Map<string, string>();
function urlPochette(id: string, pngBase64: string): string {
  let url = urlsPochettes.get(id);
  if (!url) {
    const octets = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    url = URL.createObjectURL(new Blob([octets], { type: "image/png" }));
    // On garde les 4 dernières pochettes (changement de piste aller-retour).
    if (urlsPochettes.size >= 4) {
      const [ancienne, u] = urlsPochettes.entries().next().value as [string, string];
      URL.revokeObjectURL(u);
      urlsPochettes.delete(ancienne);
    }
    urlsPochettes.set(id, url);
  }
  return url;
}

function Pochette({ d, taille, rayon, style }: { d: Donnees; taille: number; rayon: number; style?: CSSProperties }) {
  const p = d.pochette;
  return (
    <div
      style={{
        position: "absolute",
        width: taille,
        height: taille,
        borderRadius: rayon,
        overflow: "hidden",
        background: p ? undefined : "linear-gradient(135deg, #3a3a3c, #1c1c1e)",
        ...style,
      }}
    >
      {p && (
        <img src={urlPochette(p.id, p.pngBase64)} width={taille} height={taille} alt="" draggable={false} decoding="async" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------

export function MusiqueCompact({ cfg, S, d, etat }: Ctx) {
  const c = cfg.media.compact;
  const e = cfg.media.etendu;
  // Largeur réelle (plus large quand les paroles sont affichées).
  const largeur = geometrieCible(etat, cfg).largeur * S;
  const paroles = parolesVisibles(etat);
  const hMax = v(c.ondeHauteurMaxPt) * S;
  const n = v(e.ondeNombreBarres);
  const largeurOnde = ((n - 1) * v(c.ondePasPt) + v(c.ondeLargeurBarrePt)) * S;
  return (
    <>
      <Pochette
        d={d}
        taille={v(c.pochetteTaillePt) * S}
        rayon={v(c.pochetteRayonPt) * S}
        style={{ left: v(c.pochetteXPt) * S, top: v(c.pochetteYPt) * S }}
      />
      <Onde
        n={n}
        largeurBarre={v(c.ondeLargeurBarrePt) * S}
        pas={v(c.ondePasPt) * S}
        hMin={v(c.ondeLargeurBarrePt) * S}
        hMax={hMax}
        couleur={couleurPochette(d, v(e.titre.couleur))}
        enLecture={d.media?.statut === "lecture"}
        style={{ left: largeur - v(c.ondeDroitePt) * S - largeurOnde, top: (v(cfg.formes.compact.taille.pt.hauteur) * S - hMax) / 2 }}
      />
      {paroles && <LigneParolesIle cfg={cfg} S={S} d={d} largeur={largeur} />}
    </>
  );
}

/** Avance (ms) : la ligne apparaît un peu avant d'être chantée, comme dans les apps de musique. */
const AVANCE_PAROLES_MS = 400;

/** Ligne de paroles en cours, sous la caméra ; chaque nouvelle ligne arrive floue puis nette. */
function LigneParolesIle({ cfg, S, d, largeur }: { cfg: IslandConfig; S: number; d: Donnees; largeur: number }) {
  const lignes = d.paroles?.lignes;
  const [i, setI] = useState(-1);
  useEffect(() => {
    if (!lignes) return;
    const maj = () => {
      const m = donnees().media;
      if (m) setI(indiceLigne(lignes, positionActuelle(m) + AVANCE_PAROLES_MS + (preferencesActuelles().decalageParolesMs ?? 0)));
    };
    maj();
    const id = setInterval(maj, 120);
    return () => clearInterval(id);
  }, [lignes]);
  const a = cfg.alerte;
  const marge = v(a.texteXPt) * S;
  const ligne = i >= 0 ? (lignes?.[i]?.texte ?? "") : "";
  return (
    <div style={{ position: "absolute", left: marge, width: largeur - 2 * marge, top: haut(baselineDetail(cfg), a.texte, S), height: v(a.texte.taillePt) * S * LIGNE_PAROLES * 2 }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 7 * S, filter: `blur(${4 * S}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -7 * S, filter: `blur(${4 * S}px)` }}
          transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          style={texte(a.texte, S, {
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            whiteSpace: "normal",
            lineHeight: LIGNE_PAROLES,
          })}
        >
          {/* Deux lignes au plus ; une ligne courte reste centrée dans la place des deux. */}
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{ligne || "♪"}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Pochette seule (île principale en mode split, ou bulle). */
export function MusiqueMinimal({ cfg, S, d }: Ctx) {
  const c = cfg.media.compact;
  return (
    <Pochette
      d={d}
      taille={v(c.pochetteTaillePt) * S}
      rayon={v(c.pochetteRayonPt) * S}
      style={{ left: v(c.pochetteXPt) * S, top: v(c.pochetteYPt) * S }}
    />
  );
}

function BarreProgression({ ctx }: { ctx: Ctx }) {
  const { cfg, S, d } = ctx;
  const e = cfg.media.etendu;
  const m = d.media;
  const [, forcer] = useState(0);
  const [glisse, setGlisse] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Rafraîchir la position seulement quand ça joue (CPU ≈ 0 sinon).
  useEffect(() => {
    if (m?.statut !== "lecture") return;
    const id = setInterval(() => forcer((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [m?.statut]);

  if (!m) return null;
  const duree = m.dureeMs || 1;
  const pos = glisse ?? positionActuelle(m);
  const x0 = v(e.barreXPt) * S;
  const largeur = (v(e.barreFinPt) - v(e.barreXPt)) * S;
  const hBarre = v(e.barreHauteurPt) * S;

  const fraction = (ev: PE) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1);
  };
  return (
    <>
      <div style={texte(e.temps, S, { left: v(e.tempsGauchePt) * S, top: haut(v(e.tempsBaselinePt), e.temps, S) })}>
        {formaterDuree(pos)}
      </div>
      <div
        style={texte(e.temps, S, {
          right: (v(cfg.formes.etendu.taille.pt.largeur) - v(e.tempsDroitePt)) * S,
          top: haut(v(e.tempsBaselinePt), e.temps, S),
        })}
      >
        −{formaterDuree(duree - pos)}
      </div>
      <div
        ref={ref}
        style={{
          position: "absolute",
          left: x0,
          top: v(e.barreCentreYPt) * S - hBarre * 1.5,
          width: largeur,
          height: hBarre * 3,
          cursor: m.peutAllerA ? "pointer" : "default",
        }}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          if (!m.peutAllerA) return;
          (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
          setGlisse(fraction(ev) * duree);
        }}
        onPointerMove={(ev) => glisse !== null && setGlisse(fraction(ev) * duree)}
        onPointerUp={(ev) => {
          ev.stopPropagation();
          if (glisse === null) return;
          void backend.allerA(fraction(ev) * duree);
          setGlisse(null);
        }}
      >
        <div
          style={{
            position: "absolute",
            top: hBarre,
            width: "100%",
            height: hBarre,
            borderRadius: hBarre,
            background: v(e.barreVideCouleur),
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${(pos / duree) * 100}%`, height: "100%", background: v(e.barrePleineCouleur) }} />
        </div>
      </div>
    </>
  );
}

function Bouton({
  x,
  y,
  taille,
  onClick,
  children,
  desactive,
}: {
  x: number;
  y: number;
  taille: number;
  onClick: () => void;
  children: React.ReactNode;
  desactive?: boolean;
}) {
  return (
    <button
      className="bouton-ile"
      disabled={desactive}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        position: "absolute",
        left: x - taille / 2,
        top: y - taille / 2,
        width: taille,
        height: taille,
        opacity: desactive ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function MusiqueEtendu(ctx: Ctx) {
  const { cfg, S, d } = ctx;
  const e = cfg.media.etendu;
  const m = d.media;
  const xs = v(e.boutonsCentresXPt).map((x) => x * S);
  const y = v(e.boutonsCentreYPt) * S;
  const tLecture = v(e.iconeLecturePt) * S;
  const tSaut = v(e.iconeSautPt) * S;
  const tSec = v(e.iconeSecondairePt) * S;
  const enLecture = m?.statut === "lecture";
  const largeurTexte = (v(e.ondeXPt) - v(e.texteXPt) - 8) * S;
  return (
    <>
      <Pochette
        d={d}
        taille={v(e.pochetteTaillePt) * S}
        rayon={v(e.pochetteRayonPt) * S}
        style={{ left: v(e.pochetteXPt) * S, top: v(e.pochetteYPt) * S }}
      />
      <div
        style={texte(e.titre, S, {
          left: v(e.texteXPt) * S,
          top: haut(v(e.titreBaselinePt), e.titre, S),
          maxWidth: largeurTexte,
          overflow: "hidden",
          textOverflow: "ellipsis",
          paddingBottom: 3 * S,
        })}
      >
        {m?.titre || "Aucune lecture"}
      </div>
      <div
        style={texte(e.artiste, S, {
          left: v(e.texteXPt) * S,
          top: haut(v(e.artisteBaselinePt), e.artiste, S),
          maxWidth: largeurTexte,
          overflow: "hidden",
          textOverflow: "ellipsis",
          paddingBottom: 3 * S,
        })}
      >
        {m?.artiste || m?.sourceActive || ""}
      </div>
      <Onde
        n={v(e.ondeNombreBarres)}
        largeurBarre={v(e.ondeLargeurBarrePt) * S}
        pas={v(e.ondePasPt) * S}
        hMin={v(e.ondeHauteurMinPt) * S}
        hMax={v(e.ondeHauteurMaxPt) * S}
        couleur={couleurPochette(d, v(e.titre.couleur))}
        enLecture={enLecture}
        style={{ left: v(e.ondeXPt) * S, top: (v(e.ondeCentreYPt) - v(e.ondeHauteurMaxPt) / 2) * S }}
      />
      <BarreProgression ctx={ctx} />
      <Bouton x={xs[0]!} y={y} taille={tSec * 1.6} onClick={() => void backend.ouvrirSource()}>
        <IconeOuvrir taille={tSec} couleur={v(e.iconeSecondaireCouleur)} />
      </Bouton>
      <Bouton x={xs[1]!} y={y} taille={tSaut * 1.2} onClick={() => void backend.precedent()} desactive={!m?.peutPrecedent}>
        <IconeSaut taille={tSaut} couleur={v(e.iconeCouleur)} inverse />
      </Bouton>
      <Bouton
        x={xs[2]!}
        y={y}
        taille={tLecture * 1.3}
        onClick={() => (estMusiqueDeTest() ? basculerMusiqueDeTest() : void backend.lecturePause())}
        desactive={!m?.peutLirePause}
      >
        {enLecture ? <IconePause taille={tLecture} couleur={v(e.iconeCouleur)} /> : <IconeLecture taille={tLecture} couleur={v(e.iconeCouleur)} />}
      </Bouton>
      <Bouton x={xs[3]!} y={y} taille={tSaut * 1.2} onClick={() => void backend.suivant()} desactive={!m?.peutSuivant}>
        <IconeSaut taille={tSaut} couleur={v(e.iconeCouleur)} />
      </Bouton>
      <Bouton
        x={xs[4]!}
        y={y}
        taille={tSec * 1.6}
        onClick={() => {
          // Passe à la source suivante (Spotify → navigateur → …).
          const sources = m?.sources ?? [];
          if (sources.length < 2) return;
          const i = sources.findIndex((s) => s.appId === m?.sourceActive);
          void backend.choisirSource(sources[(i + 1) % sources.length]!.appId);
        }}
        desactive={(m?.sources.length ?? 0) < 2}
      >
        <IconeSource taille={tSec} couleur={v(e.iconeSecondaireCouleur)} />
      </Bouton>
    </>
  );
}

// ---------------------------------------------------------------------------
// Minuteur
// ---------------------------------------------------------------------------

function useRestant(m: EtatMinuteur | null): number {
  const [, forcer] = useState(0);
  useEffect(() => {
    if (m?.statut !== "enCours") return;
    const id = setInterval(() => forcer((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [m?.statut]);
  if (!m) return 0;
  return m.statut === "enCours" && m.finAMs ? Math.max(m.finAMs - Date.now(), 0) : m.restantMs;
}

export function MinuteurCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const m = d.minuteur;
  const restant = useRestant(m);
  const largeur = v(cfg.formesContenu.compactDeuxCotes.taille.pt.largeur) * S;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  const progression = m && m.dureeMs ? restant / m.dureeMs : 1;
  return (
    <>
      <IconeMinuteur
        taille={ti}
        couleur={v(c.couleur)}
        progression={progression}
        finAMs={m?.statut === "enCours" ? m.finAMs : null}
        dureeMs={m?.dureeMs ?? 0}
        style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }}
      />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          left: undefined,
        })}
        data-largeur={largeur}
      >
        {formaterMinuteurCompact(restant)}
      </div>
    </>
  );
}

export function MinuteurMinimal({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const m = d.minuteur;
  const restant = useRestant(m);
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return (
    <IconeMinuteur
      taille={ti}
      couleur={v(c.couleur)}
      progression={m && m.dureeMs ? restant / m.dureeMs : 1}
      finAMs={m?.statut === "enCours" ? m.finAMs : null}
      dureeMs={m?.dureeMs ?? 0}
      style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }}
    />
  );
}

export function MinuteurEtendu({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const m = d.minuteur;
  const restant = useRestant(m);
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const [xPause, xAnnuler] = v(c.etenduBoutonXPt).map((x) => x * S);
  const y = v(c.etenduBoutonYPt) * S;
  const enPause = m?.statut === "pause";
  return (
    <>
      {m?.source !== "horloge" && (
        <>
      <button
        className="bouton-ile"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void (enPause ? backend.minuteurReprendre() : backend.minuteurPause());
        }}
        style={{ position: "absolute", left: xPause, top: y, width: diam, height: diam, borderRadius: diam, background: v(c.etenduBoutonPauseFond) }}
      >
        {enPause ? <IconeLecture taille={diam * 0.42} couleur={v(c.couleur)} /> : <IconePause taille={diam * 0.42} couleur={v(c.couleur)} />}
      </button>
      <button
        className="bouton-ile"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void backend.minuteurAnnuler();
        }}
        style={{ position: "absolute", left: xAnnuler, top: y, width: diam, height: diam, borderRadius: diam, background: v(c.etenduBoutonAnnulerFond) }}
      >
        <IconeFermer taille={diam * 0.42} couleur="#ffffff" />
      </button>
        </>
      )}
      <div style={texte(c.etenduLibelle, S, { left: v(c.etenduLibelleXPt) * S, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S) })}>
        {m?.source === "horloge" ? "Horloge" : "Minuteur"}
      </div>
      <div
        style={texte(c.etenduChiffres, S, {
          right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
          top: haut(v(c.etenduBaselinePt), c.etenduChiffres, S),
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        })}
      >
        {formaterDuree(restant)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Téléchargements en cours (dossier Téléchargements)
// ---------------------------------------------------------------------------

const BLEU = "#0a84ff";

/** « 12,4 Mo », « 830 Ko », « 1,2 Go ». */
export function formaterOctets(o: number): string {
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  let x = o;
  while (x >= 1000 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toLocaleString("fr-CA", { maximumFractionDigits: x < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

/** Icône avec un anneau qui tourne (pas de pourcentage connu). */
function IconeTelechargementActif({ taille, style }: { taille: number; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", width: taille, height: taille, ...style }}>
      <motion.svg
        width={taille}
        height={taille}
        viewBox="0 0 24 24"
        style={{ position: "absolute", inset: 0 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="12" cy="12" r="10.6" fill="none" stroke={BLEU} strokeOpacity="0.25" strokeWidth="2" />
        <path d="M12 1.4a10.6 10.6 0 0 1 10.6 10.6" fill="none" stroke={BLEU} strokeWidth="2" strokeLinecap="round" />
      </motion.svg>
      <IconeTelechargement taille={taille * 0.56} couleur={BLEU} style={{ position: "absolute", left: taille * 0.22, top: taille * 0.2 }} />
    </div>
  );
}

export function TelechargementCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  const total = d.telechargements.reduce((s, t) => s + t.octets, 0);
  return (
    <>
      <IconeTelechargementActif taille={ti} style={{ left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          color: BLEU,
          left: undefined,
          fontSize: v(c.compactTexte.taillePt) * S * 0.82,
        })}
      >
        {formaterOctets(total)}
      </div>
    </>
  );
}

export function TelechargementMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeTelechargementActif taille={ti} style={{ left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

export function TelechargementEtendu({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const premier = d.telechargements[0];
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const y = v(c.etenduBoutonYPt) * S;
  const vitesse = d.telechargements.reduce((s, t) => s + t.vitesse, 0);
  const autres = d.telechargements.length - 1;
  const largeur = v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) * S;
  return (
    <>
      <IconeTelechargementActif taille={diam} style={{ left: gauche, top: y }} />
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.08, color: "#ffffff", width: largeur - gauche * 2 - diam * 1.25, overflow: "hidden", textOverflow: "ellipsis" })}>
        {premier?.nom ?? "Téléchargement"}
      </div>
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.55, color: v(cfg.media.etendu.artiste.couleur), fontWeight: 400 })}>
        {formaterOctets(premier?.octets ?? 0)}
        {vitesse > 0 ? ` · ${formaterOctets(vitesse)}/s` : ""}
        {autres > 0 ? ` · ${autres} autre${autres > 1 ? "s" : ""}` : ""}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Étagère : fichiers déposés sur l'île
// ---------------------------------------------------------------------------

const nomFichier = (chemin: string) => chemin.split(/[\\/]/).pop() ?? chemin;

export function EtagereCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return (
    <>
      <IconeDossier taille={ti} couleur="#64a8ff" style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          color: "#ffffff",
          left: undefined,
        })}
      >
        {d.etagere.length}
      </div>
    </>
  );
}

export function EtagereMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeDossier taille={ti} couleur="#64a8ff" style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

/** Bouton de l'île : ne déclenche ni l'appui long ni la fermeture. */
function boutonIle(faire: () => void) {
  return {
    className: "bouton-ile",
    onPointerDown: (e: PE) => e.stopPropagation(),
    onPointerUp: (e: PE) => e.stopPropagation(),
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      faire();
    },
  };
}

/** Vue étendue : la liste des fichiers ; clic = ouvrir ; copier (coller dans l'Explorateur) ; retirer. */
export function EtagereEtendu({ cfg, S, d }: Ctx) {
  const largeur = v(cfg.formes.etendu.taille.pt.largeur) * S;
  const hauteur = v(cfg.formes.etendu.taille.pt.hauteur) * S;
  const marge = 20 * S;
  const ligne = 26 * S;
  const visibles = d.etagere.slice(0, 5);
  const gris = v(cfg.media.etendu.artiste.couleur);
  const t = 13.5 * S;
  return (
    <div style={{ position: "absolute", left: marge, top: marge * 0.9, width: largeur - 2 * marge, height: hauteur - marge * 1.6, fontSize: t, color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 * S, height: ligne, fontWeight: 600 }}>
        <IconeDossier taille={t * 1.3} couleur="#64a8ff" />
        <span style={{ flex: 1 }}>Étagère{d.etagere.length > 0 ? ` · ${d.etagere.length}` : ""}</span>
        <button
          {...boutonIle(() => void backend.etagereColler().catch(() => undefined))}
          title="Ajouter les fichiers copiés dans l'Explorateur (Ctrl+C)"
          style={{ color: "#64a8ff", fontSize: t * 0.9, fontWeight: 600, marginRight: 10 * S }}
        >
          Coller
        </button>
        {d.etagere.length > 0 && (
          <>
            <button {...boutonIle(() => void backend.copierFichiers(d.etagere))} style={{ color: "#64a8ff", fontSize: t * 0.9, fontWeight: 600 }}>
              Tout copier
            </button>
            <button {...boutonIle(() => void backend.etagereRetirer(null))} style={{ color: gris, fontSize: t * 0.9, fontWeight: 600, marginLeft: 10 * S }}>
              Vider
            </button>
          </>
        )}
      </div>
      {visibles.map((chemin) => (
        <div key={chemin} style={{ display: "flex", alignItems: "center", gap: 8 * S, height: ligne }}>
          <IconeFichier taille={t * 1.2} couleur="#d1d1d6" />
          <button
            {...boutonIle(() => void backend.ouvrirFichier(chemin))}
            title={chemin}
            style={{ flex: 1, justifyContent: "flex-start", color: "#fff", fontSize: t, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
          >
            {nomFichier(chemin)}
          </button>
          <button {...boutonIle(() => void backend.copierFichiers([chemin]))} title="Copier (puis coller où tu veux)">
            <IconeCopier taille={t * 1.15} couleur={gris} />
          </button>
          <button {...boutonIle(() => void backend.ouvrirFichier(chemin, true))} title="Afficher dans l'Explorateur">
            <IconeOuvrir taille={t * 1.1} couleur={gris} />
          </button>
          <button {...boutonIle(() => void backend.etagereRetirer(chemin))} title="Retirer de l'étagère">
            <IconeFermer taille={t * 0.95} couleur={gris} />
          </button>
        </div>
      ))}
      {d.etagere.length > visibles.length && <div style={{ color: gris, fontSize: t * 0.9 }}>et {d.etagere.length - visibles.length} autre(s)…</div>}
      {d.etagere.length === 0 && (
        <div style={{ color: gris, fontSize: t, lineHeight: 1.4, marginTop: 10 * S }}>
          Glisse des fichiers ici, ou copie-les dans l'Explorateur (Ctrl+C) puis « Coller ».
          <br />
          Ils restent où ils sont : l'île garde seulement le chemin.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// « Quelle est cette chanson ? » : l'île écoute
// ---------------------------------------------------------------------------

/** Ondes qui s'élargissent depuis une note (écoute en cours). */
function IconeEcoute({ taille, style }: { taille: number; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", width: taille, height: taille, ...style }}>
      {[0, 0.5, 1].map((retard) => (
        <motion.div
          key={retard}
          style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${taille * 0.08}px solid ${BLEU}` }}
          initial={{ scale: 0.35, opacity: 0.9 }}
          animate={{ scale: 1.05, opacity: 0 }}
          transition={{ duration: 1.5, repeat: Infinity, delay: retard, ease: "easeOut" }}
        />
      ))}
      <IconeNote taille={taille * 0.5} couleur={BLEU} style={{ position: "absolute", left: taille * 0.25, top: taille * 0.25 }} />
    </div>
  );
}

function texteEcoute(etat: Ctx["etat"]) {
  const r = etat.activites.find((a) => a.type === "ecoute")?.donnees as { etape?: string } | undefined;
  return r?.etape === "recherche" ? "Recherche…" : "J'écoute…";
}

export function EcouteCompact({ cfg, S, etat }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return (
    <>
      <IconeEcoute taille={ti} style={{ left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S * 0.82) / 2,
          color: BLEU,
          left: undefined,
          fontSize: v(c.compactTexte.taillePt) * S * 0.82,
        })}
      >
        {texteEcoute(etat)}
      </div>
    </>
  );
}

export function EcouteMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeEcoute taille={ti} style={{ left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

export function EcouteEtendu({ cfg, S, etat }: Ctx) {
  const c = cfg.minuteur;
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const y = v(c.etenduBoutonYPt) * S;
  return (
    <>
      <IconeEcoute taille={diam} style={{ left: gauche, top: y }} />
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.08, color: "#ffffff" })}>{texteEcoute(etat)}</div>
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.55, color: v(cfg.media.etendu.artiste.couleur), fontWeight: 400 })}>
        Le son du PC, quelques secondes
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Impression en cours
// ---------------------------------------------------------------------------

const pagesTexte = (t: { pagesImprimees: number; pagesTotal: number }) =>
  t.pagesTotal > 0 ? `${Math.min(t.pagesImprimees + 1, t.pagesTotal)}/${t.pagesTotal}` : "…";

export function ImpressionCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  const t = d.impressions[0];
  const erreur = Boolean(t?.erreur);
  return (
    <>
      <motion.div
        style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2, width: ti, height: ti }}
        animate={{ opacity: erreur ? 1 : [1, 0.55, 1] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      >
        <IconeImprimante taille={ti} couleur={erreur ? v(cfg.alerte.batterieFaibleCouleur) : "#ffffff"} />
      </motion.div>
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          color: erreur ? v(cfg.alerte.batterieFaibleCouleur) : "#ffffff",
          left: undefined,
        })}
      >
        {t ? pagesTexte(t) : ""}
      </div>
    </>
  );
}

export function ImpressionMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeImprimante taille={ti} couleur="#ffffff" style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

export function ImpressionEtendu({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const t = d.impressions[0];
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const y = v(c.etenduBoutonYPt) * S;
  const largeur = v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) * S;
  const autres = d.impressions.length - 1;
  const gris = v(cfg.media.etendu.artiste.couleur);
  return (
    <>
      <IconeImprimante taille={diam * 0.8} couleur="#ffffff" style={{ position: "absolute", left: gauche + diam * 0.1, top: y + diam * 0.1 }} />
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.08, color: "#ffffff", width: largeur - gauche * 2 - diam * 1.25, overflow: "hidden", textOverflow: "ellipsis" })}>
        {t?.document || "Document"}
      </div>
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.55, color: t?.erreur ? v(cfg.alerte.batterieFaibleCouleur) : gris, fontWeight: 400 })}>
        {t?.erreur ?? (t && t.pagesTotal > 0 ? `Page ${pagesTexte(t).replace("/", " sur ")}` : "Impression…")}
        {t ? ` · ${t.imprimante}` : ""}
        {autres > 0 ? ` · ${autres} autre${autres > 1 ? "s" : ""}` : ""}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Appel entrant (Teams, WhatsApp, Discord…)
// ---------------------------------------------------------------------------

const VERT_APPEL = "#30d158";
const ROUGE_APPEL = "#ff453a";

/** Fin de la carte d'appel (le pont retire l'activité). */
export function finirAppelEntrant() {
  window.dispatchEvent(new CustomEvent("ile-appel-entrant-fin"));
}

export function AppelEntrantCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return (
    <>
      <motion.div
        style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2, width: ti, height: ti }}
        animate={{ rotate: [0, -14, 14, -14, 0] }}
        transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 0.6 }}
      >
        <IconeTelephone taille={ti} couleur={VERT_APPEL} />
      </motion.div>
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S * 0.82) / 2,
          color: VERT_APPEL,
          left: undefined,
          fontSize: v(c.compactTexte.taillePt) * S * 0.82,
          maxWidth: 70 * S,
          overflow: "hidden",
          textOverflow: "ellipsis",
        })}
      >
        {d.appelEntrant?.nom.split(" ")[0] ?? "Appel"}
      </div>
    </>
  );
}

export function AppelEntrantMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeTelephone taille={ti} couleur={VERT_APPEL} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

/** Comme sur iPhone : nom de l'appelant, puis Refuser (rouge) et Répondre (vert). */
export function AppelEntrantEtendu({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const a = d.appelEntrant ?? { nom: "Appel", application: "" };
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const y = v(c.etenduBoutonYPt) * S;
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  const largeur = v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) * S;
  const gris = v(cfg.media.etendu.artiste.couleur);
  const teams = /teams/i.test(a.application);
  const repondre = (accepter: boolean) => {
    void backend.appelEntrantRepondre(a.application, accepter).catch(() => undefined);
    finirAppelEntrant();
  };
  const initiale = a.nom.trim().charAt(0).toUpperCase() || "?";
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: gauche,
          top: y,
          width: diam,
          height: diam,
          borderRadius: diam,
          background: "linear-gradient(180deg, #8e8e93, #636366)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: diam * 0.45,
        }}
      >
        {initiale}
      </div>
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.08, color: gris, fontWeight: 400 })}>
        {a.application}
      </div>
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: y + diam * 0.52, color: "#ffffff", maxWidth: largeur - gauche - diam * 4.6, overflow: "hidden", textOverflow: "ellipsis" })}>
        {a.nom}
      </div>
      <button
        {...boutonIle(() => repondre(false))}
        title={teams ? "Refuser" : "Ignorer"}
        style={{ position: "absolute", right: gauche + diam * 1.3, top: y, width: diam, height: diam, borderRadius: diam, background: ROUGE_APPEL }}
      >
        <IconeTelephone taille={diam * 0.5} couleur="#ffffff" style={{ transform: "rotate(135deg)" }} />
      </button>
      <button
        {...boutonIle(() => repondre(true))}
        title="Répondre"
        style={{ position: "absolute", right: gauche, top: y, width: diam, height: diam, borderRadius: diam, background: VERT_APPEL }}
      >
        <IconeTelephone taille={diam * 0.5} couleur="#ffffff" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Enregistrement de l'écran : point rouge et durée, comme sur iPhone
// ---------------------------------------------------------------------------

const ROUGE_ENREGISTREMENT = "#ff3b30";

function useDureeDepuis(debutMs: number | undefined): number {
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return debutMs ? maintenant - debutMs : 0;
}

const debutEnregistrement = (etat: Ctx["etat"]) =>
  (etat.activites.find((a) => a.type === "enregistrement")?.donnees as { debutMs?: number } | undefined)?.debutMs;

function PointRouge({ taille, style }: { taille: number; style?: CSSProperties }) {
  return (
    <motion.div
      style={{ position: "absolute", width: taille, height: taille, borderRadius: taille, background: ROUGE_ENREGISTREMENT, ...style }}
      animate={{ opacity: [1, 0.35, 1] }}
      transition={{ duration: 1.6, repeat: Infinity }}
    />
  );
}

export function EnregistrementCompact({ cfg, S, etat }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S * 0.62;
  const duree = useDureeDepuis(debutEnregistrement(etat));
  return (
    <>
      <PointRouge taille={ti} style={{ left: v(c.compactIconeXPt) * S + ti * 0.3, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          color: ROUGE_ENREGISTREMENT,
          left: undefined,
        })}
      >
        {formaterDuree(duree)}
      </div>
    </>
  );
}

export function EnregistrementMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S * 0.62;
  return <PointRouge taille={ti} style={{ left: v(c.compactIconeXPt) * S + ti * 0.3, top: (h - ti) / 2 }} />;
}

export function EnregistrementEtendu({ cfg, S, etat }: Ctx) {
  const c = cfg.minuteur;
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const y = v(c.etenduBoutonYPt) * S;
  const duree = useDureeDepuis(debutEnregistrement(etat));
  return (
    <>
      <PointRouge taille={diam * 0.55} style={{ left: gauche + diam * 0.22, top: y + diam * 0.22 }} />
      <div style={texte(c.etenduLibelle, S, { left: gauche + diam * 1.25, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S), color: "#ffffff" })}>
        Enregistrement de l'écran
      </div>
      <div
        style={texte(c.etenduChiffres, S, {
          right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
          top: haut(v(c.etenduBaselinePt), c.etenduChiffres, S),
          fontVariantNumeric: "tabular-nums",
          color: ROUGE_ENREGISTREMENT,
          fontSize: v(c.etenduChiffres.taillePt) * S * 0.7,
        })}
      >
        {formaterDuree(duree)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Menu de l'île (clic droit) : de gros boutons pour lancer les outils
// ---------------------------------------------------------------------------

/** Ferme le menu (le pont retire l'activité). */
export function fermerMenuIle() {
  window.dispatchEvent(new CustomEvent("ile-menu-fermer"));
}

const BOUTONS_MENU: { action: string; texte: string; icone: (t: number, c: string) => ReactNode; couleur: string }[] = [
  { action: "lanceur", texte: "Minuteur", icone: (t, c) => <IconeMinuteur taille={t} couleur={c} progression={1} />, couleur: "#ff8c2b" },
  { action: "chrono", texte: "Chrono", icone: (t, c) => <IconeChrono taille={t} couleur={c} />, couleur: "#ff9f0a" },
  { action: "chanson", texte: "Chanson", icone: (t, c) => <IconeNote taille={t} couleur={c} />, couleur: "#0a84ff" },
  { action: "etagere", texte: "Étagère", icone: (t, c) => <IconeDossier taille={t} couleur={c} />, couleur: "#64a8ff" },
  { action: "historique", texte: "Copiés", icone: (t, c) => <IconePressePapiers taille={t} couleur={c} />, couleur: "#bf5af2" },
  { action: "note", texte: "Note", icone: (t, c) => <IconeCrayon taille={t} couleur={c} />, couleur: "#ffd60a" },
  { action: "capture", texte: "Capture", icone: (t, c) => <IconeEcran taille={t} couleur={c} />, couleur: "#30d158" },
  { action: "ocr", texte: "Texte image", icone: (t, c) => <IconeTexteImage taille={t} couleur={c} />, couleur: "#64d2ff" },
  { action: "recherche", texte: "Recherche", icone: (t, c) => <IconeLoupe taille={t} couleur={c} />, couleur: "#ffd60a" },
  { action: "dessin", texte: "Dessin", icone: (t, c) => <IconeCrayon taille={t} couleur={c} />, couleur: "#0a84ff" },
  { action: "pipette", texte: "Pipette", icone: (t, c) => <IconePipette taille={t} couleur={c} />, couleur: "#ff9f0a" },
  { action: "reglages", texte: "Réglages", icone: (t, c) => <IconeReglages taille={t} couleur={c} />, couleur: "#98989f" },
];

const OUTIL_DU_MENU: Record<string, string> = { lanceur: "minuteur", historique: "copies", note: "note", recherche: "recherche", dessin: "dessin" };

function lancerAction(action: string) {
  if (action === "etagere") window.dispatchEvent(new CustomEvent("ile-ouvrir-etagere"));
  else if (action === "capture") void backend.ouvrirLien("ms-screenclip:");
  else if (action === "ocr") window.dispatchEvent(new CustomEvent("ile-ocr"));
  else if (action === "chrono") window.dispatchEvent(new CustomEvent("ile-chrono", { detail: "demarrer" }));
  else if (action === "pipette") void backend.pipette();
  else if (action in OUTIL_DU_MENU) {
    // Outil ouvert DANS l'île : le menu se referme, l'outil prend sa place.
    fermerMenuIle();
    window.dispatchEvent(new CustomEvent("ile-outil", { detail: OUTIL_DU_MENU[action] }));
    return;
  } else void backend.ileAction(action);
  if (action !== "etagere") fermerMenuIle();
}

export function MenuEtendu({ cfg, S }: Ctx) {
  const largeur = v(cfg.formesContenu.menu.taille.pt.largeur) * S;
  const hauteur = v(cfg.formesContenu.menu.taille.pt.hauteur) * S;
  const marge = 18 * S;
  const cellule = (largeur - 2 * marge) / 4;
  const rond = 38 * S;
  return (
    <div style={{ position: "absolute", left: marge, top: marge * 1.05, width: largeur - 2 * marge, height: hauteur - 1.6 * marge, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", alignContent: "start", rowGap: 8 * S }}>
      {BOUTONS_MENU.map((b) => (
        <button
          key={b.action}
          {...boutonIle(() => lancerAction(b.action))}
          style={{ flexDirection: "column", gap: 6 * S, width: cellule, color: "#fff", fontSize: 11.5 * S, fontWeight: 500, whiteSpace: "nowrap" }}
        >
          <span
            style={{
              width: rond,
              height: rond,
              borderRadius: rond,
              background: "#2c2c2e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {b.icone(rond * 0.5, b.couleur)}
          </span>
          {b.texte}
        </button>
      ))}
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", gap: 8 * S, marginTop: 2 * S }}>
        {/* Petit bouton : les ventilateurs (Asus Fan Control) dans l'île. */}
        <button
          {...boutonIle(() => {
            fermerMenuIle();
            window.dispatchEvent(new CustomEvent("ile-outil", { detail: "ventilateurs" }));
          })}
          title="Ventilateurs (Asus Fan Control)"
          style={{ width: 28 * S, height: 28 * S, borderRadius: 14 * S, background: "#2c2c2e" }}
        >
          <IconeVentilo taille={16 * S} couleur="#64d2ff" />
        </button>
        {/* Petit bouton : comptes à rebours (examens). */}
        <button
          {...boutonIle(() => {
            fermerMenuIle();
            window.dispatchEvent(new CustomEvent("ile-outil", { detail: "comptes" }));
          })}
          title="Comptes à rebours (examens)"
          style={{ width: 28 * S, height: 28 * S, borderRadius: 14 * S, background: "#2c2c2e" }}
        >
          <IconeCalendrier taille={15 * S} couleur="#ff9f0a" />
        </button>
        {(
          [
            ["maj", "Mise à jour"],
            ["cacher", "Cacher l'île"],
            ["quitter", "Quitter"],
          ] as const
        ).map(([action, texte]) => (
          <button
            key={action}
            {...boutonIle(() => {
              fermerMenuIle();
              if (action === "maj") window.dispatchEvent(new CustomEvent("ile-maj"));
              else if (action === "quitter") void backend.quitter();
              else void backend.ileAction(action);
            })}
            style={{ padding: `${5 * S}px ${12 * S}px`, borderRadius: 99, background: "#2c2c2e", color: action === "quitter" ? "#ff453a" : "#fff", fontSize: 11.5 * S, fontWeight: 500 }}
          >
            {texte}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MenuMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeReglages taille={ti} couleur="#98989f" style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

// ---------------------------------------------------------------------------
// Chronomètre (avec tours)
// ---------------------------------------------------------------------------

const ORANGE_CHRONO = "#ff9f0a";

export function tempsChrono(c: Donnees["chrono"], maintenant = Date.now()): number {
  if (!c) return 0;
  return c.cumulMs + (c.debutMs !== null ? maintenant - c.debutMs : 0);
}

/** « 1:23,4 » (dixièmes), « 1:02:03,4 ». */
export function formaterChrono(ms: number): string {
  const dixiemes = Math.floor(ms / 100) % 10;
  return `${formaterDuree(Math.floor(ms / 1000) * 1000)},${dixiemes}`;
}

function useChrono(c: Donnees["chrono"]): number {
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    if (!c || c.debutMs === null) return;
    const id = setInterval(() => setMaintenant(Date.now()), 100);
    return () => clearInterval(id);
  }, [c]);
  return tempsChrono(c, maintenant);
}

const actionChrono = (detail: string) => window.dispatchEvent(new CustomEvent("ile-chrono", { detail }));

export function ChronoCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  const t = useChrono(d.chrono);
  return (
    <>
      <IconeChrono taille={ti} couleur={ORANGE_CHRONO} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S * 0.9) / 2,
          fontVariantNumeric: "tabular-nums",
          color: ORANGE_CHRONO,
          left: undefined,
          fontSize: v(c.compactTexte.taillePt) * S * 0.9,
        })}
      >
        {formaterChrono(t).replace(/,\d$/, "")}
      </div>
    </>
  );
}

export function ChronoMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeChrono taille={ti} couleur={ORANGE_CHRONO} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

/** Comme l'app Horloge : Tour / Pause à gauche, temps en grand à droite, dernier tour dessous. */
export function ChronoEtendu({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const t = useChrono(d.chrono);
  const enCours = d.chrono?.debutMs !== null && d.chrono !== null;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const [xA, xB] = v(c.etenduBoutonXPt).map((x) => x * S);
  const y = v(c.etenduBoutonYPt) * S;
  const tours = d.chrono?.tours ?? [];
  return (
    <>
      <button
        {...boutonIle(() => actionChrono(enCours ? "pause" : "reprendre"))}
        style={{ position: "absolute", left: xA, top: y, width: diam, height: diam, borderRadius: diam, background: v(c.etenduBoutonPauseFond) }}
      >
        {enCours ? <IconePause taille={diam * 0.42} couleur={ORANGE_CHRONO} /> : <IconeLecture taille={diam * 0.42} couleur={ORANGE_CHRONO} />}
      </button>
      <button
        {...boutonIle(() => actionChrono(enCours ? "tour" : "arreter"))}
        style={{ position: "absolute", left: xB, top: y, width: diam, height: diam, borderRadius: diam, background: v(c.etenduBoutonAnnulerFond), color: "#fff", fontSize: diam * 0.26, fontWeight: 600 }}
      >
        {enCours ? "Tour" : <IconeFermer taille={diam * 0.42} couleur="#ffffff" />}
      </button>
      <div
        style={texte(c.etenduChiffres, S, {
          right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
          top: haut(v(c.etenduBaselinePt), c.etenduChiffres, S) - (tours.length ? 6 * S : 0),
          fontVariantNumeric: "tabular-nums",
          color: ORANGE_CHRONO,
          fontSize: v(c.etenduChiffres.taillePt) * S * 0.82,
        })}
      >
        {formaterChrono(t)}
      </div>
      {tours.length > 0 && (
        <div
          style={texte(c.etenduLibelle, S, {
            right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
            top: y + diam * 0.8,
            left: undefined,
            color: v(cfg.media.etendu.artiste.couleur),
            fontWeight: 400,
            fontSize: v(c.etenduLibelle.taillePt) * S * 0.75,
            fontVariantNumeric: "tabular-nums",
          })}
        >
          Tour {tours.length} : {formaterChrono(tours[tours.length - 1]! - (tours[tours.length - 2] ?? 0))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Horloge au survol (île au repos) : heure à droite, cadran à gauche
// ---------------------------------------------------------------------------

/** Heure actuelle, rafraîchie chaque seconde. */
function useMaintenant(): Date {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

const heureCourte = (d: Date) => d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", hour12: false }).replace(" h ", ":");

export function HorlogeCompact({ cfg, S, d }: Ctx) {
  const c = cfg.minuteur;
  const maintenant = useMaintenant();
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  const m = d.meteo;
  return (
    <>
      {m ? (
        // Météo à gauche (icône + température), l'heure à droite.
        <div style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: 0, height: h, display: "flex", alignItems: "center", gap: 3 * S }}>
          <IconeMeteo taille={ti * 0.95} code={m.code} jour={m.jour} />
          <span style={texte(c.compactTexte, S, { position: "static", color: "#ffffff", fontVariantNumeric: "tabular-nums" })}>{Math.round(m.temperature)}°</span>
        </div>
      ) : (
        <IconeHorloge taille={ti} couleur="#ffffff" heure={maintenant} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      )}
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          fontVariantNumeric: "tabular-nums",
          color: "#ffffff",
          left: undefined,
        })}
      >
        {heureCourte(maintenant)}
      </div>
    </>
  );
}

export function HorlogeMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const maintenant = useMaintenant();
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeHorloge taille={ti} couleur="#ffffff" heure={maintenant} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

/** Vue étendue : date à gauche (même place que « Minuteur »), heure en grand à droite. */
export function HorlogeEtendu({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const maintenant = useMaintenant();
  const jour = maintenant.toLocaleDateString("fr-CA", { weekday: "long" });
  const date = maintenant.toLocaleDateString("fr-CA", { day: "numeric", month: "long" });
  const gris = v(cfg.media.etendu.artiste.couleur);
  // Date alignée à gauche, là où sont les boutons du minuteur.
  const gauche = (v(c.etenduBoutonXPt)[0] ?? 0) * S;
  return (
    <>
      <div style={texte(c.etenduLibelle, S, { left: gauche, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S) - v(c.etenduLibelle.taillePt) * S * 0.62, color: "#ffffff" })}>
        {jour.charAt(0).toUpperCase() + jour.slice(1)}
      </div>
      <div style={texte(c.etenduLibelle, S, { left: gauche, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S) + v(c.etenduLibelle.taillePt) * S * 0.62, color: gris, fontWeight: 400 })}>
        {date}
      </div>
      <div
        style={texte(c.etenduChiffres, S, {
          right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
          top: haut(v(c.etenduBaselinePt), c.etenduChiffres, S),
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          color: "#ffffff",
        })}
      >
        {heureCourte(maintenant)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Alertes (forme mesurée sur « En charge 98 % »)
// ---------------------------------------------------------------------------

/** Cadenas qui s'ouvre (déverrouillage), avec un petit ressort comme sur iPhone. */
function CadenasQuiSouvre({ taille, couleur }: { taille: number; couleur: string }) {
  const [ouvert, setOuvert] = useState(0);
  useEffect(() => {
    const controle = animate(0, 1, {
      type: "spring",
      stiffness: 260,
      damping: 14,
      delay: 0.25,
      onUpdate: setOuvert,
    });
    return () => controle.stop();
  }, []);
  return <IconeCadenas taille={taille} couleur={couleur} ouvert={ouvert} />;
}

/** Valeur cliquable d'une alerte : copier un code (puis « Copié »), ouvrir un fichier. */
function BoutonAction({ action, style, children }: { action: NonNullable<ReturnType<typeof specAlerte>["action"]>; style: CSSProperties; children: string }) {
  const [fait, setFait] = useState(false);
  return (
    <div
      role="button"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (action.type === "demander") window.dispatchEvent(new CustomEvent("ile-demander", { detail: action.quoi }));
        else if (action.type === "copier") void backend.copierTexte(action.texte).then(() => setFait(true));
        else if (action.type === "ouvrir") void backend.ouvrirFichier(action.chemin);
        else if (action.type === "maj") {
          setFait(true);
          void backend.installerMaj(action.url).catch(() => setFait(false));
        } else void backend.ouvrirLien(action.url);
      }}
    >
      {fait ? (action.type === "maj" ? "Téléchargement…" : "Copié") : children}
    </div>
  );
}

/** Alerte : contenu à gauche et à droite de la caméra (voir alertes.ts). */
export function AlerteContenu(ctx: Ctx & { alerte: Alerte }) {
  const { cfg, S, alerte } = ctx;
  const a = cfg.alerte;
  const spec = specAlerte(alerte, cfg);
  const cotes = cotesAlerte(spec, cfg, mesureConfig(cfg));
  const h = v(cfg.formes.alerte.taille.pt.hauteur) * S;
  const ti = tailleIcone(cfg) * S;
  const blanc = v(a.texte.couleur);
  const couleurIcone = spec.couleurIcone ?? blanc;
  const icone = (() => {
    switch (spec.icone) {
      case "volume":
        return <IconeVolume taille={ti} couleur={couleurIcone} />;
      case "muet":
        return <IconeVolume taille={ti} couleur={couleurIcone} muet />;
      case "lune":
        return <IconeLune taille={ti} couleur={couleurIcone} />;
      case "cloche":
        return <IconeCloche taille={ti} couleur={couleurIcone} />;
      case "pressePapiers":
        return <IconePressePapiers taille={ti} couleur={couleurIcone} />;
      case "minuteur":
        return <IconeMinuteur taille={ti} couleur={couleurIcone} progression={0} />;
      case "soleil":
        return <IconeSoleil taille={ti} couleur={couleurIcone} />;
      case "majuscules":
        return <IconeMajuscules taille={ti} couleur={couleurIcone} />;
      case "numerique":
        return <IconeNumerique taille={ti} couleur={couleurIcone} />;
      case "usb":
        return <IconeUsb taille={ti} couleur={couleurIcone} />;
      case "casque":
        return <IconeCasque taille={ti} couleur={couleurIcone} />;
      case "clavier":
        return <IconeClavier taille={ti} couleur={couleurIcone} />;
      case "souris":
        return <IconeSouris taille={ti} couleur={couleurIcone} />;
      case "manette":
        return <IconeManette taille={ti} couleur={couleurIcone} />;
      case "telephone":
        return <IconeTelephone taille={ti} couleur={couleurIcone} />;
      case "bluetooth":
        return <IconeBluetooth taille={ti} couleur={couleurIcone} />;
      case "telechargement":
        return <IconeTelechargement taille={ti} couleur={couleurIcone} />;
      case "wifi":
        return <IconeWifi taille={ti} couleur={couleurIcone} />;
      case "wifiCoupe":
        return <IconeWifi taille={ti} couleur={couleurIcone} coupe />;
      case "oeil":
        return <IconeOeil taille={ti} couleur={couleurIcone} />;
      case "note":
        return <IconeNote taille={ti} couleur={couleurIcone} />;
      case "imprimante":
        return <IconeImprimante taille={ti} couleur={couleurIcone} />;
      case "bouclier":
        return <IconeBouclier taille={ti} couleur={couleurIcone} />;
      case "texteImage":
        return <IconeTexteImage taille={ti} couleur={couleurIcone} />;
      case "chrono":
        return <IconeChrono taille={ti} couleur={couleurIcone} />;
      case "pluie":
        return <IconePluie taille={ti} couleur={couleurIcone} />;
      case "pastille":
        return <div style={{ width: ti, height: ti, borderRadius: ti, background: couleurIcone, boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.55)" }} />;
      case "neige":
        return <IconeNeige taille={ti} couleur={couleurIcone} />;
      case "cadenas":
        return <CadenasQuiSouvre taille={ti} couleur={couleurIcone} />;
      case "ecran":
        return <IconeEcran taille={ti} couleur={couleurIcone} />;
      case "bureaux":
        return <IconeBureaux taille={ti} couleur={couleurIcone} />;
      case "hautParleur":
        return <IconeHautParleur taille={ti} couleur={couleurIcone} />;
      case "micro":
        return <IconeMicro taille={ti} couleur={couleurIcone} />;
      case "microCoupe":
        return <IconeMicro taille={ti} couleur={couleurIcone} coupe />;
      case "miseAJour":
        return <IconeMiseAJour taille={ti} couleur={couleurIcone} />;
      default:
        return null;
    }
  })();
  const xLibelle = v(a.texteXPt) * S + (icone ? ti + (spec.libelle ? ECART_ICONE_PT * S : 0) : 0);
  const droiteValeur = (v(a.batterieDroitePt) + (spec.batterie ? v(a.batterieLargeurPt) + v(a.ecartValeurBatteriePt) : 0)) * S;
  const ligne = (extra: CSSProperties) =>
    texte(a.texte, S, {
      top: haut(v(a.baselinePt), a.texte, S),
      overflow: "hidden",
      textOverflow: "ellipsis",
      paddingBottom: 2 * S,
      ...extra,
    });
  return (
    <>
      {icone && <div style={{ position: "absolute", left: v(a.texteXPt) * S, top: (h - ti) / 2, width: ti, height: ti }}>{icone}</div>}
      {spec.pochetteUrl && (
        <img
          src={spec.pochetteUrl}
          alt=""
          decoding="async"
          style={{
            position: "absolute",
            left: v(cfg.media.compact.pochetteXPt) * S,
            top: (h - hauteurMiniature(cfg) * S) / 2,
            width: hauteurMiniature(cfg) * S,
            height: hauteurMiniature(cfg) * S,
            objectFit: "cover",
            borderRadius: v(cfg.media.compact.pochetteRayonPt) * S,
          }}
        />
      )}
      {spec.miniature && (
        <img
          src={`data:image/png;base64,${spec.miniature}`}
          alt=""
          decoding="async"
          style={{
            position: "absolute",
            left: v(cfg.media.compact.pochetteXPt) * S,
            top: (h - hauteurMiniature(cfg) * S) / 2,
            width: largeurMiniature(cfg) * S,
            height: hauteurMiniature(cfg) * S,
            objectFit: "cover",
            borderRadius: v(cfg.media.compact.pochetteRayonPt) * S,
          }}
        />
      )}
      {spec.apercu &&
        (() => {
          const c = cadreApercu(spec.apercu, cfg);
          return (
            <img
              src={`data:image/png;base64,${spec.apercu}`}
              alt=""
              decoding="async"
              style={{
                position: "absolute",
                left: c.x * S,
                top: c.y * S,
                width: c.largeur * S,
                height: c.hauteur * S,
                objectFit: "cover",
                borderRadius: v(cfg.media.compact.pochetteRayonPt) * 1.6 * S,
              }}
            />
          );
        })()}
      {spec.libelle && <div style={ligne({ left: xLibelle, maxWidth: cotes.libelleMax * S })}>{spec.libelle}</div>}
      {spec.valeur && !spec.action && (
        <div
          style={ligne({
            right: droiteValeur,
            maxWidth: cotes.valeurMax * S,
            color: spec.couleurValeur ?? blanc,
            fontVariantNumeric: "tabular-nums",
          })}
        >
          {spec.valeur}
        </div>
      )}
      {spec.valeur && spec.action && (
        <BoutonAction
          action={spec.action}
          style={ligne({
            right: droiteValeur,
            maxWidth: cotes.valeurMax * S,
            color: spec.couleurValeur ?? blanc,
            fontVariantNumeric: "tabular-nums",
            pointerEvents: "auto",
            cursor: "pointer",
          })}
        >
          {spec.valeur}
        </BoutonAction>
      )}
      {spec.detailTitre && (
        <div
          style={texte(a.texte, S, {
            left: v(a.texteXPt) * S,
            top: haut(baselineDetail(cfg), a.texte, S),
            maxWidth: (largeurAlerte(spec, cfg, mesureConfig(cfg)) - 2 * v(a.texteXPt)) * S,
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingBottom: 2 * S,
          })}
        >
          {spec.detailTitre}
        </div>
      )}
      {spec.detail && (
        <div
          style={texte(a.texte, S, {
            left: v(a.texteXPt) * S,
            top: haut(baselineDetail(cfg, spec.detailTitre ? 1 : 0), a.texte, S),
            maxWidth: (largeurAlerte(spec, cfg, mesureConfig(cfg)) - 2 * v(a.texteXPt)) * S,
            color: spec.detailFort ? blanc : v(cfg.media.etendu.artiste.couleur),
            fontWeight: spec.detailFort ? v(a.texte.graisse) : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingBottom: 2 * S,
          })}
        >
          {spec.detail}
        </div>
      )}
      {spec.boutons && (
        // « Résumer · Corriger · Traduire » : petites pastilles sous la caméra.
        <div style={{ position: "absolute", left: v(a.texteXPt) * S, top: haut(baselineDetail(cfg), a.texte, S) - 4 * S, display: "flex", gap: 6 * S, pointerEvents: "auto" }}>
          {spec.boutons.map((b) => (
            <div
              key={b.texte}
              role="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("ile-demander", { detail: b.action.quoi }));
              }}
              style={texte(a.texte, S, { position: "static", padding: `${3 * S}px ${10 * S}px`, borderRadius: 99, background: "rgba(255,255,255,.14)", color: "#e08a5f", fontSize: v(a.texte.taillePt) * 0.9 * S, cursor: "pointer" })}
            >
              {b.texte}
            </div>
          ))}
        </div>
      )}
      {spec.detail && spec.boutonDetail && (
        // « Plus tard » : le clic n'est PAS arrêté, il atteint l'île, qui ferme l'alerte.
        <div
          role="button"
          style={texte(a.texte, S, {
            right: v(a.texteXPt) * S,
            top: haut(baselineDetail(cfg, spec.detailTitre ? 1 : 0), a.texte, S),
            color: v(cfg.media.etendu.artiste.couleur),
            pointerEvents: "auto",
            cursor: "pointer",
            left: undefined,
          })}
        >
          {spec.boutonDetail}
        </div>
      )}
      {spec.batterie && (
        <div style={{ position: "absolute", right: v(a.batterieDroitePt) * S, top: (h - v(a.batterieHauteurPt) * S) / 2 }}>
          <IconeBatterie
            largeur={v(a.batterieLargeurPt) * S}
            hauteur={v(a.batterieHauteurPt) * S}
            couleur={spec.batterie.couleur}
            niveau={spec.batterie.niveau}
            enCharge={spec.batterie.enCharge}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Appel en cours (Teams, Discord, Zoom…)
// ---------------------------------------------------------------------------

/** Durée de l'appel, rafraîchie chaque seconde seulement quand l'appel est affiché. */
function useDureeAppel(d: Donnees): number {
  const [, forcer] = useState(0);
  useEffect(() => {
    if (!d.appel) return;
    const id = setInterval(() => forcer((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [d.appel]);
  return d.appel ? Date.now() - d.appel.debutMs : 0;
}

/** Vert de l'appel : le vert mesuré (V4731). */
const vertAppel = (cfg: IslandConfig) => v(cfg.indicateurs.cameraCouleur);

export function AppelCompact({ cfg, S, d }: Ctx) {
  const duree = useDureeAppel(d);
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return (
    <>
      <IconeTelephone taille={ti} couleur={vertAppel(cfg)} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />
      <div
        style={texte(c.compactTexte, S, {
          right: v(c.compactTexteDroitePt) * S,
          top: (h - v(c.compactTexte.taillePt) * S) / 2,
          color: vertAppel(cfg),
          fontVariantNumeric: "tabular-nums",
        })}
      >
        {formaterDuree(duree)}
      </div>
    </>
  );
}

export function AppelMinimal({ cfg, S }: Ctx) {
  const c = cfg.minuteur;
  const h = v(cfg.formes.compact.taille.pt.hauteur) * S;
  const ti = v(c.compactIconeTaillePt) * S;
  return <IconeTelephone taille={ti} couleur={vertAppel(cfg)} style={{ position: "absolute", left: v(c.compactIconeXPt) * S, top: (h - ti) / 2 }} />;
}

/** Vue étendue : même disposition que le minuteur étendu (mesuré V4729). */
export function AppelEtendu({ cfg, S, d }: Ctx) {
  const duree = useDureeAppel(d);
  const c = cfg.minuteur;
  const diam = v(c.etenduBoutonDiametrePt) * S;
  const [xMicro] = v(c.etenduBoutonXPt).map((x) => x * S);
  const y = v(c.etenduBoutonYPt) * S;
  const muet = d.appel?.muet ?? false;
  return (
    <>
      <button
        className="bouton-ile"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void backend.microMuet(!muet).then((m) => d.appel && majDonnees({ appel: { ...d.appel, muet: Boolean(m) } }));
        }}
        style={{
          position: "absolute",
          left: xMicro,
          top: y,
          width: diam,
          height: diam,
          borderRadius: diam,
          background: muet ? "#ffffff" : v(c.etenduBoutonAnnulerFond),
        }}
        title={muet ? "Rétablir le micro" : "Couper le micro"}
      >
        <IconeMicro taille={diam * 0.46} couleur={muet ? "#000000" : "#ffffff"} coupe={muet} />
      </button>
      <div style={texte(c.etenduLibelle, S, { left: v(c.etenduLibelleXPt) * S, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S), color: vertAppel(cfg) })}>
        {d.appel?.application ?? "Appel"}
      </div>
      <div
        style={texte(c.etenduChiffres, S, {
          right: (v(cfg.formesContenu.etenduMinuteur.taille.pt.largeur) - v(c.etenduChiffresDroitePt)) * S,
          top: haut(v(c.etenduBaselinePt), c.etenduChiffres, S),
          color: vertAppel(cfg),
          fontVariantNumeric: "tabular-nums",
        })}
      >
        {formaterDuree(duree)}
      </div>
    </>
  );
}
