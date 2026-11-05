# Mesures (phase 2)

Toutes les valeurs de `src/island.config.ts` et leur source.

- **Appareil de référence** : iPhone 16 Pro (402 × 874 pt), iOS 27, enregistrements d'écran du propriétaire.
- **Vidéos** (dans `tools/input/`, hors git) : `IMG_4727.MP4` … `IMG_4731.MP4` — HEVC 664 × 1440 px,
  cadence variable (~60 i/s), horodatages réels vérifiés avec ffprobe (écart 0,000 ms).
- **Échelle** : 664 / 402 = **1,6517 px/pt** horizontalement, 1440 / 874 = **1,6476 px/pt** verticalement.
- **Outils** : `tools/mesurer_reference.py` (fenêtres choisies à la main, données dans `docs/mesures.json`),
  `tools/analyze_video.py`, `tools/analyze_screenshot.py`. « img » = numéro d'image dans la vidéo.
- Vidéo de contrôle croisé : les captures fournies (split et « 14m ») donnent île 158,6 pt, bulle 36,3 pt,
  écart 8,3 pt — à ±0,9 pt des mesures vidéo.

> ⚠️ L'enregistrement d'écran est lui-même une activité (point rouge) : l'île n'est presque jamais
> « vide » dans les vidéos. Le repos a été mesuré dans le seul passage sans activité (V4727, 4,75–5,80 s).

## Facteur d'échelle `ISLAND_SCALE`

