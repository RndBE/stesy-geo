// Panel probe inclinometer live di digital twin (F-DT, PRD 7).
// Bentuk 3D-nya digerakkan event SSE `probe`; angka pergeseran per segmen di sebelahnya.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Crosshair } from 'lucide-react';
import { api, useApi, useEvent } from '../api';
import { toast } from '../components/ui';
import { ProbeScene, SEG_COLORS, SEG_NAMES, type ProbeSegment, type ProbeView as ViewName } from './probeScene';
import { num, ago, dateTime } from '../lib/format';

export interface ProbeBaseline { at: number; nodes: { cumA: number; cumB: number }[] }

export interface ProbeState {
  enabled: boolean; topic: string; device: string | null; instrument: string; gauge: number;
  broker: boolean; online: boolean | null; at: number | null; waktu: string | null;
  seg: ProbeSegment[]; baseline: ProbeBaseline | null; rate: number | null; rateWindowMs: number;
  persistMs: number; savedAt: number | null; error: string | null;
}

const VIEWS: { value: ViewName; label: string }[] = [
  { value: 'depan', label: 'Depan' },
  { value: 'samping', label: 'Samping' },
  { value: 'atas', label: 'Atas' },
];

/** Keadaan probe: dimuat sekali lalu diperbarui event SSE. */
export function useProbe() {
  const { data, setData } = useApi<ProbeState>('/probe');
  useEvent<ProbeState>('probe', (d) => setData(d));
  return { probe: data, setProbe: setData };
}

