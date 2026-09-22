// Layar 6 — Input data: form cepat per rute survei (F-INS-02) dan import CSV dengan template pemetaan (F-INS-03).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, session, useApi } from '../api';
import { Panel, Loading, toast } from '../components/ui';
import { sta, num, offsetLabel, dateTime, toInputDateTime, fromInputDateTime } from '../lib/format';

export default function InputData() {
  const [tab, setTab] = useState<'rute' | 'csv'>('rute');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Input data</h1><div className="sub">Pembacaan kontrol manual & cadangan. Telemetri tetap jalur data utama; nilai manual yang menyimpang ditandai, bukan ditolak.</div></div>
      </div>
      <div className="tabs">
        <button className={tab === 'rute' ? 'on' : ''} onClick={() => setTab('rute')}>Form per rute survei</button>
        <button className={tab === 'csv' ? 'on' : ''} onClick={() => setTab('csv')}>Import CSV / XLSX (disimpan sebagai CSV)</button>
      </div>
      {!session.can('surveyor') && <div className="panel" style={{ padding: 10, marginBottom: 10 }}>Akun Anda hanya baca. Input data memerlukan role surveyor atau lebih tinggi.</div>}
      {tab === 'rute' ? <RouteForm /> : <CsvImport />}
    </div>
  );
}

interface Entry { value: string; note: string; state?: 'ok' | 'warn' | 'saved' | 'err'; msg?: string }

