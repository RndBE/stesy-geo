// Layar 10 — Profil memanjang jalan (F-JLN-03/04/05/06).
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { Panel, Loading, DECISION_META, Decision } from '../components/ui';
import { Chart, baseOption, palette } from '../components/Chart';
import { sta, num, elev, pct } from '../lib/format';

export default function Longitudinal() {
  const { data } = useApi<any>('/projects/1/longitudinal', [], ['zones', 'readings']);
  const nav = useNavigate();
  const elevOpt = useMemo(() => {
    if (!data) return null;
    const o = baseOption();
    const p = palette();
    const st = data.stations;
    const zones = [...new Map(st.map((s: any) => [s.zone, s])).keys()];
    return {
      ...o,
      tooltip: { ...(o.tooltip as any), valueFormatter: (v: number) => (v == null ? '—' : v.toFixed(3)) },
      grid: { left: 64, right: 24, top: 36, bottom: 40 },
      xAxis: { ...(o.xAxis as any), type: 'value', min: st[0].sta, max: st[st.length - 1].sta, interval: 100, axisLabel: { ...(o.xAxis as any).axisLabel, formatter: (v: number) => sta(v) }, name: 'STA', nameLocation: 'middle', nameGap: 26 },
      yAxis: { ...(o.yAxis as any), type: 'value', name: 'Elevasi (m)', scale: true },
      series: [
        { name: 'Elevasi rencana', type: 'line', showSymbol: false, data: st.map((s: any) => [s.sta, s.design_elev]), color: p.text, lineStyle: { type: 'dashed', width: 1.4 } },
        { name: 'Puncak timbunan aktual', type: 'line', showSymbol: false, data: st.map((s: any) => [s.sta, s.top_elev]), color: '#b39b6e', areaStyle: { opacity: 0.18, origin: 'start' } },
        { name: 'Muka tanah asli', type: 'line', showSymbol: false, data: st.map((s: any) => [s.sta, s.ground_elev]), color: p.text3, lineStyle: { width: 1 } },
        { name: 'Dasar timbunan terukur', type: 'line', showSymbol: false, data: st.map((s: any) => [s.sta, s.base_elev]), color: p.s1, lineStyle: { width: 1.6 } },
        { name: 'Dasar timbunan prediksi akhir', type: 'line', showSymbol: false, data: st.map((s: any) => [s.sta, s.base_final_elev]), color: p.s1, lineStyle: { type: 'dashed', width: 1.2 } },
        {
          name: 'Batas zona', type: 'line', data: [], markLine: {
            symbol: 'none', silent: true, lineStyle: { color: p.line }, label: { color: p.text2, fontFamily: 'IBM Plex Mono', fontSize: 10, formatter: (d: any) => d.name },
            data: zones.map((z) => { const f = st.find((s: any) => s.zone === z); return { xAxis: f.sta, name: z }; }),
          },
        },
      ],
    };
  }, [data]);

  const settleOpt = useMemo(() => {
    if (!data) return null;
    const o = baseOption();
    const p = palette();
    const st = data.stations;
    return {
      ...o,
      grid: { left: 64, right: 64, top: 36, bottom: 40 },
      xAxis: { ...(o.xAxis as any), type: 'value', min: st[0].sta, max: st[st.length - 1].sta, interval: 100, axisLabel: { ...(o.xAxis as any).axisLabel, formatter: (v: number) => sta(v) } },
      yAxis: [{ ...(o.yAxis as any), type: 'value', inverse: true, name: 'Penurunan (mm)' }, { ...(o.yAxis as any), type: 'value', name: 'Kompensasi (m)', splitLine: { show: false } }],
      series: [
        { name: 'Terukur', type: 'line', data: st.map((s: any) => [s.sta, s.settlement]), color: p.s1, showSymbol: false },
        { name: 'Prediksi akhir', type: 'line', data: st.map((s: any) => [s.sta, s.final_settlement]), color: p.s1, lineStyle: { type: 'dashed' }, showSymbol: false },
        { name: 'Sisa (beban rencana)', type: 'bar', data: st.map((s: any) => [s.sta, s.residual]), color: p.accent, barWidth: 6 },
        { name: 'Timbunan kompensasi', type: 'line', yAxisIndex: 1, step: 'middle', data: st.map((s: any) => [s.sta, s.compensation]), color: p.s2, showSymbol: false },
        { name: 'Titik analisis', type: 'scatter', data: data.points.map((q: any) => ({ value: [q.sta, +q.S.toFixed(0)], name: `${q.code} (${q.method})` })), color: p.text, symbolSize: 6 },
      ],
    };
  }, [data]);

  if (!data) return <Loading what="profil memanjang" />;
  const totalVol = data.stations.reduce((a: number, s: any) => a + (s.compensation_volume ?? 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Profil memanjang</h1><div className="sub">{data.alignment?.name} · STA {sta(data.stations[0].sta)} – {sta(data.stations[data.stations.length - 1].sta)} · penurunan diinterpolasi linear antar-instrumen as jalan</div></div>
      </div>
      <Panel title="Strip status per segmen 100 m" style={{ marginBottom: 12 }}>
        <div className="sta-strip" style={{ height: 40 }}>
          {data.strip.map((s: any) => (
            <div key={s.from} className={s.decision === 'Perlu tinjauan' ? 'hatch' : ''} onClick={() => nav(`/zona/${s.zone_id}`)} style={{ background: `color-mix(in srgb, ${DECISION_META[s.decision]?.color} 30%, var(--surface))` }}>
              <span>{sta(s.from)} · {s.zone}</span>
              <span style={{ color: DECISION_META[s.decision]?.color, fontWeight: 600 }}>{DECISION_META[s.decision]?.short} · U {pct(s.U)}%</span>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid">
        <Panel title="Elevasi: rencana vs aktual vs prediksi">{elevOpt && <Chart option={elevOpt as any} height={320} />}</Panel>
        <Panel title="Penurunan, sisa penurunan, dan timbunan kompensasi" right={<span className="mono" style={{ fontSize: 12 }}>Estimasi volume kompensasi total ≈ {num(totalVol)} m³</span>}>{settleOpt && <Chart option={settleOpt as any} height={300} />}
          <div className="muted" style={{ fontSize: 11 }}>Kompensasi = elevasi rencana − (muka tanah − S∞ beban rencana + timbunan permanen); volume = tebal × lebar puncak × 25 m. Sisa penurunan hanya konsolidasi primer.</div>
        </Panel>
        <div className="grid cols-2">
          {data.oprit.map((o: any) => (
            <Panel key={o.zone} title={`Zona transisi oprit ${o.zone} — perubahan kemiringan memanjang`}>
              <table className="t">
                <thead><tr><th>Segmen</th><th className="num">Δ kemiringan akibat sisa penurunan</th><th className="num">Batas</th><th>Status</th></tr></thead>
                <tbody>{o.segments.map((s: any) => (
                  <tr key={s.from}><td className="mono">{sta(s.from)} – {sta(s.to)}</td><td className="num">{num(s.slope_change * 100, 3)}<span className="unit">%</span></td><td className="num">{num(o.limit * 100, 2)}<span className="unit">%</span></td><td>{s.ok ? <span className="badge ok">Memenuhi</span> : <span className="badge Siaga">Melebihi</span>}</td></tr>
                ))}</tbody>
              </table>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Batas contoh 0,4% (ilustratif); nilai final dari spesifikasi proyek.</div>
            </Panel>
          ))}
          <Panel title="Tabel per STA" flush>
            <div className="scroll" style={{ maxHeight: 320 }}>
              <table className="t">
                <thead><tr><th>STA</th><th>Zona</th><th className="num">Rencana</th><th className="num">Puncak</th><th className="num">S</th><th className="num">S∞</th><th className="num">Sisa</th><th className="num">Kompensasi</th></tr></thead>
                <tbody>{data.stations.map((s: any) => (
                  <tr key={s.sta}><td className="mono">{sta(s.sta)}</td><td className="mono">{s.zone}</td><td className="num">{elev(s.design_elev)}</td><td className="num">{elev(s.top_elev)}</td><td className="num">{num(s.settlement)}</td><td className="num">{num(s.final_settlement)}</td><td className="num">{num(s.residual)}</td><td className="num">{num(s.compensation, 2)}<span className="unit">m</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="row">{Object.keys(DECISION_META).map((k) => <Decision key={k} value={k} />)}</div>
      </div>
    </div>
  );
}
