// Skenario studi kasus PRD Bagian 9: timbunan jalan STA 24+000 – 25+000.
// Angka bersifat ilustratif. Modul ini mendefinisikan geometri, tata letak instrumen (9.3),
// dan "model kebenaran" yang dipakai seed data historis dan simulator telemetri
// agar keduanya menghasilkan data yang konsisten.
import { combinedU, type PvdGeometry } from './analysis/consolidation.js';
import { theoreticalFinal, offsetFactor, GAMMA_FILL, type SoilLayer } from './domain.js';

export const DAY = 86400e3;
const d = (s: string) => Date.parse(s + 'T08:00:00+07:00');

// ---------------------------------------------------------------- geometri & alignment

export const ORIGIN = { E: 443450.13, N: 9231900.75, azimuthDeg: 69.6900, staStart: 24000 }; // UTM 49S (EPSG:32749), penggal lurus Jl. Raya Semarang - Demak, bebas jembatan (terdekat 1,1 km)
export const GROUND_ELEV = 1.05; // m (datum MSL lokal)
export const GWL_DEPTH = 1.0;

export function staToXY(sta: number, offset = 0): { x: number; y: number } {
  const a = (ORIGIN.azimuthDeg * Math.PI) / 180;
  const s = sta - ORIGIN.staStart;
  // offset positif = kanan as (searah stationing)
  return { x: ORIGIN.E + s * Math.sin(a) + offset * Math.cos(a), y: ORIGIN.N + s * Math.cos(a) - offset * Math.sin(a) };
}

/** Elevasi rencana puncak perkerasan (profil memanjang), naik ke oprit jembatan. */
export function designElevation(sta: number): number {
  const base = GROUND_ELEV + 4.0;
  if (sta <= 24900) return base;
  return base + ((sta - 24900) / 100) * 1.0;
}

// ---------------------------------------------------------------- zona & tahap

export interface StageDef { thickness: number; start: number | null; end: number | null; plannedStart: number; plannedEnd: number; surcharge?: boolean }
export interface ZoneDef {
  code: string; name: string; staStart: number; staEnd: number; transition: boolean;
  designH: number; surchargeH: number; chTrue: number; sFactor: number; stages: StageDef[];
  /** faktor tambahan tekanan pori pada tahap tertentu (respons tak terdrainase lebih tinggi) */
  bBoost?: Record<number, number>;
}

function stages(starts: (string | null)[], planned: string[], thick: number[], rampDays = 6, surchargeLast = true): StageDef[] {
  return thick.map((t, i) => {
    const ps = d(planned[i]);
    const s = starts[i] ? d(starts[i]!) : null;
    return {
      thickness: t,
      start: s,
      end: s != null ? s + rampDays * DAY : null,
      plannedStart: ps,
      plannedEnd: ps + rampDays * DAY,
      surcharge: surchargeLast && i === thick.length - 1,
    };
  });
}

const STD = [1.0, 1.1, 1.0, 0.9, 1.5];

