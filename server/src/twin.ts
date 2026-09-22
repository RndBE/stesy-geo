// Twin state builder (PRD 7.3) dan profil memanjang jalan (F-JLN-03/04/05/06).
import { getDb } from './db.js';
import {
  DAY, TZ_OFFSET, getZones, getStages, getLayers, getPvd, fillHeightAt, analyzeSettlement, zoneStatus, zoneInstruments,
  isCentreSettlement, dailySeries, meta, isStale, loadIncrements, consolidationParams, theoreticalFinal,
  type Instrument, type Zone, type SettlementAnalysis,
} from './domain.js';
import { hansboMu, influenceDiameter, stagedSettlement } from './analysis/consolidation.js';
import { hyperbolicAt } from './analysis/fitting.js';

const dayKey = (t: number) => Math.floor((t + TZ_OFFSET) / DAY);
const dayMid = (k: number) => k * DAY - TZ_OFFSET + DAY / 2;

/** Proyeksi penurunan ke waktu t dari hasil analisis (Asaoka → hiperbolik → teoretis). */
export function projectSettlement(a: SettlementAnalysis, lastT: number, t: number, z: Zone): { v: number; method: string } | null {
  if (a.current == null) return null;
  if (a.asaoka?.valid) {
    const n = (t - lastT) / (a.asaoka.dtDays * DAY);
    const sf = a.asaoka.finalSettlement;
    return { v: sf - (sf - a.current) * Math.pow(a.asaoka.beta1, n), method: 'Asaoka' };
  }
  if (a.hyperbolic?.valid) return { v: hyperbolicAt(a.hyperbolic, t), method: 'hiperbolik' };
  const stages = getStages(z.id);
  const incs = loadIncrements(z, stages.map((s) => ({ ...s, actual_start: s.actual_start ?? s.planned_start, actual_end: s.actual_end ?? (s.actual_start ? null : s.planned_end) })), getLayers(z.id));
  const p = consolidationParams(z);
  const scale = a.theory.atNow > 0 ? a.current / a.theory.atNow : 1;
  return { v: a.current + (stagedSettlement(t, incs, p) - stagedSettlement(lastT, incs, p)) * scale, method: 'teoretis (terskala)' };
}

