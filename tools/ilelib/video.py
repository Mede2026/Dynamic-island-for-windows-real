"""
Lecture d'une vidéo avec les HORODATAGES RÉELS de chaque image (PTS).

Les enregistrements du Simulateur Xcode ont une cadence VARIABLE : une image
n'est écrite que quand l'écran change. On ne suppose donc jamais 60 i/s :
on lit l'instant de présentation (PTS) de chaque image.
  - OpenCV : CAP_PROP_POS_MSEC après chaque lecture = PTS de l'image lue.
  - ffprobe (s'il est installé) : sert de contre-vérification.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np


@dataclass
class InfosVideo:
    largeur: int
    hauteur: int
    nb_images: int
    cadence_annoncee: float
    """Cadence indiquée par le fichier (souvent fausse pour une cadence variable)."""


def infos(chemin: Path) -> InfosVideo:
    cap = cv2.VideoCapture(str(chemin))
    if not cap.isOpened():
        raise FileNotFoundError(f"vidéo illisible : {chemin}")
    i = InfosVideo(
        largeur=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        hauteur=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        nb_images=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        cadence_annoncee=float(cap.get(cv2.CAP_PROP_FPS)),
    )
    cap.release()
    return i


def horodatages_ffprobe(chemin: Path) -> np.ndarray | None:
    """PTS (ms) de chaque image selon ffprobe, ou None si ffprobe est absent."""
    if shutil.which("ffprobe") is None:
        return None
    r = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "frame=best_effort_timestamp_time",
            "-of", "csv=p=0", str(chemin),
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return None
    valeurs = [float(l.strip().rstrip(",")) for l in r.stdout.splitlines() if l.strip() and l.strip() != "N/A"]
    if not valeurs:
        return None
    t = np.array(valeurs) * 1000.0
    return t - t[0]


def lire_images(chemin: Path, debut_ms: float | None = None, fin_ms: float | None = None) -> Iterator[tuple[float, np.ndarray]]:
    """Donne (temps_ms, image BGR) pour chaque image, avec le temps RÉEL de l'image."""
    cap = cv2.VideoCapture(str(chemin))
    if not cap.isOpened():
        raise FileNotFoundError(f"vidéo illisible : {chemin}")
    origine = None
    precedent = -np.inf
    try:
        while True:
            ok, image = cap.read()
            if not ok:
                break
            t = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            if origine is None:
                origine = t
            t -= origine
            if t <= precedent:
                raise ValueError(
                    f"horodatages non croissants ({precedent:.3f} puis {t:.3f} ms) : "
                    "réencoder la vidéo ou installer ffprobe"
                )
            precedent = t
            if debut_ms is not None and t < debut_ms:
                continue
            if fin_ms is not None and t > fin_ms:
                break
            yield t, image
    finally:
        cap.release()


def verifier_horodatages(temps_opencv_ms: np.ndarray, chemin: Path) -> str:
    """Compare les temps lus par OpenCV à ceux de ffprobe. Renvoie un message lisible."""
    ref = horodatages_ffprobe(chemin)
    if ref is None:
        return "ffprobe absent : horodatages OpenCV non contre-vérifiés"
    if len(ref) != len(temps_opencv_ms):
        return f"ATTENTION : {len(temps_opencv_ms)} images lues par OpenCV, {len(ref)} selon ffprobe"
    ecart = float(np.max(np.abs(ref - temps_opencv_ms))) if len(ref) else 0.0
    etat = "OK" if ecart < 1.0 else "ATTENTION"
    return f"{etat} : écart max OpenCV/ffprobe = {ecart:.3f} ms"
