/**
 * Icônes ORIGINALES (formes géométriques simples dessinées pour ce projet).
 * Aucune icône ni aucun asset Apple n'est copié.
 */

import { useEffect, useRef, type CSSProperties } from "react";

interface P {
  taille: number;
  couleur: string;
  style?: CSSProperties;
}

export function IconeLecture({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill={couleur} />
    </svg>
  );
}

export function IconePause({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <rect x="5" y="3" width="5" height="18" rx="1.6" fill={couleur} />
      <rect x="14" y="3" width="5" height="18" rx="1.6" fill={couleur} />
    </svg>
  );
}

/** Double triangle (suivant / précédent avec `inverse`). */
export function IconeSaut({ taille, couleur, style, inverse }: P & { inverse?: boolean }) {
  return (
    <svg width={taille} height={taille * 0.62} viewBox="0 0 30 18.6" style={style} aria-hidden="true">
      <g transform={inverse ? "translate(30 0) scale(-1 1)" : undefined} fill={couleur}>
        <path d="M1 2.2v14.2a1 1 0 0 0 1.55.83L13.6 10.1a1 1 0 0 0 0-1.66L2.55 1.37A1 1 0 0 0 1 2.2z" />
        <path d="M15 2.2v14.2a1 1 0 0 0 1.55.83L27.6 10.1a1 1 0 0 0 0-1.66L16.55 1.37A1 1 0 0 0 15 2.2z" />
      </g>
    </svg>
  );
}

/** Flèche « ouvrir l'application ». */
export function IconeOuvrir({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="3.5" y="5.5" width="15" height="15" rx="3.5" stroke={couleur} strokeWidth="1.8" />
      <path d="M11 13 20.5 3.5M14 3.5h6.5V10" stroke={couleur} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Haut-parleur (changer de source). */
export function IconeSource({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill={couleur} />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" stroke={couleur} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconeFermer({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke={couleur} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Minuteur (comme sur la capture iPhone fournie) : anneau ouvert en haut, aiguille qui part
 * du haut vers le centre, pas de piste grise. L'anneau se vide EN CONTINU : l'animation est
 * confiée au navigateur (Web Animations, aucun calcul par seconde) et ne repart que si le
 * minuteur change (démarrage, pause, reprise).
 */
export function IconeMinuteur({
  taille,
  couleur,
  style,
  progression = 1,
  finAMs = null,
  dureeMs = 0,
}: P & { progression?: number; finAMs?: number | null; dureeMs?: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const OUVERTURE_DEG = 44; // ouverture autour de l'aiguille, en haut
  const utile = c * (1 - OUVERTURE_DEG / 360);
  const arc = useRef<SVGCircleElement>(null);
  const trait = (p: number) => `${Math.max(utile * Math.min(Math.max(p, 0), 1), 0.001)} ${c}`;

  useEffect(() => {
    const el = arc.current;
    if (!el) return;
    if (finAMs === null || dureeMs <= 0) {
      el.style.strokeDasharray = trait(progression);
      return;
    }
    const restant = Math.max(finAMs - Date.now(), 0);
    const depart = restant / dureeMs;
    el.style.strokeDasharray = trait(depart);
    if (restant <= 0 || typeof el.animate !== "function") return;
    const anim = el.animate([{ strokeDasharray: trait(depart) }, { strokeDasharray: trait(0) }], {
      duration: restant,
      easing: "linear",
      fill: "forwards",
    });
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finAMs, dureeMs, progression]);

  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <circle
        ref={arc}
        cx="12"
        cy="12"
        r={r}
        stroke={couleur}
        strokeWidth="2.4"
        strokeLinecap="round"
        transform={`rotate(${-90 + OUVERTURE_DEG / 2} 12 12)`}
      />
      <path d="M12 2.6V11.2" stroke={couleur} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconeBatterie({
  largeur,
  hauteur,
  couleur,
  niveau,
  enCharge,
}: {
  largeur: number;
  hauteur: number;
  couleur: string;
  niveau: number;
  enCharge?: boolean;
}) {
  const bout = largeur * 0.07;
  const corps = largeur - bout - 1;
  const rayon = hauteur * 0.3;
  return (
    <svg width={largeur} height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} aria-hidden="true">
      <rect x="0.5" y="0.5" width={corps} height={hauteur - 1} rx={rayon} fill={couleur} fillOpacity="0.25" />
      <rect x="0.5" y="0.5" width={Math.max(corps * niveau, hauteur * 0.5)} height={hauteur - 1} rx={rayon} fill={couleur} />
      <rect x={corps + 1.5} y={hauteur * 0.32} width={bout - 0.5} height={hauteur * 0.36} rx={bout * 0.4} fill={couleur} fillOpacity="0.45" />
      {enCharge && (
        <path
          d={`M${corps * 0.56} ${hauteur * 0.14} L${corps * 0.38} ${hauteur * 0.56} H${corps * 0.5} L${corps * 0.44} ${hauteur * 0.88} L${corps * 0.64} ${hauteur * 0.42} H${corps * 0.52}Z`}
          fill="#000"
        />
      )}
    </svg>
  );
}

export function IconeLune({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill={couleur} />
    </svg>
  );
}

export function IconeVolume({ taille, couleur, style, muet }: P & { muet?: boolean }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M3.5 9.5h3.5L11.5 5.5v13l-4.5-4H3.5z" fill={couleur} />
      {muet ? (
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke={couleur} strokeWidth="1.9" strokeLinecap="round" />
      ) : (
        <path d="M15 9a4.2 4.2 0 0 1 0 6M17.6 6.5a7.8 7.8 0 0 1 0 11" stroke={couleur} strokeWidth="1.9" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function IconePressePapiers({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="5" y="4.5" width="14" height="17" rx="3" stroke={couleur} strokeWidth="1.8" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1.5" fill={couleur} />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" stroke={couleur} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconeCloche({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-6 6v4.2L4.3 16.4A1 1 0 0 0 5.2 18h13.6a1 1 0 0 0 .9-1.6L18 13.2V9a6 6 0 0 0-6-6z" fill={couleur} />
      <path d="M9.5 19.5a2.5 2.5 0 0 0 5 0z" fill={couleur} />
    </svg>
  );
}

export function IconeSoleil({ taille, couleur, style }: P) {
  const rayons = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `M${12 + Math.cos(a) * 7.6} ${12 + Math.sin(a) * 7.6}L${12 + Math.cos(a) * 10} ${12 + Math.sin(a) * 10}`;
  }).join("");
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="4.6" fill={couleur} />
      <path d={rayons} stroke={couleur} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Combiné de téléphone (appel en cours). */
export function IconeTelephone({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path
        d="M6.6 3.2c.6-.5 1.5-.4 2 .2l2.1 2.7c.4.6.4 1.4-.1 1.9l-1.3 1.3c.9 2 2.4 3.6 4.4 4.5l1.3-1.3c.5-.5 1.3-.6 1.9-.1l2.7 2.1c.6.5.7 1.4.2 2l-1.4 1.8c-.6.8-1.7 1.1-2.6.8C10.5 18 6 13.5 4.2 8.2c-.3-.9 0-2 .8-2.6z"
        fill={couleur}
      />
    </svg>
  );
}

export function IconeMicro({ taille, couleur, style, coupe }: P & { coupe?: boolean }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="9" y="3" width="6" height="11" rx="3" fill={couleur} />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" stroke={couleur} strokeWidth="1.9" strokeLinecap="round" />
      {coupe && <path d="M4.5 4.5l15 15" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}
