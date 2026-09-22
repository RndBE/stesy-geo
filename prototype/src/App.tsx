import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Box, Layers, Activity, FlaskConical, ClipboardPen, Bell, FileText, RadioTower, Spline, Settings as Cog, LogOut, Sun, Moon,
} from 'lucide-react';
import { api, connectStream, session, useApi, useLive } from './api';
import { Toaster } from './components/ui';
import { ago, time } from './lib/format';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Twin from './pages/Twin';
import ZonePage from './pages/ZonePage';
import InstrumentPage from './pages/InstrumentPage';
import Analysis from './pages/Analysis';
import InputData from './pages/InputData';
import Alarms from './pages/Alarms';
import Reports from './pages/Reports';
import Telemetry from './pages/Telemetry';
import Longitudinal from './pages/Longitudinal';
import Settings from './pages/Settings';
import Instruments from './pages/Instruments';

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('stesygeo.theme') ?? 'dark'; } catch { return 'dark'; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('stesygeo.theme', theme); } catch { /* abaikan */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/** Status strip (PRD 13.6): proyek, data terbaru, alarm per level, jam lokal. */
function StatusStrip({ theme, toggle }: { theme: string; toggle: () => void }) {
  const { data, reload } = useApi<any>('/projects/1/overview', [], ['alarms', 'zones']);
  useLive(['readings'], reload, 8000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const counts: Record<string, number> = { Waspada: 0, Siaga: 0, Bahaya: 0 };
  for (const a of data?.alarms ?? []) if (a.cleared_at == null) counts[a.level] = (counts[a.level] ?? 0) + 1;
  const tech = (data?.alarms ?? []).filter((a: any) => a.category === 'teknis' && a.cleared_at == null).length;
  const fresh = data?.latestData ? now - data.latestData < 2 * 3600e3 : false;
  return (
    <header className="strip">
      <span className="brand"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M4 22h24M8 22l4-8h8l4 8" fill="none" stroke="currentColor" strokeWidth="2.6" /></svg>STESY GEO</span>
      <span className="sep" />
      <span className="kv" title={data?.project?.name}><span className="mono b">{data?.project?.code ?? '…'}</span><span className="muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.project?.name}</span></span>
      <span className="sep" />
      <span className="kv"><span className="label">Data terbaru</span><span className="dot" style={{ background: fresh ? 'var(--ok)' : 'var(--waspada)' }} /><span className="mono">{ago(data?.latestData, now)}</span></span>
      <span className="sep" />
      <NavLink to="/alarm" className="kv" title="Alarm aktif per level">
        <span className="label">Alarm</span>
        {(['Waspada', 'Siaga', 'Bahaya'] as const).map((l) => (
          <span key={l} className="mono" style={{ color: counts[l] ? `var(--${l.toLowerCase()})` : 'var(--text-3)' }}>{l[0]}{counts[l]}</span>
        ))}
        <span className="mono dim" title="Alarm teknis">· T{tech}</span>
      </NavLink>
      <span className="grow" />
      <span className="badge" style={{ color: 'var(--accent)' }} title="Prototipe frontend: data dummy, perubahan tidak disimpan">PROTOTIPE · DATA DUMMY</span>
      <span className="mono">{time(now)} <span className="muted">{data?.project?.tz_label ?? 'WIB'}</span></span>
      <button className="btn ghost sm" onClick={toggle} title="Mode terang/gelap">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
    </header>
  );
}

const NAV: { to: string; label: string; icon: ReactNode; group?: string }[] = [
  { to: '/', label: 'Overview proyek', icon: <LayoutGrid size={15} strokeWidth={1.5} />, group: 'Pemantauan' },
  { to: '/twin', label: 'Digital twin', icon: <Box size={15} strokeWidth={1.5} /> },
  { to: '/profil', label: 'Profil memanjang', icon: <Spline size={15} strokeWidth={1.5} /> },
  { to: '/zona/1', label: 'Zona', icon: <Layers size={15} strokeWidth={1.5} /> },
  { to: '/instrumen', label: 'Instrumen', icon: <Activity size={15} strokeWidth={1.5} /> },
  { to: '/analisis', label: 'Workspace analisis', icon: <FlaskConical size={15} strokeWidth={1.5} />, group: 'Kerja' },
  { to: '/input', label: 'Input data', icon: <ClipboardPen size={15} strokeWidth={1.5} /> },
  { to: '/alarm', label: 'Alarm', icon: <Bell size={15} strokeWidth={1.5} /> },
  { to: '/laporan', label: 'Laporan', icon: <FileText size={15} strokeWidth={1.5} /> },
  { to: '/telemetri', label: 'Telemetri', icon: <RadioTower size={15} strokeWidth={1.5} />, group: 'Sistem' },
  { to: '/pengaturan', label: 'Pengaturan', icon: <Cog size={15} strokeWidth={1.5} /> },
];

function Shell() {
  const [theme, toggle] = useTheme();
  const nav = useNavigate();
  useEffect(() => { connectStream(); }, []);
  const logout = async () => { try { await api('/logout', { method: 'POST' }); } catch { /* abaikan */ } session.set(null, null); nav('/login'); };
  return (
    <div className="app">
      <StatusStrip theme={theme} toggle={toggle} />
      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.to} style={{ display: 'contents' }}>
            {n.group && <div className="group label">{n.group}</div>}
            <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive || (n.to.startsWith('/zona') && location.pathname.startsWith('/zona')) ? 'active' : '')}>{n.icon}{n.label}</NavLink>
          </div>
        ))}
        <div className="foot">
          <div className="b" style={{ fontSize: 12 }}>{session.user?.name}</div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <span className="label">{session.user?.role}</span>
            <button className="btn ghost sm" onClick={logout}><LogOut size={13} />Keluar</button>
          </div>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/twin" element={<Twin />} />
          <Route path="/profil" element={<Longitudinal />} />
          <Route path="/zona/:id" element={<ZonePage />} />
          <Route path="/instrumen" element={<Instruments />} />
          <Route path="/instrumen/:id" element={<InstrumentPage />} />
          <Route path="/analisis" element={<Analysis />} />
          <Route path="/input" element={<InputData />} />
          <Route path="/alarm" element={<Alarms />} />
          <Route path="/laporan" element={<Reports />} />
          <Route path="/telemetri" element={<Telemetry />} />
          <Route path="/pengaturan" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}

/** Cek sesi di setiap perpindahan rute (bukan hanya saat App pertama dirender). */
function RequireSession() {
  useLocation();
  return session.token ? <Shell /> : <Navigate to="/login" replace />;
}

export default function App() {
  useTheme();
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<RequireSession />} />
      </Routes>
    </BrowserRouter>
  );
}
