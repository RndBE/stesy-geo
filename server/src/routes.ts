// REST API STESY GEO.
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDb, audit } from './db.js';
import { login, logout, requireRole, canAccessProject } from './auth.js';
import {
  DAY, getZone, getZones, getStages, getLayers, getPvd, getInstrument, zoneStatus, zoneInstruments, analyzeSettlement,
  analyzePiezo, rawSeries, dailySeries, excessSeries, fillHeightAt, loadIncrements, consolidationParams, lastReading,
  isStale, meta, TYPE_LABEL, theoreticalFinal, type Instrument,
} from './domain.js';
import { ALGO_VERSION, stagedSettlement, hansboTimeForUh, hansboMu, influenceDiameter, drainDiameter } from './analysis/consolidation.js';
import { asaokaForecast, backAnalyzeCh, hyperbolicAt } from './analysis/fitting.js';
import { PARAMETERS, evaluateInstrument } from './alarms.js';
import { ingestPayload, ingestManual, authenticateGateway } from './ingest.js';
import { subscribe, broadcast } from './events.js';
import { buildTwin, longitudinal } from './twin.js';
import { weeklyReport } from './report.js';

export const api = express.Router();

type H = (req: Request, res: Response) => unknown;
const wrap = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = fn(req, res);
    if (r instanceof Promise) r.catch(next);
  } catch (e) { next(e); }
};
const num = (v: unknown, d?: number) => (v == null || v === '' ? d : Number(v));
const db = () => getDb();

async function projectGuard(req: Request, res: Response, projectId: number): Promise<boolean> {
  if (!req.user || !(await canAccessProject(req.user, projectId))) { res.status(403).json({ error: 'Tidak punya akses ke proyek ini' }); return false; }
  return true;
}
async function instGuard(req: Request, res: Response): Promise<Instrument | null> {
  const i = await getInstrument(Number(req.params.id));
  if (!i) { res.status(404).json({ error: 'Instrumen tidak ditemukan' }); return null; }
  return (await projectGuard(req, res, i.project_id)) ? i : null;
}
async function zoneGuard(req: Request, res: Response) {
  const z = await getZone(Number(req.params.id));
  if (!z) { res.status(404).json({ error: 'Zona tidak ditemukan' }); return null; }
  return (await projectGuard(req, res, z.project_id)) ? z : null;
}

// ---------------------------------------------------------------- auth & ingest (tanpa sesi pengguna)

api.post('/login', wrap(async (req, res) => {
  const r = await login(String(req.body?.email ?? ''), String(req.body?.password ?? ''));
  if (!r) return res.status(401).json({ error: 'Email atau kata sandi salah' });
  await audit(r.user.id, 'session', r.user.id, 'login', null, null);
  res.json(r);
}));

/** F-TLM-03: HTTP push dari gateway dengan token Bearer per gateway. */
api.post('/ingest', wrap(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const gw = await authenticateGateway(req.body?.gateway, token);
  if (!gw) return res.status(401).json({ error: 'Token gateway tidak valid' });
  res.json(await ingestPayload(req.body, gw.id));
}));

api.get('/stream', requireRole('viewer'), (req, res) => subscribe(res));

api.use(requireRole('viewer'));

api.post('/logout', wrap(async (req, res) => {
  await logout(req.headers.authorization?.slice(7) ?? '');
  res.json({ ok: true });
}));
api.get('/me', (req, res) => res.json(req.user));

// ---------------------------------------------------------------- proyek & overview

api.get('/projects', wrap(async (req, res) => {
  const rows = await (await db()).prepare('SELECT * FROM project ORDER BY id').all() as any[];
  const flags = await Promise.all(rows.map((p) => canAccessProject(req.user!, p.id)));
  res.json(rows.filter((_, idx) => flags[idx]));
}));

api.get('/projects/:id/overview', wrap(async (req, res) => {
  const pid = Number(req.params.id);
  if (!(await projectGuard(req, res, pid))) return;
  const d = await db();
  const project = await d.prepare('SELECT * FROM project WHERE id = ?').get(pid);
  const now = Date.now();
  const zonesRaw = await getZones(pid);
  const zones = await Promise.all(zonesRaw.map(async (z) => {
    const s = await zoneStatus(z, now);
    const stages = await getStages(z.id);
    const next = stages.find((st) => st.actual_start == null);
    const zrow = await d.prepare('SELECT polygon FROM zone WHERE id = ?').get(z.id) as any;
    return {
      id: z.id, code: z.code, name: z.name, sta_start: z.sta_start, sta_end: z.sta_end, is_transition: z.is_transition,
      polygon: JSON.parse(zrow.polygon ?? '[]'),
      decision: s.decision, phase: s.phase, currentStage: s.currentStage, stageCount: stages.length,
      fillHeight: s.fillHeight, totalPlanned: s.totalPlanned, U: s.U, U_hyper: s.U_hyper, U_theory: s.U_theory,
      currentSettlement: s.currentSettlement, finalSettlement: s.finalSettlement, remaining: s.remaining,
      residualDesign: s.residualDesign, dateU90: s.dateU90, criteria: s.criteria, openAlarms: s.openAlarms,
      staleInstruments: s.staleInstruments, lateralRate: s.lateralRate, deltaOverS: s.deltaOverS,
      nextStage: next ? { no: next.stage_no, planned_start: next.planned_start, thickness: next.thickness } : null,
    };
  }));
  const alarms = await d.prepare(
    `SELECT e.*, i.code AS instrument_code, z.code AS zone_code FROM alarm_event e LEFT JOIN instrument i ON i.id = e.instrument_id
     LEFT JOIN zone z ON z.id = e.zone_id WHERE e.cleared_at IS NULL OR e.ack_at IS NULL ORDER BY e.ts DESC LIMIT 50`,
  ).all();
  const insts = await d.prepare('SELECT * FROM instrument WHERE project_id = ?').all(pid) as Instrument[];
  const activeInsts = insts.filter((i) => i.status === 'aktif');
  const staleChecks = await Promise.all(activeInsts.map(async (i) => ({ i, stale: await isStale(i, now) })));
  const staleOnly = staleChecks.filter((x) => x.stale).map((x) => x.i);
  const staleLast = await Promise.all(staleOnly.map((i) => lastReading(i.id)));
  const stale = staleOnly.map((i, idx) => ({ id: i.id, code: i.code, type: i.type, last: staleLast[idx]?.ts ?? null, mode: i.mode }));
  const latest = await d.prepare(`SELECT MAX(r.ts) m FROM reading r JOIN instrument i ON i.id = r.instrument_id WHERE i.project_id = ? AND r.source = 'telemetry'`).get(pid) as any;
  const telemetryShare = insts.filter((i) => i.mode === 'telemetry').length / Math.max(1, insts.length);
  res.json({ project, zones, alarms, stale, latestData: latest.m, instrumentCount: insts.length, telemetryShare, now });
}));

api.get('/projects/:id/trend', wrap(async (req, res) => {
  const pid = Number(req.params.id);
  if (!(await projectGuard(req, res, pid))) return;
  const days = num(req.query.days, 30)!;
  const from = Date.now() - days * DAY;
  const zones = await getZones(pid);
  const out = await Promise.all(zones.map(async (z) => {
    const centre = (await zoneInstruments(z.id)).filter((i) => ['SC', 'GN'].includes(i.type) && Math.abs(i.offset ?? 99) <= 6);
    const series = await Promise.all(centre.map((i) => dailySeries(i.id, from)));
    const n = Math.max(0, ...series.map((s) => s.length));
    const avg = [];
    for (let k = 0; k < n; k++) {
      const vs = series.map((s) => s[k]).filter(Boolean);
      if (vs.length) avg.push({ t: vs[0].t, v: vs.reduce((a, b) => a + b.v, 0) / vs.length });
    }
    const delta = avg.length > 1 ? avg[avg.length - 1].v - avg[0].v : null;
    const d7 = avg.filter((p) => p.t >= Date.now() - 7 * DAY);
    return { zone: z.code, id: z.id, series: avg, delta, delta7: d7.length > 1 ? d7[d7.length - 1].v - d7[0].v : null };
  }));
  res.json(out);
}));

