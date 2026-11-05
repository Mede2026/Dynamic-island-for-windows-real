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
import { useConfig, v } from "../config/store";
import { cleContenu, geometrieCible, planifier, type Geometrie, type Phase } from "./choregraphie";
import {
  AlerteContenu,
  MinuteurCompact,
  MinuteurEtendu,
  MinuteurMinimal,
  MusiqueCompact,
  MusiqueEtendu,
  MusiqueMinimal,
  type Ctx,
} from "./contenus";
import { cheminIle } from "./squircle";

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

interface Valeurs {
  largeur: MotionValue<number>;
  hauteur: MotionValue<number>;
  rayon: MotionValue<number>;
  exposant: MotionValue<number>;
  bulleEcart: MotionValue<number>;
  bulleOpacite: MotionValue<number>;
  echelle: MotionValue<number>;
}

function useValeurs(depart: Geometrie): Valeurs {
  const largeur = useMotionValue(depart.largeur);
  const hauteur = useMotionValue(depart.hauteur);
  const rayon = useMotionValue(depart.rayon);
  const exposant = useMotionValue(depart.exposant);
  const bulleEcart = useMotionValue(depart.bulleEcart);
  const bulleOpacite = useMotionValue(depart.bulleVisible ? 1 : 0);
  const echelle = useMotionValue(1);
  // Objet STABLE (sinon les effets qui en dépendent se relanceraient à chaque rendu).
  return useMemo(
    () => ({ largeur, hauteur, rayon, exposant, bulleEcart, bulleOpacite, echelle }),
    [largeur, hauteur, rayon, exposant, bulleEcart, bulleOpacite, echelle],
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
  const [etat, setEtat] = useState<EtatMachine>(machine.etat);
  const [debutContenuMs, setDebutContenuMs] = useState(0);
  const val = useValeurs(geometrieCible(machine.etat, cfg));
  const cibleRef = useRef<Geometrie>(geometrieCible(machine.etat, cfg));
  const annulerPlan = useRef<() => void>(() => undefined);
  const [canevasL, canevasH] = tailleCanevas(cfg);

  // Taille du canevas → backend (fenêtre redimensionnée et recentrée).
  useEffect(() => {
    void backend.definirCanevas([canevasL, canevasH]);
  }, [canevasL, canevasH]);

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
        cibleRef.current = plan.phases[plan.phases.length - 1]!.cible;
        setDebutContenuMs(plan.debutContenuMs);
        annulerPlan.current();
        const id = e.transition.id;
        annulerPlan.current = jouerPlan(val, plan.phases, v(cfg.bulle.diametrePt), () =>
          machine.envoyer({ type: "TRANSITION_FIN", id }),
        );
      }
    });
  }, [machine, cfg, val]);

  // Si la configuration change (panneau de réglages), aller directement à la nouvelle cible.
  const cfgPrecedente = useRef(cfg);
  useEffect(() => {
    if (cfgPrecedente.current === cfg) return;
    cfgPrecedente.current = cfg;
    const g = geometrieCible(machine.etat, cfg);
    cibleRef.current = g;
    val.largeur.set(g.largeur);
    val.hauteur.set(g.hauteur);
    val.rayon.set(g.rayon);
    val.exposant.set(g.exposant);
    val.bulleEcart.set(g.bulleEcart);
    val.bulleOpacite.set(g.bulleVisible ? 1 : 0);
  }, [cfg, machine, val]);

  // Géométrie en px CSS.
  const cx = canevasL / 2;
  const y0 = v(cfg.margeHautPt) * S;
  const cheminPrincipal = useTransform([val.largeur, val.hauteur, val.rayon, val.exposant], ([l, h, r, n]) =>
    cheminIle(cx - ((l as number) * S) / 2, y0, (l as number) * S, (h as number) * S, (r as number) * S, n as number),
  );
  const diam = v(cfg.bulle.diametrePt);
  const cheminBulle = useTransform([val.largeur, val.bulleEcart], ([l, e]) =>
    cheminIle(cx + ((l as number) * S) / 2 + (e as number) * S, y0, diam * S, diam * S, (diam / 2) * S, 2),
  );
  const origineY = useTransform(val.hauteur, (h) => y0 + (h * S) / 2);
  const transformation = useTransform([val.echelle, origineY], ([e, oy]) => {
    const k = e as number;
    const o = oy as number;
    return `translate(${cx * (1 - k)} ${o * (1 - k)}) scale(${k})`;
  });
  // Ombre : seulement quand l'île est grande (vue étendue).
  const hCompact = v(cfg.formes.compact.taille.pt.hauteur);
  const hEtendu = v(cfg.formes.etendu.taille.pt.hauteur);
  const ombreOpacite = useTransform(val.hauteur, [hCompact, hEtendu], [0, v(cfg.ombreEtendu.opacite)]);
  const gouttePx = v(cfg.bulle.goutteFlouPt) * S;
  // L'effet goutte n'est actif que quand la bulle existe (sinon le filtre est inutile).
  const [goutte, setGoutte] = useState(val.bulleOpacite.get() > 0);
  useEffect(() => val.bulleOpacite.on("change", (o) => setGoutte(o > 0)), [val]);

  // Zones touchables (DIP = px CSS), mises à jour au plus toutes les 50 ms.
  useEffect(() => {
    let attente: ReturnType<typeof setTimeout> | null = null;
    const envoyer = () => {
      attente = null;
      const c = cibleRef.current;
      const l = Math.max(val.largeur.get(), c.largeur) * S * val.echelle.get();
      const h = Math.max(val.hauteur.get(), c.hauteur) * S * val.echelle.get();
      const zones = [{ x: cx - l / 2, y: y0, largeur: l, hauteur: h }];
      if (val.bulleOpacite.get() > 0) {
        zones.push({ x: cx + l / 2 + Math.max(val.bulleEcart.get(), 0) * S, y: y0, largeur: diam * S, hauteur: diam * S });
      }
      void backend.zonesTouchables(zones);
    };
    const planifierEnvoi = () => {
      if (attente === null) attente = setTimeout(envoyer, 50);
    };
    const desab = [val.largeur, val.hauteur, val.echelle, val.bulleOpacite].map((m) => m.on("change", planifierEnvoi));
    envoyer();
    return () => {
      desab.forEach((f) => f());
      if (attente) clearTimeout(attente);
    };
  }, [val, S, cx, y0, diam]);

  // Clic à l'extérieur : écouté seulement en mode étendu (géré par le pont).

  // --- Appui / appui long -----------------------------------------------------
  const appui = useRef<{ minuterie: ReturnType<typeof setTimeout> | null; long: boolean; cible: Cible }>({
    minuterie: null,
    long: false,
    cible: "principal",
  });
  const relacher = useCallback(() => {
    animate(val.echelle, 1, ressortFramer(cfg.appui.ressortRetour));
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
      relacher();
      if (!annule) machine.envoyer({ type: "CLIC", cible: a.cible });
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
  const gaucheIle = useTransform(val.largeur, (l) => cx - (l * S) / 2);
  const largeurIle = useTransform(val.largeur, (l) => l * S);
  const hauteurIle = useTransform(val.hauteur, (h) => h * S);
  const rayonIle = useTransform(val.rayon, (r) => r * S);
  const bulleGauche = useTransform([val.largeur, val.bulleEcart], ([l, e]) => cx + ((l as number) * S) / 2 + (e as number) * S);
  const bulleContenu = etat.mode === "split" ? choisirBulle(ctx) : null;

  const couche = (enfants: ReactNode) => <div style={{ position: "absolute", inset: 0 }}>{enfants}</div>;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: canevasL, height: canevasH, fontFamily: v(cfg.police) }}>
      <svg width={canevasL} height={canevasH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <filter id="goutte" x="0" y="0" width={canevasL} height={canevasH} filterUnits="userSpaceOnUse">
            <feGaussianBlur in="SourceGraphic" stdDeviation={gouttePx} />
            <feColorMatrix
              type="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${v(cfg.bulle.goutteAlphaMultiplicateur)} ${v(cfg.bulle.goutteAlphaDecalage)}`}
            />
          </filter>
          <filter id="ombre" x="0" y="0" width={canevasL} height={canevasH} filterUnits="userSpaceOnUse">
            <feGaussianBlur in="SourceAlpha" stdDeviation={(v(cfg.ombreEtendu.flouPt) * S) / 2} />
            <feOffset dy={v(cfg.ombreEtendu.decalageYPt) * S} />
          </filter>
        </defs>
        <motion.g transform={transformation}>
          <motion.path d={cheminPrincipal} fill="#000" filter="url(#ombre)" style={{ opacity: ombreOpacite }} />
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
            originY: 0.5,
            cursor: "default",
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            debutAppui("principal");
          }}
          onPointerUp={() => finAppui(false)}
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
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            debutAppui("bulle");
          }}
          onPointerUp={() => finAppui(false)}
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
    </div>
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
      return type === "minuteur" ? <MinuteurCompact {...ctx} /> : <MusiqueCompact {...ctx} />;
    case "split":
      return type === "minuteur" ? <MinuteurMinimal {...ctx} /> : <MusiqueMinimal {...ctx} />;
    case "etendu":
      return type === "minuteur" ? <MinuteurEtendu {...ctx} /> : <MusiqueEtendu {...ctx} />;
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
  const decalage = type === "minuteur"
    ? diam / 2 - (v(cfg.minuteur.compactIconeXPt) + v(cfg.minuteur.compactIconeTaillePt) / 2) * S
    : diam / 2 - (v(cfg.media.compact.pochetteXPt) + v(cfg.media.compact.pochetteTaillePt) / 2) * S;
  return (
    <div style={{ position: "absolute", left: decalage, top: 0, width: diam, height: diam }}>
      {type === "minuteur" ? <MinuteurMinimal {...ctx} /> : <MusiqueMinimal {...ctx} />}
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
