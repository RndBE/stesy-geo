import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  terzaghiUv, hansboMu, hansboTimeForUh, influenceDiameter, drainDiameter, combinedU, piezoU,
  type PvdGeometry,
} from './consolidation.js';
import { asaoka, hyperbolic, linearRegression, resample, backAnalyzeCh, type Point } from './fitting.js';
import { convertVw, pressureToHz, liquidCellSettlement, type VwCalibration } from './conversion.js';

const DAY = 86400e3;
const pvd: PvdGeometry = { pattern: 'segitiga', spacing: 1.2, a: 100, b: 4, s: 2, khKs: 2 };

test('Terzaghi U_v: nilai tabel standar', () => {
  assert.ok(Math.abs(terzaghiUv(0.197) - 0.5) < 0.005);
  assert.ok(Math.abs(terzaghiUv(0.848) - 0.9) < 0.005);
  assert.equal(terzaghiUv(0), 0);
});

test('Contoh PRD 9.2: D_e, d_w, μ, dan t90 ≈ 5,7 bulan', () => {
  assert.ok(Math.abs(influenceDiameter(pvd) - 1.26) < 1e-9);
  assert.ok(Math.abs(drainDiameter(pvd) - 0.052) < 1e-9);
  const mu = hansboMu(pvd);
  assert.ok(Math.abs(mu - 3.13) < 0.01, `μ = ${mu}`);
  const t = hansboTimeForUh(0.9, 3, pvd);
  assert.ok(Math.abs(t - 0.48) < 0.01, `t = ${t}`);
  assert.ok(Math.abs(t * 12 - 5.7) < 0.15);
});

test('Carrillo menggabungkan U_v dan U_h', () => {
  const r = combinedU(0.5, { cv: 1.5, ch: 3, Hdr: 7, pvd });
  assert.ok(Math.abs(r.U - (1 - (1 - r.Uv) * (1 - r.Uh))) < 1e-12);
  assert.ok(r.U > r.Uh && r.Uh > r.Uv);
});

test('Piezometer U', () => {
  assert.equal(piezoU(20, 80), 0.75);
  assert.equal(piezoU(-5, 80), 1);
});

test('Regresi linear', () => {
  const r = linearRegression([0, 1, 2, 3], [1, 3, 5, 7]);
  assert.ok(Math.abs(r.slope - 2) < 1e-12 && Math.abs(r.intercept - 1) < 1e-12 && Math.abs(r.r2 - 1) < 1e-12);
});

// Kurva eksponensial ideal: ρ(t) = ρf (1 − e^{−kt}) memenuhi Asaoka secara eksak.
const synth = (rf: number, k: number, days: number): Point[] =>
  Array.from({ length: days }, (_, i) => ({ t: i * DAY, v: rf * (1 - Math.exp(-k * i)) }));

test('Asaoka memulihkan penurunan akhir kurva eksponensial', () => {
  const r = asaoka(synth(1500, 0.02, 120), 7);
  assert.ok(r.valid);
  assert.ok(Math.abs(r.finalSettlement - 1500) < 1, `final ${r.finalSettlement}`);
  assert.ok(Math.abs(r.beta1 - Math.exp(-0.02 * 7)) < 1e-6);
});

test('Hiperbolik memulihkan kurva hiperbolik ideal', () => {
  const t0 = 10 * DAY;
  const pts: Point[] = [];
  for (let d = 0; d <= 150; d++) pts.push({ t: t0 + d * DAY, v: 200 + d / (0.05 + d / 800) });
  const r = hyperbolic(pts, t0);
  assert.ok(r.valid);
  assert.ok(Math.abs(r.finalSettlement - 1000) < 1, `final ${r.finalSettlement}`);
});

test('Resample interval konstan', () => {
  const r = resample([{ t: 0, v: 0 }, { t: 10 * DAY, v: 10 }], 2 * DAY);
  assert.deepEqual(r.map((p) => p.v), [0, 2, 4, 6, 8, 10]);
});

test('Back-analysis memulihkan c_h sintetis', () => {
  const p = { cv: 1.5, ch: 2.2, Hdr: 7, pvd };
  const incs = [{ t0: 0, finalSettlement: 800 }, { t0: 40 * DAY, finalSettlement: 600 }];
  const obs: Point[] = [];
  for (let d = 1; d < 200; d++) {
    const t = d * DAY;
    let s = 0;
    for (const inc of incs) s += inc.finalSettlement * combinedU((t - inc.t0) / (365.25 * DAY), p).U;
    obs.push({ t, v: s });
  }
  const r = backAnalyzeCh(obs, incs, { ...p, ch: 3 });
  assert.ok(Math.abs(r.ch - 2.2) < 0.05, `ch ${r.ch}`);
  assert.ok(r.chLow <= r.ch && r.chHigh >= r.ch);
});

test('Konversi VW linear bolak-balik & koreksi', () => {
  const cal: VwCalibration = { kind: 'vw_linear', B: 0.1, R0: 8500, K: 0.05, T0: 28, baroFactor: 1, P0baro: 101 };
  const hz = pressureToHz(120, cal);
  assert.ok(Math.abs(convertVw(hz, 28, cal, 101) - 120) < 1e-9);
  assert.ok(Math.abs(convertVw(hz, 30, cal, 101) - 120.1) < 1e-9);
  assert.ok(Math.abs(convertVw(hz, 28, cal, 102) - 119) < 1e-9);
});

test('Settlement cell hidrostatik', () => {
  assert.ok(Math.abs(liquidCellSettlement(9.80665, 0) - 1000) < 1e-9);
  assert.ok(Math.abs(liquidCellSettlement(9.80665, 0, 1000, -3) - 997) < 1e-9);
});