function RouteForm() {
  const { data } = useApi<any[]>('/routes?project=1');
  const [routeId, setRouteId] = useState('kontrol');
  const [ts, setTs] = useState(toInputDateTime(Date.now()));
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [busy, setBusy] = useState(false);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const route = data?.find((r) => r.id === routeId);
  useEffect(() => setEntries({}), [routeId]);

  const validate = (id: number, value: string) => {
    clearTimeout(timers.current[id]);
    if (value === '' || !Number.isFinite(Number(value))) return;
    timers.current[id] = setTimeout(async () => {
      try {
        const r = await api(`/instruments/${id}/validate`, { body: { ts: new Date(fromInputDateTime(ts)).toISOString(), value: Number(value) } });
        setEntries((e) => ({
          ...e, [id]: {
            ...e[id],
            state: r.flag || r.spike ? 'warn' : 'ok',
            msg: r.flag === 'di_luar_rentang' ? 'Di luar rentang fisik sensor' : r.spike ? `Menyimpang dari tren (perkiraan ${num(r.expected, 1)} ± ${num(r.sd * 4, 1)})` : 'Sesuai tren',
          },
        }));
      } catch { /* abaikan */ }
    }, 350);
  };

  const saveAll = async () => {
    setBusy(true);
    let ok = 0, flagged = 0;
    for (const [idStr, e] of Object.entries(entries)) {
      const id = Number(idStr);
      if (e.value === '' || e.state === 'saved') continue;
      try {
        const r = await api(`/instruments/${id}/readings`, { body: { ts: fromInputDateTime(ts), value: Number(e.value), note: e.note || undefined } });
        ok++; if (r.flag) flagged++;
        setEntries((x) => ({ ...x, [id]: { ...x[id], state: 'saved', msg: r.flag ? `Tersimpan · ditandai ${r.flag}` : 'Tersimpan' } }));
      } catch (err: any) {
        setEntries((x) => ({ ...x, [id]: { ...x[id], state: 'err', msg: err.message } }));
      }
    }
    setBusy(false);
    toast(`${ok} pembacaan tersimpan${flagged ? `, ${flagged} ditandai untuk ditinjau` : ''}. Analisis & alarm dievaluasi ulang.`);
  };

  if (!data) return <Loading what="rute" />;
  const filled = Object.values(entries).filter((e) => e.value !== '' && e.state !== 'saved').length;
  return (
    <Panel title="Form pembacaan" right={<div className="row">
      <select className="inp" value={routeId} onChange={(e) => setRouteId(e.target.value)}>{data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <label className="row tight"><span className="muted">Waktu baca (WIB)</span><input className="inp" type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} /></label>
      <button className="btn primary" disabled={!filled || busy || !session.can('surveyor')} onClick={saveAll}>{busy ? 'Menyimpan…' : `Simpan ${filled} pembacaan`}</button>
    </div>} flush>
      <table className="t">
        <thead><tr><th>#</th><th>Instrumen</th><th>STA · offset</th><th>3 bacaan terakhir</th><th style={{ width: 170 }}>Nilai baru</th><th>Catatan</th><th>Validasi</th></tr></thead>
        <tbody>
          {route?.instruments.map((i: any, k: number) => {
            const e = entries[i.id] ?? { value: '', note: '' };
            const bg = e.state === 'warn' ? 'color-mix(in srgb, var(--waspada) 14%, transparent)' : e.state === 'err' ? 'color-mix(in srgb, var(--bahaya) 14%, transparent)' : undefined;
            return (
              <tr key={i.id} style={{ background: bg }}>
                <td className="mono dim">{k + 1}</td>
                <td><span className="mono b">{i.code}</span> <span className="muted" style={{ fontSize: 11.5 }}>{i.typeLabel}{i.tip_depth ? ` · ${i.tip_depth} m` : ''}{i.mode === 'telemetry' ? ' · telemetri' : ''}</span></td>
                <td className="mono nowrap">{sta(i.sta)} · {offsetLabel(i.offset)}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>{i.recent.map((r: any) => <div key={r.ts}>{num(r.value, i.unit === 'kPa' ? 1 : 0)} {i.unit} <span className="dim">{dateTime(r.ts)} · {r.source}</span></div>)}</td>
                <td>
                  <div className="unit-input">
                    <input type="number" step="any" value={e.value} disabled={!session.can('surveyor')}
                      onChange={(ev) => { const v = ev.target.value; setEntries((x) => ({ ...x, [i.id]: { ...e, value: v, state: undefined, msg: undefined } })); validate(i.id, v); }} />
                    <span className="u">{i.unit}</span>
                  </div>
                </td>
                <td><input className="inp" style={{ width: '100%' }} value={e.note} placeholder="opsional" onChange={(ev) => setEntries((x) => ({ ...x, [i.id]: { ...e, note: ev.target.value } }))} /></td>
                <td style={{ fontSize: 11.5, color: e.state === 'warn' ? 'var(--waspada)' : e.state === 'err' ? 'var(--bahaya)' : e.state === 'saved' ? 'var(--ok)' : 'var(--text-2)' }}>{e.msg ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

const TEMPLATE_KEY = 'stesygeo.csvTemplates';
const SAMPLE = `kode;waktu;bacaan;keterangan
SP-01;2026-09-21 09:00;1869;waterpass rute Z-01
SP-02;2026-09-21 09:20;1850;
SP-03;2026-09-21 09:45;1236;batang disambung`;

function CsvImport() {
  const [csv, setCsv] = useState(SAMPLE);
  const header = useMemo(() => { const l = csv.trim().split(/\r?\n/)[0] ?? ''; return l.split(l.includes(';') ? ';' : ',').map((h) => h.trim()); }, [csv]);
  const guess = (keys: string[]) => header.find((h) => keys.some((k) => h.toLowerCase().includes(k))) ?? '';
  const [mapping, setMapping] = useState({ instrument: '', ts: '', value: '', note: '' });
  const [templates, setTemplates] = useState<Record<string, typeof mapping>>(() => { try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? '{}'); } catch { return {}; } });
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    setMapping((m) => ({
      instrument: header.includes(m.instrument) ? m.instrument : guess(['kode', 'instr', 'code']),
      ts: header.includes(m.ts) ? m.ts : guess(['waktu', 'tanggal', 'time', 'date']),
      value: header.includes(m.value) ? m.value : guess(['bacaan', 'nilai', 'value', 'mm']),
      note: header.includes(m.note) ? m.note : guess(['ket', 'catatan', 'note']),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.join('|')]);

  const run = async (dryRun: boolean) => {
    try {
      const r = await api('/import/csv', { body: { csv, mapping: { ...mapping, note: mapping.note || undefined }, dryRun } });
      setPreview({ ...r, dryRun });
      if (!dryRun) toast(`${r.imported} baris diimpor, ${r.errors.length} galat`);
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const saveTemplate = () => {
    const name = prompt('Nama template pemetaan:');
    if (!name) return;
    const t = { ...templates, [name]: mapping };
    setTemplates(t);
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t)); } catch { /* abaikan */ }
    toast(`Template "${name}" disimpan`);
  };
  const onFile = (f: File | undefined) => { if (f) f.text().then(setCsv); };

  return (
    <div className="grid cols-2">
      <Panel title="Data" right={<label className="btn sm">Pilih berkas CSV<input type="file" accept=".csv,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>}>
        <textarea className="inp" rows={14} style={{ width: '100%' }} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Pemisah koma atau titik koma. Waktu tanpa zona dianggap WIB. Untuk XLSX, simpan sebagai CSV dari aplikasi spreadsheet.</div>
      </Panel>
      <Panel title="Pemetaan kolom" right={<div className="row tight">
        {Object.keys(templates).length > 0 && <select className="inp" defaultValue="" onChange={(e) => e.target.value && setMapping(templates[e.target.value])}><option value="">Template…</option>{Object.keys(templates).map((k) => <option key={k}>{k}</option>)}</select>}
        <button className="btn sm" onClick={saveTemplate}>Simpan sebagai template</button>
      </div>}>
        <div className="grid cols-2" style={{ gap: 8 }}>
          {(['instrument', 'ts', 'value', 'note'] as const).map((k) => (
            <label key={k} className="field"><span>{{ instrument: 'Kode instrumen', ts: 'Waktu baca', value: 'Nilai', note: 'Catatan (opsional)' }[k]}</span>
              <select className="inp" value={mapping[k]} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}><option value="">—</option>{header.map((h) => <option key={h}>{h}</option>)}</select>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => run(true)}>Pratinjau</button>
          <button className="btn primary" disabled={!session.can('surveyor')} onClick={() => run(false)}>Impor</button>
        </div>
        {preview && (
          <div style={{ marginTop: 10 }}>
            <div className="b">{preview.dryRun ? 'Pratinjau' : 'Hasil impor'}: {preview.results.filter((r: any) => r.ok).length} baris valid, {preview.errors.length} galat</div>
            <table className="t" style={{ marginTop: 4 }}>
              <thead><tr><th>Baris</th><th>Instrumen</th><th>Waktu</th><th className="num">Nilai</th><th>Status</th></tr></thead>
              <tbody>{preview.results.map((r: any) => (
                <tr key={r.line}><td className="mono">{r.line}</td><td className="mono">{r.instrument ?? '—'}</td><td className="mono">{r.ts ? dateTime(r.ts) : '—'}</td><td className="num">{r.value ?? '—'}</td>
                  <td style={{ color: r.error ? 'var(--bahaya)' : r.flag ? 'var(--waspada)' : 'var(--ok)' }}>{r.error ?? (r.flag ? `ditandai: ${r.flag}` : 'ok')}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
