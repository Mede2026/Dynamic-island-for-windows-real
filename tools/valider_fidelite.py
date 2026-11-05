#!/usr/bin/env python3
"""
Validation de la fidélité (phase 2.4) : notre île vs l'iPhone.

1. Enregistrer notre île :   npx vite --port 1420 &   puis   node tools/enregistrer_ile.cjs
2. Comparer :               python tools/valider_fidelite.py  → docs/fidelite.md + docs/img/fidelite_*.png

Pour chaque transition, on compare la PROGRESSION normalisée p(t) = (x − x_début)/(x_fin − x_début)
de notre île et de l'iPhone, alignées sur le début du mouvement (t0 du ressort ajusté).
Écart = RMS(p_notre − p_iphone) × 100 sur la fenêtre (objectif < 3 %).
On compare aussi les tailles finales (pt) et les délais du contenu (objectif ±1 image).
Les enregistrements de notre île sont aussi convertis en .mov (cadence variable) pour
`analyze_video.py --compare`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import mesurer_reference as REF  # noqa: E402
from ilelib.detection import detecter  # noqa: E402
from ilelib.graphiques import graphique_comparaison  # noqa: E402
from ilelib.ressort import ajuster_ressort, modele_avec_depart  # noqa: E402

RACINE = Path(__file__).resolve().parent
NOTRE = RACINE / "output" / "notre_ile"
DOCS = RACINE.parent / "docs"
IMG = DOCS / "img"
OBJECTIF_POURCENT = 3.0
ECHELLE_NOTRE = 1.0  # le screencast capture en px CSS (= DIP) : 1 px par point avec ISLAND_SCALE 1


def lire_enregistrement(nom: str):
    dossier = NOTRE / nom
    temps = np.array(json.loads((dossier / "temps.json").read_text()))
    fichiers = sorted(dossier.glob("img*.png"))
    lignes = []
    for t, f in zip(temps, fichiers):
        m = detecter(cv2.imread(str(f)))
        if m.ile is None:
            continue
        lignes.append((t, m.ile.largeur / ECHELLE_NOTRE, m.ile.hauteur / ECHELLE_NOTRE, m.contenu_luminance))
    return np.array(lignes)


def ecrire_mov(nom: str) -> Path | None:
    """Images + horodatages → .mov H.264 à cadence variable (pour analyze_video.py --compare)."""
    if shutil.which("ffmpeg") is None:
        return None
    dossier = NOTRE / nom
    temps = np.array(json.loads((dossier / "temps.json").read_text())) / 1000
    fichiers = sorted(dossier.glob("img*.png"))
    lignes = []
    for i, f in enumerate(fichiers):
        lignes.append(f"file '{f.as_posix()}'")
        if i + 1 < len(fichiers):
            lignes.append(f"duration {max(temps[i + 1] - temps[i], 1e-3):.6f}")
    lignes.append(lignes[-1])
    (dossier / "liste.txt").write_text("\n".join(lignes) + "\n")
    sortie = NOTRE / f"{nom}.mov"
    # Les images PNG arrivent par concat ; on impose une base de temps fine (1/1000 s).
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(dossier / "liste.txt"),
         "-fps_mode", "vfr", "-enc_time_base", "1/1000", "-video_track_timescale", "1000",
         "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", str(sortie)],
        check=False,
    )
    return sortie if sortie.exists() else None


def fenetre_montee(s: np.ndarray, col: int, apres_s: float, duree: float = 0.9):
    """Fenêtre qui commence au minimum local (après `apres_s`) et monte vers le maximum suivant."""
    t = s[:, 0] / 1000
    i0 = np.searchsorted(t, apres_s)
    imax = i0 + int(np.argmax(s[i0:, col]))
    imin = i0 + int(np.argmin(s[i0:imax + 1, col]))
    return (t >= t[imin] - 0.03) & (t <= t[imin] + duree)


def fenetre_descente(s: np.ndarray, col: int, apres_s: float, duree: float = 0.7):
    """Fenêtre qui commence quand la valeur commence à baisser (après `apres_s`)."""
    t = s[:, 0] / 1000
    i0 = np.searchsorted(t, apres_s)
    v0 = s[i0, col]
    baisse = np.nonzero(s[i0:, col] < v0 - 0.5)[0]
    ib = i0 + (int(baisse[0]) - 1 if len(baisse) else 0)
    return (t >= t[ib] - 0.03) & (t <= t[ib] + duree)


def debut_mouvement(t, x, x0, x1, seuil=0.02):
    """Instant (interpolé) où x s'écarte de x0 de plus de `seuil` × amplitude."""
    a = abs(x1 - x0)
    for i in range(1, len(x)):
        if abs(x[i] - x0) > seuil * a:
            e0, e1 = abs(x[i - 1] - x0), abs(x[i] - x0)
            return float(t[i - 1] + (seuil * a - e0) / max(e1 - e0, 1e-9) * (t[i] - t[i - 1]))
    return float(t[0])


