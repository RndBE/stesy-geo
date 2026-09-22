// Daftar instrumen proyek.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, authUrl } from '../api';
import { Panel, Level, Loading, Seg } from '../components/ui';
import { sta, num, offsetLabel, ago, dateTime } from '../lib/format';

const TYPES = ['SC', 'GN', 'SP', 'PZ', 'SAA', 'INC', 'GT', 'RG', 'BR'];

export default function Instruments() {
  const { data } = useApi<any[]>('/instruments?project=1', [], ['readings', 'alarms']);
  const [type, setType] = useState('semua');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const rows = useMemo(() => (data ?? []).filter((i) => (type === 'semua' || i.type === type) && (!q || i.code.toLowerCase().includes(q.toLowerCase()) || (i.zone_code ?? '').toLowerCase().includes(q.toLowerCase()))), [data, type, q]);
  if (!data) return <Loading what="instrumen" />;
  const d = (v: number) => (Math.abs(v) < 0.05 ? 0 : v);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Instrumen</h1><div className="sub">{data.length} instrumen · {data.filter((i) => i.mode === 'telemetry').length} telemetri · {data.filter((i) => i.stale).length} data terlambat</div></div>
        <div className="grow" />
        <input className="inp" placeholder="Cari kode / zona…" value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn" href={authUrl('/export/readings.csv?project=1')}>Ekspor semua bacaan (CSV)</a>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Seg value={type} onChange={setType} options={[{ value: 'semua', label: 'Semua' }, ...TYPES.map((t) => ({ value: t, label: `${t} ${data.filter((i) => i.type === t).length}` }))]} />
      </div>
      <Panel flush>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Kode</th><th>Tipe</th><th>Zona</th><th>STA</th><th>Offset</th><th className="num">Kedalaman</th><th className="num">Nilai terakhir</th><th className="num">Δ bacaan</th><th>Waktu baca</th><th>Sumber</th><th>Alarm</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="click" onClick={() => nav(`/instrumen/${i.id}`)}>
                  <td className="mono b"><span className="dot" style={{ background: i.stale ? 'var(--text-3)' : 'var(--ok)', marginRight: 6 }} />{i.code}</td>
                  <td>{i.typeLabel}</td>
                  <td className="mono">{i.zone_code ?? '—'}</td>
                  <td className="mono">{sta(i.sta)}</td>
                  <td className="mono">{offsetLabel(i.offset)}</td>
                  <td className="num">{i.tip_depth != null ? `${i.tip_depth} m` : '—'}</td>
                  <td className="num">{i.last ? num(i.last.value, i.unit === 'kPa' ? 1 : 0) : '—'}<span className="unit">{i.unit}</span></td>
                  <td className="num dim">{i.last && i.prev ? `${d(i.last.value - i.prev.value) >= 0 ? '+' : ''}${num(d(i.last.value - i.prev.value), i.unit === 'kPa' ? 1 : 0)}` : '—'}</td>
                  <td className="mono nowrap" title={i.last ? dateTime(i.last.ts) : ''} style={{ color: i.stale ? 'var(--waspada)' : undefined }}>{ago(i.last?.ts)}</td>
                  <td className="muted">{i.mode === 'manual' ? 'manual' : 'telemetri'}{i.last?.flag ? <span className="badge Waspada" style={{ marginLeft: 6 }}>{i.last.flag}</span> : ''}</td>
                  <td><Level level={i.alarm} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
