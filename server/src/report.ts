// Laporan mingguan (F-RPT-01, F-JLN-07): HTML siap cetak → PDF lewat dialog cetak peramban.
import { getDb } from './db.js';
import { DAY, getZones, zoneStatus, zoneInstruments, dailySeries, getStages, fillHeightAt } from './domain.js';
import { longitudinal } from './twin.js';
import { ALGO_VERSION } from './analysis/consolidation.js';
import type { User } from './auth.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmtDate = (t: number, lang: 'id' | 'en') => new Date(t).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('id-ID'));
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(0)}%`);

const T = {
  id: {
    title: 'Laporan Mingguan Monitoring Konsolidasi', period: 'Periode', summary: 'Ringkasan status zona', zone: 'Zona', phase: 'Fase', H: 'Tinggi timbunan',
    U: 'U Asaoka', Uh: 'U hiperbolik', S: 'Penurunan', Sf: 'S akhir (Asaoka)', rem: 'Sisa', decision: 'Status', alarms: 'Alarm pada periode ini', none: 'Tidak ada alarm.',
    table: 'Tabel prediksi per instrumen (as jalan)', long: 'Profil memanjang penurunan', graphs: 'Grafik penurunan & tinggi timbunan', piezo: 'Piezometer — tekanan pori ekses',
    sign: 'Persetujuan', prepared: 'Disusun oleh', checked: 'Diperiksa (Konsultan Pengawas)', method: 'Metode: Asaoka (Δt 7 hari), hiperbolik (Tan), Terzaghi + Hansbo (Carrillo). Model analitis 1D + radial, bukan FEM.',
    criteria: 'Kriteria keputusan', rate: 'Laju (mm/mgg)', date90: 'Perkiraan U 90%', level: 'Level', time: 'Waktu', msg: 'Keterangan', ack: 'Konfirmasi',
  },
  en: {
    title: 'Weekly Consolidation Monitoring Report', period: 'Period', summary: 'Zone status summary', zone: 'Zone', phase: 'Phase', H: 'Fill height',
    U: 'U Asaoka', Uh: 'U hyperbolic', S: 'Settlement', Sf: 'Final S (Asaoka)', rem: 'Remaining', decision: 'Status', alarms: 'Alarms during period', none: 'No alarms.',
    table: 'Prediction table per instrument (centreline)', long: 'Longitudinal settlement profile', graphs: 'Settlement & fill height charts', piezo: 'Piezometers — excess pore pressure',
    sign: 'Approval', prepared: 'Prepared by', checked: 'Checked (Supervision Consultant)', method: 'Methods: Asaoka (Δt 7 days), hyperbolic (Tan), Terzaghi + Hansbo (Carrillo). Analytical 1D + radial model, not FEM.',
    criteria: 'Decision criteria', rate: 'Rate (mm/wk)', date90: 'Est. U 90%', level: 'Level', time: 'Time', msg: 'Description', ack: 'Acknowledged',
  },
};

/** Grafik garis SVG sederhana dengan sumbu ganda (penurunan ke bawah, tinggi timbunan). */
function chart(series: { name: string; color: string; data: [number, number][]; dashed?: boolean }[], fill: [number, number][], w = 720, h = 220): string {
  const all = series.flatMap((s) => s.data);
  if (!all.length) return '';
  const x0 = Math.min(...all.map((p) => p[0]), ...fill.map((p) => p[0]));
  const x1 = Math.max(...all.map((p) => p[0]));
  const yMax = Math.max(100, ...all.map((p) => p[1])) * 1.08;
  const hMax = Math.max(1, ...fill.map((p) => p[1])) * 1.3;
  const L = 52, R = 44, Tp = 12, B = 26;
  const X = (t: number) => L + ((t - x0) / Math.max(1, x1 - x0)) * (w - L - R);
  const Y = (v: number) => Tp + (v / yMax) * (h - Tp - B); // penurunan ke bawah
  const YH = (v: number) => h - B - (v / hMax) * (h - Tp - B) * 0.45;
  const grid = [];
  const step = yMax > 1500 ? 500 : yMax > 600 ? 200 : 100;
  for (let v = 0; v <= yMax; v += step) grid.push(`<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`);
  const months = [];
  const d = new Date(x0); d.setUTCDate(1); d.setUTCHours(0);
  for (let t = d.getTime(); t <= x1; ) {
    if (t >= x0) months.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${Tp}" y2="${h - B}" class="g"/><text x="${X(t) + 2}" y="${h - B + 13}">${new Date(t).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })}</text>`);
    const n = new Date(t); n.setUTCMonth(n.getUTCMonth() + 1); t = n.getTime();
  }
  const path = (data: [number, number][], f: (v: number) => number) => data.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${f(p[1]).toFixed(1)}`).join('');
  const fillPath = fill.length ? `<path d="${path(fill, YH)}" fill="none" stroke="#8A6D3B" stroke-width="1.2"/>` : '';
  const lines = series.map((s) => `<path d="${path(s.data, Y)}" fill="none" stroke="${s.color}" stroke-width="1.4" ${s.dashed ? 'stroke-dasharray="4 3"' : ''}/>`).join('');
  const legend = series.map((s, i) => `<g transform="translate(${L + 8 + i * 110},${h - 4})"><line x1="0" x2="14" y1="-3" y2="-3" stroke="${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="4 3"' : ''}/><text x="18" y="0">${esc(s.name)}</text></g>`).join('');
  return `<svg viewBox="0 0 ${w} ${h + 12}" class="chart">${grid.join('')}${months.join('')}<text x="8" y="${Tp + 4}" transform="rotate(-90 8 ${Tp + 4})" text-anchor="end">mm</text>${fillPath}${lines}<text x="${w - R + 4}" y="${h - B}" fill="#8A6D3B">H (m) maks ${hMax / 1.3 > 0 ? (hMax / 1.3).toFixed(1) : ''}</text><g transform="translate(0,12)">${legend}</g></svg>`;
}

