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

export async function authenticateGateway(code: string | undefined, token: string | undefined): Promise<{ id: number; code: string } | null> {
  if (!token) return null;
  const db = await getDb();
  const gw = (code
    ? await db.prepare('SELECT id, code, token_hash FROM gateway WHERE code = ?').get(code)
    : await db.prepare('SELECT id, code, token_hash FROM gateway WHERE token_hash = ?').get(hashToken(token))) as any;
  if (!gw) return null;
  const a = Buffer.from(gw.token_hash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { id: gw.id, code: gw.code } : null;
}

const toMs = (ts: string | number) => (typeof ts === 'number' ? (ts < 1e11 ? ts * 1000 : ts) : Date.parse(ts));

async function calibrationAt(instId: number, ts: number): Promise<{ id: number; coeffs: VwCalibration } | null> {
  const r = await (await getDb()).prepare('SELECT id, coeffs_json FROM calibration WHERE instrument_id = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1').get(instId, ts) as any;
  return r ? { id: r.id, coeffs: JSON.parse(r.coeffs_json) } : null;
}

async function baroAt(projectId: number, ts: number): Promise<number | null> {
  const r = await (await getDb()).prepare(
    `SELECT r.value FROM reading r JOIN instrument i ON i.id = r.instrument_id
     WHERE i.project_id = ? AND i.type = 'BR' AND r.ts <= ? AND r.ts >= ? ORDER BY r.ts DESC LIMIT 1`,
  ).get(projectId, ts, ts - 6 * 3600e3) as any;
  return r ? r.value : null;
}

/** Perubahan elevasi tangki referensi (mm) dari cek survei terakhir (F-TLM-07). */
async function tankDeltaAt(target: string, ts: number): Promise<number> {
  const r = await (await getDb()).prepare('SELECT delta_mm FROM reference_check WHERE target = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(target, ts) as any;
  return r ? r.delta_mm : 0;
}

/** Konversi bacaan mentah ke nilai teknik sesuai tipe instrumen. */
export async function convert(inst: Instrument, r: { raw?: number; temp?: number; value?: number }, ts: number): Promise<{ value: number; calibId: number | null }> {
  if (r.raw == null) {
    if (r.value == null) throw new Error(`${inst.code}: tidak ada nilai raw maupun value`);
    return { value: r.value, calibId: null };
  }
  const cal = await calibrationAt(inst.id, ts);
  if (!cal) throw new Error(`${inst.code}: tidak ada kalibrasi berlaku`);
  const baro = cal.coeffs.baroFactor ? await baroAt(inst.project_id, ts) : null;
  const p = convertVw(r.raw, r.temp ?? null, cal.coeffs, baro);
  if (inst.type === 'SC') {
    const m = meta(inst);
    return { value: liquidCellSettlement(p, 0, m.fluid_density ?? 1000, await tankDeltaAt(m.reference_tank ?? 'TANK-01', ts)), calibId: cal.id };
  }
  return { value: p, calibId: cal.id };
}

async function resolveInstrument(r: TelemetryReading, ts: number): Promise<Instrument | null> {
  const db = await getDb();
  if (r.instrument) return (await db.prepare('SELECT * FROM instrument WHERE code = ?').get(r.instrument) as Instrument) ?? null;
  if (r.logger == null || r.channel == null) return null;
  const row = await db.prepare(
    `SELECT i.* FROM logger_channel c JOIN logger l ON l.id = c.logger_id JOIN instrument i ON i.id = c.instrument_id
     WHERE (l.code = ? OR l.serial = ?) AND c.channel_no = ? AND c.valid_from <= ? AND (c.valid_to IS NULL OR c.valid_to > ?)`,
  ).get(r.logger, r.logger, r.channel, ts, ts) as Instrument | undefined;
  return row ?? null;
}

export interface IngestResult { accepted: number; duplicates: number; backfilled: number; rejected: { index: number; reason: string }[]; alarms: number }

export async function ingestPayload(p: TelemetryPayload, gatewayId: number | null): Promise<IngestResult> {
  const db = await getDb();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT IGNORE INTO reading(instrument_id, ts, raw_value, raw_temp, value, source, calib_id, flag, received_at)
     VALUES (?,?,?,?,?, 'telemetry', ?,?,?)`,
  );
  const insProfile = db.prepare('REPLACE INTO reading_profile(instrument_id, ts, pos, value) VALUES (?,?,?,?)');
  const insHealth = db.prepare(
    `REPLACE INTO device_health(device_type, device_id, ts, battery_v, battery_pct, rssi, snr, internal_temp) VALUES (?,?,?,?,?,?,?,?)`,
  );
  const latest = db.prepare('SELECT MAX(ts) m FROM reading WHERE instrument_id = ?');

  // res/touched hidup di dalam transaksi: deadlock (ER_LOCK_DEADLOCK) membuat db.transaction()
  // mengulang fn dari awal, jadi akumulator harus dibuat ulang tiap percobaan agar tidak dobel.
  const tx = db.transaction(async () => {
    const res: IngestResult = { accepted: 0, duplicates: 0, backfilled: 0, rejected: [], alarms: 0 };
    const touched = new Map<number, number>();
    for (const [index, r] of (p.readings ?? []).entries()) {
      const ts = toMs(r.ts);
      if (!Number.isFinite(ts)) { res.rejected.push({ index, reason: 'timestamp tidak valid' }); continue; }
      if (ts > now + 10 * 60e3) { res.rejected.push({ index, reason: 'timestamp di masa depan' }); continue; }
      const inst = await resolveInstrument(r, ts);
      if (!inst) { res.rejected.push({ index, reason: `kanal ${r.logger}/${r.channel ?? r.instrument} tidak terpetakan` }); continue; }
      let value: number, calibId: number | null;
      let profile = r.profile;
      try {
        if (profile?.length) {
          value = inst.type === 'SAA' ? Math.max(...profile.map((x) => x.value)) : Math.max(...profile.map((x) => Math.abs(x.value)));
          calibId = null;
        } else ({ value, calibId } = await convert(inst, r, ts));
      } catch (e: any) {
        res.rejected.push({ index, reason: e.message });
        continue;
      }
      let flag: string | null = null;
      const m = meta(inst);
      if (m.range && (value < m.range[0] || value > m.range[1])) {
        flag = 'di_luar_rentang';
        await raiseReadingAlarm(inst, 'di_luar_rentang', value, ts, `${inst.code}: nilai ${value.toFixed(1)} ${inst.unit} di luar rentang fisik sensor [${m.range.join(', ')}]`);
      } else {
        const sc = await spikeCheck(inst.id, ts, value, 6);
        if (sc.spike) {
          flag = 'lonjakan';
          await raiseReadingAlarm(inst, 'lonjakan', value, ts, `${inst.code}: lompatan tidak wajar ${value.toFixed(1)} ${inst.unit} (perkiraan ${sc.expected!.toFixed(1)})`);
        }
      }
      const prevMax = ((await latest.get(inst.id)) as any).m as number | null;
      const info = await insert.run(inst.id, ts, r.raw ?? null, r.temp ?? null, value, calibId, flag, now);
      if (info.changes === 0) { res.duplicates++; continue; }
      if (profile?.length) for (const pt of profile) await insProfile.run(inst.id, ts, pt.pos, pt.value);
      res.accepted++;
      if (prevMax != null && ts < prevMax) res.backfilled++;
      touched.set(inst.id, Math.max(touched.get(inst.id) ?? 0, ts));
      if (r.logger) await db.prepare('UPDATE logger SET last_seen = GREATEST(COALESCE(last_seen,0), ?) WHERE code = ? OR serial = ?').run(now, r.logger, r.logger);
    }
    for (const h of p.health ?? []) {
      const ts = toMs(h.ts);
      if (h.logger) {
        const l = await db.prepare('SELECT id FROM logger WHERE code = ? OR serial = ?').get(h.logger, h.logger) as any;
        if (l) {
          await insHealth.run('logger', l.id, ts, h.battery_v ?? null, h.battery_pct ?? null, h.rssi ?? null, h.snr ?? null, h.internal_temp ?? null);
          await db.prepare('UPDATE logger SET last_seen = GREATEST(COALESCE(last_seen,0), ?) WHERE id = ?').run(now, l.id);
        }
      } else if (gatewayId) {
        await insHealth.run('gateway', gatewayId, ts, h.battery_v ?? null, h.battery_pct ?? null, h.rssi ?? null, h.snr ?? null, h.internal_temp ?? null);
      }
    }
    if (gatewayId) await db.prepare('UPDATE gateway SET last_seen = ? WHERE id = ?').run(now, gatewayId);
    return { res, touched };
  });
  const { res, touched } = await tx();

  for (const [id, ts] of touched) res.alarms += await evaluateInstrument(await getInstrument(id), ts);
  if (res.accepted) broadcast('readings', { instruments: [...touched.keys()], accepted: res.accepted, alarms: res.alarms });
  if (res.alarms) broadcast('alarms', { created: res.alarms });
  return res;
}

export interface ManualReadingInput { ts: string | number; value: number; note?: string; force?: boolean }

/** Input manual dengan validasi langsung. Nilai menyimpang ditandai, bukan ditolak. */
export async function ingestManual(inst: Instrument, input: ManualReadingInput, userId: number) {
  const db = await getDb();
  const ts = toMs(input.ts);
  if (!Number.isFinite(ts)) throw new Error('Waktu pembacaan tidak valid');
  if (!Number.isFinite(input.value)) throw new Error('Nilai tidak valid');
  const m = meta(inst);
  let flag: string | null = null;
  if (m.range && (input.value < m.range[0] || input.value > m.range[1])) flag = 'di_luar_rentang';
  const sc = await spikeCheck(inst.id, ts, input.value);
  if (!flag && sc.spike) flag = 'lonjakan';
  const info = await db.prepare(
    `INSERT INTO reading(instrument_id, ts, value, source, flag, note, entered_by, received_at) VALUES (?,?,?, 'manual', ?,?,?,?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), flag = VALUES(flag), note = VALUES(note), entered_by = VALUES(entered_by), id = LAST_INSERT_ID(id)`,
  ).run(inst.id, ts, input.value, flag, input.note ?? null, userId, Date.now());
  const alarms = await evaluateInstrument(inst, ts);
  broadcast('readings', { instruments: [inst.id], accepted: 1, alarms });
  return { id: Number(info.lastInsertRowid), flag, expected: sc.expected, sd: sc.sd, alarms };
}
