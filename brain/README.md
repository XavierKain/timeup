# Timup — brain

Service local **single-writer** qui possède la base SQLite de Timup et expose une API HTTP + un **dashboard web** sur `127.0.0.1`. C'est le « cerveau » de Timup : le CLI, le dashboard et (sur Mac) l'extension Raycast parlent tous à lui.

Couvre le backend complet : capture (timer), clients/projets, forfaits & temps restant, horaire, prix fixe & rentabilité, entrées, facturation, import Excel, export.

## Prérequis
- Node ≥ 22

## Installer & lancer
```bash
npm install
npm run brain      # service + dashboard sur http://127.0.0.1:47823
```
Ouvre **http://127.0.0.1:47823/** dans un navigateur pour le dashboard.

Config (env) : `TIMUP_DATA_DIR` (défaut `$XDG_DATA_HOME/timup`), `TIMUP_PORT` (47823), `TIMUP_TZ` (`Europe/Paris`), `TIMUP_BACKUP_DIR` (défaut `<dataDir>/backups`), `TIMUP_BACKUP_KEEP` (défaut 14). Token auto-généré dans `<dataDir>/config.json` (`0600`).

**Sauvegardes automatiques** : au démarrage puis chaque jour, le brain écrit un snapshot SQLite en ligne (`db.backup()`, sûr en WAL) dans `<dataDir>/backups/timup-YYYY-MM-DD.db`, en gardant les `TIMUP_BACKUP_KEEP` plus récents.

## Importer ton Excel
```bash
npm run cli -- import "/chemin/forfait temps passé.xlsx" --dry-run   # réconciliation sans écrire
npm run cli -- import "/chemin/forfait temps passé.xlsx"             # importe pour de vrai
```
La réconciliation compare le restant calculé au tableau « Temps restant » de l'Excel et liste les écarts (ex. cellules de durée saisies en texte qu'Excel ne sommait pas). Gère les noms de fichiers accentués macOS (NFD).

## CLI
```bash
npm run cli -- client add "Nom"
npm run cli -- project add --client 1 --name "Support" --mode horaire --rate 80
npm run cli -- start 1 | pause | resume | stop --description "…" --tag …
npm run cli -- status
npm run cli -- import <path> [--dry-run]
```

## Tests & typage
```bash
npm test          # Vitest : 86 tests (unit + intégration + persistance + import réel)
npm run typecheck
```

## API (loopback, `Authorization: Bearer <token>`, sauf `GET /` et `GET /health`)

| Domaine | Endpoints |
|---|---|
| Santé | `GET /health` |
| Dashboard | `GET /` (HTML, token injecté) |
| Timer | `GET /timer` · `POST /timer/{start,pause,resume,stop,discard,recover}` |
| Clients | `POST/GET /clients` · `GET/PATCH /clients/:id` |
| Projets | `POST/GET /projects` · `GET/PATCH /projects/:id` · `GET /projects/:id/stats` |
| Forfaits | `POST /recharges` · `GET /projects/:id/recharges` · `GET /summary/forfaits` |
| Rentabilité | `GET /summary/profitability` · `GET /summary/hourly` |
| Entrées | `POST/GET /entries` · `GET/PATCH/DELETE /entries/:id` |
| Facture | `GET /invoice/prep` · `POST /invoice/mark-billed` |
| Export | `GET /export/entries.csv` · `GET /export/data.json` (token aussi via `?token=`) |
| Import | `POST /import` `{ path, dryRun? }` |

## Garanties clés
- **Single-writer** : bind du port = mutex (2ᵉ brain → `EADDRINUSE` → sortie) + lockfile PID.
- **Un seul timer** : `timer_state` physiquement single-row (`CHECK(id=1)`).
- **Durée par segments** : `duration = Σ intervalles actifs`, `idle` dérivé, depuis timestamps UTC ; `CHECK(raw − idle = duration)`.
- **Stop idempotent** (`requestId`), transactions atomiques, `local_date` DST-safe (Luxon).
- **Write-path unique** (`services/entry.ts`) partagé par timer, ajout manuel et import.

## Couche macOS (séparée, à tester sur Mac)
Extension Raycast (`../raycast/`), launchd + watcher idle/lock (`../macos/`). Voir leurs READMEs.

Design : `../output/2026-06-17-feat-brain-timer-core/`.
