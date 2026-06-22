# Timup — couche macOS (à tester sur ton Mac)

> ⚠️ Ces éléments n'ont **pas été testés** sur l'environnement de build (Linux). Ils utilisent des outils/services propres à macOS (`launchd`, `ioreg`).

## 1. `com.timup.brain.plist` — lancer le brain au login (US-1/2/6 dépendent d'un brain toujours vivant)

```sh
# Remplace __HOME__ par le chemin de ton home, et vérifie le chemin du dossier brain dans ProgramArguments
sed "s|__HOME__|$HOME|g" com.timup.brain.plist > ~/Library/LaunchAgents/com.timup.brain.plist
launchctl load ~/Library/LaunchAgents/com.timup.brain.plist
# logs : ~/Library/Logs/timup-brain.{out,err}.log
```

Le brain écoute alors sur `http://127.0.0.1:47823` et la base vit dans `~/Library/Application Support/Timup/`.

## 2. `idle-watcher.mjs` — détection d'inactivité & verrouillage (US-4)

Comportement :
- inactivité > 5 min (configurable `TIMUP_IDLE_SECONDS`) → **pause** (le temps inactif cesse d'être compté) ;
- écran verrouillé → **arrêt** du timer ;
- **reprise d'activité → pop-up 3 choix** (dialogue macOS natif) :
  - **Garder l'inactif** — le temps d'absence est recompté (le segment est rouvert) ;
  - **Retirer l'inactif** (défaut) — l'absence reste exclue ;
  - **Arrêter le timer** — l'entrée est écrite, l'absence exclue.

> ⚠️ **C'est un process à part qui doit tourner en permanence.** Le brain seul ne détecte rien : sans ce watcher lancé, aucune inactivité n'est jamais détectée. Installe-le comme agent launchd dédié (recommandé), comme le brain :

```sh
sed "s|__HOME__|$HOME|g" com.timup.idle-watcher.plist > ~/Library/LaunchAgents/com.timup.idle-watcher.plist
launchctl load ~/Library/LaunchAgents/com.timup.idle-watcher.plist
# logs : ~/Library/Logs/timup-idle-watcher.{out,err}.log
# vérifier qu'il tourne : launchctl list | grep idle-watcher
```

Lancement manuel ponctuel (debug) :

```sh
TIMUP_DATA_DIR="$HOME/Library/Application Support/Timup" node idle-watcher.mjs
```

Variables d'env : `TIMUP_IDLE_SECONDS` (seuil, défaut 300), `TIMUP_POLL_MS` (intervalle de sonde, défaut 15000), `TIMUP_IDLE_PROMPT=0` pour désactiver le pop-up et garder le comportement silencieux (« retirer l'inactif »).

Logique de décision testée : `node --test` dans ce dossier (`idle-watcher.test.mjs`).

## 3. Extension Raycast
Voir `../raycast/README.md` (picker de démarrage, arrêt/pause en hotkey, timer en barre de menu).
