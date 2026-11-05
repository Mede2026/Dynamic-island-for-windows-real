import { describe, expect, it } from "vitest";
import { Traducteur } from "./traducteur";
import type { EtatBatterie, EtatMedia, EtatMinuteur } from "./types";

const media = (p: Partial<EtatMedia>): EtatMedia => ({
  sources: [],
  sourceActive: "Spotify.exe",
  sourceEpinglee: null,
  titre: "Chanson",
  artiste: "Artiste",
  album: "",
  statut: "lecture",
  positionMs: 0,
  dureeMs: 1000,
  positionMajAMs: 0,
  peutLirePause: true,
  peutSuivant: true,
  peutPrecedent: true,
  peutAllerA: true,
  pochetteId: null,
  ...p,
});

const batt = (p: Partial<EtatBatterie>): EtatBatterie => ({
  presente: true,
  pourcentage: 50,
  branche: false,
  enCharge: false,
  economie: false,
  ...p,
});

const minut = (statut: EtatMinuteur["statut"]): EtatMinuteur => ({ statut, dureeMs: 1000, restantMs: 500, finAMs: null });

describe("Traducteur", () => {
  it("musique : début → mise à jour → fin", () => {
    const t = new Traducteur();
    expect(t.media(media({}))[0]?.type).toBe("ACTIVITE_DEBUT");
    expect(t.media(media({ statut: "pause" }))[0]?.type).toBe("ACTIVITE_MAJ");
    expect(t.media(media({ statut: "arrete" }))).toEqual([{ type: "ACTIVITE_FIN", id: "musique" }]);
    expect(t.media(media({ sourceActive: null }))).toEqual([]);
  });

  it("musique en pause sans titre n'est pas une activité", () => {
    const t = new Traducteur();
    expect(t.media(media({ statut: "pause", titre: "" }))).toEqual([]);
  });

  it("minuteur : début, pause, fin normale avec alerte", () => {
    const t = new Traducteur();
    expect(t.minuteurEtat(minut("enCours"))[0]?.type).toBe("ACTIVITE_DEBUT");
    expect(t.minuteurEtat(minut("pause"))[0]?.type).toBe("ACTIVITE_MAJ");
    const fin = t.minuteurEtat(minut("termine"));
    expect(fin.map((e) => e.type)).toEqual(["ACTIVITE_FIN", "ALERTE"]);
  });

  it("minuteur annulé → fin sans alerte", () => {
    const t = new Traducteur();
    t.minuteurEtat(minut("enCours"));
    expect(t.minuteurEtat(minut("inactif"))).toEqual([{ type: "ACTIVITE_FIN", id: "minuteur" }]);
  });

  it("batterie déjà faible au démarrage (sans chargeur) : alerte", () => {
    expect(new Traducteur().batterieEtat(batt({ pourcentage: 18 }))[0]).toMatchObject({ alerte: { type: "batterie" } });
    expect(new Traducteur().batterieEtat(batt({ pourcentage: 18, branche: true }))).toEqual([]);
  });

  it("appel : début et fin d'activité ; capture d'écran : alerte dédiée", () => {
    const t = new Traducteur();
    expect(t.appel({ actif: true, application: "Teams" })[0]?.type).toBe("ACTIVITE_DEBUT");
    expect(t.appel({ actif: true, application: "Teams" })).toEqual([]);
    expect(t.appel({ actif: false, application: null })).toEqual([{ type: "ACTIVITE_FIN", id: "appel" }]);
    expect(t.pressePapiers({ type: "capture", apercu: "" })[0]).toMatchObject({ alerte: { type: "capture" } });
  });

  it("batterie : pas d'alerte à la première lecture, alerte au branchement", () => {
    const t = new Traducteur();
    expect(t.batterieEtat(batt({}))).toEqual([]);
    expect(t.batterieEtat(batt({ branche: true }))[0]).toMatchObject({ alerte: { type: "chargeur" } });
    expect(t.batterieEtat(batt({ branche: false }))[0]).toMatchObject({ alerte: { type: "chargeur" } });
  });

  it("batterie : alerte en franchissant 20 % puis 10 %, une seule fois", () => {
    const t = new Traducteur();
    t.batterieEtat(batt({ pourcentage: 21 }));
    expect(t.batterieEtat(batt({ pourcentage: 20 }))[0]).toMatchObject({ alerte: { type: "batterie" } });
    expect(t.batterieEtat(batt({ pourcentage: 19 }))).toEqual([]);
    expect(t.batterieEtat(batt({ pourcentage: 10 }))).toHaveLength(1);
    // En charge : pas d'alerte de batterie faible.
    t.batterieEtat(batt({ pourcentage: 25, branche: true }));
    t.batterieEtat(batt({ pourcentage: 25, branche: true }));
    expect(t.batterieEtat(batt({ pourcentage: 20, branche: true }))).toEqual([]);
  });

  it("volume : pas d'alerte pour la lecture initiale", () => {
    const t = new Traducteur();
    expect(t.volume({ niveau: 0.5, muet: false, initial: true })).toEqual([]);
    expect(t.volume({ niveau: 0.6, muet: false, initial: false })).toHaveLength(1);
  });

  it("ne pas déranger : alerte seulement quand l'état change", () => {
    const t = new Traducteur();
    const n = (actif: boolean) => ({ actif, notificationsCoupees: actif, sessionConcentration: null });
    expect(t.nePasDerangerEtat(n(false))).toEqual([]);
    expect(t.nePasDerangerEtat(n(false))).toEqual([]);
    expect(t.nePasDerangerEtat(n(true))).toHaveLength(1);
  });

  it("survol et clic extérieur", () => {
    const t = new Traducteur();
    expect(t.survol(true)).toEqual([{ type: "SURVOL_DEBUT" }]);
    expect(t.survol(false)).toEqual([{ type: "SURVOL_FIN" }]);
    expect(t.clicExterieur()).toEqual([{ type: "CLIC_EXTERIEUR" }]);
  });
});
