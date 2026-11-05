import { describe, expect, it, vi } from "vitest";
import {
  IslandMachine,
  calculerMode,
  etatInitial,
  reduire,
  ressortPour,
  type Durees,
  type Effet,
  type Evenement,
  type Horloge,
} from "./islandMachine";

// Durées de TEST seulement (les vraies viendront des mesures, phase 2).
const DUREES: Durees = { alerteAffichageMs: 1000, etenduFermetureAutoMs: 500 };

/** Fausse horloge contrôlée par le test. */
function fausseHorloge() {
  let maintenant = 0;
  let prochainId = 1;
  const taches = new Map<number, { quand: number; fn: () => void }>();
  const horloge: Horloge = {
    setTimeout: (fn, ms) => {
      const id = prochainId++;
      taches.set(id, { quand: maintenant + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      taches.delete(id as number);
    },
  };
  const avancer = (ms: number) => {
    const fin = maintenant + ms;
    for (;;) {
      const prochaine = [...taches.entries()]
        .filter(([, t]) => t.quand <= fin)
        .sort((a, b) => a[1].quand - b[1].quand)[0];
      if (!prochaine) break;
      taches.delete(prochaine[0]);
      maintenant = prochaine[1].quand;
      prochaine[1].fn();
    }
    maintenant = fin;
  };
  return { horloge, avancer, nbTaches: () => taches.size };
}

function creer() {
  const h = fausseHorloge();
  const avertir = vi.fn();
  const m = new IslandMachine(DUREES, h.horloge, avertir);
  const effets: Effet[] = [];
  m.abonner((_e, eff) => effets.push(...eff));
  return { m, h, effets, avertir };
}

const musique = { id: "musique", type: "musique" as const };
const minuteur = { id: "minuteur", type: "minuteur" as const };

describe("calculerMode / ressortPour", () => {
  it("dérive le mode à partir des données", () => {
    expect(calculerMode({ activites: [], etendueId: null, alerte: null })).toBe("repos");
    expect(calculerMode({ activites: [musique], etendueId: null, alerte: null })).toBe("compact");
    expect(calculerMode({ activites: [musique, minuteur], etendueId: null, alerte: null })).toBe("split");
    expect(calculerMode({ activites: [musique], etendueId: "musique", alerte: null })).toBe("etendu");
    expect(calculerMode({ activites: [musique], etendueId: "absent", alerte: null })).toBe("compact");
    expect(calculerMode({ activites: [musique], etendueId: "musique", alerte: { type: "volume" } })).toBe("alerte");
  });

  it("associe chaque transition à son ressort (ouvrir ≠ fermer)", () => {
    expect(ressortPour("repos", "compact")).toBe("apparition");
    expect(ressortPour("compact", "repos")).toBe("disparition");
    expect(ressortPour("compact", "etendu")).toBe("ouvrir");
    expect(ressortPour("split", "etendu")).toBe("ouvrir");
    expect(ressortPour("etendu", "compact")).toBe("fermer");
    expect(ressortPour("etendu", "split")).toBe("fermer");
    expect(ressortPour("compact", "split")).toBe("compactVersSplit");
    expect(ressortPour("split", "compact")).toBe("splitVersCompact");
    expect(ressortPour("compact", "alerte")).toBe("alerteEntree");
    expect(ressortPour("alerte", "repos")).toBe("alerteSortie");
    expect(ressortPour("compact", "compact")).toBe("changementContenu");
    expect(ressortPour("split", "repos")).toBe("disparition");
    expect(ressortPour("repos", "split")).toBe("apparition");
  });
});

describe("activités et priorités", () => {
  it("repos → compact → split → compact → repos", () => {
    const { m } = creer();
    expect(m.etat.mode).toBe("repos");

    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    expect(m.etat.mode).toBe("compact");
    expect(m.etat.principaleId).toBe("musique");
    expect(m.etat.transition?.ressort).toBe("apparition");

    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    expect(m.etat.mode).toBe("split");
    // musique > minuteur (mesuré sur iPhone) : la musique garde l'île, le minuteur va dans la bulle.
    expect(m.etat.principaleId).toBe("musique");
    expect(m.etat.bulleId).toBe("minuteur");
    expect(m.etat.transition?.ressort).toBe("compactVersSplit");

    m.envoyer({ type: "ACTIVITE_FIN", id: "minuteur" });
    expect(m.etat.mode).toBe("compact");
    expect(m.etat.principaleId).toBe("musique");
    expect(m.etat.bulleId).toBeNull();
    expect(m.etat.transition?.ressort).toBe("splitVersCompact");

    m.envoyer({ type: "ACTIVITE_FIN", id: "musique" });
    expect(m.etat.mode).toBe("repos");
    expect(m.etat.principaleId).toBeNull();
    expect(m.etat.transition?.ressort).toBe("disparition");
  });

  it("la priorité ne dépend pas de l'ordre d'arrivée", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    expect(m.etat.principaleId).toBe("musique");
    expect(m.etat.bulleId).toBe("minuteur");
  });

  it("à priorité égale, la plus récente gagne", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "a", type: "musique" } });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: { id: "b", type: "musique" } });
    expect(m.etat.principaleId).toBe("b");
    expect(m.etat.bulleId).toBe("a");
  });

  it("redémarrer une activité existante ne la duplique pas et ne crée pas de transition", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    effets.length = 0;
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: { ...musique, donnees: { titre: "B" } } });
    expect(m.etat.activites).toHaveLength(1);
    expect(effets.filter((e) => e.type === "transition")).toHaveLength(0);
  });

  it("ACTIVITE_MAJ change les données sans transition", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    effets.length = 0;
    m.envoyer({ type: "ACTIVITE_MAJ", id: "musique", donnees: { titre: "Nouvelle" } });
    expect(m.etat.activites[0]?.donnees).toEqual({ titre: "Nouvelle" });
    expect(effets).toHaveLength(0);
  });

  it("ignore la fin / la mise à jour d'une activité inconnue", () => {
    const e0 = etatInitial();
    expect(reduire(e0, { type: "ACTIVITE_FIN", id: "x" }, DUREES).etat).toBe(e0);
    expect(reduire(e0, { type: "ACTIVITE_MAJ", id: "x", donnees: 1 }, DUREES).etat).toBe(e0);
  });
});