const deg = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`;

export function ProbeView({ state, setState, instrumentId, onClose }: {
  state: ProbeState; setState: (s: ProbeState) => void; instrumentId?: number; onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ProbeScene | null>(null);
  const [exagPow, setExagPow] = useState(2);
  const [showRef, setShowRef] = useState(true);
  const [anchor, setAnchor] = useState<'bawah' | 'atas'>('bawah');
  const [flipA, setFlipA] = useState(false);
  const [flipB, setFlipB] = useState(false);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);

  const exag = Math.round(10 ** exagPow);
  const count = state.seg.length || 3;
  const top = state.seg.length ? state.seg[state.seg.length - 1] : null;

  useEffect(() => {
    if (!host.current) return;
    const s = new ProbeScene(host.current, state.gauge, count);
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, [state.gauge, count]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.exag = exag; s.showRef = showRef; s.anchor = anchor; s.flipA = flipA; s.flipB = flipB;
    s.setSegments(state.seg);
  }, [state.seg, exag, showRef, anchor, flipA, flipB]);

  // Pembesaran tetap tidak bisa melayani dua keadaan sekaligus: probe terpasang
  // bergerak pecahan milimeter (butuh ratusan kali), probe yang diayun tangan
  // bergerak sentimeter (butuh satuan kali). Mode auto menjaga simpangan terbesar
  // tetap ~25% tinggi probe, tapi hanya menyesuaikan saat gambarnya keluar pita
  // 10–40% — tanpa histeresis itu skalanya bergoyang tiap detik dan gerakan probe
  // jadi tak terbaca. Angka penggandanya selalu tertulis, jadi skala yang berubah
  // tidak pernah tersamar sebagai probe yang diam.
  useEffect(() => {
    if (!auto || !state.seg.length) return;
    const span = state.seg.length * state.gauge;
    const maxCum = Math.max(...state.seg.map((s) => Math.abs(s.cum)), 1e-3);
    const shown = maxCum * exag;
    if (shown > 0.4 * span || shown < 0.1 * span) {
      setExagPow(Math.log10(Math.min(1000, Math.max(1, (0.25 * span) / maxCum))));
    }
  }, [state.seg, state.gauge, auto, exag]);

  const live = state.broker && state.online !== false && state.at != null && Date.now() - state.at < 15e3;
  const dot = !state.broker ? 'var(--bahaya)' : live ? 'var(--ok)' : 'var(--waspada)';
  const status = !state.enabled ? 'jembatan mati' : !state.broker ? 'broker putus' : live ? `live · ${state.waktu ?? ''}` : 'menunggu data alat';

  // Dari atas ke bawah, seperti profil pergeseran dibaca.
  const rows = useMemo(() => state.seg.map((s, i) => ({ s, i })).reverse(), [state.seg]);

  const baseline = async (set: boolean) => {
    setBusy(true);
    try {
      setState(await api<ProbeState>('/probe/baseline', { method: set ? 'POST' : 'DELETE' }));
      toast(set ? 'Acuan nol disetel dari keadaan probe saat ini' : 'Acuan nol dihapus');
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass" style={{ position: 'absolute', left: 256, bottom: 92, width: 620, maxWidth: 'calc(100% - 266px)', padding: 8 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="dot" style={{ background: dot }} />
        <span className="label">Probe {state.device ?? '—'}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>{status}</span>
        <span className="spacer" />
        <Link className="btn sm ghost" to={instrumentId ? `/instrumen/${instrumentId}` : '/instrumen'}>{state.instrument}</Link>
        <button className="btn sm ghost" onClick={onClose}>×</button>
      </div>

      {/* ringkasan: satu angka yang dicari orang, arahnya, dan lajunya */}
      <div className="row" style={{ marginBottom: 6, gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span>
          <span className="mono b" style={{ fontSize: 19 }}>{top ? num(top.def, 3) : '—'}</span>
          <span className="muted" style={{ fontSize: 11 }}> mm {state.baseline ? 'deformasi' : 'pergeseran'} puncak</span>
        </span>
        {top && <span className="mono muted" style={{ fontSize: 11 }}>arah {deg((Math.atan2(top.defB, top.defA) * 180) / Math.PI)}</span>}
        <span className="mono" style={{ fontSize: 12 }}>
          {state.rate == null ? <span className="muted">laju —</span> : `${state.rate >= 0 ? '+' : '−'}${Math.abs(state.rate).toFixed(3)} mm/menit`}
        </span>
        <span className="spacer" />
        {state.baseline
          ? <span className="row tight" style={{ flexWrap: 'nowrap' }}>
              <span className="mono muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>acuan {dateTime(state.baseline.at)}</span>
              <button className="btn sm ghost" disabled={busy} onClick={() => baseline(false)}>Hapus acuan</button>
            </span>
          : <button className="btn sm" disabled={busy || !state.seg.length} onClick={() => baseline(true)}><Crosshair size={13} />Setel acuan nol</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 232px', gap: 8 }}>
        <div style={{ position: 'relative', height: 300, borderRadius: 'var(--radius-control)', overflow: 'hidden', background: 'var(--surface)' }}>
          <div ref={host} style={{ position: 'absolute', inset: 0 }} />
          <div className="mono" style={{ position: 'absolute', left: 8, bottom: 6, display: 'flex', gap: 12, fontSize: 10.5, color: 'var(--text-2)', pointerEvents: 'none' }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 3, background: '#d04a3f', marginRight: 5, verticalAlign: 'middle' }} />sumbu A</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 3, background: '#6f9fe0', marginRight: 5, verticalAlign: 'middle' }} />sumbu B</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 3, background: '#5f6b77', marginRight: 5, verticalAlign: 'middle' }} />vertikal acuan</span>
          </div>
          {!state.seg.length && (
            <div className="muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12 }}>
              {state.error ?? 'menunggu payload pertama…'}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4, alignContent: 'start', maxHeight: 300, overflowY: 'auto' }}>
          {rows.map(({ s, i }) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-control)', padding: '4px 7px' }}>
              <div style={{ height: 3, borderRadius: 2, background: SEG_COLORS[i % SEG_COLORS.length], margin: '-4px -7px 4px' }} />
              <div className="row" style={{ fontSize: 11 }}>
                <span className="label">Step{i + 1} · {SEG_NAMES[i] ?? i + 1}</span>
                <span className="spacer" />
                <span className="mono b">{s.T.toFixed(3)}°</span>
              </div>
              <div className="kv-list mono" style={{ fontSize: 10.5, marginTop: 2, rowGap: 1 }}>
                <span>X / Y</span><span>{s.X.toFixed(3)}° / {s.Y.toFixed(3)}°</span>
                <span>ΔA / ΔB</span><span>{s.dA.toFixed(3)} / {s.dB.toFixed(3)} mm</span>
                <span>{state.baseline ? 'deformasi' : 'kumulatif'}</span><span>{s.def.toFixed(3)} mm ∠{deg((Math.atan2(s.defB, s.defA) * 180) / Math.PI)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="row tight" style={{ marginTop: 7, flexWrap: 'wrap', fontSize: 11.5 }}>
        <span className="label">Pembesaran</span>
        <input type="range" min={0} max={3} step={0.01} value={exagPow} onChange={(e) => { setAuto(false); setExagPow(Number(e.target.value)); }} style={{ width: 120 }} />
        <span className="mono" style={{ width: 46 }}>{exag}×</span>
        <label className="row tight" title="Jaga simpangan terbesar tetap ~25% tinggi probe"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />auto</label>
        <label className="row tight"><input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} />acuan</label>
        <label className="row tight">ujung tetap
          <select value={anchor} onChange={(e) => setAnchor(e.target.value as 'bawah' | 'atas')}>
            <option value="bawah">bawah</option>
            <option value="atas">atas</option>
          </select>
        </label>
        <label className="row tight"><input type="checkbox" checked={flipA} onChange={(e) => setFlipA(e.target.checked)} />balik A</label>
        <label className="row tight"><input type="checkbox" checked={flipB} onChange={(e) => setFlipB(e.target.checked)} />balik B</label>
        <span className="spacer" />
        {VIEWS.map((v) => <button key={v.value} className="btn sm ghost" onClick={() => scene.current?.setView(v.value)}>{v.label}</button>)}
        <button className="btn sm ghost" title="Kembali ke pandangan depan" onClick={() => scene.current?.setView('depan')}><RotateCcw size={13} /></button>
      </div>

      <div className="muted" style={{ fontSize: 10.5, marginTop: 5 }}>
        Kumulatif dijumlahkan sebagai vektor per bidang (ΔA, ΔB), bukan menjumlahkan besaran tiap segmen —
        segmen yang miring berlawanan arah memang saling meniadakan. Pembesaran hanya mengalikan simpangan
        mendatar, jadi jarak antar sendi di layar bukan skala sebenarnya.
        {' '}Laju dari jendela {Math.round(state.rateWindowMs / 1000)} s. Bacaan disimpan ke basis data tiap{' '}
        {Math.round(state.persistMs / 60e3)} menit — terakhir {state.savedAt ? ago(state.savedAt) : '—'}.
      </div>
    </div>
  );
}