api.get('/projects/:id/twin', wrap(async (req, res) => {
  const pid = Number(req.params.id);
  if (!(await projectGuard(req, res, pid))) return;
  res.json(await buildTwin(pid, num(req.query.horizon, 180)));
}));

api.get('/projects/:id/longitudinal', wrap(async (req, res) => {
  const pid = Number(req.params.id);
  if (!(await projectGuard(req, res, pid))) return;
  const al = await (await db()).prepare('SELECT * FROM alignment WHERE project_id = ?').get(pid) as any;
  res.json({ ...(await longitudinal(pid)), alignment: al ? { name: al.name, geometry: JSON.parse(al.sta_geometry), design: JSON.parse(al.design_profile) } : null });
}));

// ---------------------------------------------------------------- zona

api.get('/zones/:id', wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const s = await zoneStatus(z);
  const stages = await getStages(z.id);
  const pvd = await getPvd(z.id);
  const zoneInsts = await zoneInstruments(z.id);
  const insts = await Promise.all(zoneInsts.map(async (i) => ({ ...i, meta: meta(i), last: (await lastReading(i.id)) ?? null, stale: await isStale(i), typeLabel: TYPE_LABEL[i.type] })));
  const pvdInfo = pvd ? {
    ...pvd, De: influenceDiameter(pvd), dw: drainDiameter(pvd), mu: hansboMu(pvd),
    t90_years: hansboTimeForUh(0.9, z.ch, pvd),
  } : null;
  const recs = await (await db()).prepare('SELECT r.*, u.name AS by_name FROM recommendation r LEFT JOIN app_user u ON u.id = r.created_by WHERE zone_id = ? ORDER BY created_at DESC').all(z.id);
  res.json({ status: s, stages, layers: await getLayers(z.id), pvd: pvdInfo, instruments: insts, recommendations: recs, algoVersion: ALGO_VERSION });
}));

/** Grafik gabungan waktu–penurunan–tinggi timbunan zona (F-ANL-01 tingkat zona). */
api.get('/zones/:id/combined', wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const stages = await getStages(z.id);
  const insts = (await zoneInstruments(z.id)).filter((i) => ['SC', 'GN', 'SP'].includes(i.type));
  const series = await Promise.all(insts.map(async (i) => ({ code: i.code, type: i.type, offset: i.offset, sta: i.sta, data: (await dailySeries(i.id)).map((p) => [p.t, +p.v.toFixed(1)]) })));
  const first = Math.min(...stages.map((s) => s.actual_start ?? s.planned_start ?? Infinity)) - 14 * DAY;
  const fill = [];
  for (let t = first; t <= Date.now(); t += DAY) fill.push([t, +fillHeightAt(stages, t).toFixed(2)]);
  const plannedFill = [];
  const lastPlanned = Math.max(...stages.map((s) => s.planned_end ?? 0));
  for (let t = first; t <= lastPlanned + 30 * DAY; t += DAY) plannedFill.push([t, +fillHeightAt(stages, t, true).toFixed(2)]);
  res.json({ series, fill, plannedFill, stages });
}));

api.put('/zones/:id/params', requireRole('engineer'), wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const allowed = ['cv', 'ch', 'hdr', 'residual_limit_mm', 'design_fill_height', 'surcharge_height'];
  const upd = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k, v]) => allowed.includes(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
  if (!Object.keys(upd).length) return res.status(400).json({ error: 'Tidak ada parameter valid' });
  const before = Object.fromEntries(Object.keys(upd).map((k) => [k, (z as any)[k]]));
  await (await db()).prepare(`UPDATE zone SET ${Object.keys(upd).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(upd), z.id);
  await audit(req.user!.id, 'zone', z.id, 'ubah parameter', before, upd);
  res.json(await getZone(z.id));
}));

api.put('/zones/:id/pvd', requireRole('engineer'), wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const d = await db();
  const before = await d.prepare('SELECT * FROM pvd_spec WHERE zone_id = ?').get(z.id);
  const b = req.body ?? {};
  await d.prepare('UPDATE pvd_spec SET pattern = ?, spacing = ?, length = ?, a = ?, b = ?, s = ?, kh_ks = ? WHERE zone_id = ?')
    .run(b.pattern, b.spacing, b.length, b.a, b.b, b.s, b.khKs ?? b.kh_ks, z.id);
  await audit(req.user!.id, 'pvd_spec', z.id, 'ubah PVD', before, b);
  res.json(await getPvd(z.id));
}));

api.put('/layers/:id', requireRole('engineer'), wrap(async (req, res) => {
  const d = await db();
  const L = await d.prepare('SELECT * FROM soil_layer WHERE id = ?').get(Number(req.params.id)) as any;
  if (!L) return res.status(404).json({ error: 'Lapisan tidak ditemukan' });
  const zone = await getZone(L.zone_id);
  if (!(await projectGuard(req, res, zone.project_id))) return;
  const allowed = ['gamma', 'cv', 'ch', 'cc', 'cr', 'e0', 'ocr', 'kh_ks', 'cu', 'top_depth', 'bottom_depth'];
  const upd = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, v === null || v === '' ? null : Number(v)]));
  if (!Object.keys(upd).length) return res.status(400).json({ error: 'Tidak ada parameter valid' });
  await d.prepare(`UPDATE soil_layer SET ${Object.keys(upd).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(upd), L.id);
  await audit(req.user!.id, 'soil_layer', L.id, 'ubah parameter tanah', Object.fromEntries(Object.keys(upd).map((k) => [k, L[k]])), upd);
  res.json(await d.prepare('SELECT * FROM soil_layer WHERE id = ?').get(L.id));
}));

