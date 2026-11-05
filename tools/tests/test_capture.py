from pathlib import Path

import cv2
import numpy as np
import pytest

import analyze_screenshot
from ilelib.synthetique import FormeSynth, couverture_forme, fond_clair


def capture(tmp_path: Path, formes, nom="c.png", taille=(2556, 1179)) -> Path:
    H, W = taille
    couv = couverture_forme((H, W), formes)[:, :, None]
    img = np.clip(fond_clair(H, W) * (1 - couv), 0, 255).astype(np.uint8)
    chemin = tmp_path / nom
    cv2.imwrite(str(chemin), img)
    return chemin


def test_capsule_au_repos(tmp_path):
    # Valeurs de TEST (pas les vraies mesures) : capsule de 375 x 111 px à 33 px du haut.
    c = capture(tmp_path, [FormeSynth(402.0, 33.0, 375.0, 111.0, 55.5)])
    r = analyze_screenshot.main([str(c), "--sortie", str(tmp_path)])
    assert r == 0
    import json
    res = json.loads((tmp_path / "c" / "capture.json").read_text())
    assert res["echelle_px_par_pt"] == 3.0  # 1179 x 2556 → @3x reconnu
    p = res["ile"]["points"]
    assert p["largeur_pt"] == pytest.approx(125.0, abs=0.04)
    assert p["hauteur_pt"] == pytest.approx(37.0, abs=0.04)
    assert p["y_pt"] == pytest.approx(11.0, abs=0.04)
    assert res["ile"]["coin"]["capsule_parfaite"]
    assert (tmp_path / "c" / "coin_ile.png").exists()


def test_coin_continu_superellipse(tmp_path):
    c = capture(tmp_path, [FormeSynth(100.0, 40.0, 900.0, 480.0, 150.0, n=4.0)], taille=(800, 1100))
    res = analyze_screenshot.analyser(c, 3.0, 40.0, 0.35, tmp_path)
    coin = res["ile"]["coin"]
    assert coin["superellipse"]["exposant_n"] == pytest.approx(4.0, rel=0.05)
    assert coin["superellipse"]["etendue_px"] == pytest.approx(150.0, rel=0.03)
    assert coin["superellipse"]["rmse_px"] < coin["cercle"]["rmse_px"]
    assert not coin["capsule_parfaite"]


def test_coin_cercle(tmp_path):
    c = capture(tmp_path, [FormeSynth(100.0, 40.0, 900.0, 480.0, 120.0)], taille=(800, 1100))
    coin = analyze_screenshot.analyser(c, 3.0, 40.0, 0.35, tmp_path)["ile"]["coin"]
    assert coin["cercle"]["rayon_px"] == pytest.approx(120.0, rel=0.01)
    assert coin["superellipse"]["exposant_n"] == pytest.approx(2.0, abs=0.1)
    assert coin["lissage_estime"] < 0.05
