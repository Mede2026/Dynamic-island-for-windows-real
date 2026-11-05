#!/usr/bin/env python3
"""
Génère une vidéo SYNTHÉTIQUE (fausse île animée par un ressort connu) pour essayer
analyze_video.py sans vidéo réelle.

  python tools/generer_video_test.py                       # tools/output/synthetique.avi (60 i/s)
  python tools/generer_video_test.py --vfr                 # cadence variable (.mov, nécessite ffmpeg)
  python tools/generer_video_test.py --response 0.5 --amortissement 0.7
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ilelib.synthetique import (  # noqa: E402
    ScenarioSynthetique,
    ecrire_video_cfr,
    ecrire_video_vfr,
    ffmpeg_disponible,
    horodatages_vfr,
)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--response", type=float, default=0.42)
    p.add_argument("--amortissement", type=float, default=0.78, help="dampingFraction")
    p.add_argument("--vfr", action="store_true", help="cadence variable (ffmpeg)")
    p.add_argument("--sortie", type=Path, default=Path(__file__).resolve().parent / "output")
    a = p.parse_args()
    a.sortie.mkdir(parents=True, exist_ok=True)
    s = ScenarioSynthetique(response=a.response, damping_fraction=a.amortissement)
    if a.vfr:
        if not ffmpeg_disponible():
            raise SystemExit("ffmpeg introuvable")
        chemin = a.sortie / "synthetique_vfr.mov"
        ecrire_video_vfr(s, chemin, horodatages_vfr(s.duree))
    else:
        chemin = a.sortie / "synthetique.avi"
        ecrire_video_cfr(s, chemin)
    print(f"{chemin}  (ressort réel : response {s.response}, dampingFraction {s.damping_fraction}, échelle {s.echelle})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
