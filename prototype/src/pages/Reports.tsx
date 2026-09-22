// Layar 8 — Laporan mingguan (F-RPT-01/02/04).
import { useState } from 'react';
import { authUrl } from '../api';
import { Panel, Seg } from '../components/ui';
import { toInputDate, fromInputDate, DAY } from '../lib/format';

export default function Reports() {
  const [to, setTo] = useState(toInputDate(Date.now()));
  const [from, setFrom] = useState(toInputDate(Date.now() - 7 * DAY));
  const [lang, setLang] = useState<'id' | 'en'>('id');
  const [key, setKey] = useState(0);
  const url = authUrl(`/reports/weekly?project=1&from=${fromInputDate(from)}&to=${fromInputDate(to, true)}&lang=${lang}`);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Laporan</h1><div className="sub">Laporan mingguan otomatis: ringkasan zona, kriteria, profil memanjang, grafik per zona, tabel prediksi, piezometer, alarm, kolom persetujuan.</div></div>
      </div>
      <div className="grid cols-side-main">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Periode & template">
            <div className="grid" style={{ gap: 8 }}>
              <label className="field"><span>Dari</span><input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span>Sampai</span><input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <div className="field"><span>Bahasa</span><Seg value={lang} onChange={setLang} options={[{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} /></div>
              <div className="row">
                <button className="btn" onClick={() => setKey(key + 1)}>Muat ulang pratinjau</button>
                <a className="btn primary" href={url} target="_blank" rel="noreferrer">Buka & cetak PDF</a>
              </div>
            </div>
          </Panel>
          <Panel title="Ekspor data (F-RPT-02)">
            <div className="grid" style={{ gap: 6 }}>
              <a className="btn" href={authUrl(`/export/readings.csv?project=1&from=${fromInputDate(from)}&to=${fromInputDate(to, true)}`)}>Bacaan mentah periode ini (CSV)</a>
              <a className="btn" href={authUrl('/export/readings.csv?project=1')}>Semua bacaan (CSV)</a>
              <a className="btn" href={authUrl('/export/analysis.csv?project=1')}>Hasil analisis per instrumen (CSV)</a>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>CSV dapat dibuka langsung di Excel. Waktu dalam WIB (+07:00), nilai mentah & versi kalibrasi disertakan.</div>
          </Panel>
        </div>
        <Panel title="Pratinjau" flush>
          <iframe key={key + url} src={url} title="Pratinjau laporan" style={{ width: '100%', height: 'calc(100vh - 150px)', border: 0, background: '#fff' }} />
        </Panel>
      </div>
    </div>
  );
}