api.put('/stages/:id', requireRole('engineer'), wrap(async (req, res) => {
  const d = await db();
  const st = await d.prepare('SELECT * FROM fill_stage WHERE id = ?').get(Number(req.params.id)) as any;
  if (!st) return res.status(404).json({ error: 'Tahap tidak ditemukan' });
  const zone = await getZone(st.zone_id);
  if (!(await projectGuard(req, res, zone.project_id))) return;
  const allowed = ['planned_start', 'planned_end', 'actual_start', 'actual_end', 'thickness', 'removed_at'];
  const upd = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, v === null || v === '' ? null : Number(v)]));
  await d.prepare(`UPDATE fill_stage SET ${Object.keys(upd).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(upd), st.id);
  await audit(req.user!.id, 'fill_stage', st.id, 'ubah tahap timbunan', Object.fromEntries(Object.keys(upd).map((k) => [k, st[k]])), upd);
  broadcast('zones', { zone: st.zone_id });
  res.json(await d.prepare('SELECT * FROM fill_stage WHERE id = ?').get(st.id));
}));

api.post('/zones/:id/recommendations', requireRole('engineer'), wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const { decision, text, analysis_run_ids } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'Teks rekomendasi wajib diisi' });
  const decisionFinal = decision ?? (await zoneStatus(z)).decision;
  const info = await (await db()).prepare('INSERT INTO recommendation(zone_id, decision, text, analysis_run_ids, created_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(z.id, decisionFinal, text, JSON.stringify(analysis_run_ids ?? []), req.user!.id, Date.now());
  const id = info.lastInsertRowid;
  await audit(req.user!.id, 'recommendation', Number(id), 'buat', null, req.body);
  res.json({ id });
}));

// ---------------------------------------------------------------- instrumen & bacaan

api.get('/instruments', wrap(async (req, res) => {
  const pid = num(req.query.project, 1)!;
  if (!(await projectGuard(req, res, pid))) return;
  const d = await db();
  const rows = await d.prepare('SELECT i.*, z.code AS zone_code FROM instrument i LEFT JOIN zone z ON z.id = i.zone_id WHERE i.project_id = ? ORDER BY i.type, i.code').all(pid) as any[];
  const alarmStmt = d.prepare(`SELECT level FROM alarm_event WHERE instrument_id = ? AND cleared_at IS NULL ORDER BY CASE level WHEN 'Bahaya' THEN 3 WHEN 'Siaga' THEN 2 ELSE 1 END DESC LIMIT 1`);
  const prevStmt = d.prepare('SELECT ts, value FROM reading WHERE instrument_id = ? ORDER BY ts DESC LIMIT 1 OFFSET 1');
  const out = await Promise.all(rows.map(async (i) => ({
    ...i, meta: meta(i), typeLabel: TYPE_LABEL[i.type], last: (await lastReading(i.id)) ?? null, prev: (await prevStmt.get(i.id)) ?? null,
    stale: await isStale(i), alarm: ((await alarmStmt.get(i.id)) as any)?.level ?? null,
  })));
  res.json(out);
}));

api.get('/instruments/:id', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const d = await db();
  const calibs = await d.prepare('SELECT * FROM calibration WHERE instrument_id = ? ORDER BY valid_from DESC').all(i.id);
  res.json({
    ...i, meta: meta(i), typeLabel: TYPE_LABEL[i.type], zone: i.zone_id ? await getZone(i.zone_id) : null,
    last: (await lastReading(i.id)) ?? null, stale: await isStale(i),
    calibrations: calibs.map((c: any) => ({ ...c, coeffs: JSON.parse(c.coeffs_json) })),
    channels: await d.prepare('SELECT c.*, l.code AS logger_code, l.model FROM logger_channel c JOIN logger l ON l.id = c.logger_id WHERE c.instrument_id = ? ORDER BY valid_from DESC').all(i.id),
    alarms: await d.prepare('SELECT e.*, u.name AS ack_name FROM alarm_event e LEFT JOIN app_user u ON u.id = e.ack_by WHERE e.instrument_id = ? ORDER BY e.ts DESC LIMIT 50').all(i.id),
    counts: await d.prepare('SELECT source, COUNT(*) n, MIN(ts) first, MAX(ts) last FROM reading WHERE instrument_id = ? GROUP BY source').all(i.id),
  });
}));

api.get('/instruments/:id/readings', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const from = num(req.query.from, 0)!;
  const to = num(req.query.to, Date.now() + DAY)!;
  const agg = String(req.query.agg ?? 'auto');
  const useDaily = agg === 'daily' || (agg === 'auto' && to - from > 45 * DAY);
  const d = await db();
  if (useDaily) {
    const bySource = await d.prepare('SELECT DISTINCT source FROM reading WHERE instrument_id = ?').all(i.id) as { source: string }[];
    const out: Record<string, [number, number][]> = {};
    for (const { source } of bySource) {
      const rows = await d.prepare(
        `SELECT CAST((ts + 25200000) / 86400000 AS SIGNED) d, AVG(value) v FROM reading WHERE instrument_id = ? AND source = ? AND ts BETWEEN ? AND ? AND (flag IS NULL OR flag != 'ditolak') GROUP BY d ORDER BY d`,
      ).all(i.id, source, from, to) as any[];
      out[source] = rows.map((r) => [r.d * DAY - 25200000 + DAY / 2, +r.v.toFixed(3)]);
    }
    return res.json({ agg: 'daily', series: out });
  }
  const rows = await d.prepare(
    `SELECT r.id, r.ts, r.value, r.raw_value, r.raw_temp, r.source, r.flag, r.note, r.calib_id, u.name AS entered_by FROM reading r
     LEFT JOIN app_user u ON u.id = r.entered_by WHERE instrument_id = ? AND ts BETWEEN ? AND ? ORDER BY ts`,
  ).all(i.id, from, to);
  res.json({ agg: 'raw', rows });
}));

api.get('/instruments/:id/table', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const limit = Math.min(500, num(req.query.limit, 100)!);
  const rows = await (await db()).prepare(
    `SELECT r.id, r.ts, r.value, r.raw_value, r.raw_temp, r.source, r.flag, r.note, r.calib_id, r.received_at, u.name AS entered_by
     FROM reading r LEFT JOIN app_user u ON u.id = r.entered_by WHERE instrument_id = ? ORDER BY ts DESC LIMIT ?`,
  ).all(i.id, limit);
  res.json(rows);
}));

api.get('/instruments/:id/profiles', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const d = await db();
  const timesRows = await d.prepare('SELECT DISTINCT ts FROM reading_profile WHERE instrument_id = ? ORDER BY ts').all(i.id);
  const times = timesRows.map((r: any) => r.ts as number);
  if (!times.length) return res.json({ times: [], profiles: [] });
  let want: number[];
  if (req.query.dates) want = String(req.query.dates).split(',').map(Number);
  else {
    const last = times[times.length - 1];
    want = [last - 30 * DAY, last - 14 * DAY, last - 7 * DAY, last - 3 * DAY, last - DAY, last];
  }
  const nearest = (t: number) => times.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), times[0]);
  const uniq = [...new Set(want.map(nearest))];
  const profiles = await Promise.all(uniq.map(async (ts) => ({ ts, points: await d.prepare('SELECT pos, value FROM reading_profile WHERE instrument_id = ? AND ts = ? ORDER BY pos').all(i.id, ts) })));
  // profil inkremental relatif terhadap profil pertama yang dipilih
  res.json({ times: [times[0], times[times.length - 1]], count: times.length, profiles });
}));

api.post('/instruments/:id/readings', requireRole('surveyor'), wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  try {
    const r = await ingestManual(i, req.body ?? {}, req.user!.id);
    await audit(req.user!.id, 'reading', r.id, 'input manual', null, { instrument: i.code, ...req.body, flag: r.flag });
    res.json(r);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
}));

/** Validasi langsung sebelum disimpan (F-INS-02). */
api.post('/instruments/:id/validate', requireRole('surveyor'), wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const { spikeCheck } = await import('./alarms.js');
  const ts = Date.parse(req.body?.ts) || Date.now();
  const v = Number(req.body?.value);
  const m = meta(i);
  const out = m.range && (v < m.range[0] || v > m.range[1]) ? { flag: 'di_luar_rentang' } : {};
  const sc = await spikeCheck(i.id, ts, v);
  res.json({ ...out, spike: sc.spike, expected: sc.expected, sd: sc.sd });
}));

api.patch('/readings/:id', requireRole('engineer'), wrap(async (req, res) => {
  const d = await db();
  const r = await d.prepare('SELECT * FROM reading WHERE id = ?').get(Number(req.params.id)) as any;
  if (!r) return res.status(404).json({ error: 'Bacaan tidak ditemukan' });
  const flag = req.body?.flag === '' ? null : req.body?.flag ?? null;
  if (flag && !['ditolak', 'lonjakan', 'di_luar_rentang', 'diperiksa'].includes(flag)) return res.status(400).json({ error: 'Flag tidak dikenal' });
  await d.prepare('UPDATE reading SET flag = ?, note = COALESCE(?, note) WHERE id = ?').run(flag, req.body?.note ?? null, r.id);
  await audit(req.user!.id, 'reading', r.id, 'ubah flag', { flag: r.flag }, { flag, note: req.body?.note });
  res.json({ ok: true });
}));

/** Import massal CSV (F-INS-03). Body: { csv, mapping: {instrument, ts, value, note?}, template? } */
api.post('/import/csv', requireRole('surveyor'), wrap(async (req, res) => {
  const { csv, mapping, dryRun } = req.body ?? {};
  if (!csv || !mapping) return res.status(400).json({ error: 'csv dan mapping wajib' });
  const lines = String(csv).trim().split(/\r?\n/);
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(sep).map((h) => h.trim());
  const idx = (k: string) => header.indexOf(mapping[k]);
  const [ci, ti, vi, ni] = [idx('instrument'), idx('ts'), idx('value'), mapping.note ? idx('note') : -1];
  if (ci < 0 || ti < 0 || vi < 0) return res.status(400).json({ error: `Kolom tidak ditemukan. Header: ${header.join(', ')}` });
  const d = await db();
  // results dibuat ulang tiap percobaan: db.transaction() mengulang fn dari awal saat deadlock.
  const tx = d.transaction(async () => {
    const results: any[] = [];
    for (let k = 1; k < lines.length; k++) {
      const c = lines[k].split(sep).map((x) => x.trim());
      if (c.length < header.length) continue;
      const inst = await d.prepare('SELECT * FROM instrument WHERE code = ?').get(c[ci]) as Instrument | undefined;
      const value = Number(c[vi].replace(',', '.'));
      const ts = Date.parse(c[ti].includes('T') || c[ti].includes('+') ? c[ti] : c[ti].replace(' ', 'T') + '+07:00');
      if (!inst) { results.push({ line: k + 1, error: `Instrumen ${c[ci]} tidak dikenal` }); continue; }
      if (!Number.isFinite(value) || !Number.isFinite(ts)) { results.push({ line: k + 1, error: 'Nilai/waktu tidak valid' }); continue; }
      if (!(await canAccessProject(req.user!, inst.project_id))) { results.push({ line: k + 1, error: 'Tanpa akses' }); continue; }
      if (dryRun) { results.push({ line: k + 1, instrument: inst.code, ts, value, ok: true }); continue; }
      const r = await ingestManual(inst, { ts, value, note: ni >= 0 ? c[ni] : 'import CSV' }, req.user!.id);
      results.push({ line: k + 1, instrument: inst.code, ts, value, flag: r.flag, ok: true });
    }
    return results;
  });
  const results = await tx();
  if (!dryRun) await audit(req.user!.id, 'reading', null, 'import CSV', null, { rows: results.filter((r) => r.ok).length, mapping });
  res.json({ imported: results.filter((r) => r.ok).length, errors: results.filter((r) => r.error), results: results.slice(0, 200) });
}));

// Rute input manual (urutan instrumen sesuai jalur lapangan)
api.get('/routes', wrap(async (req, res) => {
  const pid = num(req.query.project, 1)!;
  if (!(await projectGuard(req, res, pid))) return;
  const d = await db();
  const insts = await d.prepare(`SELECT i.*, z.code AS zone_code FROM instrument i LEFT JOIN zone z ON z.id = i.zone_id WHERE i.project_id = ? ORDER BY i.sta, i.offset`).all(pid) as any[];
  const prev2 = d.prepare('SELECT ts, value, source FROM reading WHERE instrument_id = ? ORDER BY ts DESC LIMIT 3');
  const zones = await getZones(pid);
  const routes = [
    { id: 'kontrol', name: 'Settlement plate kontrol (waterpass)', filter: (i: any) => i.type === 'SP' },
    ...zones.map((z) => ({ id: z.code, name: `${z.code} ${z.name} — semua instrumen`, filter: (i: any) => i.zone_id === z.id && i.type !== 'SAA' && i.type !== 'INC' })),
  ];
  const out = await Promise.all(routes.map(async (r) => ({
    id: r.id, name: r.name,
    instruments: await Promise.all(insts.filter(r.filter).map(async (i) => ({ id: i.id, code: i.code, type: i.type, typeLabel: TYPE_LABEL[i.type], sta: i.sta, offset: i.offset, unit: i.unit, mode: i.mode, tip_depth: i.tip_depth, zone_code: i.zone_code, recent: await prev2.all(i.id) }))),
  })));
  res.json(out);
}));

// ---------------------------------------------------------------- analisis

async function settlementPayload(i: Instrument, q: any) {
  const opts = { dtDays: num(q.dt, 7), from: num(q.from), to: num(q.to) };
  const a = await analyzeSettlement(i, opts);
  const z = await getZone(i.zone_id!);
  const stages = await getStages(z.id);
  const layers = await getLayers(z.id);
  const series = await dailySeries(i.id);
  const lastT = series.length ? series[series.length - 1].t : Date.now();
  const horizon = lastT + num(q.horizon, 240)! * DAY;
  const p = await consolidationParams(z);
  const incsActual = loadIncrements(z, stages, layers);
  const plannedStages = stages.map((s) => ({ ...s, actual_start: s.actual_start ?? s.planned_start, actual_end: s.actual_end ?? (s.actual_start ? null : s.planned_end) }));
  const incsPlan = loadIncrements(z, plannedStages, layers);
  const first = Math.min(...stages.map((s) => s.actual_start ?? s.planned_start ?? Infinity));
  const theory: [number, number][] = [];
  for (let t = first; t <= horizon; t += 2 * DAY) theory.push([t, +stagedSettlement(t, incsPlan, p).toFixed(1)]);
  const theoryActual: [number, number][] = [];
  for (let t = first; t <= lastT; t += 2 * DAY) theoryActual.push([t, +stagedSettlement(t, incsActual, p).toFixed(1)]);
  const forecast = a.asaoka?.valid && a.current != null ? asaokaForecast(a.asaoka, lastT, a.current, horizon).map((x) => [x.t, +x.v.toFixed(1)]) : [];
  const hyperCurve: [number, number][] = [];
  if (a.hyperbolic?.valid) for (let t = a.hyperbolic.t0; t <= horizon; t += 2 * DAY) hyperCurve.push([t, +hyperbolicAt(a.hyperbolic, t).toFixed(1)]);
  const fill: [number, number][] = [];
  for (let t = first - 14 * DAY; t <= horizon; t += DAY) fill.push([t, +fillHeightAt(t <= Date.now() ? stages : plannedStages, t).toFixed(2)]);
  const manualPair = await (await db()).prepare(`SELECT id, code FROM instrument WHERE meta->>'$.pair' = ?`).all(i.code) as any[];
  const pvd = await getPvd(z.id);
  const related = await Promise.all(manualPair.map(async (m) => ({ code: m.code, data: (await dailySeries(m.id)).map((p) => [p.t, +p.v.toFixed(1)]) })));
  return {
    instrument: { ...i, meta: meta(i) }, zone: z, analysis: a,
    series: series.map((p) => [p.t, +p.v.toFixed(1)]), theory, theoryActual, forecast, hyperCurve, fill,
    stages, design: { cv: z.cv, ch: z.ch, hdr: z.hdr, pvd },
    related,
  };
}

api.get('/analysis/settlement/:id', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  if (!['SC', 'GN', 'SP', 'SAA'].includes(i.type) || !i.zone_id) return res.status(400).json({ error: 'Bukan instrumen penurunan' });
  res.json(await settlementPayload(i, req.query));
}));

api.get('/analysis/piezo/:id', wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  if (i.type !== 'PZ') return res.status(400).json({ error: 'Bukan piezometer' });
  const z = await getZone(i.zone_id!);
  const stages = await getStages(z.id);
  const ex = await excessSeries(i, undefined, undefined, true);
  const rawRecent = await excessSeries(i, Date.now() - 14 * DAY);
  const first = Math.min(...stages.map((s) => s.actual_start ?? Infinity)) - 14 * DAY;
  const fill: [number, number][] = [];
  for (let t = first; t <= Date.now(); t += DAY) fill.push([t, +fillHeightAt(stages, t).toFixed(2)]);
  const du0 = fill.map(([t, h]) => [t, +(h * 19).toFixed(1)]);
  const Useries = ex.map((p) => {
    const H = fillHeightAt(stages, p.t);
    return [p.t, H > 0.2 ? +Math.min(100, Math.max(0, (1 - p.v / (19 * H)) * 100)).toFixed(1) : null];
  });
  const manual = await (await db()).prepare(`SELECT ts, value FROM reading WHERE instrument_id = ? AND source = 'manual' ORDER BY ts`).all(i.id) as any[];
  const analysis = await analyzePiezo(i);
  res.json({
    instrument: { ...i, meta: meta(i) }, zone: z, analysis,
    excess: ex.map((p) => [p.t, +p.v.toFixed(2)]), recent: rawRecent.map((p) => [p.t, +p.v.toFixed(2)]),
    fill, du0, U: Useries, stages, manual: manual.map((m) => [m.ts, +(m.value - (meta(i).u_hydro ?? 0)).toFixed(2)]),
  });
}));

/** Back-analysis c_h (F-ANL-07). */
api.post('/analysis/backanalysis/:id', requireRole('engineer'), wrap(async (req, res) => {
  const i = await instGuard(req, res);
  if (!i) return;
  const z = await getZone(i.zone_id!);
  const stages = await getStages(z.id);
  const layers = await getLayers(z.id);
  const obs = await rawSeries(i.id, num(req.body?.from), num(req.body?.to));
  const incs = loadIncrements(z, stages, layers);
  const cp = await consolidationParams(z);
  const r = backAnalyzeCh(obs, incs, cp, [0.3, 15]);
  const p = { ...cp, ch: r.ch };
  const first = Math.min(...stages.map((s) => s.actual_start ?? Infinity));
  const horizon = Date.now() + 240 * DAY;
  const plannedStages = stages.map((s) => ({ ...s, actual_start: s.actual_start ?? s.planned_start, actual_end: s.actual_end ?? (s.actual_start ? null : s.planned_end) }));
  const incsPlan = loadIncrements(z, plannedStages, layers);
  const curve: [number, number][] = [];
  const low: [number, number][] = [];
  const high: [number, number][] = [];
  for (let t = first; t <= horizon; t += 2 * DAY) {
    curve.push([t, +(stagedSettlement(t, incsPlan, p) * r.scale).toFixed(1)]);
    low.push([t, +(stagedSettlement(t, incsPlan, { ...p, ch: r.chLow }) * r.scale).toFixed(1)]);
    high.push([t, +(stagedSettlement(t, incsPlan, { ...p, ch: r.chHigh }) * r.scale).toFixed(1)]);
  }
  const pvd = await getPvd(z.id);
  res.json({ ...r, designCh: z.ch, curve, low, high, t90_years: pvd ? hansboTimeForUh(0.9, r.ch, pvd) : null, t90_design_years: pvd ? hansboTimeForUh(0.9, z.ch, pvd) : null });
}));

/** Terapkan c_h hasil back-analysis ke zona (kalibrasi berkelanjutan F-DT-08) — tercatat di audit. */
api.post('/zones/:id/calibrate', requireRole('engineer'), wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const ch = Number(req.body?.ch);
  if (!(ch > 0)) return res.status(400).json({ error: 'c_h tidak valid' });
  await (await db()).prepare('UPDATE zone SET ch = ? WHERE id = ?').run(ch, z.id);
  await audit(req.user!.id, 'zone', z.id, 'kalibrasi c_h dari back-analysis', { ch: z.ch }, { ch, source: req.body?.source });
  res.json(await getZone(z.id));
}));

/** Tabel perbandingan metode per zona (F-ANL-09). */
api.get('/zones/:id/compare', wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const insts = (await zoneInstruments(z.id)).filter((i) => ['SC', 'GN', 'SP', 'SAA'].includes(i.type));
  const rows = await Promise.all(insts.map(async (i) => {
    const a = await analyzeSettlement(i, { dtDays: num(req.query.dt, 7) });
    return {
      id: i.id, code: i.code, type: i.type, sta: i.sta, offset: i.offset, current: a.current,
      asaoka: a.final_asaoka, asaoka_r2: a.asaoka?.r2 ?? null, hyper: a.final_hyper, hyper_r2: a.hyperbolic?.r2 ?? null,
      theory: a.theory.final, U_asaoka: a.U_asaoka, U_hyper: a.U_hyper, U_theory: a.theory.U,
      diffPct: a.diffPct, rate7d: a.rate7d, dateU90: a.dateU90, note: a.asaoka?.message ?? a.hyperbolic?.message ?? null,
    };
  }));
  res.json({ rows, algoVersion: ALGO_VERSION });
}));

/** Snapshot analisis yang dapat direproduksi (F-ANL-10). */
api.post('/analysis/snapshots', requireRole('engineer'), wrap(async (req, res) => {
  const { instrument_id, zone_id, method, params, note } = req.body ?? {};
  let result: unknown;
  let inputRows: unknown[] = [];
  const d = await db();
  if (instrument_id) {
    const i = await getInstrument(Number(instrument_id));
    if (!i || !(await projectGuard(req, res, i.project_id))) return;
    inputRows = await d.prepare(`SELECT ts, value, source, flag FROM reading WHERE instrument_id = ? AND (flag IS NULL OR flag != 'ditolak') ORDER BY ts`).all(i.id);
    result = method === 'piezo' ? await analyzePiezo(i) : await analyzeSettlement(i, { dtDays: params?.dt, from: params?.from, to: params?.to });
  } else if (zone_id) {
    const z = await getZone(Number(zone_id));
    if (!z || !(await projectGuard(req, res, z.project_id))) return;
    result = await zoneStatus(z);
  } else return res.status(400).json({ error: 'instrument_id atau zone_id wajib' });
  const input_hash = crypto.createHash('sha256').update(JSON.stringify({ inputRows, params })).digest('hex');
  const info = await d.prepare(
    `INSERT INTO analysis_run(instrument_id, zone_id, method, params_json, input_hash, result_json, algo_version, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(instrument_id ?? null, zone_id ?? null, method ?? 'asaoka+hiperbolik', JSON.stringify(params ?? {}), input_hash, JSON.stringify(result), ALGO_VERSION, note ?? null, req.user!.id, Date.now());
  const id = info.lastInsertRowid;
  await audit(req.user!.id, 'analysis_run', Number(id), 'simpan snapshot', null, { method, params, input_hash });
  res.json({ id, input_hash, algo_version: ALGO_VERSION });
}));

