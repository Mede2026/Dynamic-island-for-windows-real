"""
Graphiques PNG (mesures + courbes ajustées). Deux panneaux séparés plutôt
qu'un double axe Y. Couleurs validées (daltonisme, contraste) avec le
validateur de palette : bleu #2a78d6, orange #eb6834.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .ressort import modele_avec_depart  # noqa: E402

SERIE_1 = "#2a78d6"  # bleu
SERIE_2 = "#eb6834"  # orange
SURFACE = "#fcfcfb"
ENCRE = "#0b0b0b"
ENCRE_2 = "#52514e"
MUET = "#898781"
GRILLE = "#e1e0d9"
AXE = "#c3c2b7"


def _style(ax):
    ax.set_facecolor(SURFACE)
    ax.grid(True, color=GRILLE, linewidth=0.6)
    for cote in ("top", "right"):
        ax.spines[cote].set_visible(False)
    for cote in ("left", "bottom"):
        ax.spines[cote].set_color(AXE)
    ax.tick_params(colors=MUET, labelsize=8)
    ax.xaxis.label.set_color(ENCRE_2)
    ax.yaxis.label.set_color(ENCRE_2)


def _courbe(ax, t_ms, v, fit, couleur, nom):
    ax.plot(t_ms, v, "o", ms=4, color=couleur, alpha=0.75, label=f"{nom} mesurée", markeredgewidth=0)
    if fit:
        tt = np.linspace(t_ms.min(), t_ms.max(), 600)
        y = modele_avec_depart(tt / 1000, fit["t0_s"], fit["omega0"], fit["zeta"], fit["x0"], fit["x1"])
        ax.plot(tt, y, "-", lw=2, color=couleur, label=f"{nom} ressort ajusté")


def graphique_segment(t_ms, largeur_pt, hauteur_pt, luminance, ressorts: dict, titre: str, chemin: Path) -> None:
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(9, 6.5), sharex=True, gridspec_kw={"height_ratios": [3, 1.3]})
    fig.patch.set_facecolor(SURFACE)
    for ax in (a1, a2):
        _style(ax)
    _courbe(a1, t_ms, largeur_pt, ressorts.get("largeur"), SERIE_1, "largeur")
    _courbe(a1, t_ms, hauteur_pt, ressorts.get("hauteur"), SERIE_2, "hauteur")
    a1.set_ylabel("taille (pt)")
    a1.legend(frameon=False, fontsize=8, labelcolor=ENCRE_2, loc="best")
    for nom, couleur, y in (("largeur", SERIE_1, 0.04), ("hauteur", SERIE_2, 0.13)):
        r = ressorts.get(nom)
        if r:
            a1.text(
                0.99, y,
                f"{nom} : response {r['response']:.3f} s · dampingFraction {r['dampingFraction']:.3f} · "
                f"stiffness {r['stiffness']:.1f} · damping {r['damping']:.2f} · erreur {100 * r['erreur_relative']:.2f} %",
                transform=a1.transAxes, ha="right", fontsize=7.5, color=ENCRE_2,
            )
    a2.plot(t_ms, luminance, "-", lw=2, color=MUET)
    a2.set_ylabel("contenu\n(luminance)")
    a2.set_xlabel("temps (ms)")
    fig.suptitle(titre, color=ENCRE, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(chemin, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def graphique_comparaison(tA, a, tB, b, nom_a: str, nom_b: str, titre: str, chemin: Path, unite: str) -> None:
    """Superpose deux séries (déjà alignées sur le début du mouvement)."""
    fig, ax = plt.subplots(figsize=(9, 4.5))
    fig.patch.set_facecolor(SURFACE)
    _style(ax)
    ax.plot(tA, a, "-", lw=2, color=SERIE_1, label=nom_a)
    ax.plot(tB, b, "-", lw=2, color=SERIE_2, label=nom_b)
    ax.set_xlabel("temps depuis le début du mouvement (ms)")
    ax.set_ylabel(unite)
    ax.legend(frameon=False, fontsize=8, labelcolor=ENCRE_2)
    fig.suptitle(titre, color=ENCRE, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(chemin, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def graphique_coin(d, retrait, cercle_r, se_a, se_n, titre: str, chemin: Path) -> None:
    """Profil du coin haut-gauche : mesures, arc de cercle ajusté, superellipse ajustée."""
    from .detection import retrait_cercle, retrait_superellipse

    fig, ax = plt.subplots(figsize=(7, 4.5))
    fig.patch.set_facecolor(SURFACE)
    _style(ax)
    ax.plot(d, retrait, "o", ms=4, color=MUET, markeredgewidth=0, label="bord mesuré")
    dd = np.linspace(0, max(float(np.max(d)), 1.0), 400)
    if np.isfinite(cercle_r):
        ax.plot(dd, retrait_cercle(dd, cercle_r), "-", lw=2, color=SERIE_1, label=f"arc de cercle r = {cercle_r:.2f} px")
    if np.isfinite(se_a):
        ax.plot(dd, retrait_superellipse(dd, se_a, se_n), "-", lw=2, color=SERIE_2,
                label=f"superellipse a = {se_a:.2f} px, n = {se_n:.2f}")
    ax.set_xlabel("distance depuis le haut de la forme (px)")
    ax.set_ylabel("retrait du bord gauche (px)")
    ax.legend(frameon=False, fontsize=8, labelcolor=ENCRE_2)
    fig.suptitle(titre, color=ENCRE, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(chemin, dpi=130, facecolor=SURFACE)
    plt.close(fig)
