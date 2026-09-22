// Evaluasi alarm geoteknik (F-ALM-01..05) dan alarm teknis telemetri (F-TLM-10).
import { getDb } from './db.js';
import { rate, type Point } from './analysis/fitting.js';
import {
  DAY, GAMMA_FILL, getStages, fillHeightAt, rawSeries, valueAt, meta, lastReading,
  type Instrument,
} from './domain.js';

export const LEVELS = ['Waspada', 'Siaga', 'Bahaya'] as const;
export type Level = (typeof LEVELS)[number];
const rank = (l: string | null) => (l == null ? 0 : LEVELS.indexOf(l as Level) + 1);

export const PARAMETERS: Record<string, { label: string; unit: string; types: string[]; kind: 'rate' | 'ratio' | 'value' }> = {
  lateral_rate: { label: 'Laju deformasi lateral kaki lereng', unit: 'mm/hari', types: ['INC'], kind: 'rate' },
  settlement_rate: { label: 'Laju penurunan as jalan saat penimbunan', unit: 'mm/hari', types: ['SC', 'GN'], kind: 'rate' },
  du_dsigma: { label: 'Rasio Δu/Δσ tahap berjalan', unit: '', types: ['PZ'], kind: 'ratio' },
  delta_over_s: { label: 'Rasio δ/S (kaki lereng / as jalan)', unit: '', types: ['INC'], kind: 'ratio' },
  toe_h_rate: { label: 'Pergerakan horizontal patok GNSS kaki', unit: 'mm/hari', types: ['GT'], kind: 'rate' },
};

type Metric = { value: number; detail?: string } | null;

/** Hitung nilai parameter untuk satu instrumen pada waktu `at`. */
export async function computeMetric(inst: Instrument, parameter: string, at: number): Promise<Metric> {
  const db = await getDb();
  switch (parameter) {
    case 'lateral_rate':
    case 'toe_h_rate': {
      const s = await rawSeries(inst.id, at - 2 * DAY, at);
      const r = rate(s, DAY, at);
      return Number.isFinite(r) ? { value: r } : null;
    }
    case 'settlement_rate': {
      if (Math.abs(inst.offset ?? 99) > 6) return null;
      const stages = await getStages(inst.zone_id!);
      // hanya dievaluasi saat penimbunan berlangsung atau ≤ 7 hari setelahnya
      const active = stages.some((st) => st.actual_start != null && st.actual_start <= at && (st.actual_end == null || st.actual_end + 7 * DAY >= at));
      if (!active) return null;
      const r = rate(await rawSeries(inst.id, at - 2 * DAY, at), DAY, at);
      return Number.isFinite(r) ? { value: r } : null;
    }
    case 'du_dsigma': {
      const stages = await getStages(inst.zone_id!);
      const cur = stages.filter((st) => st.actual_start != null && st.actual_start <= at).pop();
      if (!cur || (cur.actual_end != null && cur.actual_end + 14 * DAY < at)) return null;
      const dS = GAMMA_FILL * (fillHeightAt(stages, at) - fillHeightAt(stages, cur.actual_start!));
      if (dS < 10) return null; // rasio tidak stabil di awal tahap (< ±0,5 m timbunan)
      const before = await valueAt(inst.id, cur.actual_start!);
      const now = await valueAt(inst.id, at);
      if (before == null || now == null) return null;
      return { value: (now - before) / dS, detail: `Δσ = ${dS.toFixed(0)} kPa, tahap ${cur.stage_no}` };
    }
    case 'delta_over_s': {
      const d = await valueAt(inst.id, at);
      const m = meta(inst);
      if (d == null || !m.pair_settlement) return null;
      const ref = await db.prepare('SELECT id FROM instrument WHERE code = ?').get(m.pair_settlement) as any;
      if (!ref) return null;
      const S = await valueAt(ref.id, at);
      if (S == null || S < 50) return null;
      return { value: d / S, detail: `δ = ${d.toFixed(0)} mm, S = ${S.toFixed(0)} mm (${m.pair_settlement})` };
    }
  }
  return null;
}

interface Rule { id: number; zone_id: number | null; parameter: string; level: Level; threshold: number; window_h: number }

