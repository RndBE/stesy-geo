// Layanan domain: tinggi timbunan, kurva teoretis, analisis per instrumen, status & keputusan zona (PRD 6.3, 6.4, 9.4).
import { getDb } from './db.js';
import {
  ALGO_VERSION, combinedU, stagedSettlement, piezoU,
  type ConsolidationParams, type LoadIncrement, type PvdGeometry,
} from './analysis/consolidation.js';
import { asaoka, hyperbolic, dailyMean, rate, type Point, type AsaokaResult, type HyperbolicResult } from './analysis/fitting.js';

export const DAY = 86400e3;
export const TZ_OFFSET = 7 * 3600e3; // WIB
export const GAMMA_FILL = 19; // kN/m³
export const GAMMA_W = 9.81;

export type InstrumentType = 'SC' | 'GN' | 'SP' | 'PZ' | 'SAA' | 'INC' | 'GT' | 'RG' | 'BR' | 'EXT';
export const SETTLEMENT_TYPES: InstrumentType[] = ['SC', 'GN', 'SP', 'SAA'];

export const TYPE_LABEL: Record<string, string> = {
  SC: 'VW settlement cell', GN: 'GNSS batang settlement plate', SP: 'Settlement plate (manual)',
  PZ: 'Piezometer VW', SAA: 'ShapeArray horizontal (SAAX)', INC: 'In-place inclinometer / SAAV',
  GT: 'GNSS patok kaki timbunan', RG: 'Rain gauge', BR: 'Barometer', EXT: 'Extensometer',
};

export interface Zone {
  id: number; project_id: number; code: string; name: string; sta_start: number; sta_end: number;
  is_transition: number; design_fill_height: number; surcharge_height: number; ground_elev: number;
  crest_width: number; slope_h: number; cv: number; ch: number; hdr: number; residual_limit_mm: number;
}
export interface FillStage {
  id: number; zone_id: number; stage_no: number; label: string; planned_start: number | null; planned_end: number | null;
  actual_start: number | null; actual_end: number | null; thickness: number; is_surcharge: number; removed_at: number | null;
}
export interface SoilLayer {
  id: number; zone_id: number; name: string; top_depth: number; bottom_depth: number; gamma: number;
  cv: number | null; ch: number | null; cc: number | null; cr: number | null; e0: number | null; ocr: number | null;
  kh_ks: number | null; cu: number | null; compressible: number;
}
export interface Instrument {
  id: number; project_id: number; zone_id: number | null; code: string; type: InstrumentType; section_sta: number | null;
  sta: number | null; offset: number | null; x: number | null; y: number | null; z: number | null; tip_depth: number | null;
  installed_at: number | null; zero_reading: number | null; unit: string; mode: string; status: string; meta: string | null;
  expected_interval_min: number;
}

export const meta = (i: Instrument): Record<string, any> => (i.meta ? JSON.parse(i.meta) : {});

export async function getZone(id: number): Promise<Zone> {
  return (await getDb()).prepare('SELECT * FROM zone WHERE id = ?').get(id) as Promise<Zone>;
}
export async function getZones(projectId: number): Promise<Zone[]> {
  return (await getDb()).prepare('SELECT * FROM zone WHERE project_id = ? ORDER BY sta_start').all(projectId) as Promise<Zone[]>;
}
export async function getStages(zoneId: number): Promise<FillStage[]> {
  return (await getDb()).prepare('SELECT * FROM fill_stage WHERE zone_id = ? ORDER BY stage_no').all(zoneId) as Promise<FillStage[]>;
}
export async function getLayers(zoneId: number): Promise<SoilLayer[]> {
  return (await getDb()).prepare('SELECT * FROM soil_layer WHERE zone_id = ? ORDER BY top_depth').all(zoneId) as Promise<SoilLayer[]>;
}
export async function getPvd(zoneId: number): Promise<(PvdGeometry & { length: number }) | null> {
  const r = await (await getDb()).prepare('SELECT * FROM pvd_spec WHERE zone_id = ?').get(zoneId) as any;
  if (!r) return null;
  return { pattern: r.pattern, spacing: r.spacing, a: r.a, b: r.b, s: r.s, khKs: r.kh_ks, length: r.length };
}
export async function getInstrument(id: number): Promise<Instrument> {
  return (await getDb()).prepare('SELECT * FROM instrument WHERE id = ?').get(id) as Promise<Instrument>;
}

