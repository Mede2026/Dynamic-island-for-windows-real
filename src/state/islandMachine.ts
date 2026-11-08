/**
 * islandMachine.ts — machine à états de l'île (LOGIQUE SEULEMENT, aucun rendu).
 *
 * Idée générale :
 *  - `reduire(etat, evenement)` est une fonction PURE : elle reçoit l'état actuel et
 *    un événement, et renvoie le nouvel état + une liste d'« effets » (minuteries à
 *    démarrer/annuler, actions à envoyer au backend).
 *  - `IslandMachine` est le « moteur » : il garde une FILE d'événements (traités un
 *    par un, jamais deux en même temps), exécute les effets (setTimeout) et prévient
 *    les abonnés (le futur rendu React).
 *
 * Interruption : chaque changement d'état visuel crée une `Transition` avec un
 * numéro unique. Si une nouvelle transition arrive avant la fin de la précédente,
 * elle porte `interrompt: <numéro précédent>` ; le rendu (phase 2) relancera alors
 * les ressorts depuis la position et la vitesse ACTUELLES (Framer Motion le fait
 * nativement quand on change la cible d'une animation en cours).
 */

import { islandConfig, type EtatIle, type NomTransition } from "../island.config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Activités longues (affichées en compact / split / étendu). */
export type TypeActivite = "minuteur" | "musique" | "appel" | "horloge" | "telechargement" | "etagere" | "ecoute" | "impression" | "appelEntrant" | "enregistrement" | "menu" | "chrono" | "outil";

/** Alertes brèves (affichées puis retour automatique). */
export type TypeAlerte =
  | "batterie"
  | "chargeur"
  | "volume"
  | "neDerangePas"
  | "notification"
  | "minuteurTermine"
  | "pressePapiers"
  | "luminosite"
  | "capture"
  | "verrouillage"
  | "usb"
  | "bluetooth"
  | "telechargementTermine"
  | "internet"
  | "pause"
  | "chanson"
  | "impression"
  | "miseAJour"
  | "deverrouillage"
  | "sortieAudio"
  | "micro"
  | "economie"
  | "ecranExterne"
  | "bureau"
  | "wifiFaible"
  | "nouvelleVersion"
  | "vpn"
  | "texteImage"
  | "compteARebours"
  | "meteo"
  | "pipette";

/**
 * Priorités : plus le nombre est grand, plus l'activité est importante.
 * Une alerte passe toujours devant toutes les activités (état `alerte`).
 * Ordre MESURÉ sur iPhone (iOS 27) : alerte > musique > minuteur — un minuteur lancé
 * pendant la musique va dans la bulle (capture split fournie + V4728).
 */
export const PRIORITES: Record<TypeActivite, number> = {
  appel: 3, // un appel passe devant tout (comme sur iPhone)
  musique: 2,
  minuteur: 1,
  telechargement: 1,
  impression: 1,
  enregistrement: 2.8, // enregistrement de l'écran : bien visible, comme sur iPhone
  appelEntrant: 4, // appel qui sonne : devant tout, comme sur iPhone
  menu: 5,
  outil: 5, // recherche, minuteur, copiés, note : ouverts DANS l'île, à la demande
  chrono: 1.5, // menu ouvert par un clic droit : demandé à l'instant
  ecoute: 2.5, // « Quelle est cette chanson ? » : demandé à l'instant, passe devant la musique
  etagere: 3.5, // ouverte seulement à la demande (fichiers glissés, Ctrl+Alt+E) : devant
  horloge: 0, // horloge au survol de l'île au repos : cède la place à tout le reste
};

export interface Activite {
  id: string;
  type: TypeActivite;
  /** Données libres (titre, temps restant…). */
  donnees?: unknown;
  /** Ordre d'arrivée (rempli par la machine). Sert à départager deux priorités égales. */
  ordre?: number;
}

export interface Alerte {
  type: TypeAlerte;
  donnees?: unknown;
  /** Multiplie la durée d'affichage (ex. 2 pour un code à copier : le temps de cliquer). */
  dureeFacteur?: number;
}

/** Où le clic a eu lieu en mode split. */
export type Cible = "principal" | "bulle";

export type NomMinuterie = "alerte" | "fermetureEtendu" | "alerteMin";

