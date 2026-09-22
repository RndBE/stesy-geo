// Layar 1 — Overview proyek (F-DSH-01..05, F-JLN-06).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { Panel, Decision, DECISION_META, Level, InstrumentChip, Loading, ErrorBox, Seg } from '../components/ui';
import { MapView } from '../components/MapView';
import { Chart, baseOption, palette } from '../components/Chart';
import { sta, num, pct, date, dateTime, ago, PHASE_LABEL } from '../lib/format';

export default function Overview() {
  const { data, error } = useApi<any>('/projects/1/overview', [], ['readings', 'alarms', 'zones']);
  const lp = useApi<any>('/projects/1/longitudinal', [], ['zones']);
  const inst = useApi<any[]>('/instruments?project=1', [], ['readings']);
  const [trendDays, setTrendDays] = useState<'7' | '30'>('30');
  const trend = useApi<any[]>(`/projects/1/trend?days=${trendDays}`, [trendDays], ['readings']);
  const nav = useNavigate();

  const mapZones = useMemo(() => (data?.zones ?? []).map((z: any) => ({ id: z.id, code: z.code, polygon: z.polygon, color: decisionHex(z.decision), label: `${z.code} · ${z.decision}` })), [data]);
  const mapPts = useMemo(() => (inst.data ?? []).filter((i) => i.x).map((i) => ({
    id: i.id, code: i.code, x: i.x, y: i.y, label: `${i.code} · ${i.typeLabel}`,
    color: i.alarm ? levelHex(i.alarm) : i.stale ? '#5f6b77' : '#d7dde2', ring: i.stale ? '#8A96A3' : '#0F1419',
  })), [inst.data]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading what="overview" />;

  const openAlarms = data.alarms.filter((a: any) => a.cleared_at == null || a.ack_at == null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview proyek</h1>
          <div className="sub">{data.project.name} · EPSG:{data.project.crs_epsg} · datum {data.project.vertical_datum} · {data.instrumentCount} instrumen ({pct(data.telemetryShare)}% telemetri)</div>
        </div>
      </div>

      <Panel title="Status keputusan per segmen 100 m" right={<span className="muted" style={{ fontSize: 11.5 }}>klik segmen untuk membuka zona</span>} className="" style={{ marginBottom: 12 }}>
        <div className="sta-strip">
          {(lp.data?.strip ?? []).map((s: any) => (
            <div key={s.from} className={s.decision === 'Perlu tinjauan' ? 'hatch' : ''} style={{ background: `color-mix(in srgb, ${DECISION_META[s.decision]?.color} 30%, var(--surface))` }} onClick={() => nav(`/zona/${s.zone_id}`)} title={`${s.zone} · ${s.decision}`}>
              <span>{sta(s.from)}</span>
              <span style={{ color: DECISION_META[s.decision]?.color, fontWeight: 600 }}>{DECISION_META[s.decision]?.short}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 6, fontSize: 11.5 }}>
          {Object.keys(DECISION_META).map((k) => <span key={k} className="row tight"><Decision value={k} /></span>)}
          <span className="spacer" />
          <span className="muted">Pola arsir = perlu tinjauan engineer</span>
        </div>
      </Panel>

      <div className="grid cols-main-side">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Zona" flush>
            <div className="scroll">
              <table className="t">
                <thead><tr>
                  <th>Zona</th><th>STA</th><th>Fase</th><th className="num">H timbunan</th><th className="num">S terukur</th><th className="num">S akhir</th>
                  <th className="num">Sisa</th><th className="num">U Asaoka</th><th className="num">U hiperb.</th><th>Est. U 90%</th><th>Status</th><th>Alarm</th>
                </tr></thead>
                <tbody>
                  {data.zones.map((z: any) => (
                    <tr key={z.id} className="click" onClick={() => nav(`/zona/${z.id}`)}>
                      <td className="mono b">{z.code}{z.is_transition ? <span className="dim"> oprit</span> : ''}</td>
                      <td className="mono nowrap">{sta(z.sta_start)} – {sta(z.sta_end)}</td>
                      <td className="nowrap">{PHASE_LABEL[z.phase]}{z.currentStage ? <span className="muted"> · T{z.currentStage}/{z.stageCount}</span> : ''}</td>
                      <td className="num">{num(z.fillHeight, 2)}<span className="unit">m</span></td>
                      <td className="num">{num(z.currentSettlement)}<span className="unit">mm</span></td>
                      <td className="num">{num(z.finalSettlement)}<span className="unit">mm</span></td>
                      <td className="num">{num(z.remaining)}<span className="unit">mm</span></td>
                      <td className="num">{pct(z.U)}<span className="unit">%</span></td>
                      <td className="num">{pct(z.U_hyper)}<span className="unit">%</span></td>
                      <td className="mono nowrap">{z.dateU90 ? date(z.dateU90) : z.U != null && z.U >= 0.9 ? 'tercapai' : '—'}</td>
                      <td><Decision value={z.decision} /></td>
                      <td className="nowrap">{z.openAlarms.length ? z.openAlarms.map((a: any) => <span key={a.level} className={`badge ${a.level}`} style={{ marginRight: 4 }}>{a.n} {a.level}</span>) : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Peta zona & instrumen" flush right={<Link to="/twin" className="btn sm">Buka digital twin</Link>}>
            <MapView zones={mapZones} points={mapPts} alignment={lp.data?.alignment?.geometry} height={380} onZone={(id) => nav(`/zona/${id}`)} onPoint={(id) => nav(`/instrumen/${id}`)} />
          </Panel>

          <Panel title="Tren penurunan as jalan" right={<Seg value={trendDays} onChange={setTrendDays} options={[{ value: '7', label: '7 hari' }, { value: '30', label: '30 hari' }]} />}>
            <TrendChart data={trend.data ?? []} />
            <div className="row" style={{ gap: 18, marginTop: 4 }}>
              {(trend.data ?? []).map((t) => <span key={t.zone} className="mono" style={{ fontSize: 12 }}><span className="muted">{t.zone}</span> Δ{trendDays} hari {num(t.delta)} mm · Δ7 {num(t.delta7)} mm</span>)}
            </div>
          </Panel>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title={`Alarm aktif & belum dikonfirmasi (${openAlarms.length})`} right={<Link to="/alarm" className="btn sm ghost">Semua</Link>} flush>
            <div className="scroll" style={{ maxHeight: 380 }}>
              {openAlarms.length === 0 && <div className="empty">Tidak ada alarm aktif.</div>}
              {openAlarms.map((a: any) => (
                <Link to={a.instrument_id ? `/instrumen/${a.instrument_id}` : '/telemetri'} key={a.id} style={{ display: 'block', padding: '7px 10px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Level level={a.level} />
                    <span className="label">{a.category}</span>
                    <span className="mono">{a.instrument_code ?? ''}</span>
                    <span className="spacer" />
                    <span className="mono muted" style={{ fontSize: 11 }}>{dateTime(a.ts)}</span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>{a.message}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{a.ack_at ? `Dikonfirmasi · ${a.ack_note}` : 'Belum dikonfirmasi'}{a.cleared_at ? ' · sudah normal' : ''}</div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title={`Kesegaran data — ${data.stale.length} instrumen terlambat`} flush>
            <div style={{ padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.stale.length === 0 && <span className="muted">Semua instrumen mengirim sesuai jadwal.</span>}
              {data.stale.map((s: any) => <InstrumentChip key={s.id} id={s.id} code={s.code} last={s.last} stale />)}
            </div>
            <div className="muted" style={{ padding: '0 10px 10px', fontSize: 11.5 }}>Batas: 3× interval jadwal (min. 6 jam) untuk telemetri, 1,5× interval untuk pembacaan manual. Data telemetri terakhir {ago(data.latestData)}.</div>
          </Panel>

          <Panel title="Kriteria keputusan (ringkas)">
            {data.zones.map((z: any) => (
              <div key={z.id} style={{ marginBottom: 8 }}>
                <div className="row"><span className="mono b">{z.code}</span><Decision value={z.decision} /><span className="spacer" /><Link to={`/zona/${z.id}`} className="muted" style={{ fontSize: 11.5 }}>rinci →</Link></div>
                <div className="row tight" style={{ marginTop: 3 }}>
                  {z.criteria.map((c: any) => (
                    <span key={c.id} className="mono" title={`${c.label}: ${c.detail}`} style={{ fontSize: 11, padding: '0 5px', border: '1px solid var(--line)', borderRadius: 2, color: c.ok === true ? 'var(--ok)' : c.ok === false ? 'var(--bahaya)' : 'var(--text-3)' }}>{c.id} {c.ok === true ? '✔' : c.ok === false ? '✘' : '–'}</span>
                  ))}
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: any[] }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    return {
      ...o,
      grid: { left: 56, right: 16, top: 28, bottom: 30 },
      xAxis: { ...(o.xAxis as any), type: 'time' },
      yAxis: { ...(o.yAxis as any), type: 'value', inverse: true, name: 'Penurunan (mm)', scale: true },
      series: data.map((z, i) => ({ name: z.zone, type: 'line', showSymbol: false, data: z.series.map((p: any) => [p.t, +p.v.toFixed(0)]), lineStyle: { width: 1.5 }, color: [p.s1, p.s2, p.s3, p.accent][i % 4] })),
    };
  }, [data]);
  return <Chart option={option as any} height={220} />;
}

export function decisionHex(d: string) {
  const p = palette();
  return ({ 'Lanjut timbun': p.ok, Tahan: p.waspada, 'Siap bongkar surcharge': p.s1, 'Perlu tinjauan': p.bahaya } as any)[d] ?? p.text2;
}
export function levelHex(l: string) {
  const p = palette();
  return ({ Waspada: p.waspada, Siaga: p.siaga, Bahaya: p.bahaya } as any)[l] ?? p.ok;
}
