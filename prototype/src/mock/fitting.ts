// Metode observasional — PRD 5.2 (a) Asaoka dan (b) hiperbolik, plus back-analysis c_h (F-ANL-07).
import { stagedSettlement, type ConsolidationParams, type LoadIncrement } from './consolidation.js';

export interface Point {
  t: number; // ms epoch
  v: number;
}

const DAY = 86400e3;

export interface LinReg {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

export function linearRegression(xs: number[], ys: number[]): LinReg {
  const n = xs.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN, n };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? NaN : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - (intercept + slope * xs[i]);
    ssRes += e * e;
  }
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n };
}

/** Resample ke interval konstan Δt memakai interpolasi linear (PRD 5.2a). */
export function resample(points: Point[], dtMs: number, from?: number, to?: number): Point[] {
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (pts.length < 2) return pts;
  const start = from ?? pts[0].t;
  const end = to ?? pts[pts.length - 1].t;
  const out: Point[] = [];
  let j = 0;
  for (let t = start; t <= end + 1; t += dtMs) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1];
    if (t < a.t || t > b.t) {
      if (t < pts[0].t || t > pts[pts.length - 1].t) continue;
    }
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push({ t, v: a.v + f * (b.v - a.v) });
  }
  return out;
}

/** Rata-rata harian — data telemetri berfrekuensi tinggi dirangkum sebelum analisis (PRD 8.6). */
export function dailyMean(points: Point[], tzOffsetMs = 7 * 3600e3): Point[] {
  const buckets = new Map<number, { s: number; n: number }>();
  for (const p of points) {
    const day = Math.floor((p.t + tzOffsetMs) / DAY) * DAY - tzOffsetMs + DAY / 2;
    const b = buckets.get(day) ?? { s: 0, n: 0 };
    b.s += p.v; b.n++;
    buckets.set(day, b);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ t, v: b.s / b.n }));
}

export interface AsaokaResult {
  method: 'asaoka';
  dtDays: number;
  beta0: number;
  beta1: number;
  r2: number;
  n: number;
  finalSettlement: number; // mm
  currentSettlement: number;
  U: number;
  pairs: { x: number; y: number }[];
  /** c_v ekuivalen dari β1 (Magnan & Deroy) jika drainase vertikal saja — informatif. */
  valid: boolean;
  message?: string;
}

export function asaoka(points: Point[], dtDays: number, from?: number, to?: number): AsaokaResult {
  const sel = points.filter((p) => (from == null || p.t >= from) && (to == null || p.t <= to));
  const rs = resample(sel, dtDays * DAY);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 1; i < rs.length; i++) {
    xs.push(rs[i - 1].v);
    ys.push(rs[i].v);
  }
  const reg = linearRegression(xs, ys);
  const current = sel.length ? sel[sel.length - 1].v : NaN;
  const base = {
    method: 'asaoka' as const, dtDays, beta0: reg.intercept, beta1: reg.slope, r2: reg.r2, n: reg.n,
    pairs: xs.map((x, i) => ({ x, y: ys[i] })), currentSettlement: current,
  };
  if (reg.n < 3) return { ...base, finalSettlement: NaN, U: NaN, valid: false, message: 'Data kurang dari 4 titik setelah resampling' };
  if (!(reg.slope > 0 && reg.slope < 1)) {
    return { ...base, finalSettlement: NaN, U: NaN, valid: false, message: `β₁ = ${reg.slope.toFixed(3)} di luar (0, 1): data belum menunjukkan perlambatan` };
  }
  const final = reg.intercept / (1 - reg.slope);
  return { ...base, finalSettlement: final, U: current / final, valid: true };
}

export interface HyperbolicResult {
  method: 'hiperbolik';
  t0: number;
  s0: number;
  alpha: number;
  beta: number;
  r2: number;
  n: number;
  finalSettlement: number;
  currentSettlement: number;
  U: number;
  points: { t: number; y: number }[];
  valid: boolean;
  message?: string;
}

/**
 * Hiperbolik (Tan 1971): (t)/(ρ − ρ0) = α + β t, dengan t sejak beban konstan (t0)
 * dan ρ0 penurunan pada t0. ρ_akhir = ρ0 + 1/β.
 */
export function hyperbolic(points: Point[], t0: number, to?: number): HyperbolicResult {
  const sel = points.filter((p) => p.t >= t0 && (to == null || p.t <= to)).sort((a, b) => a.t - b.t);
  const s0 = sel.length ? sel[0].v : NaN;
  const xs: number[] = [], ys: number[] = [];
  for (const p of sel) {
    const td = (p.t - t0) / DAY;
    const ds = p.v - s0;
    if (td < 1 || ds <= 0.5) continue;
    xs.push(td);
    ys.push(td / ds);
  }
  const reg = linearRegression(xs, ys);
  const current = sel.length ? sel[sel.length - 1].v : NaN;
  const base = {
    method: 'hiperbolik' as const, t0, s0, alpha: reg.intercept, beta: reg.slope, r2: reg.r2, n: reg.n,
    currentSettlement: current, points: xs.map((x, i) => ({ t: x, y: ys[i] })),
  };
  if (reg.n < 4) return { ...base, finalSettlement: NaN, U: NaN, valid: false, message: 'Data setelah beban konstan kurang dari 4 titik' };
  if (xs[xs.length - 1] < 14) return { ...base, finalSettlement: NaN, U: NaN, valid: false, message: 'Beban konstan baru < 14 hari; hiperbolik belum stabil' };
  if (!(reg.slope > 0)) return { ...base, finalSettlement: NaN, U: NaN, valid: false, message: 'Kemiringan β ≤ 0' };
  const final = s0 + 1 / reg.slope;
  return { ...base, finalSettlement: final, U: current / final, valid: true };
}