export const ZONES: ZoneDef[] = [
  {
    code: 'Z-01', name: 'STA 24+000 – 24+300', staStart: 24000, staEnd: 24300, transition: false,
    designH: 4.0, surchargeH: 1.5, chTrue: 6.5, sFactor: 0.95,
    stages: stages(['2025-12-01', '2025-12-29', '2026-01-26', '2026-02-23', '2026-03-30'],
      ['2025-12-01', '2025-12-26', '2026-01-20', '2026-02-14', '2026-03-11'], STD),
  },
  {
    code: 'Z-02', name: 'STA 24+300 – 24+600', staStart: 24300, staEnd: 24600, transition: false,
    designH: 4.0, surchargeH: 1.5, chTrue: 2.9, sFactor: 1.05,
    stages: stages(['2026-02-23', '2026-03-23', '2026-04-20', '2026-05-18', '2026-06-15'],
      ['2026-02-16', '2026-03-13', '2026-04-07', '2026-05-02', '2026-05-27'], STD),
  },
  {
    code: 'Z-03', name: 'STA 24+600 – 24+900', staStart: 24600, staEnd: 24900, transition: false,
    designH: 4.0, surchargeH: 1.5, chTrue: 2.0, sFactor: 1.1,
    stages: stages(['2026-04-13', '2026-05-18', '2026-06-22', '2026-07-27', '2026-09-07'],
      ['2026-04-06', '2026-05-04', '2026-06-01', '2026-06-29', '2026-07-27'], STD, 7),
    bBoost: { 5: 1.45 },
  },
  {
    code: 'Z-04', name: 'Oprit STA 24+900 – 25+000', staStart: 24900, staEnd: 25000, transition: true,
    designH: 5.0, surchargeH: 1.0, chTrue: 3.8, sFactor: 1.0,
    stages: stages(['2026-06-01', '2026-07-06', '2026-08-04', null, null, null],
      ['2026-06-01', '2026-07-06', '2026-08-03', '2026-09-28', '2026-10-26', '2026-11-23'], [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
  },
];

export function zoneForSta(sta: number): ZoneDef {
  return ZONES.find((z) => sta >= z.staStart && sta < z.staEnd) ?? ZONES[ZONES.length - 1];
}

export const LAYERS: Omit<SoilLayer, 'id' | 'zone_id'>[] = [
  { name: 'Lempung kaku (crust)', top_depth: 0, bottom_depth: 2, gamma: 17, cv: null, ch: null, cc: 0.35, cr: 0.05, e0: 1.2, ocr: 3, kh_ks: null, cu: 35, compressible: 1 },
  { name: 'Lempung sangat lunak', top_depth: 2, bottom_depth: 16, gamma: 15, cv: 1.5, ch: 3.0, cc: 0.95, cr: 0.11, e0: 2.35, ocr: 1.1, kh_ks: 2, cu: 11, compressible: 1 },
  { name: 'Lempung sedang', top_depth: 16, bottom_depth: 20, gamma: 17, cv: 2.0, ch: 4.0, cc: 0.45, cr: 0.06, e0: 1.4, ocr: 1.3, kh_ks: null, cu: 30, compressible: 1 },
  { name: 'Pasir padat', top_depth: 20, bottom_depth: 30, gamma: 19, cv: null, ch: null, cc: null, cr: null, e0: null, ocr: null, kh_ks: null, cu: null, compressible: 0 },
];

export const PVD: PvdGeometry & { length: number } = { pattern: 'segitiga', spacing: 1.2, a: 100, b: 4, s: 2, khKs: 2, length: 16 };
export const DESIGN = { cv: 1.5, ch: 3.0, Hdr: 7 };

// ---------------------------------------------------------------- instrumen (PRD 9.3)

export interface InstDef {
  code: string; type: 'SC' | 'GN' | 'SP' | 'PZ' | 'SAA' | 'INC' | 'GT' | 'RG' | 'BR';
  zone: string | null; sectionSta: number; sta: number; offset: number; tipDepth: number | null;
  unit: string; mode: 'telemetry' | 'manual'; logger: string | null; channel: number | null;
  intervalMin: number; installedAt: number; meta: Record<string, any>;
}
export interface LoggerDef {
  code: string; kind: 'VW' | 'DIGITAL' | 'GNSS' | 'ENV'; sta: number; offset: number; channels: number; serial: string;
  vendor: string; model: string; firmware: string;
  /** skenario gangguan */
  offlineSinceHours?: number; batteryDrainPerDay?: number;
}

export const MAIN_SECTIONS = [24200, 24500, 24800];
export const MID_SECTIONS = [24100, 24300, 24400, 24600, 24700];
export const OPRIT_SECTIONS = [24900, 24925, 24950, 24975, 25000];

export function toeOffset(z: ZoneDef) {
  return 12 + 2 * (z.designH + z.surchargeH);
}

export function buildLayout(): { instruments: InstDef[]; loggers: LoggerDef[] } {
  const inst: InstDef[] = [];
  const loggers: LoggerDef[] = [];
  const n: Record<string, number> = {};
  const code = (t: string) => `${t}-${String((n[t] = (n[t] ?? 0) + 1)).padStart(2, '0')}`;
  let lg = 0;
  const logger = (kind: LoggerDef['kind'], sta: number, offset: number, channels: number, extra: Partial<LoggerDef> = {}): LoggerDef => {
    lg++;
    const models: Record<string, string> = {
      VW: 'Logger VW 8 kanal (LoRa AS923-2)', DIGITAL: 'Logger digital RS-485 (LoRa AS923-2)',
      GNSS: 'GNSS rover L1/L2 + LoRa', ENV: 'Logger analog/pulsa (LoRa AS923-2)',
    };
    const l: LoggerDef = {
      code: `LG-${String(lg).padStart(2, '0')}`, kind, sta, offset, channels,
      serial: `${kind.slice(0, 2)}${2600000 + lg * 137}`, vendor: 'Vendor pilot', model: models[kind], firmware: kind === 'GNSS' ? '2.4.1' : '3.1.0', ...extra,
    };
    loggers.push(l);
    return l;
  };
  const installFor = (z: ZoneDef) => (z.stages[0].start ?? z.stages[0].plannedStart) - 10 * DAY;
  const zoneOf = (sta: number) => zoneForSta(sta);

  for (const s of [...MAIN_SECTIONS, ...MID_SECTIONS, ...OPRIT_SECTIONS].sort((a, b) => a - b)) {
    const z = zoneOf(s);
    const inst0 = installFor(z);
    const toe = toeOffset(z);
    const base = { zone: z.code, sectionSta: s, sta: s, installedAt: inst0, mode: 'telemetry' as const };
    if (MAIN_SECTIONS.includes(s)) {
      const vw = logger('VW', s, -toe - 4, 8);
      const dg = logger('DIGITAL', s, toe + 4, 4);
      const scCodes = [-12, 0, 12].map((off, i) => {
        const c = code('SC');
        inst.push({ ...base, code: c, type: 'SC', offset: off, tipDepth: null, unit: 'mm', logger: vw.code, channel: i + 1, intervalMin: 60, meta: { reference_tank: 'TANK-01', range: [-50, 3500] } });
        return c;
      });
      const centre = scCodes[1];
      [5, 9, 13].forEach((dep, i) => inst.push({ ...base, code: code('PZ'), type: 'PZ', offset: 0, tipDepth: dep, unit: 'kPa', logger: vw.code, channel: 4 + i, intervalMin: 60, meta: { u_hydro: +(9.81 * (dep - GWL_DEPTH)).toFixed(2), range: [-20, 350] } }));
      inst.push({ ...base, code: code('PZ'), type: 'PZ', offset: -toe - 1, tipDepth: 7, unit: 'kPa', logger: vw.code, channel: 7, intervalMin: 60, meta: { u_hydro: +(9.81 * (7 - GWL_DEPTH)).toFixed(2), range: [-20, 350], location: 'kaki lereng kiri' } });
      inst.push({ ...base, code: code('SAA'), type: 'SAA', offset: 0, tipDepth: null, unit: 'mm', logger: dg.code, channel: 1, intervalMin: 360, meta: { length: 45, from: -22.5, to: 22.5, node_spacing: 1.5 } });
      inst.push({ ...base, code: code('INC'), type: 'INC', offset: -toe - 1, tipDepth: 20, unit: 'mm', logger: dg.code, channel: 2, intervalMin: 60, meta: { side: 'kiri', pair_settlement: centre, node_spacing: 1 } });
      inst.push({ ...base, code: code('INC'), type: 'INC', offset: toe + 1, tipDepth: 20, unit: 'mm', logger: dg.code, channel: 3, intervalMin: 60, meta: { side: 'kanan', pair_settlement: centre, node_spacing: 1 } });
      const g = logger('GNSS', s, 0, 1);
      inst.push({ ...base, code: code('GN'), type: 'GN', offset: 0, tipDepth: null, unit: 'mm', logger: g.code, channel: 1, intervalMin: 60, meta: { pair: centre } });
      for (const off of [-toe - 4, toe + 4]) {
        const gt = logger('GNSS', s, off, 1);
        inst.push({ ...base, code: code('GT'), type: 'GT', offset: off, tipDepth: null, unit: 'mm', logger: gt.code, channel: 1, intervalMin: 60, meta: { side: off < 0 ? 'kiri' : 'kanan' } });
      }
      inst.push({ ...base, code: code('SP'), type: 'SP', offset: 1.5, tipDepth: null, unit: 'mm', mode: 'manual', logger: null, channel: null, intervalMin: 7 * 24 * 60, meta: { pair: centre, route: `Rute ${z.code}` } });
    } else if (MID_SECTIONS.includes(s)) {
      const g = logger('GNSS', s, 0, 1, s === 24300 ? { batteryDrainPerDay: 0.38 } : {});
      inst.push({ ...base, code: code('GN'), type: 'GN', offset: 0, tipDepth: null, unit: 'mm', logger: g.code, channel: 1, intervalMin: 60, meta: {} });
      const vw = logger('VW', s, -toe - 4, 4, s === 24100 ? { offlineSinceHours: 30 } : {});
      inst.push({ ...base, code: code('PZ'), type: 'PZ', offset: 0, tipDepth: 9, unit: 'kPa', logger: vw.code, channel: 1, intervalMin: 60, meta: { u_hydro: +(9.81 * (9 - GWL_DEPTH)).toFixed(2), range: [-20, 350] } });
    }
  }
  // Oprit: 2 settlement cell per penampang, 1 piezometer di 24+950
  const z4 = ZONES[3];
  const op1 = logger('VW', 24925, -toeOffset(z4) - 4, 8);
  const op2 = logger('VW', 24975, -toeOffset(z4) - 4, 8);
  let ch1 = 0, ch2 = 0;
  for (const s of OPRIT_SECTIONS) {
    const lgr = s <= 24950 ? op1 : op2;
    for (const off of [-6, 6]) {
      const ch = lgr === op1 ? ++ch1 : ++ch2;
      inst.push({ code: code('SC'), type: 'SC', zone: z4.code, sectionSta: s, sta: s, offset: off, tipDepth: null, unit: 'mm', mode: 'telemetry', logger: lgr.code, channel: ch, intervalMin: 60, installedAt: installFor(z4), meta: { reference_tank: 'TANK-01', range: [-50, 3500] } });
    }
  }
  inst.push({ code: code('PZ'), type: 'PZ', zone: z4.code, sectionSta: 24950, sta: 24950, offset: 0, tipDepth: 9, unit: 'kPa', mode: 'telemetry', logger: op1.code, channel: ++ch1, intervalMin: 60, installedAt: installFor(z4), meta: { u_hydro: +(9.81 * 8).toFixed(2), range: [-20, 350] } });

  const env = logger('ENV', 24500, 40, 4);
  const envInstall = d('2025-11-15');
  inst.push({ code: 'RG-01', type: 'RG', zone: null, sectionSta: 24500, sta: 24500, offset: 40, tipDepth: null, unit: 'mm', mode: 'telemetry', logger: env.code, channel: 1, intervalMin: 60, installedAt: envInstall, meta: { note: 'curah hujan per jam' } });
  inst.push({ code: 'BR-01', type: 'BR', zone: null, sectionSta: 24500, sta: 24500, offset: 40, tipDepth: null, unit: 'kPa', mode: 'telemetry', logger: env.code, channel: 2, intervalMin: 60, installedAt: envInstall, meta: { range: [95, 106] } });
  return { instruments: inst, loggers };
}

// ---------------------------------------------------------------- model kebenaran

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Derau pseudo-acak deterministik ~N(0, σ). */
export function noise(key: string, t: number, sigma: number): number {
  const r = rng(hash(`${key}@${Math.round(t / 60e3)}`));
  return (r() + r() + r() + r() - 2) * sigma * 1.73;
}
export const spatial = (code: string) => 0.95 + (hash(code) % 1000) / 1000 * 0.1;

interface SubInc { t: number; dS: number; dSigma: number; boost: number }
const subCache = new Map<string, SubInc[]>();
const layers = LAYERS.map((l, i) => ({ ...l, id: i, zone_id: 0 })) as SoilLayer[];

function subIncrements(z: ZoneDef): SubInc[] {
  const hit = subCache.get(z.code);
  if (hit) return hit;
  const out: SubInc[] = [];
  let h = 0;
  z.stages.forEach((st, i) => {
    if (st.start == null) return;
    const days = Math.max(1, Math.round((st.end! - st.start) / DAY));
    for (let k = 0; k < days; k++) {
      const before = theoreticalFinal(layers, h, GWL_DEPTH);
      h += st.thickness / days;
      out.push({ t: st.start + (k + 0.5) * DAY, dS: theoreticalFinal(layers, h, GWL_DEPTH) - before, dSigma: (GAMMA_FILL * st.thickness) / days, boost: z.bBoost?.[i + 1] ?? 1 });
    }
  });
  subCache.set(z.code, out);
  return out;
}

const params = (z: ZoneDef) => ({ cv: DESIGN.cv, ch: z.chTrue, Hdr: DESIGN.Hdr, pvd: PVD });
const yrs = (ms: number) => ms / (365.25 * DAY);

const sCache = new Map<string, number>();
/** Penurunan as jalan (mm) pada waktu t — konsolidasi primer + rangkak kecil. */
export function centreSettlement(z: ZoneDef, t: number): number {
  const key = `${z.code}:${t}`;
  const c = sCache.get(key);
  if (c != null) return c;
  let s = 0;
  const p = params(z);
  for (const si of subIncrements(z)) if (t > si.t) s += si.dS * combinedU(yrs(t - si.t), p).U;
  const first = subIncrements(z)[0];
  if (first && t > first.t) s += 18 * Math.log10(1 + (t - first.t) / (60 * DAY)); // rangkak sekunder (ilustratif)
  s *= z.sFactor;
  if (sCache.size > 500000) sCache.clear();
  sCache.set(key, s);
  return s;
}

/** Tekanan air pori ekses (kPa) di as jalan, kedalaman dep. */
export function excessPore(z: ZoneDef, t: number, depth: number, offset: number): number {
  const p = params(z);
  const bDepth = depth <= 6 ? 0.5 : depth <= 10 ? 0.55 : 0.5;
  const bOff = Math.abs(offset) > 12 ? 0.4 : 1;
  let u = 0;
  for (const si of subIncrements(z)) {
    if (t <= si.t) continue;
    // ujung atas lempung lunak lebih cepat terdrainase (dekat crust/timbunan)
    const U = combinedU(yrs(t - si.t) * (depth <= 6 ? 1.15 : 1), p).U;
    u += si.dSigma * bDepth * bOff * si.boost * (1 - U);
  }
  return u;
}

// Kejadian ketidakstabilan ilustratif di Z-03 kanan setelah surcharge
export const INCIDENT = { zone: 'Z-03', side: 'kanan', from: d('2026-09-18'), rateInc: 11.5, rateToe: 6.2 };

export function lateralMax(z: ZoneDef, inst: InstDef, t: number): number {
  const S = centreSettlement(z, t);
  let dmax = 0.14 * S * spatial(inst.code);
  if (z.code === INCIDENT.zone && inst.meta.side === INCIDENT.side && t > INCIDENT.from) dmax += (INCIDENT.rateInc * (t - INCIDENT.from)) / DAY;
  return dmax;
}

export function lateralProfile(dmax: number): { pos: number; value: number }[] {
  const out = [];
  for (let z = 0.5; z <= 20; z += 1) {
    let g = Math.exp(-(((z - 6.5) / 4.5) ** 2));
    if (z > 16) g *= Math.max(0, (20 - z) / 4);
    out.push({ pos: z, value: dmax * g });
  }
  return out;
}

export interface ZoneGeom { crest_width: number; slope_h: number; design_fill_height: number; surcharge_height: number }
export const geomOf = (z: ZoneDef): ZoneGeom => ({ crest_width: 24, slope_h: 2, design_fill_height: z.designH, surcharge_height: z.surchargeH });

/** Diferensial memanjang di oprit: faktor per STA. */
function staFactor(sta: number): number {
  if (sta < 24900) return 1;
  return 1 + 0.12 * ((sta - 24900) / 100) - 0.2 * Math.max(0, (sta - 24980) / 20);
}

export interface TruthSample { value: number; profile?: { pos: number; value: number }[] }

/** Nilai "sebenarnya" + derau untuk instrumen pada waktu t. */
export function truth(inst: InstDef, t: number): TruthSample | null {
  if (t < inst.installedAt) return null;
  if (inst.type === 'RG') {
    const r = rng(hash(`rain@${Math.floor(t / 3600e3)}`))();
    const month = new Date(t).getUTCMonth();
    const wet = [10, 11, 0, 1, 2, 3].includes(month) ? 0.16 : 0.05;
    return { value: r < wet ? +(r * 60).toFixed(1) : 0 };
  }
  if (inst.type === 'BR') {
    const h = ((t / 3600e3) + 7) % 24;
    return { value: 101.0 + 0.12 * Math.sin((2 * Math.PI * (h - 10)) / 12) + noise(inst.code, t, 0.02) };
  }
  const z = ZONES.find((x) => x.code === inst.zone)!;
  const S = centreSettlement(z, t);
  // instrumen yang berdampingan (SP/GNSS di samping settlement cell) berbagi kondisi tanah yang sama
  const f = offsetFactor(inst.offset, geomOf(z)) * spatial(inst.meta.pair ?? inst.code) * staFactor(inst.sta);
  switch (inst.type) {
    case 'SC': return { value: S * f + noise(inst.code, t, 1.2) };
    case 'GN': return { value: S * f + 1.2 + noise(inst.code, t, 2.0) };
    case 'SP': return { value: S * f + noise(inst.code, t, 1.8) };
    case 'PZ': return { value: (inst.meta.u_hydro ?? 0) + excessPore(z, t, inst.tipDepth ?? 9, inst.offset) * spatial(inst.code) + noise(inst.code, t, 0.35) };
    case 'SAA': {
      const prof = [];
      for (let x = -22.5; x <= 22.51; x += 1.5) prof.push({ pos: +x.toFixed(1), value: S * offsetFactor(x, geomOf(z)) * spatial(inst.code) + noise(inst.code + x, t, 1.5) });
      return { value: Math.max(...prof.map((p) => p.value)), profile: prof };
    }
    case 'INC': {
      const dm = lateralMax(z, inst, t);
      const prof = lateralProfile(dm).map((p) => ({ pos: p.pos, value: p.value + noise(inst.code + p.pos, t, 0.25) }));
      return { value: Math.max(...prof.map((p) => Math.abs(p.value))), profile: prof };
    }
    case 'GT': {
      let v = 0.045 * S * spatial(inst.code);
      if (z.code === INCIDENT.zone && inst.meta.side === INCIDENT.side && t > INCIDENT.from) v += (INCIDENT.rateToe * (t - INCIDENT.from)) / DAY;
      return { value: v + noise(inst.code, t, 1.5) };
    }
  }
  return null;
}

export function zoneDefByCode(code: string) {
  return ZONES.find((z) => z.code === code)!;
}
