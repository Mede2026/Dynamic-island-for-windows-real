#!/usr/bin/env python3
"""
Mesures de RÉFÉRENCE (phase 2) sur les enregistrements d'écran d'un iPhone 16 Pro (iOS 27).

Chaque mesure = une fenêtre de temps précise dans une vidéo précise (source traçable).
Les fenêtres ont été choisies en regardant les courbes de analyze_video.py.

  python tools/mesurer_reference.py            → docs/mesures.json + tools/output/reference/*.png

Échelle : vidéos 664 x 1440 px pour un écran de 402 x 874 pt (iPhone 16 Pro)
  → 1,6517 px/pt horizontalement, 1,6476 px/pt verticalement.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from analyze_screenshot import analyser_coin  # noqa: E402
from ilelib.detection import detecter, en_gris  # noqa: E402
from ilelib.graphiques import graphique_segment  # noqa: E402
from ilelib.ressort import ajuster_ressort  # noqa: E402
from ilelib.video import lire_images  # noqa: E402

RACINE = Path(__file__).resolve().parent
ENTREE = RACINE / "input"
SORTIE = RACINE / "output" / "reference"
ECRAN_PT = (402.0, 874.0)  # iPhone 16 Pro

# ---------------------------------------------------------------------------
# Fenêtres choisies (secondes). Voir docs/mesures.md pour la description.
# ---------------------------------------------------------------------------

ETATS = {
    # nom: (vidéo, début, fin, description)
    "repos": ("IMG_4727", 4.75, 5.80, "île vide (aucune activité)"),
    "compact": ("IMG_4728", 0.00, 0.55, "compact : indicateur d'enregistrement seul"),
    "split": ("IMG_4728", 6.70, 7.40, "split : musique (île) + enregistrement (bulle)"),
    "etendu": ("IMG_4730", 2.95, 7.30, "étendu : lecteur de musique"),
    "alerte": ("IMG_4731", 11.30, 13.30, "alerte : « En charge 98 % »"),
    "etenduMinuteur": ("IMG_4729", 18.60, 20.30, "étendu : minuteur"),
    "appui": ("IMG_4728", 7.58, 7.60, "appui long : île gonflée juste avant l'ouverture"),
}

TRANSITIONS = {
    # nom: (vidéo, début, fin, description) — un ressort ajusté sur largeur et hauteur
    "apparition": ("IMG_4727", 5.84, 6.60, "repos → compact (126 → 172 pt)"),
    "disparition": ("IMG_4727", 18.05, 18.70, "compact → repos"),
    "ouvrir": ("IMG_4730", 2.44, 3.40, "contraction → étendu (musique)"),
    "ouvrir_b": ("IMG_4731", 1.89, 2.80, "contraction → étendu (musique), 2e essai"),
    "ouvrir_c": ("IMG_4728", 9.09, 10.00, "contraction → étendu (musique), 3e essai"),
    "fermer": ("IMG_4730", 7.44, 7.81, "étendu → compact fusionné"),
    "fermer_b": ("IMG_4731", 3.39, 3.74, "étendu → compact fusionné, 2e essai"),
    "fermer_hauteur": ("IMG_4731", 3.39, 4.20, "étendu → compact : hauteur seule (fenêtre longue)"),
    "fermer_hauteur_b": ("IMG_4730", 7.44, 8.25, "étendu → compact : hauteur seule, 2e essai"),
    "retrait": ("IMG_4731", 10.60, 10.81, "compact → rétraction avant changement d'activité"),
    "alerteEntree": ("IMG_4731", 10.80, 11.60, "rétraction → alerte « En charge »"),
    "alerteSortie": ("IMG_4731", 13.60, 14.30, "alerte → compact"),
    "compactVersSplit": ("IMG_4728", 6.30, 6.90, "séparation de la bulle (île principale)"),
    "splitVersCompact": ("IMG_4731", 5.14, 5.70, "fusion puis retour compact"),
    "appuiGonfle": ("IMG_4728", 7.42, 7.62, "appui long : l'île gonfle"),
    "fusionBulle": ("IMG_4728", 7.58, 7.92, "après gonflement : contraction avant ouverture"),
}

# ---------------------------------------------------------------------------


def echelles(chemin: Path) -> tuple[float, float]:
    cap = cv2.VideoCapture(str(chemin))
    w, h = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    cap.release()
    return w / ECRAN_PT[0], h / ECRAN_PT[1]


def images(video: str, debut: float, fin: float):
    """(indice, temps_ms, image) dans la fenêtre."""
    for i, (t, img) in enumerate(lire_images(ENTREE / f"{video}.MP4")):
        if t < debut * 1000:
            continue
        if t > fin * 1000:
            break
        yield i, t, img


def numero_image(video: str, t_s: float) -> int:
    for i, (t, _) in enumerate(lire_images(ENTREE / f"{video}.MP4")):
        if t >= t_s * 1000:
            return i
    return -1


def mesurer_etat(video, debut, fin):
    ex, ey = echelles(ENTREE / f"{video}.MP4")
    vals, coins, idx = [], [], []
    derniere = None
    for i, t, img in images(video, debut, fin):
        m = detecter(img)
        if m.ile is None:
            continue
        idx.append(i)
        b = m.bulle
        vals.append([
            m.ile.largeur / ex, m.ile.hauteur / ey, m.ile.y / ey, (m.ile.rayon or np.nan) / ey,
            (b.largeur / ex) if b else np.nan, (b.hauteur / ey) if b else np.nan,
            (b.x - (m.ile.x + m.ile.largeur)) / ex if b else np.nan,
            (m.ile.x + m.ile.largeur / 2) / ex,
        ])
        derniere = (img, m)
    v = np.nanmedian(np.array(vals), axis=0)
    res = {
        "largeur_pt": v[0], "hauteur_pt": v[1], "marge_haut_pt": v[2], "rayon_cercle_pt": v[3],
        "bulle_diametre_pt": v[4], "bulle_hauteur_pt": v[5], "bulle_ecart_pt": v[6], "centre_x_pt": v[7],
        "images": [min(idx), max(idx)], "n": len(idx),
    }
    # Profil du coin sur la dernière image (coins continus ?).
    if derniere:
        img, m = derniere
        coin = analyser_coin(en_gris(img), m.ile, 40.0)
        if coin:
            res["coin"] = {
                "rayon_cercle_pt": coin["cercle"]["rayon_px"] / ey,
                "superellipse_etendue_pt": coin["superellipse"]["etendue_px"] / ey,
                "superellipse_n": coin["superellipse"]["exposant_n"],
                "rmse_cercle_px": coin["cercle"]["rmse_px"],
                "rmse_superellipse_px": coin["superellipse"]["rmse_px"],
                "lissage_estime": coin["lissage_estime"],
                "capsule_parfaite": coin["capsule_parfaite"],
            }
        # Couleur de la pilule (médiane des pixels intérieurs les plus sombres).
        gris = en_gris(img)
        x, y, w, h = m.ile.boite
        zone = img[y + h // 4: y + 3 * h // 4, x + w // 4: x + 3 * w // 4].reshape(-1, 3)
        sombres = zone[gris[y + h // 4: y + 3 * h // 4, x + w // 4: x + 3 * w // 4].reshape(-1) < 20]
        if len(sombres):
            b_, g_, r_ = np.median(sombres, axis=0)
            res["couleur_pilule"] = "#{:02x}{:02x}{:02x}".format(int(r_), int(g_), int(b_))
    return {k: (float(x) if isinstance(x, (np.floating, float)) else x) for k, x in res.items()}


def mesurer_transition(nom, video, debut, fin):
    ex, ey = echelles(ENTREE / f"{video}.MP4")
    T, W, H, R, L = [], [], [], [], []
    idx = []
    for i, t, img in images(video, debut, fin):
        m = detecter(img)
        if m.ile is None:
            continue
        idx.append(i)
        T.append(t)
        W.append(m.ile.largeur / ex)
        H.append(m.ile.hauteur / ey)
        R.append((m.ile.rayon or np.nan) / ey)
        L.append(m.contenu_luminance)
    T, W, H, R, L = map(np.array, (T, W, H, R, L))
    res = {"video": video, "fenetre_s": [debut, fin], "images": [min(idx), max(idx)], "n": len(idx)}
    for cle, serie in (("largeur", W), ("hauteur", H), ("rayon", R)):
        ok = ~np.isnan(serie)
        if np.ptp(serie[ok]) < 1.0:
            continue  # pas de mouvement sur cet axe
        try:
            r = ajuster_ressort(T[ok] / 1000, serie[ok], vitesse_initiale=True)
            res[cle] = r.en_dict()
        except (ValueError, RuntimeError) as e:
            res[cle] = {"erreur": str(e)}
    graphique_segment(
        T, W, H, L, {k: v for k, v in res.items() if k in ("largeur", "hauteur") and "erreur" not in v},
        f"{video} — {nom}", SORTIE / f"{nom}.png",
    )
    res["luminance"] = {"t_ms": T.tolist(), "valeurs": L.tolist()}
    return res


def delai_contenu(transition: dict, sens: str) -> dict:
    """Délai entre le début du mouvement (t0 du ressort) et le contenu (3 %, 50 %, 90 %)."""
    t = np.array(transition["luminance"]["t_ms"])
    v = np.array(transition["luminance"]["valeurs"])
    t0 = min(transition[k]["t0_s"] for k in ("largeur", "hauteur") if k in transition and "t0_s" in transition[k]) * 1000
    base, final = (v[0], v[-1])
    res = {"t0_ms": t0}
    for p in (3, 50, 90):
        niveau = base + (final - base) * p / 100
        croise = np.nonzero(v >= niveau)[0] if sens == "apparition" else np.nonzero(v <= niveau)[0]
        res[f"t{p}_ms"] = float(t[croise[0]] - t0) if len(croise) else None
    return res


def flou_et_echelle(video: str, t_debut: float, t_final: float) -> dict:
    """
    Estime le flou (σ, pt) et l'échelle du contenu au tout début de son apparition :
    on cherche (σ, échelle, opacité) qui rendent l'image FINALE la plus proche de l'image du début.
    """
    ex, ey = echelles(ENTREE / f"{video}.MP4")
    def prendre(t):
        for _, tt, img in images(video, t, t + 0.05):
            return img, detecter(img)
    a_img, a = prendre(t_debut)
    b_img, b = prendre(t_final)
    def interieur(img, m, w, h):
        cx, cy = m.ile.x + m.ile.largeur / 2, m.ile.y + m.ile.hauteur / 2
        x0, y0 = int(cx - w / 2), int(cy - h / 2)
        return en_gris(img)[y0:y0 + h, x0:x0 + w]
    w = int(min(a.ile.largeur, b.ile.largeur) * 0.8)
    h = int(min(a.ile.hauteur, b.ile.hauteur) * 0.7)
    cible = interieur(a_img, a, w, h)
    final_grand = interieur(b_img, b, int(b.ile.largeur * 0.95), int(b.ile.hauteur * 0.9))
    meilleur = None
    for ech in np.linspace(0.6, 1.0, 9):
        petit = cv2.resize(final_grand, None, fx=ech, fy=ech, interpolation=cv2.INTER_AREA)
        ph, pw = petit.shape
        toile = np.zeros((max(h, ph), max(w, pw)), np.float32)
        oy, ox = (toile.shape[0] - ph) // 2, (toile.shape[1] - pw) // 2
        toile[oy:oy + ph, ox:ox + pw] = petit
        cy, cx = (toile.shape[0] - h) // 2, (toile.shape[1] - w) // 2
        ref = toile[cy:cy + h, cx:cx + w]
        for sigma in np.linspace(0, 12, 25):
            flou = cv2.GaussianBlur(ref, (0, 0), sigma) if sigma > 0.2 else ref
            denom = float(np.sum(flou * flou)) or 1.0
            alpha = float(np.clip(np.sum(flou * cible) / denom, 0, 1))
            err = float(np.mean((alpha * flou - cible) ** 2))
            if meilleur is None or err < meilleur[0]:
                meilleur = (err, sigma, ech, alpha)
    _, sigma, ech, alpha = meilleur
    return {"flou_sigma_px_video": sigma, "flou_sigma_pt": sigma / ex, "echelle": ech, "opacite": alpha}


def main() -> int:
    SORTIE.mkdir(parents=True, exist_ok=True)
    resultat = {"appareil": "iPhone 16 Pro (402 x 874 pt), iOS 27", "etats": {}, "transitions": {}}
    for nom, (video, d, f, desc) in ETATS.items():
        r = mesurer_etat(video, d, f)
        r.update({"video": video, "fenetre_s": [d, f], "description": desc})
        resultat["etats"][nom] = r
        print(f"{nom:16s} {r['largeur_pt']:7.2f} x {r['hauteur_pt']:6.2f} pt  marge {r['marge_haut_pt']:.2f}  "
              f"r {r['rayon_cercle_pt']:.2f}  bulle {r['bulle_diametre_pt']:.2f} écart {r['bulle_ecart_pt']:.2f}  "
              f"coin {r.get('coin', {}).get('superellipse_n', float('nan')):.2f}  [{video} images {r['images']}]")
    for nom, (video, d, f, desc) in TRANSITIONS.items():
        r = mesurer_transition(nom, video, d, f)
        r["description"] = desc
        resultat["transitions"][nom] = r
        txt = []
        for k in ("largeur", "hauteur"):
            if k in r and "response" in r[k]:
                x = r[k]
                txt.append(f"{k} {x['x0']:.1f}→{x['x1']:.1f} resp {x['response']:.3f} ζ {x['dampingFraction']:.3f} "
                           f"v0 {x['v0']:.0f} err {100 * x['erreur_relative']:.1f}%")
        print(f"{nom:16s} " + " | ".join(txt) + f"  [{video} images {r['images']}]")

    # Délais du contenu.
    resultat["contenu"] = {
        "ouvrir": delai_contenu(resultat["transitions"]["ouvrir"], "apparition"),
        "ouvrir_b": delai_contenu(resultat["transitions"]["ouvrir_b"], "apparition"),
        "fermer": delai_contenu(resultat["transitions"]["fermer"], "disparition"),
        "fermer_b": delai_contenu(resultat["transitions"]["fermer_b"], "disparition"),
        "alerteEntree": delai_contenu(resultat["transitions"]["alerteEntree"], "apparition"),
        "alerteSortie": delai_contenu(resultat["transitions"]["alerteSortie"], "disparition"),
    }
    for k, v in resultat["contenu"].items():
        print(f"contenu {k:12s} " + ", ".join(f"{a}={b:.0f}" for a, b in v.items() if b is not None))
    resultat["flou_contenu"] = flou_et_echelle("IMG_4730", 2.62, 3.30)
    print("flou/échelle au début du contenu :", resultat["flou_contenu"])

    for t in resultat["transitions"].values():
        t.pop("luminance", None)
    sortie = RACINE.parent / "docs" / "mesures.json"
    sortie.write_text(json.dumps(resultat, indent=2, ensure_ascii=False, default=float), encoding="utf-8")
    print(f"→ {sortie}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
