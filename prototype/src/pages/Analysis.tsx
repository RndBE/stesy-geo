// Layar 5 — Workspace analisis (F-ANL-01..10).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, session, useApi } from '../api';
import { Panel, Loading, Seg, UnitInput, toast, Q } from '../components/ui';
import { Chart, baseOption, palette, stageMarkLines } from '../components/Chart';
import { sta, num, pct, date, dateTime, offsetLabel } from '../lib/format';

type Method = 'asaoka' | 'hiperbolik' | 'teoretis' | 'back';

export default function Analysis() {
  const [params, setParams] = useSearchParams();
  const insts = useApi<any[]>('/instruments?project=1');
  const selectable = (insts.data ?? []).filter((i) => ['SC', 'GN', 'SP', 'SAA', 'PZ'].includes(i.type) && i.zone_id);
  const id = Number(params.get('i') ?? 0) || selectable.find((i) => i.code === 'SC-05')?.id || selectable[0]?.id;
  const inst = selectable.find((i) => i.id === id);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Workspace analisis</h1><div className="sub">Asaoka · hiperbolik · Terzaghi + Hansbo · back-analysis c_h · disipasi tekanan pori — semua hasil dapat disimpan sebagai snapshot yang dapat direproduksi</div></div>
        <div className="grow" />
        <select className="inp" value={id ?? ''} onChange={(e) => setParams({ i: e.target.value })} style={{ minWidth: 280 }}>
          {['SC', 'GN', 'SP', 'SAA', 'PZ'].map((t) => (
            <optgroup key={t} label={t}>
              {selectable.filter((i) => i.type === t).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.zone_code} · STA {sta(i.sta)} {offsetLabel(i.offset)}{i.tip_depth ? ` · ${i.tip_depth} m` : ''}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {!inst ? <Loading what="instrumen" /> : inst.type === 'PZ' ? <PiezoWorkspace id={inst.id} /> : <SettlementWorkspace id={inst.id} key={inst.id} />}
      <Snapshots instrumentId={id} />
    </div>
  );
}

function SettlementWorkspace({ id }: { id: number }) {
  const [dt, setDt] = useState(7);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [method, setMethod] = useState<Method>('asaoka');
  const q = `dt=${dt}${range ? `&from=${Math.round(range[0])}&to=${Math.round(range[1])}` : ''}`;
  const { data, loading } = useApi<any>(`/analysis/settlement/${id}?${q}`, [id, q], ['readings']);
  const [back, setBack] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBack(null); }, [id]);

  const runBack = async () => {
    setBusy(true);
    try { setBack(await api(`/analysis/backanalysis/${id}`, { body: range ? { from: range[0], to: range[1] } : {} })); setMethod('back'); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const saveSnap = async () => {
    const note = prompt('Catatan snapshot (opsional):') ?? undefined;
    try {
      const r = await api('/analysis/snapshots', { body: { instrument_id: id, method: 'asaoka+hiperbolik', params: { dt, from: range?.[0] ?? data.analysis.constantLoadFrom, to: range?.[1] ?? null }, note } });
      toast(`Snapshot #${r.id} tersimpan · hash input ${r.input_hash.slice(0, 10)}…`);
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const calibrate = async () => {
    if (!back || !confirm(`Terapkan c_h = ${back.ch.toFixed(2)} m²/tahun ke zona ${data.zone.code}? Perubahan tercatat di audit log.`)) return;
    try { await api(`/zones/${data.zone.id}/calibrate`, { body: { ch: +back.ch.toFixed(3), source: `back-analysis ${data.instrument.code}` } }); toast('Parameter zona dikalibrasi'); } catch (e: any) { toast(e.message, 'err'); }
  };

  if (!data) return <Loading what="analisis" />;
  const a = data.analysis;
  return (
    <div className="grid cols-side-main" style={{ marginBottom: 12 }}>
      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Parameter">
          <div className="grid" style={{ gap: 8 }}>
            <div className="kv-list">
              <span>Instrumen</span><span>{data.instrument.code}</span>
              <span>Zona</span><span>{data.zone.code}</span>
              <span>Beban konstan sejak</span><span>{date(a.constantLoadFrom)}</span>
            </div>
            <label className="field"><span>Interval Asaoka Δt</span><UnitInput value={dt} onChange={(v) => setDt(Math.max(1, Number(v) || 7))} unit="hari" design={7} /></label>
            <div className="field"><span>Rentang data (brush pada grafik)</span>
              <div className="row tight"><span className="mono">{range ? `${date(range[0])} – ${date(range[1])}` : `otomatis: sejak ${date(a.constantLoadFrom)}`}</span>{range && <button className="btn sm ghost" onClick={() => setRange(null)}>reset</button>}</div>
            </div>
            <div className="row tight">
              {session.can('engineer') && <button className="btn" disabled={busy} onClick={runBack}>{busy ? 'Menghitung…' : 'Back-analysis c_h'}</button>}
              {session.can('engineer') && <button className="btn primary" onClick={saveSnap}>Simpan snapshot</button>}
            </div>
          </div>
        </Panel>
        <Panel title="Hasil">
          <table className="t">
            <thead><tr><th>Metode</th><th className="num">S∞</th><th className="num">U</th><th className="num">R²</th></tr></thead>
            <tbody>
              <tr><td>Asaoka</td><td className="num">{num(a.final_asaoka)}<span className="unit">mm</span></td><td className="num">{pct(a.U_asaoka)}<span className="unit">%</span></td><td className="num dim">{a.asaoka?.r2 != null ? a.asaoka.r2.toFixed(4) : '—'}</td></tr>
              <tr><td>Hiperbolik</td><td className="num">{num(a.final_hyper)}<span className="unit">mm</span></td><td className="num">{pct(a.U_hyper)}<span className="unit">%</span></td><td className="num dim">{a.hyperbolic?.r2 != null && Number.isFinite(a.hyperbolic.r2) ? a.hyperbolic.r2.toFixed(4) : '—'}</td></tr>
              <tr><td>Teoretis</td><td className="num">{num(a.theory.final)}<span className="unit">mm</span></td><td className="num">{pct(a.theory.U)}<span className="unit">%</span></td><td className="num dim">—</td></tr>
              {back && <tr><td>Back-analysis</td><td className="num">{num(back.curve[back.curve.length - 1][1])}<span className="unit">mm</span></td><td className="num">—</td><td className="num dim">RMSE {num(back.rmse, 1)}</td></tr>}
            </tbody>
          </table>
          <div className="kv-list" style={{ marginTop: 8 }}>
            <span>S terukur</span><span>{num(a.current)} mm</span>
            <span>Selisih A–H</span><span style={{ color: a.diffPct > 10 ? 'var(--waspada)' : undefined }}>{a.diffPct != null ? `${num(a.diffPct, 1)} %` : '—'}</span>
            <span>β₀ / β₁</span><span>{a.asaoka ? `${num(a.asaoka.beta0, 2)} / ${a.asaoka.beta1?.toFixed(4)}` : '—'}</span>
            <span>α / β hiperb.</span><span>{a.hyperbolic?.valid ? `${a.hyperbolic.alpha.toExponential(3)} / ${a.hyperbolic.beta.toExponential(3)}` : '—'}</span>
            <span>Laju 4 minggu</span><span>{num(a.rate7d, 1)} mm/minggu</span>
            <span>Estimasi U 90%</span><span>{a.dateU90 ? date(a.dateU90) : a.U_asaoka >= 0.9 ? 'tercapai' : '—'}</span>
            <span>Sisa (beban rencana)</span><span>{num(a.residualDesign)} mm</span>
            <span>Versi algoritma</span><span>{a.algoVersion}</span>
          </div>
          {(a.asaoka?.message || a.hyperbolic?.message) && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{a.asaoka?.message}{a.asaoka?.message && a.hyperbolic?.message ? ' · ' : ''}{a.hyperbolic?.message}</div>}
        </Panel>
        {back && (
          <Panel title="Back-analysis c_h (F-ANL-07)">
            <div className="kv-list">
              <span>c_h terbaik</span><span className="b">{num(back.ch, 2)} m²/tahun</span>
              <span>Rentang (RMSE ≤ batas)</span><span>{num(back.chLow, 2)} – {num(back.chHigh, 2)}</span>
              <span>c_h desain</span><span>{num(back.designCh, 2)} m²/tahun</span>
              <span>Faktor skala S</span><span>{num(back.scale, 3)}</span>
              <span>t₉₀ radial</span><span>{num(back.t90_years * 12, 1)} bln (desain {num(back.t90_design_years * 12, 1)} bln)</span>
            </div>
            <RmseChart curve={back.curve} best={back.ch} />
            {session.can('engineer') && <button className="btn" style={{ marginTop: 6 }} onClick={calibrate}>Terapkan ke zona {data.zone.code}</button>}
          </Panel>
        )}
      </div>

      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Waktu – penurunan – tinggi timbunan" right={<span className="muted" style={{ fontSize: 11.5 }}>{loading ? 'menghitung…' : 'gunakan alat brush (ikon kanan atas) untuk memilih rentang data'}</span>}>
          <MainChart d={data} back={back} onBrush={(r) => r && setRange(r)} />
        </Panel>
        <Panel title="Plot diagnostik" right={<Seg value={method === 'back' ? 'asaoka' : method} onChange={setMethod} options={[{ value: 'asaoka', label: 'Asaoka' }, { value: 'hiperbolik', label: 'Hiperbolik' }, { value: 'teoretis', label: 'Teoretis' }]} />}>
          {method === 'asaoka' || method === 'back' ? <AsaokaChart a={a} /> : method === 'hiperbolik' ? <HyperChart a={a} /> : <TheoryInfo d={data} />}
        </Panel>
      </div>
    </div>
  );
}

function MainChart({ d, back, onBrush }: { d: any; back: any; onBrush: (r: [number, number] | null) => void }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    const now = Date.now();
    return {
      ...o,
      grid: [{ left: 64, right: 24, top: 36, height: '60%' }, { left: 64, right: 24, top: '78%', height: '13%' }],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      toolbox: { right: 10, top: 0, iconStyle: { borderColor: p.text2 }, feature: { brush: { type: ['lineX', 'clear'], title: { lineX: 'Pilih rentang', clear: 'Hapus' } }, dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Kembali' } } } },
      brush: { xAxisIndex: 0, brushStyle: { color: 'rgba(232,119,46,0.12)', borderColor: p.accent }, throttleType: 'debounce', throttleDelay: 300 },
      xAxis: [{ ...(o.xAxis as any), type: 'time', gridIndex: 0, axisLabel: { show: false } }, { ...(o.xAxis as any), type: 'time', gridIndex: 1 }],
      yAxis: [{ ...(o.yAxis as any), type: 'value', inverse: true, name: 'Penurunan (mm)', gridIndex: 0 }, { ...(o.yAxis as any), type: 'value', name: 'H (m)', gridIndex: 1, splitNumber: 2 }],
      legend: { ...(o.legend as any), type: 'scroll', left: 64, right: 150 },
      series: [
        { name: `${d.instrument.code} terukur`, type: 'line', showSymbol: false, data: d.series, color: p.s1, lineStyle: { width: 1.8 }, markLine: stageMarkLines(d.stages), sampling: 'lttb' },
        ...d.related.map((r: any, i: number) => ({ name: r.code, type: r.code.startsWith('SP') ? 'scatter' : 'line', symbolSize: 5, showSymbol: false, data: r.data, color: i ? p.s4 : p.s3, lineStyle: { width: 1, opacity: 0.7 } })),
        { name: 'Teoretis (desain, jadwal rencana)', type: 'line', showSymbol: false, data: d.theory, color: p.text2, lineStyle: { type: 'dotted', width: 1.3 } },
        ...(d.forecast.length ? [{ name: 'Proyeksi Asaoka', type: 'line', showSymbol: false, data: [d.series[d.series.length - 1], ...d.forecast], color: p.accent, lineStyle: { type: 'dashed', width: 1.5, opacity: 0.8 } }] : []),
        ...(d.hyperCurve.length ? [{ name: 'Kurva hiperbolik', type: 'line', showSymbol: false, data: d.hyperCurve, color: p.s2, lineStyle: { type: 'dashed', width: 1.2, opacity: 0.7 } }] : []),
        ...(back ? [
          { name: `Back-analysis c_h ${back.ch.toFixed(2)}`, type: 'line', showSymbol: false, data: back.curve, color: p.s3, lineStyle: { width: 1.5, type: 'dashed' } },
          { name: 'Rentang c_h', type: 'line', showSymbol: false, data: back.low, color: p.s3, lineStyle: { width: 0.6, opacity: 0.5 } },
          { name: 'Rentang c_h ', type: 'line', showSymbol: false, data: back.high, color: p.s3, lineStyle: { width: 0.6, opacity: 0.5 } },
        ] : []),
        { name: 'H aktual/rencana', type: 'line', showSymbol: false, data: d.fill, xAxisIndex: 1, yAxisIndex: 1, color: '#9c8a66', areaStyle: { opacity: 0.25 }, markLine: { symbol: 'none', silent: true, data: [{ xAxis: now }], lineStyle: { color: p.accent, type: 'solid', width: 1 }, label: { formatter: 'hari ini', color: p.accent, fontSize: 10 } } },
      ],
    };
  }, [d, back]);
  return <Chart option={option as any} height={440} onBrush={onBrush} />;
}

function AsaokaChart({ a }: { a: any }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    const pairs = a.asaoka?.pairs ?? [];
    if (!pairs.length) return null;
    const lo = Math.min(...pairs.map((q: any) => q.x)) * 0.98;
    const hi = Math.max(a.final_asaoka ?? 0, ...pairs.map((q: any) => q.y)) * 1.02;
    const reg = a.asaoka?.valid ? [[lo, a.asaoka.beta0 + a.asaoka.beta1 * lo], [hi, a.asaoka.beta0 + a.asaoka.beta1 * hi]] : [];
    return {
      ...o, tooltip: { ...(o.tooltip as any), trigger: 'item' },
      grid: { left: 64, right: 24, top: 30, bottom: 44 },
      xAxis: { ...(o.xAxis as any), type: 'value', name: 'ρᵢ₋₁ (mm)', nameLocation: 'middle', nameGap: 28, min: Math.floor(lo), max: Math.ceil(hi) },
      yAxis: { ...(o.yAxis as any), type: 'value', name: 'ρᵢ (mm)', min: Math.floor(lo), max: Math.ceil(hi) },
      series: [
        { name: 'Pasangan data', type: 'scatter', data: pairs.map((q: any) => [+q.x.toFixed(1), +q.y.toFixed(1)]), color: p.s1, symbolSize: 6 },
        { name: 'Regresi', type: 'line', data: reg, showSymbol: false, color: p.accent, lineStyle: { width: 1.4 } },
        { name: 'ρᵢ = ρᵢ₋₁', type: 'line', data: [[lo, lo], [hi, hi]], showSymbol: false, color: p.text3, lineStyle: { type: 'dashed', width: 1 } },
        ...(a.final_asaoka ? [{ name: `S∞ = ${a.final_asaoka.toFixed(0)} mm`, type: 'scatter', data: [[a.final_asaoka, a.final_asaoka]], symbol: 'circle', symbolSize: 11, color: p.bahaya }] : []),
      ],
    };
  }, [a]);
  if (!option) return <div className="empty">{a.asaoka?.message ?? 'Belum ada data beban konstan.'}</div>;
  return (
    <>
      <Chart option={option as any} height={320} />
      <div className="muted mono" style={{ fontSize: 11.5 }}>ρᵢ = {num(a.asaoka.beta0, 2)} + {a.asaoka.beta1?.toFixed(4)}·ρᵢ₋₁ · S∞ = β₀ / (1 − β₁) = {num(a.final_asaoka)} mm · n = {a.asaoka.n} · Δt = {a.asaoka.dtDays} hari</div>
    </>
  );
}

function HyperChart({ a }: { a: any }) {
  const option = useMemo(() => {
    const h = a.hyperbolic;
    if (!h?.points?.length) return null;
    const o = baseOption();
    const p = palette();
    const xs = h.points.map((q: any) => q.t);
    const x1 = Math.max(...xs);
    return {
      ...o, tooltip: { ...(o.tooltip as any), trigger: 'item' },
      grid: { left: 70, right: 24, top: 30, bottom: 44 },
      xAxis: { ...(o.xAxis as any), type: 'value', name: 't sejak beban konstan (hari)', nameLocation: 'middle', nameGap: 28 },
      yAxis: { ...(o.yAxis as any), type: 'value', name: 't / (ρ − ρ₀) (hari/mm)', scale: true },
      series: [
        { name: 'Data', type: 'scatter', data: h.points.map((q: any) => [q.t, +q.y.toFixed(4)]), color: p.s2, symbolSize: 4 },
        ...(h.valid ? [{ name: 'Regresi', type: 'line', showSymbol: false, data: [[0, h.alpha], [x1, h.alpha + h.beta * x1]], color: p.accent }] : []),
      ],
    };
  }, [a]);
  if (!option) return <div className="empty">{a.hyperbolic?.message ?? 'Belum ada data beban konstan.'}</div>;
  return (
    <>
      <Chart option={option as any} height={320} />
      <div className="muted mono" style={{ fontSize: 11.5 }}>t/(ρ−ρ₀) = α + β·t · S∞ = ρ₀ + 1/β = {num(a.final_hyper)} mm (ρ₀ = {num(a.hyperbolic.s0)} mm pada {date(a.hyperbolic.t0)})</div>
    </>
  );
}

function TheoryInfo({ d }: { d: any }) {
  const p = d.design.pvd;
  return (
    <div className="grid cols-2">
      <div className="kv-list">
        <span>c_v</span><span>{d.design.cv} m²/tahun</span>
        <span>c_h</span><span>{d.design.ch} m²/tahun</span>
        <span>H_dr</span><span>{d.design.hdr} m</span>
        {p && <><span>PVD</span><span>{p.pattern} {p.spacing} m · {p.a}×{p.b} mm</span><span>s, k_h/k_s</span><span>{p.s}, {p.khKs}</span></>}
        <span>S∞ teoretis (beban aktual)</span><span>{num(d.analysis.theory.final)} mm</span>
        <span>U teoretis kini</span><span>{pct(d.analysis.theory.U)} %</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
          T_v = c_v·t / H_dr²<br />U_h = 1 − exp(−8·T_h / μ)<br />μ = ln(n/s) + (k_h/k_s)·ln(s) − 0,75<br />U = 1 − (1 − U_v)(1 − U_h)
        </div>
        <p>Penurunan akhir per tahap dihitung dari C_c, e₀, OCR per irisan 0,5 m; tahap disuperposisi sebagai beban seketika di tengah periode pelaksanaan. Kurva teoretis di grafik atas memakai jadwal rencana untuk tahap yang belum dilaksanakan.</p>
      </div>
    </div>
  );
}

function RmseChart({ curve, best }: { curve: { ch: number; rmse: number }[]; best: number }) {
  const option = useMemo(() => {
    const o = baseOption();
    const p = palette();
    return {
      ...o, grid: { left: 50, right: 12, top: 16, bottom: 34 },
      xAxis: { ...(o.xAxis as any), type: 'log', name: 'c_h (m²/th)', nameLocation: 'middle', nameGap: 22, min: 0.3, max: 15 },
      yAxis: { ...(o.yAxis as any), type: 'log', name: 'RMSE (mm)' },
      series: [{ type: 'line', data: curve.map((c) => [c.ch, Math.max(0.1, c.rmse)]), showSymbol: false, color: p.s3, markLine: { symbol: 'none', data: [{ xAxis: best }], lineStyle: { color: p.accent }, label: { formatter: best.toFixed(2), color: p.accent } } }],
    };
  }, [curve, best]);
  return <Chart option={option as any} height={160} />;
}

function PiezoWorkspace({ id }: { id: number }) {
  const { data } = useApi<any>(`/analysis/piezo/${id}`, [id], ['readings']);
  const option = useMemo(() => {
    if (!data) return null;
    const o = baseOption();
    const p = palette();
    return {
      ...o,
      grid: [{ left: 64, right: 64, top: 36, height: '52%' }, { left: 64, right: 64, top: '72%', height: '18%' }],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [{ ...(o.xAxis as any), type: 'time', gridIndex: 0, axisLabel: { show: false } }, { ...(o.xAxis as any), type: 'time', gridIndex: 1 }],
      yAxis: [
        { ...(o.yAxis as any), name: 'Tekanan (kPa)', gridIndex: 0 },
        { ...(o.yAxis as any), name: 'U (%)', gridIndex: 0, max: 100, min: 0, splitLine: { show: false } },
        { ...(o.yAxis as any), name: 'H (m)', gridIndex: 1, splitNumber: 2 },
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
      series: [
        { name: 'Δu ekses', type: 'line', showSymbol: false, data: data.excess, color: p.s1, markLine: stageMarkLines(data.stages) },
        { name: 'Δσ = γ·H (Δu₀)', type: 'line', showSymbol: false, data: data.du0, color: p.text3, lineStyle: { type: 'dashed' } },
        { name: 'Readout manual', type: 'scatter', data: data.manual, color: p.accent, symbolSize: 6 },
        { name: 'U = 1 − Δu/Δu₀', type: 'line', showSymbol: false, data: data.U, yAxisIndex: 1, color: p.s2, lineStyle: { width: 1 } },
        { name: 'H timbunan', type: 'line', showSymbol: false, data: data.fill, xAxisIndex: 1, yAxisIndex: 2, color: '#9c8a66', areaStyle: { opacity: 0.25 } },
      ],
    };
  }, [data]);
  if (!data) return <Loading what="analisis piezometer" />;
  const a = data.analysis;
  return (
    <div className="grid cols-side-main" style={{ marginBottom: 12 }}>
      <Panel title="Hasil disipasi">
        <div className="kv-list">
          <span>Instrumen</span><span>{a.code} · {a.depth} m</span>
          <span>u hidrostatis</span><span>{num(data.instrument.meta.u_hydro, 1)} kPa</span>
          <span>Δu ekses kini</span><span>{num(a.excessNow, 1)} kPa</span>
          <span>Δu₀ = γ·H</span><span>{num(a.du0, 1)} kPa</span>
          <span>U piezometer</span><span className="b">{pct(a.U)} %</span>
          <span>Disipasi tahap {a.stageNo}</span><span>{pct(a.stageDissipation)} %</span>
          <span>Δu/Δσ tahap</span><span>{a.duDsigma != null ? num(a.duDsigma, 2) : '—'}</span>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>U = 1 − Δu(t)/Δu₀ dengan Δu₀ = Δσ total (B̄ = 1). Disipasi tahap dihitung dari puncak Δu tahap terakhir. <Link to={`/instrumen/${id}`}>Data mentah →</Link></div>
      </Panel>
      <Panel title="Disipasi tekanan air pori ekses (F-ANL-05)"><Chart option={option as any} height={420} /></Panel>
    </div>
  );
}

function Snapshots({ instrumentId }: { instrumentId?: number }) {
  const { data, reload } = useApi<any[]>(`/analysis/snapshots${instrumentId ? `?instrument=${instrumentId}` : ''}`, [instrumentId]);
  const [verify, setVerify] = useState<any>(null);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  return (
    <Panel title="Snapshot analisis (F-ANL-10)" flush>
      {(!data || data.length === 0) && <div className="empty">Belum ada snapshot untuk instrumen ini.</div>}
      {data && data.length > 0 && (
        <table className="t">
          <thead><tr><th>#</th><th>Waktu</th><th>Instrumen</th><th>Metode</th><th>Parameter</th><th>Hash input</th><th>Versi</th><th>Oleh</th><th>Catatan</th><th /></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.id}</td><td className="mono nowrap">{dateTime(s.created_at)}</td><td className="mono">{s.instrument_code ?? s.zone_code}</td><td>{s.method}</td>
              <td className="mono dim" style={{ fontSize: 11 }}>{s.params_json}</td><td className="mono dim">{s.input_hash.slice(0, 12)}…</td><td className="mono dim">{s.algo_version}</td><td>{s.by_name}</td><td className="muted">{s.note}</td>
              <td><button className="btn sm" onClick={async () => setVerify(await api(`/analysis/snapshots/${s.id}/verify`))}>Verifikasi</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {verify && (
        <div style={{ padding: 10, borderTop: '1px solid var(--line-soft)' }}>
          <span className={`badge ${verify.identical_input ? 'ok' : 'Waspada'}`}>{verify.identical_input ? 'Input identik — hasil dapat direproduksi' : 'Input berubah sejak snapshot (ada data baru/backfill)'}</span>
          <span className="mono muted" style={{ marginLeft: 8, fontSize: 11 }}>tersimpan {verify.stored_hash.slice(0, 12)} · dihitung ulang {verify.recomputed_hash.slice(0, 12)} · algoritma {verify.algo_version} → {verify.current_algo}</span>
          {verify.result?.final_asaoka != null && <div style={{ marginTop: 4 }}>S∞ Asaoka saat snapshot: <Q v={num(verify.result.final_asaoka)} unit="mm" /> · U <Q v={pct(verify.result.U_asaoka)} unit="%" /></div>}
        </div>
      )}
    </Panel>
  );
}
