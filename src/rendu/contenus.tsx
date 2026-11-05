/**
 * Contenus de l'île. Toutes les positions et tailles viennent de island.config.ts
 * (en points, convertis en px CSS = DIP avec ISLAND_SCALE).
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE } from "react";
import { backend } from "../bridge/backend";
import { formaterDuree, formaterMinuteurCompact, positionActuelle, type Donnees, type PressePapiers } from "../bridge/donnees";
import type { EtatBatterie, EtatMinuteur, EtatNePasDeranger, EtatVolume, Notification } from "../bridge/types";
import type { IslandConfig, Texte } from "../island.config";
import type { Alerte, EtatMachine } from "../state/islandMachine";
import { v } from "../config/store";
import {
  IconeBatterie,
  IconeCloche,
  IconeFermer,
  IconeLecture,
  IconeLune,
  IconeMinuteur,
  IconeOuvrir,
  IconePause,
  IconePressePapiers,
  IconeSaut,
  IconeSource,
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

function texte(t: Texte, S: number, extra: CSSProperties = {}): CSSProperties {
  return {
    position: "absolute",
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

/** Onde sonore : barres animées (CSS, coût CPU quasi nul) à la couleur de la pochette. */
function Onde(props: {
  n: number;
  largeurBarre: number;
  pas: number;
  hMin: number;
  hMax: number;
  couleur: string;
  enLecture: boolean;
  style: CSSProperties;
}) {
  const { n, largeurBarre, pas, hMin, hMax, couleur, enLecture, style } = props;
  return (
    <div style={{ position: "absolute", height: hMax, width: (n - 1) * pas + largeurBarre, ...style }}>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className={enLecture ? "onde-barre" : undefined}
          style={{
            position: "absolute",
            left: i * pas,
            top: (hMax - hMin) / 2,
            width: largeurBarre,
            height: hMin,
            borderRadius: largeurBarre,
            background: couleur,
            // Hauteurs et rythmes différents par barre (aléatoire stable).
            ["--h" as string]: `${(0.45 + 0.55 * ((i * 37) % 11) / 10) * (hMax / hMin)}`,
            animationDuration: `${0.42 + ((i * 53) % 7) * 0.06}s`,
            animationDelay: `${-((i * 29) % 9) * 0.07}s`,
          }}
        />
      ))}
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
      <Bouton x={xs[2]!} y={y} taille={tLecture * 1.3} onClick={() => void backend.lecturePause()} desactive={!m?.peutLirePause}>
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
      <div style={texte(c.etenduLibelle, S, { left: v(c.etenduLibelleXPt) * S, top: haut(v(c.etenduBaselinePt), c.etenduLibelle, S) })}>
        Minuteur
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

function LigneAlerte({
  cfg,
  S,
  icone,
  libelle,
  valeur,
  couleurValeur,
  droite,
}: Ctx & { icone?: React.ReactNode; libelle: string; valeur?: string; couleurValeur?: string; droite?: React.ReactNode }) {
  const a = cfg.alerte;
  const L = v(cfg.formes.alerte.taille.pt.largeur) * S;
  const h = v(cfg.formes.alerte.taille.pt.hauteur) * S;
  const ti = v(a.texte.taillePt) * S * 1.15;
  const xTexte = v(a.texteXPt) * S + (icone ? ti + 6 * S : 0);
  return (
    <>
      {icone && <div style={{ position: "absolute", left: v(a.texteXPt) * S, top: (h - ti) / 2, width: ti, height: ti }}>{icone}</div>}
      <div
        style={texte(a.texte, S, {
          left: xTexte,
          top: haut(v(a.baselinePt), a.texte, S),
          maxWidth: L * 0.55,
          overflow: "hidden",
          textOverflow: "ellipsis",
          paddingBottom: 2 * S,
        })}
      >
        {libelle}
      </div>
      {valeur && (
        <div
          style={texte(a.texte, S, {
            right: v(a.valeurDroitePt) * S,
            top: haut(v(a.baselinePt), a.texte, S),
            color: couleurValeur ?? v(a.texte.couleur),
            maxWidth: L * 0.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingBottom: 2 * S,
          })}
        >
          {valeur}
        </div>
      )}
      {droite}
    </>
  );
}

