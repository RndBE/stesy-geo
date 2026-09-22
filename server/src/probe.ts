// Jembatan probe inclinometer live (F-TLM-03, varian vendor). Berlangganan topik MQTT
// alat, menghitung pergeseran lateral, menyiarkannya ke dashboard lewat SSE, dan
// menyimpan satu bacaan profil berkala supaya grafik, analisis, dan alarm ikut hidup.
//
// Alat mengirim Step<n>_X dan Step<n>_Y, lalu Step<n>_T dan Step<n>_AZ di slot
// berikutnya. Firmware lama tidak punya slot _T/_AZ, jadi keduanya dipulihkan dari
// sudut bidang kalau tidak ada: firmware memakai A = atan2(ax, hypot(ay, az)),
// sehingga ux = sin A dan uy = sin B — dari situ azim = atan2(sin B, sin A) dan
// T = acos(sqrt(1 − sin²A − sin²B)). Turunan ini cocok dengan kiriman alat sampai
// ~0,05°, jadi tampilannya tidak berubah bentuk saat slotnya kebetulan kosong.
//
// Periode kirim alat 1 detik (PUBLISH_INTERVAL_MS), bukan 10 Hz — aliran 10 Hz di
// penampil bawaan alat memakai baris $L lewat serial yang tidak ikut ke MQTT.
import mqtt from 'mqtt';
import { getDb } from './db.js';
import { ingestPayload } from './ingest.js';
import { broadcast } from './events.js';

const RAD = Math.PI / 180;

const URL = process.env.STESYGEO_PROBE_MQTT_URL ?? '';
const TOPIC = process.env.STESYGEO_PROBE_TOPIC ?? 'Logger_30083';
const CODE = process.env.STESYGEO_PROBE_INSTRUMENT ?? 'INC-01';
const GAUGE = Number(process.env.STESYGEO_PROBE_GAUGE_MM ?? 500);
// Tanpa env, jeda simpan mengikuti expected_interval_min instrumen tujuan — itu laju
// yang memang didaftarkan untuk instrumen ini, dan yang dipakai pemeriksa data basi.
// Menyimpan jauh lebih rapat dari itu hanya menumpuk pose sesaat, bukan informasi.
const PERSIST_MS_ENV = process.env.STESYGEO_PROBE_PERSIST_MS ? Number(process.env.STESYGEO_PROBE_PERSIST_MS) : null;
const PERSIST_MS_FALLBACK = 60 * 60e3;
/** Jendela untuk laju pergeseran. Terlalu pendek = yang terbaca hanya derau sensor. */
const RATE_WINDOW_MS = Number(process.env.STESYGEO_PROBE_RATE_WINDOW_MS ?? 60e3);

export interface ProbeSegment {
  /** kemiringan bidang A dan B, derajat — bukan kemiringan total */
  X: number; Y: number;
  /** simpangan total poros segmen, derajat */
  T: number;
  /** arah simpangan pada bidang A–B, derajat, 0 = sumbu A positif */
  azim: number;
  /** pergeseran segmen per bidang, mm: dA = gauge × sin A, sama dengan kolom CSV firmware */
  dA: number; dB: number;
  /** resultan pergeseran segmen ini, mm = hypot(dA, dB) = gauge × sin T */
  defl: number;
  /** pergeseran kumulatif dari pangkal probe, per bidang, mm */
  cumA: number; cumB: number;
  /** resultan kumulatif, mm */
  cum: number;
  /** arah pergeseran kumulatif, derajat */
  arah: number;
  /** pergeseran terhadap acuan (deformasi), per bidang dan resultan, mm */
  defA: number; defB: number; def: number;
}

/** Acuan nol: keadaan probe yang dianggap "belum bergerak". */
export interface ProbeBaseline { at: number; nodes: { cumA: number; cumB: number }[] }

export interface ProbeState {
  enabled: boolean;
  topic: string;
  device: string | null;
  instrument: string;
  gauge: number;
  /** tersambung ke broker */
  broker: boolean;
  /** LWT alat: null = belum ada kabar */
  online: boolean | null;
  /** stempel waktu payload terakhir (ms) */
  at: number | null;
  /** jam lokal menurut alat */
  waktu: string | null;
  seg: ProbeSegment[];
  baseline: ProbeBaseline | null;
  /** laju pergeseran simpul teratas, mm/menit; null kalau jendelanya belum penuh */
  rate: number | null;
  rateWindowMs: number;
  /** jeda minimum antar bacaan tersimpan, ms */
  persistMs: number;
  savedAt: number | null;
  error: string | null;
}

const state: ProbeState = {
  enabled: false, topic: TOPIC, device: null, instrument: CODE, gauge: GAUGE,
  broker: false, online: null, at: null, waktu: null, seg: [],
  baseline: null, rate: null, rateWindowMs: RATE_WINDOW_MS,
  persistMs: PERSIST_MS_ENV ?? PERSIST_MS_FALLBACK, savedAt: null, error: null,
};

export const probeState = (): ProbeState => state;

