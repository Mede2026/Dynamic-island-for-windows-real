/**
 * Chemin SVG de l'île : rectangle dont chaque coin est une superellipse
 * (|x/a|^n + |y/a|^n = 1), le profil MESURÉ sur l'iPhone (voir island.config.ts).
 * n = 2 : arc de cercle ; n > 2 : coin « continu ».
 */

const POINTS_PAR_COIN = 24;

/** Retrait horizontal du bord à la distance d du haut (même formule que tools/ilelib/detection.py). */
export function retraitCoin(d: number, a: number, n: number): number {
  if (d >= a) return 0;
  const u = (a - d) / a;
  return a - a * Math.pow(Math.max(1 - Math.pow(u, n), 0), 1 / n);
}

/** Points d'un coin haut-gauche (origine au coin du rectangle), du bas du coin vers la droite. */
function pointsCoin(a: number, n: number, hMax: number): [number, number][] {
  const pts: [number, number][] = [];
  const dMax = Math.min(a, hMax);
  for (let i = 0; i <= POINTS_PAR_COIN; i++) {
    // Échantillonnage en angle (plus dense là où ça courbe) puis coupe à dMax.
    const t = (i / POINTS_PAR_COIN) * (Math.PI / 2);
    const x = a - a * Math.pow(Math.cos(t), 2 / n);
    const y = a - a * Math.pow(Math.sin(t), 2 / n);
    if (y > dMax) continue;
    pts.push([x, y]);
  }
  // Point exact à la coupe (capsule : a > h/2).
  if (dMax < a) pts.unshift([retraitCoin(dMax, a, n), dMax]);
  else if (pts.length === 0 || pts[0]![1] < dMax) pts.unshift([0, dMax]);
  return pts;
}

const f = (x: number) => Math.round(x * 100) / 100;

/**
 * Chemin fermé de l'île, coin haut-gauche en (x, y).
 * a = étendue du coin (bornée à la demi-largeur), n = exposant.
 */
export function cheminIle(x: number, y: number, w: number, h: number, a: number, n: number): string {
  if (w <= 0 || h <= 0) return "";
  const aa = Math.max(0.01, Math.min(a, w / 2));
  const coin = pointsCoin(aa, Math.max(n, 1.01), h / 2);
  const parties: string[] = [];
  const ajouter = (px: number, py: number, premier = false) => parties.push(`${premier ? "M" : "L"}${f(px)} ${f(py)}`);
  // Haut-gauche (de bas en haut), puis haut-droite, bas-droite, bas-gauche (symétries).
  coin.forEach(([cx, cy], i) => ajouter(x + cx, y + cy, i === 0));
  [...coin].reverse().forEach(([cx, cy]) => ajouter(x + w - cx, y + cy));
  coin.forEach(([cx, cy]) => ajouter(x + w - cx, y + h - cy));
  [...coin].reverse().forEach(([cx, cy]) => ajouter(x + cx, y + h - cy));
  return parties.join("") + "Z";
}
