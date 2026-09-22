// Layar 4 — Instrumen: time-series, tabel bacaan, metadata & kalibrasi, riwayat alarm, profil.
import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, authUrl, session, useApi } from '../api';
import { Panel, Level, Loading, ErrorBox, Seg, toast } from '../components/ui';
import { Chart, baseOption, palette, SERIES_COLORS } from '../components/Chart';
import { sta, num, offsetLabel, dateTime, date, ago, DAY } from '../lib/format';

const RANGES = { '14': 14, '90': 90, semua: 10000 } as const;

export default function InstrumentPage() {
  const { id } = useParams();
  const { data: inst, error } = useApi<any>(`/instruments/${id}`, [id], ['readings', 'alarms']);
  const [range, setRange] = useState<keyof typeof RANGES>('90');
  const from = Date.now() - RANGES[range] * DAY;
  const readings = useApi<any>(`/instruments/${id}/readings?from=${Math.floor(from / 3600e3) * 3600e3}&agg=auto`, [id, range], ['readings']);
  const table = useApi<any[]>(`/instruments/${id}/table?limit=150`, [id], ['readings']);
  const isProfile = inst && (inst.type === 'INC' || inst.type === 'SAA');

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!inst) return <Loading what="instrumen" />;
  const dec = inst.unit === 'kPa' ? 1 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row"><h1 className="mono">{inst.code}</h1><Level level={inst.alarms.find((a: any) => a.cleared_at == null)?.level} />{inst.stale && <span className="badge Waspada">data terlambat</span>}</div>
          <div className="sub">{inst.typeLabel} · {inst.zone?.code ?? 'lingkungan'} · STA {sta(inst.sta)} · {offsetLabel(inst.offset)}{inst.tip_depth != null ? ` · kedalaman ${inst.tip_depth} m` : ''} · {inst.mode === 'manual' ? 'pembacaan manual' : 'telemetri'}</div>
        </div>
        <div className="grow" />
        <div className="kv-list" style={{ textAlign: 'right' }}>
          <span>Nilai terakhir</span><span className="b" style={{ fontSize: 15 }}>{num(inst.last?.value, dec)} {inst.unit}</span>
          <span>Waktu baca</span><span>{dateTime(inst.last?.ts)} ({ago(inst.last?.ts)})</span>
        </div>
      </div>

      <div className="grid cols-main-side">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Time-series" right={<div className="row tight">
            <Seg value={range} onChange={setRange} options={[{ value: '14', label: '14 hari' }, { value: '90', label: '90 hari' }, { value: 'semua', label: 'Semua' }]} />
            {['SC', 'GN', 'SP', 'SAA', 'PZ'].includes(inst.type) && <Link className="btn sm" to={`/analisis?i=${inst.id}`}>Buka analisis</Link>}
          </div>}>
            {readings.data ? <SeriesChart inst={inst} d={readings.data} /> : <Loading />}
          </Panel>
          {isProfile && <ProfilePanel inst={inst} />}
          <Panel title="Tabel pembacaan (150 terakhir)" flush right={<a className="btn sm" href={authUrl(`/export/readings.csv?project=1&instrument=${inst.id}`)}>CSV</a>}>
            <div className="scroll" style={{ maxHeight: 420 }}>
              <table className="t">
                <thead><tr><th>Waktu (WIB)</th><th className="num">Nilai</th><th className="num">Raw</th><th className="num">Suhu</th><th>Sumber</th><th>Flag</th><th>Catatan / oleh</th>{session.can('engineer') && <th />}</tr></thead>
                <tbody>
                  {(table.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="mono nowrap">{dateTime(r.ts)}</td>
                      <td className="num">{num(r.value, dec)}<span className="unit">{inst.unit}</span></td>
                      <td className="num dim">{r.raw_value != null ? `${num(r.raw_value, 2)} Hz` : '—'}</td>
                      <td className="num dim">{r.raw_temp != null ? `${num(r.raw_temp, 1)} °C` : '—'}</td>
                      <td className="muted">{r.source}{r.calib_id ? ` · kal #${r.calib_id}` : ''}</td>
                      <td>{r.flag ? <span className={`badge ${r.flag === 'ditolak' ? 'Bahaya' : 'Waspada'}`}>{r.flag}</span> : ''}</td>
                      <td className="muted" style={{ fontSize: 11.5 }}>{[r.note, r.entered_by].filter(Boolean).join(' · ')}</td>
                      {session.can('engineer') && <td><FlagMenu r={r} onDone={() => { table.reload(); readings.reload(); }} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Metadata">
            <div className="kv-list">
              <span>Kode</span><span>{inst.code}</span>
              <span>Tipe</span><span style={{ fontFamily: 'var(--sans)' }}>{inst.typeLabel}</span>
              <span>Koordinat UTM</span><span>{num(inst.x, 2)} E · {num(inst.y, 2)} N</span>
              <span>Elevasi pasang</span><span>+{num(inst.z, 3)} m</span>
              <span>Tanggal pasang</span><span>{date(inst.installed_at)}</span>
              <span>Zero reading</span><span>{num(inst.zero_reading, 2)} {inst.unit}</span>
              {inst.meta.u_hydro != null && <><span>u hidrostatis</span><span>{num(inst.meta.u_hydro, 1)} kPa</span></>}
              {inst.meta.pair && <><span>Pasangan</span><span>{inst.meta.pair}</span></>}
              {inst.meta.pair_settlement && <><span>Acuan δ/S</span><span>{inst.meta.pair_settlement}</span></>}
              {inst.meta.range && <><span>Rentang fisik</span><span>{inst.meta.range.join(' … ')} {inst.unit}</span></>}
              <span>Interval</span><span>{inst.expected_interval_min >= 1440 ? `${inst.expected_interval_min / 1440} hari` : `${inst.expected_interval_min} menit`}</span>
              {inst.counts.map((c: any) => <Fragment key={c.source}><span>Bacaan {c.source}</span><span>{c.n.toLocaleString('id-ID')} · sejak {date(c.first)}</span></Fragment>)}
            </div>
          </Panel>
          {inst.channels.length > 0 && (
            <Panel title="Pemetaan kanal logger">
              <table className="t"><thead><tr><th>Logger</th><th>Kanal</th><th>Berlaku</th></tr></thead>
                <tbody>{inst.channels.map((c: any) => <tr key={c.id}><td className="mono">{c.logger_code}</td><td className="mono">{c.channel_no}</td><td className="mono">{date(c.valid_from)} – {c.valid_to ? date(c.valid_to) : 'kini'}</td></tr>)}</tbody>
              </table>
            </Panel>
          )}
          {inst.calibrations.length > 0 && (
            <Panel title="Kalibrasi">
              {inst.calibrations.map((c: any) => (
                <div key={c.id} className="kv-list" style={{ marginBottom: 8 }}>
                  <span>Versi</span><span>#{c.id} · berlaku {date(c.valid_from)}</span>
                  <span>Bentuk</span><span>{c.coeffs.kind === 'vw_linear' ? 'P = G·(R₀ − R)' : 'P = A·R² + B·R + C'}</span>
                  <span>G (B)</span><span>{c.coeffs.B}</span>
                  {c.coeffs.R0 != null && <><span>R₀</span><span>{c.coeffs.R0} digit</span></>}
                  {c.coeffs.K != null && <><span>Koreksi suhu K</span><span>{c.coeffs.K} /°C (T₀ {c.coeffs.T0} °C)</span></>}
                  {c.coeffs.baroFactor != null && <><span>Koreksi baro</span><span>{c.coeffs.baroFactor} × (P_b − {c.coeffs.P0baro} kPa)</span></>}
                  <span>Sertifikat</span><span>{c.certificate_file ?? '—'}</span>
                  <span>Kalibrasi ulang</span><span style={{ color: c.next_due && c.next_due < Date.now() + 30 * DAY ? 'var(--waspada)' : undefined }}>{date(c.next_due)}</span>
                </div>
              ))}
            </Panel>
          )}
          <Panel title={`Riwayat alarm (${inst.alarms.length})`} flush>
            <div className="scroll" style={{ maxHeight: 320 }}>
              {inst.alarms.length === 0 && <div className="empty">Tidak ada alarm.</div>}
              {inst.alarms.map((a: any) => (
                <div key={a.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div className="row"><Level level={a.level} /><span className="mono muted" style={{ fontSize: 11 }}>{dateTime(a.ts)}</span><span className="spacer" />{a.cleared_at ? <span className="muted" style={{ fontSize: 11 }}>normal {date(a.cleared_at)}</span> : <span className="badge neutral">aktif</span>}</div>
                  <div style={{ fontSize: 12 }}>{a.message}</div>
                  {a.ack_at && <div className="muted" style={{ fontSize: 11 }}>✔ {a.ack_name}: {a.ack_note}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SeriesChart({ inst, d }: { inst: any; d: any }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    const settle = ['SC', 'GN', 'SP', 'SAA'].includes(inst.type);
    const uh = inst.meta.u_hydro ?? null;
    let tele: [number, number][] = [], manual: [number, number][] = [];
    if (d.agg === 'daily') { tele = d.series.telemetry ?? []; manual = d.series.manual ?? []; }
    else {
      tele = d.rows.filter((r: any) => r.source === 'telemetry' && r.flag !== 'ditolak').map((r: any) => [r.ts, r.value]);
      manual = d.rows.filter((r: any) => r.source === 'manual').map((r: any) => [r.ts, r.value]);
    }
    const flagged = d.agg === 'raw' ? d.rows.filter((r: any) => r.flag).map((r: any) => [r.ts, r.value]) : [];
    return {
      ...o,
      grid: { left: 64, right: uh != null ? 64 : 20, top: 30, bottom: 50 },
      xAxis: { ...(o.xAxis as any), type: 'time' },
      yAxis: [
        { ...(o.yAxis as any), type: 'value', inverse: settle, scale: !settle, name: `${inst.type === 'PZ' ? 'Tekanan pori' : settle ? 'Penurunan' : 'Nilai'} (${inst.unit})` },
        ...(uh != null ? [{ ...(o.yAxis as any), type: 'value', scale: true, name: 'Δu (kPa)', splitLine: { show: false } }] : []),
      ],
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: p.line, textStyle: { color: p.text2 } }],
      series: [
        { name: d.agg === 'daily' ? 'Telemetri (rata-rata harian)' : 'Telemetri', type: 'line', showSymbol: false, data: tele, color: p.s1, lineStyle: { width: 1.3 }, sampling: 'lttb' },
        { name: 'Manual', type: 'scatter', data: manual, color: p.accent, symbolSize: 6 },
        ...(flagged.length ? [{ name: 'Ditandai', type: 'scatter', data: flagged, color: p.bahaya, symbol: 'diamond', symbolSize: 9 }] : []),
        ...(uh != null ? [{ name: 'Δu ekses', type: 'line', yAxisIndex: 1, showSymbol: false, data: tele.map(([t, v]) => [t, +(v - uh).toFixed(2)]), color: p.s2, lineStyle: { width: 1, type: 'dashed' } }] : []),
      ],
    };
  }, [inst, d]);
  return <Chart option={option as any} height={360} />;
}

function ProfilePanel({ inst }: { inst: any }) {
  const { data } = useApi<any>(`/instruments/${inst.id}/profiles`, [inst.id], ['readings']);
  const [mode, setMode] = useState<'kumulatif' | 'inkremental'>('kumulatif');
  const option = useMemo(() => {
    if (!data?.profiles?.length) return null;
    const o = baseOption();
    const colors = SERIES_COLORS();
    const vertical = inst.type === 'INC';
    const ref = data.profiles[0].points;
    const series = data.profiles.map((p: any, i: number) => {
      const pts = p.points.map((q: any, k: number) => {
        const v = mode === 'inkremental' && i > 0 ? q.value - (ref[k]?.value ?? 0) : q.value;
        return vertical ? [+v.toFixed(2), q.pos] : [q.pos, +v.toFixed(1)];
      });
      return { name: date(p.ts, false), type: 'line', data: pts, showSymbol: true, symbolSize: 3, color: colors[i % colors.length], lineStyle: { width: i === data.profiles.length - 1 ? 2 : 1 } };
    });
    return {
      ...o,
      tooltip: { ...(o.tooltip as any), trigger: 'item' },
      grid: { left: 60, right: 20, top: 34, bottom: 40 },
      xAxis: vertical ? { ...(o.xAxis as any), type: 'value', name: 'Deformasi lateral (mm)', nameLocation: 'middle', nameGap: 26 } : { ...(o.xAxis as any), type: 'value', name: 'Offset dari as (m)', nameLocation: 'middle', nameGap: 26 },
      yAxis: vertical ? { ...(o.yAxis as any), type: 'value', inverse: true, name: 'Kedalaman (m)', max: 20 } : { ...(o.yAxis as any), type: 'value', inverse: true, name: 'Penurunan (mm)' },
      series,
    };
  }, [data, mode, inst.type]);
  return (
    <Panel title={inst.type === 'INC' ? 'Profil deformasi lateral terhadap kedalaman' : 'Profil penurunan melintang (SAAX)'} right={<Seg value={mode} onChange={setMode} options={[{ value: 'kumulatif', label: 'Kumulatif' }, { value: 'inkremental', label: 'Inkremental' }]} />}>
      {option ? <Chart option={option as any} height={inst.type === 'INC' ? 420 : 300} /> : <Loading what="profil" />}
      <div className="muted" style={{ fontSize: 11 }}>Overlay: 30, 14, 7, 3, 1 hari lalu dan pembacaan terakhir. Inkremental = relatif terhadap profil tertua yang ditampilkan.</div>
    </Panel>
  );
}

function FlagMenu({ r, onDone }: { r: any; onDone: () => void }) {
  const set = async (flag: string) => {
    const note = flag === 'ditolak' ? prompt('Alasan penolakan bacaan:') : null;
    if (flag === 'ditolak' && !note) return;
    try { await api(`/readings/${r.id}`, { method: 'PATCH', body: { flag, note } }); toast('Flag diperbarui (tercatat di audit log)'); onDone(); } catch (e: any) { toast(e.message, 'err'); }
  };
  return (
    <select className="inp" style={{ height: 22, fontSize: 11, padding: '0 4px' }} value="" onChange={(e) => e.target.value && set(e.target.value === 'hapus' ? '' : e.target.value)}>
      <option value="">flag…</option>
      <option value="ditolak">tolak</option>
      <option value="diperiksa">diperiksa</option>
      {r.flag && <option value="hapus">hapus flag</option>}
    </select>
  );
}