export interface Transition {
  id: number;
  de: EtatIle;
  vers: EtatIle;
  /** Clé du ressort à utiliser dans island.config.ts. */
  ressort: NomTransition;
  /** Numéro de la transition interrompue (encore en cours), sinon null. */
  interrompt: number | null;
}

export interface EtatMachine {
  mode: EtatIle;
  /** Activités en cours, triées par priorité décroissante. */
  activites: Activite[];
  /** Activité affichée dans l'île principale (compact/split/étendu). */
  principaleId: string | null;
  /** Activité affichée dans la bulle (split seulement). */
  bulleId: string | null;
  /** Activité affichée en grand (état étendu). */
  etendueId: string | null;
  alerte: Alerte | null;
  /** Alertes arrivées pendant qu'une autre s'affiche : chacune aura ses 3 s, dans l'ordre. */
  alertesEnAttente: Alerte[];
  /** L'alerte affichée a-t-elle eu son temps minimum (3 s) ? */
  alerteMinFaite: boolean;
  survol: boolean;
  appuye: boolean;
  /** Transition en cours (null quand l'île est immobile). */
  transition: Transition | null;
  /** Compteurs internes. */
  prochainIdTransition: number;
  prochainOrdre: number;
  /** Jeton de chaque minuterie active : un TIMEOUT avec un vieux jeton est ignoré. */
  minuteries: Partial<Record<NomMinuterie, number>>;
  prochainJeton: number;
}

export type Evenement =
  | { type: "ACTIVITE_DEBUT"; activite: Activite }
  | { type: "ACTIVITE_MAJ"; id: string; donnees: unknown }
  | { type: "ACTIVITE_FIN"; id: string }
  | { type: "ALERTE"; alerte: Alerte }
  | { type: "CLIC"; cible?: Cible }
  | { type: "CLIC_LONG"; cible?: Cible }
  | { type: "CLIC_EXTERIEUR" }
  | { type: "SURVOL_DEBUT" }
  | { type: "SURVOL_FIN" }
  | { type: "APPUI_DEBUT" }
  | { type: "APPUI_FIN" }
  | { type: "MINUTERIE"; nom: NomMinuterie; jeton: number }
  | { type: "TRANSITION_FIN"; id: number }
  /** Tout effacer (fin d'un test du panneau) : activités, alerte, état étendu. */
  | { type: "REINITIALISER" };

export type Effet =
  | { type: "demarrerMinuterie"; nom: NomMinuterie; jeton: number; delaiMs: number | null }
  | { type: "annulerMinuterie"; nom: NomMinuterie }
  /** Clic court sur une activité : ouvrir l'application source (ex. Spotify). */
  | { type: "activer"; activiteId: string }
  | { type: "transition"; transition: Transition };

export interface Durees {
  alerteAffichageMs: number | null;
  etenduFermetureAutoMs: number | null;
}

export interface Resultat {
  etat: EtatMachine;
  effets: Effet[];
}

// ---------------------------------------------------------------------------
// État initial et fonctions utilitaires
// ---------------------------------------------------------------------------

/** Affiche une alerte : minuterie de fin (durée × facteur) et minimum de 3 s si elle est nouvelle. */
function afficherAlerte(avant: EtatMachine, e: EtatMachine, alerte: Alerte, nouvelle: boolean, durees: Durees, effets: Effet[]): EtatMachine {
  e = stabiliser(avant, { ...e, alerte }, effets);
  e = annuler(e, "alerte", effets);
  e = demarrer(e, "alerte", durees.alerteAffichageMs === null ? null : durees.alerteAffichageMs * (alerte.dureeFacteur ?? 1), effets);
  if (nouvelle && durees.alerteAffichageMs !== null) {
    e = annuler({ ...e, alerteMinFaite: false }, "alerteMin", effets);
    e = demarrer(e, "alerteMin", Math.min(durees.alerteAffichageMs, 3000), effets);
  }
  return e;
}

/** Fin de l'alerte affichée : la suivante en attente, sinon plus d'alerte. */
function alerteSuivante(avant: EtatMachine, e: EtatMachine, durees: Durees, effets: Effet[]): EtatMachine {
  e = annuler(annuler(e, "alerte", effets), "alerteMin", effets);
  const [suivante, ...reste] = e.alertesEnAttente;
  if (suivante) return afficherAlerte(avant, { ...e, alertesEnAttente: reste }, suivante, true, durees, effets);
  return stabiliser(avant, { ...e, alerte: null, alerteMinFaite: true }, effets);
}

