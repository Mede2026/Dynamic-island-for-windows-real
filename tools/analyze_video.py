#!/usr/bin/env python3
"""
Analyse d'une vidéo du Dynamic Island (enregistrement du Simulateur ou de notre île).

Exemples :
  python tools/analyze_video.py tools/input/V2_lancement_musique.mov
  python tools/analyze_video.py V3_etendre_fermer.mov --echelle 3 --debut-ms 500 --fin-ms 4000
  python tools/analyze_video.py --compare V3_iphone.mov V3_notre_ile.mp4 --echelle-b 1.5

Sorties (dans tools/output/<nom de la vidéo>/) :
  mesures.csv      temps_ms, x, y, largeur, hauteur, rayon_estime (pixels) + bulle + contenu
  resultats.json   ressort ajusté par transition (Framer Motion ET Apple) + délais du contenu
  segment_NN.png   courbes mesurées + courbes ajustées
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ilelib.analyse import analyser_segments, mesurer_video, periode_image_ms  # noqa: E402
from ilelib.comparaison import comparer  # noqa: E402
from ilelib.detection import echelle_depuis_resolution  # noqa: E402
from ilelib.graphiques import graphique_segment  # noqa: E402
from ilelib.video import infos, verifier_horodatages  # noqa: E402

SORTIE_DEFAUT = Path(__file__).resolve().parent / "output"


def _ms(v):
    return "?" if v is None else f"{v:.1f} ms"


def choisir_echelle(chemin: Path, demandee: float | None) -> float:
    i = infos(chemin)
    devinee, description = echelle_depuis_resolution(i.largeur, i.hauteur)
    print(f"  vidéo : {i.largeur}x{i.hauteur} px, {i.nb_images} images, cadence annoncée {i.cadence_annoncee:.2f} i/s")
    if demandee is not None:
        print(f"  échelle imposée : {demandee} px par point")
        return demandee
    if devinee is None:
        print(f"  ATTENTION : {description} → échelle 3 par défaut (utiliser --echelle pour corriger)")
        return 3.0
    print(f"  appareil reconnu : {description} → @{devinee:g}x")
    return devinee


def analyser(chemin: Path, echelle: float | None, args, sortie: Path):
    print(f"\n▶ {chemin.name}")
    ech = choisir_echelle(chemin, echelle)
    dossier = sortie / chemin.stem
    dossier.mkdir(parents=True, exist_ok=True)

    table = mesurer_video(chemin, seuil=args.seuil, zone_haut=args.zone_haut, debut_ms=args.debut_ms, fin_ms=args.fin_ms)
    if len(table) == 0:
        raise SystemExit("aucune image lue")
    print(f"  {len(table)} images mesurées ; période typique {periode_image_ms(table['temps_ms']):.2f} ms")
    print(f"  horodatages : {verifier_horodatages(table['temps_ms'], chemin) if args.debut_ms is None and args.fin_ms is None else 'extrait (non vérifié)'}")
    table.ecrire_csv(dossier / "mesures.csv")

    segments = analyser_segments(table, ech)
    print(f"  {len(segments)} transition(s) détectée(s)")
    for s in segments:
        print(f"  — transition {s.indice} : {s.debut_ms:.0f} → {s.fin_ms:.0f} ms")
        for nom, r in s.ressorts.items():
            print(
                f"     {nom:8s} {r['x0']:.2f} → {r['x1']:.2f} pt | response {r['response']:.4f} s, "
                f"dampingFraction {r['dampingFraction']:.4f} | stiffness {r['stiffness']:.2f}, "
                f"damping {r['damping']:.3f}, mass 1 | erreur {100 * r['erreur_relative']:.2f} %"
            )
        c = s.contenu
        if c.get("changement"):
            print(
                f"     contenu ({c['sens']}) : début (3 %) à {_ms(c.get('t3_depuis_debut_forme_ms'))}, "
                f"10 % à {_ms(c.get('t10_depuis_debut_forme_ms'))}, 90 % à {_ms(c.get('t90_depuis_debut_forme_ms'))} "
                "(depuis le début du mouvement de la forme)"
            )
        for e in s.erreurs:
            print(f"     ! {e}")
        t = table["temps_ms"]
        fen = (t >= s.debut_ms - 120) & (t <= s.fin_ms + 400)
        graphique_segment(
            t[fen], table["largeur"][fen] / ech, table["hauteur"][fen] / ech, table["contenu_luminance"][fen],
            s.ressorts, f"{chemin.name} — transition {s.indice}", dossier / f"segment_{s.indice:02d}.png",
        )

    resultats = {
        "video": str(chemin),
        "echelle_px_par_pt": ech,
        "periode_image_ms": periode_image_ms(table["temps_ms"]),
        "transitions": [s.__dict__ for s in segments],
    }
    (dossier / "resultats.json").write_text(json.dumps(resultats, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  → {dossier}")
    return table, segments, ech


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", nargs="?", type=Path, help="vidéo à analyser")
    p.add_argument("--compare", nargs=2, type=Path, metavar=("IPHONE", "NOTRE"), help="comparer deux vidéos")
    p.add_argument("--echelle", type=float, help="pixels par point (iPhone @3x = 3)")
    p.add_argument("--echelle-a", type=float, help="--compare : échelle de la 1re vidéo")
    p.add_argument("--echelle-b", type=float, help="--compare : pixels par point de la 2e vidéo (échelle Windows × ISLAND_SCALE)")
    p.add_argument("--segment-a", type=int, default=0, help="--compare : transition à comparer dans la 1re vidéo")
    p.add_argument("--segment-b", type=int, default=0, help="--compare : transition à comparer dans la 2e vidéo")
    p.add_argument("--seuil", type=float, default=40.0, help="niveau de gris max d'un pixel « noir » (0–255)")
    p.add_argument("--zone-haut", type=float, default=0.35, help="l'île doit commencer dans cette fraction haute de l'image")
    p.add_argument("--debut-ms", type=float, help="ignorer les images avant cet instant")
    p.add_argument("--fin-ms", type=float, help="ignorer les images après cet instant")
    p.add_argument("--sortie", type=Path, default=SORTIE_DEFAUT, help="dossier de sortie")
    args = p.parse_args(argv)

    if args.compare:
        a, b = args.compare
        ta, sa, ea = analyser(a, args.echelle_a or args.echelle, args, args.sortie)
        tb, sb, eb = analyser(b, args.echelle_b, args, args.sortie)
        if args.segment_a >= len(sa) or args.segment_b >= len(sb):
            raise SystemExit("transition demandée introuvable")
        dossier = args.sortie / f"comparaison_{a.stem}_vs_{b.stem}"
        dossier.mkdir(parents=True, exist_ok=True)
        rapport = comparer(ta, sa[args.segment_a], ea, tb, sb[args.segment_b], eb, dossier)
        (dossier / "rapport.json").write_text(json.dumps(rapport, indent=2, ensure_ascii=False), encoding="utf-8")
        print("\n▶ Comparaison")
        for nom, d in rapport["dimensions"].items():
            if "ecart_rms_pourcent" in d:
                print(f"  {nom:8s} écart RMS {d['ecart_rms_pourcent']:.2f} % (max {d['ecart_max_pourcent']:.2f} %)")
        for nom, d in rapport["delais_contenu"].items():
            print(f"  contenu {nom} : écart {d['ecart_ms']:+.1f} ms ({d['ecart_images']:+.2f} image)")
        print(f"  objectif (< 3 % et ±1 image) : {'ATTEINT' if rapport['objectif_atteint'] else 'pas encore'}")
        print(f"  → {dossier}")
        return 0

    if args.video is None:
        p.error("donner une vidéo, ou --compare A B")
    analyser(args.video, args.echelle, args, args.sortie)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
