/**
 * Ile — le rendu du Dynamic Island.
 *
 *  - Forme : chemin SVG « squircle » (coins superellipse mesurés), largeur / hauteur /
 *    coins animés par des RESSORTS mesurés (un par transition, largeur ≠ hauteur).
 *  - Interruptions : chaque valeur est une MotionValue ; une nouvelle cible relance le
 *    ressort depuis la position ET la vitesse actuelles (pas de saut).
 *  - Bulle (mode split) : effet goutte avec un filtre SVG (feGaussianBlur + feColorMatrix).
 *  - Contenu : fondu + flou + échelle avec les délais mesurés ; il part avant que la forme
 *    ne se referme.
 *  - Appui : l'île GONFLE pendant l'appui (mesuré), appui long → étendu.
 *  - Zones touchables envoyées au backend (clics traversants ailleurs).
 */

import { animate, AnimatePresence, motion, useMotionValue, useTransform, type AnimationPlaybackControls, type MotionValue } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { backend } from "../bridge/backend";
import { useDonnees } from "../bridge/donnees";
import type { IslandConfig, Ressort } from "../island.config";
import type { Cible, EtatMachine, IslandMachine } from "../state/islandMachine";
import { preferencesActuelles, useConfig, v } from "../config/store";
import { cleContenu, geometrieCible,
  ileMasquee, parolesVisibles, geometriesDuPlan, planifier, type Geometrie, type Phase } from "./choregraphie";
import {
  AlerteContenu,
  AppelCompact,
  AppelEtendu,
  AppelMinimal,
  MinuteurCompact,
  HorlogeCompact,
  EtagereCompact,
  EtagereEtendu,
  EtagereMinimal,
  TelechargementCompact,
  EcouteCompact,
  AppelEntrantCompact,
  EnregistrementCompact,
  MenuEtendu,
  ChronoCompact,
  ChronoEtendu,
  ChronoMinimal,
  MenuMinimal,
  EnregistrementEtendu,
  EnregistrementMinimal,
  AppelEntrantEtendu,
  AppelEntrantMinimal,
  ImpressionCompact,
  ImpressionEtendu,
  ImpressionMinimal,
  EcouteEtendu,
  EcouteMinimal,
  TelechargementEtendu,
  TelechargementMinimal,
  HorlogeEtendu,
  HorlogeMinimal,
  MinuteurEtendu,
  MinuteurMinimal,
  MusiqueCompact,
  MusiqueEtendu,
  MusiqueMinimal,
  type Ctx,
} from "./contenus";
import { cheminEncoche, cheminIle } from "./squircle";
import { OutilEtendu } from "./outils";
import { definirTypographie } from "./contenus";

/** Marge autour de l'île dans le canevas (pt) : place pour l'ombre et l'appui. */
const MARGE_CANEVAS_PT = 40;

function ressortFramer(r: Ressort) {
  return {
    type: "spring" as const,
    stiffness: v(r.stiffness),
    damping: v(r.damping),
    mass: v(r.mass),
    restDelta: 0.01,
    restSpeed: 0.05,
  };
}

/** Taille du canevas (DIP) : assez grand pour la plus grande forme gonflée + ombre. */
export function tailleCanevas(cfg: IslandConfig): [number, number] {
  const S = v(cfg.ISLAND_SCALE);
  const formes = [...Object.values(cfg.formes), ...Object.values(cfg.formesContenu)];
  const lMax = Math.max(...formes.map((f) => v(f.taille.pt.largeur)));
  const hMax = Math.max(...formes.map((f) => v(f.taille.pt.hauteur)));
  const gonfle = v(cfg.appui.echelleAppui);
  const l = (lMax * gonfle + 2 * MARGE_CANEVAS_PT) * S;
  const h = (v(cfg.margeHautPt) + hMax * gonfle + MARGE_CANEVAS_PT) * S;
  return [Math.ceil(l), Math.ceil(h)];
}

/** Géométrie actuelle (lue sur les valeurs animées). */
function geometrieActuelle(val: Valeurs): Geometrie {
  return {
    decalage: val.decalage.get(),
    largeur: val.largeur.get(),
    hauteur: val.hauteur.get(),
    rayon: val.rayon.get(),
    exposant: val.exposant.get(),
    bulleEcart: val.bulleEcart.get(),
    bulleVisible: val.bulleOpacite.get() > 0,
  };
}

