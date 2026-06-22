# Timup — extension Raycast (à tester sur macOS)

> ⚠️ Cette extension n'a **pas pu être testée** sur l'environnement de build (Linux, sans Raycast). À valider sur ton Mac. Le code est écrit contre le contrat d'API du brain (les mêmes endpoints couverts par les tests du backend).

## Commandes
- **Démarrer un timer** (`start-timer`, view) : picker de projet → lance le timer.
- **Arrêter le timer** (`stop-timer`, no-view) : écrit l'entrée, HUD avec la durée. → assigne-lui un **hotkey global** dans Raycast (US-6).
- **Pause / Reprendre** (`toggle-pause`, no-view) : bascule l'état. → hotkey global.
- **Démarrer / arrêter le dernier timer** (`toggle-last-timer`, no-view) : un seul raccourci — arrête le timer en cours, sinon relance le dernier projet démarré. → hotkey global.
- **Réassigner le timer en cours** (`reassign-timer`, view) : picker de projet pour changer le client/projet du timer qui tourne (mauvais démarrage).
- **Ajouter du temps au timer** (`add-time`, view) : saisir un nombre de minutes précis à ajouter au timer en cours (recule le départ).
- **Décrire le timer en cours** (`set-description`, view) : saisir/dicter une description pour le timer en cours ; elle est écrite sur l'entrée à l'arrêt. Champ pré-rempli avec la description actuelle.
- **Timer (barre de menu)** (`timer-menu-bar`, menu-bar, refresh 30 s) : affiche `⏱ Client · 1h23`.
  - Timer en cours : un clic sur la ligne du projet (ou **📝 Ajouter une description…**) ouvre le champ description ; puis Pause / Arrêter / **Annuler (sans enregistrer)**, **Changer de projet** (sous-menu) et **Ajouter du temps** (sous-menu : +5/+10/+15/+30 min ou **Autre…** pour un temps précis).
  - Aucun timer : **Démarrer le dernier** (le dernier projet démarré), **Démarrer un projet** (sous-menu).
  - Toujours : Ouvrir le dashboard.

## Setup
1. `cd Timup/raycast && npm install`
2. Ajoute une icône `command-icon.png` (512×512) à la racine — **requis par Raycast** (non fournie ici).
3. `npm run dev` (ou `ray develop`) pour l'importer en extension locale.
4. Dans les **préférences de l'extension** : renseigne le **token** (`<dataDir>/config.json`, ex. `~/.local/share/timup/config.json` → sur Mac `~/Library/Application Support/Timup/config.json`) et le **port** si tu l'as changé (défaut `47823`).
5. Assigne des hotkeys globaux à *Arrêter* et *Pause/Reprendre* (Raycast → Extensions → Timup → Hotkey).

## Limite barre de menu
Raycast rafraîchit une commande menu-bar par intervalle (~30 s min) — l'affichage est donc à la **minute**, pas à la seconde (compromis acté en conception).