export function buildTwin(projectId: number, horizonDays = 180) {
  const db = getDb();
  const now = Date.now();
  const zones = getZones(projectId);
  const firstStart = Math.min(...zones.flatMap((z) => getStages(z.id).map((s) => s.actual_start ?? Infinity)));
  const k0 = dayKey(firstStart) - 7;
  const kNow = dayKey(now);
  const k1 = kNow + horizonDays;
  const days: number[] = [];
  for (let k = k0; k <= k1; k++) days.push(dayMid(k));
  const nowIndex = kNow - k0;

  const zoneOut = zones.map((z) => {
    const stages = getStages(z.id);
    const st = zoneStatus(z, now);
    return {
      id: z.id, code: z.code, name: z.name, sta_start: z.sta_start, sta_end: z.sta_end, is_transition: z.is_transition,
      ground_elev: z.ground_elev, crest_width: z.crest_width, slope_h: z.slope_h,
      design_fill_height: z.design_fill_height, surcharge_height: z.surcharge_height,
      decision: st.decision, U: st.U, phase: st.phase,
      fill: days.map((t, i) => +(i <= nowIndex ? fillHeightAt(stages, t) : fillHeightAt(stages.map((s) => ({ ...s, actual_start: s.actual_start ?? s.planned_start, actual_end: s.actual_end ?? s.planned_end })), t)).toFixed(3)),
      layers: getLayers(z.id).map((l) => ({ name: l.name, top: l.top_depth, bottom: l.bottom_depth, cu: l.cu })),
      pvd: getPvd(z.id),
    };
  });

  const insts = db.prepare('SELECT * FROM instrument WHERE project_id = ? ORDER BY sta, code').all(projectId) as Instrument[];
  const openAlarm = db.prepare(
    `SELECT level FROM alarm_event WHERE instrument_id = ? AND cleared_at IS NULL ORDER BY CASE level WHEN 'Bahaya' THEN 3 WHEN 'Siaga' THEN 2 ELSE 1 END DESC LIMIT 1`,
  );
  const health = db.prepare(
    `SELECT l.code, l.last_seen, h.battery_pct, h.rssi FROM logger_channel c JOIN logger l ON l.id = c.logger_id
     LEFT JOIN device_health h ON h.device_type = 'logger' AND h.device_id = l.id AND h.ts = (SELECT MAX(ts) FROM device_health WHERE device_type='logger' AND device_id = l.id)
     WHERE c.instrument_id = ? AND c.valid_to IS NULL`,
  );
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const instOut = insts.map((i) => {
    const series = dailySeries(i.id);
    const vals: (number | null)[] = days.map(() => null);
    for (const p of series) {
      const idx = dayKey(p.t) - k0;
      if (idx >= 0 && idx < vals.length) vals[idx] = +p.v.toFixed(2);
    }
    // isi celah hari tanpa data dengan nilai terakhir (histori)
    let last: number | null = null;
    for (let k = 0; k <= nowIndex; k++) { if (vals[k] != null) last = vals[k]; else if (last != null && k > 0 && series.length && days[k] > series[0].t) vals[k] = last; }
    const m = meta(i);
    let projMethod: string | null = null;
    const z = i.zone_id ? zoneById.get(i.zone_id) : undefined;
    if (z && ['SC', 'GN', 'SP', 'SAA'].includes(i.type) && series.length) {
      const a = analyzeSettlement(i, { at: now });
      const lastT = series[series.length - 1].t;
      for (let k = nowIndex + 1; k < days.length; k++) {
        const pr = projectSettlement(a, lastT, days[k], z);
        if (pr) { vals[k] = +pr.v.toFixed(1); projMethod = pr.method; }
      }
    } else if (z && i.type === 'PZ' && series.length) {
      const uh = m.u_hydro ?? 0;
      const ex = series[series.length - 1].v - uh;
      const pvd = getPvd(z.id);
      const De = pvd ? influenceDiameter(pvd) : 1;
      const mu = pvd ? hansboMu(pvd) : 1;
      for (let k = nowIndex + 1; k < days.length; k++) {
        const dtY = (days[k] - series[series.length - 1].t) / (365.25 * DAY);
        vals[k] = +(uh + ex * Math.exp((-8 * z.ch * dtY) / (mu * De * De))).toFixed(2);
      }
      projMethod = 'Hansbo (c_h zona)';
    }
    const h = health.get(i.id) as any;
    return {
      id: i.id, code: i.code, type: i.type, zone_id: i.zone_id, sta: i.sta, offset: i.offset, tip_depth: i.tip_depth,
      unit: i.unit, mode: i.mode, u_hydro: m.u_hydro ?? null, centre: isCentreSettlement(i),
      alarm: (openAlarm.get(i.id) as any)?.level ?? null, stale: i.mode === 'telemetry' ? isStale(i, now) : false,
      health: h ? { logger: h.code, battery: h.battery_pct, rssi: h.rssi, last_seen: h.last_seen } : null,
      values: vals, projection: projMethod,
    };
  });

  return { now, days, nowIndex, zones: zoneOut, instruments: instOut };
}

// ---------------------------------------------------------------- profil memanjang

function interpBySta(points: { sta: number; v: number }[], sta: number): number | null {
  if (!points.length) return null;
  const p = [...points].sort((a, b) => a.sta - b.sta);
  if (sta <= p[0].sta) return p[0].v;
  if (sta >= p[p.length - 1].sta) return p[p.length - 1].v;
  for (let i = 0; i < p.length - 1; i++) {
    if (sta >= p[i].sta && sta <= p[i + 1].sta) {
      const f = (sta - p[i].sta) / Math.max(1e-9, p[i + 1].sta - p[i].sta);
      return p[i].v + f * (p[i + 1].v - p[i].v);
    }
  }
  return null;
}

export const OPRIT_SLOPE_LIMIT = 0.004; // perubahan kemiringan memanjang maks (ilustratif, 0,4%)

