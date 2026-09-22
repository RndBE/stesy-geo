// Klien API + sesi + SSE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mockApi } from './mock';

export interface User { id: number; email: string; name: string; role: 'admin' | 'engineer' | 'surveyor' | 'viewer' }
const RANK = { viewer: 0, surveyor: 1, engineer: 2, admin: 3 };

const TOKEN_KEY = 'stesygeo.token';
const USER_KEY = 'stesygeo.user';
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* abaikan */ } },
};

export const session = {
  token: store.get(TOKEN_KEY),
  user: (() => { try { return JSON.parse(store.get(USER_KEY) ?? 'null') as User | null; } catch { return null; } })(),
  set(token: string | null, user: User | null) {
    this.token = token; this.user = user;
    store.set(TOKEN_KEY, token); store.set(USER_KEY, user ? JSON.stringify(user) : null);
  },
  can(role: User['role']) { return !!this.user && RANK[this.user.role] >= RANK[role]; },
};

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Prototipe: semua permintaan dilayani data dummy di browser (src/mock), tanpa backend.
  try {
    return (await mockApi(path, opts as any)) as T;
  } catch (e: any) {
    throw new ApiError(e.status ?? 500, e.message);
  }
}

/** Tautan unduhan/laporan → file statis dummy. */
export const authUrl = (path: string) => {
  const base = `${import.meta.env.BASE_URL}data/`;
  if (path.startsWith('/reports/weekly')) return base + (path.includes('lang=en') ? 'report-en.html' : 'report-id.html');
  if (path.startsWith('/export/analysis.csv')) return base + 'export-analysis.csv';
  if (path.startsWith('/export/readings.csv')) return base + 'export-readings-30d.csv';
  return base + 'manifest.json';
};

/** Muat data dan muat ulang saat event SSE yang relevan datang. */
export function useApi<T = any>(path: string | null, deps: unknown[] = [], liveEvents: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  useLive(liveEvents, load);
  return { data, error, loading, reload: load, setData };
}

type Listener = (ev: string, data: any) => void;
const listeners = new Set<Listener>();
let lastEventAt = 0;

/** Prototipe: tidak ada server SSE. Event "tick" tetap dikirim tiap menit agar jam & usia data berjalan. */
let ticking = false;
export function connectStream() {
  if (ticking) return;
  ticking = true;
  setInterval(() => { lastEventAt = Date.now(); listeners.forEach((l) => l('tick', { at: lastEventAt })); }, 60e3);
}
export const streamAge = () => lastEventAt;

/** Debounced reload saat event tertentu. */
export function useLive(events: string[], cb: () => void, delay = 1500) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const key = events.join(',');
  useEffect(() => {
    if (!events.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const l: Listener = (ev) => {
      if (!events.includes(ev)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), delay);
    };
    listeners.add(l);
    return () => { listeners.delete(l); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);
}
