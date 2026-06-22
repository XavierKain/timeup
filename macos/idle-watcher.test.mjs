import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAction } from "./idle-watcher.mjs";

const THRESH = 300;
// Sensible defaults; each test overrides what it exercises.
const base = {
  running: true,
  paused: false,
  pausedByIdle: false,
  locked: false,
  idleSeconds: 0,
  idleThreshold: THRESH,
};

test("no timer running -> none (even if idle/locked)", () => {
  assert.equal(decideAction({ ...base, running: false, idleSeconds: 9999, locked: true }), "none");
});

test("running & active, idle below threshold -> none", () => {
  assert.equal(decideAction({ ...base, idleSeconds: THRESH - 1 }), "none");
});

test("running & active, idle at/over threshold -> pause", () => {
  assert.equal(decideAction({ ...base, idleSeconds: THRESH }), "pause");
  assert.equal(decideAction({ ...base, idleSeconds: THRESH + 120 }), "pause");
});

test("screen locked while running -> stop (wins over idle)", () => {
  assert.equal(decideAction({ ...base, locked: true, idleSeconds: THRESH + 999 }), "stop");
});

test("idle-paused, user back (idle < returnIdleMax) -> return", () => {
  assert.equal(decideAction({ ...base, paused: true, pausedByIdle: true, idleSeconds: 2 }), "return");
});

test("idle-paused, still away (idle high) -> none (stay paused)", () => {
  assert.equal(
    decideAction({ ...base, paused: true, pausedByIdle: true, idleSeconds: THRESH + 60 }),
    "none",
  );
});

test("manual pause (not pausedByIdle) -> never auto-resumed", () => {
  // User paused by hand and came back: the watcher must not fight that.
  assert.equal(decideAction({ ...base, paused: true, pausedByIdle: false, idleSeconds: 0 }), "none");
});

test("already active, not idle -> none", () => {
  assert.equal(decideAction({ ...base, idleSeconds: 0 }), "none");
});

test("returnIdleMax boundary is exclusive", () => {
  const s = { ...base, paused: true, pausedByIdle: true, returnIdleMax: 5 };
  assert.equal(decideAction({ ...s, idleSeconds: 4 }), "return");
  assert.equal(decideAction({ ...s, idleSeconds: 5 }), "none");
});