/** Tinggi timbunan aktual (m) pada waktu t; tahap diasumsikan naik linear selama periode pelaksanaan. */
export function fillHeightAt(stages: FillStage[], t: number, planned = false): number {
  let h = 0;
  for (const s of stages) {
    const a = planned ? s.planned_start : s.actual_start;
    const b = planned ? s.planned_end : s.actual_end ?? (s.actual_start != null ? Math.max(t, a!) : null);
    if (a == null || t <= a) continue;
    const end = b ?? a;
    const f = t >= end ? 1 : (t - a) / Math.max(1, end - a);
    h += s.thickness * f;
    if (s.is_surcharge && s.removed_at != null && t >= s.removed_at) h -= s.thickness;
  }
  return h;
}

export async function consolidationParams(z: Zone): Promise<ConsolidationParams> {
  const pvd = await getPvd(z.id);
  return { cv: z.cv, ch: z.ch, Hdr: z.hdr, pvd };
}

/** Penurunan primer total (mm) untuk tinggi timbunan H (m), dijumlah per irisan 0,5 m dari lapisan kompresibel. */
export function theoreticalFinal(layers: SoilLayer[], H: number, gwlDepth = 1.0): number {
  if (H <= 0) return 0;
  const dSigma = GAMMA_FILL * H;
  let s = 0;
  let sigmaTop = 0;
  for (const L of layers) {
    const dz = 0.5;
    for (let z = L.top_depth; z < L.bottom_depth - 1e-9; z += dz) {
      const mid = z + dz / 2;
      const sub = mid < gwlDepth ? 0 : GAMMA_W;
      // tegangan efektif di tengah irisan
      const sigma0 = sigmaTop + (mid - z) * (L.gamma - sub);
      if (L.compressible && L.cc && L.e0) {
        const ocr = L.ocr ?? 1;
        const sp = sigma0 * ocr;
        const sf = sigma0 + dSigma;
        const cr = L.cr ?? L.cc / 8;
        let de: number;
        if (sf <= sp) de = cr * Math.log10(sf / sigma0);
        else de = cr * Math.log10(sp / sigma0) + L.cc * Math.log10(sf / sp);
        s += (de / (1 + L.e0)) * dz;
      }
      sigmaTop += dz * (L.gamma - sub);
    }
  }
  return s * 1000;
}

/** Inkremen beban dari tahap aktual (atau rencana) untuk superposisi kurva teoretis. */
export function loadIncrements(z: Zone, stages: FillStage[], layers: SoilLayer[], planned = false, factor = 1): LoadIncrement[] {
  const incs: LoadIncrement[] = [];
  let h = 0;
  for (const s of stages) {
    const a = planned ? s.planned_start : s.actual_start;
    const b = planned ? s.planned_end : s.actual_end;
    if (a == null) continue;
    const t0 = b != null ? (a + b) / 2 : a;
    const before = theoreticalFinal(layers, h);
    h += s.thickness;
    incs.push({ t0, finalSettlement: (theoreticalFinal(layers, h) - before) * factor });
  }
  return incs;
}

// ---------------------------------------------------------------- data seri

export async function rawSeries(instId: number, from?: number, to?: number, includeFlagged = false): Promise<Point[]> {
  const rows = await (await getDb()).prepare(
    `SELECT ts AS t, value AS v FROM reading WHERE instrument_id = ? AND ts >= ? AND ts <= ?
     ${includeFlagged ? '' : "AND (flag IS NULL OR flag NOT IN ('ditolak'))"} ORDER BY ts`,
  ).all(instId, from ?? 0, to ?? 8.64e15) as Point[];
  return rows;
}

