/**
 * Calculatrice de la recherche rapide : « 12*(3+4) », « 2^10 », « 15 % de 80 », « 3,5 × 2 ».
 * Analyseur maison (aucun eval) : nombres, + − × ÷ ^, parenthèses, pourcentages.
 */

export function estCalcul(texte: string): boolean {
  const t = texte.trim();
  return /\d/.test(t) && /^[\d\s.,+\-*/×÷x^()%]+$|^[\d\s.,]+\s*%\s*de\s*[\d\s.,]+$/i.test(t) && /[+\-*/×÷x^%]/.test(t);
}

export function calculer(texte: string): number | null {
  let t = texte.trim().toLowerCase();
  // « 15 % de 80 » → 15/100*80
  const pc = /^([\d.,\s]+)%\s*de\s*([\d.,\s]+)$/.exec(t);
  if (pc) t = `(${pc[1]})/100*(${pc[2]})`;
  t = t.replace(/×|x/g, "*").replace(/÷/g, "/").replace(/(\d),(\d)/g, "$1.$2").replace(/\s+/g, "");
  let i = 0;
  const voir = () => t[i];
  const nombre = (): number => {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(t.slice(i));
    if (!m) throw new Error("nombre attendu");
    i += m[0].length;
    return Number(m[0]);
  };
  const facteur = (): number => {
    if (voir() === "-") {
      i++;
      return -facteur();
    }
    if (voir() === "+") {
      i++;
      return facteur();
    }
    let v: number;
    if (voir() === "(") {
      i++;
      v = somme();
      if (voir() !== ")") throw new Error(") attendue");
      i++;
    } else v = nombre();
    if (voir() === "%") {
      i++;
      v /= 100;
    }
    if (voir() === "^") {
      i++;
      v = Math.pow(v, facteur());
    }
    return v;
  };
  const produit = (): number => {
    let v = facteur();
    while (voir() === "*" || voir() === "/") {
      const op = t[i++];
      const d = facteur();
      v = op === "*" ? v * d : v / d;
    }
    return v;
  };
  const somme = (): number => {
    let v = produit();
    while (voir() === "+" || voir() === "-") {
      const op = t[i++];
      const d = produit();
      v = op === "+" ? v + d : v - d;
    }
    return v;
  };
  try {
    const r = somme();
    return i === t.length && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

/** « 1 234,5 » (format québécois). */
export function formaterNombre(n: number): string {
  return n.toLocaleString("fr-CA", { maximumFractionDigits: 10 });
}
