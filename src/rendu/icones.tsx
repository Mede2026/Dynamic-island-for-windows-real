/**
 * Icônes ORIGINALES (formes géométriques simples dessinées pour ce projet).
 * Aucune icône ni aucun asset Apple n'est copié.
 */

import type { CSSProperties } from "react";

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

/** Minuteur : anneau avec une aiguille. `progression` 0–1 = arc restant. */
export function IconeMinuteur({ taille, couleur, style, progression = 1 }: P & { progression?: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r={r} stroke={couleur} strokeOpacity="0.3" strokeWidth="2.6" />
      <circle
        cx="12"
        cy="12"
        r={r}
        stroke={couleur}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray={`${c * progression} ${c}`}
        transform="rotate(-90 12 12)"
      />
      <path d="M12 12V7" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" />
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
