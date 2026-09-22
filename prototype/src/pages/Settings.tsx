// Layar 11 — Pengaturan: ambang alarm, pengguna & role, CRS, audit log.
import { Fragment, useState } from 'react';
import { api, session, useApi } from '../api';
import { Panel, Loading, toast, UnitInput } from '../components/ui';
import { dateTime } from '../lib/format';

export default function Settings() {
  const [tab, setTab] = useState<'ambang' | 'pengguna' | 'proyek' | 'audit'>('ambang');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Pengaturan</h1><div className="sub">Perubahan ambang, parameter, dan role tercatat di audit log (siapa, kapan, nilai lama → baru).</div></div></div>
      <div className="tabs">
        {(['ambang', 'pengguna', 'proyek', 'audit'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ ambang: 'Ambang alarm', pengguna: 'Pengguna & role', proyek: 'Proyek & CRS', audit: 'Audit log' }[t]}</button>)}
      </div>
      {tab === 'ambang' && <Thresholds />}
      {tab === 'pengguna' && <Users />}
      {tab === 'proyek' && <ProjectInfo />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Thresholds() {
  const { data, reload } = useApi<any>('/alarm-rules');
  const zones = useApi<any>('/projects/1/overview');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [nz, setNz] = useState({ zone_id: '', parameter: 'lateral_rate', level: 'Waspada', threshold: '' });
  if (!data) return <Loading />;
  const admin = session.can('admin');
  const save = async (id: number) => {
    try { await api(`/alarm-rules/${id}`, { method: 'PUT', body: { threshold: Number(edits[id]) } }); toast('Ambang disimpan'); setEdits((e) => { const c = { ...e }; delete c[id]; return c; }); reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const toggle = async (r: any) => { try { await api(`/alarm-rules/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); reload(); } catch (e: any) { toast(e.message, 'err'); } };
  const add = async () => { try { await api('/alarm-rules', { body: { ...nz, zone_id: nz.zone_id ? Number(nz.zone_id) : null, threshold: Number(nz.threshold) } }); toast('Aturan zona ditambahkan'); reload(); } catch (e: any) { toast(e.message, 'err'); } };
  const params = Object.entries(data.parameters) as [string, any][];
  return (
    <div className="grid cols-main-side">
      <Panel title="Ambang per parameter (proyek & override zona)" flush>
        <table className="t">
          <thead><tr><th>Parameter</th><th>Berlaku</th><th>Level</th><th style={{ width: 200 }}>Ambang</th><th>Aktif</th><th /></tr></thead>
          <tbody>
            {params.map(([k, p]) => (
              <Fragment key={k}>
                <tr><td colSpan={6} style={{ background: 'var(--surface-2)' }}><b>{p.label}</b> <span className="muted">({p.unit || 'rasio'} · {p.types.join(', ')})</span></td></tr>
                {data.rules.filter((r: any) => r.parameter === k).map((r: any) => (
                  <tr key={r.id}>
                    <td /><td className="mono">{r.zone_code ?? 'semua zona'}</td>
                    <td><span className={`badge ${r.level}`}>{r.level}</span></td>
                    <td><UnitInput value={edits[r.id] ?? r.threshold} onChange={(v) => setEdits({ ...edits, [r.id]: v })} unit={p.unit || '–'} disabled={!admin} /></td>
                    <td><input type="checkbox" checked={!!r.enabled} disabled={!admin} onChange={() => toggle(r)} /></td>
                    <td>{edits[r.id] != null && <button className="btn sm primary" onClick={() => save(r.id)}>Simpan</button>}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Tambah override zona">
          <div className="grid" style={{ gap: 8 }}>
            <select className="inp" value={nz.zone_id} onChange={(e) => setNz({ ...nz, zone_id: e.target.value })}><option value="">Pilih zona…</option>{(zones.data?.zones ?? []).map((z: any) => <option key={z.id} value={z.id}>{z.code} {z.name}</option>)}</select>
            <select className="inp" value={nz.parameter} onChange={(e) => setNz({ ...nz, parameter: e.target.value })}>{params.map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
            <select className="inp" value={nz.level} onChange={(e) => setNz({ ...nz, level: e.target.value })}>{['Waspada', 'Siaga', 'Bahaya'].map((l) => <option key={l}>{l}</option>)}</select>
            <UnitInput value={nz.threshold} onChange={(v) => setNz({ ...nz, threshold: v })} unit={data.parameters[nz.parameter]?.unit || '–'} />
            <button className="btn primary" disabled={!admin || !nz.zone_id || nz.threshold === ''} onClick={add}>Tambah</button>
          </div>
        </Panel>
        <Panel title="Catatan">
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            <li>Nilai default mengikuti contoh PRD 9.4 (ilustratif). Nilai final ditetapkan konsultan/owner.</li>
            <li>Penekanan alarm palsu: level efektif = minimum dari dua pembacaan berurutan.</li>
            <li>Disarankan masa kalibrasi 2 minggu pertama tanpa notifikasi eksternal.</li>
            <li>Hanya Admin yang dapat mengubah ambang.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Users() {
  const { data, reload, error } = useApi<any[]>(session.can('admin') ? '/users' : null);
  if (!session.can('admin')) return <div className="panel" style={{ padding: 10 }}>Hanya Admin yang dapat mengelola pengguna.</div>;
  if (error) return <div className="err">{error}</div>;
  const set = async (id: number, role: string) => { try { await api(`/users/${id}`, { method: 'PUT', body: { role } }); toast('Role diperbarui'); reload(); } catch (e: any) { toast(e.message, 'err'); } };
  return (
    <Panel title="Pengguna" flush>
      <table className="t">
        <thead><tr><th>Nama</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>{(data ?? []).map((u) => (
          <tr key={u.id}><td>{u.name}</td><td className="mono">{u.email}</td>
            <td><select className="inp" value={u.role} onChange={(e) => set(u.id, e.target.value)} disabled={u.id === session.user?.id}>{['admin', 'engineer', 'surveyor', 'viewer'].map((r) => <option key={r}>{r}</option>)}</select></td></tr>
        ))}</tbody>
      </table>
      <div className="muted" style={{ fontSize: 11.5, padding: 10 }}>Admin: semua · Engineer: analisis, konfirmasi alarm, parameter · Surveyor: input data & pemeliharaan · Viewer: baca-saja (owner/pengawas).</div>
    </Panel>
  );
}

function ProjectInfo() {
  const { data } = useApi<any>('/projects/1/overview');
  if (!data) return <Loading />;
  const p = data.project;
  return (
    <Panel title="Proyek">
      <div className="kv-list">
        <span>Nama</span><span style={{ fontFamily: 'var(--sans)' }}>{p.name}</span>
        <span>Kode</span><span>{p.code}</span>
        <span>Tipe</span><span>{p.type}</span>
        <span>Sistem koordinat</span><span>EPSG:{p.crs_epsg} (WGS 84 / UTM zona 49S)</span>
        <span>Datum elevasi</span><span>{p.vertical_datum}</span>
        <span>Zona waktu</span><span>{p.timezone} ({p.tz_label})</span>
        <span>Zona</span><span>{data.zones.map((z: any) => z.code).join(', ')}</span>
      </div>
    </Panel>
  );
}

function Audit() {
  const { data, error } = useApi<any[]>(session.can('engineer') ? '/audit?limit=300' : null);
  if (!session.can('engineer')) return <div className="panel" style={{ padding: 10 }}>Audit log dapat dilihat oleh Engineer dan Admin.</div>;
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <Panel flush>
      <table className="t">
        <thead><tr><th>Waktu</th><th>Pengguna</th><th>Entitas</th><th>Aksi</th><th>Nilai lama</th><th>Nilai baru</th></tr></thead>
        <tbody>{data.map((a) => (
          <tr key={a.id}><td className="mono nowrap">{dateTime(a.ts)}</td><td>{a.user_name ?? 'sistem'}</td><td className="mono">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td>{a.action}</td>
            <td className="mono dim" style={{ fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.before_json}</td><td className="mono" style={{ fontSize: 11, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.after_json}</td></tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}
