// Konversi UTM → WGS84 (lintang/bujur) untuk peta 2D. Proyek memakai UTM zona 49S (EPSG:32749).
const a = 6378137;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const e2 = f * (2 - f);
const ep2 = e2 / (1 - e2);

export function utmToLngLat(E: number, N: number, zone = 49, south = true): [number, number] {
  const x = E - 500000;
  const y = south ? N - 10000000 : N;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const T1 = t * t;
  const C1 = ep2 * c * c;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5);
  const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Alignment sederhana: interpolasi STA/offset → UTM dari geometri [{sta,x,y}]. */
export function staOffsetToXY(geom: { sta: number; x: number; y: number }[], sta: number, offset: number): { x: number; y: number } {
  let i = 0;
  while (i < geom.length - 2 && geom[i + 1].sta < sta) i++;
  const p = geom[i], q = geom[i + 1] ?? geom[i];
  const L = Math.max(1e-9, q.sta - p.sta);
  const f = (sta - p.sta) / L;
  const dx = (q.x - p.x) / L, dy = (q.y - p.y) / L;
  // normal kanan terhadap arah stationing
  return { x: p.x + f * (q.x - p.x) + offset * dy, y: p.y + f * (q.y - p.y) - offset * dx };
}
