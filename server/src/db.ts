// Skema data inti — PRD Bagian 12. MySQL (via mysql2) dipakai untuk pengembangan lokal;
// skema mengikuti PRD 12, siap dipindah ke PostgreSQL + PostGIS + TimescaleDB.
//
// Kolom `offset` wajib di-backtick: MariaDB menjadikannya kata terpesan sejak 10.6,
// sementara MySQL 8 tidak — tanpa backtick, skema ini lolos di MySQL lalu gagal
// dengan ER_PARSE_ERROR di MariaDB.
import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';

const txStorage = new AsyncLocalStorage<mysql.PoolConnection>();

const SCHEMA_STATEMENTS = `
CREATE TABLE IF NOT EXISTS project (
  id INT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL, code TEXT, type VARCHAR(32) NOT NULL DEFAULT 'jalan',
  crs_epsg INTEGER NOT NULL, vertical_datum TEXT, timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
  tz_label VARCHAR(16) NOT NULL DEFAULT 'WIB', created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS alignment (
  id INT PRIMARY KEY AUTO_INCREMENT, project_id INTEGER NOT NULL REFERENCES project(id), name TEXT NOT NULL,
  sta_geometry TEXT NOT NULL,     -- JSON [{sta, x, y}]
  design_profile TEXT NOT NULL    -- JSON [{sta, elev}] elevasi rencana
);
CREATE TABLE IF NOT EXISTS zone (
  id INT PRIMARY KEY AUTO_INCREMENT, project_id INTEGER NOT NULL REFERENCES project(id), code TEXT NOT NULL,
  name TEXT, sta_start REAL NOT NULL, sta_end REAL NOT NULL, polygon TEXT,
  is_transition INTEGER NOT NULL DEFAULT 0,
  design_fill_height REAL NOT NULL, surcharge_height REAL NOT NULL DEFAULT 0,
  ground_elev REAL NOT NULL DEFAULT 1.0, crest_width REAL NOT NULL DEFAULT 24, slope_h REAL NOT NULL DEFAULT 2,
  cv REAL, ch REAL, hdr REAL, residual_limit_mm REAL NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS soil_layer (
  id INT PRIMARY KEY AUTO_INCREMENT, zone_id INTEGER NOT NULL REFERENCES zone(id), name TEXT NOT NULL,
  top_depth REAL NOT NULL, bottom_depth REAL NOT NULL, gamma REAL, cv REAL, ch REAL, cc REAL, cr REAL,
  e0 REAL, ocr REAL, kh_ks REAL, cu REAL, compressible INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pvd_spec (
  zone_id INT PRIMARY KEY REFERENCES zone(id), pattern TEXT NOT NULL, spacing REAL NOT NULL,
  length REAL NOT NULL, a REAL NOT NULL, b REAL NOT NULL, s REAL NOT NULL DEFAULT 2, kh_ks REAL NOT NULL DEFAULT 2
);
CREATE TABLE IF NOT EXISTS fill_stage (
  id INT PRIMARY KEY AUTO_INCREMENT, zone_id INTEGER NOT NULL REFERENCES zone(id), stage_no INTEGER NOT NULL,
  label TEXT, planned_start BIGINT, planned_end BIGINT, actual_start BIGINT, actual_end BIGINT,
  thickness REAL NOT NULL, is_surcharge INTEGER NOT NULL DEFAULT 0, removed_at BIGINT
);
CREATE TABLE IF NOT EXISTS instrument (
  id INT PRIMARY KEY AUTO_INCREMENT, project_id INTEGER NOT NULL, zone_id INTEGER REFERENCES zone(id),
  code VARCHAR(64) NOT NULL UNIQUE, type TEXT NOT NULL, section_sta REAL, sta REAL, \`offset\` REAL,
  x REAL, y REAL, z REAL, tip_depth REAL, installed_at BIGINT, zero_reading REAL,
  unit TEXT NOT NULL, mode VARCHAR(32) NOT NULL DEFAULT 'telemetry', status VARCHAR(32) NOT NULL DEFAULT 'aktif',
  meta TEXT, expected_interval_min INTEGER NOT NULL DEFAULT 60
);
-- Pembacaan skalar. Untuk instrumen profil (IPI/SAAV/SAAX) nilai skalar = ringkasan (maks/tengah),
-- detail per node di reading_profile.
CREATE TABLE IF NOT EXISTS reading (
  id INT PRIMARY KEY AUTO_INCREMENT, instrument_id INTEGER NOT NULL REFERENCES instrument(id), ts BIGINT NOT NULL,
  raw_value REAL, raw_temp REAL, value REAL NOT NULL, source VARCHAR(20) NOT NULL, calib_id INTEGER,
  flag TEXT, note TEXT, entered_by INTEGER, received_at BIGINT NOT NULL,
  UNIQUE(instrument_id, ts, source)
);
CREATE TABLE IF NOT EXISTS reading_profile (
  instrument_id INTEGER NOT NULL, ts BIGINT NOT NULL, pos REAL NOT NULL, value REAL NOT NULL,
  PRIMARY KEY(instrument_id, ts, pos)
);
CREATE TABLE IF NOT EXISTS gateway (
  id INT PRIMARY KEY AUTO_INCREMENT, project_id INTEGER NOT NULL, code VARCHAR(64) NOT NULL UNIQUE, vendor TEXT, model TEXT,
  serial TEXT, x REAL, y REAL, sta REAL, power_type TEXT, token_hash TEXT NOT NULL, last_seen BIGINT
);
CREATE TABLE IF NOT EXISTS logger (
  id INT PRIMARY KEY AUTO_INCREMENT, gateway_id INTEGER REFERENCES gateway(id), code VARCHAR(64) NOT NULL UNIQUE,
  vendor TEXT, model TEXT, serial VARCHAR(128) NOT NULL UNIQUE, firmware TEXT, sta REAL, \`offset\` REAL,
  channels INTEGER NOT NULL DEFAULT 8, last_seen BIGINT
);
CREATE TABLE IF NOT EXISTS logger_channel (
  id INT PRIMARY KEY AUTO_INCREMENT, logger_id INTEGER NOT NULL REFERENCES logger(id), channel_no INTEGER NOT NULL,
  instrument_id INTEGER NOT NULL REFERENCES instrument(id), valid_from BIGINT NOT NULL, valid_to BIGINT
);
CREATE TABLE IF NOT EXISTS device_health (
  device_type VARCHAR(16) NOT NULL, device_id INTEGER NOT NULL, ts BIGINT NOT NULL,
  battery_v REAL, battery_pct REAL, rssi REAL, snr REAL, internal_temp REAL,
  PRIMARY KEY(device_type, device_id, ts)
);
CREATE TABLE IF NOT EXISTS calibration (
  id INT PRIMARY KEY AUTO_INCREMENT, instrument_id INTEGER NOT NULL REFERENCES instrument(id), valid_from BIGINT NOT NULL,
  coeffs_json TEXT NOT NULL, certificate_file TEXT, next_due BIGINT
);
CREATE TABLE IF NOT EXISTS reference_check (
  id INT PRIMARY KEY AUTO_INCREMENT, target TEXT NOT NULL, ts BIGINT NOT NULL, elevation REAL NOT NULL,
  delta_mm REAL NOT NULL DEFAULT 0, method TEXT, by_user INTEGER
);
CREATE TABLE IF NOT EXISTS maintenance_log (
  id INT PRIMARY KEY AUTO_INCREMENT, device_type TEXT NOT NULL, device_id INTEGER NOT NULL, ts BIGINT NOT NULL,
  action TEXT NOT NULL, note TEXT, by_user INTEGER
);
CREATE TABLE IF NOT EXISTS analysis_run (
  id INT PRIMARY KEY AUTO_INCREMENT, instrument_id INTEGER, zone_id INTEGER, method TEXT NOT NULL,
  params_json TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, algo_version TEXT NOT NULL,
  note TEXT, created_by INTEGER, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS alarm_rule (
  id INT PRIMARY KEY AUTO_INCREMENT, project_id INTEGER NOT NULL, zone_id INTEGER, parameter TEXT NOT NULL,
  kind TEXT NOT NULL, level TEXT NOT NULL, threshold REAL NOT NULL, window_h REAL NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alarm_event (
  id INT PRIMARY KEY AUTO_INCREMENT, rule_id INTEGER, category VARCHAR(32) NOT NULL DEFAULT 'geoteknik',
  parameter TEXT NOT NULL, instrument_id INTEGER, device_type TEXT, device_id INTEGER, zone_id INTEGER,
  ts BIGINT NOT NULL, value REAL, threshold REAL, level TEXT NOT NULL, message TEXT,
  ack_by INTEGER, ack_note TEXT, ack_at BIGINT, cleared_at BIGINT
);
CREATE TABLE IF NOT EXISTS app_user (
  id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(191) NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_member (
  project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS session (
  token VARCHAR(128) PRIMARY KEY, user_id INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INTEGER, entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
  before_json TEXT, after_json TEXT, ts BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendation (
  id INT PRIMARY KEY AUTO_INCREMENT, zone_id INTEGER NOT NULL, decision TEXT NOT NULL, text TEXT NOT NULL,
  analysis_run_ids TEXT, created_by INTEGER, created_at BIGINT NOT NULL
);
CREATE INDEX reading_inst_ts ON reading(instrument_id, ts);
CREATE INDEX alarm_open ON alarm_event(cleared_at, ack_at);
`;

