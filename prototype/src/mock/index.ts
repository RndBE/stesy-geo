// API tiruan untuk prototipe frontend. Menyajikan data dummy dari public/data/*.json
// (snapshot dari sistem STESY GEO), menggeser seluruh timestamp agar "hari ini" selalu terkini,
// dan meniru perilaku endpoint tulis di memori (tidak tersimpan setelah halaman dimuat ulang).
import { asaoka, hyperbolic, hyperbolicAt, asaokaForecast, type Point } from './fitting';

const DAY = 86400e3;
const BASE = `${import.meta.env.BASE_URL}data/`;

let offset = 0;
let ready: Promise<void> | null = null;
const cache = new Map<string, Promise<any>>();

function init() {
  // acuan = bacaan telemetri terakhir di data dummy, dibuat seolah 2 menit lalu
  ready ??= Promise.all([fetch(BASE + 'manifest.json').then((r) => r.json()), fetch(BASE + 'overview.json').then((r) => r.json())])
    .then(([m, o]) => { offset = Date.now() - 120e3 - (o.latestData ?? m.generatedAt); });
  return ready;
}

/** Geser semua angka yang tampak seperti timestamp (ms epoch 2020–2033). */
function shift<T>(v: T): T {
  if (typeof v === 'number') return (v > 1.58e12 && v < 2.0e12 ? v + offset : v) as T;
  if (Array.isArray(v)) return v.map(shift) as T;
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === 'params_json' || k === 'before_json' || k === 'after_json' ? x : shift(x);
    return o;
  }
  return v;
}

export async function load<T = any>(file: string): Promise<T> {
  await init();
  if (!cache.has(file)) {
    cache.set(file, fetch(BASE + file).then((r) => { if (!r.ok) throw new MockError(404, `Data dummy tidak tersedia (${file})`); return r.json(); }).then(shift));
  }
  return cache.get(file)!;
}

export class MockError extends Error { constructor(public status: number, message: string) { super(message); } }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
let seq = 900000;

// ---------------------------------------------------------------- analisis ulang di browser

async function settlement(id: number, q: URLSearchParams) {
  const base = clone(await load(`analysis/settlement-${id}.json`));
  const dt = Number(q.get('dt') ?? 7);
  const from = q.get('from') ? Number(q.get('from')) : null;
  const to = q.get('to') ? Number(q.get('to')) : undefined;
  if (dt === 7 && from == null && to == null) return base;
  const pts: Point[] = base.series.map(([t, v]: [number, number]) => ({ t, v }));
  const a = base.analysis;
  const clf: number | null = a.constantLoadFrom;
  const aFrom = from ?? (clf != null ? clf + 3 * DAY : undefined);
  const hFrom = from ?? clf;
  const as = aFrom != null ? asaoka(pts, dt, aFrom, to) : null;
  const hy = hFrom != null ? hyperbolic(pts, hFrom, to) : null;
  a.asaoka = as; a.hyperbolic = hy;
  a.final_asaoka = as?.valid ? as.finalSettlement : null;
  a.final_hyper = hy?.valid ? hy.finalSettlement : null;
  a.U_asaoka = as?.valid ? as.U : null;
  a.U_hyper = hy?.valid ? hy.U : null;
  a.diffPct = a.final_asaoka != null && a.final_hyper != null ? (Math.abs(a.final_hyper - a.final_asaoka) / a.final_asaoka) * 100 : null;
  const last = pts[pts.length - 1];
  a.dateU90 = null;
  if (as?.valid && a.current != null && a.current < 0.9 * as.finalSettlement) {
    const n = Math.log((0.1 * as.finalSettlement) / (as.finalSettlement - a.current)) / Math.log(as.beta1);
    a.dateU90 = last.t + n * dt * DAY;
  }
  const horizon = last.t + 240 * DAY;
  base.forecast = as?.valid ? asaokaForecast(as, last.t, last.v, horizon).map((p) => [p.t, +p.v.toFixed(1)]) : [];
  base.hyperCurve = [];
  if (hy?.valid) for (let t = hy.t0; t <= horizon; t += 2 * DAY) base.hyperCurve.push([t, +hyperbolicAt(hy, t).toFixed(1)]);
  return base;
}

// ---------------------------------------------------------------- router