async function rulesFor(inst: Instrument): Promise<Rule[]> {
  const params = Object.entries(PARAMETERS).filter(([, p]) => p.types.includes(inst.type)).map(([k]) => k);
  if (!params.length) return [];
  const rows = await (await getDb()).prepare(
    `SELECT * FROM alarm_rule WHERE enabled = 1 AND project_id = ? AND (zone_id = ? OR zone_id IS NULL)
     AND parameter IN (${params.map(() => '?').join(',')})`,
  ).all(inst.project_id, inst.zone_id, ...params) as Rule[];
  // aturan zona menimpa aturan proyek untuk parameter+level yang sama
  const out = new Map<string, Rule>();
  for (const r of rows.sort((a, b) => (a.zone_id == null ? 0 : 1) - (b.zone_id == null ? 0 : 1))) out.set(`${r.parameter}:${r.level}`, r);
  return [...out.values()];
}

function levelOf(value: number, rules: Rule[]): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) if (value > r.threshold && rank(r.level) > rank(best?.level ?? null)) best = r;
  return best;
}

/**
 * Evaluasi semua parameter geoteknik untuk instrumen pada waktu `at`.
 * Penekanan alarm palsu (F-ALM-05): level = minimum dari dua pembacaan berurutan terakhir.
 */
export async function evaluateInstrument(inst: Instrument, at = Date.now()): Promise<number> {
  const db = await getDb();
  const rules = await rulesFor(inst);
  if (!rules.length) return 0;
  const prev = await db.prepare('SELECT ts FROM reading WHERE instrument_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 2').all(inst.id, at) as { ts: number }[];
  if (prev.length < 2) return 0;
  let created = 0;
  const byParam = new Map<string, Rule[]>();
  for (const r of rules) byParam.set(r.parameter, [...(byParam.get(r.parameter) ?? []), r]);
  for (const [param, rs] of byParam) {
    const m1 = await computeMetric(inst, param, prev[0].ts);
    const m2 = await computeMetric(inst, param, prev[1].ts);
    const l1 = m1 ? levelOf(m1.value, rs) : null;
    const l2 = m2 ? levelOf(m2.value, rs) : null;
    const eff = rank(l1?.level ?? null) <= rank(l2?.level ?? null) ? l1 : l2;
    const open = await db.prepare(
      `SELECT * FROM alarm_event WHERE instrument_id = ? AND parameter = ? AND cleared_at IS NULL ORDER BY ts DESC LIMIT 1`,
    ).get(inst.id, param) as any;
    if (eff && m1) {
      if (!open || rank(eff.level) > rank(open.level)) {
        if (open) await db.prepare('UPDATE alarm_event SET cleared_at = ? WHERE id = ?').run(prev[0].ts, open.id);
        const p = PARAMETERS[param];
        await db.prepare(
          `INSERT INTO alarm_event(rule_id, category, parameter, instrument_id, zone_id, ts, value, threshold, level, message)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(eff.id, 'geoteknik', param, inst.id, inst.zone_id, prev[0].ts, m1.value, eff.threshold, eff.level,
          `${p.label} ${inst.code} = ${m1.value.toFixed(p.kind === 'ratio' ? 2 : 1)}${p.unit ? ' ' + p.unit : ''} > ${eff.threshold} (${eff.level})${m1.detail ? ' — ' + m1.detail : ''}`);
        created++;
      } else if (open) {
        await db.prepare('UPDATE alarm_event SET value = GREATEST(value, ?) WHERE id = ?').run(m1.value, open.id);
      }
    } else if (open && !l1 && !l2) {
      await db.prepare('UPDATE alarm_event SET cleared_at = ? WHERE id = ?').run(prev[0].ts, open.id);
    }
  }
  return created;
}

// ---------------------------------------------------------------- alarm teknis

export const OFFLINE_HOURS = 6;
export const BATTERY_MIN_PCT = 20;

async function raiseTechnical(parameter: string, deviceType: string, deviceId: number, level: Level, message: string, value: number | null, ts: number, instrumentId: number | null = null, zoneId: number | null = null) {
  const db = await getDb();
  const open = await db.prepare(
    `SELECT id FROM alarm_event WHERE category = 'teknis' AND parameter = ? AND device_type = ? AND device_id = ? AND cleared_at IS NULL`,
  ).get(parameter, deviceType, deviceId);
  if (open) return;
  await db.prepare(
    `INSERT INTO alarm_event(category, parameter, device_type, device_id, instrument_id, zone_id, ts, value, level, message)
     VALUES ('teknis',?,?,?,?,?,?,?,?,?)`,
  ).run(parameter, deviceType, deviceId, instrumentId, zoneId, ts, value, level, message);
}

async function clearTechnical(parameter: string, deviceType: string, deviceId: number, ts: number) {
  await (await getDb()).prepare(
    `UPDATE alarm_event SET cleared_at = ? WHERE category = 'teknis' AND parameter = ? AND device_type = ? AND device_id = ? AND cleared_at IS NULL`,
  ).run(ts, parameter, deviceType, deviceId);
}

/** Pemeriksaan berkala kesehatan logger & gateway. */
export async function evaluateDevices(now = Date.now()) {
  const db = await getDb();
  const devices = [
    ...(await db.prepare(`SELECT id, code, last_seen, 'logger' AS t FROM logger`).all() as any[]),
    ...(await db.prepare(`SELECT id, code, last_seen, 'gateway' AS t FROM gateway`).all() as any[]),
  ];
  for (const d of devices) {
    const hrs = d.last_seen ? (now - d.last_seen) / 3600e3 : Infinity;
    if (hrs > OFFLINE_HOURS) {
      await raiseTechnical('offline', d.t, d.id, hrs > 24 ? 'Siaga' : 'Waspada', `${d.t === 'logger' ? 'Logger' : 'Gateway'} ${d.code} tidak mengirim data ${Number.isFinite(hrs) ? hrs.toFixed(0) + ' jam' : 'sejak dipasang'}`, hrs, now);
    } else await clearTechnical('offline', d.t, d.id, now);
    const h = await db.prepare(`SELECT battery_pct FROM device_health WHERE device_type = ? AND device_id = ? ORDER BY ts DESC LIMIT 1`).get(d.t, d.id) as any;
    if (h?.battery_pct != null && h.battery_pct < BATTERY_MIN_PCT) {
      await raiseTechnical('battery_low', d.t, d.id, h.battery_pct < 10 ? 'Siaga' : 'Waspada', `Baterai ${d.code} ${h.battery_pct.toFixed(0)}% (< ${BATTERY_MIN_PCT}%)`, h.battery_pct, now);
    } else if (h) await clearTechnical('battery_low', d.t, d.id, now);
  }
}

export async function raiseReadingAlarm(inst: Instrument, kind: 'di_luar_rentang' | 'lonjakan', value: number, ts: number, message: string) {
  await raiseTechnical(kind, 'instrument', inst.id, 'Waspada', message, value, ts, inst.id, inst.zone_id);
}

/** Validasi lonjakan (F-INS-02): |v − rerata| > n × simpangan baku dari 20 pembacaan terakhir, disesuaikan tren. */
export async function spikeCheck(instId: number, ts: number, value: number, n = 4): Promise<{ spike: boolean; expected: number | null; sd: number | null }> {
  const rows = await (await getDb()).prepare('SELECT ts AS t, value AS v FROM reading WHERE instrument_id = ? AND ts < ? ORDER BY ts DESC LIMIT 20').all(instId, ts) as Point[];
  if (rows.length < 6) return { spike: false, expected: null, sd: null };
  rows.reverse();
  const t0 = rows[0].t;
  const xs = rows.map((r) => (r.t - t0) / DAY);
  const ys = rows.map((r) => r.v);
  const nn = xs.length;
  const mx = xs.reduce((a, b) => a + b) / nn, my = ys.reduce((a, b) => a + b) / nn;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < nn; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const res = ys.map((y, i) => y - (a + b * xs[i]));
  const sd = Math.max(Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, nn - 2)), 1e-6);
  const expected = a + b * ((ts - t0) / DAY);
  const floor = Math.max(sd, Math.abs(expected) * 0.002, 0.5);
  return { spike: Math.abs(value - expected) > n * floor, expected, sd: floor };
}

export { lastReading };
