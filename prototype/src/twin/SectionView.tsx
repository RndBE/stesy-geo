// Irisan penampang (F-DT-04, 9.6): stratigrafi, PVD, timbunan, cekungan penurunan, kontur Δu, profil inklinometer & SAAX.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { sta as staFmt, num, date } from '../lib/format';
import { offsetFactor, rampColor, RAMPS, type TwinData } from './scene';

const LAYER_FILL = ['#7d6a4b', '#4b5a52', '#5c6a5e', '#8f8a6e'];

export function SectionView({ twin, sta, ti, exag = 2 }: { twin: TwinData; sta: number; ti: number; exag?: number }) {
  const zone = twin.zones.find((z) => sta >= z.sta_start && sta < z.sta_end) ?? twin.zones[twin.zones.length - 1];
  const t = twin.days[ti];
  const near = twin.instruments.filter((i) => Math.abs(i.sta - sta) <= 12);
  const incs = near.filter((i) => i.type === 'INC' || i.type === 'SAA');
  const [profiles, setProfiles] = useState<Record<number, { pos: number; value: number }[]>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(incs.map((i) => api(`/instruments/${i.id}/profiles?dates=${Math.min(t, Date.now())}`).then((r) => [i.id, r.profiles?.[0]?.points ?? []] as const)))
      .then((rs) => { if (alive) setProfiles(Object.fromEntries(rs)); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sta, Math.floor(t / 86400e3), incs.map((i) => i.id).join(',')]);

  const H = zone.fill[ti] ?? 0;
  const half = zone.crest_width / 2;
  const toe = half + zone.slope_h * H;
  // penurunan as dari instrumen penurunan terdekat (as) di penampang
  const centre = twin.instruments.filter((i) => ['SC', 'GN'].includes(i.type) && Math.abs(i.offset) <= 6 && i.values[ti] != null)
    .sort((a, b) => Math.abs(a.sta - sta) - Math.abs(b.sta - sta))[0];
  const Sc = centre ? (centre.values[ti]! / offsetFactor(centre.offset, zone)) : 0;

  const W = 760, Hh = 360;
  const offMin = -45, offMax = 45, dMax = 22, eTop = 7.5;
  const X = (o: number) => 30 + ((o - offMin) / (offMax - offMin)) * (W - 60);
  const Y = (elevRel: number) => 20 + ((eTop - elevRel) / (eTop + dMax)) * (Hh - 50) * (elevRel < 0 ? 1 : 1);
  const Yd = (depth: number) => Y(-depth);
  const settleAt = (o: number) => (Sc * offsetFactor(o, zone)) / 1000;

  // kontur Δu (interpolasi IDW) dari piezometer penampang ini
  const pz = near.filter((i) => i.type === 'PZ' && i.values[ti] != null).map((i) => ({ o: i.offset, d: i.tip_depth ?? 9, v: i.values[ti]! - (i.u_hydro ?? 0) }));
  const cells = useMemo(() => {
    if (!pz.length) return [];
    const src = [...pz, { o: 0, d: 2, v: 0 }, { o: 0, d: 16.5, v: 0 }, { o: -toe - 12, d: 9, v: 0 }, { o: toe + 12, d: 9, v: 0 }];
    const out: { o: number; d: number; v: number }[] = [];
    for (let o = offMin; o < offMax; o += 2) for (let d = 2; d < 16; d += 1) {
      let ws = 0, vs = 0;
      for (const p of src) { const dist = Math.hypot((p.o - (o + 1)) / 3, p.d - (d + 0.5)) + 0.5; const w = 1 / dist ** 2; ws += w; vs += w * p.v; }
      out.push({ o, d, v: vs / ws });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pz), toe]);
  const duMax = Math.max(20, ...pz.map((p) => p.v));

  const basePts: string[] = [];
  for (let o = offMin; o <= offMax; o += 1) basePts.push(`${X(o)},${Y(-settleAt(o) * exag)}`);
  const emb = [[-toe, 0], [-half, H], [half, H], [toe, 0]].map(([o, h]) => `${X(o)},${Y(h - settleAt(o) * exag)}`);
  const embBase = [];
  for (let o = toe; o >= -toe; o -= 1) embBase.push(`${X(o)},${Y(-settleAt(o) * exag)}`);

  const pvdOffsets: number[] = [];
  for (let o = -toe + 0.6; o < toe; o += 1.2) pvdOffsets.push(o);

  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="mono b">STA {staFmt(sta)}</span>
        <span className="muted">{zone.code} · {date(t)} · H = {num(H, 2)} m · S as ≈ {num(Sc)} mm (eksagerasi penurunan {exag}×)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: '100%', display: 'block', font: '10px IBM Plex Mono, monospace' }}>
        {zone.layers.map((l, i) => (
          <g key={l.name}>
            <rect x={X(offMin)} y={Yd(l.top)} width={X(offMax) - X(offMin)} height={Yd(Math.min(l.bottom, dMax)) - Yd(l.top)} fill={LAYER_FILL[i % 4]} opacity={0.55} />
            <text x={X(offMax) - 4} y={Yd(l.top) + 11} textAnchor="end" fill="var(--text)" opacity={0.85}>{l.name}{l.cu ? ` · cu ${l.cu} kPa` : ''}</text>
            <text x={X(offMin) + 3} y={Yd(l.top) + 10} fill="var(--text-2)">{l.top.toFixed(0)} m</text>
          </g>
        ))}
        {cells.map((c, k) => (
          <rect key={k} x={X(c.o)} y={Yd(c.d)} width={X(c.o + 2) - X(c.o) + 0.5} height={Yd(c.d + 1) - Yd(c.d) + 0.5}
            fill={'#' + rampColor(RAMPS.pori, c.v / duMax).getHexString()} opacity={Math.min(0.75, 0.15 + c.v / duMax)} />
        ))}
        {pvdOffsets.map((o) => <line key={o} x1={X(o)} x2={X(o)} y1={Yd(0)} y2={Yd(16)} stroke="var(--s1)" strokeWidth={0.5} opacity={0.35} />)}
        <polygon points={[...emb, ...embBase].join(' ')} fill="#9c8a66" opacity={0.75} stroke="#c4b08a" strokeWidth={0.8} />
        <polyline points={basePts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.4} />
        <line x1={X(offMin)} x2={X(offMax)} y1={Y(0)} y2={Y(0)} stroke="var(--text-2)" strokeDasharray="3 3" strokeWidth={0.8} />
        {/* garis dimensi lebar puncak & tinggi */}
        {H > 0.1 && <g stroke="var(--text-2)" fill="var(--text-2)">
          <line x1={X(-half)} x2={X(half)} y1={Y(H) - 14} y2={Y(H) - 14} strokeWidth={0.7} />
          <line x1={X(-half)} x2={X(-half)} y1={Y(H) - 18} y2={Y(H) - 4} strokeWidth={0.7} />
          <line x1={X(half)} x2={X(half)} y1={Y(H) - 18} y2={Y(H) - 4} strokeWidth={0.7} />
          <text x={X(0)} y={Y(H) - 17} textAnchor="middle" stroke="none">{zone.crest_width.toFixed(1)} m</text>
          <line x1={X(toe) + 10} x2={X(toe) + 10} y1={Y(0)} y2={Y(H)} strokeWidth={0.7} />
          <text x={X(toe) + 14} y={(Y(0) + Y(H)) / 2} stroke="none">H {H.toFixed(2)} m</text>
        </g>}
        {pz.map((p, k) => (
          <g key={k}>
            <circle cx={X(p.o)} cy={Yd(p.d)} r={4} fill={'#' + rampColor(RAMPS.pori, p.v / duMax).getHexString()} stroke="#0f1419" />
            <text x={X(p.o) + 7} y={Yd(p.d) + 3} fill="var(--text)">Δu {p.v.toFixed(1)} kPa</text>
          </g>
        ))}
        {incs.map((i) => {
          const pts = profiles[i.id] ?? [];
          if (i.type === 'SAA') {
            return <polyline key={i.id} points={pts.map((p) => `${X(p.pos)},${Y(-(p.value / 1000) * exag) + 1}`).join(' ')} fill="none" stroke="var(--s2)" strokeWidth={1.6} />;
          }
          const scale = 0.03; // m offset per mm
          const dir = i.offset < 0 ? -1 : 1;
          return (
            <g key={i.id}>
              <line x1={X(i.offset)} x2={X(i.offset)} y1={Yd(0)} y2={Yd(20)} stroke="var(--text-3)" strokeWidth={0.8} />
              <polyline points={pts.map((p) => `${X(i.offset + dir * p.value * scale)},${Yd(p.pos)}`).join(' ')} fill="none" stroke="var(--s3)" strokeWidth={1.6} />
              <text x={X(i.offset) + dir * 4} y={Yd(20.8)} textAnchor={dir < 0 ? 'end' : 'start'} fill="var(--s3)">{i.code} maks {num(Math.max(0, ...pts.map((p) => p.value)))} mm</text>
            </g>
          );
        })}
        {/* skala grafis & label */}
        <g transform={`translate(${X(offMin) + 4},${Hh - 12})`} fill="var(--text-2)">
          <rect x={0} y={-4} width={X(offMin + 10) - X(offMin)} height={3} fill="var(--text-2)" />
          <text x={0} y={8}>0</text><text x={X(offMin + 10) - X(offMin)} y={8} textAnchor="end">10 m</text>
        </g>
        <g transform={`translate(${W - 390},${Hh - 8})`} fill="var(--text-2)">
          <text fill="var(--accent)">— dasar timbunan (interp.)</text>
          <text x={150} fill="var(--s2)">— SAAX</text>
          <text x={205} fill="var(--s3)">— inklinometer (1 mm ≙ 3 cm)</text>
        </g>
      </svg>
      <div className="muted" style={{ fontSize: 11 }}>Kontur Δu = interpolasi IDW dari piezometer penampang (bukan hasil FEM). PVD digambar tiap 1,2 m sampai kedalaman 16 m.</div>
    </div>
  );
}