def depuis_extremum(t, x):
    """Coupe la série à son point de départ réel : point bas pour une montée, point haut pour une descente."""
    i = int(np.argmin(x)) if x[-1] > x[0] else int(np.argmax(x))
    i = min(i, max(len(x) - 6, 0))
    return t[i:], x[i:]


def progression(t, x, x1=None):
    """Progression normalisée avec les valeurs MESURÉES : départ = extremum de départ, fin = x1
    (cible connue) ou médiane des 3 dernières valeurs ; t = 0 au début du mouvement."""
    if x1 is None:
        t, x = depuis_extremum(t, x)
    x0 = float(x[0])
    x1 = float(np.median(x[-3:])) if x1 is None else float(x1)
    t_debut = debut_mouvement(t, x, x0, x1)
    return t - t_debut, (x - x0) / (x1 - x0)


def comparer(nom: str, ref_trans: str, notre_t, notre_x, cle: str, cible_ref=None, cible_notre=None):
    """Compare une série de notre île à la transition de référence (même axe, même méthode)."""
    video, d, f, _ = REF.TRANSITIONS[ref_trans]
    t_ref, x_ref = mesures_ref[ref_trans][cle]
    fit_ref = ajuster_ressort(t_ref, x_ref, vitesse_initiale=True).en_dict()
    fit_notre = ajuster_ressort(notre_t, notre_x, vitesse_initiale=True).en_dict()
    ta, pa = progression(t_ref, x_ref, cible_ref)
    tb, pb = progression(notre_t, notre_x, cible_notre)
    fin = min(ta.max(), tb.max(), 0.6)
    grille = np.arange(0.0, fin, 0.002)
    ia, ib = np.interp(grille, ta, pa), np.interp(grille, tb, pb)
    ecart = float(np.sqrt(np.mean((ib - ia) ** 2)) * 100)
    graphique_comparaison(ta * 1000, pa, tb * 1000, pb, f"iPhone ({video})", "notre île",
                          f"{nom} — {cle} : écart RMS {ecart:.2f} %", IMG / f"fidelite_{nom}_{cle}.png",
                          "progression (0 → 1)")
    return {
        "transition": nom, "axe": cle, "reference": f"{video} {d:.2f}–{f:.2f} s",
        "ecart_rms_pourcent": ecart,
        "iphone": {k: fit_ref[k] for k in ("response", "dampingFraction", "x0", "x1", "v0")},
        "notre": {k: fit_notre[k] for k in ("response", "dampingFraction", "x0", "x1", "v0")},
        "ok": ecart < OBJECTIF_POURCENT,
    }


def series_reference():
    """Séries brutes (t en s, valeur en pt) des transitions de référence, mises en cache."""
    cache = RACINE / "output" / "reference" / "series.json"
    if cache.exists():
        return {k: {a: (np.array(b[0]), np.array(b[1])) for a, b in v.items()} for k, v in json.loads(cache.read_text()).items()}
    res = {}
    for nom, (video, d, f, _) in REF.TRANSITIONS.items():
        ex, ey = REF.echelles(REF.ENTREE / f"{video}.MP4")
        T, W, H, L = [], [], [], []
        for _, t, img in REF.images(video, d, f):
            m = detecter(img)
            if m.ile is None:
                continue
            T.append(t / 1000)
            W.append(m.ile.largeur / ex)
            H.append(m.ile.hauteur / ey)
            L.append(m.contenu_luminance)
        res[nom] = {"largeur": (np.array(T), np.array(W)), "hauteur": (np.array(T), np.array(H)), "lum": (np.array(T), np.array(L))}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({k: {a: [b[0].tolist(), b[1].tolist()] for a, b in v.items()} for k, v in res.items()}))
    return res


def delais(t_s, lum, t0_s, sens):
    """Instants (ms depuis t0) où la luminance du contenu franchit 3/50/90 % (interpolés)."""
    base = float(np.interp(t0_s, t_s, lum))
    final = float(np.median(lum[-3:]))
    out = {}
    for p in (3, 50, 90):
        niveau = base + (final - base) * p / 100
        out[p] = None
        for i in range(1, len(lum)):
            if t_s[i] < t0_s:
                continue
            a, b = lum[i - 1], lum[i]
            if (sens == "apparition" and a < niveau <= b) or (sens != "apparition" and a > niveau >= b):
                out[p] = float((t_s[i - 1] + (niveau - a) / (b - a) * (t_s[i] - t_s[i - 1]) - t0_s) * 1000)
                break
    return out


