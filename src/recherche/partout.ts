/**
 * Recherche « partout » de l'île : ce qui ne dépend pas de l'affichage (question ou non,
 * pages de Réglages de Windows, correspondances), testable sans Windows.
 */

/** Pages des Réglages de Windows (ms-settings:) avec leurs mots-clés. */
export const REGLAGES_WINDOWS: { nom: string; mots: string; uri: string }[] = [
  { nom: "Wi-Fi", mots: "wifi internet reseau sans fil", uri: "ms-settings:network-wifi" },
  { nom: "Bluetooth et appareils", mots: "bluetooth ecouteurs casque souris clavier appareils", uri: "ms-settings:bluetooth" },
  { nom: "Affichage", mots: "ecran luminosite resolution echelle affichage", uri: "ms-settings:display" },
  { nom: "Son", mots: "son volume audio haut-parleurs micro", uri: "ms-settings:sound" },
  { nom: "Notifications", mots: "notifications alertes", uri: "ms-settings:notifications" },
  { nom: "Ne pas déranger", mots: "ne pas deranger concentration silence", uri: "ms-settings:quiethours" },
  { nom: "Alimentation et batterie", mots: "batterie alimentation energie veille economiseur", uri: "ms-settings:powersleep" },
  { nom: "Windows Update", mots: "mise a jour update windows", uri: "ms-settings:windowsupdate" },
  { nom: "Arrière-plan", mots: "fond ecran arriere-plan wallpaper personnalisation", uri: "ms-settings:personalization-background" },
  { nom: "Couleurs et thème sombre", mots: "couleurs theme sombre clair mode", uri: "ms-settings:colors" },
  { nom: "Applications installées", mots: "applications desinstaller programmes apps", uri: "ms-settings:appsfeatures" },
  { nom: "Applications au démarrage", mots: "demarrage startup lancement", uri: "ms-settings:startupapps" },
  { nom: "Confidentialité et sécurité", mots: "confidentialite securite camera micro position", uri: "ms-settings:privacy" },
  { nom: "Souris", mots: "souris curseur pointeur", uri: "ms-settings:mousetouchpad" },
  { nom: "Clavier et saisie", mots: "clavier saisie frappe", uri: "ms-settings:typing" },
  { nom: "Langue et région", mots: "langue region francais anglais", uri: "ms-settings:regionlanguage" },
  { nom: "Date et heure", mots: "date heure fuseau horaire", uri: "ms-settings:dateandtime" },
  { nom: "Stockage", mots: "stockage disque espace nettoyage", uri: "ms-settings:storagesense" },
  { nom: "Imprimantes", mots: "imprimante impression scanner", uri: "ms-settings:printers" },
  { nom: "VPN", mots: "vpn reseau prive", uri: "ms-settings:network-vpn" },
  { nom: "Mode avion", mots: "mode avion", uri: "ms-settings:network-airplanemode" },
  { nom: "Accessibilité", mots: "accessibilite loupe contraste narrateur", uri: "ms-settings:easeofaccess" },
  { nom: "Comptes", mots: "compte utilisateur mot de passe connexion", uri: "ms-settings:yourinfo" },
];

export function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Score de correspondance (0 = aucune) : début du nom > début d'un mot > contenu. */
export function correspondance(nom: string, texte: string, mots = ""): number {
  const n = sansAccents(nom);
  const t = sansAccents(texte.trim());
  if (!t) return 0;
  if (n === t) return 100;
  if (n.startsWith(t)) return 80;
  if (n.split(/[^a-z0-9]+/).some((m) => m.startsWith(t))) return 60;
  if (sansAccents(mots).split(/\s+/).some((m) => m.startsWith(t))) return 45;
  return n.includes(t) ? 30 : 0;
}

export function reglagesPour(texte: string) {
  return REGLAGES_WINDOWS.map((r) => ({ r, s: correspondance(r.nom, texte, r.mots) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.r);
}

const DEBUTS_QUESTION =
  /^(qui|que|quoi|quel|quelle|quels|quelles|comment|pourquoi|combien|où|ou est|quand|est-ce|est ce|peux-tu|peux tu|peut-on|explique|c'est quoi|c est quoi|dis-moi|dis moi|what|who|why|how|when|where|which|is|are|can|does|do|should|could|explain)\b/;

/** Le texte ressemble-t-il à une question (pour proposer « Demander à Claude ») ? */
export function estQuestion(texte: string): boolean {
  const s = texte.trim().toLowerCase();
  if (s.length < 4) return false;
  if (s.endsWith("?")) return true;
  return DEBUTS_QUESTION.test(s) && s.split(/\s+/).length >= 3;
}
