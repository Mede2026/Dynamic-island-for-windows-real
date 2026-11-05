import math

import numpy as np
import pytest

from ilelib.ressort import (
    ajuster_ressort,
    apple_depuis_omega,
    framer_depuis_omega,
    modele_avec_depart,
    omega_depuis_apple,
    omega_depuis_framer,
    reponse_ressort,
)


def test_conversions_aller_retour():
    w, z = omega_depuis_apple(0.5, 0.7)
    f = framer_depuis_omega(w, z)
    w2, z2 = omega_depuis_framer(f["stiffness"], f["damping"], f["mass"])
    assert w2 == pytest.approx(w) and z2 == pytest.approx(z)
    assert apple_depuis_omega(w2, z2)["response"] == pytest.approx(0.5)


@pytest.mark.parametrize("zeta", [0.3, 0.8, 1.0, 1.5])
def test_modele_respecte_l_equation(zeta):
    """Vérifie numériquement m·x'' + c·x' + k·(x - x1) = 0 et les conditions initiales."""
    w = 12.0
    t = np.linspace(0, 3, 60001)
    x = reponse_ressort(t, w, zeta, 10.0, 50.0, v0=3.0)
    dt = t[1] - t[0]
    v = np.gradient(x, dt)
    a = np.gradient(v, dt)
    residu = a + 2 * zeta * w * v + w**2 * (x - 50.0)
    assert np.max(np.abs(residu[5:-5])) < 1e-2 * w**2
    assert x[0] == pytest.approx(10.0)
    # Vitesse initiale : (x(dt) - x(0)) / dt ≈ v0 (+ a·dt/2).
    assert (x[1] - x[0]) / dt == pytest.approx(3.0, abs=0.2)
    assert x[-1] == pytest.approx(50.0, abs=0.05)


@pytest.mark.parametrize("response,zeta", [(0.35, 0.65), (0.5, 0.85), (0.3, 1.0), (0.6, 1.3)])
def test_ajustement_retrouve_les_parametres(response, zeta):
    w, _ = omega_depuis_apple(response, zeta)
    rng = np.random.default_rng(1)
    t = np.sort(rng.uniform(0, 1.2, 70))  # échantillons irréguliers (cadence variable)
    x = modele_avec_depart(t, 0.1234, w, zeta, 120.0, 370.0) + rng.normal(0, 0.1, len(t))
    r = ajuster_ressort(t, x)
    assert r.response == pytest.approx(response, rel=0.01)
    assert r.dampingFraction == pytest.approx(zeta, rel=0.01)
    assert r.t0_s == pytest.approx(0.1234, abs=0.004)
    assert r.erreur_relative < 0.002
    assert r.stiffness == pytest.approx(w**2, rel=0.02)
    assert r.mass == 1.0


def test_ajustement_refuse_sans_mouvement():
    with pytest.raises(ValueError):
        ajuster_ressort(np.linspace(0, 1, 20), np.full(20, 5.0))