export function AlerteContenu(ctx: Ctx & { alerte: Alerte }) {
  const { cfg, S, alerte } = ctx;
  const a = cfg.alerte;
  const h = v(cfg.formes.alerte.taille.pt.hauteur) * S;
  const blanc = v(a.texte.couleur);
  const ti = v(a.texte.taillePt) * S * 1.15;
  const batterie = (b: EtatBatterie, couleur: string) => (
    <div style={{ position: "absolute", right: v(a.batterieDroitePt) * S, top: (h - v(a.batterieHauteurPt) * S) / 2 }}>
      <IconeBatterie
        largeur={v(a.batterieLargeurPt) * S}
        hauteur={v(a.batterieHauteurPt) * S}
        couleur={couleur}
        niveau={(b.pourcentage ?? 100) / 100}
        enCharge={b.branche}
      />
    </div>
  );

  switch (alerte.type) {
    case "chargeur": {
      const b = alerte.donnees as EtatBatterie;
      const pct = b.pourcentage !== null ? `${b.pourcentage} %` : undefined;
      const couleur = b.branche ? v(a.batterieCouleur) : blanc;
      return (
        <LigneAlerte
          {...ctx}
          libelle={b.branche ? "En charge" : "Sur batterie"}
          valeur={pct}
          couleurValeur={b.branche ? v(a.valeurCouleur) : blanc}
          droite={batterie(b, couleur)}
        />
      );
    }
    case "batterie": {
      const b = alerte.donnees as EtatBatterie;
      return (
        <LigneAlerte
          {...ctx}
          libelle="Batterie faible"
          valeur={`${b.pourcentage ?? "?"} %`}
          couleurValeur={v(a.batterieFaibleCouleur)}
          droite={batterie(b, v(a.batterieFaibleCouleur))}
        />
      );
    }
    case "volume": {
      const vol = alerte.donnees as EtatVolume;
      return (
        <LigneAlerte
          {...ctx}
          icone={<IconeVolume taille={ti} couleur={blanc} muet={vol.muet} />}
          libelle={vol.muet ? "Son coupé" : "Volume"}
          valeur={vol.muet ? undefined : `${Math.round(vol.niveau * 100)} %`}
        />
      );
    }
    case "neDerangePas": {
      const n = alerte.donnees as EtatNePasDeranger;
      return (
        <LigneAlerte
          {...ctx}
          icone={<IconeLune taille={ti} couleur={blanc} />}
          libelle="Ne pas déranger"
          valeur={n.actif ? "Activé" : "Désactivé"}
        />
      );
    }
    case "notification": {
      const n = alerte.donnees as Notification;
      return (
        <LigneAlerte
          {...ctx}
          icone={<IconeCloche taille={ti} couleur={blanc} />}
          libelle={n.application || "Notification"}
          valeur={n.textes[0]}
        />
      );
    }
    case "pressePapiers": {
      const p = alerte.donnees as PressePapiers;
      const libelles = { texte: "Texte copié", image: "Image copiée", fichiers: "Fichiers copiés", autre: "Copié" };
      return (
        <LigneAlerte
          {...ctx}
          icone={<IconePressePapiers taille={ti} couleur={blanc} />}
          libelle={libelles[p.type]}
          valeur={p.apercu}
          couleurValeur={v(cfg.media.etendu.artiste.couleur)}
        />
      );
    }
    case "minuteurTermine":
      return (
        <LigneAlerte
          {...ctx}
          icone={<IconeMinuteur taille={ti} couleur={v(cfg.minuteur.couleur)} progression={0} />}
          libelle="Minuteur"
          valeur="Terminé"
          couleurValeur={v(cfg.minuteur.couleur)}
        />
      );
  }
}
