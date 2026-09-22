// Server STESY GEO: REST API + ingestion MQTT/HTTP + SSE + penyajian frontend hasil build.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import aedesFactory from 'aedes';
import { getDb, DB_PATH } from './db.js';
import { authenticate } from './auth.js';
import { api } from './routes.js';
import { authenticateGateway, ingestPayload } from './ingest.js';
import { evaluateDevices } from './alarms.js';
import { broadcast } from './events.js';

const PORT = Number(process.env.PORT ?? 8080);
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 1883);
const here = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(DB_PATH)) {
  console.error(`Basis data belum ada (${DB_PATH}). Jalankan: npm run seed`);
  process.exit(1);
}
getDb();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// rate-limit sederhana per IP untuk API (PRD 10: keamanan)
const hits = new Map<string, { n: number; t: number }>();
app.use('/api', (req, res, next) => {
  const k = req.ip ?? 'x';
  const now = Date.now();
  const h = hits.get(k);
  if (!h || now - h.t > 60e3) hits.set(k, { n: 1, t: now });
  else if (++h.n > 1200) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
  next();
});
app.use('/api', authenticate, api);

app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? 'Kesalahan server' });
});

const webDist = path.join(here, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.listen(PORT, () => console.log(`STESY GEO API di http://localhost:${PORT}  (DB: ${DB_PATH})`))
  .on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} sudah dipakai (server STESY GEO lain masih berjalan?). Hentikan proses itu atau jalankan dengan PORT=8081 npm start.`);
    else console.error(e);
    process.exit(1);
  });

// ---------------------------------------------------------------- MQTT (F-TLM-03)
// Topik: stesygeo/<kode-gateway>/up, username = kode gateway, password = token gateway.
// Catatan: produksi memakai TLS (mqtts, port 8883) di depan broker.
const broker = (aedesFactory as any)();
broker.authenticate = (client: any, username: string, password: Buffer, cb: (e: Error | null, ok: boolean) => void) => {
  const gw = authenticateGateway(username, password?.toString());
  if (gw) client.gateway = gw;
  cb(null, !!gw);
};
broker.authorizePublish = (client: any, packet: any, cb: (e: Error | null) => void) => {
  if (client?.gateway && packet.topic === `stesygeo/${client.gateway.code}/up`) return cb(null);
  cb(new Error('Topik tidak diizinkan'));
};
broker.on('publish', (packet: any, client: any) => {
  if (!client?.gateway || !packet.topic.endsWith('/up')) return;
  try {
    const r = ingestPayload(JSON.parse(packet.payload.toString()), client.gateway.id);
    if (r.rejected.length) console.warn(`MQTT ${client.gateway.code}: ${r.rejected.length} bacaan ditolak`, r.rejected.slice(0, 3));
  } catch (e) {
    console.error('MQTT payload tidak valid', e);
  }
});
createServer(broker.handle).listen(MQTT_PORT, () => console.log(`Broker MQTT di mqtt://localhost:${MQTT_PORT}`));

// ---------------------------------------------------------------- tugas berkala
setInterval(() => {
  try {
    evaluateDevices();
    broadcast('tick', { at: Date.now() });
  } catch (e) { console.error(e); }
}, 60e3);
