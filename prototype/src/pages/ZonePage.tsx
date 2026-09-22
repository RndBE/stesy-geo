// Layar 3 — Zona: timeline tahap, grafik gabungan, prediksi, kriteria, parameter, skenario.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, session, useApi } from '../api';
import { Panel, Decision, Crit, InstrumentChip, Loading, ErrorBox, UnitInput, toast, Level } from '../components/ui';
import { Chart, baseOption, palette, stageMarkLines, SERIES_COLORS } from '../components/Chart';
import { sta, num, pct, date, dateTime, offsetLabel, PHASE_LABEL, toInputDate, fromInputDate, DAY } from '../lib/format';

export default function ZonePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const zones = useApi<any>('/projects/1/overview', [], ['zones']);
  const { data, error, reload } = useApi<any>(`/zones/${id}`, [id], ['readings', 'alarms', 'zones']);
  const combined = useApi<any>(`/zones/${id}/combined`, [id], ['readings']);
  const compare = useApi<any>(`/zones/${id}/compare`, [id], ['readings']);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading what="zona" />;
  const s = data.status;
  const z = s.zone;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row">
            {(zones.data?.zones ?? []).map((zz: any) => (
              <button key={zz.id} className={`btn sm ${String(zz.id) === id ? 'primary' : 'ghost'}`} onClick={() => nav(`/zona/${zz.id}`)}>{zz.code}</button>
            ))}
          </div>
          <h1 style={{ marginTop: 8 }}><span className="mono">{z.code}</span> · {z.name}{z.is_transition ? ' · zona transisi oprit' : ''}</h1>
          <div className="sub">STA {sta(z.sta_start)} – {sta(z.sta_end)} · {PHASE_LABEL[s.phase]}{s.currentStage ? ` · tahap ${s.currentStage} dari ${data.stages.length}` : ''} · timbunan rencana {num(z.design_fill_height, 1)} m + surcharge {num(z.surcharge_height, 1)} m</div>
        </div>
        <div className="grow" />
        <div style={{ fontSize: 15 }}><Decision value={s.decision} /></div>
      </div>

      <Panel flush style={{ marginBottom: 12 }}>
        <div className="kpis" style={{ borderTop: 0 }}>
          <Kpi v={`${num(s.fillHeight, 2)} / ${num(s.totalPlanned, 1)}`} u="m" s="Tinggi timbunan aktual / total" />
          <Kpi v={num(s.currentSettlement)} u="mm" s="Penurunan as (rata-rata)" />
          <Kpi v={num(s.finalSettlement)} u="mm" s="S akhir Asaoka" />
          <Kpi v={num(s.remaining)} u="mm" s="Sisa penurunan (beban saat ini)" />
          <Kpi v={pct(s.U)} u="%" s="U Asaoka" />
          <Kpi v={pct(s.U_hyper)} u="%" s="U hiperbolik" />
          <Kpi v={pct(s.U_theory)} u="%" s="U teoretis (c_h desain)" />
          <Kpi v={s.dateU90 ? date(s.dateU90) : s.U >= 0.9 ? 'tercapai' : '—'} u="" s="Estimasi U = 90%" />
          <Kpi v={num(s.residualDesign)} u="mm" s="Sisa pascakonstruksi (beban rencana)" />
          <Kpi v={num(s.lateralRate, 1)} u="mm/hari" s="Laju lateral maks (24 j)" />
          <Kpi v={s.deltaOverS != null ? num(s.deltaOverS, 2) : '—'} u="" s="δ/S (Matsuo–Kawamura)" />
          <Kpi v={String(s.staleInstruments)} u="" s="Instrumen data terlambat" />
        </div>
      </Panel>

      <div className="grid cols-main-side">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Waktu – penurunan – tinggi timbunan">
            {combined.data ? <CombinedChart d={combined.data} /> : <Loading />}
          </Panel>
          <Panel title="Timeline tahap timbunan (rencana vs aktual)">
            <StageTimeline stages={data.stages} onSaved={reload} />
          </Panel>
          <Panel title="Perbandingan metode prediksi (F-ANL-09)" flush right={<span className="mono muted" style={{ fontSize: 11 }}>{compare.data?.algoVersion}</span>}>
            <div className="scroll">
              <table className="t">
                <thead><tr><th>Instrumen</th><th>STA / offset</th><th className="num">S kini</th><th className="num">S∞ Asaoka</th><th className="num">R²</th><th className="num">S∞ hiperb.</th><th className="num">R²</th><th className="num">S∞ teoretis</th><th className="num">U A / H</th><th className="num">Selisih A–H</th><th className="num">Laju</th><th>Catatan</th></tr></thead>
                <tbody>
                  {(compare.data?.rows ?? []).map((r: any) => (
                    <tr key={r.id} className="click" onClick={() => nav(`/analisis?i=${r.id}`)}>
                      <td className="mono b">{r.code}</td>
                      <td className="mono nowrap">{sta(r.sta)} · {offsetLabel(r.offset)}</td>
                      <td className="num">{num(r.current)}</td>
                      <td className="num">{num(r.asaoka)}</td>
                      <td className="num dim">{r.asaoka_r2 != null ? r.asaoka_r2.toFixed(4) : '—'}</td>
                      <td className="num">{num(r.hyper)}</td>
                      <td className="num dim">{r.hyper_r2 != null && Number.isFinite(r.hyper_r2) ? r.hyper_r2.toFixed(4) : '—'}</td>
                      <td className="num">{num(r.theory)}</td>
                      <td className="num">{pct(r.U_asaoka)} / {pct(r.U_hyper)}</td>
                      <td className="num" style={{ color: r.diffPct > 10 ? 'var(--waspada)' : undefined }}>{r.diffPct != null ? `${num(r.diffPct, 1)}%` : '—'}</td>
                      <td className="num">{num(r.rate7d, 1)}<span className="unit">mm/mg</span></td>
                      <td className="muted" style={{ fontSize: 11.5 }}>{r.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 11, padding: '6px 10px' }}>Satuan penurunan mm. S∞ teoretis = Terzaghi + Hansbo dengan parameter zona saat ini (desain atau hasil kalibrasi).</div>
          </Panel>
          <Scenario zoneId={z.id} stages={data.stages} />
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Kriteria keputusan (PRD 9.4)">
            {s.criteria.map((c: any) => <Crit key={c.id + c.label} c={c} />)}
            {s.openAlarms.length > 0 && <div className="row" style={{ marginTop: 6 }}>{s.openAlarms.map((a: any) => <Level key={a.level} level={a.level} />)}<Link to={`/alarm?zone=${z.id}`} className="muted">lihat alarm →</Link></div>}
          </Panel>
          <Recommendations zoneId={z.id} recs={data.recommendations} decision={s.decision} onSaved={reload} />
          <Panel title={`Instrumen (${data.instruments.length})`}>
            <div className="row tight">
              {data.instruments.map((i: any) => <InstrumentChip key={i.id} id={i.id} code={i.code} last={i.last?.ts ?? null} stale={i.stale} />)}
            </div>
          </Panel>
          <SoilParams data={data} onSaved={reload} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ v, u, s }: { v: string; u: string; s: string }) {
  return <div className="kpi"><div className="v">{v}{u && <span className="unit">{u}</span>}</div><div className="s">{s}</div></div>;
}

