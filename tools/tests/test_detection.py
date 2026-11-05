import numpy as np
import pytest

from ilelib.detection import (
    ajuster_cercle,
    ajuster_superellipse,
    detecter,
    echelle_depuis_resolution,
    retrait_cercle,
    retrait_superellipse,
)
from ilelib.synthetique import FormeSynth, ScenarioSynthetique, couverture_forme, fond_clair


def image_statique(x, y, w, h, r, n_coin=None, taille=(620, 1179), bulle=None):
    H, W = taille
    formes = [FormeSynth(x, y, w, h, r, n_coin)]
    if bulle:
        bx, bd = bulle
        formes.append(FormeSynth(bx, y, bd, bd, bd / 2))
    couv = couverture_forme((H, W), formes)[:, :, None]
    return np.clip(fond_clair(H, W) * (1 - couv), 0, 255).astype(np.uint8)


@pytest.mark.parametrize("w,h,r", [(375.3, 111.4, 55.7), (1083.6, 480.25, 132.0), (600.0, 200.0, 40.0)])
def test_mesure_sous_pixel(w, h, r):
    x = (1179 - w) / 2
    m = detecter(image_statique(x, 33.3, w, h, r))
    assert m.ile is not None
    assert m.ile.largeur == pytest.approx(w, abs=0.1)
    assert m.ile.hauteur == pytest.approx(h, abs=0.1)
    assert m.ile.x == pytest.approx(x, abs=0.1)
    assert m.ile.y == pytest.approx(33.3, abs=0.1)
    assert m.ile.rayon == pytest.approx(r, rel=0.03)
    assert m.bulle is None


def test_bulle_du_mode_split():
    img = image_statique(400, 33, 300, 111, 55.5, bulle=(724, 111))
    m = detecter(img)
    assert m.ile.largeur == pytest.approx(300, abs=0.1)
    assert m.bulle is not None
    assert m.bulle.largeur == pytest.approx(111, abs=0.15)
    assert m.bulle.x == pytest.approx(724, abs=0.1)


def test_rien_a_detecter():
    img = np.full((300, 600, 3), 220, np.uint8)
    assert detecter(img).ile is None


def test_ignore_les_formes_noires_hors_centre():
    img = image_statique(500, 33, 180, 111, 55.5)
    img[30:70, 20:120] = 0  # « heure » de la barre d'état, à gauche
    m = detecter(img)
    assert m.ile.largeur == pytest.approx(180, abs=0.1)


def test_contenu_visible_augmente_la_luminance():
    s = ScenarioSynthetique()
    avant = detecter(s.image(s.t0 - 0.05))
    apres = detecter(s.image(s.t0 + 1.0))
    assert apres.contenu_luminance > avant.contenu_luminance + 20
    assert apres.contenu_nettete > avant.contenu_nettete


def test_profils_de_coin():
    d = np.linspace(0.5, 60, 80)
    r, err = ajuster_cercle(d, retrait_cercle(d, 42.0), 60)
    assert r == pytest.approx(42.0, rel=1e-3)
    a, n, err = ajuster_superellipse(d, retrait_superellipse(d, 50.0, 4.0), 60)
    assert a == pytest.approx(50.0, rel=1e-2) and n == pytest.approx(4.0, rel=1e-2)


def test_echelle_depuis_resolution():
    assert echelle_depuis_resolution(1179, 2556)[0] == 3.0
    assert echelle_depuis_resolution(2556, 1179)[0] == 3.0
    assert echelle_depuis_resolution(100, 100)[0] is None
