/**
 * Numéros de suivi de colis : reconnaître le transporteur et donner la page de suivi
 * officielle. (Pas d'état « en direct » : les transporteurs demandent une clé d'API.)
 */

export interface Suivi {
  transporteur: string;
  url: string;
}

const enc = encodeURIComponent;

export function detecterColis(texte: string): Suivi[] {
  const n = texte.replace(/[\s-]/g, "").toUpperCase();
  if (n.length < 10 || n.length > 34 || !/^[A-Z0-9]+$/.test(n)) return [];
  const postes = { transporteur: "Postes Canada", url: `https://www.canadapost-postescanada.ca/track-reperage/fr#/search?searchFor=${enc(n)}` };
  const universel = { transporteur: "17TRACK (tous)", url: `https://t.17track.net/fr#nums=${enc(n)}` };
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return [{ transporteur: "UPS", url: `https://www.ups.com/track?loc=fr_CA&tracknum=${enc(n)}` }];
  if (/^TBA\d{12}$/.test(n)) return [{ transporteur: "Amazon", url: `https://track.amazon.ca/tracking/${enc(n)}` }];
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) return n.endsWith("CA") ? [postes] : [universel];
  if (/^\d{16}$/.test(n)) return [postes];
  if (/^\d{12}$/.test(n))
    return [
      { transporteur: "Purolator", url: `https://www.purolator.com/fr/expedition/suivi?pin=${enc(n)}` },
      { transporteur: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}` },
    ];
  if (/^\d{15}$/.test(n)) return [{ transporteur: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}` }];
  if (/^\d{10}$/.test(n)) return [{ transporteur: "DHL", url: `https://www.dhl.com/ca-fr/home/tracking.html?tracking-id=${enc(n)}` }];
  return [];
}
