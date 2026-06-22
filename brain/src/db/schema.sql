-- Timup brain — full schema (US-3 lays it all down; only US-3 behavior is coded).
-- Timestamps: INTEGER epoch milliseconds (UTC). Durations: INTEGER seconds.
-- local_date: TEXT 'YYYY-MM-DD'. tz: IANA identifier.

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  notes      TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  name            TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('forfait', 'horaire', 'prix_fixe')),
  hourly_rate     REAL,   -- US-9, schema only
  fixed_price     REAL,   -- US-10, schema only
  estimated_hours REAL,   -- US-10, schema only
  archived        INTEGER NOT NULL DEFAULT 0,
  completed       INTEGER NOT NULL DEFAULT 0,   -- project finished: kept in stats, hidden from timer pickers
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

-- US-8 (recharges), schema only for now.
CREATE TABLE IF NOT EXISTS recharges (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  date       TEXT NOT NULL,
  hours      REAL NOT NULL,
  price      REAL,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recharges_project ON recharges(project_id);

CREATE TABLE IF NOT EXISTS entries (
  id               INTEGER PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  started_at       INTEGER NOT NULL,                 -- ms UTC (raw span start)
  ended_at         INTEGER NOT NULL,                 -- ms UTC (raw span end)
  raw_seconds      INTEGER NOT NULL,                 -- round((ended_at - started_at)/1000)
  idle_seconds     INTEGER NOT NULL DEFAULT 0,       -- derived = raw - duration
  duration_seconds INTEGER NOT NULL,                 -- sum of active segments
  tz               TEXT NOT NULL,                    -- e.g. 'Europe/Paris'
  local_date       TEXT NOT NULL,                    -- derived/cached, start day in tz
  description      TEXT,
  tag              TEXT,
  billed           INTEGER NOT NULL DEFAULT 0,       -- US-16, schema only
  billed_at        INTEGER,                          -- US-16, schema only
  source           TEXT NOT NULL CHECK (source IN ('timer', 'manual')),
  stop_request_id  TEXT UNIQUE,                      -- idempotent stop (NULL allowed/repeatable)
  deleted_at       INTEGER,                          -- soft-delete: ms UTC when trashed, NULL = live
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (duration_seconds >= 0 AND idle_seconds >= 0),
  CHECK (raw_seconds - idle_seconds = duration_seconds)
);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
CREATE INDEX IF NOT EXISTS idx_entries_local_date ON entries(local_date);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);

CREATE TABLE IF NOT EXISTS entry_segments (
  id       INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at   INTEGER NOT NULL,
  CHECK (end_at >= start_at)
);
CREATE INDEX IF NOT EXISTS idx_entry_segments_entry ON entry_segments(entry_id);

-- At most ONE running timer, enforced physically by CHECK(id = 1).
CREATE TABLE IF NOT EXISTS timer_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  started_at  INTEGER NOT NULL,
  tz          TEXT NOT NULL,
  description TEXT,                 -- live description, written onto the entry at stop
  created_at  INTEGER NOT NULL
);

-- Segments of the currently-running timer. end_at NULL = open (active) segment.
CREATE TABLE IF NOT EXISTS live_segments (
  id       INTEGER PRIMARY KEY,
  start_at INTEGER NOT NULL,
  end_at   INTEGER
);

-- Append-only action log (substrate for US-5 crash recovery + audit trail).
CREATE TABLE IF NOT EXISTS timer_events (
  id         INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('start', 'pause', 'resume', 'stop')),
  project_id INTEGER,
  payload    TEXT
);
CREATE INDEX IF NOT EXISTS idx_timer_events_ts ON timer_events(ts);
