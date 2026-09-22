// Layar 9 — Telemetri: perangkat, kesehatan, alarm teknis, pemetaan kanal, pembanding manual vs telemetri,
// log pemeliharaan, cek tangki referensi (F-TLM-01..14).
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session, useApi } from '../api';
import { Panel, Level, Loading, toast } from '../components/ui';
import { Chart, baseOption, palette } from '../components/Chart';
import { sta, num, dateTime, ago, date, offsetLabel, toInputDateTime, fromInputDateTime } from '../lib/format';

export default function Telemetry() {
  const [tab, setTab] = useState<'perangkat' | 'banding' | 'pemeliharaan'>('perangkat');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Telemetri</h1><div className="sub">Gateway → logger → kanal → instrumen. Data mentah (Hz, suhu) disimpan bersama nilai terkonversi dan versi kalibrasi.</div></div>
      </div>
      <div className="tabs">
        <button className={tab === 'perangkat' ? 'on' : ''} onClick={() => setTab('perangkat')}>Perangkat & kesehatan</button>
        <button className={tab === 'banding' ? 'on' : ''} onClick={() => setTab('banding')}>Pembanding manual vs telemetri</button>
        <button className={tab === 'pemeliharaan' ? 'on' : ''} onClick={() => setTab('pemeliharaan')}>Pemeliharaan & tangki referensi</button>
      </div>
      {tab === 'perangkat' && <Devices />}
      {tab === 'banding' && <Compare />}
      {tab === 'pemeliharaan' && <Maintenance />}
    </div>
  );
}

function Bar({ v }: { v: number | null }) {
  if (v == null) return <span className="dim">—</span>;
  const c = v >= 0.95 ? 'var(--ok)' : v >= 0.8 ? 'var(--waspada)' : 'var(--bahaya)';
  return <span className="row tight"><span style={{ width: 60, height: 6, background: 'var(--line)', display: 'inline-block', position: 'relative' }}><span style={{ position: 'absolute', inset: 0, width: `${v * 100}%`, background: c }} /></span><span className="mono" style={{ fontSize: 11.5 }}>{num(v * 100)}%</span></span>;
}

