// Layar 7 — Alarm: daftar, filter, konfirmasi dengan catatan tindakan (F-ALM-04).
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, session, useApi } from '../api';
import { Panel, Level, Loading, Seg, toast } from '../components/ui';
import { dateTime, ago } from '../lib/format';

export default function Alarms() {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'unack' | 'all'>('open');
  const [category, setCategory] = useState<'' | 'geoteknik' | 'teknis'>('');
  const [level, setLevel] = useState('');
  const zone = sp.get('zone') ?? '';
  const q = new URLSearchParams({ status, ...(category ? { category } : {}), ...(level ? { level } : {}), ...(zone ? { zone } : {}) }).toString();
  const { data, reload } = useApi<any[]>(`/alarms?${q}`, [q], ['alarms']);
  const [ackId, setAckId] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const ack = async (id: number) => {
    try {
      await api(`/alarms/${id}/ack`, { body: { note } });
      toast('Alarm dikonfirmasi dan dicatat di log');
      setAckId(null); setNote(''); reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Alarm</h1><div className="sub">Ambang tiga level Waspada – Siaga – Bahaya; alarm geoteknik terpicu hanya bila dua pembacaan berurutan melewati ambang. Alarm teknis dipisahkan.</div></div>
        <div className="grow" />
        <Link to="/pengaturan" className="btn sm">Atur ambang</Link>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Seg value={status} onChange={setStatus} options={[{ value: 'open', label: 'Aktif / belum dikonfirmasi' }, { value: 'unack', label: 'Belum dikonfirmasi' }, { value: 'all', label: 'Semua' }]} />
        <Seg value={category} onChange={setCategory} options={[{ value: '', label: 'Semua kategori' }, { value: 'geoteknik', label: 'Geoteknik' }, { value: 'teknis', label: 'Teknis' }]} />
        <Seg value={level} onChange={setLevel} options={[{ value: '', label: 'Semua level' }, { value: 'Waspada', label: 'Waspada' }, { value: 'Siaga', label: 'Siaga' }, { value: 'Bahaya', label: 'Bahaya' }]} />
        {zone && <span className="badge neutral">filter zona #{zone}</span>}
      </div>
      <Panel flush>
        {!data ? <Loading /> : data.length === 0 ? <div className="empty">Tidak ada alarm untuk filter ini.</div> : (
          <table className="t">
            <thead><tr><th>Waktu</th><th>Level</th><th>Kategori</th><th>Zona</th><th>Sumber</th><th>Keterangan</th><th>Status</th><th>Konfirmasi</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <Fragment key={a.id}>
                  <tr style={{ background: !a.ack_at && !a.cleared_at && a.level !== 'Waspada' ? 'color-mix(in srgb, var(--bahaya) 7%, transparent)' : undefined }}>
                    <td className="mono nowrap">{dateTime(a.ts)}<div className="dim" style={{ fontSize: 11 }}>{ago(a.ts)}</div></td>
                    <td><Level level={a.level} /></td>
                    <td className="label">{a.category}</td>
                    <td className="mono">{a.zone_code ?? '—'}</td>
                    <td className="mono">{a.instrument_id ? <Link to={`/instrumen/${a.instrument_id}`}>{a.instrument_code}</Link> : a.device_code ?? '—'}</td>
                    <td style={{ maxWidth: 520 }}>{a.message}</td>
                    <td className="nowrap">{a.cleared_at ? <span className="muted">normal {dateTime(a.cleared_at)}</span> : <span className="badge neutral">aktif</span>}</td>
                    <td style={{ minWidth: 200 }}>
                      {a.ack_at ? <div style={{ fontSize: 12 }}><span style={{ color: 'var(--ok)' }}>✔</span> {a.ack_name} <span className="dim">{dateTime(a.ack_at)}</span><div className="muted">{a.ack_note}</div></div>
                        : session.can('engineer') ? <button className="btn sm" onClick={() => { setAckId(ackId === a.id ? null : a.id); setNote(''); }}>Konfirmasi…</button> : <span className="muted">belum</span>}
                    </td>
                  </tr>
                  {ackId === a.id && (
                    <tr><td colSpan={8} style={{ background: 'var(--surface-2)' }}>
                      <div className="row">
                        <input className="inp" style={{ flex: 1 }} autoFocus placeholder="Catatan tindakan, mis. hentikan penimbunan zona Z-03, pembacaan diperapat 30 menit" value={note} onChange={(e) => setNote(e.target.value)} />
                        <button className="btn primary" disabled={note.trim().length < 5} onClick={() => ack(a.id)}>Konfirmasi alarm</button>
                        <button className="btn ghost" onClick={() => setAckId(null)}>Batal</button>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
