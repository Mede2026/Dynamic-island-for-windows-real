#!/usr/bin/env python3
"""
Mesure au pixel près de l'île sur une capture PNG (xcrun simctl io booted screenshot).

  python tools/analyze_screenshot.py tools/input/C1_repos.png
  python tools/analyze_screenshot.py C2_compact_musique.png --echelle 3

Donne : position, largeur, hauteur (px et pt), rayon des coins (arc de cercle),
profil du coin ajusté par une superellipse (exposant n : 2 = cercle, > 2 = coin
« continu » façon Apple) et une estimation du lissage (0–1). Bulle du mode split si présente.
Sorties : tools/output/<nom>/capture.json et coin_ile.png (+ coin_bulle.png).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from ilelib.detection import (  # noqa: E402
    _couverture,
    _niveaux,
    ajuster_cercle,
    ajuster_superellipse,
    echelle_depuis_resolution,
    en_gris,
    masques_candidats,
    detecter,
    profil_coin,
)
from ilelib.graphiques import graphique_coin  # noqa: E402

SORTIE_DEFAUT = Path(__file__).resolve().parent / "output"


def analyser_coin(gris, forme, seuil):
    """Profil du coin haut-gauche + ajustements cercle et superellipse."""
    masques = masques_candidats(gris, seuil, 1.0)
    masque = next(
        (m for m in masques if cv2.boundingRect(m) == forme.boite),
        None,
    )
    if masque is None:
        return None
    fond, f = _niveaux(gris, masque, seuil)
    couv = _couverture(gris, fond, f)
    d, retrait = profil_coin(couv, masque, forme.x, forme.y, forme.hauteur)
    demi = min(forme.hauteur, forme.largeur) / 2
    r, err_c = ajuster_cercle(d, retrait, demi)
    a, n, err_s = ajuster_superellipse(d, retrait, demi)
    # Lissage estimé : 0 pour un arc de cercle (n = 2) ; croît avec n. Repère :
    # n ≈ 4 à 5 pour une « squircle » d'icône iOS. Valeur indicative, à confirmer en phase 2
    # en comparant le profil rendu à ce profil mesuré.
    lissage = float(np.clip((n - 2.0) / 3.0, 0.0, 1.0)) if np.isfinite(n) else None
    return {
        "profil": {"d_px": d.tolist(), "retrait_px": retrait.tolist()},
        "cercle": {"rayon_px": r, "rmse_px": err_c},
        "superellipse": {"etendue_px": a, "exposant_n": n, "rmse_px": err_s},
        "lissage_estime": lissage,
        "capsule_parfaite": bool(abs(r - forme.hauteur / 2) < 0.02 * forme.hauteur and err_c < 0.15),
    }


def en_points(forme, echelle):
    return {
        "x_pt": forme.x / echelle,
        "y_pt": forme.y / echelle,
        "largeur_pt": forme.largeur / echelle,
        "hauteur_pt": forme.hauteur / echelle,
        "rayon_pt": None if forme.rayon is None else forme.rayon / echelle,
    }


def analyser(chemin: Path, echelle: float | None, seuil: float, zone_haut: float, sortie: Path) -> dict:
    image = cv2.imread(str(chemin), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"image illisible : {chemin}")
    h, w = image.shape[:2]
    devinee, description = echelle_depuis_resolution(w, h)
    ech = echelle or devinee or 3.0
    print(f"▶ {chemin.name} : {w}x{h} px — {description if devinee else 'échelle par défaut'} → {ech:g} px/pt")

    gris = en_gris(image)
    m = detecter(image, seuil=seuil, zone_haut=zone_haut)
    if m.ile is None:
        raise SystemExit("île introuvable (essayer --seuil ou --zone-haut)")

    dossier = sortie / chemin.stem
    dossier.mkdir(parents=True, exist_ok=True)
    resultat = {"fichier": str(chemin), "resolution": [w, h], "echelle_px_par_pt": ech}
    for nom, forme in (("ile", m.ile), ("bulle", m.bulle)):
        if forme is None:
            continue
        coin = analyser_coin(gris, forme, seuil)
        resultat[nom] = {
            "pixels": {k: v for k, v in forme.en_dict().items() if k != "boite"},
            "points": en_points(forme, ech),
            "coin": coin,
        }
        print(f"  {nom} : {forme.largeur:.2f} x {forme.hauteur:.2f} px = "
              f"{forme.largeur / ech:.3f} x {forme.hauteur / ech:.3f} pt, en ({forme.x / ech:.3f}, {forme.y / ech:.3f}) pt")
        if coin:
            c, s = coin["cercle"], coin["superellipse"]
            print(f"    coin : cercle r = {c['rayon_px']:.2f} px ({c['rayon_px'] / ech:.3f} pt, écart {c['rmse_px']:.3f} px)"
                  f" | superellipse n = {s['exposant_n']:.2f}, a = {s['etendue_px']:.2f} px (écart {s['rmse_px']:.3f} px)"
                  f" | lissage ≈ {coin['lissage_estime']:.2f}{' | capsule parfaite' if coin['capsule_parfaite'] else ''}")
            graphique_coin(np.array(coin["profil"]["d_px"]), np.array(coin["profil"]["retrait_px"]),
                           c["rayon_px"], s["etendue_px"], s["exposant_n"],
                           f"{chemin.name} — coin haut-gauche ({nom})", dossier / f"coin_{nom}.png")
    (dossier / "capture.json").write_text(json.dumps(resultat, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  → {dossier}")
    return resultat


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("captures", nargs="+", type=Path)
    p.add_argument("--echelle", type=float, help="pixels par point (iPhone @3x = 3)")
    p.add_argument("--seuil", type=float, default=40.0)
    p.add_argument("--zone-haut", type=float, default=0.35)
    p.add_argument("--sortie", type=Path, default=SORTIE_DEFAUT)
    a = p.parse_args(argv)
    for c in a.captures:
        analyser(c, a.echelle, a.seuil, a.zone_haut, a.sortie)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
