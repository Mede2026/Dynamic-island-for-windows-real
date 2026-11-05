"""
Modèle de ressort (oscillateur harmonique amorti) et ajustement sur des mesures.

Équation (identique à Framer Motion) :   m·x'' = -k·(x - cible) - c·x'
  ω₀ = √(k/m)            pulsation propre (rad/s)
  ζ  = c / (2·√(k·m))     fraction d'amortissement (1 = critique, < 1 = rebond)

Seuls ω₀ et ζ peuvent être retrouvés à partir d'une courbe (la masse ne change
que l'échelle de k et c). On donne donc le résultat avec mass = 1 (valeur par
défaut de Framer Motion) :
  stiffness = ω₀²,  damping = 2·ζ·ω₀,  mass = 1
Équivalent Apple (SwiftUI .spring(response:dampingFraction:)) :
  response = 2π/ω₀,  dampingFraction = ζ
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from scipy.optimize import curve_fit


# ---------------------------------------------------------------------------
# Conversions
# ---------------------------------------------------------------------------

def framer_depuis_omega(omega0: float, zeta: float, masse: float = 1.0) -> dict:
    return {"stiffness": masse * omega0**2, "damping": 2 * zeta * masse * omega0, "mass": masse}


def apple_depuis_omega(omega0: float, zeta: float) -> dict:
    return {"response": 2 * math.pi / omega0, "dampingFraction": zeta}


def omega_depuis_framer(stiffness: float, damping: float, mass: float = 1.0) -> tuple[float, float]:
    omega0 = math.sqrt(stiffness / mass)
    return omega0, damping / (2 * math.sqrt(stiffness * mass))


def omega_depuis_apple(response: float, damping_fraction: float) -> tuple[float, float]:
    return 2 * math.pi / response, damping_fraction


# ---------------------------------------------------------------------------
# Modèle
# ---------------------------------------------------------------------------

def reponse_ressort(t: np.ndarray, omega0: float, zeta: float, x0: float, x1: float, v0: float = 0.0) -> np.ndarray:
    """Position au temps t (s, t ≥ 0) d'un ressort qui part de x0 (vitesse v0) vers x1."""
    t = np.asarray(t, dtype=float)
    a = x0 - x1
    if abs(zeta - 1.0) < 1e-6:  # critique
        e = (a + (v0 + omega0 * a) * t) * np.exp(-omega0 * t)
    elif zeta < 1.0:  # sous-amorti (rebond)
        wd = omega0 * math.sqrt(1 - zeta**2)
        b = (v0 + zeta * omega0 * a) / wd
        e = np.exp(-zeta * omega0 * t) * (a * np.cos(wd * t) + b * np.sin(wd * t))
    else:  # sur-amorti
        r = omega0 * math.sqrt(zeta**2 - 1)
        s1, s2 = -zeta * omega0 + r, -zeta * omega0 - r
        c2 = (v0 - s1 * a) / (s2 - s1)
        c1 = a - c2
        e = c1 * np.exp(s1 * t) + c2 * np.exp(s2 * t)
    return x1 + e


def modele_avec_depart(t: np.ndarray, t0: float, omega0: float, zeta: float, x0: float, x1: float) -> np.ndarray:
    """Valeur constante x0 avant t0, puis ressort (vitesse initiale nulle)."""
    t = np.asarray(t, dtype=float)
    dt = np.clip(t - t0, 0.0, None)
    return np.where(t < t0, x0, reponse_ressort(dt, omega0, zeta, x0, x1))


# ---------------------------------------------------------------------------
# Ajustement
# ---------------------------------------------------------------------------

@dataclass
class ResultatRessort:
    t0_s: float
    omega0: float
    zeta: float
    x0: float
    x1: float
    stiffness: float
    damping: float
    mass: float
    response: float
    dampingFraction: float
    rmse: float
    """Erreur quadratique moyenne de l'ajustement (même unité que les mesures)."""
    erreur_relative: float
    """rmse / |x1 - x0| (0.01 = 1 %)."""
    incertitude_omega0: float
    incertitude_zeta: float
    n_points: int

    def en_dict(self) -> dict:
        return asdict(self)


def ajuster_ressort(t: np.ndarray, x: np.ndarray, t0_estime: float | None = None) -> ResultatRessort:
    """
    Ajuste (t0, ω₀, ζ, x0, x1) sur les mesures x(t) (t en secondes).
    Essaie plusieurs points de départ et garde le meilleur (le problème a des minima locaux).
    """
    t = np.asarray(t, dtype=float)
    x = np.asarray(x, dtype=float)
    ordre = np.argsort(t)
    t, x = t[ordre], x[ordre]
    if len(t) < 6:
        raise ValueError("pas assez de points pour ajuster un ressort")

    x0g, x1g = float(np.median(x[:2])), float(np.median(x[-3:]))
    amplitude = abs(x1g - x0g)
    if amplitude < 1e-9:
        raise ValueError("aucun mouvement dans les mesures")

    if t0_estime is None:
        bouge = np.nonzero(np.abs(x - x0g) > 0.02 * amplitude)[0]
        t0_estime = float(t[max(bouge[0] - 1, 0)]) if len(bouge) else float(t[0])

    # Temps pour atteindre ~98 % : donne une idée de ω₀.
    proche = np.nonzero(np.abs(x - x1g) > 0.05 * amplitude)[0]
    t_fin = float(t[proche[-1]]) if len(proche) else float(t[-1])
    duree = max(t_fin - t0_estime, 1e-3)

    meilleur = None
    for zeta_g in (0.3, 0.6, 0.85, 1.0, 1.4):
        omega_g = 4.0 / (max(zeta_g, 0.5) * duree)
        for dt0 in (0.0, -0.008, 0.008):
            p0 = [t0_estime + dt0, omega_g, zeta_g, x0g, x1g]
            bornes = (
                [t[0] - 0.1, 0.5, 0.02, x0g - amplitude, x1g - amplitude],
                [t[-1], 400.0, 4.0, x0g + amplitude, x1g + amplitude],
            )
            try:
                p, cov = curve_fit(modele_avec_depart, t, x, p0=p0, bounds=bornes, maxfev=20000)
            except (RuntimeError, ValueError):
                continue
            residus = x - modele_avec_depart(t, *p)
            sse = float(np.sum(residus**2))
            if meilleur is None or sse < meilleur[0]:
                meilleur = (sse, p, cov)

    if meilleur is None:
        raise RuntimeError("l'ajustement du ressort n'a pas convergé")

    sse, p, cov = meilleur
    t0, omega0, zeta, x0, x1 = (float(v) for v in p)
    incert = np.sqrt(np.clip(np.diag(cov), 0, None)) if np.all(np.isfinite(cov)) else np.full(5, np.nan)
    rmse = math.sqrt(sse / len(t))
    framer = framer_depuis_omega(omega0, zeta)
    apple = apple_depuis_omega(omega0, zeta)
    return ResultatRessort(
        t0_s=t0,
        omega0=omega0,
        zeta=zeta,
        x0=x0,
        x1=x1,
        **framer,
        **apple,
        rmse=rmse,
        erreur_relative=rmse / max(abs(x1 - x0), 1e-9),
        incertitude_omega0=float(incert[1]),
        incertitude_zeta=float(incert[2]),
        n_points=len(t),
    )