/** Prediksi hiperbolik pada waktu t (ms). */
export function hyperbolicAt(r: HyperbolicResult, t: number): number {
  const td = (t - r.t0) / DAY;
  if (td <= 0) return r.s0;
  return r.s0 + td / (r.alpha + r.beta * td);
}

/** Prediksi Asaoka ke depan secara rekursif (langkah Δt). */
export function asaokaForecast(r: AsaokaResult, lastT: number, lastV: number, untilT: number): Point[] {
  const out: Point[] = [];
  let v = lastV;
  for (let t = lastT + r.dtDays * DAY; t <= untilT; t += r.dtDays * DAY) {
    v = r.beta0 + r.beta1 * v;
    out.push({ t, v });
  }
  return out;
}

export interface BackAnalysisResult {
  ch: number;
  rmse: number;
  chLow: number;
  chHigh: number;
  curve: { ch: number; rmse: number }[];
  scale: number;
}

/**
 * Back-analysis c_h dengan least squares (grid search + penyempurnaan golden section).
 * Besaran penurunan akhir juga diskalakan (faktor `scale`) karena S_akhir desain punya ketidakpastian.
 */
export function backAnalyzeCh(
  obs: Point[],
  increments: LoadIncrement[],
  base: ConsolidationParams,
  chRange: [number, number] = [0.3, 12],
  tolMm = 3,
): BackAnalysisResult {
  const daily = dailyMean(obs);
  const evalCh = (ch: number) => {
    const p = { ...base, ch };
    const model = daily.map((o) => stagedSettlement(o.t, increments, p));
    // skala optimum tertutup: min Σ(o − k·m)² → k = Σom/Σmm
    let om = 0, mm = 0;
    for (let i = 0; i < daily.length; i++) { om += daily[i].v * model[i]; mm += model[i] * model[i]; }
    const k = mm > 0 ? om / mm : 1;
    let se = 0;
    for (let i = 0; i < daily.length; i++) { const e = daily[i].v - k * model[i]; se += e * e; }
    return { rmse: Math.sqrt(se / Math.max(1, daily.length)), k };
  };
  const curve: { ch: number; rmse: number }[] = [];
  const steps = 40;
  const lr0 = Math.log(chRange[0]), lr1 = Math.log(chRange[1]);
  let best = { ch: NaN, rmse: Infinity, k: 1 };
  for (let i = 0; i <= steps; i++) {
    const ch = Math.exp(lr0 + ((lr1 - lr0) * i) / steps);
    const r = evalCh(ch);
    curve.push({ ch, rmse: r.rmse });
    if (r.rmse < best.rmse) best = { ch, ...r };
  }
  // golden section di sekitar minimum grid
  let a = best.ch / 1.2, b = best.ch * 1.2;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 30; it++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (evalCh(c).rmse < evalCh(d).rmse) b = d; else a = c;
  }
  const chOpt = (a + b) / 2;
  const opt = evalCh(chOpt);
  // Rentang: c_h dengan RMSE ≤ max(1,1 × RMSE_min, RMSE_min + tolUkurMm), dipindai halus di sekitar optimum.
  const tol = Math.max(opt.rmse * 1.1, opt.rmse + tolMm);
  let chLow = chOpt, chHigh = chOpt;
  for (let i = 1; i <= 200; i++) {
    const lo = chOpt * Math.pow(0.5, i / 200);
    if (evalCh(lo).rmse <= tol) chLow = lo; else break;
  }
  for (let i = 1; i <= 200; i++) {
    const hi = chOpt * Math.pow(2, i / 200);
    if (evalCh(hi).rmse <= tol) chHigh = hi; else break;
  }
  return { ch: chOpt, rmse: opt.rmse, scale: opt.k, chLow, chHigh, curve };
}

/** Laju (satuan/hari) dengan regresi linear pada jendela waktu. */
export function rate(points: Point[], windowMs: number, at?: number): number {
  const end = at ?? (points.length ? points[points.length - 1].t : 0);
  const sel = points.filter((p) => p.t > end - windowMs && p.t <= end);
  if (sel.length < 2) return NaN;
  const reg = linearRegression(sel.map((p) => (p.t - end) / DAY), sel.map((p) => p.v));
  return reg.slope;
}
