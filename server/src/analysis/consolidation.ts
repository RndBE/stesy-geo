// Teori konsolidasi — PRD 5.2 (c), (d) dan contoh 9.2.
// Semua satuan SI: waktu dalam tahun untuk c_v/c_h (m²/tahun), panjang dalam meter.

export const ALGO_VERSION = 'stesygeo-analysis/1.0.0';

/** Derajat konsolidasi vertikal rata-rata Terzaghi dari T_v (solusi deret). */
export function terzaghiUv(Tv: number): number {
  if (Tv <= 0) return 0;
  // Untuk U_v < 0,5 solusi √(4T_v/π) identik dengan deret hingga ~1e-4 dan jauh lebih cepat.
  if (Tv < 0.19) return Math.sqrt((4 * Tv) / Math.PI);
  let sum = 0;
  for (let m = 0; m < 200; m++) {
    const M = (Math.PI / 2) * (2 * m + 1);
    const term = (2 / (M * M)) * Math.exp(-M * M * Tv);
    sum += term;
    if (term < 1e-12) break;
  }
  return Math.min(1, Math.max(0, 1 - sum));
}

export interface PvdGeometry {
  pattern: 'segitiga' | 'persegi';
  spacing: number; // m
  a: number; // lebar PVD, mm
  b: number; // tebal PVD, mm
  s: number; // rasio d_s/d_w (smear)
  khKs: number; // k_h/k_s
}

/** Diameter pengaruh D_e (m). */
export function influenceDiameter(g: Pick<PvdGeometry, 'pattern' | 'spacing'>): number {
  return (g.pattern === 'segitiga' ? 1.05 : 1.128) * g.spacing;
}

/** Diameter ekuivalen drain d_w (m) = (a + b) / 2. */
export function drainDiameter(g: Pick<PvdGeometry, 'a' | 'b'>): number {
  return (g.a + g.b) / 2 / 1000;
}

/** Faktor μ Hansbo (1981), tanpa well resistance. */
export function hansboMu(g: PvdGeometry): number {
  const n = influenceDiameter(g) / drainDiameter(g);
  return Math.log(n / g.s) + g.khKs * Math.log(g.s) - 0.75;
}

export function hansboUh(Th: number, mu: number): number {
  if (Th <= 0) return 0;
  return 1 - Math.exp((-8 * Th) / mu);
}

/** Waktu (tahun) untuk mencapai U_h target. */
export function hansboTimeForUh(Uh: number, ch: number, g: PvdGeometry): number {
  const mu = hansboMu(g);
  const De = influenceDiameter(g);
  const Th = (-Math.log(1 - Uh) * mu) / 8;
  return (Th * De * De) / ch;
}

export interface ConsolidationParams {
  cv: number; // m²/tahun
  ch: number; // m²/tahun
  Hdr: number; // panjang drainase vertikal, m
  pvd: PvdGeometry | null;
}

/** U gabungan Carrillo pada waktu t (tahun) sejak beban diterapkan. */
export function combinedU(tYears: number, p: ConsolidationParams): { Uv: number; Uh: number; U: number } {
  if (tYears <= 0) return { Uv: 0, Uh: 0, U: 0 };
  const Uv = terzaghiUv((p.cv * tYears) / (p.Hdr * p.Hdr));
  let Uh = 0;
  if (p.pvd) {
    const De = influenceDiameter(p.pvd);
    Uh = hansboUh((p.ch * tYears) / (De * De), hansboMu(p.pvd));
  }
  return { Uv, Uh, U: 1 - (1 - Uv) * (1 - Uh) };
}

export interface LoadIncrement {
  t0: number; // ms epoch — waktu beban diterapkan (tengah tahap)
  finalSettlement: number; // mm, penurunan akhir akibat inkremen ini
}

/**
 * Kurva penurunan teoretis untuk beban bertahap: superposisi tiap inkremen
 * dengan U(t − t_i). Pendekatan beban seketika per tahap.
 */
export function stagedSettlement(t: number, increments: LoadIncrement[], p: ConsolidationParams): number {
  let s = 0;
  for (const inc of increments) {
    const dtYears = (t - inc.t0) / (365.25 * 86400e3);
    s += inc.finalSettlement * combinedU(dtYears, p).U;
  }
  return s;
}

/** Penurunan konsolidasi primer 1D (m) untuk satu lapisan NC: C_c·H/(1+e0)·log10((σ'0+Δσ)/σ'0). */
export function primarySettlementNC(H: number, Cc: number, e0: number, sigma0: number, dSigma: number): number {
  return ((Cc * H) / (1 + e0)) * Math.log10((sigma0 + dSigma) / sigma0);
}

/** Derajat konsolidasi dari piezometer — PRD 5.2(d). */
export function piezoU(excessNow: number, excessInitial: number): number {
  if (excessInitial <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - excessNow / excessInitial));
}