export function etatInitial(): EtatMachine {
  return {
    mode: "repos",
    activites: [],
    principaleId: null,
    bulleId: null,
    etendueId: null,
    alerte: null,
    alertesEnAttente: [],
    alerteMinFaite: true,
    survol: false,
    appuye: false,
    transition: null,
    prochainIdTransition: 1,
    prochainOrdre: 1,
    minuteries: {},
    prochainJeton: 1,
  };
}

function trierActivites(activites: Activite[]): Activite[] {
  return [...activites].sort(
    (a, b) => PRIORITES[b.type] - PRIORITES[a.type] || (b.ordre ?? 0) - (a.ordre ?? 0),
  );
}

/** Calcule le mode visuel à partir des données (source unique de vérité). */
export function calculerMode(e: Pick<EtatMachine, "activites" | "etendueId" | "alerte">): EtatIle {
  if (e.alerte) return "alerte";
  if (e.etendueId && e.activites.some((a) => a.id === e.etendueId)) return "etendu";
  if (e.activites.length === 0) return "repos";
  if (e.activites.length === 1) return "compact";
  return "split";
}

/** Choisit le ressort (island.config.ts → ressorts) pour passer de `de` à `vers`. */
export function ressortPour(de: EtatIle, vers: EtatIle): NomTransition {
  if (vers === "alerte") return "alerteEntree";
  if (de === "alerte") return "alerteSortie";
  if (de === vers) return "changementContenu";
  if (vers === "etendu") return "ouvrir";
  if (de === "etendu") return "fermer";
  if (de === "repos") return "apparition";
  if (vers === "repos") return "disparition";
  if (de === "compact" && vers === "split") return "compactVersSplit";
  if (de === "split" && vers === "compact") return "splitVersCompact";
  // Cas restants (ex. split → repos si deux activités finissent d'un coup).
  return vers === "split" ? "compactVersSplit" : "disparition";
}

// ---------------------------------------------------------------------------
// Réducteur pur
// ---------------------------------------------------------------------------

/**
 * Recalcule mode / principale / bulle après un changement de données et crée
 * une transition si ce qui est affiché a changé.
 */
function stabiliser(avant: EtatMachine, apres: EtatMachine, effets: Effet[]): EtatMachine {
  const activites = trierActivites(apres.activites);
  let etendueId = apres.etendueId;
  if (etendueId && !activites.some((a) => a.id === etendueId)) etendueId = null;

  const mode = calculerMode({ activites, etendueId, alerte: apres.alerte });
  const principaleId = etendueId ?? activites[0]?.id ?? null;
  const bulleId = mode === "split" ? (activites.find((a) => a.id !== principaleId)?.id ?? null) : null;

  let suivant: EtatMachine = { ...apres, activites, etendueId, mode, principaleId, bulleId };

  const visibleAChange =
    mode !== avant.mode ||
    principaleId !== avant.principaleId ||
    bulleId !== avant.bulleId ||
    (mode === "alerte" && apres.alerte?.type !== avant.alerte?.type);

  if (visibleAChange) {
    const transition: Transition = {
      id: suivant.prochainIdTransition,
      de: avant.mode,
      vers: mode,
      ressort: ressortPour(avant.mode, mode),
      interrompt: avant.transition?.id ?? null,
    };
    suivant = { ...suivant, transition, prochainIdTransition: transition.id + 1 };
    effets.push({ type: "transition", transition });
  }

  // Quitter l'état étendu annule sa fermeture automatique.
  if (suivant.mode !== "etendu" && suivant.minuteries.fermetureEtendu !== undefined) {
    suivant = annuler(suivant, "fermetureEtendu", effets);
  }
  return suivant;
}

function demarrer(e: EtatMachine, nom: NomMinuterie, delaiMs: number | null, effets: Effet[]): EtatMachine {
  const jeton = e.prochainJeton;
  effets.push({ type: "demarrerMinuterie", nom, jeton, delaiMs });
  return { ...e, minuteries: { ...e.minuteries, [nom]: jeton }, prochainJeton: jeton + 1 };
}

function annuler(e: EtatMachine, nom: NomMinuterie, effets: Effet[]): EtatMachine {
  if (e.minuteries[nom] === undefined) return e;
  effets.push({ type: "annulerMinuterie", nom });
  const minuteries = { ...e.minuteries };
  delete minuteries[nom];
  return { ...e, minuteries };
}

