#!/usr/bin/env node
/**
 * Timup idle & lock watcher — macOS only (US-4 detection side).
 *
 * ⚠️ NOT TESTED on the Linux build environment. It shells out to macOS-only
 * tools (`ioreg`). Runs on the Mac alongside the brain as its own launchd agent
 * (see com.timup.idle-watcher.plist).
 *
 * Behaviour:
 *   - HID idle > IDLE_THRESHOLD seconds while a timer runs  -> POST /timer/pause
 *     (idle time is then excluded from the segment sum, i.e. "continue removing idle")
 *   - screen locked while a timer runs                      -> POST /timer/stop
 *   - activity resumes while paused-by-idle                 -> native 3-choice
 *     prompt (keep / remove / stop the away time); defaults to "remove".
 *
 * Config: reads the brain port/token from <dataDir>/config.json
 * (TIMUP_DATA_DIR, default ~/Library/Application Support/Timup).
 */
import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const IDLE_THRESHOLD = Number(process.env.TIMUP_IDLE_SECONDS ?? 300); // 5 min
const POLL_MS = Number(process.env.TIMUP_POLL_MS ?? 15_000);
const PORT = process.env.TIMUP_PORT ?? "47823";
// On returning from idle, ask what to do with the away time (macOS dialog).
// Set TIMUP_IDLE_PROMPT=0 to keep the old silent "remove idle" behaviour.
const PROMPT_ON_RETURN = process.env.TIMUP_IDLE_PROMPT !== "0";
// Below this many seconds of idle we consider the user "back" at the keyboard.
const RETURN_IDLE_MAX = 5;

function dataDir() {
  return (
    process.env.TIMUP_DATA_DIR ?? join(homedir(), "Library", "Application Support", "Timup")
  );
}
function token() {
  return JSON.parse(readFileSync(join(dataDir(), "config.json"), "utf8")).token;
}

/** Quote a JS string as an AppleScript string literal. */
function asAppleStr(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Ask (native macOS dialog) what to do with the away time on return from idle.
 * Returns "keep" | "remove" | "stop". Defaults to "remove" if the dialog is
 * dismissed or unavailable (no GUI session).
 */
function promptIdle(awayMinutes) {
  const msg =
    `Tu étais inactif ~${awayMinutes} min pendant que le timer Timup tournait. ` +
    `Que faire de ce temps inactif ?`;
  const script =
    `display dialog ${asAppleStr(msg)} with title "Timup" with icon caution ` +
    `buttons {"Arrêter le timer", "Retirer l'inactif", "Garder l'inactif"} ` +
    `default button "Retirer l'inactif"`;
  try {
    const out = execFileSync("osascript", ["-e", script], { encoding: "utf8" });
    if (out.includes("Garder")) return "keep";
    if (out.includes("Arrêter")) return "stop";
    return "remove";
  } catch {
    return "remove"; // dismissed / no GUI -> safe default
  }
}

/** HID idle time in seconds (time since last keyboard/mouse event). */
function hidIdleSeconds() {
  const out = execSync("ioreg -c IOHIDSystem | grep HIDIdleTime | head -1").toString();
  const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return m ? Number(m[1]) / 1_000_000_000 : 0; // nanoseconds -> seconds
}

/** Whether the screen is currently locked. */
function screenLocked() {
  try {
    const out = execSync("ioreg -n Root -d1 -a 2>/dev/null").toString();
    return /CGSSessionScreenIsLocked.*true/s.test(out) || out.includes("<key>CGSSessionScreenIsLocked</key><true");
  } catch {
    return false;
  }
}

/**
 * Pure decision function — the heart of the watcher, kept side-effect-free so it
 * can be unit-tested deterministically (see idle-watcher.test.mjs). Given the
 * current timer + environment readings, it returns the single action to take:
 *
 *   "none"   — do nothing this tick
 *   "stop"   — screen is locked while a timer runs -> stop & write the entry
 *   "pause"  — idle past the threshold while running & active -> pause
 *   "return" — the user is back after an idle-pause -> resolve the away time
 *
 * @param {object} s
 * @param {boolean} s.running        timer is running
 * @param {boolean} s.paused         timer is currently paused
 * @param {boolean} s.pausedByIdle   the watcher is the one who paused it
 * @param {boolean} s.locked         screen is locked
 * @param {number}  s.idleSeconds    HID idle seconds
 * @param {number}  s.idleThreshold  seconds of idle before we pause
 * @param {number} [s.returnIdleMax] idle below which the user counts as "back"
 */
export function decideAction({
  running,
  paused,
  pausedByIdle,
  locked,
  idleSeconds,
  idleThreshold,
  returnIdleMax = RETURN_IDLE_MAX,
}) {
  if (!running) return "none";
  if (locked) return "stop";
  if (!paused && idleSeconds >= idleThreshold) return "pause";
  if (paused && pausedByIdle && idleSeconds < returnIdleMax) return "return";
  return "none";
}

// ---- Runtime (real macOS side-effects) ----

function makeApi(base, tok) {
  return async function api(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.json();
  };
}

function startWatching() {
  const base = `http://127.0.0.1:${PORT}`;
  const api = makeApi(base, token());

  let pausedByIdle = false;
  let idleStartMs = null; // approx instant the user went idle (for the away duration)

  async function tick() {
    let state;
    try {
      state = await api("GET", "/timer");
    } catch {
      return; // brain not up yet
    }
    if (!state.running) {
      pausedByIdle = false;
      idleStartMs = null;
      return;
    }

    const locked = screenLocked();
    const idle = locked ? 0 : hidIdleSeconds();
    const action = decideAction({
      running: state.running,
      paused: state.paused,
      pausedByIdle,
      locked,
      idleSeconds: idle,
      idleThreshold: IDLE_THRESHOLD,
    });

    if (action === "stop") {
      await api("POST", "/timer/stop").catch(() => {});
      console.error("[idle-watcher] screen locked -> timer stopped");
      pausedByIdle = false;
      idleStartMs = null;
    } else if (action === "pause") {
      idleStartMs = Date.now() - Math.round(idle * 1000); // ~ last activity instant
      await api("POST", "/timer/pause").catch(() => {});
      pausedByIdle = true;
      console.error(`[idle-watcher] idle ${Math.round(idle)}s -> paused`);
    } else if (action === "return") {
      // User is back. Ask what to do with the away time (or default to "remove").
      const awayMin = Math.max(1, Math.round((Date.now() - (idleStartMs ?? Date.now())) / 60_000));
      const decision = PROMPT_ON_RETURN ? promptIdle(awayMin) : "remove";
      if (decision === "stop") {
        await api("POST", "/timer/stop").catch(() => {});
        console.error("[idle-watcher] return -> timer stopped (idle discarded)");
      } else if (decision === "keep") {
        await api("POST", "/timer/resume", { keepIdle: true }).catch(() => {});
        console.error(`[idle-watcher] return -> resumed, kept ~${awayMin} min idle`);
      } else {
        await api("POST", "/timer/resume").catch(() => {});
        console.error(`[idle-watcher] return -> resumed, removed ~${awayMin} min idle`);
      }
      pausedByIdle = false;
      idleStartMs = null;
    }
  }

  console.error(`[idle-watcher] watching (threshold ${IDLE_THRESHOLD}s, poll ${POLL_MS}ms)`);
  setInterval(() => void tick(), POLL_MS);
}

// Only start the polling loop when run directly (`node idle-watcher.mjs`), so the
// pure helpers above can be imported by tests without side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startWatching();
}