api.get('/analysis/snapshots', wrap(async (req, res) => {
  const rows = await (await db()).prepare(
    `SELECT a.id, a.instrument_id, a.zone_id, a.method, a.params_json, a.input_hash, a.algo_version, a.note, a.created_at, u.name AS by_name, i.code AS instrument_code, z.code AS zone_code
     FROM analysis_run a LEFT JOIN app_user u ON u.id = a.created_by LEFT JOIN instrument i ON i.id = a.instrument_id LEFT JOIN zone z ON z.id = a.zone_id
     WHERE (? IS NULL OR a.instrument_id = ?) ORDER BY a.created_at DESC LIMIT 100`,
  ).all(num(req.query.instrument) ?? null, num(req.query.instrument) ?? null);
  res.json(rows);
}));

/** Verifikasi reproduksibilitas: hitung ulang dan bandingkan hash input. */
api.get('/analysis/snapshots/:id/verify', wrap(async (req, res) => {
  const d = await db();
  const a = await d.prepare('SELECT * FROM analysis_run WHERE id = ?').get(Number(req.params.id)) as any;
  if (!a) return res.status(404).json({ error: 'Snapshot tidak ditemukan' });
  const params = JSON.parse(a.params_json);
  const inputRows = a.instrument_id ? await d.prepare(`SELECT ts, value, source, flag FROM reading WHERE instrument_id = ? AND (flag IS NULL OR flag != 'ditolak') AND received_at <= ? ORDER BY ts`).all(a.instrument_id, a.created_at) : [];
  const hash = crypto.createHash('sha256').update(JSON.stringify({ inputRows, params })).digest('hex');
  res.json({ id: a.id, stored_hash: a.input_hash, recomputed_hash: hash, identical_input: hash === a.input_hash, algo_version: a.algo_version, current_algo: ALGO_VERSION, result: JSON.parse(a.result_json) });
}));