/**
 * Fonction pure : (état, événement) → (nouvel état, effets).
 * Ne lit jamais l'horloge, ne lance jamais de minuterie elle-même.
 */
export function reduire(etat: EtatMachine, ev: Evenement, durees: Durees): Resultat {
  const effets: Effet[] = [];
  let e: EtatMachine = etat;

  switch (ev.type) {
    case "ACTIVITE_DEBUT": {
      const existante = e.activites.find((a) => a.id === ev.activite.id);
      const activite: Activite = { ...ev.activite, ordre: existante?.ordre ?? e.prochainOrdre };
      e = {
        ...e,
        activites: [...e.activites.filter((a) => a.id !== activite.id), activite],
        prochainOrdre: existante ? e.prochainOrdre : e.prochainOrdre + 1,
      };
      e = stabiliser(etat, e, effets);
      break;
    }

    case "ACTIVITE_MAJ": {
      if (!e.activites.some((a) => a.id === ev.id)) return { etat, effets };
      e = { ...e, activites: e.activites.map((a) => (a.id === ev.id ? { ...a, donnees: ev.donnees } : a)) };
      break;
    }

    case "ACTIVITE_FIN": {
      if (!e.activites.some((a) => a.id === ev.id)) return { etat, effets };
      e = { ...e, activites: e.activites.filter((a) => a.id !== ev.id) };
      e = stabiliser(etat, e, effets);
      break;
    }

    case "ALERTE": {
      // Une autre alerte s'affiche depuis moins de 3 s : celle-ci attend son tour (une seule
      // par type : la plus récente). Même type (volume qui change encore) : mise à jour sur place.
      if (e.alerte && e.alerte.type !== ev.alerte.type && !e.alerteMinFaite && durees.alerteAffichageMs !== null) {
        e = { ...e, alertesEnAttente: [...e.alertesEnAttente.filter((a) => a.type !== ev.alerte.type), ev.alerte] };
        break;
      }
      e = afficherAlerte(etat, e, ev.alerte, ev.alerte.type !== e.alerte?.type, durees, effets);
      break;
    }

    case "MINUTERIE": {
      if (e.minuteries[ev.nom] !== ev.jeton) return { etat, effets }; // minuterie périmée
      const minuteries = { ...e.minuteries };
      delete minuteries[ev.nom];
      e = { ...e, minuteries };
      if (ev.nom === "alerte") {
        e = alerteSuivante(etat, e, durees, effets);
      } else if (ev.nom === "alerteMin") {
        e = { ...e, alerteMinFaite: true };
        // Quelqu'un attend : l'alerte affichée a eu ses 3 s, on passe à la suivante.
        if (e.alertesEnAttente.length > 0) e = alerteSuivante(etat, e, durees, effets);
      } else if (ev.nom === "fermetureEtendu" && e.mode === "etendu" && !e.survol && !e.activites.some((a) => a.type === "outil")) {
        // (un outil ouvert dans l'île — note, recherche… — ne se ferme pas tout seul pendant qu'on tape)
        e = stabiliser(etat, { ...e, etendueId: null }, effets);
      }
      break;
    }

    case "CLIC": {
      if (e.mode === "alerte") {
        // Toucher une alerte la ferme tout de suite (la suivante en attente s'affiche).
        e = alerteSuivante(etat, e, durees, effets);
      } else if (e.mode === "compact" || e.mode === "split") {
        const id = ev.cible === "bulle" ? e.bulleId : e.principaleId;
        if (id) effets.push({ type: "activer", activiteId: id });
      }
      // En étendu, les clics sur les boutons sont gérés par le rendu (phase 2).
      break;
    }

    case "CLIC_LONG": {
      if (e.mode === "compact" || e.mode === "split") {
        const id = ev.cible === "bulle" ? e.bulleId : e.principaleId;
        if (id) e = stabiliser(etat, { ...e, etendueId: id }, effets);
      }
      break;
    }

    case "CLIC_EXTERIEUR": {
      if (e.mode === "etendu") e = stabiliser(etat, { ...e, etendueId: null }, effets);
      break;
    }

    case "SURVOL_DEBUT": {
      e = { ...e, survol: true };
      e = annuler(e, "fermetureEtendu", effets);
      break;
    }

    case "SURVOL_FIN": {
      e = { ...e, survol: false, appuye: false };
      if (e.mode === "etendu") e = demarrer(e, "fermetureEtendu", durees.etenduFermetureAutoMs, effets);
      break;
    }

    case "APPUI_DEBUT":
      e = { ...e, appuye: true };
      break;

    case "APPUI_FIN":
      e = { ...e, appuye: false };
      break;

    case "TRANSITION_FIN": {
      if (e.transition?.id === ev.id) e = { ...e, transition: null };
      break;
    }

    case "REINITIALISER": {
      e = annuler(e, "alerte", effets);
      e = annuler(e, "alerteMin", effets);
      e = annuler(e, "fermetureEtendu", effets);
      e = stabiliser(etat, { ...e, activites: [], alerte: null, alertesEnAttente: [], alerteMinFaite: true, etendueId: null, survol: false, appuye: false }, effets);
      break;
    }
  }

  return { etat: e, effets };
}

