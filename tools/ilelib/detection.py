"""
Détection de l'île (forme noire) dans une image, au sous-pixel près.

Principe :
 1. Seuil : les pixels presque noirs (≤ seuil) forment un masque.
 2. Composantes : on garde la plus grande forme proche du HAUT et du CENTRE
    (= l'île). Une 2e forme à côté, de hauteur semblable, est la BULLE (mode split).
 3. Bords sous-pixel : les pixels du bord sont « à moitié » noirs (anticrénelage).
    Leur gris indique la fraction couverte par la forme (« couverture » 0–1).
    En additionnant ces fractions de part et d'autre du bord, on obtient la
    position du bord au 1/10 de pixel près.
 4. Rayon : on mesure le retrait du bord gauche ligne par ligne dans le coin
    haut-gauche, puis on ajuste un arc de cercle (et un « superellipse » pour
    estimer le lissage des coins continus).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import cv2
import numpy as np
from scipy.optimize import least_squares

FENETRE_BORD = 3  # demi-largeur (px) de la fenêtre d'intégration autour d'un bord


@dataclass
class Forme:
    """Mesures d'une forme en pixels (sous-pixel)."""

    x: float
    y: float
    largeur: float
    hauteur: float
    rayon: float | None
    boite: tuple[int, int, int, int]
    """Boîte englobante entière (x, y, largeur, hauteur)."""

    @property
    def centre_x(self) -> float:
        return self.x + self.largeur / 2

    def en_dict(self) -> dict:
        return asdict(self)