export async function dailySeries(instId: number, from?: number, to?: number): Promise<Point[]> {
  const rows = await (await getDb()).prepare(
    `SELECT CAST((ts + ${TZ_OFFSET}) / ${DAY} AS SIGNED) AS d, AVG(value) AS v, MAX(ts) AS last
     FROM reading WHERE instrument_id = ? AND ts >= ? AND ts <= ? AND (flag IS NULL OR flag NOT IN ('ditolak'))
     GROUP BY d ORDER BY d`,
  ).all(instId, from ?? 0, to ?? 8.64e15) as { d: number; v: number }[];
  return rows.map((r) => ({ t: r.d * DAY - TZ_OFFSET + DAY / 2, v: r.v }));
}

export async function lastReading(instId: number): Promise<{ ts: number; value: number; source: string; flag: string | null } | undefined> {
  return (await getDb()).prepare('SELECT ts, value, source, flag FROM reading WHERE instrument_id = ? ORDER BY ts DESC LIMIT 1').get(instId) as any;
}

export async function valueAt(instId: number, t: number): Promise<number | null> {
  const r = await (await getDb()).prepare('SELECT value FROM reading WHERE instrument_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(instId, t) as any;
  return r ? r.value : null;
}

// ---------------------------------------------------------------- analisis instrumen penurunan

export interface SettlementAnalysis {
  instrumentId: number;
  code: string;
  constantLoadFrom: number | null;
  current: number | null;
  asaoka: AsaokaResult | null;
  hyperbolic: HyperbolicResult | null;
  theory: { final: number; U: number; atNow: number };
  U_asaoka: number | null;
  U_hyper: number | null;
  final_asaoka: number | null;
  final_hyper: number | null;
  diffPct: number | null;
  rate7d: number | null; // mm/hari
  dateU90: number | null;
  residualDesign: number | null;
  algoVersion: string;
}

/** Awal beban konstan: akhir tahap terakhir yang sudah selesai (dan tahap berikutnya belum dimulai). */
export function constantLoadStart(stages: FillStage[], at: number): number | null {
  const done = stages.filter((s) => s.actual_end != null && s.actual_end <= at);
  const running = stages.some((s) => s.actual_start != null && s.actual_start <= at && (s.actual_end == null || s.actual_end > at));
  if (running || !done.length) return null;
  return Math.max(...done.map((s) => s.actual_end!));
}

export async function analyzeSettlement(inst: Instrument, opts: { dtDays?: number; from?: number; to?: number; at?: number } = {}): Promise<SettlementAnalysis> {
  const z = await getZone(inst.zone_id!);
  const stages = await getStages(z.id);
  const layers = await getLayers(z.id);
  const at = opts.at ?? Date.now();
  const series = await dailySeries(inst.id, undefined, at);
  const t0 = constantLoadStart(stages, at);
  const current = series.length ? series[series.length - 1].v : null;
  const factor = offsetFactor(inst.offset ?? 0, z);

  let as: AsaokaResult | null = null;
  let hy: HyperbolicResult | null = null;
  const from = opts.from ?? (t0 != null ? t0 + 3 * DAY : undefined);
  if (from != null) {
    as = asaoka(series, opts.dtDays ?? 7, from, opts.to);
    hy = hyperbolic(series, opts.from ?? t0!, opts.to);
  }

  const p = await consolidationParams(z);
  const incs = loadIncrements(z, stages, layers, false, factor);
  const thFinal = incs.reduce((s, i) => s + i.finalSettlement, 0);
  const thNow = stagedSettlement(at, incs, p);

  const fa = as?.valid ? as.finalSettlement : null;
  const fh = hy?.valid ? hy.finalSettlement : null;
  const r7 = rate(series, 28 * DAY, series.length ? series[series.length - 1].t : undefined);

  let dateU90: number | null = null;
  if (as?.valid && current != null && fa != null && current < 0.9 * fa) {
    const n = Math.log((fa - 0.9 * fa) / (fa - current)) / Math.log(as.beta1);
    dateU90 = series[series.length - 1].t + n * as.dtDays * DAY;
  } else if (as?.valid && current != null && fa != null) {
    dateU90 = null;
  }

  // Sisa penurunan di bawah beban rencana (tanpa surcharge), primer saja.
  let residual: number | null = null;
  if (fa != null && current != null) {
    const designH = z.design_fill_height;
    const totalH = stages.reduce((s, st) => s + st.thickness, 0);
    const ratio = theoreticalFinal(layers, designH) / Math.max(1e-9, theoreticalFinal(layers, totalH));
    residual = Math.max(0, fa * ratio - current);
  }

  return {
    instrumentId: inst.id,
    code: inst.code,
    constantLoadFrom: t0,
    current,
    asaoka: as,
    hyperbolic: hy,
    theory: { final: thFinal, U: thFinal > 0 ? thNow / thFinal : 0, atNow: thNow },
    U_asaoka: as?.valid ? as.U : null,
    U_hyper: hy?.valid ? hy.U : null,
    final_asaoka: fa,
    final_hyper: fh,
    diffPct: fa != null && fh != null ? (Math.abs(fh - fa) / fa) * 100 : null,
    rate7d: Number.isFinite(r7) ? r7 * 7 : null,
    dateU90,
    residualDesign: residual,
    algoVersion: ALGO_VERSION,
  };
}

/** Faktor penurunan melintang relatif terhadap as (profil cekungan penurunan sederhana). */
export function offsetFactor(offset: number, z: Pick<Zone, 'crest_width' | 'slope_h' | 'design_fill_height' | 'surcharge_height'>): number {
  const half = z.crest_width / 2;
  const toe = half + z.slope_h * (z.design_fill_height + z.surcharge_height);
  const x = Math.abs(offset);
  if (x <= half) return 1 - 0.15 * (x / half) ** 2;
  if (x <= toe) return 0.85 * (1 - (x - half) / (toe - half)) + 0.08 * ((x - half) / (toe - half));
  return Math.max(-0.03, 0.08 - (x - toe) * 0.02);
}

// ---------------------------------------------------------------- piezometer

export async function excessSeries(inst: Instrument, from?: number, to?: number, daily = false): Promise<Point[]> {
  const uh = meta(inst).u_hydro ?? 0;
  const s = daily ? await dailySeries(inst.id, from, to) : await rawSeries(inst.id, from, to);
  return s.map((p) => ({ t: p.t, v: p.v - uh }));
}

export interface PiezoAnalysis {
  instrumentId: number; code: string; depth: number | null; excessNow: number | null; du0: number;
  U: number | null; stageDissipation: number | null; stageNo: number | null; duDsigma: number | null;
}

export async function analyzePiezo(inst: Instrument, at = Date.now()): Promise<PiezoAnalysis> {
  const z = await getZone(inst.zone_id!);
  const stages = await getStages(z.id);
  const lr = await (await getDb()).prepare('SELECT value FROM reading WHERE instrument_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(inst.id, at) as any;
  const uh = meta(inst).u_hydro ?? 0;
  const excessNow = lr ? lr.value - uh : null;
  const H = fillHeightAt(stages, at);
  const du0 = GAMMA_FILL * H;
  // tahap terakhir yang sudah dimulai
  const started = stages.filter((s) => s.actual_start != null && s.actual_start <= at);
  const last = started[started.length - 1];
  let stageDiss: number | null = null;
  let duDs: number | null = null;
  if (last && excessNow != null) {
    const before = await valueAt(inst.id, last.actual_start!);
    const endT = (last.actual_end ?? at) + 3 * DAY;
    const pk = await (await getDb()).prepare('SELECT MAX(value) m FROM reading WHERE instrument_id = ? AND ts BETWEEN ? AND ?').get(inst.id, last.actual_start, Math.min(endT, at)) as any;
    if (before != null && pk?.m != null) {
      const rise = pk.m - before;
      if (rise > 0.5) stageDiss = Math.min(1, Math.max(0, (pk.m - uh - excessNow) / rise));
      const dSigma = GAMMA_FILL * (fillHeightAt(stages, at) - fillHeightAt(stages, last.actual_start!));
      if (dSigma > 1) duDs = (lr.value - before) / dSigma;
    }
  }
  return {
    instrumentId: inst.id, code: inst.code, depth: inst.tip_depth, excessNow, du0,
    U: excessNow != null && du0 > 0 ? piezoU(excessNow, du0) : null,
    stageDissipation: stageDiss, stageNo: last?.stage_no ?? null, duDsigma: duDs,
  };
}

// ---------------------------------------------------------------- status & keputusan zona

export type Decision = 'Lanjut timbun' | 'Tahan' | 'Siap bongkar surcharge' | 'Perlu tinjauan';

export interface Criterion { id: string; label: string; ok: boolean | null; detail: string }

export interface ZoneStatus {
  zone: Zone;
  fillHeight: number;
  totalPlanned: number;
  phase: 'penimbunan' | 'masa tunggu' | 'surcharge' | 'pascabongkar';
  currentStage: number | null;
  U: number | null;
  U_hyper: number | null;
  U_theory: number;
  finalSettlement: number | null;
  currentSettlement: number | null;
  remaining: number | null;
  residualDesign: number | null;
  dateU90: number | null;
  decision: Decision;
  criteria: Criterion[];
  settlement: SettlementAnalysis[];
  piezo: PiezoAnalysis[];
  lateralRate: number | null;
  deltaOverS: number | null;
  openAlarms: { level: string; n: number }[];
  staleInstruments: number;
}

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Instrumen penurunan di lajur/as jalan (|offset| ≤ 6 m) yang menjadi acuan keputusan zona. */
export function isCentreSettlement(i: Instrument): boolean {
  return ['SC', 'GN'].includes(i.type) && Math.abs(i.offset ?? 99) <= 6 && i.status === 'aktif';
}

export async function zoneInstruments(zoneId: number): Promise<Instrument[]> {
  return (await getDb()).prepare('SELECT * FROM instrument WHERE zone_id = ? ORDER BY code').all(zoneId) as Promise<Instrument[]>;
}

export async function isStale(inst: Instrument, now = Date.now()): Promise<boolean> {
  const lr = await lastReading(inst.id);
  if (!lr) return true;
  const allowed = inst.mode === 'manual' ? inst.expected_interval_min * 60e3 * 1.5 : Math.max(inst.expected_interval_min * 60e3 * 3, 6 * 3600e3);
  return now - lr.ts > allowed;
}

export async function thresholdFor(zoneId: number, parameter: string, level: string): Promise<number | null> {
  const r = await (await getDb()).prepare(
    `SELECT threshold FROM alarm_rule WHERE parameter = ? AND level = ? AND enabled = 1 AND (zone_id = ? OR zone_id IS NULL)
     ORDER BY zone_id IS NULL LIMIT 1`,
  ).get(parameter, level, zoneId) as any;
  return r ? r.threshold : null;
}

export async function zoneStatus(z: Zone, now = Date.now()): Promise<ZoneStatus> {
  const db = await getDb();
  const stages = await getStages(z.id);
  const insts = await zoneInstruments(z.id);
  const H = fillHeightAt(stages, now);
  const totalPlanned = stages.reduce((s, x) => s + x.thickness, 0);
  const running = stages.find((s) => s.actual_start != null && s.actual_start <= now && (s.actual_end == null || s.actual_end > now));
  const surcharge = stages.find((s) => s.is_surcharge);
  const surchargeOn = surcharge?.actual_end != null && surcharge.actual_end <= now && surcharge.removed_at == null;
  const phase: ZoneStatus['phase'] = running ? 'penimbunan' : surcharge?.removed_at ? 'pascabongkar' : surchargeOn ? 'surcharge' : 'masa tunggu';
  const started = stages.filter((s) => s.actual_start != null && s.actual_start <= now);
  const currentStage = started.length ? started[started.length - 1].stage_no : null;

  // Instrumen penurunan di as jalan (offset ≈ 0) menjadi acuan zona.
  const centre = insts.filter((i) => isCentreSettlement(i));
  const settle = await Promise.all(centre.map((i) => analyzeSettlement(i, { at: now })));
  const piezos = insts.filter((i) => i.type === 'PZ' && i.status === 'aktif');
  const pzA = await Promise.all(piezos.map((i) => analyzePiezo(i, now)));
  const pzCentre = pzA.filter((p) => {
    const i = piezos.find((x) => x.id === p.instrumentId)!;
    return Math.abs(i.offset ?? 0) < 1;
  });

  const incs = insts.filter((i) => i.type === 'INC' && i.status === 'aktif');
  const latSeries = await Promise.all(incs.map((i) => rawSeries(i.id, now - 2 * DAY, now)));
  const latRates = latSeries.map((s) => rate(s, DAY, now)).filter(Number.isFinite);
  const lateralRate = latRates.length ? Math.max(...latRates) : null;
  const latMaxReadings = await Promise.all(incs.map((i) => lastReading(i.id)));
  const latMax = latMaxReadings.map((r) => r?.value ?? null).filter((x): x is number => x != null);
  const Sc = avg(settle.map((s) => s.current));
  const deltaOverS = latMax.length && Sc && Sc > 50 ? Math.max(...latMax) / Sc : null;

  const open = await db.prepare(
    `SELECT level, COUNT(*) n FROM alarm_event WHERE zone_id = ? AND cleared_at IS NULL AND category = 'geoteknik' GROUP BY level`,
  ).all(z.id) as { level: string; n: number }[];
  const unacked = await db.prepare(
    `SELECT COUNT(*) n FROM alarm_event WHERE zone_id = ? AND ack_at IS NULL AND category = 'geoteknik' AND (cleared_at IS NULL OR cleared_at > ?)`,
  ).get(z.id, now - 7 * DAY) as { n: number };
  const unackedSerious = await db.prepare(
    `SELECT COUNT(*) n FROM alarm_event WHERE zone_id = ? AND ack_at IS NULL AND cleared_at IS NULL AND category = 'geoteknik' AND level IN ('Siaga','Bahaya')`,
  ).get(z.id) as { n: number };

  const U = avg(settle.map((s) => s.U_asaoka));
  const Uh = avg(settle.map((s) => s.U_hyper));
  const fin = avg(settle.map((s) => s.final_asaoka));
  const residual = settle.length ? Math.max(...settle.map((s) => s.residualDesign ?? NaN).filter(Number.isFinite), -Infinity) : null;
  const d90 = settle.map((s) => s.dateU90).filter((x): x is number => x != null);

  // ---- kriteria (PRD 9.4)
  const criteria: Criterion[] = [];
  let decision: Decision;
  const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
  const waspadaLat = (await thresholdFor(z.id, 'lateral_rate', 'Waspada')) ?? 5;
  const dsLimit = (await thresholdFor(z.id, 'delta_over_s', 'Waspada')) ?? 0.3;

  if (phase === 'penimbunan' || (phase === 'masa tunggu' && !surchargeOn)) {
    const diss = pzCentre.map((p) => p.stageDissipation).filter((x): x is number => x != null);
    const minDiss = diss.length ? Math.min(...diss) : null;
    criteria.push({
      id: 'A1', label: 'Disipasi Δu tahap terakhir ≥ 50% (piezometer as)',
      ok: phase === 'penimbunan' ? false : minDiss == null ? null : minDiss >= 0.5,
      detail: phase === 'penimbunan' ? `Tahap ${currentStage} sedang berjalan` : minDiss == null ? 'Tidak ada piezometer as di zona' : `minimum ${pct(minDiss)}`,
    });
    // laju lateral 3 hari berturut-turut < Waspada
    let latOk: boolean | null = null;
    let latDetail = 'Tidak ada inklinometer di zona';
    if (incs.length) {
      const daily: number[] = [];
      for (let d = 0; d < 3; d++) {
        const end = now - d * DAY;
        const series = await Promise.all(incs.map((i) => rawSeries(i.id, end - 2 * DAY, end)));
        const r = series.map((s) => rate(s, DAY, end)).filter(Number.isFinite);
        daily.push(r.length ? Math.max(...r) : NaN);
      }
      latOk = daily.every((r) => Number.isFinite(r) && r < waspadaLat);
      latDetail = `maks 3 hari: ${daily.map((r) => (Number.isFinite(r) ? r.toFixed(1) : '—')).join(' / ')} mm/hari (Waspada ${waspadaLat})`;
    }
    criteria.push({ id: 'A2', label: `Laju deformasi lateral < Waspada selama 3 hari`, ok: latOk, detail: latDetail });
    criteria.push({
      id: 'A3', label: 'Matsuo–Kawamura: δ/S di zona aman', ok: deltaOverS == null ? null : deltaOverS < dsLimit,
      detail: deltaOverS == null ? 'S < 50 mm atau tanpa inklinometer' : `δ/S = ${deltaOverS.toFixed(2)} (batas ${dsLimit})`,
    });
    criteria.push({ id: 'A4', label: 'Tidak ada alarm geoteknik belum dikonfirmasi', ok: unacked.n === 0, detail: `${unacked.n} alarm belum dikonfirmasi` });
    const blocking = criteria.filter((c) => c.ok === false);
    if (H >= totalPlanned - 0.05) decision = 'Tahan';
    else decision = blocking.length ? 'Tahan' : 'Lanjut timbun';
  } else {
    const allCentre = settle.filter((s) => s.U_asaoka != null && s.U_hyper != null);
    const minU = allCentre.length ? Math.min(...allCentre.map((s) => Math.min(s.U_asaoka!, s.U_hyper!))) : null;
    const maxDiff = allCentre.length ? Math.max(...allCentre.map((s) => s.diffPct!)) : null;
    criteria.push({
      id: 'B1', label: 'U ≥ 90% (Asaoka & hiperbolik), selisih S_akhir ≤ 10%',
      ok: minU == null ? false : minU >= 0.9 && (maxDiff ?? 100) <= 10,
      detail: minU == null ? 'Analisis belum valid' : `U min ${pct(minU)}, selisih maks ${maxDiff!.toFixed(1)}%`,
    });
    const pu = pzCentre.map((p) => p.U).filter((x): x is number => x != null);
    const minPU = pu.length ? Math.min(...pu) : null;
    criteria.push({ id: 'B2', label: 'U piezometer as ≥ 85%', ok: minPU == null ? null : minPU >= 0.85, detail: minPU == null ? 'Tidak ada piezometer as' : `minimum ${pct(minPU)}` });
    const res = residual != null && Number.isFinite(residual) ? residual : null;
    criteria.push({
      id: 'B3', label: `Sisa penurunan (beban rencana) ≤ ${z.residual_limit_mm} mm`, ok: res == null ? false : res <= z.residual_limit_mm,
      detail: res == null ? 'Belum dapat dihitung' : `${res.toFixed(0)} mm (primer; sekunder belum dihitung)`,
    });
    const rates = settle.map((s) => s.rate7d).filter((x): x is number => x != null);
    const maxRate = rates.length ? Math.max(...rates) : null;
    criteria.push({ id: 'B4', label: 'Laju penurunan < 2 mm/minggu (rata-rata 4 minggu)', ok: maxRate == null ? null : maxRate < 2, detail: maxRate == null ? '—' : `${maxRate.toFixed(1)} mm/minggu` });
    criteria.push({ id: 'A4', label: 'Tidak ada alarm geoteknik belum dikonfirmasi', ok: unacked.n === 0, detail: `${unacked.n} alarm belum dikonfirmasi` });
    decision = criteria.every((c) => c.ok !== false) && surchargeOn ? 'Siap bongkar surcharge' : 'Tahan';
  }
  if (unackedSerious.n > 0) decision = 'Perlu tinjauan';

  const staleFlags = await Promise.all(insts.filter((i) => i.status === 'aktif').map((i) => isStale(i, now)));
  const stale = staleFlags.filter(Boolean).length;

  return {
    zone: z, fillHeight: H, totalPlanned, phase, currentStage,
    U, U_hyper: Uh, U_theory: avg(settle.map((s) => s.theory.U)) ?? 0,
    finalSettlement: fin, currentSettlement: Sc, remaining: fin != null && Sc != null ? fin - Sc : null,
    residualDesign: residual != null && Number.isFinite(residual) ? residual : null,
    dateU90: d90.length ? Math.max(...d90) : null,
    decision, criteria, settlement: settle, piezo: pzA, lateralRate, deltaOverS,
    openAlarms: open, staleInstruments: stale,
  };
}

export { combinedU, dailyMean };