function splitStatements(sql: string): string[] {
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}

let pool: mysql.Pool | null = null;

function ensurePool(): mysql.Pool {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.STESYGEO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.STESYGEO_DB_PORT ?? 3306),
    user: process.env.STESYGEO_DB_USER ?? 'root',
    password: process.env.STESYGEO_DB_PASSWORD ?? '',
    database: process.env.STESYGEO_DB_NAME ?? 'stesygeo',
    connectionLimit: 10,
    decimalNumbers: true,
  });
  return pool;
}

async function execRaw(sql: string, params: any[]): Promise<[any, any]> {
  const conn = txStorage.getStore();
  return conn ? conn.execute(sql, params) : ensurePool().execute(sql, params);
}

function normalizeParams(params: unknown[]): any[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0] as any[];
  return params.map((p) => (p === undefined ? null : p));
}

class Stmt {
  constructor(private sql: string) {}
  async get(...params: unknown[]): Promise<any> {
    const [rows] = await execRaw(this.sql, normalizeParams(params));
    return (rows as any[])[0];
  }
  async all(...params: unknown[]): Promise<any[]> {
    const [rows] = await execRaw(this.sql, normalizeParams(params));
    return rows as any[];
  }
  async run(...params: unknown[]): Promise<{ lastInsertRowid: number; changes: number }> {
    const [result] = await execRaw(this.sql, normalizeParams(params));
    return { lastInsertRowid: (result as any).insertId, changes: (result as any).affectedRows };
  }
}

export interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): Promise<void>;
  transaction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;
}

function makeDb(): Db {
  return {
    prepare(sql: string) {
      return new Stmt(sql);
    },
    async exec(sql: string) {
      for (const stmt of splitStatements(sql)) {
        try {
          await execRaw(stmt, []);
        } catch (e: any) {
          if (e?.code === 'ER_DUP_KEYNAME') continue; // index sudah ada (schema idempoten)
          throw e;
        }
      }
    },
    transaction(fn) {
      return async (...args) => {
        for (let attempt = 1; ; attempt++) {
          const conn = await ensurePool().getConnection();
          try {
            await conn.beginTransaction();
            const result = await txStorage.run(conn, () => fn(...args));
            await conn.commit();
            return result;
          } catch (e: any) {
            await conn.rollback();
            // Deadlock antar transaksi konkuren (mis. ingest MQTT bertumpuk) — MySQL memakai row/gap
            // locking, beda dari SQLite yang menyerialkan semua penulisan; ulangi transaksi dari awal.
            if (e?.code === 'ER_LOCK_DEADLOCK' && attempt < 4) { await new Promise((r) => setTimeout(r, attempt * 50)); continue; }
            throw e;
          } finally {
            conn.release();
          }
        }
      };
    },
  };
}

let initialized = false;

export async function getDb(): Promise<Db> {
  const d = makeDb();
  if (!initialized) {
    initialized = true;
    await d.exec(SCHEMA_STATEMENTS);
  }
  return d;
}

export async function resetDb(): Promise<Db> {
  ensurePool();
  const [rows] = await ensurePool().query(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`,
  );
  await ensurePool().query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of rows as { name: string }[]) await ensurePool().query(`DROP TABLE IF EXISTS \`${t.name}\``);
  await ensurePool().query('SET FOREIGN_KEY_CHECKS = 1');
  initialized = false;
  return getDb();
}

export async function audit(userId: number | null, entity: string, entityId: number | null, action: string, before: unknown, after: unknown) {
  const db = await getDb();
  await db.prepare(`INSERT INTO audit_log(user_id, entity, entity_id, action, before_json, after_json, ts) VALUES (?,?,?,?,?,?,?)`)
    .run(userId, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), Date.now());
}
