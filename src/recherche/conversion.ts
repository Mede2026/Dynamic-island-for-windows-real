/**
 * Convertisseur de la recherche rapide : « 5 km en milles », « 100 °F en °C »,
 * « 3 tasses en ml », « 20 usd en cad » (devises : taux du jour, demandés au backend).
 */

type Dimension = "longueur" | "masse" | "volume" | "vitesse" | "temps" | "donnees" | "temperature";

const UNITES: [Dimension, number, string[]][] = [
  ["longueur", 1000, ["km", "kilomètre", "kilomètres"]],
  ["longueur", 1, ["m", "mètre", "mètres"]],
  ["longueur", 0.01, ["cm", "centimètre", "centimètres"]],
  ["longueur", 0.001, ["mm", "millimètre", "millimètres"]],
  ["longueur", 1609.344, ["mi", "mile", "miles", "mille", "milles"]],
  ["longueur", 0.3048, ["ft", "pi", "pied", "pieds"]],
  ["longueur", 0.0254, ["in", "po", "pouce", "pouces"]],
  ["longueur", 0.9144, ["yd", "verge", "verges"]],
  ["masse", 1, ["kg", "kilo", "kilos", "kilogramme", "kilogrammes"]],
  ["masse", 0.001, ["g", "gramme", "grammes"]],
  ["masse", 1e-6, ["mg"]],
  ["masse", 0.45359237, ["lb", "lbs", "livre", "livres"]],
  ["masse", 0.028349523, ["oz", "once", "onces"]],
  ["masse", 1000, ["t", "tonne", "tonnes"]],
  ["volume", 1, ["l", "litre", "litres"]],
  ["volume", 0.001, ["ml", "millilitre", "millilitres"]],
  ["volume", 0.01, ["cl"]],
  ["volume", 3.785411784, ["gal", "gallon", "gallons"]],
  ["volume", 0.2365882, ["tasse", "tasses", "cup", "cups"]],
  ["volume", 0.0147868, ["c. à soupe", "cuillère à soupe", "cuillères à soupe", "tbsp"]],
  ["volume", 0.0049289, ["c. à thé", "cuillère à thé", "cuillères à thé", "tsp"]],
  ["vitesse", 1 / 3.6, ["km/h", "kmh"]],
  ["vitesse", 1, ["m/s"]],
  ["vitesse", 0.44704, ["mph"]],
  ["vitesse", 0.514444, ["nœud", "nœuds", "noeud", "noeuds", "kn"]],
  ["temps", 1, ["s", "sec", "seconde", "secondes"]],
  ["temps", 60, ["min", "minute", "minutes"]],
  ["temps", 3600, ["h", "heure", "heures"]],
  ["temps", 86400, ["j", "jour", "jours", "day", "days"]],
  ["temps", 604800, ["semaine", "semaines", "week", "weeks"]],
  ["donnees", 1, ["o", "octet", "octets", "b", "byte", "bytes"]],
  ["donnees", 1024, ["ko", "kb", "kio"]],
  ["donnees", 1024 ** 2, ["mo", "mb", "mio"]],
  ["donnees", 1024 ** 3, ["go", "gb", "gio"]],
  ["donnees", 1024 ** 4, ["to", "tb", "tio"]],
];

const TEMPERATURES: Record<string, "C" | "F" | "K"> = {
  "°c": "C", c: "C", celsius: "C", "°f": "F", f: "F", fahrenheit: "F", k: "K", kelvin: "K",
};

const DEVISES: Record<string, string> = {
  usd: "USD", "$us": "USD", "$ us": "USD", "us$": "USD", dollar: "USD", dollars: "USD",
  cad: "CAD", "$": "CAD", "$ca": "CAD", "$ ca": "CAD", "ca$": "CAD", "dollar canadien": "CAD", "dollars canadiens": "CAD",
  eur: "EUR", "€": "EUR", euro: "EUR", euros: "EUR",
  gbp: "GBP", "£": "GBP", livre: "GBP",
  jpy: "JPY", "¥": "JPY", yen: "JPY", yens: "JPY",
  chf: "CHF", mxn: "MXN", aud: "AUD", cny: "CNY",
};

export type Conversion =
  | { genre: "unite"; resultat: number; de: string; vers: string; valeur: number }
  | { genre: "devise"; valeur: number; de: string; vers: string };

const MOTIF = /^\s*([\d\s]*[\d][\d\s]*(?:[.,]\d+)?)\s*(.+?)\s+(?:en|in|to|vers|=|→)\s+(.+?)\s*$/i;

export function analyserConversion(texte: string): Conversion | null {
  const m = MOTIF.exec(texte);
  if (!m) return null;
  const valeur = Number(m[1]!.replace(/\s/g, "").replace(",", "."));
  const de = m[2]!.trim().toLowerCase();
  const vers = m[3]!.trim().toLowerCase();
  if (!Number.isFinite(valeur)) return null;
  // Températures
  const td = TEMPERATURES[de];
  const tv = TEMPERATURES[vers];
  if (td && tv) {
    const c = td === "C" ? valeur : td === "F" ? ((valeur - 32) * 5) / 9 : valeur - 273.15;
    const r = tv === "C" ? c : tv === "F" ? (c * 9) / 5 + 32 : c + 273.15;
    return { genre: "unite", resultat: r, de: m[2]!.trim(), vers: m[3]!.trim(), valeur };
  }
  // Devises (avant les unités : « livre » = £ seulement si l'autre est une devise)
  const dd = DEVISES[de];
  const dv = DEVISES[vers];
  if (dd && dv && !(UNITES.some(([, , n]) => n.includes(de)) && UNITES.some(([, , n]) => n.includes(vers)))) {
    return { genre: "devise", valeur, de: dd, vers: dv };
  }
  const ud = UNITES.find(([, , noms]) => noms.includes(de));
  const uv = UNITES.find(([, , noms]) => noms.includes(vers));
  if (!ud || !uv || ud[0] !== uv[0]) return null;
  return { genre: "unite", resultat: (valeur * ud[1]) / uv[1], de: m[2]!.trim(), vers: m[3]!.trim(), valeur };
}
