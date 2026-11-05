"""Comparaison de deux vidéos (iPhone vs notre île) : courbes superposées + score d'écart."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .analyse import ResultatSegment, Table, periode_image_ms
from .graphiques import graphique_comparaison

OBJECTIF_ECART_POURCENT = 3.0
OBJECTIF_DELAI_IMAGES = 1.0


def _serie_relative(table: Table, seg: ResultatSegment, nom: str, echelle: float):
    t0 = seg.contenu.get("t0_forme_ms", seg.debut_ms)
    t = table["temps_ms"] - t0
    v = table[nom] / echelle
    ok = ~np.isnan(v) & (t >= -50) & (t <= seg.fin_ms - t0 + 300)
    return t[ok], v[ok]


def comparer(
    table_a: Table, seg_a: ResultatSegment, echelle_a: float,
    table_b: Table, seg_b: ResultatSegment, echelle_b: float,
    dossier: Path, nom_a: str = "iPhone", nom_b: str = "notre île",
) -> dict:
    rapport: dict = {"dimensions": {}, "objectif_ecart_pourcent": OBJECTIF_ECART_POURCENT}
    for nom in ("largeur", "hauteur"):
        ta, a = _serie_relative(table_a, seg_a, nom, echelle_a)
        tb, b = _serie_relative(table_b, seg_b, nom, echelle_b)
        if len(ta) < 3 or len(tb) < 3:
            rapport["dimensions"][nom] = {"erreur": "pas assez de mesures"}
            continue
        fin = min(ta.max(), tb.max())
        grille = np.arange(0.0, fin, 2.0)
        ia, ib = np.interp(grille, ta, a), np.interp(grille, tb, b)
        amplitude = max(abs(seg_a.ressorts.get(nom, {}).get("x1", a[-1]) - seg_a.ressorts.get(nom, {}).get("x0", a[0])), 1e-6)
        diff = ib - ia
        rapport["dimensions"][nom] = {
            "ecart_rms_pourcent": float(np.sqrt(np.mean(diff**2)) / amplitude * 100),
            "ecart_max_pourcent": float(np.max(np.abs(diff)) / amplitude * 100),
            "amplitude_pt": float(amplitude),
        }
        graphique_comparaison(
            ta, a, tb, b, nom_a, nom_b,
            f"{nom} — {nom_a} vs {nom_b} (écart RMS {rapport['dimensions'][nom]['ecart_rms_pourcent']:.2f} %)",
            dossier / f"comparaison_{nom}.png", "points (pt)",
        )

    # Délais du contenu, en ms et en images.
    periode = periode_image_ms(table_a["temps_ms"])
    delais = {}
    for p in (3, 10, 50, 90):
        cle = f"t{p}_depuis_debut_forme_ms"
        da, db = seg_a.contenu.get(cle), seg_b.contenu.get(cle)
        if da is not None and db is not None:
            delais[f"t{p}"] = {"a_ms": da, "b_ms": db, "ecart_ms": db - da, "ecart_images": (db - da) / periode}
    rapport["delais_contenu"] = delais
    rapport["periode_image_ms"] = periode

    ecarts = [d["ecart_rms_pourcent"] for d in rapport["dimensions"].values() if "ecart_rms_pourcent" in d]
    delai_ok = all(abs(d["ecart_images"]) <= OBJECTIF_DELAI_IMAGES for d in delais.values())
    rapport["score_ecart_pourcent"] = max(ecarts) if ecarts else None
    rapport["objectif_atteint"] = bool(ecarts) and max(ecarts) < OBJECTIF_ECART_POURCENT and delai_ok
    return rapport
