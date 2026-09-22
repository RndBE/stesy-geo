import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session } from '../api';

// Prototipe: login cukup dengan memilih akun demo (tanpa kata sandi).
const DEMO = [
  ['geotek@stesygeo.local', 'Geotechnical Engineer', 'analisis, konfirmasi alarm, parameter'],
  ['surveyor@stesygeo.local', 'Surveyor', 'input data lapangan'],
  ['teknisi@stesygeo.local', 'Teknisi telemetri', 'pemeliharaan perangkat'],
  ['pengawas@stesygeo.local', 'Konsultan pengawas / owner', 'baca-saja'],
  ['admin@stesygeo.local', 'Administrator', 'semua, termasuk ambang & pengguna'],
];

export default function Login() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const nav = useNavigate();
  const enter = async (email: string) => {
    setBusy(email);
    try {
      const r = await api('/login', { body: { email } });
      session.set(r.token, r.user);
      nav('/');
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="login mm-grid">
      <div className="box glass" style={{ width: 400 }}>
        <h1>STESY GEO</h1>
        <div className="muted" style={{ marginBottom: 4 }}>Sistem Monitoring Konsolidasi Tanah</div>
        <div className="badge" style={{ color: 'var(--accent)', marginBottom: 14 }}>PROTOTIPE · DATA DUMMY</div>
        <div className="label" style={{ marginBottom: 6 }}>Masuk sebagai</div>
        <div className="grid" style={{ gap: 6 }}>
          {DEMO.map(([email, label, desc]) => (
            <button key={email} className="btn" style={{ height: 'auto', padding: '7px 10px', justifyContent: 'space-between' }} disabled={!!busy} onClick={() => enter(email)}>
              <span style={{ textAlign: 'left' }}><b>{label}</b><div className="muted" style={{ fontSize: 11.5 }}>{desc}</div></span>
              <span className="mono muted" style={{ fontSize: 11 }}>{busy === email ? '…' : '→'}</span>
            </button>
          ))}
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="muted" style={{ marginTop: 12, fontSize: 11.5 }}>Tidak perlu kata sandi. Perubahan yang Anda buat tidak disimpan.</div>
      </div>
    </div>
  );
}