function CombinedChart({ d }: { d: any }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    const colors = SERIES_COLORS();
    return {
      ...o,
      grid: [{ left: 60, right: 20, top: 34, height: '58%' }, { left: 60, right: 20, top: '76%', height: '14%' }],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [{ ...(o.xAxis as any), type: 'time', gridIndex: 0, axisLabel: { show: false } }, { ...(o.xAxis as any), type: 'time', gridIndex: 1 }],
      yAxis: [
        { ...(o.yAxis as any), type: 'value', inverse: true, name: 'Penurunan (mm)', gridIndex: 0 },
        { ...(o.yAxis as any), type: 'value', name: 'H (m)', gridIndex: 1, splitNumber: 2 },
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
      series: [
        ...d.series.map((s: any, i: number) => ({
          name: s.code, type: 'line', showSymbol: s.type === 'SP', symbolSize: 4, data: s.data, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: Math.abs(s.offset) <= 6 ? 1.6 : 1, type: s.type === 'SP' ? 'dotted' : 'solid' }, color: colors[i % colors.length],
          markLine: i === 0 ? stageMarkLines(d.stages) : undefined,
        })),
        { name: 'H aktual', type: 'line', step: false, showSymbol: false, data: d.fill, xAxisIndex: 1, yAxisIndex: 1, color: '#9c8a66', areaStyle: { opacity: 0.25 } },
        { name: 'H rencana', type: 'line', showSymbol: false, data: d.plannedFill, xAxisIndex: 1, yAxisIndex: 1, color: p.text3, lineStyle: { type: 'dashed', width: 1 } },
      ],
      legend: { ...(o.legend as any), type: 'scroll', left: 60, right: 20 },
    };
  }, [d]);
  return <Chart option={option as any} height={420} />;
}

