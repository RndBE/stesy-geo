// Klien API + sesi + SSE.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface User { id: number; email: string; name: string; role: 'admin' | 'engineer' | 'surveyor' | 'viewer' }
const RANK = { viewer: 0, surveyor: 1, engineer: 2, admin: 3 };

const TOKEN_KEY = 'stesygeo.token';
const USER_KEY = 'stesygeo.user';
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* abaikan */ } },
};

/** Komponen yang perlu dirender ulang saat sesi berubah (mis. rute akar di App). */
const sessionListeners = new Set<() => void>();

export const session = {
  token: store.get(TOKEN_KEY),
  user: (() => { try { return JSON.parse(store.get(USER_KEY) ?? 'null') as User | null; } catch { return null; } })(),
  set(token: string | null, user: User | null) {
    this.token = token; this.user = user;
    store.set(TOKEN_KEY, token); store.set(USER_KEY, user ? JSON.stringify(user) : null);
    for (const l of sessionListeners) l();
  },
  can(role: User['role']) { return !!this.user && RANK[this.user.role] >= RANK[role]; },
};

/** Sesi sebagai sumber reaktif: pemanggilnya ikut dirender ulang saat login/logout. */
export function useSession() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    sessionListeners.add(l);
    return () => { sessionListeners.delete(l); };
  }, []);
  return session;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && !path.startsWith('/login')) {
    session.set(null, null);
    window.location.href = '/login';
  }
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, (data as any)?.error ?? r.statusText);
  return data as T;
}

export const authUrl = (path: string) => `/api${path}${path.includes('?') ? '&' : '?'}token=${session.token ?? ''}`;

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
let es: EventSource | null = null;
let lastEventAt = 0;

export function connectStream() {
  if (es || !session.token) return;
  es = new EventSource(`/api/stream?token=${session.token}`);
  for (const ev of ['readings', 'alarms', 'zones', 'tick']) {
    es.addEventListener(ev, (e) => {
      lastEventAt = Date.now();
      const d = JSON.parse((e as MessageEvent).data);
      listeners.forEach((l) => l(ev, d));
    });
  }
  es.onerror = () => { es?.close(); es = null; setTimeout(connectStream, 5000); };
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
