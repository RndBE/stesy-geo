import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session } from '../api';

const DEMO = [
  ['geotek@stesygeo.local', 'Engineer'],
  ['surveyor@stesygeo.local', 'Surveyor'],
  ['teknisi@stesygeo.local', 'Teknisi'],
  ['pengawas@stesygeo.local', 'Pengawas'],
  ['admin@stesygeo.local', 'Admin'],
];

export default function Login() {
  const [email, setEmail] = useState('geotek@stesygeo.local');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/login', { body: { email, password } });
      session.set(r.token, r.user);
      nav('/');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="login mm-grid">
      <form className="box glass" onSubmit={submit}>
        <h1>STESY GEO</h1>
        <div className="muted" style={{ marginBottom: 16 }}>Sistem Monitoring Konsolidasi Tanah</div>
        <div className="grid" style={{ gap: 10 }}>
          <label className="field"><span>Email</span><input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
          <label className="field"><span>Kata sandi</span><input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></label>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Masuk…' : 'Masuk'}</button>
        </div>
        <div className="muted" style={{ marginTop: 16, fontSize: 11.5 }}>
          Akun contoh (kata sandi <span className="mono">stesygeo2026</span>):
          <div className="row tight" style={{ marginTop: 6 }}>
            {DEMO.map(([e, l]) => <button type="button" key={e} className="btn sm ghost" onClick={() => setEmail(e)}>{l}</button>)}
          </div>
        </div>
      </form>
    </div>
  );
}