function StageTimeline({ stages, onSaved }: { stages: any[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});
  const t0 = Math.min(...stages.map((s) => Math.min(s.planned_start ?? Infinity, s.actual_start ?? Infinity))) - 7 * DAY;
  const t1 = Math.max(...stages.map((s) => Math.max(s.planned_end ?? 0, s.actual_end ?? s.actual_start ?? 0)), Date.now()) + 14 * DAY;
  const X = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const save = async (s: any) => {
    try {
      await api(`/stages/${s.id}`, { method: 'PUT', body: { actual_start: form.actual_start ? fromInputDate(form.actual_start) : null, actual_end: form.actual_end ? fromInputDate(form.actual_end) : null, planned_start: form.planned_start ? fromInputDate(form.planned_start) : null } });
      toast(`Tahap ${s.stage_no} disimpan (tercatat di audit log)`);
      setEdit(null); onSaved();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const months: number[] = [];
  const d = new Date(t0); d.setDate(1);
  for (let t = d.getTime(); t < t1; ) { if (t > t0) months.push(t); const n = new Date(t); n.setMonth(n.getMonth() + 1); t = n.getTime(); }
  return (
    <div>
      <div style={{ position: 'relative', height: 16, marginLeft: 150, borderBottom: '1px solid var(--line-soft)' }}>
        {months.map((m) => <span key={m} className="mono dim" style={{ position: 'absolute', left: `${X(m)}%`, fontSize: 10 }}>{new Date(m).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })}</span>)}
        <span style={{ position: 'absolute', left: `${X(Date.now())}%`, top: 0, bottom: -8 - stages.length * 26, borderLeft: '1px solid var(--accent)', zIndex: 1 }} />
      </div>
      {stages.map((s) => (
        <div key={s.id}>
          <div className="row" style={{ height: 26, gap: 0 }}>
            <div style={{ width: 150, fontSize: 12 }} className="row tight">
              <span className="mono b">T{s.stage_no}</span><span className="muted">{s.is_surcharge ? 'surcharge' : ''} {num(s.thickness, 1)} m</span>
              {session.can('engineer') && <button className="btn sm ghost" style={{ height: 20, padding: '0 5px' }} onClick={() => { setEdit(edit === s.id ? null : s.id); setForm({ actual_start: s.actual_start ? toInputDate(s.actual_start) : '', actual_end: s.actual_end ? toInputDate(s.actual_end) : '', planned_start: s.planned_start ? toInputDate(s.planned_start) : '' }); }}>ubah</button>}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 20 }}>
              {s.planned_start && <div title={`Rencana ${date(s.planned_start)} – ${date(s.planned_end)}`} style={{ position: 'absolute', left: `${X(s.planned_start)}%`, width: `${Math.max(0.6, X(s.planned_end) - X(s.planned_start))}%`, top: 2, height: 6, border: '1px dashed var(--text-3)' }} />}
              {s.actual_start && <div title={`Aktual ${date(s.actual_start)} – ${s.actual_end ? date(s.actual_end) : 'berjalan'}`} style={{ position: 'absolute', left: `${X(s.actual_start)}%`, width: `${Math.max(0.6, X(s.actual_end ?? Date.now()) - X(s.actual_start))}%`, top: 10, height: 8, background: s.is_surcharge ? 'var(--s1)' : '#9c8a66' }} />}
              <span className="mono dim" style={{ position: 'absolute', left: `${X(s.actual_start ?? s.planned_start) + 0.5}%`, top: -2, fontSize: 10, transform: 'translateY(-60%)' }} />
            </div>
          </div>
          {edit === s.id && (
            <div className="row" style={{ marginLeft: 150, padding: '4px 0 8px' }}>
              <label className="field"><span>Rencana mulai</span><input className="inp" type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })} /></label>
              <label className="field"><span>Aktual mulai</span><input className="inp" type="date" value={form.actual_start} onChange={(e) => setForm({ ...form, actual_start: e.target.value })} /></label>
              <label className="field"><span>Aktual selesai</span><input className="inp" type="date" value={form.actual_end} onChange={(e) => setForm({ ...form, actual_end: e.target.value })} /></label>
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => save(s)}>Simpan</button>
            </div>
          )}
        </div>
      ))}
      <div className="row muted" style={{ fontSize: 11, marginTop: 6 }}>
        <span className="row tight"><span style={{ width: 18, height: 6, border: '1px dashed var(--text-3)' }} />rencana</span>
        <span className="row tight"><span style={{ width: 18, height: 8, background: '#9c8a66' }} />aktual</span>
        <span className="row tight"><span style={{ width: 18, height: 8, background: 'var(--s1)' }} />surcharge</span>
        <span className="row tight"><span style={{ width: 1, height: 10, background: 'var(--accent)' }} />hari ini</span>
      </div>
    </div>
  );
}

