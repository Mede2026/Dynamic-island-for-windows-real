/**
 * Outils ouverts DANS l'île (recherche, minuteur rapide, copiés récemment, note), sur le
 * modèle de la recherche du Mac : l'île devient une barre en PILULE (titre ou champ), et une
 * CARTE séparée apparaît dessous (même largeur, verre sombre, coins arrondis). Une poignée en
 * bas de la carte se tire pour l'agrandir ou la réduire (taille libre, retenue par outil).
 */

import { motion } from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { IslandConfig } from "../island.config";
import type { EtatMachine } from "../state/islandMachine";
import { v } from "../config/store";
import { Lanceur } from "../lanceur/Lanceur";
import { Historique } from "../historique/Historique";
import { Note } from "../note/Note";
import { TemperaturePilule, Ventilateurs } from "../ventilateurs/Ventilateurs";
import { Comptes } from "../comptes/Comptes";
import { Dessin } from "../dessin/Dessin";
import {
  CarteRecherche,
  PiluleRecherche,
  carteRechercheVisible,
  definirFermeture,
  hauteurAutoRecherche,
  piluleDeuxLignes,
  useRecherche,
  IconeEtincelle,
} from "../recherche/RechercheIle";
import { IconeCrayon, IconeMinuteur, IconePressePapiers } from "./icones";
import type { Ctx } from "./contenus";

export type NomOutil = "recherche" | "minuteur" | "copies" | "note" | "ventilateurs" | "comptes" | "dessin";

const OUTILS: Record<NomOutil, { titre: string; couleur: string; hauteur: number }> = {
  recherche: { titre: "Recherche", couleur: "#ffd60a", hauteur: 0 },
  minuteur: { titre: "Minuteur", couleur: "#ff8c2b", hauteur: 176 },
  copies: { titre: "Copiés récemment", couleur: "#bf5af2", hauteur: 268 },
  note: { titre: "Note", couleur: "#ffd60a", hauteur: 250 },
  ventilateurs: { titre: "Ventilateurs", couleur: "#64d2ff", hauteur: 224 },
  comptes: { titre: "Comptes à rebours", couleur: "#ff9f0a", hauteur: 236 },
  dessin: { titre: "Tableau blanc", couleur: "#0a84ff", hauteur: 0 },
};

/**
 * Mesures relevées sur les vidéos de la recherche du Mac, rapportées à une largeur de 374 pt
 * (« pt de dessin »). Tout est ensuite agrandi du MÊME facteur K jusqu'à 600 pt de large :
 * les proportions (hauteur de la pilule, lignes, icônes, texte, carte) restent celles de la vidéo.
 */
export const LARGEUR_DESSIN = 374.24;
export const K = 600 / LARGEUR_DESSIN;
const DESSIN = { pilule: 58, piluleDeuxLignes: 68, ecart: 8, rayonCarte: 22 };
/** En pt de l'île (déjà agrandis par K). */
export const PILULE = {
  hauteurPt: DESSIN.pilule * K,
  hauteurDeuxLignesPt: DESSIN.piluleDeuxLignes * K,
  ecartCartePt: DESSIN.ecart * K,
  rayonCartePt: DESSIN.rayonCarte * K,
};
export const CARTE_MIN_PT = 110 * K;
export const CARTE_MAX_PT = 600;

export function estOutil(x: unknown): x is NomOutil {
  return typeof x === "string" && x in OUTILS;
}

export function outilOuvert(e: EtatMachine): NomOutil | null {
  const a = e.activites.find((x) => x.type === "outil");
  const nom = (a?.donnees as { outil?: unknown } | undefined)?.outil;
  return estOutil(nom) ? nom : null;
}

/** Ferme l'outil ouvert (pont.ts écoute cet événement). */
export function fermerOutil() {
  window.dispatchEvent(new CustomEvent("ile-outil-fermer"));
}
definirFermeture(fermerOutil);

/** Hauteur de la pilule (pt) : 2 lignes quand le texte est une question. */
export function hauteurPilule(e: EtatMachine): number {
  return outilOuvert(e) === "recherche" && piluleDeuxLignes() ? PILULE.hauteurDeuxLignesPt : PILULE.hauteurPt;
}

// ---------------------------------------------------------------------------
// Carte : hauteur (libre, tirée à la main) et zone touchable, partagées avec l'île
// ---------------------------------------------------------------------------

let carte: { visible: boolean; hauteur: number; glisse: boolean; largeur?: number } = { visible: false, hauteur: 0, glisse: false };
const abonnes = new Set<() => void>();
function majCarte(p: Partial<typeof carte>) {
  carte = { ...carte, ...p };
  abonnes.forEach((f) => f());
}
export function useCarte() {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => carte,
  );
}