def main() -> int:
    global mesures_ref
    IMG.mkdir(parents=True, exist_ok=True)
    mesures_ref = series_reference()
    rec = {n: lire_enregistrement(n) for n in ("ouvrir_fermer", "split", "alerte", "repos")}
    movs = {n: ecrire_mov(n) for n in rec}
    resultats = []

    # Instants des déclencheurs dans enregistrer_ile.cjs (cumul des attentes).
    s = rec["ouvrir_fermer"]
    for cle, col in (("largeur", 1), ("hauteur", 2)):
        f = fenetre_montee(s, col, 2.25)
        resultats.append(comparer("ouvrir", "ouvrir", s[f, 0] / 1000, s[f, col], cle))
        f = fenetre_descente(s, col, 4.3, 0.37 if cle == "largeur" else 0.8)
        ref = "fermer_b" if cle == "largeur" else "fermer_hauteur"
        resultats.append(comparer("fermer", ref, s[f, 0] / 1000, s[f, col], cle))
    f = fenetre_montee(s, 1, 0.5, 0.75)
    resultats.append(comparer("apparition", "apparition", s[f, 0] / 1000, s[f, 1], "largeur"))

    repos = REF_ETATS["repos"]["largeur_pt"]
    s = rec["alerte"]
    f = fenetre_descente(s, 1, 2.1, 0.22)
    resultats.append(comparer("retrait", "retrait", s[f, 0] / 1000, s[f, 1], "largeur", repos, repos))
    f = fenetre_montee(s, 1, 2.25)
    resultats.append(comparer("alerteEntree", "alerteEntree", s[f, 0] / 1000, s[f, 1], "largeur"))
    f = fenetre_descente(s, 1, 5.2)
    resultats.append(comparer("alerteSortie", "alerteSortie", s[f, 0] / 1000, s[f, 1], "largeur"))

    s = rec["split"]
    f = fenetre_montee(s, 1, 4.1, 0.6)
    resultats.append(comparer("splitVersCompact", "splitVersCompact", s[f, 0] / 1000, s[f, 1], "largeur"))

    s = rec["repos"]
    f = fenetre_descente(s, 1, 2.1, 0.7)
    resultats.append(comparer("disparition", "retrait", s[f, 0] / 1000, s[f, 1], "largeur", repos, repos))

    # Tailles des états stables (pt).
    tailles = []
    s = rec["ouvrir_fermer"]
    t = s[:, 0] / 1000
    for nom, (a, b), etat in (("compact (2 côtés)", (2.0, 2.2), None), ("étendu", (3.8, 4.3), "etendu")):
        sel = (t > a) & (t < b)
        tailles.append({"etat": nom, "notre_pt": [float(np.median(s[sel, 1])), float(np.median(s[sel, 2]))],
                        "iphone_pt": None if etat is None else [REF_ETATS[etat]["largeur_pt"], REF_ETATS[etat]["hauteur_pt"]]})
    s = rec["alerte"]
    t = s[:, 0] / 1000
    sel = (t > 3.2) & (t < 4.8)
    tailles.append({"etat": "alerte", "notre_pt": [float(np.median(s[sel, 1])), float(np.median(s[sel, 2]))],
                    "iphone_pt": [REF_ETATS["alerte"]["largeur_pt"], REF_ETATS["alerte"]["hauteur_pt"]]})
    t = rec["repos"][:, 0] / 1000
    sel = t < 0.5
    tailles.append({"etat": "repos", "notre_pt": [float(np.median(rec["repos"][sel, 1])), float(np.median(rec["repos"][sel, 2]))],
                    "iphone_pt": [REF_ETATS["repos"]["largeur_pt"], REF_ETATS["repos"]["hauteur_pt"]]})

    # Délais du contenu (ouverture), en ms depuis le début du mouvement de la forme.
    s = rec["ouvrir_fermer"]
    f = fenetre_montee(s, 2, 2.25)
    h = s[f, 2]
    t0_notre = debut_mouvement(s[f, 0] / 1000, h, h[0], np.median(h[-3:]))
    notre_delais = delais(s[f, 0] / 1000, s[f, 3], t0_notre, "apparition")
    ref = mesures_ref["ouvrir"]
    th, hh = ref["hauteur"]
    t0_ref = debut_mouvement(th, hh, hh[0], np.median(hh[-3:]))
    ref_delais = delais(ref["lum"][0], ref["lum"][1], t0_ref, "apparition")
    periode = float(np.median(np.diff(ref["lum"][0]))) * 1000

    rapport = {"transitions": resultats, "tailles": tailles,
               "contenu_ouvrir": {"notre_ms": notre_delais, "iphone_ms": ref_delais, "periode_image_ms": periode},
               "videos_notre_ile": {k: (str(v.relative_to(RACINE.parent)) if v else None) for k, v in movs.items()}}
    (RACINE / "output" / "fidelite.json").write_text(json.dumps(rapport, indent=2, ensure_ascii=False, default=float))
    ecrire_rapport(rapport)
    for r in resultats:
        print(f"{r['transition']:18s} {r['axe']:8s} écart {r['ecart_rms_pourcent']:5.2f} % {'OK' if r['ok'] else '✗'}")
    print("contenu (ms) notre", notre_delais, "iPhone", ref_delais)
    return 0