function Recommendations({ zoneId, recs, decision, onSaved }: { zoneId: number; recs: any[]; decision: string; onSaved: () => void }) {
  const [text, setText] = useState('');
  const snaps = useApi<any[]>('/analysis/snapshots');
  const [snapIds, setSnapIds] = useState<number[]>([]);
  const save = async () => {
    try {
      await api(`/zones/${zoneId}/recommendations`, { body: { decision, text, analysis_run_ids: snapIds } });
      setText(''); setSnapIds([]); toast('Rekomendasi disimpan'); onSaved();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  return (
    <Panel title="Rekomendasi tertulis">
      {recs.length === 0 && <div className="muted">Belum ada rekomendasi.</div>}
      {recs.map((r) => (
        <div key={r.id} style={{ borderBottom: '1px dashed var(--line-soft)', padding: '5px 0' }}>
          <div className="row"><Decision value={r.decision} /><span className="spacer" /><span className="mono muted" style={{ fontSize: 11 }}>{dateTime(r.created_at)}</span></div>
          <div style={{ fontSize: 12.5 }}>{r.text}</div>
          <div className="muted" style={{ fontSize: 11 }}>{r.by_name}{r.analysis_run_ids && JSON.parse(r.analysis_run_ids).length ? ` · snapshot #${JSON.parse(r.analysis_run_ids).join(', #')}` : ''}</div>
        </div>
      ))}
      {session.can('engineer') && (
        <div className="grid" style={{ gap: 6, marginTop: 8 }}>
          <textarea className="inp" rows={3} placeholder={`Rekomendasi untuk status "${decision}"…`} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'var(--sans)' }} />
          <select className="inp" multiple value={snapIds.map(String)} onChange={(e) => setSnapIds([...e.target.selectedOptions].map((o) => Number(o.value)))} style={{ height: 60 }}>
            {(snaps.data ?? []).slice(0, 20).map((s) => <option key={s.id} value={s.id}>#{s.id} {s.instrument_code ?? s.zone_code} {s.method} · {date(s.created_at)}</option>)}
          </select>
          <button className="btn primary" disabled={text.length < 5} onClick={save}>Simpan rekomendasi (tertaut ke snapshot)</button>
        </div>
      )}
    </Panel>
  );
}

function SoilParams({ data, onSaved }: { data: any; onSaved: () => void }) {
  const z = data.status.zone;
  const [p, setP] = useState({ cv: z.cv, ch: z.ch, hdr: z.hdr, residual_limit_mm: z.residual_limit_mm });
  const editable = session.can('engineer');
  const save = async () => {
    try { await api(`/zones/${z.id}/params`, { method: 'PUT', body: p }); toast('Parameter zona disimpan'); onSaved(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const soft = data.layers.find((l: any) => l.ch != null);
  return (
    <Panel title="Parameter tanah & PVD">
      <table className="t" style={{ marginBottom: 8 }}>
        <thead><tr><th>Lapisan</th><th className="num">Kedalaman</th><th className="num">γ</th><th className="num">C_c</th><th className="num">e₀</th><th className="num">OCR</th><th className="num">c_u</th></tr></thead>
        <tbody>{data.layers.map((l: any) => (
          <tr key={l.id}><td>{l.name}</td><td className="num">{l.top_depth}–{l.bottom_depth} m</td><td className="num">{l.gamma ?? '—'}</td><td className="num">{l.cc ?? '—'}</td><td className="num">{l.e0 ?? '—'}</td><td className="num">{l.ocr ?? '—'}</td><td className="num">{l.cu ?? '—'}</td></tr>
        ))}</tbody>
      </table>
      <div className="grid cols-2" style={{ gap: 8 }}>
        <label className="field"><span>c_v zona</span><UnitInput value={p.cv} onChange={(v) => setP({ ...p, cv: Number(v) })} unit="m²/th" design={soft?.cv} disabled={!editable} /></label>
        <label className="field"><span>c_h zona</span><UnitInput value={p.ch} onChange={(v) => setP({ ...p, ch: Number(v) })} unit="m²/th" design={soft?.ch} disabled={!editable} /></label>
        <label className="field"><span>H_dr</span><UnitInput value={p.hdr} onChange={(v) => setP({ ...p, hdr: Number(v) })} unit="m" disabled={!editable} /></label>
        <label className="field"><span>Batas sisa penurunan</span><UnitInput value={p.residual_limit_mm} onChange={(v) => setP({ ...p, residual_limit_mm: Number(v) })} unit="mm" disabled={!editable} /></label>
      </div>
      {editable && <div className="row" style={{ marginTop: 8 }}><span className="muted" style={{ fontSize: 11 }}>Angka samar = nilai desain lapisan</span><span className="spacer" /><button className="btn primary sm" onClick={save}>Simpan parameter</button></div>}
      {data.pvd && (
        <div className="kv-list" style={{ marginTop: 10 }}>
          <span>PVD</span><span>{data.pvd.pattern}, jarak {data.pvd.spacing} m, panjang {data.pvd.length} m, {data.pvd.a}×{data.pvd.b} mm</span>
          <span>D_e / d_w</span><span>{num(data.pvd.De, 3)} m / {num(data.pvd.dw * 1000, 0)} mm</span>
          <span>μ (Hansbo)</span><span>{num(data.pvd.mu, 2)} (s = {data.pvd.s}, k_h/k_s = {data.pvd.khKs})</span>
          <span>t₉₀ radial</span><span>{num(data.pvd.t90_years * 12, 1)} bulan (c_h = {z.ch} m²/th)</span>
        </div>
      )}
    </Panel>
  );
}

function Scenario({ zoneId, stages }: { zoneId: number; stages: any[] }) {
  const pending = stages.filter((s) => s.actual_start == null);
  const surch = stages.find((s) => s.is_surcharge);
  const [shift, setShift] = useState<Record<number, number>>({});
  const [surcharge, setSurcharge] = useState<number>(surch?.thickness ?? 0);
  const [removeAt, setRemoveAt] = useState<string>('');
  const [res, setRes] = useState<any>(null);
  const run = async () => {
    try {
      setRes(await api(`/zones/${zoneId}/scenario`, { body: { shiftStageDays: shift, surcharge, removeAt: removeAt ? fromInputDate(removeAt) : null } }));
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const option = useMemo(() => {
    if (!res) return null;
    const o = baseOption();
    const p = palette();
    return {
      ...o,
      grid: [{ left: 60, right: 20, top: 30, height: '55%' }, { left: 60, right: 20, top: '74%', height: '16%' }],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [{ ...(o.xAxis as any), type: 'time', gridIndex: 0, axisLabel: { show: false } }, { ...(o.xAxis as any), type: 'time', gridIndex: 1 }],
      yAxis: [{ ...(o.yAxis as any), inverse: true, name: 'S (mm)', gridIndex: 0 }, { ...(o.yAxis as any), name: 'H (m)', gridIndex: 1, splitNumber: 2 }],
      series: [
        { name: 'Jadwal saat ini', type: 'line', showSymbol: false, data: res.series.map((r: any) => [r.t, +r.base.toFixed(0)]), color: p.text2, lineStyle: { type: 'dashed' } },
        { name: 'Skenario', type: 'line', showSymbol: false, data: res.series.map((r: any) => [r.t, +r.scen.toFixed(0)]), color: p.accent, markLine: { symbol: 'none', silent: true, data: [{ xAxis: Date.now(), name: 'hari ini' }], lineStyle: { color: p.text3 }, label: { formatter: 'hari ini', color: p.text2 } } },
        { name: 'H saat ini', type: 'line', showSymbol: false, data: res.series.map((r: any) => [r.t, r.fillBase]), xAxisIndex: 1, yAxisIndex: 1, color: p.text3, lineStyle: { type: 'dashed', width: 1 } },
        { name: 'H skenario', type: 'line', showSymbol: false, data: res.series.map((r: any) => [r.t, r.fillScen]), xAxisIndex: 1, yAxisIndex: 1, color: '#9c8a66', areaStyle: { opacity: 0.2 } },
      ],
    };
  }, [res]);
  return (
    <Panel title="Simulasi skenario (what-if)" right={<span className="muted" style={{ fontSize: 11 }}>model analitis terskala ke data as jalan</span>}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {pending.map((s) => (
          <label key={s.id} className="field"><span>Geser T{s.stage_no} ({date(s.planned_start)})</span><UnitInput value={shift[s.stage_no] ?? 0} onChange={(v) => setShift({ ...shift, [s.stage_no]: Number(v) })} unit="hari" width={120} /></label>
        ))}
        {surch && <label className="field"><span>Tebal surcharge</span><UnitInput value={surcharge} onChange={(v) => setSurcharge(Number(v))} unit="m" design={surch.thickness} width={130} /></label>}
        <label className="field"><span>Tanggal bongkar surcharge</span><input className="inp" type="date" value={removeAt} onChange={(e) => setRemoveAt(e.target.value)} /></label>
        <button className="btn primary" onClick={run}>Hitung skenario</button>
      </div>
      {res && (
        <>
          <Chart option={option as any} height={300} />
          <div className="row" style={{ gap: 20 }}>
            {res.residualAtRemoval != null && <span>Sisa penurunan di bawah beban rencana bila dibongkar {date(fromInputDate(removeAt))}: <b className="mono">{num(res.residualAtRemoval)} mm</b></span>}
            <span className="muted">Indikasi stabilitas: H maks {num(res.stability.maxHeight, 2)} m vs H kritis tak-terdrainase ≈ {num(res.stability.Hcrit_undrained, 2)} m</span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>{res.stability.note}</div>
        </>
      )}
    </Panel>
  );
}