export function longitudinal(projectId: number) {
  const db = getDb();
  const zones = getZones(projectId);
  const al = db.prepare('SELECT * FROM alignment WHERE project_id = ?').get(projectId) as any;
  const design: { sta: number; elev: number }[] = al ? JSON.parse(al.design_profile) : [];
  const now = Date.now();
  const statusByZone = new Map(zones.map((z) => [z.id, zoneStatus(z, now)]));

  const measured: { sta: number; v: number }[] = [];
  const final: { sta: number; v: number }[] = [];
  const finalDesign: { sta: number; v: number }[] = [];
  const points: { code: string; sta: number; S: number; Sf: number | null; method: string }[] = [];
  for (const z of zones) {
    const stages = getStages(z.id);
    const layers = getLayers(z.id);
    const total = stages.reduce((s, x) => s + x.thickness, 0);
    const ratio = theoreticalFinal(layers, z.design_fill_height) / Math.max(1e-9, theoreticalFinal(layers, total));
    // gunakan rata-rata instrumen as per STA
    const bySta = new Map<number, SettlementAnalysis[]>();
    for (const i of zoneInstruments(z.id).filter(isCentreSettlement)) {
      const a = analyzeSettlement(i, { at: now });
      if (a.current == null) continue;
      bySta.set(i.sta!, [...(bySta.get(i.sta!) ?? []), a]);
    }
    for (const [sta, as] of bySta) {
      const S = as.reduce((s, a) => s + a.current!, 0) / as.length;
      const fins = as.map((a) => a.final_asaoka ?? a.final_hyper ?? (a.theory.final * (a.theory.atNow > 0 ? a.current! / a.theory.atNow : 1)));
      const Sf = fins.reduce((s, v) => s + v, 0) / fins.length;
      measured.push({ sta, v: S });
      final.push({ sta, v: Sf });
      finalDesign.push({ sta, v: Sf * ratio });
      points.push({ code: as.map((a) => a.code).join(', '), sta, S, Sf, method: as[0].final_asaoka != null ? 'Asaoka' : as[0].final_hyper != null ? 'hiperbolik' : 'teoretis' });
    }
  }

  const stations: {
    sta: number; zone: string; design_elev: number; ground_elev: number; base_elev: number; top_elev: number;
    base_final_elev: number | null; settlement: number; final_settlement: number | null; residual: number | null;
    compensation: number | null; compensation_volume: number | null;
  }[] = [];
  for (let sta = zones[0].sta_start; sta <= zones[zones.length - 1].sta_end; sta += 25) {
    const z = zones.find((x) => sta >= x.sta_start && sta < x.sta_end) ?? zones[zones.length - 1];
    const stages = getStages(z.id);
    const H = fillHeightAt(stages, now);
    const S = interpBySta(measured, sta) ?? 0;
    const Sf = interpBySta(final, sta);
    const SfD = interpBySta(finalDesign, sta);
    const dElev = interpBySta(design.map((d) => ({ sta: d.sta, v: d.elev })), sta) ?? 0;
    const surcharge = stages.filter((s) => s.is_surcharge).reduce((a, s) => a + s.thickness, 0);
    const permanentH = stages.reduce((a, s) => a + s.thickness, 0) - surcharge;
    // elevasi puncak timbunan permanen setelah penurunan akhir di bawah beban rencana
    const finalTop = SfD != null ? z.ground_elev - Math.max(SfD, S) / 1000 + permanentH : null;
    const compensation = finalTop != null ? Math.max(0, dElev - finalTop) : null;
    stations.push({
      sta, zone: z.code, design_elev: dElev, ground_elev: z.ground_elev,
      base_elev: +(z.ground_elev - S / 1000).toFixed(3),
      top_elev: +(z.ground_elev - S / 1000 + H).toFixed(3),
      base_final_elev: Sf != null ? +(z.ground_elev - Sf / 1000).toFixed(3) : null,
      settlement: +S.toFixed(0), final_settlement: Sf != null ? +Sf.toFixed(0) : null,
      residual: Sf != null ? +Math.max(0, (SfD ?? Sf) - S).toFixed(0) : null,
      compensation: compensation != null ? +compensation.toFixed(3) : null,
      compensation_volume: compensation != null ? +(compensation * z.crest_width * 25).toFixed(0) : null,
    });
  }

  // perubahan kemiringan memanjang akibat penurunan sisa (modul oprit)
  const oprit = zones.filter((z) => z.is_transition).map((z) => {
    const st = stations.filter((s) => s.sta >= z.sta_start && s.sta <= z.sta_end);
    const segs = [];
    for (let i = 0; i < st.length - 1; i++) {
      const dx = st[i + 1].sta - st[i].sta;
      const dRes = ((st[i + 1].residual ?? 0) - (st[i].residual ?? 0)) / 1000;
      segs.push({ from: st[i].sta, to: st[i + 1].sta, slope_change: dRes / dx, ok: Math.abs(dRes / dx) <= OPRIT_SLOPE_LIMIT });
    }
    return { zone: z.code, limit: OPRIT_SLOPE_LIMIT, segments: segs };
  });

  const strip = [];
  for (let s = zones[0].sta_start; s < zones[zones.length - 1].sta_end; s += 100) {
    const z = zones.find((x) => s >= x.sta_start && s < x.sta_end)!;
    const st = statusByZone.get(z.id)!;
    strip.push({ from: s, to: Math.min(s + 100, z.sta_end), zone: z.code, zone_id: z.id, decision: st.decision, U: st.U, fillHeight: st.fillHeight });
  }
  return { stations, points, strip, oprit };
}