describe("clics", () => {
  it("clic court en compact → effet « activer » (ouvrir l'app source), pas de changement d'état", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    effets.length = 0;
    m.envoyer({ type: "CLIC" });
    expect(effets).toEqual([{ type: "activer", activiteId: "musique" }]);
    expect(m.etat.mode).toBe("compact");
  });

  it("clic court sur la bulle active l'activité de la bulle", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    effets.length = 0;
    m.envoyer({ type: "CLIC", cible: "bulle" });
    expect(effets).toEqual([{ type: "activer", activiteId: "minuteur" }]);
  });

  it("clic au repos : rien", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "CLIC" });
    m.envoyer({ type: "CLIC_LONG" });
    expect(effets).toHaveLength(0);
    expect(m.etat.mode).toBe("repos");
  });

  it("clic long → étendu ; clic extérieur → compact", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    expect(m.etat.mode).toBe("etendu");
    expect(m.etat.etendueId).toBe("musique");
    expect(m.etat.transition?.ressort).toBe("ouvrir");

    m.envoyer({ type: "CLIC_EXTERIEUR" });
    expect(m.etat.mode).toBe("compact");
    expect(m.etat.etendueId).toBeNull();
    expect(m.etat.transition?.ressort).toBe("fermer");
  });

  it("clic long sur la bulle en split → étend l'activité de la bulle, puis retour en split", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    m.envoyer({ type: "CLIC_LONG", cible: "bulle" });
    expect(m.etat.mode).toBe("etendu");
    expect(m.etat.principaleId).toBe("minuteur");
    m.envoyer({ type: "CLIC_EXTERIEUR" });
    expect(m.etat.mode).toBe("split");
    expect(m.etat.principaleId).toBe("musique");
  });

  it("clic extérieur hors de l'état étendu : rien", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    effets.length = 0;
    m.envoyer({ type: "CLIC_EXTERIEUR" });
    expect(effets).toHaveLength(0);
  });

  it("fin de l'activité étendue → retour compact / repos", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "ACTIVITE_FIN", id: "musique" });
    expect(m.etat.mode).toBe("repos");
    expect(m.etat.etendueId).toBeNull();
  });

  it("une 2e activité qui arrive pendant l'état étendu ne le ferme pas", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    expect(m.etat.mode).toBe("etendu");
    expect(m.etat.principaleId).toBe("musique");
    m.envoyer({ type: "CLIC_EXTERIEUR" });
    expect(m.etat.mode).toBe("split");
  });

  it("appui : enfoncé / relâché (pour l'effet de compression)", () => {
    const { m } = creer();
    m.envoyer({ type: "APPUI_DEBUT" });
    expect(m.etat.appuye).toBe(true);
    m.envoyer({ type: "APPUI_FIN" });
    expect(m.etat.appuye).toBe(false);
  });
});

