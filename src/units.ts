/**
 * Conversions d'unités et de ressorts. Aucune valeur visuelle ici :
 * seulement des formules (les nombres viennent de island.config.ts).
 */

/** Points iPhone → DIP Windows. */
export function ptVersDip(pt: number, islandScale: number): number {
  return pt * islandScale;
}

/** DIP Windows → pixels physiques de l'écran (échelle Windows : 1.0 = 100 %, 1.5 = 150 %…). */
export function dipVersPx(dip: number, facteurEchelleEcran: number): number {
  return dip * facteurEchelleEcran;
}

/** Pixels physiques → DIP. */
export function pxVersDip(px: number, facteurEchelleEcran: number): number {
  return px / facteurEchelleEcran;
}

export interface RessortFramer {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface RessortApple {
  /** Période de l'oscillation non amortie, en secondes. */
  response: number;
  /** Fraction d'amortissement (ζ). 1 = critique (aucun rebond). */
  dampingFraction: number;
}

/**
 * Apple (response, dampingFraction) → Framer Motion (stiffness, damping, mass).
 *   ω₀ = 2π / response
 *   stiffness = m · ω₀²
 *   damping   = 2 · ζ · m · ω₀
 */
export function appleVersFramer({ response, dampingFraction }: RessortApple, mass = 1): RessortFramer {
  const omega0 = (2 * Math.PI) / response;
  return {
    stiffness: mass * omega0 * omega0,
    damping: 2 * dampingFraction * mass * omega0,
    mass,
  };
}

/** Framer Motion (stiffness, damping, mass) → Apple (response, dampingFraction). */
export function framerVersApple({ stiffness, damping, mass }: RessortFramer): RessortApple {
  const omega0 = Math.sqrt(stiffness / mass);
  return {
    response: (2 * Math.PI) / omega0,
    dampingFraction: damping / (2 * Math.sqrt(stiffness * mass)),
  };
}