**1,0 DIP par point** (valeur par défaut). Le propriétaire peut la changer : panneau Ctrl+Alt+D
(« Taille de l'île », 60 % à 200 %) ou menu de l'icône (Petite 0,85 / Normale 1 / Grande 1,25 /
Très grande 1,5). Le choix est mémorisé dans `parametres.json`.

Justification : à 100 % d'échelle Windows, 1 DIP ≈ 0,26 mm ; sur l'iPhone 16 Pro, 1 pt ≈ 0,17 mm. Un écran
d'ordinateur est regardé à ~60 cm contre ~30 cm pour un téléphone : à taille **angulaire** égale, il faudrait
≈ 1,25 DIP/pt ; à taille **physique** égale, ≈ 0,63. 1,0 se place entre les deux et donne une île au repos de
125 × 37 DIP, cohérente avec la densité de Windows 11 (barre des tâches 48 DIP, barres de titre 32 DIP).
Les **proportions** restent toujours exactes. L'échelle Windows de chaque écran (100 %, 125 %, 150 %, 200 %…)
est gérée automatiquement (tout est en DIP).

## Formes (pt)

| Valeur | Largeur × hauteur | Coin a (pt) / n | Source |
|---|---|---|---|
| `formes.repos` | 125,48 × 36,81 | 22,39 / 2,553 | V4727 img 280–338 |
| `formes.compact` | 172,13 × 36,81 | 23,96 / 2,722 | V4728 img 0–33 (indicateur d'enregistrement) |
| `formesContenu.compactDeuxCotes` | 197,5 × 36,81 | 23,96 / 2,722 | largeur : capture « 14m » fournie ; hauteur et coins : compact |
| `formes.split` (île) | 159,49 × 36,82 | 24,29 / 2,767 | V4728 img 400–440 |
| `formes.etendu` (musique) | 374,24 × 204,71 | 69,46 / 3,119 | V4730 img 177–437 |
| `formesContenu.etenduMinuteur` | 374,21 × 88,33 | 62,96 / 3,084 | V4729 img 1099–1200 |
| `formes.alerte` | 340,16 × 36,81 | 23,48 / 2,659 | V4731 img 634–753 (« En charge 98 % ») |
| `margeHautPt` | 14,06 | — | V4727 img 280–338 |
| `decalageXPt` (centre de l'île / centre de l'écran) | split **−17,01**, compact (enregistrement) **−3,33**, autres 0 | — | V4727, V4728, V4730, V4731 (écart entre vidéos < 0,1 pt) ; capture split fournie |
| `couleurPilule` | `#000000` | — | V4727 img 338 |

Coins : profil du coin haut-gauche mesuré ligne par ligne et colonne par colonne, ajusté par une
superellipse |x/a|ⁿ + |y/a|ⁿ = 1. Même au repos, iOS n'utilise **pas** un demi-cercle (n ≈ 2,6 ; l'arc de
cercle laisse une erreur 1,7 fois plus grande). La vue étendue a des coins plus « continus » (n ≈ 3,1).

## Ressorts (format Apple → Framer Motion, mass = 1)

| Transition | response (s) | ζ | stiffness | damping | Source |
|---|---|---|---|---|---|
| `apparition` (repos → compact) | 0,459 | 0,847 | 187,38 | 23,189 | V4727 img 341–385 (erreur 1,4 %) |
| `disparition`, `retrait` | 0,528 | 0,758 | 141,61 | 18,040 | V4731 img 592–604 (0,1 %) |
| `ouvrir` largeur | 0,522 | 0,817 | 144,88 | 19,668 | moyenne V4730 147–203, V4731 114–167, V4728 543–596 (0,2–0,7 %) |
| `ouvrir` hauteur | 0,527 | 0,815 | 142,15 | 19,434 | idem |
| `fermer` largeur | 0,374 | 0,742 | 282,24 | 24,931 | moyenne V4730 447–467, V4731 204–224 |
| `fermer` hauteur | 0,493 | 0,869 | 162,43 | 22,149 | moyenne V4731 204–252, V4730 447–493 (< 1 %) |
| `compactVersSplit` (île) | 0,524 | 0,509 | 143,78 | 12,207 | V4728 img 377–428 |
| `bulle.ressort` | 0,487 | 0,696 | 166,46 | 17,959 | V4730 img 86–120 |
| `splitVersCompact` | 0,477 | 0,868 | 173,51 | 22,867 | V4731 img 309–341 (0,6 %) |
| `alerteEntree`, `changementContenu` | 0,536 | 0,810 | 137,41 | 18,990 | V4731 img 604–651 (0,2 %) |
| `alerteSortie` | 0,495 | 0,562 | 161,12 | 14,267 | V4731 img 772–813 (1,1 %) |
| `contraction`, `appui.ressortRetour` | 0,471 | 0,829 | 177,96 | 22,118 | V4728 img 452–472 |

## Chorégraphie (découverte dans les vidéos)

| Valeur | Mesure | Source |
|---|---|---|
| Changement d'activité : **retrait** vers le repos puis élargissement | `retraitDureeMs` = 210 | V4731 10,60 → 10,81 s (img 592 → 604) |
| Le 2e mouvement repart sans élan | v0 ≈ 0 | ajustements V4731 (v0 = 4 et 47 pt/s) |
| Appui long : l'île **gonfle**, la bulle se refond, **contraction**, puis ouverture | `contractionDureeMs` = 270 | V4730 2,18 → 2,45 s |
| Fermeture vers split : bloc unique (île + bulle), puis la bulle se détache | `separationBulleMs` = 370 | V4730 (380 ms), V4731 (360 ms) |
| compact → split : bosse verticale pendant le retrait | `split.bosseHauteurPt` = 52,7 (pic 55 avec le dépassement), début +85 ms, pic +210 ms | V4727 img 474–486, V4729 img 282–293 |
| compact → split : élargissement, la bulle sort du bord droit | `split.croissanceDebutMs` = 315 ; ressort 0,516 s / 0,501 | V4727 img 492, V4729 img 299–310 |
| Ressorts de la bosse | montée 0,240 s / 0,531 ; descente 0,232 s / 1,400 | V4727 img 478–486 et 486–503 |
| split → compact : la bulle rentre, retrait, élargissement | `fusion.retraitDebutMs` = 110, `fusion.croissanceDebutMs` = 330 | V4731 img 290 → 296 → 309 |
| Priorité : musique > minuteur | — | capture split fournie, V4728 |

## Contenu

| Valeur | Mesure | Source |
|---|---|---|
| `delaiApparitionMs` | 56 (mesuré 83, corrigé de −27 ms par la validation) | ouvrir ×2 + alerteEntree, seuils 3 %/90 % ; `docs/fidelite.md` |
| `dureeFonduEntreeMs` | 262 | idem |
| `delaiDisparitionMs` | 36 | fermer ×2 + alerteSortie |
| `dureeFonduSortieMs` | 105 | idem |
| `flouDepartPt` | 15,1 | V4730 img 150–155 comparées à img 192 (recherche flou × échelle × opacité) |
| `echelleDepart` | 0,75 | idem |

## Bulle, appui, indicateurs

| Valeur | Mesure | Source |
|---|---|---|
| `bulle.diametrePt` | 36,83 | V4728 img 400–440 |
| `bulle.ecartPt` | 7,84 | V4728 img 400–440 |
| `bulle.goutte*` | flou 1,5 pt, alpha ×8 −3,5 | **déduit** : fusion quand l'écart < ~2 pt (V4728 img 450–452) ; seuil à 50 % |
| `appui.echelleAppui` | 1,10 | V4728 img 452 (176,1/159,5 et 40,35/36,81) |
| `appui.dureeGonflementMs`, `durees.clicLongSeuilMs` | 180 | V4728 img 441 → 452 |
| Clic court : **rebond** | impulsion calculée pour atteindre `echelleAppui` avec `ressortRetour` (pic ×1,09 à ~60 ms) | **déduit** des valeurs d'appui mesurées (pas de vidéo de clic court) |
| `indicateurs.enregistrementCouleur` | `#d3382a` | V4728 img 18 |
| `indicateurs.pointXPt` / `pointDiametrePt` | 11,2 / 14,5 | V4728 img 18 |
| `durees.alerteAffichageMs` | 3000 | V4731 10,60 → 13,60 s |

## Zone de la caméra et largeur des alertes

Sur iPhone, rien n'est dessiné dans la zone centrale de la taille du repos (125,48 × 36,81 pt) : les
capteurs sont là. Le contenu est rangé à gauche et à droite.

| Valeur | Mesure | Source |
|---|---|---|
| `zoneCamera.largeurPt` / `hauteurPt` | 125,48 / 36,81 | = repos (V4727 img 280–338) |
| `zoneCamera.margePt` (écart contenu ↔ caméra) | 18,9 | V4731 img 706 : « 98 % » commence à 251,7, caméra finit à 232,8 |
| `alerte.valeurDroitePt` / `ecartValeurBatteriePt` | 55,16 / 7,8 | V4731 img 706 (corrigé : l'ancienne mesure ignorait le signe %) |

Règle : **largeur = caméra + 2 × max(côté gauche, côté droit)**, côté = marge du bord + contenu + 18,9.
Elle retrouve l'alerte mesurée (340,3 pt calculés pour 340,16 mesurés) et donne aux autres alertes la
bonne largeur (volume ≈ 257 pt…), au plus la largeur de la vue étendue (374,24 pt).

## Couleurs

Mesurées au **cœur** des formes colorées : 90ᵉ centile de (saturation + luminosité). La première mesure
prenait les pixels les plus lumineux, c'est-à-dire les bords blanchis par la compression vidéo, d'où des
couleurs délavées (orange `#f29b59` au lieu de `#ff8c2b`). Vérifié : OpenCV et ffmpeg (BT.709, pleine
plage, conforme aux vidéos) donnent exactement les mêmes valeurs.

## Mise en page du contenu (pt, depuis le coin haut-gauche de l'île)

Mesurée sur les composantes claires à l'intérieur de l'île : musique étendue **V4730 img 192**, split
**V4728 img 417**, alerte **V4731 img 706**, minuteur étendu **V4729 img 1153**. Couleurs : 90ᵉ centile de
luminosité (la compression vidéo atténue les petits textes). Tailles de police : hauteur de capitale / 0,727
(proportion de la police Inter).

| Élément | Valeurs |
|---|---|
| Pochette étendue | x 21,8, y 24,1, 66 × 66, rayon 12,74 |
| Titre / artiste | x 108,3, lignes de base 51,4 / 72,7, 16,6 pt, `#ffffff` / `#8f8f90` |
| Onde sonore | x 319,6, centre y 49,3, 6 barres de 2,7 pt, pas 4,72, hauteur 2,4–22,5 |
| Temps | ligne de base 118,8, 10,9 pt, `#919092`, de x 25,4 à 349,5 |
| Barre de progression | x 57,5 → 308,8, centre y 115,2, `#919098` / `#212022` |
| Boutons | centre y 157,8, centres x 45,4 / 116,9 / 187,9 / 258,5 / 330,0 |
| Pochette compacte | x 8,8, y 6,6, 23,6 × 23,6, rayon 6,11 |
| Alerte | texte x 13,1, ligne de base 23,5, 15 pt ; batterie 33,3 × 17,6 à 14,06 du bord, `#56fe36` ; valeur `#52ffa9` |
| Minuteur étendu | boutons ⌀ 49,6 à x 16,8 et 75, y 19,3 ; « Minuteur » x 176,1 ; chiffres 35 pt jusqu'à x 357,4 ; `#ff8c2b` |

## Valeurs ESTIMÉES (non présentes dans les vidéos)

À valider avec de nouvelles vidéos si besoin :

| Valeur | Estimation | Raison |
|---|---|---|
| Onde du mode compact (`media.compact.onde*`) | barres 2,2 pt, pas 3,6, hauteur 12 | l'onde compacte n'est jamais visible (toujours en split à cause de l'enregistrement) |
| Minuteur compact (`minuteur.compact*`) | icône 21 pt à x 8,7, texte à 7,5 du bord | mesuré visuellement sur la capture « 14m » |
| Point caméra/micro (`indicateurs.confidentialite*`) | ⌀ 6 pt | absent des vidéos ; couleurs = vert et orange mesurés |
| Ombre de la vue étendue (`ombreEtendu`) | flou 18 pt, décalage 6 pt, opacité 0,22 | estimation visuelle V4730 img 192 |
| `durees.etenduFermetureAutoMs` | 3000 | pas de survol sur iPhone (comportement propre à Windows) |
| Appui court (V5) | même ressort que la contraction | la vidéo V5 (clics courts) n'a pas été fournie |
| Changement de piste (V6) | contenu en fondu, forme inchangée | la vidéo V6 n'a pas été fournie |