describe("alertes et retours automatiques", () => {
  it("alerte → retour automatique à l'état précédent après la durée configurée", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ALERTE", alerte: { type: "batterie", donnees: { pourcentage: 20 } } });
    expect(m.etat.mode).toBe("alerte");
    expect(m.etat.transition?.ressort).toBe("alerteEntree");

    h.avancer(999);
    expect(m.etat.mode).toBe("alerte");
    h.avancer(1);
    expect(m.etat.mode).toBe("compact");
    expect(m.etat.transition?.ressort).toBe("alerteSortie");
    expect(h.nbTaches()).toBe(0);
  });

  it("alerte > minuteur > musique : l'alerte passe devant le split", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    m.envoyer({ type: "ALERTE", alerte: { type: "volume" } });
    expect(m.etat.mode).toBe("alerte");
    h.avancer(1000);
    expect(m.etat.mode).toBe("split");
  });

  it("une nouvelle alerte relance le compte à rebours (volume qui bouge encore)", () => {
    const { m, h, effets } = creer();
    m.envoyer({ type: "ALERTE", alerte: { type: "volume", donnees: 10 } });
    h.avancer(800);
    effets.length = 0;
    m.envoyer({ type: "ALERTE", alerte: { type: "volume", donnees: 20 } });
    // Même type d'alerte → pas de nouvelle transition de forme.
    expect(effets.filter((e) => e.type === "transition")).toHaveLength(0);
    h.avancer(800);
    expect(m.etat.mode).toBe("alerte");
    expect(m.etat.alerte?.donnees).toBe(20);
    h.avancer(200);
    expect(m.etat.mode).toBe("repos");
  });

  it("un autre type d'alerte crée une transition", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ALERTE", alerte: { type: "volume" } });
    effets.length = 0;
    m.envoyer({ type: "ALERTE", alerte: { type: "chargeur" } });
    expect(effets.filter((e) => e.type === "transition")).toHaveLength(1);
  });

  it("clic sur une alerte la ferme immédiatement et annule sa minuterie", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ALERTE", alerte: { type: "chargeur" } });
    m.envoyer({ type: "CLIC" });
    expect(m.etat.mode).toBe("compact");
    expect(h.nbTaches()).toBe(0);
  });

  it("une activité qui finit pendant une alerte : après l'alerte, on revient au bon état", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ALERTE", alerte: { type: "batterie" } });
    m.envoyer({ type: "ACTIVITE_FIN", id: "musique" });
    expect(m.etat.mode).toBe("alerte");
    h.avancer(1000);
    expect(m.etat.mode).toBe("repos");
  });

  it("une minuterie périmée (vieux jeton) est ignorée", () => {
    const e0 = etatInitial();
    const r1 = reduire(e0, { type: "ALERTE", alerte: { type: "volume" } }, DUREES);
    const jeton = r1.etat.minuteries.alerte!;
    const r2 = reduire(r1.etat, { type: "MINUTERIE", nom: "alerte", jeton: jeton + 99 }, DUREES);
    expect(r2.etat.mode).toBe("alerte");
    const r3 = reduire(r1.etat, { type: "MINUTERIE", nom: "alerte", jeton }, DUREES);
    expect(r3.etat.mode).toBe("repos");
  });

  it("durée non mesurée (null) : pas de minuterie, avertissement dans la console", () => {
    const h = fausseHorloge();
    const avertir = vi.fn();
    const m = new IslandMachine({ alerteAffichageMs: null, etenduFermetureAutoMs: null }, h.horloge, avertir);
    m.envoyer({ type: "ALERTE", alerte: { type: "volume" } });
    expect(h.nbTaches()).toBe(0);
    expect(avertir).toHaveBeenCalledOnce();
    expect(m.etat.mode).toBe("alerte");
  });
});