function Devices() {
  const { data } = useApi<any>('/telemetry/devices', [], ['readings', 'tick']);
  const tech = useApi<any[]>('/alarms?status=open&category=teknis', [], ['alarms', 'tick']);
  const [sel, setSel] = useState<number | null>(null);
  if (!data) return <Loading what="perangkat" />;
  const loggers = data.loggers;
  const complete = loggers.map((l: any) => l.completeness24h).filter((x: any) => x != null);
  const avgC = complete.reduce((a: number, b: number) => a + b, 0) / Math.max(1, complete.length);
  return (
    <div className="grid cols-main-side">
      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title={`Logger (${loggers.length})`} right={<span className="muted" style={{ fontSize: 11.5 }}>Kelengkapan 24 jam rata-rata <b className="mono">{num(avgC * 100, 1)}%</b> · target ≥ 95%</span>} flush>
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Logger</th><th>Model</th><th>STA</th><th>Kanal → instrumen</th><th className="num">Baterai</th><th className="num">RSSI / SNR</th><th>Terakhir</th><th>Kelengkapan 24 j</th><th>Alarm</th></tr></thead>
              <tbody>
                {loggers.map((l: any) => {
                  const off = !l.last_seen || Date.now() - l.last_seen > 6 * 3600e3;
                  return (
                    <Fragment key={l.id}>
                      <tr className={`click ${sel === l.id ? 'sel' : ''}`} onClick={() => setSel(sel === l.id ? null : l.id)}>
                        <td className="mono b"><span className="dot" style={{ background: off ? 'var(--bahaya)' : 'var(--ok)', marginRight: 6 }} />{l.code}</td>
                        <td className="nowrap" style={{ fontSize: 12 }} title={`${l.vendor} · SN ${l.serial} · firmware ${l.firmware}`}>{l.model.replace(' (LoRa AS923-2)', '')}<div className="dim mono" style={{ fontSize: 10.5 }}>SN {l.serial} · fw {l.firmware}</div></td>
                        <td className="mono nowrap">{sta(l.sta)} · {offsetLabel(l.offset)}</td>
                        <td className="mono" style={{ fontSize: 11.5 }}>{l.channels.map((c: any) => <span key={c.channel_no} style={{ marginRight: 8 }}>{c.channel_no}:<Link to={`/instrumen/${c.id}`}>{c.code}</Link></span>)}</td>
                        <td className="num" style={{ color: (l.health?.battery_pct ?? 100) < 20 ? 'var(--bahaya)' : undefined }}>{num(l.health?.battery_pct)}<span className="unit">%</span></td>
                        <td className="num">{num(l.health?.rssi)} / {num(l.health?.snr, 1)}<span className="unit">dBm/dB</span></td>
                        <td className="mono nowrap" style={{ color: off ? 'var(--bahaya)' : undefined }}>{ago(l.last_seen)}</td>
                        <td><Bar v={l.completeness24h} /></td>
                        <td>{l.alarms.map((a: any, k: number) => <span key={k} title={a.message}><Level level={a.level} /></span>)}</td>
                      </tr>
                      {sel === l.id && <tr><td colSpan={9} style={{ background: 'var(--surface-2)' }}><HealthChart type="logger" id={l.id} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="grid" style={{ alignContent: 'start' }}>
        {data.gateways.map((g: any) => (
          <Panel key={g.id} title={`Gateway ${g.code}`}>
            <div className="kv-list">
              <span>Model</span><span style={{ fontFamily: 'var(--sans)' }}>{g.model}</span>
              <span>Serial</span><span>{g.serial}</span>
              <span>Lokasi</span><span>STA {sta(g.sta)}</span>
              <span>Daya</span><span style={{ fontFamily: 'var(--sans)' }}>{g.power_type}</span>
              <span>Terakhir terhubung</span><span>{ago(g.last_seen)}</span>
              <span>Baterai / tegangan</span><span>{num(g.health?.battery_pct)} % · {num(g.health?.battery_v, 2)} V</span>
            </div>
          </Panel>
        ))}
        <Panel title={`Alarm teknis aktif (${tech.data?.length ?? 0})`} flush>
          {(tech.data ?? []).length === 0 && <div className="empty">Tidak ada.</div>}
          {(tech.data ?? []).map((a) => (
            <div key={a.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-soft)' }}>
              <div className="row"><Level level={a.level} /><span className="mono">{a.device_code ?? a.instrument_code}</span><span className="spacer" /><span className="mono muted" style={{ fontSize: 11 }}>{dateTime(a.ts)}</span></div>
              <div style={{ fontSize: 12 }}>{a.message}</div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11, padding: '6px 10px' }}>Aturan: logger offline &gt; 6 jam, baterai &lt; 20%, nilai di luar rentang fisik, lompatan tidak wajar. Dievaluasi tiap menit.</div>
        </Panel>
        <Panel title="Syarat minimum logger (PRD 8.4)">
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            <li>Buffer lokal ≥ 30 hari dan backfill otomatis</li>
            <li>Kirim data mentah (Hz/digit) + suhu sensor</li>
            <li>Metadata kesehatan: baterai, RSSI/SNR, suhu internal</li>
            <li>Timestamp UTC tersinkron</li>
            <li>MQTT (TLS), HTTP push, atau REST API terdokumentasi</li>
            <li>Radio pita AS923-2 (920–923 MHz), bersertifikat SDPPI</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function HealthChart({ type, id }: { type: string; id: number }) {
  const { data } = useApi<any[]>(`/telemetry/health/${type}/${id}?days=30`, [type, id]);
  const option = useMemo(() => {
    if (!data) return null;
    const o = baseOption();
    const p = palette();
    return {
      ...o, grid: { left: 50, right: 50, top: 28, bottom: 28 },
      xAxis: { ...(o.xAxis as any), type: 'time' },
      yAxis: [{ ...(o.yAxis as any), name: 'Baterai (%)', min: 0, max: 100 }, { ...(o.yAxis as any), name: 'RSSI (dBm)', splitLine: { show: false }, scale: true }],
      series: [
        { name: 'Baterai', type: 'line', showSymbol: false, data: data.map((h) => [h.ts, h.battery_pct]), color: p.ok, markLine: { symbol: 'none', data: [{ yAxis: 20 }], lineStyle: { color: p.bahaya, type: 'dashed' }, label: { formatter: '20%', color: p.bahaya } } },
        { name: 'RSSI', type: 'line', showSymbol: false, yAxisIndex: 1, data: data.map((h) => [h.ts, h.rssi]), color: p.s1, lineStyle: { width: 1 } },
      ],
    };
  }, [data]);
  if (!option) return <Loading />;
  return <Chart option={option as any} height={200} />;
}

function Compare() {
  const { data } = useApi<any[]>('/telemetry/compare');
  const [sel, setSel] = useState(0);
  const option = useMemo(() => {
    const pr = data?.[sel];
    if (!pr) return null;
    const o = baseOption();
    const p = palette();
    return {
      ...o, grid: { left: 56, right: 56, top: 30, bottom: 30 },
      xAxis: { ...(o.xAxis as any), type: 'time' },
      yAxis: [{ ...(o.yAxis as any), name: `Nilai (${pr.unit})`, scale: true, inverse: pr.unit === 'mm' }, { ...(o.yAxis as any), name: `Selisih (${pr.unit})`, splitLine: { show: false } }],
      series: [
        { name: pr.telemetry + ' (telemetri)', type: 'line', showSymbol: false, data: pr.data.map((d: any) => [d.ts, d.telemetry]), color: p.s1 },
        { name: pr.manual, type: 'scatter', data: pr.data.map((d: any) => [d.ts, d.manual]), color: p.accent, symbolSize: 6 },
        { name: 'Selisih', type: 'bar', yAxisIndex: 1, data: pr.data.map((d: any) => [d.ts, +d.diff.toFixed(2)]), itemStyle: { color: p.text3 }, barMaxWidth: 4,
          markArea: { silent: true, itemStyle: { color: 'rgba(63,166,107,0.08)' }, data: [[{ yAxis: -pr.tolerance }, { yAxis: pr.tolerance }]] } },
      ],
    };
  }, [data, sel]);
  if (!data) return <Loading what="pembanding" />;
  return (
    <div className="grid">
      <Panel title="Kriteria lulus validasi T2 (PRD 8.9): selisih penurunan ≤ ±5 mm dan tekanan pori ≤ ±2 kPa pada ≥ 90% pasangan data" flush>
        <table className="t">
          <thead><tr><th>Jenis</th><th>Manual / acuan</th><th>Telemetri</th><th className="num">n pasangan</th><th className="num">Rerata selisih</th><th className="num">Simp. baku</th><th className="num">Dalam toleransi</th><th>Status</th></tr></thead>
          <tbody>{data.map((p, i) => (
            <tr key={i} className={`click ${sel === i ? 'sel' : ''}`} onClick={() => setSel(i)}>
              <td>{p.kind}</td><td className="mono">{p.manual}</td><td className="mono">{p.telemetry}</td><td className="num">{p.stats.n}</td>
              <td className="num">{num(p.stats.mean, 1)}<span className="unit">{p.unit}</span></td><td className="num">{num(p.stats.sd, 1)}<span className="unit">{p.unit}</span></td>
              <td className="num">{p.stats.within != null ? `${num(p.stats.within * 100)}%` : '—'} <span className="dim">(±{p.tolerance})</span></td>
              <td>{p.stats.n ? (p.stats.pass ? <span className="badge ok">Lulus</span> : <span className="badge Waspada">Belum lulus</span>) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      {option && <Panel title={`${data[sel].manual} vs ${data[sel].telemetry}`}><Chart option={option as any} height={300} /><div className="muted" style={{ fontSize: 11 }}>Pasangan dibentuk dengan bacaan telemetri terdekat dalam ±3 jam dari pembacaan manual. Pita hijau = toleransi.</div></Panel>}
    </div>
  );
}

function Maintenance() {
  const logs = useApi<any[]>('/telemetry/maintenance');
  const refs = useApi<any[]>('/telemetry/reference-checks');
  const [f, setF] = useState({ device_code: '', action: '', note: '', ts: toInputDateTime(Date.now()) });
  const [elev, setElev] = useState('');
  const save = async () => {
    try { await api('/telemetry/maintenance', { body: { ...f, ts: fromInputDateTime(f.ts) } }); toast('Log pemeliharaan disimpan'); setF({ ...f, action: '', note: '' }); logs.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const saveRef = async () => {
    try { const r = await api('/telemetry/reference-checks', { body: { target: 'TANK-01', elevation: Number(elev) } }); toast(`Cek tangki disimpan · Δ ${r.delta_mm} mm dipakai untuk koreksi settlement cell`); setElev(''); refs.reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  return (
    <div className="grid cols-2">
      <Panel title="Log pemeliharaan (F-TLM-14)" flush>
        {session.can('surveyor') && (
          <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--line-soft)', alignItems: 'flex-end' }}>
            <label className="field"><span>Perangkat</span><input className="inp" style={{ width: 90 }} placeholder="LG-03" value={f.device_code} onChange={(e) => setF({ ...f, device_code: e.target.value.toUpperCase() })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Tindakan</span><input className="inp" placeholder="Penggantian baterai" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></label>
            <label className="field"><span>Waktu</span><input className="inp" type="datetime-local" value={f.ts} onChange={(e) => setF({ ...f, ts: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}><span>Catatan</span><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            <button className="btn primary" disabled={!f.device_code || !f.action} onClick={save}>Simpan</button>
          </div>
        )}
        <table className="t">
          <thead><tr><th>Waktu</th><th>Perangkat</th><th>Tindakan</th><th>Catatan</th><th>Oleh</th></tr></thead>
          <tbody>{(logs.data ?? []).map((m) => <tr key={m.id}><td className="mono nowrap">{date(m.ts)}</td><td className="mono">{m.device_code}</td><td>{m.action}</td><td className="muted">{m.note}</td><td className="muted">{m.by_name}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel title="Cek elevasi tangki referensi settlement cell (F-TLM-07)" flush>
        {session.can('surveyor') && (
          <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--line-soft)', alignItems: 'flex-end' }}>
            <label className="field"><span>Elevasi TANK-01 terukur</span><div className="unit-input" style={{ width: 160 }}><input type="number" step="0.0001" value={elev} onChange={(e) => setElev(e.target.value)} /><span className="u">m</span></div></label>
            <button className="btn primary" disabled={!elev} onClick={saveRef}>Simpan cek</button>
            <span className="muted" style={{ fontSize: 11.5 }}>Perubahan elevasi dipakai untuk mengoreksi bacaan settlement cell sejak tanggal cek.</span>
          </div>
        )}
        <table className="t">
          <thead><tr><th>Tanggal</th><th>Target</th><th className="num">Elevasi</th><th className="num">Δ vs awal</th><th>Metode</th><th>Oleh</th></tr></thead>
          <tbody>{(refs.data ?? []).map((r) => <tr key={r.id}><td className="mono">{date(r.ts)}</td><td className="mono">{r.target}</td><td className="num">+{num(r.elevation, 4)}<span className="unit">m</span></td><td className="num">{num(r.delta_mm, 1)}<span className="unit">mm</span></td><td className="muted">{r.method}</td><td className="muted">{r.by_name}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}
