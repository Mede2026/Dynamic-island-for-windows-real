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
import { majDonnees } from "./donnees";
import { recevoirNiveau } from "../rendu/onde";
import type { EtatMedia, EtatMinuteur } from "./types";
import { appIgnoree, definirPreferences, definirSurcharges, preferencesActuelles, type Preferences } from "../config/store";
import { jouer, nettoyerTests, SCENARIOS, type NomScenario } from "../demo/scenarios";
import { Traducteur } from "./traducteur";
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
    void backend
      .parolesChercher(m.artiste, m.titre, m.album, dureeS)
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
      const ignoree = appIgnoree(m.sourceActive);
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
  arrets.push(ecouter("presse-papiers", (p) => envoyer(traducteur.pressePapiers(p))));
  arrets.push(ecouter("niveau-audio", (n) => recevoirNiveau(n)));
  arrets.push(ecouter("luminosite", (n) => envoyer(traducteur.luminosite(n))));
  arrets.push(ecouter("verrouillage", (v) => envoyer(traducteur.verrouillage(v))));
  arrets.push(ecouter("usb", (u) => envoyer(traducteur.usb(u))));
  arrets.push(ecouter("bluetooth", (b) => envoyer(traducteur.bluetooth(b))));
  arrets.push(ecouter("internet", (i) => envoyer(traducteur.internet(i))));
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
  const etagere = (liste: string[]) => {
    majDonnees({ etagere: liste });
    envoyer(traducteur.etagere(liste));
  };
  arrets.push(ecouter("etagere", etagere));
  void backend.etagereLire().then((l) => l && etagere(l));
  // Fichiers glissés sur l'île → l'étagère.
  if (dansTauri()) {
    arrets.push(
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop" && e.payload.paths.length > 0) void backend.etagereAjouter(e.payload.paths);
      }),
    );
  }
  arrets.push(
    ecouter("appel", (a) => {
      majDonnees({ appel: a.actif ? { application: a.application ?? "Appel", debutMs: Date.now(), muet: false } : null });
      if (a.actif) void backend.microMuet(null).then((m) => majDonnees({ appel: { application: a.application ?? "Appel", debutMs: Date.now(), muet: Boolean(m) } }));
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
  arrets.push(ecouter("confidentialite", (c) => majDonnees({ confidentialite: c })));
  // Panneau de réglages (Ctrl+Alt+D).
  arrets.push(ecouter("config-direct", (s) => definirSurcharges(s)));
  arrets.push(
    ecouter("declencher", (nom) => {
      if (nom in SCENARIOS) jouer(machine, nom as NomScenario);
    }),
  );
  arrets.push(ecouter("ne-pas-deranger", (n) => envoyer(traducteur.nePasDerangerEtat(n))));
  arrets.push(
    ecouter("notification", (n) => {
      if (!appIgnoree(n.application)) envoyer(traducteur.notification(n));
    }),
  );
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