export function weeklyReport(projectId: number, from: number, to: number, lang: 'id' | 'en', user: User): string {
  const t = T[lang];
  const db = getDb();
  const project = db.prepare('SELECT * FROM project WHERE id = ?').get(projectId) as any;
  const zones = getZones(projectId);
  const statuses = zones.map((z) => zoneStatus(z, to));
  const alarms = db.prepare(
    `SELECT e.*, i.code ic, z.code zc, u.name un FROM alarm_event e LEFT JOIN instrument i ON i.id = e.instrument_id LEFT JOIN zone z ON z.id = e.zone_id LEFT JOIN app_user u ON u.id = e.ack_by
     WHERE e.ts BETWEEN ? AND ? ORDER BY e.ts`,
  ).all(from, to) as any[];
  const lp = longitudinal(projectId);
  const colors = ['#1F6F8B', '#6C7A1E', '#B4541A', '#7A3E8E'];

  const summaryRows = statuses.map((s) => `<tr><td class="mono">${esc(s.zone.code)}</td><td>${esc(s.zone.name)}</td><td>${esc(s.phase)}${s.currentStage ? ` · tahap ${s.currentStage}` : ''}</td>
    <td class="num">${s.fillHeight.toFixed(2)} m</td><td class="num">${n0(s.currentSettlement)} mm</td><td class="num">${n0(s.finalSettlement)} mm</td>
    <td class="num">${pct(s.U)}</td><td class="num">${pct(s.U_hyper)}</td><td><b>${esc(s.decision)}</b></td></tr>`).join('');

  const crit = statuses.map((s) => `<div class="crit"><div class="mono b">${esc(s.zone.code)} — ${esc(s.decision)}</div><ul>${s.criteria.map((c) => `<li>${c.ok === true ? '✔' : c.ok === false ? '✘' : '–'} ${esc(c.label)} <span class="muted">(${esc(c.detail)})</span></li>`).join('')}</ul></div>`).join('');

  const predRows = statuses.flatMap((s) => s.settlement.map((a) => `<tr><td class="mono">${esc(s.zone.code)}</td><td class="mono">${esc(a.code)}</td><td class="num">${n0(a.current)}</td><td class="num">${n0(a.final_asaoka)}</td><td class="num">${n0(a.final_hyper)}</td><td class="num">${n0(a.theory.final)}</td><td class="num">${pct(a.U_asaoka)}</td><td class="num">${a.diffPct != null ? a.diffPct.toFixed(1) + '%' : '—'}</td><td class="num">${a.rate7d != null ? a.rate7d.toFixed(1) : '—'}</td><td>${a.dateU90 ? fmtDate(a.dateU90, lang) : '—'}</td></tr>`)).join('');

  const graphs = zones.map((z) => {
    const centre = zoneInstruments(z.id).filter((i) => ['SC', 'GN', 'SP'].includes(i.type) && Math.abs(i.offset ?? 99) <= 6).slice(0, 4);
    const stages = getStages(z.id);
    const first = Math.min(...stages.map((s) => s.actual_start ?? Infinity)) - 7 * DAY;
    const fill: [number, number][] = [];
    for (let tt = first; tt <= to; tt += 2 * DAY) fill.push([tt, fillHeightAt(stages, tt)]);
    const ser = centre.map((i, j) => ({ name: i.code, color: colors[j % colors.length], data: dailySeries(i.id, first, to).filter((_, n) => n % 2 === 0).map((p) => [p.t, p.v] as [number, number]) }));
    return `<div class="card"><div class="cap"><span class="mono b">${esc(z.code)}</span> ${esc(z.name)}</div>${chart(ser, fill)}</div>`;
  }).join('');

  const pzRows = statuses.flatMap((s) => s.piezo.map((p) => `<tr><td class="mono">${esc(s.zone.code)}</td><td class="mono">${esc(p.code)}</td><td class="num">${p.depth ?? '—'} m</td><td class="num">${p.excessNow != null ? p.excessNow.toFixed(1) : '—'} kPa</td><td class="num">${pct(p.U)}</td><td class="num">${pct(p.stageDissipation)}</td></tr>`)).join('');

  const st = lp.stations;
  const W = 720, Hh = 200, L = 52, R = 20;
  const X = (sta: number) => L + ((sta - st[0].sta) / (st[st.length - 1].sta - st[0].sta)) * (W - L - R);
  const eMin = Math.min(...st.map((s) => s.base_final_elev ?? s.base_elev)) - 0.3;
  const eMax = Math.max(...st.map((s) => Math.max(s.design_elev, s.top_elev))) + 0.3;
  const Y = (e: number) => 10 + ((eMax - e) / (eMax - eMin)) * (Hh - 36);
  const pl = (k: 'design_elev' | 'top_elev' | 'base_elev' | 'base_final_elev') => st.filter((s) => s[k] != null).map((s, i) => `${i ? 'L' : 'M'}${X(s.sta).toFixed(1)},${Y(s[k] as number).toFixed(1)}`).join('');
  const staLbl = (s: number) => `${Math.floor(s / 1000)}+${String(s % 1000).padStart(3, '0')}`;
  const ticks = [];
  for (let s = st[0].sta; s <= st[st.length - 1].sta; s += 100) ticks.push(`<line x1="${X(s)}" x2="${X(s)}" y1="10" y2="${Hh - 26}" class="g"/><text x="${X(s)}" y="${Hh - 14}" text-anchor="middle">${staLbl(s)}</text>`);
  const eTicks = [];
  for (let e = Math.ceil(eMin); e <= eMax; e += 1) eTicks.push(`<line x1="${L}" x2="${W - R}" y1="${Y(e)}" y2="${Y(e)}" class="g"/><text x="${L - 6}" y="${Y(e) + 3}" text-anchor="end">${e >= 0 ? '+' : ''}${e.toFixed(1)}</text>`);
  const longSvg = `<svg viewBox="0 0 ${W} ${Hh + 8}" class="chart">${eTicks.join('')}${ticks.join('')}
    <path d="${pl('design_elev')}" stroke="#222" stroke-width="1.2" fill="none" stroke-dasharray="6 3"/>
    <path d="${pl('top_elev')}" stroke="#8A6D3B" stroke-width="1.4" fill="none"/>
    <path d="${pl('base_elev')}" stroke="#1F6F8B" stroke-width="1.4" fill="none"/>
    <path d="${pl('base_final_elev')}" stroke="#1F6F8B" stroke-width="1.2" fill="none" stroke-dasharray="4 3"/>
    <g transform="translate(${L + 6},${Hh + 4})"><text>— — elevasi rencana</text><text x="130" fill="#8A6D3B">— puncak timbunan</text><text x="260" fill="#1F6F8B">— dasar timbunan (terukur)</text><text x="430" fill="#1F6F8B">- - dasar (prediksi akhir)</text></g></svg>`;

  const alarmRows = alarms.length ? alarms.map((a) => `<tr><td>${fmtDate(a.ts, lang)} ${new Date(a.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}</td><td><span class="lvl ${a.level}">${a.level}</span></td><td class="mono">${esc(a.zc ?? '—')}</td><td>${esc(a.message)}</td><td>${a.ack_at ? `${esc(a.un)} — ${esc(a.ack_note)}` : '<i>belum</i>'}</td></tr>`).join('') : `<tr><td colspan="5">${t.none}</td></tr>`;

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t.title)} — ${esc(project.code)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 11px/1.45 'IBM Plex Sans', sans-serif; color: #1a1f24; margin: 0; background: #fff; }
  .wrap { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .mono, .num { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
  .num { text-align: right; } .b { font-weight: 600; } .muted { color: #6b7580; }
  header.kop { display: grid; grid-template-columns: 1fr auto; border: 1.5px solid #1a1f24; }
  header.kop > div { padding: 6px 10px; } header.kop .meta { border-left: 1.5px solid #1a1f24; font-family: 'IBM Plex Mono', monospace; font-size: 10px; }
  h1 { font-size: 15px; margin: 0; } h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #1a1f24; padding-bottom: 3px; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; } th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; text-align: left; border-bottom: 1px solid #1a1f24; padding: 3px 4px; }
  td { border-bottom: 1px solid #d6dbe0; padding: 3px 4px; vertical-align: top; }
  .chart { width: 100%; font: 9px 'IBM Plex Mono', monospace; fill: #4a545e; } .chart .g { stroke: #e3e7eb; }
  .card { break-inside: avoid; margin-bottom: 8px; } .cap { font-size: 10.5px; margin-bottom: 2px; }
  .crit { break-inside: avoid; margin-bottom: 6px; } .crit ul { margin: 2px 0 0 16px; padding: 0; }
  .lvl { font-size: 9.5px; padding: 0 4px; border: 1px solid; } .lvl.Waspada { color: #8a6d00; } .lvl.Siaga { color: #b4541a; } .lvl.Bahaya { color: #a3281f; font-weight: 600; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; } .sign div { border: 1px solid #1a1f24; height: 80px; padding: 6px; }
  .toolbar { position: sticky; top: 0; background: #f2f4f6; padding: 6px 12px; border-bottom: 1px solid #ccd; display: flex; gap: 8px; align-items: center; }
  .toolbar button { font: inherit; padding: 4px 10px; border: 1px solid #1a1f24; background: #fff; border-radius: 3px; cursor: pointer; }
  @media print { .toolbar { display: none; } .wrap { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Cetak / simpan PDF</button><span class="muted">${esc(t.method)}</span></div>
<div class="wrap">
<header class="kop"><div><div class="muted" style="font-size:9.5px;text-transform:uppercase;letter-spacing:.06em">STESY GEO · ${esc(project.code)}</div><h1>${esc(t.title)}</h1><div>${esc(project.name)}</div></div>
<div class="meta">${t.period}: ${fmtDate(from, lang)} – ${fmtDate(to, lang)}<br>No.: LAP-${esc(project.code)}-${new Date(to).toISOString().slice(0, 10).replace(/-/g, '')}<br>Rev. 0 · ${esc(ALGO_VERSION)}<br>CRS EPSG:${project.crs_epsg} · ${esc(project.vertical_datum)}</div></header>
<h2>${t.summary}</h2>
<table><thead><tr><th>${t.zone}</th><th>STA</th><th>${t.phase}</th><th class="num">${t.H}</th><th class="num">${t.S}</th><th class="num">${t.Sf}</th><th class="num">${t.U}</th><th class="num">${t.Uh}</th><th>${t.decision}</th></tr></thead><tbody>${summaryRows}</tbody></table>
<h2>${t.criteria}</h2>${crit}
<h2>${t.long}</h2>${longSvg}
<h2>${t.graphs}</h2>${graphs}
<h2>${t.table}</h2>
<table><thead><tr><th>${t.zone}</th><th>Instrumen</th><th class="num">S (mm)</th><th class="num">Asaoka</th><th class="num">Hiperbolik</th><th class="num">Teoretis</th><th class="num">U</th><th class="num">Selisih</th><th class="num">${t.rate}</th><th>${t.date90}</th></tr></thead><tbody>${predRows}</tbody></table>
<h2>${t.piezo}</h2>
<table><thead><tr><th>${t.zone}</th><th>Instrumen</th><th class="num">Kedalaman</th><th class="num">Δu</th><th class="num">U</th><th class="num">Disipasi tahap</th></tr></thead><tbody>${pzRows}</tbody></table>
<h2>${t.alarms}</h2>
<table><thead><tr><th>${t.time}</th><th>${t.level}</th><th>${t.zone}</th><th>${t.msg}</th><th>${t.ack}</th></tr></thead><tbody>${alarmRows}</tbody></table>
<h2>${t.sign}</h2>
<div class="sign"><div>${t.prepared}:<br><b>${esc(user.name)}</b><br><span class="muted">${fmtDate(Date.now(), lang)}</span></div><div>${t.checked}:</div></div>
<p class="muted" style="margin-top:10px">${esc(t.method)} Penurunan sisa hanya mencakup konsolidasi primer. Dibuat otomatis oleh STESY GEO; angka mengikuti ketelitian instrumen.</p>
</div></body></html>`;
}

