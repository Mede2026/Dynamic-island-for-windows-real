# Limites connues (Windows)

## Notifications (`UserNotificationListener`)
- **Implémenté**, mais l'API exige que l'app ait une **identité de package** (installation **MSIX**)
  et la capacité `userNotificationListener` déclarée dans le manifeste.
- Une app Tauri installée en `.exe` / `.msi` classique **n'a pas** cette identité : Windows refuse
  l'accès. L'état est visible avec la commande `notifications_etat` (champ `raison`).
- Même avec l'accès, l'événement `NotificationChanged` ne fonctionne que pour les apps packagées :
  on relit donc la liste toutes les 2 s.
- Le réglage Windows **« Autoriser les applications à accéder à vos notifications »** (Paramètres →
  Confidentialité et sécurité → Notifications) doit être activé — c'est aussi ce qu'exige le mod Windhawk
  « Dynamic Island for Windows », qui utilise la même API.
- **Piste pour plus tard** : empaqueter l'app en MSIX (ou « sparse package ») pour obtenir l'identité.

## « Ne pas déranger » / Focus
- Windows **n'a pas d'API publique** pour l'état « Ne pas déranger ». On lit :
  1. le registre `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings`,
     valeur `NOC_GLOBAL_SETTING_TOASTS_ENABLED` (0 = notifications coupées). **Non documenté** par
     Microsoft : peut changer avec une mise à jour de Windows ;
  2. `Windows.UI.Shell.FocusSessionManager` : sessions de concentration (Windows 11 22H2+).
- L'« Assistant de concentration » de Windows 10 (règles automatiques) n'est pas détecté.

## Minuteurs de l'app Horloge
- Windows **ne permet pas** de lire les minuteurs de l'app Horloge (aucune API).
  `FocusSessionManager` dit seulement si une session de concentration est active (oui/non), sans le temps restant.
- C'est pourquoi l'île a son **propre minuteur** (commandes `minuteur_*`, ou en ligne de commande :
  `dynamic-island.exe --minuteur 5m`).

## Caméra / micro (points vert et orange)
- Windows n'a pas d'événement public « caméra utilisée ». On lit le registre
  `HKCU\...\CapabilityAccessManager\ConsentStore\{webcam,microphone}` (le même que celui qui alimente
  l'icône de confidentialité de la barre des tâches), en attendant ses changements (aucune scrutation).
- Seules les apps de l'utilisateur courant sont vues (pas les services système).
- Règle iOS appliquée : **orange = micro seul**, **vert = caméra (avec ou sans micro)** — jamais les deux.

## Presse-papiers
- On lit le compteur `GetClipboardSequenceNumber` toutes les 400 ms (un nombre ; coût négligeable) et le
  contenu seulement s'il a changé. Les gestionnaires de mots de passe qui copient puis effacent
  déclenchent aussi l'alerte (seul un aperçu de 60 caractères est affiché).

## Ouvrir l'application source (clic court)
- App packagée (identifiant avec « ! ») : activation par Windows. Sinon (Spotify.exe, chrome…) : on
  cherche sa fenêtre et on la met au premier plan. Windows peut refuser le premier plan à une app
  d'arrière-plan : un appui sur Alt est simulé pour l'autoriser.

## Fenêtre
- Clics traversants : un fil vérifie la position du curseur toutes les 16 ms (coût négligeable) et
  rend la fenêtre cliquable uniquement au-dessus des zones touchables envoyées par le front-end.
- Le clic **à l'extérieur** de l'île est détecté avec `GetAsyncKeyState` (seulement en mode étendu).
- Ne pas voler le focus : `WS_EX_NOACTIVATE` + réponse `MA_NOACTIVATE` à `WM_MOUSEACTIVATE`.
  **À vérifier sur Windows** avec WebView2 : si un clic sur l'île active quand même la fenêtre, il faudra
  aussi intercepter le focus côté WebView2.
- Plein écran : `SHQueryUserNotificationState` (jeux Direct3D, présentations) + « la fenêtre active
  couvre tout son écran ». Une fenêtre sans bordure maximisée (pas vraiment plein écran) peut être
  prise pour du plein écran.
- Le taux de rafraîchissement vient de `EnumDisplaySettingsW` (mode actuel de l'écran). Avec un écran
  à fréquence variable (VRR / G-Sync / FreeSync), c'est la fréquence **maximale**.

## Démarrage automatique
- L'île démarre à **l'ouverture de session** Windows (clé `HKCU\...\Run`), pas avant : une fenêtre
  ne peut pas s'afficher avant qu'un utilisateur soit connecté.
- Activer l'option depuis la version **installée** (sinon c'est le chemin de l'exécutable de
  développement qui est enregistré).

## Mesures et fidélité
- Les vidéos de référence sont des enregistrements d'écran d'un **vrai iPhone 16 Pro** (pas du Simulateur) :
  la résolution est réduite (664 × 1440) et le point rouge d'enregistrement est toujours présent.
  Les valeurs non visibles dans ces vidéos sont listées dans `docs/mesures.md` (section « estimées »).
- La validation (`docs/fidelite.md`) enregistre notre île dans Chromium (même moteur que WebView2) avec
  une horloge virtuelle. Un enregistrement de l'île sous Windows (Xbox Game Bar) peut être comparé avec
  `analyze_video.py --compare`.

## Installateur
- `npm run tauri build` doit être lancé **sous Windows** (il produit `.msi` et `.exe`). Le workflow GitHub
  `.github/workflows/windows.yml` le fait automatiquement sur une machine Windows de GitHub.

## Compilation hors Windows
- Le code propre à Windows est derrière `#[cfg(windows)]`. Sous Linux/macOS, l'app compile et se
  lance, mais média, batterie, volume, etc. répondent « non disponible ».