const cleHauteur = (o: NomOutil) => `ile-carte-${o}`;
function hauteurRetenue(o: NomOutil): number | null {
  const n = Number(localStorage.getItem(cleHauteur(o)));
  return Number.isFinite(n) && n > 0 ? n : null;
}
const borner = (h: number) => Math.min(CARTE_MAX_PT, Math.max(CARTE_MIN_PT, h));

// ---------------------------------------------------------------------------
// Dans l'île : la pilule
// ---------------------------------------------------------------------------

export function OutilEtendu({ cfg, S, etat }: Ctx) {
  const nom = outilOuvert(etat);
  if (!nom) return null;
  void cfg;
  const h = hauteurPilule(etat) / K; // en pt de dessin
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "absolute", left: 0, top: 0, width: LARGEUR_DESSIN, height: h, zoom: S * K, pointerEvents: "auto", color: "#fff", cursor: "default" }}
    >
      {nom === "recherche" ? <PiluleRecherche hauteur={h} /> : <PiluleTitre nom={nom} />}
    </div>
  );
}

function PiluleTitre({ nom }: { nom: NomOutil }) {
  const { titre, couleur } = OUTILS[nom];
  const icone: Record<NomOutil, ReactNode> = {
    recherche: <IconeEtincelle taille={18} couleur={couleur} />,
    minuteur: <IconeMinuteur taille={18} couleur={couleur} progression={1} />,
    copies: <IconePressePapiers taille={18} couleur={couleur} />,
    note: <IconeCrayon taille={18} couleur={couleur} />,
    ventilateurs: <IconeVentilo taille={18} couleur={couleur} />,
    comptes: <IconeCalendrier taille={18} couleur={couleur} />,
    dessin: <IconeCrayon taille={18} couleur={couleur} />,
  };
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 20px 0 22px" }}>
      {icone[nom]}
      <span style={{ fontSize: 15, fontWeight: 500, flex: 1 }}>{titre}</span>
      {nom === "ventilateurs" ? <TemperaturePilule /> : <span style={{ fontSize: 12, color: "rgba(255,255,255,.45)" }}>Échap</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous l'île : la carte (verre sombre) avec sa poignée
// ---------------------------------------------------------------------------

/** Le verre : du gris très sombre en haut au gris clair en bas, liseré clair, grande ombre douce. */
export const VERRE_CARTE: CSSProperties = {
  background: "linear-gradient(180deg, rgba(34,34,36,.97) 0%, rgba(48,48,51,.96) 38%, rgba(92,92,97,.95) 78%, rgba(128,128,134,.94) 100%)",
  boxShadow:
    "inset 0 0.5px 0 rgba(255,255,255,.30), inset 0 0 0 0.5px rgba(255,255,255,.10), inset 0 -0.5px 0 rgba(255,255,255,.16), 0 16px 38px rgba(0,0,0,.42), 0 2px 8px rgba(0,0,0,.25)",
};

export function CarteOutil({ cfg, S, etat, gauche, haut, ecran }: { cfg: IslandConfig; S: number; etat: EtatMachine; gauche: number; haut: number; ecran: [number, number] }) {
  const nom = outilOuvert(etat);
  const r = useRecherche();
  const largeur = v(cfg.formesContenu.outil.taille.pt.largeur);
  const [tiree, setTiree] = useState<number | null>(() => (nom ? hauteurRetenue(nom) : null));
  const glisse = useRef<{ y: number; h: number } | null>(null);
  const [glissement, setGlissement] = useState(false);

  useEffect(() => setTiree(nom ? hauteurRetenue(nom) : null), [nom]);
  // « Agrandir » (conversation) : la carte prend toute la hauteur permise, ou revient.
  useEffect(() => {
    const agrandir = () => setTiree((t) => (t !== null && t >= CARTE_MAX_PT - 1 ? null : CARTE_MAX_PT));
    window.addEventListener("ile-carte-agrandir", agrandir);
    return () => window.removeEventListener("ile-carte-agrandir", agrandir);
  }, []);

  const visible = nom !== null && (nom !== "recherche" || carteRechercheVisible(r));
  const auto = (nom === "recherche" ? hauteurAutoRecherche(r) : nom ? OUTILS[nom].hauteur : 0) * K;
  const hauteur = borner(tiree ?? auto);

  // Tableau blanc : presque tout l'écran (la fenêtre de l'île s'agrandit pour lui).
  const dessin = nom === "dessin";
  const marge = 40;
  const largeurDessin = Math.max(400, ecran[0] - 2 * marge);
  const hauteurDessin = Math.max(300, ecran[1] - haut - 28);

  useEffect(() => {
    if (dessin) majCarte({ visible: true, hauteur: hauteurDessin / S, largeur: largeurDessin / S });
    else majCarte({ visible, hauteur: visible ? hauteur : 0, largeur: undefined });
  }, [visible, hauteur, dessin, largeurDessin, hauteurDessin, S]);
  useEffect(() => () => majCarte({ visible: false, hauteur: 0, largeur: undefined }), []);

  if (!nom || !visible) return null;

  if (dessin) {
    return (
      <motion.div
        key="dessin"
        initial={{ opacity: 0, scale: 0.97, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
        transition={{ type: "spring", stiffness: 380, damping: 32, opacity: { duration: 0.15 } }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", left: (ecran[0] - largeurDessin) / 2, top: haut, width: largeurDessin, height: hauteurDessin, borderRadius: PILULE.rayonCartePt * S, overflow: "hidden", pointerEvents: "auto", transformOrigin: "50% 0%", ...VERRE_CARTE }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: largeurDessin / S, height: hauteurDessin / S, zoom: S, padding: 14, boxSizing: "border-box" }}>
          <Dessin />
        </div>
      </motion.div>
    );
  }

  const contenu =
    nom === "recherche" ? <CarteRecherche /> : nom === "ventilateurs" ? <Ventilateurs /> : nom === "comptes" ? <Comptes /> : nom === "minuteur" ? <Lanceur fermer={fermerOutil} dansIle /> : nom === "copies" ? <Historique fermer={fermerOutil} dansIle /> : <Note fermer={fermerOutil} dansIle />;

  return (
    <motion.div
      key={nom}
      // Apparition mesurée (Mac) : un peu plus grande puis se pose en ~0,12 s ; la hauteur suit
      // le contenu en ~0,2 s ; pendant qu'on tire la poignée, elle suit la souris sans ressort.
      initial={{ opacity: 0, scale: 1.035, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0, height: hauteur * S }}
      exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.14 } }}
      transition={{
        default: { type: "spring", stiffness: 420, damping: 32 },
        opacity: { duration: 0.12 },
        height: glissement ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 34 },
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: gauche,
        top: haut,
        width: largeur * S,
        borderRadius: PILULE.rayonCartePt * S,
        overflow: "hidden",
        pointerEvents: "auto",
        transformOrigin: "50% 0%",
        ...VERRE_CARTE,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: LARGEUR_DESSIN, height: hauteur / K, zoom: S * K, color: "#fff" }}>
        <div style={{ position: "absolute", inset: nom === "recherche" ? 0 : "14px 16px 18px", ...(nom === "recherche" ? {} : { display: "flex", flexDirection: "column" }) }}>
          {contenu}
        </div>
        {/* Poignée : on la tire pour agrandir (taille libre) ; double-clic = taille de départ. */}
        <div
          title="Tirer pour agrandir"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            glisse.current = { y: e.clientY, h: hauteur };
            setGlissement(true);
            majCarte({ glisse: true });
          }}
          onPointerMove={(e) => {
            const g = glisse.current;
            if (!g) return;
            setTiree(borner(g.h + (e.clientY - g.y) / S));
          }}
          onPointerUp={() => {
            glisse.current = null;
            setGlissement(false);
            majCarte({ glisse: false });
            setTiree((t) => {
              if (t !== null) localStorage.setItem(cleHauteur(nom), String(Math.round(t)));
              return t;
            });
          }}
          onDoubleClick={() => {
            localStorage.removeItem(cleHauteur(nom));
            setTiree(null);
          }}
          style={{ position: "absolute", left: "50%", bottom: 0, width: 64, height: 14, marginLeft: -32, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ width: glissement ? 44 : 36, height: 5, borderRadius: 3, background: glissement ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.42)", transition: "all .15s" }} />
        </div>
      </div>
    </motion.div>
  );
}

/** Hélice à trois pales (ventilateurs). */
export function IconeVentilo({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true" fill={couleur}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.6c-.6-3.2.4-6.1 3-6.6 2.4-.4 3.6 2.2 2 4.2-1.2 1.5-3 2.1-5 2.4z" />
      <path d="M14.1 13.2c3.1-1 6.1-.4 6.9 2.1.7 2.3-1.7 3.9-3.9 2.6-1.7-1-2.6-2.7-3-4.7z" />
      <path d="M9.9 13.2c-2.5 2.2-5.4 3-7.1 1-1.5-1.9.3-4.2 2.8-3.9 1.9.3 3.4 1.4 4.3 2.9z" />
    </svg>
  );
}

/** Calendrier (comptes à rebours). */
export function IconeCalendrier({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={couleur} strokeWidth="2" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.4" fill={couleur} stroke="none" />
    </svg>
  );
}

/** Pipette (couleur à l'écran). */
export function IconePipette({ taille, couleur }: { taille: number; couleur: string }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={couleur} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 6.5l3 3M4 20l1.5-.5L15.8 9.2l-1-1L4.5 18.5zM13.2 4.8a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4l-1.4 1.4-6-6z" />
    </svg>
  );
}
