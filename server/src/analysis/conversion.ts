// Konversi bacaan mentah → satuan teknik (F-INS-05, F-TLM-06, F-TLM-07).

export interface VwCalibration {
  kind: 'vw_poly' | 'vw_linear';
  /** digit = Hz²/1000. Polinomial: P = A·R² + B·R + C (satuan keluaran, mis. kPa). */
  A?: number;
  B: number;
  C?: number;
  /** Zero reading dalam digit, dipakai untuk bentuk linear: P = G·(R0 − R). */
  R0?: number;
  /** Faktor koreksi suhu (satuan/°C) dan suhu saat zero reading. */
  K?: number;
  T0?: number;
  /** Koreksi barometrik untuk sensor tak ber-vent: (satuan per kPa). */
  baroFactor?: number;
  P0baro?: number; // kPa, tekanan udara saat zero reading
}

export function hzToDigits(hz: number): number {
  return (hz * hz) / 1000;
}

/**
 * Konversi VW. Untuk kind = vw_linear: P = B·(R0 − R) + K·(T − T0) − baro·(Pb − Pb0).
 * Untuk vw_poly: P = A·R² + B·R + C + koreksi yang sama.
 */
export function convertVw(rawHz: number, tempC: number | null, cal: VwCalibration, baroKpa?: number | null): number {
  const R = hzToDigits(rawHz);
  let P: number;
  if (cal.kind === 'vw_linear') P = cal.B * ((cal.R0 ?? 0) - R);
  else P = (cal.A ?? 0) * R * R + cal.B * R + (cal.C ?? 0);
  if (cal.K != null && tempC != null && cal.T0 != null) P += cal.K * (tempC - cal.T0);
  if (cal.baroFactor != null && baroKpa != null && cal.P0baro != null) P -= cal.baroFactor * (baroKpa - cal.P0baro);
  return P;
}

/** Inversi linear untuk simulator: frekuensi yang memberi tekanan P (tanpa koreksi). */
export function pressureToHz(P: number, cal: VwCalibration): number {
  if (cal.kind !== 'vw_linear') throw new Error('Hanya vw_linear yang didukung untuk inversi');
  const R = (cal.R0 ?? 0) - P / cal.B;
  return Math.sqrt(R * 1000);
}

/**
 * Settlement cell hidrostatik: perubahan elevasi (mm, positif = turun) dari tekanan cairan (kPa).
 * Penurunan = (P − P0)/(ρg) dikurangi perubahan elevasi tangki referensi (F-TLM-07).
 */
export function liquidCellSettlement(pKpa: number, p0Kpa: number, fluidDensity = 1000, tankDeltaMm = 0): number {
  const dh = ((pKpa - p0Kpa) * 1000) / (fluidDensity * 9.80665); // m
  return dh * 1000 + tankDeltaMm;
}