export async function mockApi(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
  const method = (opts.method ?? (opts.body ? 'POST' : 'GET')).toUpperCase();
  const url = new URL(path, 'http://x');
  const p = url.pathname;
  const q = url.searchParams;
  const body = opts.body ?? {};
  const m = (re: RegExp) => p.match(re);
  let r: RegExpMatchArray | null;

  if (method === 'GET') {
    if (p === '/me') return (await import('../api')).session.user;
    if (p === '/projects') return [(await load('overview.json')).project];
    if (p === '/projects/1/overview') return load('overview.json');
    if (p === '/projects/1/longitudinal') return load('longitudinal.json');
    if (p === '/projects/1/twin') return load('twin.json');
    if (p === '/projects/1/trend') return load(`trend-${q.get('days') === '7' ? 7 : 30}.json`);
    if (p === '/instruments') return load('instruments.json');
    if (p === '/routes') return load('routes.json');
    if (p === '/alarm-rules') return load('alarm-rules.json');
    if (p === '/telemetry/devices') return load('telemetry-devices.json');
    if (p === '/telemetry/compare') return load('telemetry-compare.json');
    if (p === '/telemetry/maintenance') return load('telemetry-maintenance.json');
    if (p === '/telemetry/reference-checks') return load('telemetry-reference-checks.json');
    if (p === '/users') return load('users.json');
    if (p === '/audit') return load('audit.json');
    if (p === '/alarms') {
      const all: any[] = await load('alarms.json');
      const st = q.get('status') ?? 'open';
      return all.filter((a) =>
        (st === 'all' || (st === 'unack' ? a.ack_at == null : a.cleared_at == null || a.ack_at == null)) &&
        (!q.get('category') || a.category === q.get('category')) &&
        (!q.get('level') || a.level === q.get('level')) &&
        (!q.get('zone') || String(a.zone_id) === q.get('zone')));
    }
    if (p === '/analysis/snapshots') {
      const all: any[] = await load('snapshots.json');
      return q.get('instrument') ? all.filter((s) => String(s.instrument_id) === q.get('instrument')) : all;
    }
    if ((r = m(/^\/analysis\/snapshots\/(\d+)\/verify$/))) {
      const s = (await load<any[]>('snapshots.json')).find((x) => x.id === Number(r![1]));
      return { id: s?.id, stored_hash: s?.input_hash ?? '', recomputed_hash: s?.input_hash ?? '', identical_input: true, algo_version: s?.algo_version, current_algo: s?.algo_version, result: s?.result ?? {} };
    }
    if ((r = m(/^\/telemetry\/health\/logger\/(\d+)$/))) return load(`health/logger-${r[1]}.json`);
    if ((r = m(/^\/zones\/(\d+)$/))) return load(`zones/${r[1]}.json`);
    if ((r = m(/^\/zones\/(\d+)\/combined$/))) return load(`zones/${r[1]}-combined.json`);
    if ((r = m(/^\/zones\/(\d+)\/compare$/))) return load(`zones/${r[1]}-compare.json`);
    if ((r = m(/^\/instruments\/(\d+)$/))) return load(`inst/${r[1]}.json`);
    if ((r = m(/^\/instruments\/(\d+)\/table$/))) return load(`inst/${r[1]}-table.json`);
    if ((r = m(/^\/instruments\/(\d+)\/readings$/))) {
      const days = (Date.now() - Number(q.get('from') ?? 0)) / DAY;
      return load(`inst/${r[1]}-${days <= 20 ? 'r14' : days <= 120 ? 'r90' : 'rall'}.json`);
    }
    if ((r = m(/^\/instruments\/(\d+)\/profiles$/))) {
      if (!q.get('dates')) return load(`inst/${r[1]}-profiles.json`);
      const daily = await load(`inst/${r[1]}-profiles-daily.json`);
      const t = Number(q.get('dates')!.split(',')[0]);
      const best = daily.profiles.reduce((b: any, x: any) => (Math.abs(x.ts - t) < Math.abs(b.ts - t) ? x : b), daily.profiles[0]);
      return { ...daily, profiles: best ? [best] : [] };
    }
    if ((r = m(/^\/analysis\/settlement\/(\d+)$/))) return settlement(Number(r[1]), q);
    if ((r = m(/^\/analysis\/piezo\/(\d+)$/))) return load(`analysis/piezo-${r[1]}.json`);
    throw new MockError(404, `Tidak tersedia di prototipe: ${p}`);
  }

  // ---- endpoint tulis: ditiru di memori sesi
  if (p === '/login') {
    const users: any[] = await load('users.json');
    const u = users.find((x) => x.email === String(body.email ?? '').trim().toLowerCase());
    if (!u) throw new MockError(401, 'Email tidak dikenal — pilih salah satu akun demo');
    return { token: 'prototipe', user: u };
  }
  if (p === '/logout') return { ok: true };
  if ((r = m(/^\/instruments\/(\d+)\/validate$/))) {
    const rows: any[] = await load(`inst/${r[1]}-table.json`);
    const last = rows[0]?.value ?? 0;
    const sd = Math.max(2, Math.abs(last) * 0.01);
    return { spike: Math.abs(Number(body.value) - last) > 4 * sd, expected: last, sd };
  }
  if ((r = m(/^\/instruments\/(\d+)\/readings$/))) {
    const rows: any[] = await load(`inst/${r[1]}-table.json`);
    const last = rows[0]?.value ?? 0;
    const flag = Math.abs(Number(body.value) - last) > 4 * Math.max(2, Math.abs(last) * 0.01) ? 'lonjakan' : null;
    rows.unshift({ id: ++seq, ts: Number(body.ts) || Date.now(), value: Number(body.value), source: 'manual', flag, note: body.note ?? null, entered_by: 'Anda (prototipe)', received_at: Date.now() });
    return { id: seq, flag, expected: last, sd: 0, alarms: 0 };
  }
  if ((r = m(/^\/alarms\/(\d+)\/ack$/))) {
    if (String(body.note ?? '').trim().length < 5) throw new MockError(400, 'Catatan tindakan wajib diisi (min. 5 karakter)');
    const all: any[] = await load('alarms.json');
    const a = all.find((x) => x.id === Number(r![1]));
    if (a) Object.assign(a, { ack_at: Date.now(), ack_note: body.note, ack_name: 'Anda (prototipe)' });
    return { ok: true };
  }
  if ((r = m(/^\/analysis\/backanalysis\/(\d+)$/))) return load(`analysis/back-${r[1]}.json`);
  if ((r = m(/^\/zones\/(\d+)\/scenario$/))) return load(`zones/${r[1]}-scenario.json`);
  if (p === '/analysis/snapshots') {
    const all: any[] = await load('snapshots.json');
    const inst = (await load<any[]>('instruments.json')).find((i) => i.id === Number(body.instrument_id));
    const hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    const s = { id: ++seq, instrument_id: body.instrument_id, instrument_code: inst?.code, method: body.method, params_json: JSON.stringify(body.params ?? {}), input_hash: hash, algo_version: 'stesygeo-analysis/1.0.0', note: body.note ?? null, created_at: Date.now(), by_name: 'Anda (prototipe)' };
    all.unshift(s);
    return { id: s.id, input_hash: hash, algo_version: s.algo_version };
  }
  if (p === '/import/csv') {
    const lines = String(body.csv ?? '').trim().split(/\r?\n/);
    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(sep).map((h) => h.trim());
    const idx = (k: string) => header.indexOf(body.mapping?.[k]);
    const insts: any[] = await load('instruments.json');
    const results = lines.slice(1).map((ln, k) => {
      const c = ln.split(sep).map((x) => x.trim());
      const inst = insts.find((i) => i.code === c[idx('instrument')]);
      const value = Number((c[idx('value')] ?? '').replace(',', '.'));
      const ts = Date.parse((c[idx('ts')] ?? '').replace(' ', 'T') + '+07:00');
      if (!inst) return { line: k + 2, error: `Instrumen ${c[idx('instrument')]} tidak dikenal` };
      if (!Number.isFinite(value) || !Number.isFinite(ts)) return { line: k + 2, error: 'Nilai/waktu tidak valid' };
      return { line: k + 2, instrument: inst.code, ts, value, ok: true };
    });
    return { imported: results.filter((x: any) => x.ok).length, errors: results.filter((x: any) => x.error), results };
  }
  if (p === '/telemetry/maintenance') {
    (await load<any[]>('telemetry-maintenance.json')).unshift({ id: ++seq, ts: body.ts ?? Date.now(), device_code: body.device_code, action: body.action, note: body.note, by_name: 'Anda (prototipe)' });
    return { id: seq };
  }
  if (p === '/telemetry/reference-checks') {
    const all: any[] = await load('telemetry-reference-checks.json');
    const first = all[all.length - 1];
    const delta = first ? +((first.elevation - Number(body.elevation)) * 1000).toFixed(1) : 0;
    all.unshift({ id: ++seq, target: body.target ?? 'TANK-01', ts: Date.now(), elevation: Number(body.elevation), delta_mm: delta, method: 'Waterpass', by_name: 'Anda (prototipe)' });
    return { id: seq, delta_mm: delta };
  }
  if ((r = m(/^\/zones\/(\d+)\/recommendations$/))) {
    const z = await load(`zones/${r[1]}.json`);
    z.recommendations.unshift({ id: ++seq, decision: body.decision, text: body.text, analysis_run_ids: JSON.stringify(body.analysis_run_ids ?? []), created_at: Date.now(), by_name: 'Anda (prototipe)' });
    return { id: seq };
  }
  // ubah parameter, tahap, ambang, role, flag, kalibrasi: diterima tanpa efek pada data dummy
  return { ok: true, prototipe: true };
}
