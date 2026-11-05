# Instructions du projet (cahier des charges)

Document de référence fourni par le propriétaire. Résumé des règles absolues :

1. **Phase 1 = AUCUN visuel.** Fenêtre 100 % transparente et vide.
2. **Aucune valeur visuelle codée en dur.** Tout est dans `src/island.config.ts` (phase 1 : `null`).
3. **Les valeurs viennent des mesures** (vidéos/captures du Simulateur), sources notées dans `docs/mesures.md`.
4. **Fin de la phase 1 : STOP** et demande des vidéos.
5. **Police : Inter.** Pas de SF Pro, aucune icône ni asset Apple.

Ajouts demandés pendant la phase 1 :
- **Démarrage automatique avec Windows** (à l'ouverture de session, comme Windhawk) — option.
- **Minuteur** : piloté par notre app (Windows ne permet pas de lire les minuteurs de l'app Horloge).

Stack : Tauri 2 (Rust) · React + TypeScript + Vite · Framer Motion · Python 3 + OpenCV + NumPy + SciPy + Matplotlib.

Phases :
- **Phase 0** — préparation (outils, git, projet Tauri, venv Python).
- **Phase 1** — tout l'invisible : fenêtre, média, système, machine à états, contrat de config, outils d'analyse.
- **Phase 2** — le visuel, à partir des mesures : rendu squircle, ressorts mesurés, effet goutte,
  panneau de réglages (Ctrl+Alt+D), validation de fidélité (`--compare`, écart < 3 %, ±1 image),
  finition (CPU ≈ 0 %, icône de notification, installateur).

Vidéos/captures attendues : voir le README (section « Vidéos et captures à fournir »).
