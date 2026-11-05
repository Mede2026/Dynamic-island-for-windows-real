# Dynamic Island pour Windows

Réplique fidèle du Dynamic Island de l'iPhone, en overlay en haut au centre de l'écran Windows.

**État : fin de la phase 1** — tout l'invisible est prêt (fenêtre, média, système, machine à états,
outils de mesure). **Rien n'est dessiné** : la fenêtre est transparente et vide. Le visuel (phase 2)
sera construit à partir des **mesures** faites sur des vidéos du Simulateur iPhone.

| Dossier | Contenu |
|---|---|
| `src/island.config.ts` | **Seul** fichier de valeurs visuelles (toutes à `null` en phase 1) |
| `src/state/islandMachine.ts` | Machine à états (repos, compact, split, étendu, alerte) + tests |
| `src/bridge/` | Lien avec le backend Rust (commandes, événements, journal console) |
| `src-tauri/src/` | Backend Rust : `fenetre`, `media`, `systeme`, `minuteur`, `demarrage` |
| `tools/` | Outils Python d'analyse vidéo/capture + tests synthétiques |
| `docs/` | `limites.md`, `mesures.md`, `instructions.md` |

## Installation (Windows 11)

1. **Node.js LTS** — https://nodejs.org
2. **Rust** — https://rustup.rs (choisir l'option par défaut)
3. **Visual Studio Build Tools** — charge de travail « Développement Desktop en C++ »
4. **WebView2** — déjà inclus dans Windows 11
5. **Python 3** — https://python.org (cocher « Add to PATH »)

Puis, dans un terminal PowerShell, dans le dossier du projet :

```bash
npm install
```

```bash
python -m venv tools/.venv
```

```bash
tools\.venv\Scripts\pip install -r tools/requirements.txt
```

## Lancer

```bash
npm run tauri dev
```

La fenêtre est invisible (c'est voulu). Le **journal** s'affiche dans le terminal (backend Rust) :
`[media] …`, `[batterie] …`, `[volume] …`.

Pour voir aussi le journal du front-end (machine à états), ouvrir la console de la page
automatiquement (PowerShell) :

```bash
$env:ILE_DEVTOOLS=1; npm run tauri dev
```

Outils de débogage dans la console de la page (`window.__ile`) :

```js
__ile.backend.minuteurDemarrer(10000)   // minuteur de 10 s
__ile.backend.definirDemarrageAuto(true) // démarrer avec Windows
__ile.machine.etat                       // état de la machine
```

## Minuteur depuis l'extérieur

L'île a son propre minuteur. On peut le piloter en ligne de commande (raccourci Windows,
MacroPad, Stream Deck…). Si l'île tourne déjà, la commande est transmise à l'île ouverte :

```bash
dynamic-island.exe --minuteur 5m
```

Durées acceptées : `90s`, `5m`, `1h30m`, `2m30s`, `300` (secondes). Autres : `--minuteur-pause`,
`--minuteur-reprendre`, `--minuteur-annuler`.

## Démarrage automatique avec Windows

Option (désactivée par défaut). Quand elle est activée, Windows lance l'île à l'ouverture de
session (clé de registre `Run` de l'utilisateur, sans droits administrateur).

## Tests

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

```bash
tools\.venv\Scripts\python -m pytest tools/tests
```

Le test Python génère des **vidéos synthétiques** (fausse île animée par un ressort connu) et
vérifie que l'outil retrouve les paramètres à **moins de 2 %** près.

## Outils de mesure

```bash
python tools/analyze_screenshot.py tools/input/C1_repos.png
```

```bash
python tools/analyze_video.py tools/input/V2_lancement_musique.mov
```

```bash
python tools/analyze_video.py --compare tools/input/V3_etendre_fermer.mov notre_V3.mp4 --echelle-b 1.5
```

Résultats dans `tools/output/<nom>/` : CSV image par image, JSON (ressort au format Framer Motion
**et** Apple, délais du contenu), graphiques PNG.

## 📹 Vidéos et captures à fournir (enregistrées sur Mac)

Simulateur Xcode, **iPhone 15 Pro ou plus récent** (préciser le modèle exact). Mode sombre et
mode clair si possible. Mettre les fichiers dans `tools/input/` (ignoré par git).

```bash
xcrun simctl io booted recordVideo --codec=h264 V1_repos.mov
```

```bash
xcrun simctl io booted screenshot C1_repos.png
```

| Fichier | Contenu |
|---|---|
| `C1_repos.png` | Île au repos (capture) |
| `C2_compact_musique.png` | Musique en cours, île compacte |
| `C3_etendu_musique.png` | Musique, île étendue (appui long) |
| `C4_split.png` | Deux activités (ex. : minuteur + musique) |
| `V1_repos.mov` | Île au repos, 3 secondes |
| `V2_lancement_musique.mov` | Repos → compact quand la musique démarre |
| `V3_etendre_fermer.mov` | Appui long → étendu → clic à l'extérieur → compact (3 fois) |
| `V4_split.mov` | Minuteur lancé pendant la musique → apparition de la bulle, puis disparition |
| `V5_appui_court.mov` | Clics courts sur l'île (effet de compression), 3 fois |
| `V6_changement_piste.mov` | Changement de chanson en mode compact |
| `V7_fin_activite.mov` | Arrêt de la musique / fin du minuteur → retour au repos |

Conseil : utiliser un **fond d'écran clair** derrière l'île (la détection cherche une forme noire).
