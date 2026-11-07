/**
 * Paroles synchronisées : lecture du format LRC (« [01:02.30] texte ») et ligne en cours.
 * Fonctions pures (testées dans paroles.test.ts) + suivi de la chanson (pont.ts).
 */

export interface LigneParoles {
  /** Début de la ligne (ms depuis le début de la chanson). */
  t: number;
  texte: string;
}

export interface ParolesChanson {
  /** Identifie la chanson (artiste + titre). */
  cle: string;
  lignes: LigneParoles[];
}

/** Lignes horodatées d'un texte LRC, triées. Les lignes vides (pauses) sont gardées. */
export function lireLrc(lrc: string): LigneParoles[] {
  const lignes: LigneParoles[] = [];
  for (const brute of lrc.split(/\r?\n/)) {
    const temps = [...brute.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (temps.length === 0) continue;
    const texte = brute.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of temps) {
      const fraction = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
      lignes.push({ t: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + fraction, texte });
    }
  }
  return lignes.sort((a, b) => a.t - b.t);
}

/** Indice de la ligne chantée à `positionMs` (-1 avant la première). */
export function indiceLigne(lignes: LigneParoles[], positionMs: number): number {
  let bas = 0;
  let haut = lignes.length - 1;
  let trouve = -1;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    if (lignes[milieu]!.t <= positionMs) {
      trouve = milieu;
      bas = milieu + 1;
    } else haut = milieu - 1;
  }
  return trouve;
}

export const cleChanson = (artiste: string, titre: string) => `${artiste.trim()}|${titre.trim()}`.toLowerCase();