interface Rect {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Mode encoche : rayon des coins du bas (fraction de la hauteur) et « oreilles » du haut (pt). */
const RAYON_ENCOCHE = 0.3;
const OREILLE_ENCOCHE_PT = 4.5;

/** Marge (pt) pour le dépassement des ressorts au-delà de leur cible. */
const MARGE_RESSORT_PT = 12;

/**
 * Zone d'AFFICHAGE (DIP) qui contient l'île pour toutes ces géométries, gonflement de l'appui,
 * dépassement des ressorts et ombre compris. Hors de cette zone, la fenêtre n'existe pas pour
 * Windows : les clics passent aux applications en dessous.
 */
export function zoneAffichage(geos: Geometrie[], cfg: IslandConfig, cx: number, canevas: [number, number]): Rect {
  const S = v(cfg.ISLAND_SCALE);
  const k = v(cfg.appui.echelleAppui);
  const diam = v(cfg.bulle.diametrePt);
  const y0 = v(cfg.margeHautPt);
  const hGrande = v(cfg.formes.compact.taille.pt.hauteur) * 1.5;
  const ombre = v(cfg.ombreEtendu.flouPt) * 1.25 + v(cfg.ombreEtendu.decalageYPt);
  let g = Infinity, d = -Infinity, h = Infinity, b = -Infinity;
  for (const geo of geos) {
    const m = MARGE_RESSORT_PT + (geo.hauteur > hGrande ? ombre : 0);
    const demi = (geo.largeur / 2) * k;
    g = Math.min(g, geo.decalage - demi - m);
    d = Math.max(d, geo.decalage + demi + m);
    if (geo.bulleVisible || geo.bulleEcart > -diam) d = Math.max(d, geo.decalage + geo.largeur / 2 + geo.bulleEcart + diam + m);
    h = Math.min(h, y0 - (geo.hauteur * (k - 1)) / 2 - MARGE_RESSORT_PT);
    b = Math.max(b, y0 + (geo.hauteur * (1 + k)) / 2 + m);
  }
  const x = Math.max(0, cx + g * S);
  const y = preferencesActuelles().forme === "encoche" ? 0 : Math.max(0, h * S);
  return {
    x,
    y,
    largeur: Math.min(canevas[0], cx + d * S) - x,
    hauteur: Math.min(canevas[1], b * S) - y,
  };
}

/** Zones TOUCHABLES (DIP) : l'île et la bulle de la géométrie finale. */
export function zonesTouchables(geo: Geometrie, cfg: IslandConfig, cx: number): Rect[] {
  const S = v(cfg.ISLAND_SCALE);
  const y0 = v(cfg.margeHautPt) * S;
  const diam = v(cfg.bulle.diametrePt);
  const zones = [{ x: cx + (geo.decalage - geo.largeur / 2) * S, y: y0, largeur: geo.largeur * S, hauteur: geo.hauteur * S }];
  if (geo.bulleVisible) {
    zones.push({ x: cx + (geo.decalage + geo.largeur / 2 + geo.bulleEcart) * S, y: y0, largeur: diam * S, hauteur: diam * S });
  }
  return zones;
}

interface Valeurs {
  decalage: MotionValue<number>;
  largeur: MotionValue<number>;
  hauteur: MotionValue<number>;
  rayon: MotionValue<number>;
  exposant: MotionValue<number>;
  bulleEcart: MotionValue<number>;
  bulleOpacite: MotionValue<number>;
  echelle: MotionValue<number>;
}

function useValeurs(depart: Geometrie): Valeurs {
  const decalage = useMotionValue(depart.decalage);
  const largeur = useMotionValue(depart.largeur);
  const hauteur = useMotionValue(depart.hauteur);
  const rayon = useMotionValue(depart.rayon);
  const exposant = useMotionValue(depart.exposant);
  const bulleEcart = useMotionValue(depart.bulleEcart);
  const bulleOpacite = useMotionValue(depart.bulleVisible ? 1 : 0);
  const echelle = useMotionValue(1);
  // Objet STABLE (sinon les effets qui en dépendent se relanceraient à chaque rendu).
  return useMemo(
    () => ({ decalage, largeur, hauteur, rayon, exposant, bulleEcart, bulleOpacite, echelle }),
    [decalage, largeur, hauteur, rayon, exposant, bulleEcart, bulleOpacite, echelle],
  );
}

/** Joue un plan de phases ; renvoie une fonction d'annulation. `fin` est appelé quand tout est au repos. */
function jouerPlan(val: Valeurs, phases: Phase[], diametreBulle: number, fin: () => void): () => void {
  const minuteries: ReturnType<typeof setTimeout>[] = [];
  let controles: AnimationPlaybackControls[] = [];
  const ecouteurs: (() => void)[] = [];
  let annule = false;

  const lancer = (p: Phase, derniere: boolean) => {
    const v0 = p.vitesseNulle ? { velocity: 0 } : {};
    const rl = { ...ressortFramer(p.ressort.largeur), ...v0 };
    const rh = { ...ressortFramer(p.ressort.hauteur), ...v0 };
    const rb = { ...ressortFramer(p.ressortBulle ?? p.ressort.largeur), ...v0 };
    if (p.cible.bulleVisible) {
      val.bulleOpacite.set(1);
    } else {
      // Bulle plus montrée : la cacher dès qu'elle est fondue dans l'île (sinon elle
      // dépasserait des coins arrondis d'une forme plus grande).
      const fondue = (e: number) => e <= -0.5 * diametreBulle;
      if (fondue(val.bulleEcart.get())) val.bulleOpacite.set(0);
      else {
        const arret = val.bulleEcart.on("change", (e) => {
          if (!fondue(e) || annule) return;
          val.bulleOpacite.set(0);
          arret();
        });
        ecouteurs.push(arret);
      }
    }
    controles = [
      animate(val.decalage, p.cible.decalage, rl),
      animate(val.largeur, p.cible.largeur, rl),
      animate(val.hauteur, p.cible.hauteur, rh),
      animate(val.rayon, p.cible.rayon, rh),
      animate(val.exposant, p.cible.exposant, rh),
      animate(val.bulleEcart, p.cible.bulleEcart, rb),
    ];
    if (derniere) {
      void Promise.all(controles.map((c) => c.finished))
        .then(() => {
          if (annule) return;
          if (!p.cible.bulleVisible) val.bulleOpacite.set(0);
          fin();
        })
        .catch(() => undefined);
    }
  };

  phases.forEach((p, i) => {
    const derniere = i === phases.length - 1;
    if (p.debutMs <= 0) lancer(p, derniere);
    else minuteries.push(setTimeout(() => !annule && lancer(p, derniere), p.debutMs));
  });

  return () => {
    annule = true;
    minuteries.forEach(clearTimeout);
    ecouteurs.forEach((f) => f());
    // On n'arrête PAS les ressorts en cours : la prochaine cible repart de la vitesse actuelle.
  };
}

// ---------------------------------------------------------------------------

export function Ile({ machine }: { machine: IslandMachine }) {
  const cfg = useConfig();
  const d = useDonnees();
  const S = v(cfg.ISLAND_SCALE);
  definirTypographie(cfg);
  const [etat, setEtat] = useState<EtatMachine>(machine.etat);
  const [debutContenuMs, setDebutContenuMs] = useState(0);
  const val = useValeurs(geometrieCible(machine.etat, cfg));
  const cibleRef = useRef<Geometrie>(geometrieCible(machine.etat, cfg));
  const annulerPlan = useRef<() => void>(() => undefined);
  const canevasSvg = useRef<SVGSVGElement>(null);
  const [canevasL, canevasH] = tailleCanevas(cfg);

  const cx = canevasL / 2;
  // Île cachée (préférence « visibilite ») : rien de touchable, les clics passent dessous.
  const masquee = ileMasquee(etat);
  const masqueeRef = useRef(masquee);
  masqueeRef.current = masquee;
  const envoyerZones = useCallback(
    (geos: Geometrie[], finale: Geometrie) => {
      void backend.zonesTouchables(masqueeRef.current ? [] : zonesTouchables(finale, cfg, cx), zoneAffichage(geos, cfg, cx, [canevasL, canevasH]));
    },
    [cfg, cx, canevasL, canevasH],
  );
  useEffect(() => {
    envoyerZones([cibleRef.current], cibleRef.current);
  }, [masquee, envoyerZones]);

  // Taille du canevas → backend (fenêtre redimensionnée et recentrée) : seulement si elle change.
  useEffect(() => {
    void backend.definirCanevas([canevasL, canevasH]);
  }, [canevasL, canevasH]);
  // Zones (le backend les réapplique après chaque replacement de la fenêtre).
  useEffect(() => {
    envoyerZones([geometrieActuelle(val), cibleRef.current], cibleRef.current);
  }, [envoyerZones, val]);

  // Transitions de la machine → plans d'animation.
  useEffect(() => {
    let precedent = machine.etat;
    return machine.abonner((nouvel, effets) => {
      const avant = precedent;
      precedent = nouvel;
      setEtat(nouvel);
      for (const e of effets) {
        if (e.type !== "transition") continue;
        const plan = planifier(e.transition, avant, nouvel, cfg);
        const finale = plan.phases[plan.phases.length - 1]!.cible;
        cibleRef.current = finale;
        setDebutContenuMs(plan.debutContenuMs);
        annulerPlan.current();
        const id = e.transition.id;
        // Zone d'affichage : réservée pour TOUTE la transition dès le début (2 messages par
        // transition au lieu d'un toutes les 50 ms → aucun travail pendant l'animation).
        envoyerZones([geometrieActuelle(val), ...geometriesDuPlan(plan)], finale);
        annulerPlan.current = jouerPlan(val, plan.phases, v(cfg.bulle.diametrePt), () => {
          envoyerZones([finale], finale);
          machine.envoyer({ type: "TRANSITION_FIN", id });
        });
      }
    });
  }, [machine, cfg, val, envoyerZones]);

  // Paroles affichées / retirées pendant la musique (sans changement de mode) : l'île
  // s'agrandit ou se réduit en douceur vers sa nouvelle forme.
  const parolesOn = parolesVisibles(etat);
  const parolesPrecedent = useRef(parolesOn);
  useEffect(() => {
    if (parolesPrecedent.current === parolesOn) return;
    parolesPrecedent.current = parolesOn;
    if (machine.etat.mode !== "compact") return; // une transition de la machine s'en occupe
    const g = geometrieCible(machine.etat, cfg);
    const c = cibleRef.current;
    if (Math.abs(g.largeur - c.largeur) < 0.5 && Math.abs(g.hauteur - c.hauteur) < 0.5) return;
    cibleRef.current = g;
    annulerPlan.current();
    envoyerZones([geometrieActuelle(val), g], g);
    annulerPlan.current = jouerPlan(
      val,
      [{ debutMs: 0, cible: g, ressort: cfg.ressorts.ouvrir, ressortBulle: cfg.bulle.ressort }],
      v(cfg.bulle.diametrePt),
      () => envoyerZones([g], g),
    );
  }, [parolesOn, machine, cfg, val, envoyerZones]);

  // Si la configuration change (panneau de réglages), aller directement à la nouvelle cible.
  const cfgPrecedente = useRef(cfg);
  useEffect(() => {
    if (cfgPrecedente.current === cfg) return;
    cfgPrecedente.current = cfg;
    const g = geometrieCible(machine.etat, cfg);
    cibleRef.current = g;
    val.decalage.set(g.decalage);
    val.largeur.set(g.largeur);
    val.hauteur.set(g.hauteur);
    val.rayon.set(g.rayon);
    val.exposant.set(g.exposant);
    val.bulleEcart.set(g.bulleEcart);
    val.bulleOpacite.set(g.bulleVisible ? 1 : 0);
  }, [cfg, machine, val]);

  // Géométrie en px CSS. Centre de l'île = centre du canevas + décalage mesuré.
  const y0 = v(cfg.margeHautPt) * S;
  const centre = useTransform(val.decalage, (dx) => cx + dx * S);
  // Mode encoche (style Mac) : collée au haut de l'écran, coins du bas plus serrés.
  const cheminPrincipal = useTransform([val.largeur, val.hauteur, val.rayon, val.exposant, centre], ([l, h, r, n, c]) => {
    const x = (c as number) - ((l as number) * S) / 2;
    if (preferencesActuelles().forme !== "encoche") return cheminIle(x, y0, (l as number) * S, (h as number) * S, (r as number) * S, n as number);
    const rayonEncoche = Math.min(r as number, (h as number) * RAYON_ENCOCHE);
    return cheminEncoche(x, y0, (l as number) * S, (h as number) * S, rayonEncoche * S, n as number, OREILLE_ENCOCHE_PT * S);
  });
  const diam = v(cfg.bulle.diametrePt);
  const cheminBulle = useTransform([val.largeur, val.bulleEcart, centre], ([l, e, c]) =>
    cheminIle((c as number) + ((l as number) * S) / 2 + (e as number) * S, y0, diam * S, diam * S, (diam / 2) * S, 2),
  );
  // Gonflement / rebond : depuis le centre de l'île, ou depuis le haut de l'écran en mode encoche.
  const origineY = useTransform(val.hauteur, (h) => (preferencesActuelles().forme === "encoche" ? 0 : y0 + (h * S) / 2));
  const transformation = useTransform([val.echelle, origineY, centre], ([e, oy, c]) => {
    const k = e as number;
    const o = oy as number;
    return `translate(${(c as number) * (1 - k)} ${o * (1 - k)}) scale(${k})`;
  });
  // Ombre : seulement quand l'île est grande (vue étendue).
  const hCompact = v(cfg.formes.compact.taille.pt.hauteur);
  const hEtendu = v(cfg.formes.etendu.taille.pt.hauteur);
  const ombreOpacite = useTransform(val.hauteur, [hCompact, hEtendu], [0, v(cfg.ombreEtendu.opacite)]);
  // L'ombre (un flou SVG, coûteux) n'est dessinée que lorsqu'elle se voit.
  const [ombre, setOmbre] = useState(ombreOpacite.get() > 0.003);
  useEffect(() => ombreOpacite.on("change", (o) => setOmbre(o > 0.003)), [ombreOpacite]);
  const gouttePx = v(cfg.bulle.goutteFlouPt) * S;
  // L'effet goutte n'est actif que quand la bulle existe (sinon le filtre est inutile).
  const [goutte, setGoutte] = useState(val.bulleOpacite.get() > 0);
  useEffect(() => val.bulleOpacite.on("change", (o) => setGoutte(o > 0)), [val]);

  // Clic à l'extérieur de l'île : écouté par le backend en mode étendu (pont), et ici pour
  // les clics qui tombent dans la zone d'affichage mais hors de l'île (ex. sur l'ombre).

  // --- Appui / appui long -----------------------------------------------------
  const appui = useRef<{ minuterie: ReturnType<typeof setTimeout> | null; long: boolean; cible: Cible }>({
    minuterie: null,
    long: false,
    cible: "principal",
  });
  const relacher = useCallback(() => {
    animate(val.echelle, 1, ressortFramer(cfg.appui.ressortRetour));
  }, [val, cfg]);
  /**
   * Clic court : petit REBOND. Une impulsion (vitesse initiale) est donnée au ressort de retour
   * mesuré : l'île gonfle jusqu'à l'échelle d'appui mesurée puis revient, avec le rebond
   * naturel du ressort. Aucune durée inventée : tout découle de echelleAppui et ressortRetour.
   */
  const rebond = useCallback(() => {
    const r = cfg.appui.ressortRetour;
    const w0 = (2 * Math.PI) / v(r.response);
    const z = Math.min(v(r.dampingFraction), 0.999);
    const wd = w0 * Math.sqrt(1 - z * z);
    // Pic d'un ressort amorti lancé depuis l'équilibre : x_max = (v0 / w0) · e^(−ζ·w0·t_pic), t_pic = atan(√(1−ζ²)/ζ) / wd
    const tPic = Math.atan(Math.sqrt(1 - z * z) / z) / wd;
    const facteur = Math.exp(-z * w0 * tPic) / w0;
    const reste = Math.max(v(cfg.appui.echelleAppui) - val.echelle.get(), 0);
    animate(val.echelle, 1, { ...ressortFramer(r), velocity: reste / facteur });
  }, [val, cfg]);
  const debutAppui = (cible: Cible) => {
    machine.envoyer({ type: "APPUI_DEBUT" });
    const a = appui.current;
    a.long = false;
    a.cible = cible;
    animate(val.echelle, v(cfg.appui.echelleAppui), { duration: v(cfg.appui.dureeGonflementMs) / 1000, ease: "linear" });
    if (a.minuterie) clearTimeout(a.minuterie);
    if (etat.mode === "compact" || etat.mode === "split") {
      a.minuterie = setTimeout(() => {
        a.long = true;
        a.minuterie = null;
        relacher();
        machine.envoyer({ type: "CLIC_LONG", cible });
      }, v(cfg.durees.clicLongSeuilMs));
    }
  };
  const finAppui = (annule: boolean) => {
    const a = appui.current;
    if (a.minuterie) clearTimeout(a.minuterie);
    a.minuterie = null;
    machine.envoyer({ type: "APPUI_FIN" });
    if (!a.long) {
      if (annule) relacher();
      else {
        rebond();
        machine.envoyer({ type: "CLIC", cible: a.cible });
      }
    }
    a.long = false;
  };

  // --- Contenu ----------------------------------------------------------------
  const ctx: Ctx = { cfg, S, d, etat };
  const contenu = choisirContenu(ctx);
  const cle = cleContenu(etat);
  const c = cfg.contenu;
  const flou = v(c.flouDepartPt) * S;
  const variantes = useMemo(
    () => ({
      cache: { opacity: 0, filter: `blur(${flou}px)`, scale: v(c.echelleDepart) },
      visible: (debut: number) => ({
        opacity: 1,
        filter: "blur(0px)",
        scale: 1,
        transition: { delay: (debut + v(c.delaiApparitionMs)) / 1000, duration: v(c.dureeFonduEntreeMs) / 1000, ease: "linear" as const },
      }),
      sortie: {
        opacity: 0,
        filter: `blur(${flou}px)`,
        scale: v(c.echelleDepart),
        transition: { delay: v(c.delaiDisparitionMs) / 1000, duration: v(c.dureeFonduSortieMs) / 1000, ease: "linear" as const },
      },
    }),
    [c, flou],
  );

  // Boîte de contenu = taille CIBLE, centrée sur l'île, ancrée en haut ; découpée par l'île.
  const cible = geometrieCible(etat, cfg);
  const gaucheIle = useTransform([val.largeur, centre], ([l, c]) => (c as number) - ((l as number) * S) / 2);
  const largeurIle = useTransform(val.largeur, (l) => l * S);
  const hauteurIle = useTransform(val.hauteur, (h) => h * S);
  const rayonIle = useTransform([val.rayon, val.hauteur], ([r, h]) =>
    preferencesActuelles().forme === "encoche"
      ? `0 0 ${Math.min(r as number, (h as number) * RAYON_ENCOCHE) * S}px ${Math.min(r as number, (h as number) * RAYON_ENCOCHE) * S}px`
      : `${(r as number) * S}px`,
  );
  const bulleGauche = useTransform(
    [val.largeur, val.bulleEcart, centre],
    ([l, e, c]) => (c as number) + ((l as number) * S) / 2 + (e as number) * S,
  );
  const bulleContenu = etat.mode === "split" ? choisirBulle(ctx) : null;

  // Couche du contenu : ne capte pas les clics (seule l'île, à l'intérieur, les capte).
  const couche = (enfants: ReactNode) => <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{enfants}</div>;

  return (
    <motion.div
      // Mode « cachée » : l'île remonte derrière le haut de l'écran (après avoir fini de
      // rétrécir) et redescend aussitôt qu'une alerte arrive.
      initial={false}
      animate={masquee ? { y: -(y0 + cible.hauteur * S + 12 * S), opacity: 0 } : { y: 0, opacity: 1 }}
      transition={
        masquee
          ? { delay: 0.45, duration: 0.35, ease: [0.4, 0, 1, 1] }
          : { y: { type: "spring", stiffness: 260, damping: 26 }, opacity: { duration: 0.12 } }
      }
      style={{ position: "absolute", left: 0, top: 0, width: canevasL, height: canevasH, fontFamily: v(cfg.police) }}
      onContextMenu={(e) => {
        // Clic droit sur l'île : l'île s'ouvre avec ses outils (minuteur, chanson, étagère…).
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ile-menu-ouvrir"));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const cible = e.target as Element;
        // Le grand SVG du canevas ne contient que les formes : un clic qui y tombe est hors du contenu.
        if (cible === e.currentTarget || (canevasSvg.current?.contains(cible) ?? false)) {
          machine.envoyer({ type: "CLIC_EXTERIEUR" });
        }
      }}
    >
      <svg ref={canevasSvg} width={canevasL} height={canevasH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <filter id="goutte" x="-6%" y="-25%" width="112%" height="150%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={gouttePx} />
            <feColorMatrix
              type="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${v(cfg.bulle.goutteAlphaMultiplicateur)} ${v(cfg.bulle.goutteAlphaDecalage)}`}
            />
          </filter>
          <filter id="ombre" x="-20%" y="-30%" width="140%" height="190%">
            <feGaussianBlur in="SourceAlpha" stdDeviation={(v(cfg.ombreEtendu.flouPt) * S) / 2} />
            <feOffset dy={v(cfg.ombreEtendu.decalageYPt) * S} />
          </filter>
        </defs>
        <motion.g transform={transformation}>
          {ombre && <motion.path d={cheminPrincipal} fill="#000" filter="url(#ombre)" style={{ opacity: ombreOpacite }} />}
          <g filter={goutte ? "url(#goutte)" : undefined}>
            <motion.path d={cheminPrincipal} fill={v(cfg.couleurPilule)} />
            <motion.path d={cheminBulle} fill={v(cfg.couleurPilule)} style={{ opacity: val.bulleOpacite }} />
          </g>
        </motion.g>
      </svg>

      {couche(
        <motion.div
          style={{
            position: "absolute",
            left: gaucheIle,
            top: y0,
            width: largeurIle,
            height: hauteurIle,
            borderRadius: rayonIle,
            overflow: "hidden",
            scale: val.echelle,
            originY: preferencesActuelles().forme === "encoche" ? `${-y0}px` : 0.5,
            cursor: "default",
            touchAction: "none",
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return; // clic droit : menu (onContextMenu), pas un appui
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            debutAppui("principal");
          }}
          onPointerUp={(e) => e.button === 0 && finAppui(false)}
          onPointerCancel={() => finAppui(true)}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={cle}
              custom={debutContenuMs}
              variants={variantes}
              initial="cache"
              animate="visible"
              exit="sortie"
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                marginLeft: (-cible.largeur * S) / 2,
                width: cible.largeur * S,
                height: cible.hauteur * S,
                transformOrigin: "50% 50%",
                willChange: "opacity, filter, transform",
              }}
            >
              {contenu}
            </motion.div>
          </AnimatePresence>
          <IndicateurConfidentialite ctx={ctx} />
        </motion.div>,
      )}

      {bulleContenu && (
        <motion.div
          style={{
            position: "absolute",
            left: bulleGauche,
            top: y0,
            width: diam * S,
            height: diam * S,
            opacity: val.bulleOpacite,
            borderRadius: diam * S,
            overflow: "hidden",
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return; // clic droit : menu (onContextMenu), pas un appui
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            debutAppui("bulle");
          }}
          onPointerUp={(e) => e.button === 0 && finAppui(false)}
          onPointerCancel={() => finAppui(true)}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={etat.bulleId}
              custom={debutContenuMs}
              variants={variantes}
              initial="cache"
              animate="visible"
              exit="sortie"
              style={{ position: "absolute", inset: 0 }}
            >
              {bulleContenu}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </motion.div>
  );
}

function typeDe(e: EtatMachine, id: string | null) {
  return e.activites.find((a) => a.id === id)?.type ?? null;
}

function choisirContenu(ctx: Ctx): ReactNode {
  const e = ctx.etat;
  const type = typeDe(e, e.principaleId);
  switch (e.mode) {
    case "repos":
      return null;
    case "compact":
      return type === "chrono" ? <ChronoCompact {...ctx} /> : type === "menu" || type === "outil" ? <MenuMinimal {...ctx} /> : type === "enregistrement" ? <EnregistrementCompact {...ctx} /> : type === "appelEntrant" ? <AppelEntrantCompact {...ctx} /> : type === "impression" ? <ImpressionCompact {...ctx} /> : type === "ecoute" ? <EcouteCompact {...ctx} /> : type === "telechargement" ? <TelechargementCompact {...ctx} /> : type === "etagere" ? <EtagereCompact {...ctx} /> : type === "horloge" ? <HorlogeCompact {...ctx} /> : type === "appel" ? <AppelCompact {...ctx} /> : type === "minuteur" ? <MinuteurCompact {...ctx} /> : <MusiqueCompact {...ctx} />;
    case "split":
      return type === "chrono" ? <ChronoMinimal {...ctx} /> : type === "menu" || type === "outil" ? <MenuMinimal {...ctx} /> : type === "enregistrement" ? <EnregistrementMinimal {...ctx} /> : type === "appelEntrant" ? <AppelEntrantMinimal {...ctx} /> : type === "impression" ? <ImpressionMinimal {...ctx} /> : type === "ecoute" ? <EcouteMinimal {...ctx} /> : type === "telechargement" ? <TelechargementMinimal {...ctx} /> : type === "etagere" ? <EtagereMinimal {...ctx} /> : type === "horloge" ? <HorlogeMinimal {...ctx} /> : type === "appel" ? <AppelMinimal {...ctx} /> : type === "minuteur" ? <MinuteurMinimal {...ctx} /> : <MusiqueMinimal {...ctx} />;
    case "etendu":
      return type === "chrono" ? <ChronoEtendu {...ctx} /> : type === "menu" ? <MenuEtendu {...ctx} /> : type === "outil" ? <OutilEtendu {...ctx} /> : type === "enregistrement" ? <EnregistrementEtendu {...ctx} /> : type === "appelEntrant" ? <AppelEntrantEtendu {...ctx} /> : type === "impression" ? <ImpressionEtendu {...ctx} /> : type === "ecoute" ? <EcouteEtendu {...ctx} /> : type === "telechargement" ? <TelechargementEtendu {...ctx} /> : type === "etagere" ? <EtagereEtendu {...ctx} /> : type === "horloge" ? <HorlogeEtendu {...ctx} /> : type === "appel" ? <AppelEtendu {...ctx} /> : type === "minuteur" ? <MinuteurEtendu {...ctx} /> : <MusiqueEtendu {...ctx} />;
    case "alerte":
      return e.alerte ? <AlerteContenu {...ctx} alerte={e.alerte} /> : null;
  }
}

/** Contenu de la bulle : icône de l'activité secondaire, centrée. */
function choisirBulle(ctx: Ctx): ReactNode {
  const { cfg, S, etat } = ctx;
  const type = typeDe(etat, etat.bulleId);
  const diam = v(cfg.bulle.diametrePt) * S;
  // Les contenus « minimal » sont placés comme dans l'île ; on les recentre dans la bulle.
  const decalage = type === "minuteur" || type === "appel" || type === "horloge" || type === "telechargement" || type === "etagere" || type === "ecoute" || type === "impression" || type === "appelEntrant" || type === "enregistrement" || type === "menu" || type === "chrono" || type === "outil"
    ? diam / 2 - (v(cfg.minuteur.compactIconeXPt) + v(cfg.minuteur.compactIconeTaillePt) / 2) * S
    : diam / 2 - (v(cfg.media.compact.pochetteXPt) + v(cfg.media.compact.pochetteTaillePt) / 2) * S;
  return (
    <div style={{ position: "absolute", left: decalage, top: 0, width: diam, height: diam }}>
      {type === "chrono" ? <ChronoMinimal {...ctx} /> : type === "menu" || type === "outil" ? <MenuMinimal {...ctx} /> : type === "enregistrement" ? <EnregistrementMinimal {...ctx} /> : type === "appelEntrant" ? <AppelEntrantMinimal {...ctx} /> : type === "impression" ? <ImpressionMinimal {...ctx} /> : type === "ecoute" ? <EcouteMinimal {...ctx} /> : type === "telechargement" ? <TelechargementMinimal {...ctx} /> : type === "etagere" ? <EtagereMinimal {...ctx} /> : type === "horloge" ? <HorlogeMinimal {...ctx} /> : type === "appel" ? <AppelMinimal {...ctx} /> : type === "minuteur" ? <MinuteurMinimal {...ctx} /> : <MusiqueMinimal {...ctx} />}
    </div>
  );
}

/** Point vert (caméra, avec ou sans micro) ou orange (micro seul), comme sur iPhone. */
function IndicateurConfidentialite({ ctx }: { ctx: Ctx }) {
  const { cfg, S, d, etat } = ctx;
  const { camera, micro } = d.confidentialite;
  if (!camera && !micro) return null;
  if (etat.mode === "etendu" || etat.mode === "alerte") return null;
  const i = cfg.indicateurs;
  const t = v(i.confidentialiteDiametrePt) * S;
  const h = v(cfg.formes.repos.taille.pt.hauteur) * S;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        position: "absolute",
        right: (v(i.confidentialiteDroitePt) - v(i.confidentialiteDiametrePt) / 2) * S,
        top: (h - t) / 2,
        width: t,
        height: t,
        borderRadius: t,
        background: camera ? v(i.cameraCouleur) : v(i.microCouleur),
      }}
    />
  );
}