/** Skenario what-if sederhana (F-DT-07, P1): geser tanggal tahap / ubah tebal surcharge. */
api.post('/zones/:id/scenario', wrap(async (req, res) => {
  const z = await zoneGuard(req, res);
  if (!z) return;
  const baseStages = await getStages(z.id);
  const stages = baseStages.map((s) => ({ ...s }));
  const { shiftStageDays = {}, surcharge, removeAt, ch } = req.body ?? {};
  for (const s of stages) {
    const sh = Number(shiftStageDays[s.stage_no] ?? 0) * DAY;
    if (s.actual_start == null) { s.actual_start = (s.planned_start ?? 0) + sh; s.actual_end = (s.planned_end ?? 0) + sh; }
    if (s.is_surcharge && surcharge != null) s.thickness = Number(surcharge);
  }
  const layers = await getLayers(z.id);
  const cp = await consolidationParams(z);
  const p = { ...cp, ch: ch ? Number(ch) : z.ch };
  const incs = loadIncrements(z, stages, layers);
  const plannedBaseStages = baseStages.map((s) => ({ ...s, actual_start: s.actual_start ?? s.planned_start, actual_end: s.actual_end ?? (s.actual_start ? null : s.planned_end) }));
  const base = loadIncrements(z, plannedBaseStages, layers);
  // skala ke data aktual as jalan
  const centre = (await zoneInstruments(z.id)).filter((i) => ['SC', 'GN'].includes(i.type) && Math.abs(i.offset ?? 99) <= 6);
  const centreLast = await Promise.all(centre.map((i) => lastReading(i.id)));
  const cur = centreLast.map((r) => r?.value).filter((v): v is number => v != null);
  const now = Date.now();
  const thNow = stagedSettlement(now, base, p);
  const scale = cur.length && thNow > 0 ? cur.reduce((a, b) => a + b, 0) / cur.length / thNow : 1;
  const first = Math.min(...stages.map((s) => s.actual_start!));
  const end = now + 400 * DAY;
  const designFinal = theoreticalFinal(layers, z.design_fill_height) * scale;
  const out: { t: number; base: number; scen: number; fillBase: number; fillScen: number }[] = [];
  const removal = removeAt ? Number(removeAt) : null;
  let frozen: number | null = null;
  for (let t = first; t <= end; t += 3 * DAY) {
    let s = stagedSettlement(t, incs, p) * scale;
    if (removal && t >= removal) { frozen ??= s; s = frozen; }
    out.push({ t, base: stagedSettlement(t, base, p) * scale, scen: s, fillBase: fillHeightAt(plannedBaseStages, t), fillScen: fillHeightAt(stages, t) - (removal && t >= removal ? stages.filter((x) => x.is_surcharge).reduce((a, x) => a + x.thickness, 0) : 0) });
  }
  const atRemoval = removal ? stagedSettlement(removal, incs, p) * scale : null;
  // indikasi stabilitas: laju pembebanan maksimum (kPa/hari) vs kapasitas c_u lapisan lunak
  const soft = layers.find((l) => l.cu != null && l.compressible && (l.cu ?? 99) < 20);
  const maxH = Math.max(...stages.map((s) => fillHeightAt(stages, s.actual_end ?? s.actual_start! + DAY)));
  const Hcrit = soft?.cu ? (5.14 * soft.cu) / 19 : null; // tinggi kritis timbunan tanpa konsolidasi (FS = 1)
  res.json({
    series: out, scale, designFinal,
    residualAtRemoval: atRemoval != null ? Math.max(0, designFinal - atRemoval) : null,
    stability: { maxHeight: maxH, Hcrit_undrained: Hcrit, note: 'Indikatif: H_kritis = 5,14·c_u/γ tanpa peningkatan kuat geser akibat konsolidasi. Bukan analisis stabilitas lereng.' },
  });
}));

