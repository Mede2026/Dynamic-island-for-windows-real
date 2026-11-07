/**
 * Pont backend ↔ machine à états :
 *  - écoute TOUS les événements du backend et les affiche dans la console (journal de débogage) ;
 *  - les traduit en événements de la machine à états ;
 *  - exécute les effets de la machine qui concernent le backend.
 *
 * Les zones touchables sont envoyées par le rendu (src/rendu/Ile.tsx) : ailleurs,
 * les clics traversent la fenêtre.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import type { IslandMachine } from "../state/islandMachine";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backend, dansTauri, ecouter } from "./backend";
import { cleChanson, lireLrc } from "./paroles";
import { donnees, majDonnees, positionActuelle } from "./donnees";
import { demanderClaude, preparerQuestionImage, traduireTexte } from "../recherche/RechercheIle";
import { recevoirNiveau } from "../rendu/onde";
import type { EtatMedia, EtatMinuteur } from "./types";
import { appIgnoree, definirPreferences, definirSurcharges, preferencesActuelles, type Preferences } from "../config/store";
import { estMusiqueDeTest, jouer, nettoyerTests, SCENARIOS, type NomScenario } from "../demo/scenarios";
import { appelEntrant, ID_APPEL_ENTRANT, Traducteur } from "./traducteur";
import { NOMS_EVENEMENTS, type InfoFenetre } from "./types";

const STYLE = "color:#0a84ff;font-weight:bold";

function log(module: string, ...valeurs: unknown[]) {
  console.log(`%c[${module}]`, STYLE, ...valeurs);
}

/** Dernières infos d'écran (taux de rafraîchissement, échelle…), lisibles par le rendu. */
export const ecranCourant: { info: InfoFenetre | null } = { info: null };

