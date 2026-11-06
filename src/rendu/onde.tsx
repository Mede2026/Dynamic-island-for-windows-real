/**
 * Onde sonore de la musique, pilotée par le VRAI niveau sonore de Windows
 * (compteur de crête, lu 30 fois/s seulement quand une onde est visible et que ça joue).
 * Chaque barre suit le niveau avec un léger retard différent → une vague naturelle ;
 * un ressort adoucit chaque barre. En pause : de petits points (comme sur iPhone).
 * Musique de test, navigateur, ou niveau sonore introuvable (aucun relevé reçu) : rythme simulé.
 */

import { motion, motionValue, useSpring, type MotionValue } from "framer-motion";
import { useEffect, useMemo, type CSSProperties } from "react";
import { backend, dansTauri } from "../bridge/backend";
import { estMusiqueDeTest } from "../demo/scenarios";
import { preferencesActuelles } from "../config/store";

/** Derniers niveaux reçus (0–1), du plus récent au plus ancien. */
const historique: number[] = new Array(12).fill(0);
/** Change à chaque nouveau niveau (les barres s'y abonnent). */
const tic = motionValue(0);

function pousser(n: number) {
  historique.pop();
  historique.unshift(Math.min(Math.max(n, 0), 1));
  tic.set(tic.get() + 1);
}

/** Dernier relevé du backend (ms) : sans relevé, l'onde passe au rythme simulé. */
let dernierReleve = -Infinity;
const SECOURS_MS = 1500;

/** Appelé par le pont à chaque niveau reçu du backend. */
export function recevoirNiveau(n: number) {
  dernierReleve = performance.now();
  arreterSimulation();
  pousser(n);
}

// Demandes d'ondes visibles (plusieurs ondes peuvent coexister pendant une transition).
let demandes = 0;
let simulation: ReturnType<typeof setInterval> | null = null;
let surveillance: ReturnType<typeof setTimeout> | null = null;

function lancerSimulation() {
  if (simulation) return;
  // Rythme simulé (~120 BPM avec variations).
  let t = 0;
  simulation = setInterval(() => {
    t += 1 / 30;
    const temps = (t * 2) % 1;
    pousser(0.35 + 0.45 * Math.exp(-temps * 6) + 0.15 * Math.random());
  }, 33);
}
function arreterSimulation() {
  if (simulation) clearInterval(simulation);
  simulation = null;
}

function demander(actif: boolean) {
  demandes += actif ? 1 : -1;
  const reel = dansTauri() && !estMusiqueDeTest();
  if (reel) void backend.niveauAudio(demandes > 0);
  if (surveillance) clearTimeout(surveillance);
  surveillance = null;
  if (demandes <= 0) return arreterSimulation();
  if (!reel) return lancerSimulation();
  arreterSimulation();
  // Le backend ne répond pas (pas de sortie audio lisible) : rythme simulé plutôt qu'une onde morte.
  const debut = performance.now();
  surveillance = setTimeout(() => {
    surveillance = null;
    if (demandes > 0 && dernierReleve < debut) lancerSimulation();
  }, SECOURS_MS);
}

/** Forme de l'onde : poids et retard (en relevés) de chaque barre. */
const POIDS = [0.62, 0.86, 1, 0.94, 0.78, 0.6];
const RETARDS = [3, 1, 0, 2, 4, 6];

function Barre({ i, hMin, hMax, enLecture, style }: { i: number; hMin: number; hMax: number; enLecture: boolean; style: CSSProperties }) {
  const cible = useMemo(() => motionValue(hMin), [hMin]);
  const hauteur: MotionValue<number> = useSpring(cible, { stiffness: 520, damping: 26, mass: 0.6 });
  useEffect(() => {
    if (!enLecture) {
      cible.set(hMin);
      return;
    }
    return tic.on("change", () => {
      const n = historique[RETARDS[i % RETARDS.length]!] ?? 0;
      // Racine : les sons faibles restent visibles, les forts ne saturent pas.
      const k = Math.min(Math.sqrt(n) * 1.15 * (POIDS[i % POIDS.length] ?? 1), 1);
      cible.set(hMin + (hMax - hMin) * k);
    });
  }, [enLecture, cible, hMin, hMax, i]);
  return <motion.div style={{ ...style, height: hauteur }} />;
}

export function Onde(props: {
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
  const visible = preferencesActuelles().onde !== false;
  useEffect(() => {
    if (!visible || !enLecture) return;
    demander(true);
    return () => demander(false);
  }, [visible, enLecture]);
  if (!visible) return null;
  return (
    <div style={{ position: "absolute", height: hMax, width: (n - 1) * pas + largeurBarre, display: "flex", alignItems: "center", ...style }}>
      {Array.from({ length: n }, (_, i) => (
        <Barre
          key={i}
          i={i}
          hMin={Math.max(hMin, largeurBarre)}
          hMax={hMax}
          enLecture={enLecture}
          style={{
            position: "absolute",
            left: i * pas,
            width: largeurBarre,
            borderRadius: largeurBarre,
            background: couleur,
          }}
        />
      ))}
    </div>
  );
}
