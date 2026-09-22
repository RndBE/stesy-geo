// Ingestion telemetri (F-INS-04/05, F-TLM-02/03/05/06/07/08) dan input manual (F-INS-02).
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { convertVw, liquidCellSettlement, type VwCalibration } from './analysis/conversion.js';
import { evaluateInstrument, raiseReadingAlarm, spikeCheck } from './alarms.js';
import { getInstrument, meta, type Instrument } from './domain.js';
import { broadcast } from './events.js';

export interface TelemetryReading {
  logger?: string; // kode atau serial logger
  channel?: number;
  instrument?: string; // alternatif: kode instrumen langsung (adapter vendor yang sudah mengonversi)
  ts: string | number;
  raw?: number; // Hz untuk VW
  temp?: number;
  value?: number; // nilai teknik jika sudah dikonversi
  profile?: { pos: number; value: number }[];
}
export interface TelemetryHealth {
  logger?: string; gateway?: string; ts: string | number;
  battery_v?: number; battery_pct?: number; rssi?: number; snr?: number; internal_temp?: number;
}
export interface TelemetryPayload {
  gateway?: string;
  readings?: TelemetryReading[];
  health?: TelemetryHealth[];
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function authenticateGateway(code: string | undefined, token: string | undefined): { id: number; code: string } | null {
  if (!token) return null;
  const db = getDb();
  const gw = (code
    ? db.prepare('SELECT id, code, token_hash FROM gateway WHERE code = ?').get(code)
    : db.prepare('SELECT id, code, token_hash FROM gateway WHERE token_hash = ?').get(hashToken(token))) as any;
  if (!gw) return null;
  const a = Buffer.from(gw.token_hash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { id: gw.id, code: gw.code } : null;
}

const toMs = (ts: string | number) => (typeof ts === 'number' ? (ts < 1e11 ? ts * 1000 : ts) : Date.parse(ts));

function calibrationAt(instId: number, ts: number): { id: number; coeffs: VwCalibration } | null {
  const r = getDb().prepare('SELECT id, coeffs_json FROM calibration WHERE instrument_id = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1').get(instId, ts) as any;
  return r ? { id: r.id, coeffs: JSON.parse(r.coeffs_json) } : null;
}

function baroAt(projectId: number, ts: number): number | null {
  const r = getDb().prepare(
    `SELECT r.value FROM reading r JOIN instrument i ON i.id = r.instrument_id
     WHERE i.project_id = ? AND i.type = 'BR' AND r.ts <= ? AND r.ts >= ? ORDER BY r.ts DESC LIMIT 1`,
  ).get(projectId, ts, ts - 6 * 3600e3) as any;
  return r ? r.value : null;
}

/** Perubahan elevasi tangki referensi (mm) dari cek survei terakhir (F-TLM-07). */
function tankDeltaAt(target: string, ts: number): number {
  const r = getDb().prepare('SELECT delta_mm FROM reference_check WHERE target = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(target, ts) as any;
  return r ? r.delta_mm : 0;
}

/** Konversi bacaan mentah ke nilai teknik sesuai tipe instrumen. */
export function convert(inst: Instrument, r: { raw?: number; temp?: number; value?: number }, ts: number): { value: number; calibId: number | null } {
  if (r.raw == null) {
    if (r.value == null) throw new Error(`${inst.code}: tidak ada nilai raw maupun value`);
    return { value: r.value, calibId: null };
  }
  const cal = calibrationAt(inst.id, ts);
  if (!cal) throw new Error(`${inst.code}: tidak ada kalibrasi berlaku`);
  const baro = cal.coeffs.baroFactor ? baroAt(inst.project_id, ts) : null;
  const p = convertVw(r.raw, r.temp ?? null, cal.coeffs, baro);
  if (inst.type === 'SC') {
    const m = meta(inst);
    return { value: liquidCellSettlement(p, 0, m.fluid_density ?? 1000, tankDeltaAt(m.reference_tank ?? 'TANK-01', ts)), calibId: cal.id };
  }
  return { value: p, calibId: cal.id };
}

function resolveInstrument(r: TelemetryReading, ts: number): Instrument | null {
  const db = getDb();
  if (r.instrument) return (db.prepare('SELECT * FROM instrument WHERE code = ?').get(r.instrument) as Instrument) ?? null;
  if (r.logger == null || r.channel == null) return null;
  const row = db.prepare(
    `SELECT i.* FROM logger_channel c JOIN logger l ON l.id = c.logger_id JOIN instrument i ON i.id = c.instrument_id
     WHERE (l.code = ? OR l.serial = ?) AND c.channel_no = ? AND c.valid_from <= ? AND (c.valid_to IS NULL OR c.valid_to > ?)`,
  ).get(r.logger, r.logger, r.channel, ts, ts) as Instrument | undefined;
  return row ?? null;
}

export interface IngestResult { accepted: number; duplicates: number; backfilled: number; rejected: { index: number; reason: string }[]; alarms: number }

export function ingestPayload(p: TelemetryPayload, gatewayId: number | null): IngestResult {
  const db = getDb();
  const now = Date.now();
  const res: IngestResult = { accepted: 0, duplicates: 0, backfilled: 0, rejected: [], alarms: 0 };
  const touched = new Map<number, number>();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reading(instrument_id, ts, raw_value, raw_temp, value, source, calib_id, flag, received_at)
     VALUES (?,?,?,?,?, 'telemetry', ?,?,?)`,
  );
  const insProfile = db.prepare('INSERT OR REPLACE INTO reading_profile(instrument_id, ts, pos, value) VALUES (?,?,?,?)');
  const insHealth = db.prepare(
    `INSERT OR REPLACE INTO device_health(device_type, device_id, ts, battery_v, battery_pct, rssi, snr, internal_temp) VALUES (?,?,?,?,?,?,?,?)`,
  );
  const latest = db.prepare('SELECT MAX(ts) m FROM reading WHERE instrument_id = ?');

  const tx = db.transaction(() => {
    (p.readings ?? []).forEach((r, index) => {
      const ts = toMs(r.ts);
      if (!Number.isFinite(ts)) return res.rejected.push({ index, reason: 'timestamp tidak valid' });
      if (ts > now + 10 * 60e3) return res.rejected.push({ index, reason: 'timestamp di masa depan' });
      const inst = resolveInstrument(r, ts);
      if (!inst) return res.rejected.push({ index, reason: `kanal ${r.logger}/${r.channel ?? r.instrument} tidak terpetakan` });
      let value: number, calibId: number | null;
      let profile = r.profile;
      try {
        if (profile?.length) {
          value = inst.type === 'SAA' ? Math.max(...profile.map((x) => x.value)) : Math.max(...profile.map((x) => Math.abs(x.value)));
          calibId = null;
        } else ({ value, calibId } = convert(inst, r, ts));
      } catch (e: any) {
        return res.rejected.push({ index, reason: e.message });
      }
      let flag: string | null = null;
      const m = meta(inst);
      if (m.range && (value < m.range[0] || value > m.range[1])) {
        flag = 'di_luar_rentang';
        raiseReadingAlarm(inst, 'di_luar_rentang', value, ts, `${inst.code}: nilai ${value.toFixed(1)} ${inst.unit} di luar rentang fisik sensor [${m.range.join(', ')}]`);
      } else {
        const sc = spikeCheck(inst.id, ts, value, 6);
        if (sc.spike) {
          flag = 'lonjakan';
          raiseReadingAlarm(inst, 'lonjakan', value, ts, `${inst.code}: lompatan tidak wajar ${value.toFixed(1)} ${inst.unit} (perkiraan ${sc.expected!.toFixed(1)})`);
        }
      }
      const prevMax = (latest.get(inst.id) as any).m as number | null;
      const info = insert.run(inst.id, ts, r.raw ?? null, r.temp ?? null, value, calibId, flag, now);
      if (info.changes === 0) { res.duplicates++; return; }
      if (profile?.length) for (const pt of profile) insProfile.run(inst.id, ts, pt.pos, pt.value);
      res.accepted++;
      if (prevMax != null && ts < prevMax) res.backfilled++;
      touched.set(inst.id, Math.max(touched.get(inst.id) ?? 0, ts));
      if (r.logger) db.prepare('UPDATE logger SET last_seen = MAX(COALESCE(last_seen,0), ?) WHERE code = ? OR serial = ?').run(now, r.logger, r.logger);
    });
    for (const h of p.health ?? []) {
      const ts = toMs(h.ts);
      if (h.logger) {
        const l = db.prepare('SELECT id FROM logger WHERE code = ? OR serial = ?').get(h.logger, h.logger) as any;
        if (l) {
          insHealth.run('logger', l.id, ts, h.battery_v ?? null, h.battery_pct ?? null, h.rssi ?? null, h.snr ?? null, h.internal_temp ?? null);
          db.prepare('UPDATE logger SET last_seen = MAX(COALESCE(last_seen,0), ?) WHERE id = ?').run(now, l.id);
        }
      } else if (gatewayId) {
        insHealth.run('gateway', gatewayId, ts, h.battery_v ?? null, h.battery_pct ?? null, h.rssi ?? null, h.snr ?? null, h.internal_temp ?? null);
      }
    }
    if (gatewayId) db.prepare('UPDATE gateway SET last_seen = ? WHERE id = ?').run(now, gatewayId);
  });
  tx();

  for (const [id, ts] of touched) res.alarms += evaluateInstrument(getInstrument(id), ts);
  if (res.accepted) broadcast('readings', { instruments: [...touched.keys()], accepted: res.accepted, alarms: res.alarms });
  if (res.alarms) broadcast('alarms', { created: res.alarms });
  return res;
}

export interface ManualReadingInput { ts: string | number; value: number; note?: string; force?: boolean }

/** Input manual dengan validasi langsung. Nilai menyimpang ditandai, bukan ditolak. */
export function ingestManual(inst: Instrument, input: ManualReadingInput, userId: number) {
  const db = getDb();
  const ts = toMs(input.ts);
  if (!Number.isFinite(ts)) throw new Error('Waktu pembacaan tidak valid');
  if (!Number.isFinite(input.value)) throw new Error('Nilai tidak valid');
  const m = meta(inst);
  let flag: string | null = null;
  if (m.range && (input.value < m.range[0] || input.value > m.range[1])) flag = 'di_luar_rentang';
  const sc = spikeCheck(inst.id, ts, input.value);
  if (!flag && sc.spike) flag = 'lonjakan';
  const info = db.prepare(
    `INSERT INTO reading(instrument_id, ts, value, source, flag, note, entered_by, received_at) VALUES (?,?,?, 'manual', ?,?,?,?)
     ON CONFLICT(instrument_id, ts, source) DO UPDATE SET value = excluded.value, flag = excluded.flag, note = excluded.note, entered_by = excluded.entered_by`,
  ).run(inst.id, ts, input.value, flag, input.note ?? null, userId, Date.now());
  const alarms = evaluateInstrument(inst, ts);
  broadcast('readings', { instruments: [inst.id], accepted: 1, alarms });
  return { id: Number(info.lastInsertRowid), flag, expected: sc.expected, sd: sc.sd, alarms };
}