// ---------------------------------------------------------------------------
// Moteur : file d'événements + minuteries
// ---------------------------------------------------------------------------

export interface Horloge {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const horlogeSysteme: Horloge = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type Abonne = (etat: EtatMachine, effets: Effet[], evenement: Evenement) => void;

export class IslandMachine {
  private etatCourant: EtatMachine = etatInitial();
  private file: Evenement[] = [];
  private enTraitement = false;
  private abonnes = new Set<Abonne>();
  private minuteriesActives = new Map<NomMinuterie, unknown>();

  constructor(
    /** Durées fixes, ou fonction relue à chaque événement (préférences modifiables en direct). */
    private readonly durees: Durees | (() => Durees) = {
      alerteAffichageMs: islandConfig.durees.alerteAffichageMs,
      etenduFermetureAutoMs: islandConfig.durees.etenduFermetureAutoMs,
    },
    private readonly horloge: Horloge = horlogeSysteme,
    private readonly avertir: (msg: string) => void = (msg) => console.warn(msg),
  ) {}

  get etat(): EtatMachine {
    return this.etatCourant;
  }

  abonner(fn: Abonne): () => void {
    this.abonnes.add(fn);
    return () => this.abonnes.delete(fn);
  }

  /**
   * Ajoute un événement à la file. Les événements sont traités UN PAR UN dans
   * l'ordre d'arrivée — même si un abonné en envoie un autre pendant le traitement.
   */
  envoyer(ev: Evenement): void {
    this.file.push(ev);
    if (this.enTraitement) return;
    this.enTraitement = true;
    try {
      while (this.file.length > 0) {
        const suivant = this.file.shift()!;
        const durees = typeof this.durees === "function" ? this.durees() : this.durees;
        const { etat, effets } = reduire(this.etatCourant, suivant, durees);
        this.etatCourant = etat;
        this.executer(effets);
        for (const fn of this.abonnes) fn(etat, effets, suivant);
      }
    } finally {
      this.enTraitement = false;
    }
  }

  /** Arrête toutes les minuteries (à appeler quand l'app se ferme). */
  detruire(): void {
    for (const id of this.minuteriesActives.values()) this.horloge.clearTimeout(id);
    this.minuteriesActives.clear();
    this.abonnes.clear();
  }

  private executer(effets: Effet[]): void {
    for (const effet of effets) {
      if (effet.type === "annulerMinuterie") {
        const id = this.minuteriesActives.get(effet.nom);
        if (id !== undefined) this.horloge.clearTimeout(id);
        this.minuteriesActives.delete(effet.nom);
      } else if (effet.type === "demarrerMinuterie") {
        const ancien = this.minuteriesActives.get(effet.nom);
        if (ancien !== undefined) this.horloge.clearTimeout(ancien);
        if (effet.delaiMs === null) {
          this.avertir(
            `[islandMachine] durée « ${effet.nom} » pas encore mesurée (island.config.ts = null) : pas de retour automatique.`,
          );
          this.minuteriesActives.delete(effet.nom);
          continue;
        }
        const { nom, jeton } = effet;
        const id = this.horloge.setTimeout(() => {
          this.minuteriesActives.delete(nom);
          this.envoyer({ type: "MINUTERIE", nom, jeton });
        }, effet.delaiMs);
        this.minuteriesActives.set(nom, id);
      }
    }
  }
}
