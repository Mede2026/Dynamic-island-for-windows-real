"""
Analyse d'une vidéo : mesures image par image, découpage en transitions,
ajustement d'un ressort sur chaque transition, délais du contenu.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .detection import detecter
from .ressort import ajuster_ressort
from .video import lire_images

COLONNES = [
    "temps_ms", "x", "y", "largeur", "hauteur", "rayon_estime",
    "bulle_x", "bulle_y", "bulle_largeur", "bulle_hauteur",
    "contenu_luminance", "contenu_nettete", "contenu_fraction",
]


@dataclass
class Table:
    """Une colonne numpy par mesure (pixels, temps en ms). NaN = forme non détectée."""

    colonnes: dict[str, np.ndarray]

    def __getitem__(self, cle: str) -> np.ndarray:
        return self.colonnes[cle]

    def __len__(self) -> int:
        return len(self.colonnes["temps_ms"])

    def ecrire_csv(self, chemin: Path) -> None:
        with open(chemin, "w", newline="", encoding="utf-8") as f:
            ecr = csv.writer(f)
            ecr.writerow(COLONNES)
            for i in range(len(self)):
                ecr.writerow(["" if math.isnan(v) else f"{v:.4f}" for v in (self.colonnes[c][i] for c in COLONNES)])

    @staticmethod
    def lire_csv(chemin: Path) -> "Table":
        with open(chemin, encoding="utf-8") as f:
            lignes = list(csv.DictReader(f))
        return Table({c: np.array([float(l[c]) if l[c] else np.nan for l in lignes]) for c in COLONNES})


def mesurer_video(
    chemin: Path,
    seuil: float = 40.0,
    zone_haut: float = 0.35,
    debut_ms: float | None = None,
    fin_ms: float | None = None,
    progression=None,
) -> Table:
    lignes: list[list[float]] = []
    for t, image in lire_images(chemin, debut_ms, fin_ms):
        m = detecter(image, seuil=seuil, zone_haut=zone_haut)
        nan = float("nan")
        ile, b = m.ile, m.bulle
        lignes.append([
            t,
            ile.x if ile else nan, ile.y if ile else nan,
            ile.largeur if ile else nan, ile.hauteur if ile else nan,
            (ile.rayon if ile and ile.rayon is not None else nan),
            b.x if b else nan, b.y if b else nan, b.largeur if b else nan, b.hauteur if b else nan,
            m.contenu_luminance, m.contenu_nettete, m.contenu_fraction,
        ])
        if progression:
            progression(len(lignes))
    tableau = np.array(lignes, dtype=float).reshape(-1, len(COLONNES))
    return Table({c: tableau[:, i] for i, c in enumerate(COLONNES)})


# ---------------------------------------------------------------------------
# Découpage en transitions
# ---------------------------------------------------------------------------

def segments_mouvement(t_ms: np.ndarray, valeurs: list[np.ndarray], seuil_px: float = 0.6, calme_ms: float = 150.0):
    """
    Repère les transitions : périodes où une des séries bouge de plus de `seuil_px`
    entre deux images. Deux mouvements séparés par moins de `calme_ms` de calme
    font partie de la même transition (ex. : rebonds du ressort).
    Renvoie une liste (indice_debut, indice_fin) ; debut = dernière image immobile.
    """
    n = len(t_ms)
    if n < 2:
        return []
    bouge = np.zeros(n, dtype=bool)
    for v in valeurs:
        v = np.asarray(v, dtype=float)
        d = np.abs(np.diff(v))
        d = np.where(np.isnan(d), np.inf, d)  # apparition/disparition = mouvement
        both_nan = np.isnan(v[1:]) & np.isnan(v[:-1])
        d[both_nan] = 0.0
        bouge[1:] |= d > seuil_px
    indices = np.nonzero(bouge)[0]
    if indices.size == 0:
        return []
    segments = []
    debut = fin = int(indices[0])
    for i in indices[1:]:
        i = int(i)
        if t_ms[i - 1] - t_ms[fin] <= calme_ms:
            fin = i
        else:
            segments.append((debut - 1, min(fin + 1, n - 1)))
            debut = fin = i
    segments.append((debut - 1, min(fin + 1, n - 1)))
    return [(max(a, 0), b) for a, b in segments]


@dataclass
class ResultatSegment:
    indice: int
    debut_ms: float
    fin_ms: float
    ressorts: dict = field(default_factory=dict)
    """« largeur » / « hauteur » / « rayon » → ResultatRessort.en_dict() (unités : points)."""
    contenu: dict = field(default_factory=dict)
    erreurs: list[str] = field(default_factory=list)


def _croisement(t: np.ndarray, v: np.ndarray, niveau: float, montant: bool) -> float | None:
    """Premier instant (interpolé) où v franchit `niveau`."""
    for i in range(1, len(v)):
        a, b = v[i - 1], v[i]
        if np.isnan(a) or np.isnan(b):
            continue
        if (montant and a < niveau <= b) or (not montant and a > niveau >= b):
            return float(t[i - 1] + (niveau - a) / (b - a) * (t[i] - t[i - 1]))
    return None


def delais_contenu(t_ms: np.ndarray, lum: np.ndarray, t0_ms: float, i0: int, i1: int) -> dict:
    """
    Instants où la luminance du contenu franchit 10 %, 50 % et 90 % de son changement,
    mesurés depuis le début du mouvement de la forme (t0). Négatif = avant la forme.
    """
    avant = lum[max(i0 - 3, 0): i0 + 1]
    apres = lum[i1: min(i1 + 4, len(lum))]
    base, final = float(np.nanmedian(avant)), float(np.nanmedian(apres))
    ecart = final - base
    if not np.isfinite(ecart) or abs(ecart) < 3.0:
        return {"changement": False}
    montant = ecart > 0
    fenetre = slice(max(i0 - 3, 0), min(i1 + 4, len(lum)))
    res = {"changement": True, "sens": "apparition" if montant else "disparition", "luminance_depart": base, "luminance_finale": final}
    # 3 % ≈ tout début de l'apparition (au-dessus du bruit) ; 10/50/90 % = progression du fondu.
    for p in (3, 10, 50, 90):
        tc = _croisement(t_ms[fenetre], lum[fenetre], base + ecart * p / 100, montant)
        res[f"t{p}_depuis_debut_forme_ms"] = None if tc is None else tc - t0_ms
    if res["t10_depuis_debut_forme_ms"] is not None and res["t90_depuis_debut_forme_ms"] is not None:
        res["duree_10_90_ms"] = res["t90_depuis_debut_forme_ms"] - res["t10_depuis_debut_forme_ms"]
    return res


def analyser_segments(table: Table, echelle: float, marge_avant_ms: float = 120.0, marge_apres_ms: float = 400.0):
    """Ajuste un ressort (largeur, hauteur, rayon) sur chaque transition. Unités : points."""
    t = table["temps_ms"]
    segments = segments_mouvement(t, [table["largeur"], table["hauteur"]])
    resultats = []
    for k, (i0, i1) in enumerate(segments):
        seg = ResultatSegment(indice=k, debut_ms=float(t[i0]), fin_ms=float(t[i1]))
        fen = (t >= t[i0] - marge_avant_ms) & (t <= t[i1] + marge_apres_ms)
        # Ne pas déborder sur la transition voisine.
        if k > 0:
            fen &= t > t[segments[k - 1][1]]
        if k + 1 < len(segments):
            fen &= t < t[segments[k + 1][0]]
        for nom in ("largeur", "hauteur", "rayon_estime"):
            v = table[nom][fen] / echelle
            tt = t[fen] / 1000.0
            ok = ~np.isnan(v)
            try:
                r = ajuster_ressort(tt[ok], v[ok])
                seg.ressorts[nom.replace("_estime", "")] = r.en_dict()
            except (ValueError, RuntimeError) as e:
                seg.erreurs.append(f"{nom} : {e}")
        if "largeur" in seg.ressorts or "hauteur" in seg.ressorts:
            # Début du mouvement = le plus tôt des deux ajustements.
            t0 = min(r["t0_s"] for n, r in seg.ressorts.items() if n in ("largeur", "hauteur")) * 1000.0
            seg.contenu = delais_contenu(t, table["contenu_luminance"], t0, i0, i1)
            seg.contenu["t0_forme_ms"] = t0
        resultats.append(seg)
    return resultats


def periode_image_ms(t_ms: np.ndarray) -> float:
    """Durée typique d'une image (médiane des écarts) — pour exprimer un délai « en images »."""
    d = np.diff(t_ms)
    d = d[d > 0]
    return float(np.median(d)) if d.size else float("nan")
