# TimeUp

**Local-first time tracking for freelancers — right in your macOS menu bar.**

TimeUp lets independent consultants start, pause and bill their projects without ever leaving their Mac. No account, no server, no tracking: everything lives locally in a SQLite database you control.

🌐 **[timeup.xavierkain.fr](https://timeup.xavierkain.fr)**

## Features

- **Native menu-bar app** — start / stop / pause a timer in one click or a global hotkey.
- **Forfaits & hours** — track time consumed per retainer, with the remaining balance live.
- **Profitability** — effective hourly rate per project, fixed-price vs. time actually spent.
- **100% local & private** — clients and billing stay on your Mac (SQLite). No cloud.
- **Idle detection** — auto-pause when you step away; choose what to do with the away time on return.
- **Billing** — entries grouped by day & project, computed price, CSV export.

## Architecture

| Folder | What |
|--------|------|
| `brain/` | The backend — Node/TypeScript + Fastify + SQLite. Time logic, billing, profitability, and a self-contained web dashboard. |
| `app/` | The native macOS menu-bar app — SwiftUI/AppKit, zero external dependencies (Swift Package Manager). |
| `macos/` | launchd agents (keep the brain alive at login). |
| `landing/` | The presentation website (static, dark, responsive). |
| `raycast/` | Legacy Raycast extension (superseded by the native app, kept for reference). |

## Build & run

**Brain (backend + dashboard):**
```sh
cd brain
npm install
npm run brain        # serves the API + dashboard on http://127.0.0.1:47823
npm test             # vitest
```

**Native macOS app:**
```sh
cd app
swift test                    # unit tests (TimupCore)
bash scripts/build-app.sh     # -> dist/Timup.app (code-signed)
open dist/Timup.app
```

## Notes

This is a personal project, tailored to one freelancer's workflow. It is shared as-is, for reference and as a portfolio piece — not distributed as a notarized product. The macOS app is signed with a development certificate; to run a downloaded build, right-click the app → **Open**.

Made by [Xavier Kain](https://xavierkain.fr).