// ---------------------------------------------------------------- alarm

api.get('/alarms', wrap(async (req, res) => {
  const status = String(req.query.status ?? 'open');
  const conds: string[] = [];
  const params: any[] = [];
  if (status === 'open') conds.push('(e.cleared_at IS NULL OR e.ack_at IS NULL)');
  else if (status === 'unack') conds.push('e.ack_at IS NULL');
  if (req.query.category) { conds.push('e.category = ?'); params.push(req.query.category); }
  if (req.query.level) { conds.push('e.level = ?'); params.push(req.query.level); }
  if (req.query.zone) { conds.push('e.zone_id = ?'); params.push(num(req.query.zone)); }
  const where = conds.length ? conds.join(' AND ') : '1=1';
  const rows = await (await db()).prepare(
    `SELECT e.*, i.code AS instrument_code, i.type AS instrument_type, z.code AS zone_code, u.name AS ack_name,
       COALESCE(l.code, g.code) AS device_code
     FROM alarm_event e LEFT JOIN instrument i ON i.id = e.instrument_id LEFT JOIN zone z ON z.id = e.zone_id
     LEFT JOIN app_user u ON u.id = e.ack_by
     LEFT JOIN logger l ON e.device_type = 'logger' AND l.id = e.device_id
     LEFT JOIN gateway g ON e.device_type = 'gateway' AND g.id = e.device_id
     WHERE ${where} ORDER BY e.ts DESC LIMIT 300`,
  ).all(...params);
  res.json(rows);
}));

api.post('/alarms/:id/ack', requireRole('engineer'), wrap(async (req, res) => {
  const note = String(req.body?.note ?? '').trim();
  if (note.length < 5) return res.status(400).json({ error: 'Catatan tindakan wajib diisi (min. 5 karakter)' });
  const d = await db();
  const e = await d.prepare('SELECT * FROM alarm_event WHERE id = ?').get(Number(req.params.id)) as any;
  if (!e) return res.status(404).json({ error: 'Alarm tidak ditemukan' });
  await d.prepare('UPDATE alarm_event SET ack_by = ?, ack_note = ?, ack_at = ? WHERE id = ?').run(req.user!.id, note, Date.now(), e.id);
  await audit(req.user!.id, 'alarm_event', e.id, 'konfirmasi alarm', { ack_at: null }, { note });
  broadcast('alarms', { acked: e.id });
  res.json({ ok: true });
}));

api.get('/alarm-rules', wrap(async (req, res) => {
  const rows = await (await db()).prepare('SELECT r.*, z.code AS zone_code FROM alarm_rule r LEFT JOIN zone z ON z.id = r.zone_id ORDER BY parameter, zone_id, CASE level WHEN \'Waspada\' THEN 1 WHEN \'Siaga\' THEN 2 ELSE 3 END').all();
  res.json({ rules: rows, parameters: PARAMETERS });
}));

