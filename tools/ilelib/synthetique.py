"""
Génération d'images et de vidéos SYNTHÉTIQUES : une fausse île animée par un
ressort CONNU. Sert à vérifier que les outils d'analyse retrouvent les bons
paramètres (tests automatiques). Les valeurs utilisées ici sont des valeurs de
TEST, sans rapport avec les vraies mesures de l'iPhone.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .ressort import omega_depuis_apple, reponse_ressort



@dataclass
class FormeSynth:
    """Rectangle arrondi : coins en arc de cercle (n=None) ou superellipse d'exposant n (coin « continu »)."""

    x: float
    y: float
    largeur: float
    hauteur: float
    rayon: float
    n: float | None = None


def distance_signee(forme: FormeSynth, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Distance (px) du point au bord : négative dedans, positive dehors."""
    r = min(forme.rayon, forme.largeur / 2, forme.hauteur / 2)
    cx, cy = forme.x + forme.largeur / 2, forme.y + forme.hauteur / 2
    qx = np.abs(px - cx) - (forme.largeur / 2 - r)
    qy = np.abs(py - cy) - (forme.hauteur / 2 - r)
    # Partie « bords droits » (identique pour les deux types de coins).
    dedans = np.minimum(np.maximum(qx, qy), 0.0)
    if forme.n is None:
        coin = np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0))
        return coin + dedans - r
    # Superellipse : F = (u/r)^n + (v/r)^n - 1, distance ≈ F / |∇F| dans le quadrant du coin.
    n = forme.n
    u = np.maximum(qx, 0.0) / r
    v = np.maximum(qy, 0.0) / r
    F = u**n + v**n - 1.0
    gu = n * u ** (n - 1) / r
    gv = n * v ** (n - 1) / r
    norme = np.maximum(np.hypot(gu, gv), 1e-9)
    dans_coin = (qx > 0) & (qy > 0)
    droit = np.maximum(qx, qy) - r
    return np.where(dans_coin, F / norme, droit)


def couverture_forme(taille: tuple[int, int], formes: list[FormeSynth]) -> np.ndarray:
    """
    Couverture (0–1) de chaque pixel par l'union des formes. Le pixel (i, j) couvre
    [j, j+1) × [i, i+1) ; son centre est (j + 0.5, i + 0.5). Anticrénelage linéaire exact
    pour les bords droits.
    """
    h, w = taille
    py, px = np.mgrid[0:h, 0:w].astype(np.float64)
    px += 0.5
    py += 0.5
    couv = np.zeros((h, w))
    for f in formes:
        couv = np.maximum(couv, np.clip(0.5 - distance_signee(f, px, py), 0.0, 1.0))
    return couv.astype(np.float32)


def fond_clair(h: int, w: int) -> np.ndarray:
    """Fond de type « fond d'écran » clair et légèrement dégradé (BGR float)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    b = 215 + 20 * xx / w
    g = 200 + 25 * yy / h
    r = 225 - 15 * xx / w
    return np.dstack([b, g, r])


@dataclass
class ScenarioSynthetique:
    largeur_image: int = 1180  # pair : exigé par H.264 (yuv420p)
    hauteur_image: int = 620
    echelle: float = 3.0
    # Forme de départ et d'arrivée (pixels).
    haut: float = 33.0
    l0: float = 375.0
    h0: float = 111.0
    r0: float | None = None  # None = capsule (h/2)
    l1: float = 1083.0
    h1: float = 480.0
    r1: float = 132.0
    # Ressort (format Apple).
    response: float = 0.42
    damping_fraction: float = 0.78
    t0: float = 0.2137
    # Contenu : apparition après un délai, fondu + flou + échelle.
    delai_contenu: float = 0.10
    duree_fondu: float = 0.15
    flou_depart_px: float = 9.0
    echelle_depart: float = 0.8
    # Bulle (mode split) : diamètre (px) et écart ; None = pas de bulle.
    bulle_diametre: float | None = None
    bulle_ecart: float = 24.0
    duree: float = 1.6
    horodatages: list[float] | None = field(default=None)
    """Instants des images (s). None = cadence fixe de 60 i/s."""

    def temps(self) -> np.ndarray:
        if self.horodatages is not None:
            return np.asarray(self.horodatages, dtype=float)
        return np.arange(0, self.duree, 1 / 60)

    def progression(self, t: float) -> float:
        """0 avant t0, puis réponse du ressort de 0 vers 1."""
        if t < self.t0:
            return 0.0
        w0, z = omega_depuis_apple(self.response, self.damping_fraction)
        return float(reponse_ressort(np.array([t - self.t0]), w0, z, 0.0, 1.0)[0])

    def forme(self, t: float) -> tuple[float, float, float, float, float]:
        """(x, y, largeur, hauteur, rayon) au temps t."""
        p = self.progression(t)
        w = self.l0 + (self.l1 - self.l0) * p
        h = self.h0 + (self.h1 - self.h0) * p
        r0 = self.h0 / 2 if self.r0 is None else self.r0
        r = r0 + (self.r1 - r0) * p
        x = (self.largeur_image - w) / 2
        return x, self.haut, w, h, max(r, 0.5)

    def opacite_contenu(self, t: float) -> float:
        debut = self.t0 + self.delai_contenu
        return float(np.clip((t - debut) / self.duree_fondu, 0.0, 1.0))

    def image(self, t: float) -> np.ndarray:
        H, W = self.hauteur_image, self.largeur_image
        x, y, w, h, r = self.forme(t)
        formes = [FormeSynth(x, y, w, h, r)]
        if self.bulle_diametre:
            d = self.bulle_diametre
            formes.append(FormeSynth(x + w + self.bulle_ecart, y, d, d, d / 2))
        couv = couverture_forme((H, W), formes)[:, :, None]
        img = fond_clair(H, W) * (1 - couv)  # pilule noire

        alpha = self.opacite_contenu(t)
        if alpha > 0:
            contenu = np.zeros((H, W), np.float32)
            ech = self.echelle_depart + (1 - self.echelle_depart) * alpha
            cx, cy = x + w / 2, y + h / 2
            # Une « pochette » et deux « lignes de texte », réduites selon l'échelle.
            for (rx, ry, rw, rh, v) in ((-0.38, -0.1, 0.18, 0.5, 230), (-0.12, -0.15, 0.45, 0.12, 255), (-0.12, 0.08, 0.3, 0.08, 160)):
                px0 = cx + rx * w * ech
                py0 = cy + ry * h * ech
                cv2.rectangle(
                    contenu,
                    (int(px0), int(py0)),
                    (int(px0 + rw * w * ech), int(py0 + rh * h * ech)),
                    float(v),
                    thickness=-1,
                )
            sigma = self.flou_depart_px * (1 - alpha)
            if sigma > 0.3:
                contenu = cv2.GaussianBlur(contenu, (0, 0), sigma)
            masque_ile = couverture_forme((H, W), formes[:1])
            img = img + (contenu * alpha * masque_ile)[:, :, None]
        return np.clip(img, 0, 255).astype(np.uint8)


def ecrire_video_cfr(scenario: ScenarioSynthetique, chemin: Path, fps: float = 60.0) -> np.ndarray:
    """Vidéo à cadence fixe (Motion-JPEG, qualité max) avec OpenCV. Renvoie les instants (s)."""
    temps = np.arange(0, scenario.duree, 1 / fps)
    ecrivain = cv2.VideoWriter(
        str(chemin), cv2.VideoWriter_fourcc(*"MJPG"), fps, (scenario.largeur_image, scenario.hauteur_image)
    )
    ecrivain.set(cv2.VIDEOWRITER_PROP_QUALITY, 100)
    for t in temps:
        ecrivain.write(scenario.image(float(t)))
    ecrivain.release()
    return temps


def ffmpeg_disponible() -> bool:
    return shutil.which("ffmpeg") is not None


def ecrire_video_vfr(scenario: ScenarioSynthetique, chemin: Path, horodatages: np.ndarray) -> None:
    """
    Vidéo à CADENCE VARIABLE (.mov H.264), comme le Simulateur Xcode. Nécessite ffmpeg.
    Les horodatages doivent être des multiples de 1/600 s (échelle de temps QuickTime).
    Les images brutes sont envoyées à ffmpeg ; l'instant de l'image N est imposé par `setpts`.
    """
    tics = np.round(np.asarray(horodatages) * 600).astype(int)
    if np.any(np.diff(tics) <= 0):
        raise ValueError("horodatages non croissants ou non multiples de 1/600 s")
    pas = np.diff(tics)
    # PTS(N) = tics[0] + somme des pas jusqu'à N (en unités de 1/600 s).
    expression = "+".join([str(int(tics[0]))] + [f"{int(p)}*gte(N\\,{k + 1})" for k, p in enumerate(pas)])
    W, H = scenario.largeur_image, scenario.hauteur_image
    proc = subprocess.Popen(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-framerate", "600", "-i", "-",
            "-vf", f"setpts={expression}",
            "-fps_mode", "passthrough",
            "-c:v", "libx264", "-crf", "6", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-video_track_timescale", "600",
            str(chemin),
        ],
        stdin=subprocess.PIPE,
    )
    assert proc.stdin is not None
    for t in horodatages:
        proc.stdin.write(scenario.image(float(t)).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg a échoué")


def horodatages_vfr(duree: float, graine: int = 3) -> np.ndarray:
    """Instants irréguliers (multiples de 1/600 s) avec des pauses, comme un enregistrement du Simulateur."""
    rng = np.random.default_rng(graine)
    t, liste = 0.0, []
    while t < duree:
        liste.append(round(t * 600) / 600)
        pas = rng.choice([10, 10, 10, 20, 5, 30], p=[0.4, 0.2, 0.1, 0.1, 0.1, 0.1]) / 600
        t += pas
    return np.array(liste)
