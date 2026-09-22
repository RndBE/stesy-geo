// Skema data inti — PRD Bagian 12. SQLite dipakai untuk pengembangan lokal;
// kolom dan relasi disusun agar bisa dipindah ke PostgreSQL + PostGIS + TimescaleDB.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.STESYGEO_DB ?? path.join(here, '..', 'data', 'stesygeo.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, type TEXT NOT NULL DEFAULT 'jalan',
  crs_epsg INTEGER NOT NULL, vertical_datum TEXT, timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  tz_label TEXT NOT NULL DEFAULT 'WIB', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alignment (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id), name TEXT NOT NULL,
  sta_geometry TEXT NOT NULL,     -- JSON [{sta, x, y}]
  design_profile TEXT NOT NULL    -- JSON [{sta, elev}] elevasi rencana
);
CREATE TABLE IF NOT EXISTS zone (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id), code TEXT NOT NULL,
  name TEXT, sta_start REAL NOT NULL, sta_end REAL NOT NULL, polygon TEXT,
  is_transition INTEGER NOT NULL DEFAULT 0,
  design_fill_height REAL NOT NULL, surcharge_height REAL NOT NULL DEFAULT 0,
  ground_elev REAL NOT NULL DEFAULT 1.0, crest_width REAL NOT NULL DEFAULT 24, slope_h REAL NOT NULL DEFAULT 2,
  cv REAL, ch REAL, hdr REAL, residual_limit_mm REAL NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS soil_layer (
  id INTEGER PRIMARY KEY, zone_id INTEGER NOT NULL REFERENCES zone(id), name TEXT NOT NULL,
  top_depth REAL NOT NULL, bottom_depth REAL NOT NULL, gamma REAL, cv REAL, ch REAL, cc REAL, cr REAL,
  e0 REAL, ocr REAL, kh_ks REAL, cu REAL, compressible INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pvd_spec (
  zone_id INTEGER PRIMARY KEY REFERENCES zone(id), pattern TEXT NOT NULL, spacing REAL NOT NULL,
  length REAL NOT NULL, a REAL NOT NULL, b REAL NOT NULL, s REAL NOT NULL DEFAULT 2, kh_ks REAL NOT NULL DEFAULT 2
);
CREATE TABLE IF NOT EXISTS fill_stage (
  id INTEGER PRIMARY KEY, zone_id INTEGER NOT NULL REFERENCES zone(id), stage_no INTEGER NOT NULL,
  label TEXT, planned_start INTEGER, planned_end INTEGER, actual_start INTEGER, actual_end INTEGER,
  thickness REAL NOT NULL, is_surcharge INTEGER NOT NULL DEFAULT 0, removed_at INTEGER
);
CREATE TABLE IF NOT EXISTS instrument (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, zone_id INTEGER REFERENCES zone(id),
  code TEXT NOT NULL UNIQUE, type TEXT NOT NULL, section_sta REAL, sta REAL, offset REAL,
  x REAL, y REAL, z REAL, tip_depth REAL, installed_at INTEGER, zero_reading REAL,
  unit TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'telemetry', status TEXT NOT NULL DEFAULT 'aktif',
  meta TEXT, expected_interval_min INTEGER NOT NULL DEFAULT 60
);
-- Pembacaan skalar. Untuk instrumen profil (IPI/SAAV/SAAX) nilai skalar = ringkasan (maks/tengah),
-- detail per node di reading_profile.
CREATE TABLE IF NOT EXISTS reading (
  id INTEGER PRIMARY KEY, instrument_id INTEGER NOT NULL REFERENCES instrument(id), ts INTEGER NOT NULL,
  raw_value REAL, raw_temp REAL, value REAL NOT NULL, source TEXT NOT NULL, calib_id INTEGER,
  flag TEXT, note TEXT, entered_by INTEGER, received_at INTEGER NOT NULL,
  UNIQUE(instrument_id, ts, source)
);
CREATE INDEX IF NOT EXISTS reading_inst_ts ON reading(instrument_id, ts);
CREATE TABLE IF NOT EXISTS reading_profile (
  instrument_id INTEGER NOT NULL, ts INTEGER NOT NULL, pos REAL NOT NULL, value REAL NOT NULL,
  PRIMARY KEY(instrument_id, ts, pos)
);
CREATE TABLE IF NOT EXISTS gateway (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, vendor TEXT, model TEXT,
  serial TEXT, x REAL, y REAL, sta REAL, power_type TEXT, token_hash TEXT NOT NULL, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS logger (
  id INTEGER PRIMARY KEY, gateway_id INTEGER REFERENCES gateway(id), code TEXT NOT NULL UNIQUE,
  vendor TEXT, model TEXT, serial TEXT NOT NULL UNIQUE, firmware TEXT, sta REAL, offset REAL,
  channels INTEGER NOT NULL DEFAULT 8, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS logger_channel (
  id INTEGER PRIMARY KEY, logger_id INTEGER NOT NULL REFERENCES logger(id), channel_no INTEGER NOT NULL,
  instrument_id INTEGER NOT NULL REFERENCES instrument(id), valid_from INTEGER NOT NULL, valid_to INTEGER
);
CREATE TABLE IF NOT EXISTS device_health (
  device_type TEXT NOT NULL, device_id INTEGER NOT NULL, ts INTEGER NOT NULL,
  battery_v REAL, battery_pct REAL, rssi REAL, snr REAL, internal_temp REAL,
  PRIMARY KEY(device_type, device_id, ts)
);
CREATE TABLE IF NOT EXISTS calibration (
  id INTEGER PRIMARY KEY, instrument_id INTEGER NOT NULL REFERENCES instrument(id), valid_from INTEGER NOT NULL,
  coeffs_json TEXT NOT NULL, certificate_file TEXT, next_due INTEGER
);
CREATE TABLE IF NOT EXISTS reference_check (
  id INTEGER PRIMARY KEY, target TEXT NOT NULL, ts INTEGER NOT NULL, elevation REAL NOT NULL,
  delta_mm REAL NOT NULL DEFAULT 0, method TEXT, by_user INTEGER
);
CREATE TABLE IF NOT EXISTS maintenance_log (
  id INTEGER PRIMARY KEY, device_type TEXT NOT NULL, device_id INTEGER NOT NULL, ts INTEGER NOT NULL,
  action TEXT NOT NULL, note TEXT, by_user INTEGER
);
CREATE TABLE IF NOT EXISTS analysis_run (
  id INTEGER PRIMARY KEY, instrument_id INTEGER, zone_id INTEGER, method TEXT NOT NULL,
  params_json TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, algo_version TEXT NOT NULL,
  note TEXT, created_by INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alarm_rule (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, zone_id INTEGER, parameter TEXT NOT NULL,
  kind TEXT NOT NULL, level TEXT NOT NULL, threshold REAL NOT NULL, window_h REAL NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alarm_event (
  id INTEGER PRIMARY KEY, rule_id INTEGER, category TEXT NOT NULL DEFAULT 'geoteknik',
  parameter TEXT NOT NULL, instrument_id INTEGER, device_type TEXT, device_id INTEGER, zone_id INTEGER,
  ts INTEGER NOT NULL, value REAL, threshold REAL, level TEXT NOT NULL, message TEXT,
  ack_by INTEGER, ack_note TEXT, ack_at INTEGER, cleared_at INTEGER
);
CREATE INDEX IF NOT EXISTS alarm_open ON alarm_event(cleared_at, ack_at);
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_member (
  project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
  before_json TEXT, after_json TEXT, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendation (
  id INTEGER PRIMARY KEY, zone_id INTEGER NOT NULL, decision TEXT NOT NULL, text TEXT NOT NULL,
  analysis_run_ids TEXT, created_by INTEGER, created_at INTEGER NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(file = DB_PATH): Database.Database {
  if (db) return db;
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function resetDb(file = DB_PATH): Database.Database {
  if (db) { db.close(); db = null; }
  const d = getDb(file);
  const tables = d.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  d.pragma('foreign_keys = OFF');
  for (const t of tables) d.exec(`DROP TABLE IF EXISTS ${t.name}`);
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  return d;
}

export function audit(userId: number | null, entity: string, entityId: number | null, action: string, before: unknown, after: unknown) {
  getDb().prepare(`INSERT INTO audit_log(user_id, entity, entity_id, action, before_json, after_json, ts) VALUES (?,?,?,?,?,?,?)`)
    .run(userId, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), Date.now());
}