/** sensor1..sensorN -> { nama: nilai }. Slot kosong ({}) dilewati, bukan digeser. */
function slots(payload: Record<string, any>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(payload)) {
    if (!/^sensor\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const nama = (v as any).nama, nilai = (v as any).nilai;
    if (typeof nama === 'string' && typeof nilai === 'number' && Number.isFinite(nilai)) out.set(nama, nilai);
  }
  return out;
}

/**
 * Bentuk dan pergeseran probe dari sudut bidang. Indeks 0 = segmen paling bawah.
 *
 * Kumulatifnya dijumlahkan sebagai VEKTOR per bidang, bukan menjumlahkan besaran
 * resultan tiap segmen. Segmen yang miring ke arah berlawanan saling meniadakan;
 * menjumlahkan besarannya akan melaporkan pergeseran yang tidak pernah terjadi.
 */
export function segmentsFrom(named: Map<string, number>, gauge = GAUGE, baseline: ProbeBaseline | null = null): ProbeSegment[] {
  const seg: ProbeSegment[] = [];
  let cumA = 0, cumB = 0;
  for (let i = 1; named.has(`Step${i}_X`) && named.has(`Step${i}_Y`); i++) {
    const X = named.get(`Step${i}_X`)!, Y = named.get(`Step${i}_Y`)!;
    const ux = Math.sin(X * RAD), uy = Math.sin(Y * RAD);
    const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
    // Pakai kiriman alat kalau ada; turunkan sendiri kalau slotnya kosong.
    const T = named.get(`Step${i}_T`) ?? Math.acos(Math.min(1, uz)) / RAD;
    const azim = named.get(`Step${i}_AZ`) ?? Math.atan2(uy, ux) / RAD;
    const dA = gauge * ux, dB = gauge * uy;
    cumA += dA; cumB += dB;
    const base = baseline?.nodes[i - 1];
    const defA = cumA - (base?.cumA ?? 0), defB = cumB - (base?.cumB ?? 0);
    seg.push({
      X, Y, T, azim, dA, dB, defl: Math.hypot(dA, dB),
      cumA, cumB, cum: Math.hypot(cumA, cumB), arah: Math.atan2(cumB, cumA) / RAD,
      defA, defB, def: Math.hypot(defA, defB),
    });
  }
  return seg;
}

/**
 * Profil pergeseran untuk disimpan. pos = kedalaman (m) di bawah kepala probe, jadi
 * simpul terdalam = pangkal probe yang dianggap diam (pergeseran 0) dan simpangan
 * menumpuk ke atas — konvensi lubang bor, sama dengan penampil bawaan alat.
 * Nilainya deformasi terhadap acuan bila acuan sudah disetel, kalau tidak pergeseran
 * mutlak sejak nol pemasangan yang tersimpan di firmware.
 */
export function deformationProfile(seg: ProbeSegment[], gauge = GAUGE): { pos: number; value: number }[] {
  const span = (seg.length * gauge) / 1000;
  const out = [{ pos: +span.toFixed(3), value: 0 }];
  for (const [i, s] of seg.entries()) out.push({ pos: +(span - ((i + 1) * gauge) / 1000).toFixed(3), value: +s.def.toFixed(4) });
  return out;
}

// ---------------------------------------------------------------- laju pergeseran
const history: { t: number; d: number }[] = [];

function updateRate(at: number, topDef: number): number | null {
  history.push({ t: at, d: topDef });
  while (history.length > 2 && at - history[0].t > RATE_WINDOW_MS) history.shift();
  const first = history[0];
  const minutes = (at - first.t) / 60e3;
  // Di bawah seperempat jendela, pembaginya terlalu kecil dan lajunya meledak.
  return minutes >= RATE_WINDOW_MS / 4 / 60e3 ? (topDef - first.d) / minutes : null;
}

// ---------------------------------------------------------------- acuan nol
async function instrumentRow(): Promise<{ id: number; meta: string | null; expected_interval_min: number }> {
  const row = await (await getDb()).prepare('SELECT id, meta, expected_interval_min FROM instrument WHERE code = ?').get(CODE) as any;
  if (!row) throw new Error(`Instrumen ${CODE} tidak ada`);
  return row;
}

/** Acuan ikut di meta instrumen supaya tidak hilang saat server dimulai ulang. */
async function persistBaseline(b: ProbeBaseline | null) {
  const row = await instrumentRow();
  const m = row.meta ? JSON.parse(row.meta) : {};
  if (b) m.probe_baseline = b; else delete m.probe_baseline;
  await (await getDb()).prepare('UPDATE instrument SET meta = ? WHERE id = ?').run(JSON.stringify(m), row.id);
}

