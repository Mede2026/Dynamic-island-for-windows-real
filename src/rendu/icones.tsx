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
 * Minuteur : anneau (piste atténuée) qui se vide, et aiguille du centre vers le haut.
 * L'anneau se vide EN CONTINU : animation confiée au navigateur (Web Animations, aucun calcul
 * par seconde), relancée seulement si le minuteur change (démarrage, pause, reprise).
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
  const arc = useRef<SVGCircleElement>(null);
  const trait = (p: number) => `${Math.max(c * Math.min(Math.max(p, 0), 1), 0.001)} ${c}`;

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
      <circle cx="12" cy="12" r={r} stroke={couleur} strokeOpacity="0.3" strokeWidth="2.6" />
      <circle ref={arc} cx="12" cy="12" r={r} stroke={couleur} strokeWidth="2.6" strokeLinecap="round" transform="rotate(-90 12 12)" />
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

/** Flèche vers le haut posée sur une barre (Verr. Maj). */
export function IconeMajuscules({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M12 3.2 4 11.6h4.6v4.2h6.8v-4.2H20z" fill="none" stroke={couleur} strokeWidth="2" strokeLinejoin="round" />
      <rect x="8.6" y="18.4" width="6.8" height="2.4" rx="1" fill={couleur} />
    </svg>
  );
}

/** Pavé numérique : chiffre 1 dans un carré arrondi (Verr. Num). */
export function IconeNumerique({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke={couleur} strokeWidth="2" />
      <path d="M10 9.2 12.6 7.6v9" stroke={couleur} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Clé USB : corps arrondi et embout. */
export function IconeUsb({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <rect x="9" y="2.6" width="6" height="5" rx="0.8" fill="none" stroke={couleur} strokeWidth="1.8" />
      <rect x="10.6" y="4.2" width="1.1" height="1.6" fill={couleur} />
      <rect x="12.3" y="4.2" width="1.1" height="1.6" fill={couleur} />
      <rect x="7" y="8" width="10" height="13.4" rx="2.6" fill={couleur} />
    </svg>
  );
}

/** Casque audio (écouteurs, casque, enceinte Bluetooth). */
export function IconeCasque({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M4.2 14.5V12a7.8 7.8 0 0 1 15.6 0v2.5" fill="none" stroke={couleur} strokeWidth="2" strokeLinecap="round" />
      <rect x="3" y="13" width="5" height="8" rx="2.2" fill={couleur} />
      <rect x="16" y="13" width="5" height="8" rx="2.2" fill={couleur} />
    </svg>
  );
}

/** Clavier : rectangle arrondi avec touches. */
export function IconeClavier({ taille, couleur, style }: P) {
  const touches = [6.5, 9.5, 12.5, 15.5].flatMap((x) => [<rect key={`a${x}`} x={x} y="9" width="2" height="2" rx="0.5" fill={couleur} />, <rect key={`b${x}`} x={x} y="12" width="2" height="2" rx="0.5" fill={couleur} />]);
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12.5" rx="2.6" fill="none" stroke={couleur} strokeWidth="1.8" />
      {touches}
      <rect x="8" y="15" width="8" height="1.6" rx="0.8" fill={couleur} />
    </svg>
  );
}

/** Souris. */
export function IconeSouris({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="6.5" y="3" width="11" height="18" rx="5.5" stroke={couleur} strokeWidth="2" />
      <path d="M12 6.4v3.4" stroke={couleur} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Manette de jeu. */
export function IconeManette({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M7 7.5h10a5 5 0 0 1 4.9 6l-.8 3.8a2 2 0 0 1-3.5.8l-2.1-2.6H8.5l-2.1 2.6a2 2 0 0 1-3.5-.8l-.8-3.8A5 5 0 0 1 7 7.5z" fill={couleur} />
      <path d="M7.5 10.4v3M6 11.9h3" stroke="#000" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="15.6" cy="11" r="0.95" fill="#000" />
      <circle cx="17.6" cy="12.8" r="0.95" fill="#000" />
    </svg>
  );
}

/** Symbole Bluetooth stylisé (deux triangles sur une barre), dessiné pour ce projet. */
export function IconeBluetooth({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M6.8 7.6 17 16.4 12 20.6V3.4l5 4.2L6.8 16.4" stroke={couleur} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Cadran d'horloge dont les aiguilles montrent l'heure donnée. */
export function IconeHorloge({ taille, couleur, style, heure }: P & { heure: Date }) {
  const m = heure.getMinutes() + heure.getSeconds() / 60;
  const h = (heure.getHours() % 12) + m / 60;
  const aiguille = (angle: number, long: number) =>
    `M12 12L${12 + Math.sin(angle) * long} ${12 - Math.cos(angle) * long}`;
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9.6" stroke={couleur} strokeWidth="2" />
      <path d={aiguille((h / 12) * 2 * Math.PI, 4.6)} stroke={couleur} strokeWidth="2.2" strokeLinecap="round" />
      <path d={aiguille((m / 60) * 2 * Math.PI, 6.8)} stroke={couleur} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Flèche vers le bas dans un bac (téléchargement). */
export function IconeTelechargement({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M12 3.5v11M7.2 10l4.8 4.8 4.8-4.8" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Dossier (étagère). */
export function IconeDossier({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.1l2 2.2h7.5A2.2 2.2 0 0 1 21 9.4v8.4a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" fill={couleur} />
    </svg>
  );
}

/** Feuille (fichier) avec un coin plié. */
export function IconeFichier({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M6.5 2.5h7.2l4.8 4.8v12.2a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z" fill={couleur} opacity="0.9" />
      <path d="M13.7 2.5v3.8a1 1 0 0 0 1 1h3.8" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />
    </svg>
  );
}

/** Deux feuilles superposées (copier). */
export function IconeCopier({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <rect x="8" y="8" width="12" height="12" rx="2.5" stroke={couleur} strokeWidth="2" />
      <path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H6" stroke={couleur} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Ondes Wi-Fi (barrée si hors ligne). */
export function IconeWifi({ taille, couleur, style, coupe }: P & { coupe?: boolean }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M2.8 9.2a13.2 13.2 0 0 1 18.4 0M6 12.6a8.6 8.6 0 0 1 12 0M9.2 16a4 4 0 0 1 5.6 0" stroke={couleur} strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="19.2" r="1.6" fill={couleur} />
      {coupe && <path d="M4 4l16 16" stroke={couleur} strokeWidth="2.1" strokeLinecap="round" />}
    </svg>
  );
}

/** Œil (pause des yeux). */
export function IconeOeil({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke={couleur} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" fill={couleur} />
    </svg>
  );
}

/** Note de musique (chanson introuvable). */
export function IconeNote({ taille, couleur, style }: P) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path d="M9 17.5V5.8l10-2.3v11.7" fill="none" stroke={couleur} strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="6.6" cy="17.6" rx="2.9" ry="2.4" fill={couleur} />
      <ellipse cx="16.6" cy="15.3" rx="2.9" ry="2.4" fill={couleur} />
    </svg>
  );
}
