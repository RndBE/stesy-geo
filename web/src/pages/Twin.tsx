// Layar 2 — Digital Twin (PRD 7, 9.6).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Crosshair, Map as MapIcon, Scissors, RotateCcw, Info } from 'lucide-react';
import { useApi } from '../api';
import { TwinScene, RAMPS, type Mode, type TwinData, type TwinInst } from '../twin/scene';
import { SectionView } from '../twin/SectionView';
import { MapView } from '../components/MapView';
import { DECISION_META, Level, Loading, ErrorBox } from '../components/ui';
import { sta as staFmt, num, date, offsetLabel, ago } from '../lib/format';
import { decisionHex, levelHex } from './Overview';

const MODES: { value: Mode; label: string; unit: string }[] = [
  { value: 'penurunan', label: 'Penurunan', unit: 'mm' },
  { value: 'U', label: 'Derajat konsolidasi', unit: '%' },
  { value: 'pori', label: 'Tekanan pori ekses', unit: 'kPa' },
  { value: 'lateral', label: 'Deformasi lateral', unit: 'mm' },
  { value: 'alarm', label: 'Status alarm', unit: '' },
  { value: 'kesehatan', label: 'Kesehatan telemetri', unit: '' },
];

export default function Twin() {
  const { data, error } = useApi<TwinData>('/projects/1/twin?horizon=180', [], ['zones']);
  const lp = useApi<any>('/projects/1/longitudinal');
  const insts = useApi<any[]>('/instruments?project=1');
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const [mode, setMode] = useState<Mode>('penurunan');
  const [ti, setTi] = useState(0);
  const [exag, setExag] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<TwinInst | null>(null);
  const [hover, setHover] = useState<{ i: TwinInst; x: number; y: number } | null>(null);
  const [section, setSection] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [legend, setLegend] = useState<[number, number]>([0, 1]);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!host.current || !data) return;
    const s = new TwinScene(host.current);
    sceneRef.current = s;
    s.onPick = (i) => { setSel(i); s.select(i?.id ?? null); };
    s.onHover = (i, x, y) => setHover(i ? { i, x, y } : null);
    s.setData(data);
    setTi(data.nowIndex);
    setLegend(s.legendRange());
    return () => { s.dispose(); sceneRef.current = null; };
  }, [data]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.mode = mode; s.tIndex = ti; s.update();
    setLegend(s.legendRange());
  }, [mode, ti]);
  useEffect(() => { sceneRef.current?.setExaggeration(exag); }, [exag]);
  useEffect(() => { sceneRef.current?.setSection(section); }, [section]);

  useEffect(() => {
    if (!playing || !data) return;
    const t = setInterval(() => setTi((v) => { if (v >= data.days.length - 1) { setPlaying(false); return v; } return Math.min(data.days.length - 1, v + 2); }), 60);
    return () => clearInterval(t);
  }, [playing, data]);

  const instMeta = useMemo(() => new Map((insts.data ?? []).map((i) => [i.id, i])), [insts.data]);
  const mapPts = useMemo(() => {
    if (!data) return [];
    return data.instruments.map((i) => {
      const m = instMeta.get(i.id);
      const v = i.values[ti];
      let color = '#d7dde2';
      if (mode === 'alarm') color = i.alarm ? levelHex(i.alarm) : '#3fa66b';
      else if (mode === 'kesehatan') color = i.stale ? '#5f6b77' : (i.health?.battery ?? 100) < 20 ? '#d04a3f' : '#3fa66b';
      else if (mode === 'penurunan' && ['SC', 'GN', 'SP'].includes(i.type) && v != null) color = '#' + rampHex(RAMPS.penurunan, v / legend[1]);
      return { id: i.id, code: i.code, x: m?.x ?? 0, y: m?.y ?? 0, color, label: `${i.code} ${v != null ? num(v, i.unit === 'kPa' ? 1 : 0) + ' ' + i.unit : ''}` };
    }).filter((p) => p.x);
  }, [data, ti, mode, instMeta, legend]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading what="digital twin" />;

  const isProj = ti > data.nowIndex;
  const t = data.days[ti];
  const modeMeta = MODES.find((m) => m.value === mode)!;
  const strip = lp.data?.strip ?? [];
  const selV = sel ? sel.values[ti] : null;

  const flyTo = (s: number) => {
    sceneRef.current?.flyToSta(s);
    const g = lp.data?.alignment?.geometry?.find((p: any) => p.sta >= s);
    if (g) setFocus({ x: g.x, y: g.y });
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: showMap ? '1fr 38%' : '1fr' }}>
      <div className="mm-grid" style={{ position: 'relative', overflow: 'hidden' }}>
        <div ref={host} style={{ position: 'absolute', inset: 0 }} />

        {/* strip STA sinkron */}
        <div className="glass" style={{ position: 'absolute', top: 10, left: 10, right: 10, padding: 6 }}>
          <div className="sta-strip" style={{ height: 26 }}>
            {strip.map((s: any) => (
              <div key={s.from} className={section != null && section >= s.from && section < s.to ? 'sel' : ''} onClick={() => flyTo(s.from + 50)}
                style={{ background: `color-mix(in srgb, ${DECISION_META[s.decision]?.color} 28%, transparent)` }} title={`${s.zone} · ${s.decision}`}>
                <span>{staFmt(s.from)} <span style={{ color: DECISION_META[s.decision]?.color }}>{DECISION_META[s.decision]?.short}</span></span>
              </div>
            ))}
          </div>
        </div>

        {/* kontrol mode */}
        <div className="glass" style={{ position: 'absolute', top: 58, left: 10, padding: 8, width: 236 }}>
          <div className="label" style={{ marginBottom: 6 }}>Mode tampilan</div>
          <div className="grid" style={{ gap: 2 }}>
            {MODES.map((m) => (
              <button key={m.value} className={`btn sm ${mode === m.value ? '' : 'ghost'}`} style={{ justifyContent: 'flex-start', borderColor: mode === m.value ? 'var(--accent)' : 'transparent' }} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
          <div className="label" style={{ margin: '10px 0 4px' }}>Eksagerasi vertikal {exag}×</div>
          <input type="range" min={1} max={10} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))} style={{ width: '100%' }} />
          <div className="row tight" style={{ marginTop: 8 }}>
            <button className={`btn sm ${section != null ? 'primary' : ''}`} onClick={() => setSection(section == null ? 24500 : null)}><Scissors size={13} />Irisan</button>
            <button className={`btn sm ${showMap ? 'primary' : ''}`} onClick={() => setShowMap(!showMap)}><MapIcon size={13} />Peta 2D</button>
            <button className="btn sm" onClick={() => sceneRef.current?.resetView()} title="Reset kamera"><RotateCcw size={13} /></button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8, display: 'flex', gap: 5 }} title="Model perilaku memakai solusi analitis 1D (Terzaghi) + radial (Hansbo) per sel, bukan FEM 2D/3D. Nilai antarinstrumen diinterpolasi (IDW sepanjang STA × profil melintang model).">
            <Info size={13} style={{ flex: 'none', marginTop: 1 }} /><span>Metode model: analitis 1D + radial per sel grid ±5 m; bukan FEM.</span>
          </div>
        </div>

        {/* legenda */}
        <div className="glass" style={{ position: 'absolute', top: 58, right: 10, padding: 8, width: 230 }}>
          <div className="row"><span className="label">{modeMeta.label}</span><span className="spacer" />{isProj ? <span className="badge" style={{ color: 'var(--accent)' }}>PROYEKSI</span> : <span className="badge neutral">TERUKUR</span>}</div>
          {RAMPS[mode] ? (
            <>
              <div className="legend-bar" style={{ marginTop: 6, background: `linear-gradient(90deg, ${RAMPS[mode].join(',')})` }} />
              <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                <span>{mode === 'U' ? '0' : num(legend[0])}</span><span>{mode === 'U' ? '50' : num((legend[0] + legend[1]) / 2)}</span><span>{mode === 'U' ? '100' : num(legend[1])} {modeMeta.unit}</span>
              </div>
            </>
          ) : mode === 'alarm' ? (
            <div className="grid" style={{ gap: 3, marginTop: 6, fontSize: 12 }}>
              {Object.keys(DECISION_META).map((d) => <span key={d} className="row tight"><span className="dot" style={{ background: decisionHex(d) }} />{d} (permukaan zona)</span>)}
              {['Waspada', 'Siaga', 'Bahaya'].map((l) => <span key={l} className="row tight"><span className="dot" style={{ background: levelHex(l) }} />{l} (instrumen)</span>)}
            </div>
          ) : (
            <div className="grid" style={{ gap: 3, marginTop: 6, fontSize: 12 }}>
              <span className="row tight"><span className="dot" style={{ background: '#3fa66b' }} />Normal</span>
              <span className="row tight"><span className="dot" style={{ background: '#d9b23a' }} />Baterai &lt; 40%</span>
              <span className="row tight"><span className="dot" style={{ background: '#d04a3f' }} />Baterai &lt; 20%</span>
              <span className="row tight"><span className="dot" style={{ background: '#5f6b77' }} />Data terlambat / offline</span>
              <span className="row tight"><span className="dot" style={{ background: '#8a96a3' }} />Manual</span>
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Warna solid = terukur/interpolasi dekat instrumen; memudar ke abu = keyakinan rendah (jauh dari instrumen). Marker transparan = proyeksi.
          </div>
        </div>

        {/* panel instrumen terpilih */}
        {sel && (
          <div className="glass" style={{ position: 'absolute', right: 10, top: 250, width: 230, padding: 8 }}>
            <div className="row"><span className="mono b">{sel.code}</span><Level level={sel.alarm} /><span className="spacer" /><button className="btn sm ghost" onClick={() => { setSel(null); sceneRef.current?.select(null); }}>×</button></div>
            <div className="kv-list" style={{ marginTop: 6 }}>
              <span>STA</span><span>{staFmt(sel.sta)} · {offsetLabel(sel.offset)}</span>
              {sel.tip_depth != null && <><span>Kedalaman</span><span>{sel.tip_depth} m</span></>}
              <span>{isProj ? 'Proyeksi' : 'Nilai'} {date(t, false)}</span><span>{selV != null ? `${num(selV, sel.unit === 'kPa' ? 1 : 0)} ${sel.unit}` : '—'}</span>
              {sel.type === 'PZ' && selV != null && <><span>Δu</span><span>{num(selV - (sel.u_hydro ?? 0), 1)} kPa</span></>}
              {isProj && sel.projection && <><span>Metode</span><span>{sel.projection}</span></>}
              {sel.health && <><span>Baterai</span><span>{num(sel.health.battery)} %</span><span>Terakhir</span><span>{ago(sel.health.last_seen)}</span></>}
            </div>
            <div className="row tight" style={{ marginTop: 8 }}>
              <Link className="btn sm" to={`/instrumen/${sel.id}`}>Data</Link>
              {['SC', 'GN', 'SP', 'SAA', 'PZ'].includes(sel.type) && <Link className="btn sm" to={`/analisis?i=${sel.id}`}>Analisis</Link>}
              <button className="btn sm" onClick={() => { setSection(sel.sta); flyTo(sel.sta); }}><Crosshair size={13} />Irisan di sini</button>
            </div>
          </div>
        )}

        {hover && !sel && (
          <div className="glass mono" style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 10, padding: '3px 7px', fontSize: 11.5, pointerEvents: 'none' }}>
            {hover.i.code} · {hover.i.values[ti] != null ? `${num(hover.i.values[ti], hover.i.unit === 'kPa' ? 1 : 0)} ${hover.i.unit}` : '—'}
          </div>
        )}

        {/* irisan penampang */}
        {section != null && (
          <div className="glass" style={{ position: 'absolute', left: 256, right: 250, bottom: 92, padding: 8, maxHeight: '52%', overflow: 'auto' }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="label">Irisan penampang</span>
              <input type="range" min={24000} max={25000} step={25} value={section} onChange={(e) => setSection(Number(e.target.value))} style={{ flex: 1 }} />
              <span className="mono">{staFmt(section)}</span>
              <button className="btn sm ghost" onClick={() => setSection(null)}>×</button>
            </div>
            <SectionView twin={data} sta={section} ti={ti} exag={Math.max(1, exag - 1)} />
          </div>
        )}

        {/* time slider */}
        <div className="glass" style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: '8px 10px' }}>
          <div className="row">
            <button className="btn sm" onClick={() => { if (ti >= data.days.length - 1) setTi(0); setPlaying(!playing); }}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
            <span className="mono b" style={{ width: 100 }}>{date(t)}</span>
            <span className="badge" style={{ color: isProj ? 'var(--accent)' : 'var(--s1)' }}>{isProj ? `PROYEKSI +${ti - data.nowIndex} hari` : ti === data.nowIndex ? 'HARI INI' : `HISTORI −${data.nowIndex - ti} hari`}</span>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setTi(data.nowIndex)}>Hari ini</button>
          </div>
          <div style={{ position: 'relative', marginTop: 6 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 7, height: 4, display: 'flex', pointerEvents: 'none' }}>
              <div style={{ width: `${(data.nowIndex / (data.days.length - 1)) * 100}%`, background: 'var(--s1)', opacity: 0.6 }} />
              <div style={{ flex: 1, background: 'repeating-linear-gradient(90deg, var(--accent) 0 6px, transparent 6px 10px)', opacity: 0.7 }} />
            </div>
            <input type="range" min={0} max={data.days.length - 1} value={ti} onChange={(e) => { setPlaying(false); setTi(Number(e.target.value)); }} style={{ width: '100%', position: 'relative' }} />
            <div className="row mono muted" style={{ justifyContent: 'space-between', fontSize: 10.5 }}>
              <span>{date(data.days[0])}</span>
              <span style={{ position: 'absolute', left: `${(data.nowIndex / (data.days.length - 1)) * 100}%`, transform: 'translateX(-50%)', color: 'var(--text)' }}>▲ hari ini</span>
              <span>{date(data.days[data.days.length - 1])}</span>
            </div>
          </div>
        </div>
      </div>
      {showMap && (
        <div style={{ borderLeft: '1px solid var(--line)' }}>
          <MapView zones={(lp.data?.strip ? data.zones : []).map((z) => ({ id: z.id, code: z.code, polygon: polyFor(lp.data?.alignment?.geometry ?? [], z.sta_start, z.sta_end), color: decisionHex(z.decision) }))}
            points={mapPts} alignment={lp.data?.alignment?.geometry} height="100%" focus={focus}
            onPoint={(id) => { const i = data.instruments.find((x) => x.id === id) ?? null; setSel(i); sceneRef.current?.select(id); if (i) sceneRef.current?.flyToSta(i.sta, 110); }} />
        </div>
      )}
    </div>
  );
}

function rampHex(ramp: string[], f: number) {
  const x = Math.min(1, Math.max(0, f)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = parseInt(ramp[i].slice(1), 16), b = parseInt(ramp[i + 1].slice(1), 16);
  const k = x - i;
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

function polyFor(geom: { sta: number; x: number; y: number }[], s0: number, s1: number) {
  if (!geom.length) return [];
  const pts = geom.filter((p) => p.sta >= s0 && p.sta <= s1);
  const dirx = (geom[geom.length - 1].x - geom[0].x) / (geom[geom.length - 1].sta - geom[0].sta);
  const diry = (geom[geom.length - 1].y - geom[0].y) / (geom[geom.length - 1].sta - geom[0].sta);
  const nx = diry, ny = -dirx;
  const left = pts.map((p) => ({ x: p.x - 30 * nx, y: p.y - 30 * ny }));
  const right = pts.map((p) => ({ x: p.x + 30 * nx, y: p.y + 30 * ny })).reverse();
  return [...left, ...right];
}