api.put('/alarm-rules/:id', requireRole('admin'), wrap(async (req, res) => {
  const d = await db();
  const r = await d.prepare('SELECT * FROM alarm_rule WHERE id = ?').get(Number(req.params.id)) as any;
  if (!r) return res.status(404).json({ error: 'Aturan tidak ditemukan' });
  const threshold = req.body?.threshold != null ? Number(req.body.threshold) : r.threshold;
  const enabled = req.body?.enabled != null ? (req.body.enabled ? 1 : 0) : r.enabled;
  await d.prepare('UPDATE alarm_rule SET threshold = ?, enabled = ? WHERE id = ?').run(threshold, enabled, r.id);
  await audit(req.user!.id, 'alarm_rule', r.id, 'ubah ambang', { threshold: r.threshold, enabled: r.enabled }, { threshold, enabled });
  res.json({ ok: true });
}));

api.post('/alarm-rules', requireRole('admin'), wrap(async (req, res) => {
  const { zone_id, parameter, level, threshold } = req.body ?? {};
  if (!PARAMETERS[parameter] || !['Waspada', 'Siaga', 'Bahaya'].includes(level)) return res.status(400).json({ error: 'Parameter/level tidak valid' });
  const z = zone_id ? await getZone(Number(zone_id)) : null;
  const info = await (await db()).prepare('INSERT INTO alarm_rule(project_id, zone_id, parameter, kind, level, threshold) VALUES (?,?,?,?,?,?)')
    .run(z?.project_id ?? 1, zone_id ?? null, parameter, PARAMETERS[parameter].kind, level, Number(threshold));
  const id = info.lastInsertRowid;
  await audit(req.user!.id, 'alarm_rule', Number(id), 'buat', null, req.body);
  res.json({ id });
}));

api.post('/alarms/reevaluate', requireRole('engineer'), wrap(async (req, res) => {
  const insts = await (await db()).prepare('SELECT * FROM instrument').all() as Instrument[];
  let n = 0;
  for (const i of insts) n += await evaluateInstrument(i);
  res.json({ created: n });
}));

// ---------------------------------------------------------------- telemetri

api.get('/telemetry/devices', wrap(async (req, res) => {
  const d = await db();
  const now = Date.now();
  const gws = await d.prepare('SELECT id, code, vendor, model, serial, sta, power_type, last_seen FROM gateway').all() as any[];
  const lastH = d.prepare('SELECT * FROM device_health WHERE device_type = ? AND device_id = ? ORDER BY ts DESC LIMIT 1');
  const loggers = await d.prepare('SELECT * FROM logger ORDER BY code').all() as any[];
  const chans = d.prepare(
    `SELECT c.channel_no, i.id, i.code, i.type, i.expected_interval_min FROM logger_channel c JOIN instrument i ON i.id = c.instrument_id WHERE c.logger_id = ? AND c.valid_to IS NULL ORDER BY c.channel_no`,
  );
  const cnt = d.prepare(`SELECT COUNT(*) n FROM reading WHERE instrument_id = ? AND source = 'telemetry' AND ts > ?`);
  const alarm = d.prepare(`SELECT level, message FROM alarm_event WHERE category = 'teknis' AND device_type = ? AND device_id = ? AND cleared_at IS NULL`);
  const gateways = await Promise.all(gws.map(async (g) => ({ ...g, health: (await lastH.get('gateway', g.id)) ?? null, alarms: await alarm.all('gateway', g.id) })));
  const loggersOut = await Promise.all(loggers.map(async (l) => {
    const ch = await chans.all(l.id) as any[];
    let got = 0, expected = 0;
    for (const c of ch) { got += ((await cnt.get(c.id, now - DAY)) as any).n; expected += (24 * 60) / c.expected_interval_min; }
    return { ...l, health: (await lastH.get('logger', l.id)) ?? null, channels: ch, completeness24h: expected ? Math.min(1, got / expected) : null, alarms: await alarm.all('logger', l.id) };
  }));
  res.json({ gateways, loggers: loggersOut });
}));

api.get('/telemetry/health/:type/:id', wrap(async (req, res) => {
  const rows = await (await db()).prepare('SELECT ts, battery_v, battery_pct, rssi, snr, internal_temp FROM device_health WHERE device_type = ? AND device_id = ? AND ts > ? ORDER BY ts')
    .all(req.params.type, Number(req.params.id), Date.now() - num(req.query.days, 30)! * DAY);
  res.json(rows);
}));