async function loadInstrumentSettings() {
  try {
    const row = await instrumentRow();
    const b = (row.meta ? JSON.parse(row.meta) : {}).probe_baseline as ProbeBaseline | undefined;
    if (b?.nodes?.length) state.baseline = b;
    if (PERSIST_MS_ENV == null && row.expected_interval_min > 0) state.persistMs = row.expected_interval_min * 60e3;
    // Jeda simpan dihitung dari bacaan terakhir yang benar-benar ada, bukan dari saat
    // proses ini mulai — kalau tidak, tiap restart menyelipkan satu bacaan tambahan.
    const last = await (await getDb()).prepare('SELECT MAX(ts) m FROM reading WHERE instrument_id = ?').get(row.id) as any;
    if (last?.m) state.savedAt = Number(last.m);
    console.log(`Probe live: simpan bacaan tiap ${Math.round(state.persistMs / 60e3)} menit${state.baseline ? `, acuan ${new Date(state.baseline.at).toISOString()}` : ''}`);
  } catch (e: any) {
    state.error = `pengaturan instrumen tidak terbaca: ${e.message}`;
  }
}

/** Hitung ulang deformasi pada bentuk terakhir setelah acuan berubah. */
function reapplyBaseline() {
  for (const [i, s] of state.seg.entries()) {
    const base = state.baseline?.nodes[i];
    s.defA = s.cumA - (base?.cumA ?? 0);
    s.defB = s.cumB - (base?.cumB ?? 0);
    s.def = Math.hypot(s.defA, s.defB);
  }
  history.length = 0;
  state.rate = null;
}

export async function setBaseline(): Promise<ProbeState> {
  if (!state.seg.length) throw new Error('Belum ada data probe untuk dijadikan acuan');
  const b: ProbeBaseline = { at: state.at ?? Date.now(), nodes: state.seg.map((s) => ({ cumA: s.cumA, cumB: s.cumB })) };
  await persistBaseline(b);
  state.baseline = b;
  reapplyBaseline();
  broadcast('probe', state);
  return state;
}

export async function clearBaseline(): Promise<ProbeState> {
  await persistBaseline(null);
  state.baseline = null;
  reapplyBaseline();
  broadcast('probe', state);
  return state;
}

// ---------------------------------------------------------------- aliran data
async function persist(ts: number, seg: ProbeSegment[]) {
  const r = await ingestPayload({ readings: [{ instrument: CODE, ts, profile: deformationProfile(seg) }] }, null);
  if (r.rejected.length) {
    state.error = `simpan ditolak: ${r.rejected[0].reason}`;
    console.warn(`[probe] ${state.error}`);
    return;
  }
  if (r.accepted) state.savedAt = ts;
}

function onData(raw: Buffer) {
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    state.error = 'payload bukan JSON yang sah';
    return;
  }
  const seg = segmentsFrom(slots(payload), GAUGE, state.baseline);
  if (!seg.length) { state.error = 'payload tanpa slot Step<n>_X/Y'; return; }

  // reading_at sudah UTC dari NTP; jam/hari hanya untuk ditampilkan.
  const at = payload.reading_at ? Date.parse(payload.reading_at) : NaN;
  state.at = Number.isFinite(at) ? at : Date.now();
  state.waktu = typeof payload.jam === 'string' ? payload.jam : null;
  state.device = typeof payload.id_alat === 'string' ? payload.id_alat : state.device;
  state.online = true;
  state.seg = seg;
  state.rate = updateRate(state.at, seg[seg.length - 1].def);
  state.error = null;
  broadcast('probe', state);

  if (state.savedAt == null || state.at - state.savedAt >= state.persistMs) {
    void persist(state.at, seg).catch((e) => {
      state.error = `simpan gagal: ${e.message}`;
      console.error('[probe] gagal menyimpan bacaan', e);
    });
  }
}

/** Mulai jembatan. Tanpa STESYGEO_PROBE_MQTT_URL modul ini diam saja. */
export function startProbeBridge() {
  if (!URL) return;
  state.enabled = true;
  void loadInstrumentSettings();

  const client = mqtt.connect(URL, {
    username: process.env.STESYGEO_PROBE_MQTT_USER || undefined,
    password: process.env.STESYGEO_PROBE_MQTT_PASS || undefined,
    clientId: `stesygeo-probe-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5e3,
  });

  client.on('connect', () => {
    state.broker = true;
    state.error = null;
    // /status = LWT alat, /info = identitas retained.
    client.subscribe([TOPIC, `${TOPIC}/status`, `${TOPIC}/info`], (e) => {
      if (e) { state.error = `gagal berlangganan: ${e.message}`; console.error('[probe]', state.error); }
    });
    console.log(`Probe live: ${TOPIC} di ${URL} -> instrumen ${CODE}`);
    broadcast('probe', state);
  });

  client.on('message', (topic, raw) => {
    if (topic === TOPIC) return onData(raw);
    if (topic === `${TOPIC}/status`) {
      state.online = raw.toString().trim().toLowerCase() === 'online';
      broadcast('probe', state);
    } else if (topic === `${TOPIC}/info`) {
      try { state.device = JSON.parse(raw.toString())?.id_alat ?? state.device; } catch { /* abaikan */ }
    }
  });

  client.on('close', () => { state.broker = false; broadcast('probe', state); });
  client.on('error', (e) => { state.error = e.message; console.error(`[probe] ${e.message}`); });
}
