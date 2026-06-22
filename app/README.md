# Timup — application macOS native (`app/`)

Application menu-bar native (SwiftUI/AppKit, **zéro dépendance externe**) qui remplace l'extension Raycast. Le **brain** reste le backend (`http://127.0.0.1:47823`, token lu depuis `~/Library/Application Support/Timup/config.json`).

## Fonctionnalités (parité Raycast)

- **Barre de menu** : `⏱ Client · 1h23` quand un timer tourne, icône seule sinon.
  - Timer en cours : description (clic, saisie/dictée) · restant forfait · Pause/Reprendre · Arrêter · Annuler · **Changer de projet** · **Ajouter du temps** (+5/10/15/30, Autre…).
  - À l'arrêt : **Démarrer le dernier** · **Démarrer un projet**.
  - Toujours : Ouvrir le dashboard · Réglages… · Quitter.
- **Inactivité intégrée** (remplace `macos/idle-watcher.mjs`) : pause après N min d'inactivité (HID), arrêt sur verrouillage d'écran, pop-up natif 3 choix au retour (garder/retirer/arrêter).
- **Raccourci global** : démarrer/arrêter le dernier timer (configurable).
- **Réglages** : lancement au login, seuil d'inactivité, pop-up on/off, enregistreur de raccourci, indicateur de connexion au brain.

## Structure

- `Sources/TimupCore/` — logique pure, testée (modèles, `BrainClient`, `IdleDecider`, formatage, config, préférences).
- `Sources/TimupApp/` — l'agent menu-bar (AppKit/SwiftUI).
- `Sources/TimupSmoke/` — test fonctionnel bout-en-bout contre le vrai brain.
- `Tests/TimupCoreTests/` — tests unitaires.

## Développer / tester

```sh
swift test                 # tests unitaires du cœur
swift run TimupSmoke       # test fonctionnel contre le brain (timer jetable, puis discard)
swift build                # compilation debug
```

## Construire l'app signée

```sh
bash scripts/build-app.sh  # -> dist/Timup.app (signée Apple Development)
open dist/Timup.app        # lance l'agent (icône dans la barre de menu)
```

`build-app.sh` compile en release, assemble le bundle (`LSUIElement`, pas d'icône Dock, bundle id `com.timup.app`) et le signe avec la première identité *Apple Development* trouvée (sinon ad-hoc).

## Lancement au démarrage

Active « Lancer Timup à l'ouverture de session » dans **Réglages** (utilise `SMAppService`). L'ancien agent launchd `com.timup.idle-watcher` est **remplacé** par la détection intégrée — il a été retiré au runtime (plist archivé dans `~/Library/LaunchAgents/_timup-retired/`).