/** Pembanding manual vs telemetri (F-TLM-11) dengan kriteria lulus PRD 8.9. */
api.get('/telemetry/compare', wrap(async (req, res) => {
  const d = await db();
  const pairs: any[] = [];
  const nearest = d.prepare(`SELECT ts, value FROM reading WHERE instrument_id = ? AND source = 'telemetry' AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1`);
  const manualInst = await d.prepare(`SELECT * FROM instrument WHERE type = 'SP'`).all() as Instrument[];
  for (const m of manualInst) {
    const ref = await d.prepare('SELECT * FROM instrument WHERE code = ?').get(meta(m).pair) as Instrument;
    if (!ref) continue;
    const rows = await d.prepare(`SELECT ts, value FROM reading WHERE instrument_id = ? AND source = 'manual' ORDER BY ts`).all(m.id) as any[];
    const data = (await Promise.all(rows.map(async (r) => { const t = await nearest.get(ref.id, r.ts - 3 * 3600e3, r.ts + 3 * 3600e3, r.ts) as any; return t ? { ts: r.ts, manual: r.value, telemetry: t.value, diff: t.value - r.value } : null; }))).filter(Boolean);
    pairs.push({ kind: 'penurunan', manual: m.code, telemetry: ref.code, unit: 'mm', tolerance: 5, data });
  }
  const pz = await d.prepare(`SELECT DISTINCT i.* FROM instrument i JOIN reading r ON r.instrument_id = i.id WHERE i.type = 'PZ' AND r.source = 'manual'`).all() as Instrument[];
  for (const p of pz) {
    const rows = await d.prepare(`SELECT ts, value FROM reading WHERE instrument_id = ? AND source = 'manual' ORDER BY ts`).all(p.id) as any[];
    const data = (await Promise.all(rows.map(async (r) => { const t = await nearest.get(p.id, r.ts - 3 * 3600e3, r.ts + 3 * 3600e3, r.ts) as any; return t ? { ts: r.ts, manual: r.value, telemetry: t.value, diff: t.value - r.value } : null; }))).filter(Boolean);
    pairs.push({ kind: 'tekanan pori', manual: `${p.code} (readout)`, telemetry: p.code, unit: 'kPa', tolerance: 2, data });
  }
  const gns = await d.prepare(`SELECT * FROM instrument WHERE type = 'GN' AND meta->>'$.pair' IS NOT NULL`).all() as Instrument[];
  for (const g of gns) {
    const ref = await d.prepare('SELECT * FROM instrument WHERE code = ?').get(meta(g).pair) as Instrument;
    const rows = await d.prepare(`SELECT ts, value FROM reading WHERE instrument_id = ? AND ts > ? AND CAST((ts + 25200000) / 3600000 AS SIGNED) % 24 = 12 ORDER BY ts`).all(g.id, Date.now() - 60 * DAY) as any[];
    const data = (await Promise.all(rows.map(async (r) => { const t = await nearest.get(ref.id, r.ts - 3 * 3600e3, r.ts + 3 * 3600e3, r.ts) as any; return t ? { ts: r.ts, manual: r.value, telemetry: t.value, diff: t.value - r.value } : null; }))).filter(Boolean);
    pairs.push({ kind: 'GNSS vs settlement cell', manual: g.code, telemetry: ref.code, unit: 'mm', tolerance: 5, data });
  }
  for (const p of pairs) {
    const diffs = p.data.map((x: any) => x.diff);
    const n = diffs.length;
    const mean = n ? diffs.reduce((a: number, b: number) => a + b, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(diffs.reduce((a: number, b: number) => a + (b - mean!) ** 2, 0) / (n - 1)) : null;
    const within = n ? diffs.filter((x: number) => Math.abs(x) <= p.tolerance).length / n : null;
    p.stats = { n, mean, sd, within, pass: within != null && within >= 0.9 };
  }
  res.json(pairs);
}));

api.get('/telemetry/maintenance', wrap(async (req, res) => {
  res.json(await (await db()).prepare(
    `SELECT m.*, u.name AS by_name, CASE m.device_type WHEN 'logger' THEN (SELECT code FROM logger WHERE id = m.device_id)
       WHEN 'gateway' THEN (SELECT code FROM gateway WHERE id = m.device_id) ELSE (SELECT code FROM instrument WHERE id = m.device_id) END AS device_code
     FROM maintenance_log m LEFT JOIN app_user u ON u.id = m.by_user ORDER BY ts DESC`,
  ).all());
}));

api.post('/telemetry/maintenance', requireRole('surveyor'), wrap(async (req, res) => {
  const { device_code, action, note, ts } = req.body ?? {};
  const d = await db();
  const found = await d.prepare(`SELECT 'logger' t, id FROM logger WHERE code = ? UNION SELECT 'gateway', id FROM gateway WHERE code = ? UNION SELECT 'instrument', id FROM instrument WHERE code = ?`).get(device_code, device_code, device_code) as any;
  if (!found || !action) return res.status(400).json({ error: 'Perangkat dan tindakan wajib diisi' });
  const info = await d.prepare('INSERT INTO maintenance_log(device_type, device_id, ts, action, note, by_user) VALUES (?,?,?,?,?,?)').run(found.t, found.id, ts ? Number(ts) : Date.now(), action, note ?? null, req.user!.id);
  const id = info.lastInsertRowid;
  await audit(req.user!.id, 'maintenance_log', Number(id), 'buat', null, req.body);
  res.json({ id });
}));

api.get('/telemetry/reference-checks', wrap(async (req, res) => {
  res.json(await (await db()).prepare('SELECT r.*, u.name AS by_name FROM reference_check r LEFT JOIN app_user u ON u.id = r.by_user ORDER BY ts DESC').all());
}));

api.post('/telemetry/reference-checks', requireRole('surveyor'), wrap(async (req, res) => {
  const { target = 'TANK-01', elevation, ts, method } = req.body ?? {};
  const d = await db();
  const first = await d.prepare('SELECT elevation FROM reference_check WHERE target = ? ORDER BY ts LIMIT 1').get(target) as any;
  const e = Number(elevation);
  if (!Number.isFinite(e)) return res.status(400).json({ error: 'Elevasi tidak valid' });
  const delta = first ? +((first.elevation - e) * 1000).toFixed(1) : 0;
  const info = await d.prepare('INSERT INTO reference_check(target, ts, elevation, delta_mm, method, by_user) VALUES (?,?,?,?,?,?)').run(target, ts ? Number(ts) : Date.now(), e, delta, method ?? 'Waterpass', req.user!.id);
  const id = info.lastInsertRowid;
  await audit(req.user!.id, 'reference_check', Number(id), 'buat', null, { target, elevation: e, delta });
  res.json({ id, delta_mm: delta });
}));

// ---------------------------------------------------------------- laporan, ekspor, audit, pengguna

api.get('/reports/weekly', wrap(async (req, res) => {
  const pid = num(req.query.project, 1)!;
  if (!(await projectGuard(req, res, pid))) return;
  const to = num(req.query.to, Date.now())!;
  const from = num(req.query.from, to - 7 * DAY)!;
  res.type('html').send(await weeklyReport(pid, from, to, String(req.query.lang ?? 'id') as 'id' | 'en', req.user!));
}));

const csvCell = (v: unknown) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const iso = (t: number) => new Date(t + 7 * 3600e3).toISOString().replace('Z', '+07:00').replace('.000', '');

api.get('/export/readings.csv', wrap(async (req, res) => {
  const pid = num(req.query.project, 1)!;
  if (!(await projectGuard(req, res, pid))) return;
  const from = num(req.query.from, 0)!;
  const to = num(req.query.to, Date.now())!;
  const ids = req.query.instrument ? String(req.query.instrument).split(',').map(Number) : null;
  const rows = await (await db()).prepare(
    `SELECT i.code, i.type, r.ts, r.value, i.unit, r.raw_value, r.raw_temp, r.source, r.flag, r.calib_id, r.note FROM reading r JOIN instrument i ON i.id = r.instrument_id
     WHERE i.project_id = ? AND r.ts BETWEEN ? AND ? ${ids ? `AND i.id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY i.code, r.ts`,
  ).all(pid, from, to, ...(ids ?? [])) as any[];
  const head = 'instrumen,tipe,waktu_wib,nilai,satuan,raw,suhu_raw,sumber,flag,kalibrasi_id,catatan';
  res.type('text/csv').set('Content-Disposition', `attachment; filename="stesygeo-bacaan-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send([head, ...rows.map((r) => [r.code, r.type, iso(r.ts), r.value.toFixed(3), r.unit, r.raw_value, r.raw_temp, r.source, r.flag, r.calib_id, r.note].map(csvCell).join(','))].join('\n'));
}));

api.get('/export/analysis.csv', wrap(async (req, res) => {
  const pid = num(req.query.project, 1)!;
  if (!(await projectGuard(req, res, pid))) return;
  const lines = ['zona,instrumen,sta,offset_m,S_sekarang_mm,S_akhir_asaoka_mm,R2_asaoka,S_akhir_hiperbolik_mm,R2_hiperbolik,S_akhir_teoretis_mm,U_asaoka_pct,U_hiperbolik_pct,selisih_pct,laju_mm_per_minggu,tanggal_U90,versi_algoritma'];
  const zones = await getZones(pid);
  for (const z of zones) {
    const insts = (await zoneInstruments(z.id)).filter((x) => ['SC', 'GN', 'SP', 'SAA'].includes(x.type));
    for (const i of insts) {
      const a = await analyzeSettlement(i);
      const f = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
      lines.push([z.code, i.code, i.sta, i.offset, f(a.current), f(a.final_asaoka), f(a.asaoka?.r2, 4), f(a.final_hyper), f(a.hyperbolic?.r2, 4), f(a.theory.final), f(a.U_asaoka != null ? a.U_asaoka * 100 : null, 1), f(a.U_hyper != null ? a.U_hyper * 100 : null, 1), f(a.diffPct, 1), f(a.rate7d, 2), a.dateU90 ? iso(a.dateU90).slice(0, 10) : '', a.algoVersion].map(csvCell).join(','));
    }
  }
  res.type('text/csv').set('Content-Disposition', `attachment; filename="stesygeo-analisis-${new Date().toISOString().slice(0, 10)}.csv"`).send(lines.join('\n'));
}));

api.get('/audit', requireRole('engineer'), wrap(async (req, res) => {
  res.json(await (await db()).prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id ORDER BY ts DESC LIMIT ?').all(num(req.query.limit, 200)));
}));

api.get('/users', requireRole('admin'), wrap(async (req, res) => {
  res.json(await (await db()).prepare('SELECT id, email, name, role FROM app_user ORDER BY id').all());
}));

api.put('/users/:id', requireRole('admin'), wrap(async (req, res) => {
  const d = await db();
  const u = await d.prepare('SELECT id, role FROM app_user WHERE id = ?').get(Number(req.params.id)) as any;
  if (!u) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
  const role = String(req.body?.role);
  if (!['admin', 'engineer', 'surveyor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role tidak valid' });
  await d.prepare('UPDATE app_user SET role = ? WHERE id = ?').run(role, u.id);
  await audit(req.user!.id, 'app_user', u.id, 'ubah role', { role: u.role }, { role });
  res.json({ ok: true });
}));