describe("survol et fermeture automatique de l'état étendu", () => {
  it("le curseur quitte l'île étendue → fermeture après le délai", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "SURVOL_DEBUT" });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "SURVOL_FIN" });
    h.avancer(499);
    expect(m.etat.mode).toBe("etendu");
    h.avancer(1);
    expect(m.etat.mode).toBe("compact");
  });

  it("le curseur revient avant le délai → reste étendu", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "SURVOL_FIN" });
    h.avancer(300);
    m.envoyer({ type: "SURVOL_DEBUT" });
    h.avancer(1000);
    expect(m.etat.mode).toBe("etendu");
    expect(m.etat.survol).toBe(true);
  });

  it("fermer l'état étendu annule la minuterie de fermeture", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "SURVOL_FIN" });
    m.envoyer({ type: "CLIC_EXTERIEUR" });
    expect(h.nbTaches()).toBe(0);
    expect(m.etat.minuteries.fermetureEtendu).toBeUndefined();
  });

  it("survol hors de l'état étendu : aucun changement visuel", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    effets.length = 0;
    m.envoyer({ type: "SURVOL_DEBUT" });
    m.envoyer({ type: "SURVOL_FIN" });
    expect(effets).toHaveLength(0);
    expect(m.etat.mode).toBe("compact");
  });
});

describe("transitions : numérotation, interruption, file d'événements", () => {
  it("chaque transition a un numéro unique croissant", () => {
    const { m, effets } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "CLIC_EXTERIEUR" });
    const ids = effets.flatMap((e) => (e.type === "transition" ? [e.transition.id] : []));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("une transition lancée avant la fin de la précédente l'interrompt", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    const t1 = m.etat.transition!;
    m.envoyer({ type: "CLIC_LONG" }); // t1 pas encore finie
    expect(m.etat.transition?.interrompt).toBe(t1.id);
  });

  it("une transition lancée après TRANSITION_FIN n'interrompt rien", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "TRANSITION_FIN", id: m.etat.transition!.id });
    expect(m.etat.transition).toBeNull();
    m.envoyer({ type: "CLIC_LONG" });
    expect(m.etat.transition?.interrompt).toBeNull();
  });

  it("TRANSITION_FIN d'une vieille transition est ignorée", () => {
    const { m } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    const t1 = m.etat.transition!.id;
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "TRANSITION_FIN", id: t1 });
    expect(m.etat.transition).not.toBeNull();
  });

  it("les événements envoyés par un abonné sont mis en file, pas traités en même temps", () => {
    const { m } = creer();
    const ordre: string[] = [];
    let profondeur = 0;
    let profondeurMax = 0;
    m.abonner((_e, _eff, ev: Evenement) => {
      profondeur++;
      profondeurMax = Math.max(profondeurMax, profondeur);
      ordre.push(ev.type);
      if (ev.type === "ACTIVITE_DEBUT") {
        m.envoyer({ type: "CLIC_LONG" });
        // Le CLIC_LONG n'a pas encore été traité : on est toujours en compact.
        expect(m.etat.mode).toBe("compact");
      }
      profondeur--;
    });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    expect(ordre).toEqual(["ACTIVITE_DEBUT", "CLIC_LONG"]);
    expect(profondeurMax).toBe(1);
    expect(m.etat.mode).toBe("etendu");
  });

  it("REINITIALISER efface activités, alerte et état étendu, et annule les minuteries", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: musique });
    m.envoyer({ type: "ACTIVITE_DEBUT", activite: minuteur });
    m.envoyer({ type: "CLIC_LONG" });
    m.envoyer({ type: "ALERTE", alerte: { type: "volume" } });
    m.envoyer({ type: "REINITIALISER" });
    expect(m.etat.mode).toBe("repos");
    expect(m.etat.activites).toEqual([]);
    expect(m.etat.etendueId).toBeNull();
    expect(h.nbTaches()).toBe(0);
    expect(m.etat.transition?.vers).toBe("repos");
  });

  it("detruire() annule toutes les minuteries", () => {
    const { m, h } = creer();
    m.envoyer({ type: "ALERTE", alerte: { type: "volume" } });
    expect(h.nbTaches()).toBe(1);
    m.detruire();
    expect(h.nbTaches()).toBe(0);
  });
});