def ecrire_rapport(r: dict) -> None:
    L = ["# Fidélité : notre île vs iPhone 16 Pro", "",
         "Généré par `tools/valider_fidelite.py` à partir de :",
         "- l'enregistrement de **notre île** (rendu réel React + Framer Motion dans Chromium, "
         "`tools/enregistrer_ile.cjs`, 120 images/s avec une horloge virtuelle : horodatages exacts) ;",
         "- les **vidéos de référence** de l'iPhone (voir `docs/mesures.md`).", "",
         "## Courbes (progression normalisée, alignée sur le début du mouvement)", "",
         f"Objectif : écart RMS < {OBJECTIF_POURCENT:.0f} %.", "",
         "| Transition | Axe | Référence iPhone | Écart RMS | iPhone (response / ζ) | Notre île (response / ζ) | |",
         "|---|---|---|---|---|---|---|"]
    for x in r["transitions"]:
        L.append(f"| {x['transition']} | {x['axe']} | {x['reference']} | **{x['ecart_rms_pourcent']:.2f} %** | "
                 f"{x['iphone']['response']:.3f} s / {x['iphone']['dampingFraction']:.3f} | "
                 f"{x['notre']['response']:.3f} s / {x['notre']['dampingFraction']:.3f} | {'✅' if x['ok'] else '⚠️'} |")
    L += ["", "## Tailles des états stables (pt)", "", "| État | Notre île (l × h) | iPhone (l × h) |", "|---|---|---|"]
    for t in r["tailles"]:
        ip = "—" if t["iphone_pt"] is None else f"{t['iphone_pt'][0]:.2f} × {t['iphone_pt'][1]:.2f}"
        L.append(f"| {t['etat']} | {t['notre_pt'][0]:.2f} × {t['notre_pt'][1]:.2f} | {ip} |")
    c = r["contenu_ouvrir"]
    L += ["", "## Délais du contenu (ouverture)", "",
          f"Une image iPhone = {c['periode_image_ms']:.1f} ms. Objectif : ±1 image.", "",
          "| Seuil | Notre île | iPhone | Écart (images) |", "|---|---|---|---|"]
    for p in ("3", "50", "90"):
        a, b = c["notre_ms"].get(int(p)) if isinstance(next(iter(c["notre_ms"])), int) else c["notre_ms"].get(p), \
            c["iphone_ms"].get(int(p)) if isinstance(next(iter(c["iphone_ms"])), int) else c["iphone_ms"].get(p)
        if a is None or b is None:
            continue
        L.append(f"| {p} % | {a:.0f} ms | {b:.0f} ms | {(a - b) / c['periode_image_ms']:+.2f} |")
    L += ["", "## Graphiques", ""]
    for x in r["transitions"]:
        L.append(f"![{x['transition']} {x['axe']}](img/fidelite_{x['transition']}_{x['axe']}.png)")
    L += ["", "## Refaire la mesure", "", "```bash", "npx vite --port 1420", "```", "", "```bash",
          "node tools/enregistrer_ile.cjs", "```", "", "```bash", "python tools/valider_fidelite.py", "```", "",
          "Pour comparer un enregistrement d'écran **Windows** de l'île (ex. avec la Xbox Game Bar) :", "",
          "```bash", "python tools/analyze_video.py --compare tools/input/IMG_4730.MP4 ma_capture.mp4 --echelle-a 1.6517 --echelle-b 2",
          "```", "", "(`--echelle-b` = échelle Windows × ISLAND_SCALE, ex. 200 % × 1,0 = 2.)"]
    (DOCS / "fidelite.md").write_text("\n".join(L) + "\n", encoding="utf-8")


REF_ETATS = json.loads((DOCS / "mesures.json").read_text())["etats"]
mesures_ref: dict = {}

if __name__ == "__main__":
    raise SystemExit(main())