export function demarrerPont(machine: IslandMachine): () => void {
  if (!dansTauri()) {
    log("pont", "hors de Tauri (navigateur) : backend désactivé");
    return () => machine.detruire();
  }

  let traducteur = new Traducteur();
  const arrets: Promise<UnlistenFn>[] = [];
  // Les alertes désactivées dans les préférences ne sont pas envoyées.
  const envoyer = (evs: ReturnType<Traducteur["media"]>) =>
    evs.forEach((e) => {
      if (e.type === "ALERTE" && (preferencesActuelles().alertesMasquees ?? []).includes(e.alerte.type)) return;
      machine.envoyer(e);
    });

  // 1. Journal de tous les événements du backend.
  for (const nom of NOMS_EVENEMENTS) {
    arrets.push(
      ecouter(nom, (donnees) => {
        if (nom === "media-pochette") {
          const p = donnees as { id: string; couleurDominante: number[]; pngBase64: string };
          log(nom, { id: p.id, couleurDominante: p.couleurDominante, tailleBase64: p.pngBase64.length });
        } else {
          log(nom, donnees);
        }
      }),
    );
  }

  // Paroles : cherchées (LRCLIB, par le backend) à chaque nouvelle chanson.
  let chansonParoles = "";
  const suivreParoles = (m: EtatMedia) => {
    const cle = cleChanson(m.artiste, m.titre);
    if (cle === chansonParoles) return;
    chansonParoles = cle;
    majDonnees({ paroles: null });
    if (!m.titre || preferencesActuelles().paroles === false) return;
    const dureeS = m.dureeMs > 0 ? Math.round(m.dureeMs / 1000) : null;
    // Apple Music met « Artiste — Album » dans le champ artiste : on sépare.
    const [artiste = m.artiste, albumDansArtiste] = m.artiste.split(/\s+[—–]\s+/);
    void backend
      .parolesChercher(artiste.trim(), m.titre, m.album || albumDansArtiste?.trim() || "", dureeS)
      .then((p) => {
        if (chansonParoles !== cle || !p?.synchronisees) return;
        majDonnees({ paroles: { cle, lignes: lireLrc(p.synchronisees) } });
      })
      .catch(() => undefined);
  };

  // Horloge au survol : la souris sur l'île au repos → l'heure (comme une activité).
  let minuterieHorloge: ReturnType<typeof setTimeout> | null = null;
  const horlogeAffichee = () => machine.etat.activites.some((a) => a.id === "horloge");
  const horlogeAuSurvol = (dedans: boolean) => {
    if (minuterieHorloge) clearTimeout(minuterieHorloge);
    const verifier = () => {
      minuterieHorloge = null;
      const e = machine.etat;
      if (dedans) {
        if (preferencesActuelles().horlogeSurvol !== false && e.mode === "repos" && e.activites.length === 0) {
          machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "horloge", type: "horloge" } });
        }
      } else if (horlogeAffichee()) {
        // Vue étendue ouverte : attendre qu'elle se referme.
        if (e.mode === "etendu" || e.survol) minuterieHorloge = setTimeout(verifier, 800);
        else machine.envoyer({ type: "ACTIVITE_FIN", id: "horloge" });
      }
    };
    minuterieHorloge = setTimeout(verifier, dedans ? 250 : 450);
  };

  // 2. Traduction vers la machine à états.
  arrets.push(
    ecouter("media", (m) => {
      // App ignorée (réglages) : l'île fait comme si rien ne jouait.
      // Test « Paroles » / « Musique » en cours (réglages → Tester) : Windows qui dit « rien ne
      // joue » n'efface pas la musique de test.
      if (estMusiqueDeTest() && m.statut !== "lecture") return;
      const ignoree = appIgnoree(m.sourceActive);
      // Certaines apps renvoient une position « en retard » (pas remise à jour) avec une
      // heure toute neuve : l'île reculerait et les paroles prendraient du retard sur la
      // musique. Même chanson, en lecture, petit recul (< 3 s) → on garde notre horloge.
      const avant = donnees().media;
      if (avant && m.statut === "lecture" && avant.statut === "lecture" && avant.titre === m.titre && avant.artiste === m.artiste) {
        const estime = positionActuelle(avant);
        const recu = positionActuelle(m);
        if (recu < estime && estime - recu < 3000) m = { ...m, positionMs: estime, positionMajAMs: Date.now() };
      }
      majDonnees({ media: m });
      suivreParoles(m);
      envoyer(traducteur.media(ignoree ? { ...m, sourceActive: null } : m));
    }),
  );
  arrets.push(ecouter("media-pochette", (p) => majDonnees({ pochette: p })));
  arrets.push(
    ecouter("minuteur", (m) => {
      minuteurApp = { ...m, source: "app" };
      publierMinuteur();
    }),
  );
  arrets.push(
    ecouter("batterie", (b) => {
      majDonnees({ batterie: b });
      envoyer(traducteur.batterieEtat(b));
    }),
  );
  arrets.push(
    ecouter("volume", (v) => {
      majDonnees({ volume: v });
      envoyer(traducteur.volume(v));
    }),
  );
  // Texte d'une image (OCR) : la capture lue puis le texte recopié ne font PAS leur propre
  // alerte « Capture » / « Texte copié » — une seule animation, celle du résultat.
  let ocrDemandeA = 0;
  let pressePapiersMuetJusqua = 0;
  const ocrEnAttente = () => Date.now() - ocrDemandeA <= 90_000;
  arrets.push(
    ecouter("presse-papiers", (p) => {
      // Copie faite depuis un outil de l'île (résultat de calcul…) : pas d'alerte par-dessus.
      if (ocrEnAttente() || Date.now() < pressePapiersMuetJusqua || machine.etat.activites.some((a) => a.id === "outil")) return;
      envoyer(traducteur.pressePapiers(p));
    }),
  );
  arrets.push(ecouter("niveau-audio", (n) => recevoirNiveau(n)));
  arrets.push(ecouter("luminosite", (n) => envoyer(traducteur.luminosite(n))));
  arrets.push(ecouter("verrouillage", (v) => envoyer(traducteur.verrouillage(v))));
  arrets.push(ecouter("usb", (u) => envoyer(traducteur.usb(u))));
  arrets.push(ecouter("bluetooth", (b) => envoyer(traducteur.bluetooth(b))));
  arrets.push(ecouter("internet", (i) => envoyer(traducteur.internet(i))));
  arrets.push(ecouter("reconnaissance", (r) => envoyer(traducteur.reconnaissance(r))));
  // Rappels de pause : minutes passées devant l'écran (clavier ou souris utilisés dans la
  // dernière minute) ; 5 minutes d'absence remettent le compteur à zéro.
  let minutesActives = 0;
  const pauses = setInterval(() => {
    if (!dansTauri() || preferencesActuelles().pauses !== true) return;
    void backend.inactiviteMs().then((inactif) => {
      if (inactif > 5 * 60_000) minutesActives = 0;
      else if (inactif < 60_000) minutesActives++;
      if (minutesActives > 0 && minutesActives % 60 === 0) {
        envoyer([{ type: "ALERTE", alerte: { type: "pause", donnees: { genre: "bouger" }, dureeFacteur: 2 } }]);
      } else if (minutesActives > 0 && minutesActives % 20 === 0) {
        envoyer([{ type: "ALERTE", alerte: { type: "pause", donnees: { genre: "yeux" }, dureeFacteur: 2 } }]);
      }
    });
  }, 60_000);
  arrets.push(Promise.resolve(() => clearInterval(pauses)));
  arrets.push(
    ecouter("telechargements", (t) => {
      majDonnees({ telechargements: t.enCours });
      envoyer(traducteur.telechargements(t));
    }),
  );
  // Étagère : visible seulement quand on glisse des fichiers sur l'île, ou à la demande
  // (menu de l'icône, Ctrl+Alt+E) ; elle se referme toute seule (pas tant que la souris est dessus).
  const etagere = (liste: string[]) => majDonnees({ etagere: liste });
  arrets.push(ecouter("etagere", etagere));
  void backend.etagereLire().then((l) => l && etagere(l));
  let fermetureEtagere: ReturnType<typeof setTimeout> | null = null;
  const etagereOuverte = () => machine.etat.activites.some((a) => a.id === "etagere");
  const fermerEtagere = () => {
    fermetureEtagere = null;
    if (!etagereOuverte()) return;
    if (machine.etat.survol) {
      fermetureEtagere = setTimeout(fermerEtagere, 800);
      return;
    }
    machine.envoyer({ type: "ACTIVITE_FIN", id: "etagere" });
  };
  const ouvrirEtagere = (dureeMs: number) => {
    if (fermetureEtagere) clearTimeout(fermetureEtagere);
    if (!etagereOuverte()) {
      machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "etagere", type: "etagere" } });
      machine.envoyer({ type: "CLIC_LONG" });
    }
    fermetureEtagere = setTimeout(fermerEtagere, dureeMs);
  };
  arrets.push(ecouter("ouvrir-etagere", () => ouvrirEtagere(8000)));
  const etagereDepuisMenu = () => {
    fermerMenu();
    ouvrirEtagere(8000);
  };
  window.addEventListener("ile-ouvrir-etagere", etagereDepuisMenu);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-ouvrir-etagere", etagereDepuisMenu)));

  // Menu de l'île (clic droit) : activité « menu » en vue étendue ; se referme quand on clique
  // ailleurs, quand on choisit un outil, ou quand la souris quitte l'île.
  const menuOuvert = () => machine.etat.activites.some((a) => a.id === "menu");
  let menuVuOuvert = false;
  const fermerMenu = () => {
    if (menuOuvert()) machine.envoyer({ type: "ACTIVITE_FIN", id: "menu" });
  };
  const ouvrirMenu = () => {
    if (menuOuvert()) return fermerMenu();
    machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "menu", type: "menu" } });
    machine.envoyer({ type: "CLIC_LONG" });
  };
  window.addEventListener("ile-menu-ouvrir", ouvrirMenu);
  window.addEventListener("ile-menu-fermer", fermerMenu);
  arrets.push(
    Promise.resolve(() => {
      window.removeEventListener("ile-menu-ouvrir", ouvrirMenu);
      window.removeEventListener("ile-menu-fermer", fermerMenu);
    }),
  );
  // Vue étendue refermée (clic à côté, souris partie) : le menu disparaît aussi.
  arrets.push(
    Promise.resolve(
      machine.abonner((e) => {
        const menu = e.activites.some((a) => a.id === "menu");
        if (menu && e.mode === "etendu") menuVuOuvert = true;
        else if (menu && menuVuOuvert) {
          menuVuOuvert = false;
          queueMicrotask(() => machine.envoyer({ type: "ACTIVITE_FIN", id: "menu" }));
        } else if (!menu) menuVuOuvert = false;
      }),
    ),
  );
  // Outils DANS l'île (recherche, minuteur, copiés, note) : raccourcis, menu du clic droit.
  // L'île prend le clavier tant que l'outil est ouvert ; Échap, un clic à côté ou la vue
  // étendue refermée le ferment, et le clavier revient à l'app d'avant.
  const outilOuvert = () => machine.etat.activites.find((a) => a.id === "outil");
  let outilVuOuvert = false;
  let outilClavier = false;
  const fermerOutilIle = () => {
    if (outilOuvert()) machine.envoyer({ type: "ACTIVITE_FIN", id: "outil" });
  };
  const ouvrirOutil = (nom: string, forcer = false) => {
    const ouvert = outilOuvert();
    if (ouvert && (ouvert.donnees as { outil?: string } | undefined)?.outil === nom) {
      if (forcer) return;
      return fermerOutilIle();
    }
    if (menuOuvert()) machine.envoyer({ type: "ACTIVITE_FIN", id: "menu" });
    outilVuOuvert = false;
    machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "outil", type: "outil", donnees: { outil: nom } } });
    machine.envoyer({ type: "CLIC_LONG" });
  };
  const surOutil = (e: Event) => ouvrirOutil(String((e as CustomEvent<string>).detail));
  window.addEventListener("ile-outil", surOutil);
  window.addEventListener("ile-outil-fermer", fermerOutilIle);
  arrets.push(
    Promise.resolve(() => {
      window.removeEventListener("ile-outil", surOutil);
      window.removeEventListener("ile-outil-fermer", fermerOutilIle);
    }),
  );
  arrets.push(ecouter("ouvrir-outil", (nom) => ouvrirOutil(nom)));
  // Boutons des alertes : « Résumer » (texte copié) et « Demander » (capture) → Claude dans l'île.
  const demander = (e: Event) => {
    const quoi = (e as CustomEvent<string>).detail;
    machine.envoyer({ type: "CLIC" }); // ferme l'alerte
    if (quoi === "corriger" || quoi === "traduire") {
      void backend.historiqueLire().then((textes) => {
        const t = textes?.[0];
        if (!t) return;
        ouvrirOutil("recherche", true);
        if (quoi === "traduire") void traduireTexte(t);
        else
          void demanderClaude(
            `Corrige les fautes d'orthographe, de grammaire et de ponctuation de ce texte, dans sa langue. Réponds seulement avec le texte corrigé, puis une ligne vide et la liste courte des corrections.\n\n${t}`,
            { affiche: `Corriger : « ${t.replace(/\s+/g, " ").slice(0, 60)}${t.length > 60 ? "…" : ""} »` },
          );
      });
    } else if (quoi === "texte") {
      void backend.historiqueLire().then((textes) => {
        const t = textes?.[0];
        if (!t) return;
        ouvrirOutil("recherche", true);
        void demanderClaude(`Résume ce texte en quelques phrases, dans sa langue :\n\n${t}`, { affiche: `Résumer : « ${t.replace(/\s+/g, " ").slice(0, 60)}${t.length > 60 ? "…" : ""} »` });
      });
    } else {
      void backend.pressePapiersImage().then((png) => {
        if (!png) return;
        ouvrirOutil("recherche", true);
        preparerQuestionImage(png);
      });
    }
  };
  window.addEventListener("ile-demander", demander);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-demander", demander)));
  arrets.push(
    Promise.resolve(
      machine.abonner((e) => {
        const outil = e.activites.some((a) => a.id === "outil");
        // Une alerte passe par-dessus sans fermer l'outil (il revient après).
        const visible = outil && (e.mode === "etendu" || (e.mode === "alerte" && outilVuOuvert));
        if (outil && e.mode === "etendu") outilVuOuvert = true;
        else if (outil && outilVuOuvert && e.mode !== "alerte") {
          outilVuOuvert = false;
          queueMicrotask(() => machine.envoyer({ type: "ACTIVITE_FIN", id: "outil" }));
        } else if (!outil) outilVuOuvert = false;
        if (visible !== outilClavier) {
          outilClavier = visible;
          if (dansTauri()) void backend.ileClavier(visible).catch(() => undefined);
        }
      }),
    ),
  );
  // Quelque chose est traîné près de l'île (bouton gauche enfoncé) : l'étagère s'ouvre en
  // grand pour recevoir des fichiers ; elle se referme si on ne lâche rien.
  arrets.push(ecouter("glisser-proche", () => ouvrirEtagere(4000)));
  if (dansTauri()) {
    arrets.push(
      getCurrentWebview().onDragDropEvent((e) => {
        const t = e.payload.type;
        if (t === "enter") ouvrirEtagere(60_000);
        else if (t === "leave") {
          if (fermetureEtagere) clearTimeout(fermetureEtagere);
          fermetureEtagere = setTimeout(fermerEtagere, 600);
        } else if (t === "drop") {
          if (e.payload.paths.length > 0) void backend.etagereAjouter(e.payload.paths);
          ouvrirEtagere(5000);
        }
      }),
    );
  }
  // L'horloge au survol ne reste jamais à côté d'une autre activité (ni dans la bulle).
  arrets.push(
    Promise.resolve(
      machine.abonner((e) => {
        if (e.activites.length > 1 && e.activites.some((a) => a.id === "horloge")) {
          queueMicrotask(() => machine.envoyer({ type: "ACTIVITE_FIN", id: "horloge" }));
        }
      }),
    ),
  );
  arrets.push(
    ecouter("appel", (a) => {
      majDonnees({ appel: a.actif ? { application: a.application ?? "Appel", debutMs: Date.now(), muet: false } : null });
      if (a.actif) void backend.microMuet(null).then((m) => majDonnees({ appel: { application: a.application ?? "Appel", debutMs: Date.now(), muet: Boolean(m) } }));
      if (a.actif) terminerAppelEntrant(); // l'appel a commencé
      envoyer(traducteur.appel(a));
    }),
  );
  // Minuteur : celui de l'app s'il tourne, sinon celui lu dans l'Horloge de Windows.
  let minuteurApp: EtatMinuteur | null = null;
  let minuteurHorloge: EtatMinuteur | null = null;
  const minuteurEffectif = () =>
    minuteurApp && (minuteurApp.statut === "enCours" || minuteurApp.statut === "pause")
      ? minuteurApp
      : minuteurHorloge && minuteurHorloge.statut === "enCours"
        ? minuteurHorloge
        : (minuteurApp ?? minuteurHorloge);
  const publierMinuteur = () => {
    const m = minuteurEffectif();
    if (!m) return;
    majDonnees({ minuteur: m });
    envoyer(traducteur.minuteurEtat(m));
  };
  arrets.push(
    ecouter("minuteur-horloge", (m) => {
      minuteurHorloge = { ...m, source: "horloge" };
      publierMinuteur();
    }),
  );
  // Enregistrement de l'écran (Outil Capture en vidéo, Game Bar…) : activité « point rouge ».
  let enregistrement = false;
  arrets.push(
    ecouter("confidentialite", (c) => {
      majDonnees({ confidentialite: c });
      const ecran = c.ecran === true;
      if (ecran && !enregistrement) {
        machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "enregistrement", type: "enregistrement", donnees: { debutMs: Date.now() } } });
      } else if (!ecran && enregistrement) {
        machine.envoyer({ type: "ACTIVITE_FIN", id: "enregistrement" });
      }
      enregistrement = ecran;
    }),
  );
  // Déverrouillage de la session : cadenas qui s'ouvre (comme Face ID).
  arrets.push(
    ecouter("session", (verrouillee) => {
      if (!verrouillee) envoyer([{ type: "ALERTE", alerte: { type: "deverrouillage", dureeFacteur: 0.5 } }]);
    }),
  );
  arrets.push(ecouter("sortie-audio", (s) => envoyer([{ type: "ALERTE", alerte: { type: "sortieAudio", donnees: s } }])));
  arrets.push(ecouter("micro-muet", (m) => envoyer([{ type: "ALERTE", alerte: { type: "micro", donnees: m } }])));
  // Menu de l'île → « Mise à jour » : vérifier maintenant.
  const verifierMaj = () => {
    void backend
      .verifierMaj()
      .then((n) => envoyer([{ type: "ALERTE", alerte: { type: "nouvelleVersion", donnees: n ?? { version: "", url: "" }, dureeFacteur: n ? 3 : 1 } }]))
      .catch(() => envoyer([{ type: "ALERTE", alerte: { type: "internet", donnees: { connecte: false, nom: null } } }]));
  };
  window.addEventListener("ile-maj", verifierMaj);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-maj", verifierMaj)));
  arrets.push(ecouter("nouvelle-version", (n) => envoyer([{ type: "ALERTE", alerte: { type: "nouvelleVersion", donnees: n, dureeFacteur: 3 } }])));
  arrets.push(ecouter("ventilateurs", (s) => majDonnees({ ventilo: s })));
  // Météo : affichée au survol (horloge) ; alerte quand la pluie ou la neige arrive dans l'heure.
  let alertePluieA = 0;
  arrets.push(
    ecouter("meteo", (m) => {
      const avant = donnees().meteo;
      majDonnees({ meteo: m });
      const arrive = m.precipitationDans !== null && (avant?.precipitationDans ?? null) === null;
      if (arrive && Date.now() - alertePluieA > 90 * 60_000) {
        alertePluieA = Date.now();
        envoyer([{ type: "ALERTE", alerte: { type: "meteo", donnees: { precipitationDans: m.precipitationDans, neige: m.neige }, dureeFacteur: 1.3 } }]);
      }
    }),
  );
  arrets.push(ecouter("vpn", (n) => envoyer([{ type: "ALERTE", alerte: { type: "vpn", donnees: n } }])));

  // Chronomètre (menu de l'île) : démarrer, pause, reprendre, tour, arrêter.
  const actionChrono = (e: Event) => {
    const action = (e as CustomEvent<string>).detail;
    const c = donnees().chrono;
    const maintenant = Date.now();
    if (action === "demarrer") {
      if (!c) {
        majDonnees({ chrono: { cumulMs: 0, debutMs: maintenant, tours: [] } });
        machine.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "chrono", type: "chrono" } });
      }
      machine.envoyer({ type: "CLIC_LONG" });
    } else if (!c) return;
    else if (action === "pause" && c.debutMs !== null) majDonnees({ chrono: { ...c, cumulMs: c.cumulMs + maintenant - c.debutMs, debutMs: null } });
    else if (action === "reprendre" && c.debutMs === null) majDonnees({ chrono: { ...c, debutMs: maintenant } });
    else if (action === "tour") majDonnees({ chrono: { ...c, tours: [...c.tours, c.cumulMs + (c.debutMs !== null ? maintenant - c.debutMs : 0)] } });
    else if (action === "arreter") {
      majDonnees({ chrono: null });
      machine.envoyer({ type: "ACTIVITE_FIN", id: "chrono" });
    }
  };
  window.addEventListener("ile-chrono", actionChrono);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-chrono", actionChrono)));

  // Texte d'une image : la capture (Win+Maj+S) qui suit est lue par l'OCR de Windows.
  const lancerOcr = () => {
    ocrDemandeA = Date.now();
    void backend.ouvrirLien("ms-screenclip:");
  };
  window.addEventListener("ile-ocr", lancerOcr);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-ocr", lancerOcr)));
  arrets.push(
    ecouter("presse-papiers", (p) => {
      if (!ocrEnAttente() || (p.type !== "capture" && p.type !== "image")) return;
      ocrDemandeA = 0;
      pressePapiersMuetJusqua = Date.now() + 4000; // le texte trouvé est recopié : pas d'alerte en plus
      void backend
        .ocrPressePapiers()
        .finally(() => (pressePapiersMuetJusqua = Date.now() + 1500))
        .then((t) => envoyer([{ type: "ALERTE", alerte: { type: "texteImage", donnees: { ok: true, nombre: t.split(/\s+/).filter(Boolean).length } } }]))
        .catch(() => envoyer([{ type: "ALERTE", alerte: { type: "texteImage", donnees: { ok: false } } }]));
    }),
  );

  // Comptes à rebours (réglages) : rappel au démarrage et au premier déverrouillage du jour.
  let jourRappel = "";
  const rappelerComptes = () => {
    const aujourdhui = new Date().toDateString();
    if (jourRappel === aujourdhui) return;
    const comptes = (preferencesActuelles().comptesARebours ?? [])
      .map((c) => ({ nom: c.nom, jours: Math.round((new Date(`${c.date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000) }))
      .filter((c) => c.jours >= 0 && c.jours <= 30)
      .sort((a, b) => a.jours - b.jours);
    if (comptes.length === 0) return;
    jourRappel = aujourdhui;
    envoyer(comptes.slice(0, 2).map((c) => ({ type: "ALERTE" as const, alerte: { type: "compteARebours" as const, donnees: c, dureeFacteur: 1.5 } })));
  };
  setTimeout(rappelerComptes, 8000);
  arrets.push(ecouter("session", (verrouillee) => !verrouillee && setTimeout(rappelerComptes, 2500)));
  arrets.push(ecouter("wifi-faible", (w) => envoyer([{ type: "ALERTE", alerte: { type: "wifiFaible", donnees: w } }])));
  arrets.push(ecouter("bureau", (b) => envoyer([{ type: "ALERTE", alerte: { type: "bureau", donnees: b, dureeFacteur: 0.6 } }])));
  // Écran externe branché / débranché.
  let ecransConnus: string[] | null = null;
  arrets.push(
    ecouter("ecrans-changes", (ecrans) => {
      const ids = ecrans.map((e) => e.id);
      if (ecransConnus) {
        const ajoute = ids.find((i) => !ecransConnus!.includes(i));
        const retire = ecransConnus.find((i) => !ids.includes(i));
        if (ajoute || retire) {
          const e = ecrans.find((x) => x.id === ajoute);
          const nom = e ? `Écran ${ids.indexOf(ajoute!) + 1} · ${e.rect.largeur}×${e.rect.hauteur}` : "Écran";
          envoyer([{ type: "ALERTE", alerte: { type: "ecranExterne", donnees: { branche: Boolean(ajoute), nom } } }]);
        }
      }
      ecransConnus = ids;
    }),
  );
  void backend.ecrans().then((e) => {
    if (e && !ecransConnus) ecransConnus = e.map((x) => x.id);
  });
  // Panneau de réglages (Ctrl+Alt+D).
  arrets.push(ecouter("config-direct", (s) => definirSurcharges(s)));
  arrets.push(
    ecouter("declencher", (nom) => {
      if (nom in SCENARIOS) jouer(machine, nom as NomScenario);
    }),
  );
  arrets.push(ecouter("ne-pas-deranger", (n) => envoyer(traducteur.nePasDerangerEtat(n))));
  // Appel qui sonne : carte d'appel 30 s au plus (ou jusqu'à Répondre / Refuser, ou
  // jusqu'à ce que l'appel commence vraiment : micro utilisé).
  let finAppelEntrant: ReturnType<typeof setTimeout> | null = null;
  const terminerAppelEntrant = () => {
    if (finAppelEntrant) clearTimeout(finAppelEntrant);
    finAppelEntrant = null;
    if (!donnees().appelEntrant) return;
    majDonnees({ appelEntrant: null });
    machine.envoyer({ type: "ACTIVITE_FIN", id: ID_APPEL_ENTRANT });
  };
  window.addEventListener("ile-appel-entrant-fin", terminerAppelEntrant);
  arrets.push(Promise.resolve(() => window.removeEventListener("ile-appel-entrant-fin", terminerAppelEntrant)));
  arrets.push(
    ecouter("notification", (n) => {
      if (appIgnoree(n.application)) return;
      // L'app de musique annonce chaque chanson par une notification : l'île la montre déjà.
      const m = donnees().media;
      const texte = n.textes.join(" ").toLowerCase();
      if (m?.titre && texte.includes(m.titre.toLowerCase())) return;
      if (/apple music|spotify|deezer|tidal|amazon music|youtube music/i.test(n.application)) return;
      const appel = appelEntrant(n);
      if (appel) {
        majDonnees({ appelEntrant: appel });
        if (finAppelEntrant) clearTimeout(finAppelEntrant);
        finAppelEntrant = setTimeout(terminerAppelEntrant, 30_000);
      }
      envoyer(traducteur.notification(n));
    }),
  );
  arrets.push(
    ecouter("impression", (i) => {
      majDonnees({ impressions: i.enCours });
      envoyer(traducteur.impression(i));
    }),
  );
  // Windows Update attend un redémarrage : alerte, puis rappel toutes les 4 h (« Plus tard »).
  let redemarrageRequis = false;
  const rappelerMiseAJour = () => {
    if (redemarrageRequis) envoyer([{ type: "ALERTE", alerte: { type: "miseAJour", dureeFacteur: 3 } }]);
  };
  arrets.push(
    ecouter("redemarrage-requis", (requis) => {
      redemarrageRequis = requis;
      rappelerMiseAJour();
    }),
  );
  const rappels = setInterval(rappelerMiseAJour, 4 * 3600_000);
  arrets.push(Promise.resolve(() => clearInterval(rappels)));
  arrets.push(
    ecouter("survol", (s) => {
      envoyer(traducteur.survol(s));
      horlogeAuSurvol(s);
    }),
  );
  arrets.push(ecouter("clic-exterieur", () => envoyer(traducteur.clicExterieur())));
  arrets.push(
    ecouter("ecran", (info) => {
      ecranCourant.info = info;
      majDonnees({ fenetre: info });
    }),
  );

  // 3. Effets de la machine vers le backend + journal des transitions.
  let ecouteExterieur = false;
  const desabonner = machine.abonner((etat, effets, ev) => {
    for (const effet of effets) {
      if (effet.type === "transition") {
        const t = effet.transition;
        log("machine", `${t.de} → ${t.vers} (ressort « ${t.ressort} »${t.interrompt ? `, interrompt #${t.interrompt}` : ""})`, {
          evenement: ev.type,
          principale: etat.principaleId,
          bulle: etat.bulleId,
        });
      } else if (effet.type === "activer") {
        log("machine", `activer « ${effet.activiteId} » (ouvrir l'app source : phase 2)`);
      }
    }
    // Les clics hors de l'île ne sont écoutés qu'en mode étendu.
    const voulu = etat.mode === "etendu";
    if (voulu !== ecouteExterieur) {
      ecouteExterieur = voulu;
      void backend.ecouterClicExterieur(voulu);
    }
  });

  // 4. État initial (les zones touchables sont envoyées par le rendu, src/rendu/Ile.tsx).
  //    Aussi appelé après « Arrêter le test » : on revient aux VRAIES données.
  const synchroniser = (journaliser: boolean) =>
    Promise.all([
      backend.infoFenetre(),
      backend.media(),
      backend.batterie(),
      backend.volume(),
      backend.nePasDeranger(),
      backend.notifications(),
      backend.minuteur(),
      backend.confidentialite(),
    ]).then(([fenetre, media, batterie, volume, npd, notifs, minuteur, confidentialite]) => {
      ecranCourant.info = fenetre;
      majDonnees({ fenetre, media, batterie, volume, pochette: null, confidentialite: confidentialite ?? { camera: false, micro: false } });
      void backend.pochette().then((p) => p && majDonnees({ pochette: p }));
      if (journaliser) {
        log("init", {
          fenetre,
          tauxRafraichissementHz: fenetre?.ecran.frequenceHz ?? "inconnu",
          media,
          batterie,
          volume,
          nePasDeranger: npd,
          notifications: notifs,
          minuteur,
        });
      }
      envoyer(traducteur.batterieEtat(batterie));
      envoyer(traducteur.nePasDerangerEtat(npd));
      envoyer(traducteur.media(media));
      minuteurApp = { ...minuteur, source: "app" };
      publierMinuteur();
    });
  void synchroniser(true);

  // Taille choisie par l'utilisateur (mémorisée par le backend).
  let partageApplique: boolean | null = null;
  const appliquer = (p: { taille: number; affichage?: Record<string, unknown> }) => {
    definirPreferences({ ...((p.affichage ?? {}) as Preferences), ISLAND_SCALE: p.taille });
    // Cacher au partage d'écran : appliqué au démarrage et à chaque changement.
    const partage = preferencesActuelles().cacherPartage === true;
    if (partage !== partageApplique) {
      partageApplique = partage;
      void backend.cacherAuPartage(partage);
    }
  };
  void backend.parametres().then((p) => p && appliquer(p));
  arrets.push(ecouter("parametres", appliquer));

  // « Arrêter le test » (panneau, menu de l'icône, fermeture du panneau) : tout effacer,
  // oublier les réglages temporaires, puis revenir à l'état réel de Windows.
  arrets.push(
    ecouter("reinitialiser", () => {
      log("pont", "réinitialisation : retour aux vraies données");
      definirSurcharges({});
      nettoyerTests();
      majDonnees({ appel: null });
      machine.envoyer({ type: "REINITIALISER" });
      traducteur = new Traducteur();
      void synchroniser(false);
    }),
  );

  return () => {
    desabonner();
    machine.detruire();
    arrets.forEach((p) => void p.then((arreter) => arreter()));
  };
}
