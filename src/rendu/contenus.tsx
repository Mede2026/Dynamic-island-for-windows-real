/**
 * Contenus de l'île. Toutes les positions et tailles viennent de island.config.ts
 * (en points, convertis en px CSS = DIP avec ISLAND_SCALE).
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE } from "react";
import { backend } from "../bridge/backend";
import { formaterDuree, formaterMinuteurCompact, majDonnees, positionActuelle, type Donnees } from "../bridge/donnees";
import type { EtatMinuteur } from "../bridge/types";
import type { IslandConfig, Texte } from "../island.config";
import { cotesAlerte, ECART_ICONE_PT, hauteurMiniature, largeurMiniature, mesureConfig, specAlerte, tailleIcone } from "./alertes";
import type { Alerte, EtatMachine } from "../state/islandMachine";
import { v } from "../config/store";
import { Onde } from "./onde";
import { basculerMusiqueDeTest, estMusiqueDeTest } from "../demo/scenarios";
import {
  IconeBatterie,
  IconeCloche,
  IconeFermer,
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

function texte(t: Texte, S: number, extra: CSSProperties = {}): CSSProperties {
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

export function MusiqueCompact({ cfg, S, d }: Ctx) {
  const c = cfg.media.compact;
  const e = cfg.media.etendu;
  const largeur = v(cfg.formesContenu.compactDeuxCotes.taille.pt.largeur) * S;
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
    </>
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
// Alertes (forme mesurée sur « En charge 98 % »)
// ---------------------------------------------------------------------------

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
      {spec.libelle && <div style={ligne({ left: xLibelle, maxWidth: cotes.libelleMax * S })}>{spec.libelle}</div>}
      {spec.valeur && (
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