@dataclass
class MesureImage:
    ile: Forme | None
    bulle: Forme | None
    contenu_luminance: float
    """Luminance moyenne (0–255) à l'intérieur de l'île : monte quand le contenu apparaît."""
    contenu_nettete: float
    """Variance du laplacien à l'intérieur : monte quand le contenu devient net (moins flou)."""
    contenu_fraction: float
    """Fraction des pixels intérieurs nettement plus clairs que la pilule."""


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def en_gris(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image.astype(np.float32)
    if image.shape[2] == 4:
        image = image[:, :, :3]
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _couverture(gris: np.ndarray, fond: float, forme: float) -> np.ndarray:
    """Fraction de chaque pixel couverte par la forme (1 = entièrement noir)."""
    ecart = max(fond - forme, 1e-6)
    return np.clip((fond - gris) / ecart, 0.0, 1.0)


def _niveaux(gris: np.ndarray, masque: np.ndarray, seuil: float) -> tuple[float, float]:
    """Niveau de gris du fond (autour de la forme) et de la forme elle-même."""
    noyau = np.ones((3, 3), np.uint8)
    anneau = cv2.dilate(masque, noyau, iterations=FENETRE_BORD + 3) & ~cv2.dilate(
        masque, noyau, iterations=FENETRE_BORD
    )
    fond = float(np.median(gris[anneau > 0])) if np.any(anneau) else 255.0
    interieur = cv2.erode(masque, noyau, iterations=2)
    sombres = gris[(interieur > 0) & (gris <= seuil)]
    forme = float(np.median(sombres)) if sombres.size else 0.0
    return fond, forme


def _bord_debut(profil_couv: np.ndarray, i: int) -> float:
    """Position sous-pixel d'un bord « fond → forme » proche de l'indice i."""
    a = max(i - FENETRE_BORD, 0)
    b = min(i + FENETRE_BORD + 1, len(profil_couv))
    return a + float(np.sum(1.0 - profil_couv[a:b]))


def _bord_fin(profil_couv: np.ndarray, i: int) -> float:
    """Position sous-pixel d'un bord « forme → fond » proche de l'indice i (dernier pixel de forme)."""
    a = max(i - FENETRE_BORD, 0)
    b = min(i + FENETRE_BORD + 1, len(profil_couv))
    return a + float(np.sum(profil_couv[a:b]))


# ---------------------------------------------------------------------------
# Mesure d'une forme
# ---------------------------------------------------------------------------

def profil_coin(couv: np.ndarray, masque: np.ndarray, gauche: float, haut: float, hauteur: float):
    """
    Profil du coin haut-gauche : pour chaque distance d depuis le haut, le retrait du
    bord par rapport au bord gauche.
      - partie RAIDE du coin (près du bord gauche) : mesure ligne par ligne ;
      - partie PLATE (près du haut) : mesure colonne par colonne (bord presque horizontal).
    Renvoie (d, retrait) triés par d, en pixels.
    """
    y0 = int(math.floor(haut))
    y1 = int(math.floor(haut + hauteur / 2))
    points = []
    for y in range(y0, y1 + 1):
        if y < 0 or y >= masque.shape[0]:
            continue
        colonnes = np.nonzero(masque[y])[0]
        if colonnes.size == 0:
            continue
        d = y + 0.5 - haut
        retrait = _bord_debut(couv[y], int(colonnes[0])) - gauche
        if d >= 1.0 and retrait <= d:  # partie raide (sous la diagonale)
            points.append((d, retrait))
    x0 = int(math.floor(gauche))
    for x in range(x0, x0 + int(hauteur / 2) + 1):
        if x < 0 or x >= masque.shape[1]:
            continue
        rangs = np.nonzero(masque[:, x])[0]
        if rangs.size == 0:
            continue
        retrait = x + 0.5 - gauche
        d = _bord_debut(couv[:, x], int(rangs[0])) - haut
        # d < 1 : bord haut rectiligne (ou première ligne partielle) → pas un point du coin.
        if d >= 1.0 and d < retrait:  # partie plate (au-dessus de la diagonale)
            points.append((d, retrait))
    if not points:
        return np.array([]), np.array([])
    points.sort()
    tableau = np.array(points)
    return tableau[:, 0], tableau[:, 1]


def retrait_cercle(d: np.ndarray, r: float) -> np.ndarray:
    """Retrait horizontal d'un coin en arc de cercle de rayon r, à la distance d du haut."""
    d = np.asarray(d, dtype=float)
    u = np.clip(r - d, 0.0, None)
    return np.where(d < r, r - np.sqrt(np.clip(r * r - u * u, 0.0, None)), 0.0)


def retrait_superellipse(d: np.ndarray, a: float, n: float) -> np.ndarray:
    """Retrait d'un coin superellipse |x/a|^n + |y/a|^n = 1 (n = 2 : cercle ; n > 2 : coin « continu »)."""
    d = np.asarray(d, dtype=float)
    u = np.clip((a - d) / a, 0.0, 1.0)
    return np.where(d < a, a - a * np.power(np.clip(1 - u**n, 0.0, 1.0), 1.0 / n), 0.0)


def ajuster_cercle(d: np.ndarray, retrait: np.ndarray, r_max: float) -> tuple[float, float]:
    """Rayon de l'arc de cercle qui colle le mieux au profil. Renvoie (rayon, rmse)."""
    if d.size < 2:
        return float("nan"), float("nan")
    r_max = max(r_max, 1.0)
    candidats = np.linspace(0.5, r_max * 1.05, 60)
    erreurs = [np.mean((retrait_cercle(d, r) - retrait) ** 2) for r in candidats]
    r0 = float(candidats[int(np.argmin(erreurs))])
    sol = least_squares(lambda p: retrait_cercle(d, p[0]) - retrait, [r0], bounds=([0.3], [r_max * 1.1]))
    return float(sol.x[0]), float(np.sqrt(np.mean(sol.fun**2)))


def ajuster_superellipse(d: np.ndarray, retrait: np.ndarray, a_max: float) -> tuple[float, float, float]:
    """Renvoie (étendue a, exposant n, rmse)."""
    if d.size < 3:
        return float("nan"), float("nan"), float("nan")
    meilleur = None
    for n0 in (2.0, 3.0, 4.5):
        for a0 in (a_max * 0.5, a_max * 0.9):
            sol = least_squares(
                lambda p: retrait_superellipse(d, p[0], p[1]) - retrait,
                [a0, n0],
                bounds=([0.5, 1.2], [a_max * 1.6, 12.0]),
            )
            if meilleur is None or sol.cost < meilleur.cost:
                meilleur = sol
    return float(meilleur.x[0]), float(meilleur.x[1]), float(np.sqrt(np.mean(meilleur.fun**2)))


def mesurer_forme(gris: np.ndarray, masque: np.ndarray, seuil: float, avec_rayon: bool = True) -> Forme:
    """Mesure sous-pixel d'une forme pleine (masque = forme remplie, uint8 0/255)."""
    x, y, w, h = cv2.boundingRect(masque)
    fond, forme = _niveaux(gris, masque, seuil)
    couv = _couverture(gris, fond, forme)

    # Bords gauche/droit sur chaque ligne, haut/bas sur chaque colonne.
    # Le bord extrême = moyenne des 3 valeurs les plus extrêmes (robuste au bruit ;
    # fonctionne aussi pour une capsule ou un cercle, sans partie droite).
    gauches, droites = [], []
    for ly in range(y + 1, y + h - 1):
        cols = np.nonzero(masque[ly])[0]
        if cols.size:
            gauches.append(_bord_debut(couv[ly], int(cols[0])))
            droites.append(_bord_fin(couv[ly], int(cols[-1])))
    hauts, bas = [], []
    for cx in range(x + 1, x + w - 1):
        rangs = np.nonzero(masque[:, cx])[0]
        if rangs.size:
            hauts.append(_bord_debut(couv[:, cx], int(rangs[0])))
            bas.append(_bord_fin(couv[:, cx], int(rangs[-1])))

    def extreme(valeurs: list[float], defaut: float, plus_petit: bool) -> float:
        if not valeurs:
            return defaut
        v = np.sort(np.asarray(valeurs))
        v = v[:3] if plus_petit else v[-3:]
        return float(np.mean(v))

    gauche = extreme(gauches, float(x), True)
    droite = extreme(droites, float(x + w), False)
    haut = extreme(hauts, float(y), True)
    bas_ = extreme(bas, float(y + h), False)

    rayon = None
    if avec_rayon:
        d, retrait = profil_coin(couv, masque, gauche, haut, bas_ - haut)
        r, _ = ajuster_cercle(d, retrait, (bas_ - haut) / 2)
        rayon = None if math.isnan(r) else r

    # Bas robuste : si la forme a un bas plat (rayon nettement < demi-hauteur), des objets
    # sombres SOUS l'île (icônes foncées) peuvent prolonger certaines colonnes. Le vrai bas
    # est alors la médiane des colonnes centrales (le haut de l'île, lui, n'est jamais touché).
    if rayon is not None and rayon < 0.35 * (bas_ - haut) and len(bas) >= 10:
        n = len(bas)
        centre = np.asarray(bas[int(n * 0.2): int(n * 0.8)])
        bas_ = float(np.median(centre))

    return Forme(x=gauche, y=haut, largeur=droite - gauche, hauteur=bas_ - haut, rayon=rayon, boite=(x, y, w, h))


# ---------------------------------------------------------------------------
# Détection dans une image complète
# ---------------------------------------------------------------------------

def masques_candidats(gris: np.ndarray, seuil: float, zone_haut: float) -> list[np.ndarray]:
    """Formes sombres (remplies, trous compris) dans le haut de l'image, de la plus grande à la plus petite."""
    h, w = gris.shape
    limite = max(int(h * zone_haut), 1)
    masque = np.where(gris <= seuil, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(masque, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    aire_min = max(30.0, 2e-5 * h * w)
    # La forme doit COMMENCER dans le haut de l'image (elle peut descendre plus bas une fois étendue).
    contours = [c for c in contours if cv2.contourArea(c) >= aire_min and cv2.boundingRect(c)[1] < limite]
    contours.sort(key=cv2.contourArea, reverse=True)
    resultat = []
    for c in contours:
        m = np.zeros((h, w), np.uint8)
        cv2.drawContours(m, [c], -1, 255, thickness=cv2.FILLED)
        resultat.append(m)
    return resultat


def detecter(
    image: np.ndarray,
    seuil: float = 40.0,
    zone_haut: float = 0.35,
    tolerance_centre: float = 0.2,
    avec_rayon: bool = True,
) -> MesureImage:
    """
    Trouve l'île (et la bulle en mode split) dans une image BGR ou en niveaux de gris.
      seuil            : niveau de gris maximal d'un pixel « noir » (0–255)
      zone_haut        : on ne cherche que dans cette fraction haute de l'image
      tolerance_centre : écart horizontal max du centre de l'île / centre de l'image (fraction de largeur)
    """
    gris = en_gris(image)
    h, w = gris.shape
    candidats = masques_candidats(gris, seuil, zone_haut)

    principal = None
    for m in candidats:
        bx, by, bw, bh = cv2.boundingRect(m)
        if abs(bx + bw / 2 - w / 2) <= tolerance_centre * w and by > 0:
            principal = m
            break
    if principal is None:
        return MesureImage(None, None, 0.0, 0.0, 0.0)

    ile = mesurer_forme(gris, principal, seuil, avec_rayon)

    # Bulle : autre forme à côté, à la même hauteur, de taille comparable, à peu près ronde.
    bulle = None
    _, py, _, ph = ile.boite
    for m in candidats:
        if m is principal:
            continue
        bx, by, bw, bh = cv2.boundingRect(m)
        meme_rangee = abs((by + bh / 2) - (py + ph / 2)) < ph * 0.5
        taille_ok = 0.5 * ph <= bh <= 1.5 * ph
        ronde = 0.6 <= bw / max(bh, 1) <= 1.6
        proche = min(abs(bx - (ile.boite[0] + ile.boite[2])), abs(ile.boite[0] - (bx + bw))) < 0.25 * w
        if meme_rangee and taille_ok and ronde and proche:
            bulle = mesurer_forme(gris, m, seuil, avec_rayon)
            break

    # Contenu : intérieur de l'île, en retrait du bord.
    marge = max(2, int(round(0.12 * ile.hauteur)))
    noyau = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * marge + 1, 2 * marge + 1))
    interieur = cv2.erode(principal, noyau) > 0
    if np.any(interieur):
        valeurs = gris[interieur]
        lap = cv2.Laplacian(gris, cv2.CV_32F)
        lum = float(valeurs.mean())
        fraction = float(np.mean(valeurs > seuil * 1.5))
        nettete = float(lap[interieur].var())
    else:
        lum = fraction = nettete = 0.0

    return MesureImage(ile, bulle, lum, nettete, fraction)


def pixels_vers_points(valeur_px: float, echelle: float) -> float:
    """iPhone 15 Pro : écran @3x → 1 point = 3 pixels."""
    return valeur_px / echelle


# Résolutions connues (portrait, pixels) → échelle @Nx.
RESOLUTIONS_CONNUES = {
    (1179, 2556): ("iPhone 14 Pro / 15 / 15 Pro / 16", 3.0),
    (1290, 2796): ("iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus", 3.0),
    (1206, 2622): ("iPhone 16 Pro / 17 Pro", 3.0),
    (1320, 2868): ("iPhone 16 Pro Max / 17 Pro Max", 3.0),
    (1260, 2736): ("iPhone Air", 3.0),
}


def echelle_depuis_resolution(largeur: int, hauteur: int) -> tuple[float | None, str]:
    """Devine l'échelle @3x à partir de la résolution (portrait ou paysage)."""
    cle = (min(largeur, hauteur), max(largeur, hauteur))
    if cle in RESOLUTIONS_CONNUES:
        nom, echelle = RESOLUTIONS_CONNUES[cle]
        return echelle, nom
    return None, f"résolution {largeur}x{hauteur} inconnue"
