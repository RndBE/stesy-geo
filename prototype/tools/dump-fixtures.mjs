// Mengambil snapshot data dari server STESY GEO yang sedang berjalan menjadi file JSON statis
// untuk prototipe frontend (public/data/). Hanya membaca, kecuali memanggil endpoint analisis
// (back-analysis & skenario) yang tidak mengubah data.
//   node tools/dump-fixtures.mjs [http://localhost:8080] [email] [password]
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://localhost:8080') + '/api';
const EMAIL = process.argv[3] ?? 'admin@stesygeo.local';
const PASSWORD = process.argv[4] ?? 'stesygeo2026';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'data');
const DAY = 86400e3;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const login = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then((r) => r.json());
if (!login.token) throw new Error('Login gagal: ' + JSON.stringify(login));
const H = { Authorization: `Bearer ${login.token}` };

let files = 0, bytes = 0;
async function get(p, file, { text = false, method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}${p}`, { method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { console.warn(`  lewati ${p}: ${r.status}`); return null; }
  const data = text ? await r.text() : await r.json();
  const s = text ? data : JSON.stringify(data);
  const f = path.join(OUT, file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
  files++; bytes += s.length;
  return data;
}

const generatedAt = Date.now();
console.log('Mengambil data dari', BASE);
await get('/projects/1/overview', 'overview.json');
await get('/projects/1/longitudinal', 'longitudinal.json');
await get('/projects/1/twin?horizon=180', 'twin.json');
await get('/projects/1/trend?days=7', 'trend-7.json');
await get('/projects/1/trend?days=30', 'trend-30.json');
const insts = await get('/instruments?project=1', 'instruments.json');
await get('/routes?project=1', 'routes.json');
await get('/alarms?status=all', 'alarms.json');
await get('/alarm-rules', 'alarm-rules.json');
await get('/telemetry/devices', 'telemetry-devices.json');
await get('/telemetry/compare', 'telemetry-compare.json');
await get('/telemetry/maintenance', 'telemetry-maintenance.json');
await get('/telemetry/reference-checks', 'telemetry-reference-checks.json');
await get('/analysis/snapshots', 'snapshots.json');
await get('/users', 'users.json');
await get('/audit?limit=300', 'audit.json');
await get('/reports/weekly?project=1&lang=id', 'report-id.html', { text: true });
await get('/reports/weekly?project=1&lang=en', 'report-en.html', { text: true });
await get('/export/readings.csv?project=1&from=' + (generatedAt - 30 * DAY), 'export-readings-30d.csv', { text: true });
await get('/export/analysis.csv?project=1', 'export-analysis.csv', { text: true });

const devs = await fetch(`${BASE}/telemetry/devices`, { headers: H }).then((r) => r.json());
for (const l of devs.loggers) await get(`/telemetry/health/logger/${l.id}?days=30`, `health/logger-${l.id}.json`);

for (const z of (await fetch(`${BASE}/projects/1/overview`, { headers: H }).then((r) => r.json())).zones) {
  await get(`/zones/${z.id}`, `zones/${z.id}.json`);
  await get(`/zones/${z.id}/combined`, `zones/${z.id}-combined.json`);
  await get(`/zones/${z.id}/compare`, `zones/${z.id}-compare.json`);
  await get(`/zones/${z.id}/scenario`, `zones/${z.id}-scenario.json`, { method: 'POST', body: {} });
}

for (const i of insts) {
  await get(`/instruments/${i.id}`, `inst/${i.id}.json`);
  await get(`/instruments/${i.id}/table?limit=150`, `inst/${i.id}-table.json`);
  await get(`/instruments/${i.id}/readings?from=${generatedAt - 14 * DAY}&agg=auto`, `inst/${i.id}-r14.json`);
  await get(`/instruments/${i.id}/readings?from=${generatedAt - 90 * DAY}&agg=auto`, `inst/${i.id}-r90.json`);
  await get(`/instruments/${i.id}/readings?from=0&agg=daily`, `inst/${i.id}-rall.json`);
  if (i.type === 'INC' || i.type === 'SAA') {
    await get(`/instruments/${i.id}/profiles`, `inst/${i.id}-profiles.json`);
    const dates = [];
    for (let t = i.installed_at; t <= generatedAt; t += DAY) dates.push(t);
    await get(`/instruments/${i.id}/profiles?dates=${dates.join(',')}`, `inst/${i.id}-profiles-daily.json`);
  }
  if (i.zone_id && ['SC', 'GN', 'SP', 'SAA'].includes(i.type)) {
    await get(`/analysis/settlement/${i.id}?dt=7`, `analysis/settlement-${i.id}.json`);
    await get(`/analysis/backanalysis/${i.id}`, `analysis/back-${i.id}.json`, { method: 'POST', body: {} });
  }
  if (i.zone_id && i.type === 'PZ') await get(`/analysis/piezo/${i.id}`, `analysis/piezo-${i.id}.json`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generatedAt, source: BASE, files }));
console.log(`Selesai: ${files} file, ${(bytes / 1e6).toFixed(1)} MB → ${OUT}`);
