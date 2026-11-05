"""
Test de bout en bout de l'outil d'analyse vidéo sur des vidéos SYNTHÉTIQUES :
une fausse île animée par un ressort CONNU. L'outil doit retrouver les
paramètres à moins de 2 % près, et les délais du contenu à ±1 image.
"""

from pathlib import Path

import numpy as np
import pytest

import analyze_video
from ilelib.analyse import Table, analyser_segments, mesurer_video, segments_mouvement
from ilelib.comparaison import comparer
from ilelib.synthetique import (
    ScenarioSynthetique,
    ecrire_video_cfr,
    ecrire_video_vfr,
    ffmpeg_disponible,
    horodatages_vfr,
)
from ilelib.video import lire_images

TOLERANCE = 0.02  # 2 %


def verifier_ressort(r: dict, scenario: ScenarioSynthetique):
    assert r["response"] == pytest.approx(scenario.response, rel=TOLERANCE)
    assert r["dampingFraction"] == pytest.approx(scenario.damping_fraction, rel=TOLERANCE)
    assert r["t0_s"] == pytest.approx(scenario.t0, abs=0.004)


@pytest.mark.parametrize("response,zeta", [(0.42, 0.78), (0.5, 0.62), (0.35, 1.0)])
def test_video_cadence_fixe(tmp_path: Path, response, zeta):
    s = ScenarioSynthetique(response=response, damping_fraction=zeta)
    chemin = tmp_path / "v.avi"
    ecrire_video_cfr(s, chemin)
    table = mesurer_video(chemin)
    segs = analyser_segments(table, s.echelle)
    assert len(segs) == 1
    seg = segs[0]
    for nom in ("largeur", "hauteur"):
        verifier_ressort(seg.ressorts[nom], s)
    # Taille finale en points.
    assert seg.ressorts["largeur"]["x1"] == pytest.approx(s.l1 / s.echelle, rel=0.005)
    assert seg.ressorts["hauteur"]["x1"] == pytest.approx(s.h1 / s.echelle, rel=0.005)
    # Délai du contenu : à ±1 image (16,7 ms) du vrai délai.
    assert seg.contenu["sens"] == "apparition"
    assert seg.contenu["t3_depuis_debut_forme_ms"] == pytest.approx(s.delai_contenu * 1000, abs=1000 / 60)


@pytest.mark.skipif(not ffmpeg_disponible(), reason="ffmpeg absent")
def test_video_cadence_variable_h264(tmp_path: Path):
    """Comme le Simulateur : .mov H.264, images à intervalles irréguliers."""
    s = ScenarioSynthetique()
    horo = horodatages_vfr(s.duree)
    chemin = tmp_path / "v.mov"
    ecrire_video_vfr(s, chemin, horo)

    temps = np.array([t for t, _ in lire_images(chemin)])
    assert len(temps) == len(horo)
    assert np.max(np.abs(temps - horo * 1000)) < 0.5  # horodatages réels, pas « 60 i/s »

    segs = analyser_segments(mesurer_video(chemin), s.echelle)
    assert len(segs) == 1
    for nom in ("largeur", "hauteur"):
        verifier_ressort(segs[0].ressorts[nom], s)


def test_bulle_detectee_en_mode_split(tmp_path: Path):
    s = ScenarioSynthetique(l1=500.0, h1=111.0, r1=55.5, bulle_diametre=111.0, duree=0.9)
    chemin = tmp_path / "split.avi"
    ecrire_video_cfr(s, chemin)
    table = mesurer_video(chemin)
    assert np.nanmedian(table["bulle_largeur"]) == pytest.approx(111.0, abs=0.5)


def test_comparaison_et_csv(tmp_path: Path):
    a = ScenarioSynthetique()
    b = ScenarioSynthetique(response=a.response * 1.15)  # « notre île » un peu trop lente
    va, vb = tmp_path / "a.avi", tmp_path / "b.avi"
    ecrire_video_cfr(a, va)
    ecrire_video_cfr(b, vb)
    ta, tb = mesurer_video(va), mesurer_video(vb)
    sa, sb = analyser_segments(ta, 3.0), analyser_segments(tb, 3.0)

    identique = comparer(ta, sa[0], 3.0, ta, sa[0], 3.0, tmp_path)
    assert identique["score_ecart_pourcent"] < 0.01
    assert identique["objectif_atteint"]

    different = comparer(ta, sa[0], 3.0, tb, sb[0], 3.0, tmp_path)
    assert different["score_ecart_pourcent"] > 3.0
    assert not different["objectif_atteint"]
    assert (tmp_path / "comparaison_largeur.png").exists()

    # Aller-retour CSV.
    ta.ecrire_csv(tmp_path / "m.csv")
    relu = Table.lire_csv(tmp_path / "m.csv")
    assert np.allclose(relu["largeur"], ta["largeur"], atol=1e-3, equal_nan=True)


def test_segments_separes_par_une_pause():
    t = np.arange(0, 2000, 16.0)
    v = np.where(t < 300, 10.0, 50.0)
    v = np.where(t > 1200, 20.0, v)
    segs = segments_mouvement(t, [v])
    assert len(segs) == 2


def test_ligne_de_commande(tmp_path: Path):
    s = ScenarioSynthetique()
    chemin = tmp_path / "cli.avi"
    ecrire_video_cfr(s, chemin)
    assert analyze_video.main([str(chemin), "--echelle", "3", "--sortie", str(tmp_path)]) == 0
    dossier = tmp_path / "cli"
    assert (dossier / "mesures.csv").exists()
    assert (dossier / "resultats.json").exists()
    assert (dossier / "segment_00.png").exists()
    assert analyze_video.main(["--compare", str(chemin), str(chemin), "--echelle-a", "3", "--echelle-b", "3", "--sortie", str(tmp_path)]) == 0
