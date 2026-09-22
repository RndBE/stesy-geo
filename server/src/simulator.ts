// Simulator gateway telemetri: meniru logger lapangan yang mengirim bacaan mentah (Hz + suhu untuk VW,
// nilai terolah untuk GNSS/ShapeArray) ke STESY GEO lewat MQTT atau HTTP.
//   npm run simulate -- [--http] [--every 60] [--backfill 48]
// --backfill mengirim ulang data N jam terakhir (meniru buffer logger setelah koneksi putus).
import mqtt from 'mqtt';
import { buildLayout, truth, type InstDef, type LoggerDef } from './scenario.js';
import { GATEWAY_TOKEN, rawFor, batteryPct, rssiFor, loggerOfflineFrom, sensorTemp } from './seed.js';
import { noise } from './scenario.js';

const args = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? 'true' : d; };
const useHttp = args.includes('--http');
const every = Number(flag('every', '60')) * 1000;
const backfillH = Number(flag('backfill', '48'));
const API = flag('api', 'http://localhost:8080')!;
const MQTT_URL = flag('mqtt', 'mqtt://localhost:1883')!;
const HOUR = 3600e3;

const { instruments, loggers } = buildLayout();
const telemetry = instruments.filter((i) => i.mode === 'telemetry' && i.logger);
const installed = new Map<string, number>();
for (const i of telemetry) installed.set(i.logger!, Math.min(installed.get(i.logger!) ?? Infinity, i.installedAt));
// logger yang "offline" di skenario tetap diam sejak waktu tetap (dihitung saat simulator mulai)
const offlineFrom = new Map(loggers.map((l) => [l.code, loggerOfflineFrom(l, Date.now())]));

function reading(i: InstDef, t: number) {
  const v = truth(i, t);
  if (!v) return null;
  const base = { logger: i.logger!, channel: i.channel!, ts: new Date(t).toISOString() };
  if (v.profile) return { ...base, profile: v.profile.map((p) => ({ pos: p.pos, value: +p.value.toFixed(2) })) };
  const raw = rawFor(i, v.value, t);
  if (raw) return { ...base, raw: +raw.raw.toFixed(3), temp: raw.temp };
  return { ...base, value: +v.value.toFixed(i.type === 'BR' ? 3 : 1) };
}

function health(l: LoggerDef, t: number) {
  const pct = batteryPct(l, t, installed.get(l.code) ?? t - 30 * 86400e3);
  return {
    logger: l.code, ts: new Date(t).toISOString(), battery_pct: +pct.toFixed(1), battery_v: +(3.3 + 0.35 * pct / 100).toFixed(3),
    rssi: Math.round(rssiFor(l) + noise(l.code + 'r', t, 2)), snr: +(8 + noise(l.code + 's', t, 1.5)).toFixed(1), internal_temp: +sensorTemp(l.code, t).toFixed(1),
  };
}

function payloadAt(t: number, onlyHourly: boolean) {
  const readings = [];
  for (const i of telemetry) {
    const off = offlineFrom.get(i.logger!);
    if (off != null && t > off) continue;
    if (onlyHourly && i.type === 'SAA' && Math.floor(t / HOUR) % 6 !== 0) continue;
    const r = reading(i, t);
    if (r) readings.push(r);
  }
  const hs = loggers.filter((l) => { const off = offlineFrom.get(l.code); return !(off != null && t > off); }).map((l) => health(l, t));
  return { gateway: 'GW-01', readings, health: hs };
}

async function send(p: object, client: mqtt.MqttClient | null) {
  if (client) {
    await new Promise<void>((res, rej) => client.publish('stesygeo/GW-01/up', JSON.stringify(p), { qos: 1 }, (e) => (e ? rej(e) : res())));
    return 'mqtt';
  }
  const r = await fetch(`${API}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_TOKEN}` }, body: JSON.stringify(p) });
  return JSON.stringify(await r.json());
}

async function main() {
  let client: mqtt.MqttClient | null = null;
  if (!useHttp) {
    client = mqtt.connect(MQTT_URL, { username: 'GW-01', password: GATEWAY_TOKEN, clientId: 'GW-01-sim', clean: false });
    await new Promise<void>((res, rej) => { client!.once('connect', () => res()); client!.once('error', rej); });
    console.log(`Tersambung ke ${MQTT_URL} sebagai GW-01`);
  }
  const now = Date.now();
  if (backfillH > 0) {
    const start = Math.floor((now - backfillH * HOUR) / HOUR) * HOUR;
    let n = 0;
    for (let t = start; t <= now; t += HOUR) { await send(payloadAt(t, true), client); n++; }
    console.log(`Backfill ${n} jam terkirim (${telemetry.length} instrumen, ${loggers.length} logger).`);
  }
  const tick = async () => {
    const t = Date.now();
    const p = payloadAt(t, false);
    const r = await send(p, client).catch((e) => `gagal: ${e.message}`);
    console.log(`${new Date(t).toLocaleTimeString('id-ID')}  ${p.readings.length} bacaan, ${p.health.length} status perangkat → ${r}`);
  };
  await tick();
  setInterval(tick, every);
}

main().catch((e) => { console.error(e); process.exit(1); });
