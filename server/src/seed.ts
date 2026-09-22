// Membangun basis data contoh untuk studi kasus PRD Bagian 9 dengan riwayat data sintetis.
// Jalankan: npm run seed
import path from 'node:path';
import { resetDb } from './db.js';
import { hashPassword } from './auth.js';
import { hashToken } from './ingest.js';
import { pressureToHz, type VwCalibration } from './analysis/conversion.js';
import { evaluateInstrument, evaluateDevices } from './alarms.js';
import { getInstrument, TZ_OFFSET } from './domain.js';
import {
  ZONES, LAYERS, PVD, DESIGN, buildLayout, truth, staToXY, designElevation, GROUND_ELEV, noise,
  DAY, type InstDef, type LoggerDef,
} from './scenario.js';

export const GATEWAY_TOKEN = process.env.STESYGEO_GATEWAY_TOKEN ?? 'gw01-dev-7f3c9a1e5b';
const HOUR = 3600e3;

export function calibrationFor(inst: InstDef): VwCalibration | null {
  const j = (parseInt(inst.code.replace(/\D/g, ''), 10) * 37) % 200;
  if (inst.type === 'PZ') return { kind: 'vw_linear', B: 0.0512, R0: 9400 + j, K: 0.042, T0: 28.5, baroFactor: 1, P0baro: 101.0 };
  if (inst.type === 'SC') return { kind: 'vw_linear', B: 0.01205, R0: 8850 + j, K: 0.011, T0: 28.5 };
  return null;
}

export function sensorTemp(code: string, t: number): number {
  const h = ((t / HOUR) + 7) % 24;
  return 28.5 + 0.6 * Math.sin((2 * Math.PI * (h - 14)) / 24) + noise(code + 'T', t, 0.05);
}

export function baroTruth(t: number): number {
  const h = ((t / HOUR) + 7) % 24;
  return 101.0 + 0.12 * Math.sin((2 * Math.PI * (h - 10)) / 12) + noise('BR-01', t, 0.02);
}

/** Perubahan elevasi tangki referensi (mm, turun positif) — cek survei bulanan. */
export const TANK_CHECKS: { date: string; delta: number }[] = [
  { date: '2025-11-20', delta: 0 }, { date: '2025-12-20', delta: 0.4 }, { date: '2026-01-20', delta: 0.9 },
  { date: '2026-02-20', delta: 1.1 }, { date: '2026-03-20', delta: 1.6 }, { date: '2026-04-20', delta: 1.8 },
  { date: '2026-05-20', delta: 2.1 }, { date: '2026-06-20', delta: 2.3 }, { date: '2026-07-20', delta: 2.4 },
  { date: '2026-08-20', delta: 2.6 }, { date: '2026-09-18', delta: 2.7 },
];
export function tankDelta(t: number): number {
  let d = 0;
  for (const c of TANK_CHECKS) if (Date.parse(c.date + 'T09:00:00+07:00') <= t) d = c.delta;
  return d;
}

/** Bacaan mentah (Hz) yang akan dikirim logger untuk nilai teknik `value`. */
export function rawFor(inst: InstDef, value: number, t: number): { raw: number; temp: number } | null {
  const cal = calibrationFor(inst);
  if (!cal) return null;
  const temp = sensorTemp(inst.code, t);
  let p: number;
  if (inst.type === 'SC') p = ((value - tankDelta(t)) / 1000) * 9.80665;
  else p = value + (cal.baroFactor ? baroTruth(t) - cal.P0baro! : 0);
  p -= (cal.K ?? 0) * (temp - (cal.T0 ?? temp));
  return { raw: pressureToHz(p, cal), temp: +temp.toFixed(2) };
}

export function loggerOfflineFrom(l: LoggerDef, now: number): number | null {
  return l.offlineSinceHours ? now - l.offlineSinceHours * HOUR : null;
}

export function batteryPct(l: LoggerDef, t: number, installed: number): number {
  const drain = l.batteryDrainPerDay ?? (l.kind === 'GNSS' ? 0.05 : 0.025);
  return Math.max(3, 100 - ((t - installed) / DAY) * drain);
}

export function rssiFor(l: LoggerDef): number {
  return -88 - Math.abs(l.sta - 24500) * 0.045 - (l.kind === 'GNSS' ? 3 : 0);
}

async function main() {
  const t0 = Date.now();
  const db = await resetDb();
  const now = Math.floor(Date.now() / HOUR) * HOUR;

  // ---- pengguna
  const users = [
    ['admin@stesygeo.local', 'Administrator STESY GEO', 'admin'],
    ['geotek@stesygeo.local', 'Rina Hapsari — Geotechnical Engineer', 'engineer'],
    ['surveyor@stesygeo.local', 'Dedi Kurniawan — Surveyor', 'surveyor'],
    ['teknisi@stesygeo.local', 'Yusuf Pratama — Teknisi Telemetri', 'surveyor'],
    ['pengawas@stesygeo.local', 'Konsultan Pengawas (baca-saja)', 'viewer'],
  ];
  const pw = hashPassword('stesygeo2026');
  for (const [email, name, role] of users) await db.prepare('INSERT INTO app_user(email, name, role, password_hash) VALUES (?,?,?,?)').run(email, name, role, pw);

  // ---- proyek & alignment
  const pidInfo = await db.prepare(
    `INSERT INTO project(name, code, type, crs_epsg, vertical_datum, timezone, tz_label, created_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run('Jalan Tol Pesisir — Paket Timbunan Tanah Lunak STA 24+000 – 25+000', 'TPS-P3', 'jalan', 32749, 'MSL lokal (BM-07)', 'Asia/Jakarta', 'WIB', now);
  const pid = Number(pidInfo.lastInsertRowid);
  for (let u = 1; u <= 5; u++) await db.prepare('INSERT INTO project_member(project_id, user_id, role) VALUES (?,?,?)').run(pid, u, users[u - 1][2]);
  const geom = [];
  const prof = [];
  for (let s = 24000; s <= 25000; s += 25) { geom.push({ sta: s, ...staToXY(s) }); prof.push({ sta: s, elev: +designElevation(s).toFixed(3) }); }
  await db.prepare('INSERT INTO alignment(project_id, name, sta_geometry, design_profile) VALUES (?,?,?,?)').run(pid, 'As jalan utama', JSON.stringify(geom), JSON.stringify(prof));

  // ---- zona, lapisan, PVD, tahap
  const zoneId: Record<string, number> = {};
  for (const z of ZONES) {
    const a = staToXY(z.staStart, -30), b = staToXY(z.staEnd, -30), c = staToXY(z.staEnd, 30), d = staToXY(z.staStart, 30);
    const zInfo = await db.prepare(
      `INSERT INTO zone(project_id, code, name, sta_start, sta_end, polygon, is_transition, design_fill_height, surcharge_height, ground_elev, crest_width, slope_h, cv, ch, hdr, residual_limit_mm)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(pid, z.code, z.name, z.staStart, z.staEnd, JSON.stringify([a, b, c, d]), z.transition ? 1 : 0, z.designH, z.surchargeH, GROUND_ELEV, 24, 2, DESIGN.cv, DESIGN.ch, DESIGN.Hdr, 100);
    const id = Number(zInfo.lastInsertRowid);
    zoneId[z.code] = id;
    for (const L of LAYERS) {
      await db.prepare(
        `INSERT INTO soil_layer(zone_id, name, top_depth, bottom_depth, gamma, cv, ch, cc, cr, e0, ocr, kh_ks, cu, compressible) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, L.name, L.top_depth, L.bottom_depth, L.gamma, L.cv, L.ch, L.cc, L.cr, L.e0, L.ocr, L.kh_ks, L.cu, L.compressible);
    }
    await db.prepare('INSERT INTO pvd_spec(zone_id, pattern, spacing, length, a, b, s, kh_ks) VALUES (?,?,?,?,?,?,?,?)').run(id, PVD.pattern, PVD.spacing, PVD.length, PVD.a, PVD.b, PVD.s, PVD.khKs);
    for (const [i, st] of z.stages.entries()) {
      const done = st.start != null && st.start < now;
      await db.prepare(
        `INSERT INTO fill_stage(zone_id, stage_no, label, planned_start, planned_end, actual_start, actual_end, thickness, is_surcharge) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(id, i + 1, st.surcharge ? `Tahap ${i + 1} (surcharge)` : `Tahap ${i + 1}`, st.plannedStart, st.plannedEnd,
        done ? st.start : null, done && st.end! < now ? st.end : null, st.thickness, st.surcharge ? 1 : 0);
    }
  }

  // ---- gateway, logger, instrumen
  const gw = staToXY(24500, 38);
  const gwInfo = await db.prepare(
    `INSERT INTO gateway(project_id, code, vendor, model, serial, x, y, sta, power_type, token_hash, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(pid, 'GW-01', 'Vendor pilot', 'Gateway LoRa AS923-2 + 4G', 'GW2600411', gw.x, gw.y, 24500, 'Panel surya 100 Wp + baterai LiFePO4 100 Ah', hashToken(GATEWAY_TOKEN), now);
  const gwId = Number(gwInfo.lastInsertRowid);

  const { instruments, loggers } = buildLayout();
  const loggerId: Record<string, number> = {};
  const loggerInstall: Record<string, number> = {};
  for (const l of loggers) {
    const lInfo = await db.prepare(
      `INSERT INTO logger(gateway_id, code, vendor, model, serial, firmware, sta, offset, channels, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(gwId, l.code, l.vendor, l.model, l.serial, l.firmware, l.sta, l.offset, l.channels, null);
    loggerId[l.code] = Number(lInfo.lastInsertRowid);
  }
  const instId: Record<string, number> = {};
  for (const i of instruments) {
    const xy = staToXY(i.sta, i.offset);
    const zId = i.zone ? zoneId[i.zone] : null;
    const iInfo = await db.prepare(
      `INSERT INTO instrument(project_id, zone_id, code, type, section_sta, sta, offset, x, y, z, tip_depth, installed_at, zero_reading, unit, mode, status, meta, expected_interval_min)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(pid, zId, i.code, i.type, i.sectionSta, i.sta, i.offset, xy.x, xy.y, GROUND_ELEV, i.tipDepth, i.installedAt,
      i.type === 'PZ' ? i.meta.u_hydro : 0, i.unit, i.mode, 'aktif', JSON.stringify(i.meta), i.intervalMin);
    const id = Number(iInfo.lastInsertRowid);
    instId[i.code] = id;
    if (i.logger) {
      await db.prepare('INSERT INTO logger_channel(logger_id, channel_no, instrument_id, valid_from) VALUES (?,?,?,?)').run(loggerId[i.logger], i.channel, id, i.installedAt);
      loggerInstall[i.logger] = Math.min(loggerInstall[i.logger] ?? Infinity, i.installedAt);
    }
    const cal = calibrationFor(i);
    if (cal) {
      await db.prepare('INSERT INTO calibration(instrument_id, valid_from, coeffs_json, certificate_file, next_due) VALUES (?,?,?,?,?)')
        .run(id, i.installedAt - 30 * DAY, JSON.stringify(cal), `sertifikat/${i.code}.pdf`, i.installedAt + 335 * DAY);
    }
  }
  for (const c of TANK_CHECKS) {
    await db.prepare('INSERT INTO reference_check(target, ts, elevation, delta_mm, method, by_user) VALUES (?,?,?,?,?,?)')
      .run('TANK-01', Date.parse(c.date + 'T09:00:00+07:00'), +(GROUND_ELEV + 1.2 - c.delta / 1000).toFixed(4), c.delta, 'Waterpass dari BM-07', 3);
  }

  // ---- riwayat bacaan
  const ins = db.prepare(
    `INSERT IGNORE INTO reading(instrument_id, ts, raw_value, raw_temp, value, source, calib_id, flag, note, entered_by, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insP = db.prepare('INSERT IGNORE INTO reading_profile(instrument_id, ts, pos, value) VALUES (?,?,?,?)');
  const calId = db.prepare('SELECT id FROM calibration WHERE instrument_id = ?');
  const loggerByCode = Object.fromEntries(loggers.map((l) => [l.code, l]));
  let nReadings = 0;
  const tx = db.transaction(async () => {
    for (const i of instruments) {
      const id = instId[i.code];
      const cid = ((await calId.get(id)) as any)?.id ?? null;
      if (i.mode === 'manual') {
        // pembacaan waterpass mingguan, Senin 09:00 WIB
        let t = i.installedAt + ((8 - new Date(i.installedAt + TZ_OFFSET).getUTCDay()) % 7) * DAY;
        t = Math.floor((t + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET + 9 * HOUR;
        for (; t <= now; t += 7 * DAY) {
          const v = truth(i, t);
          if (!v) continue;
          await ins.run(id, t, null, null, +v.value.toFixed(0), 'manual', null, null, null, 3, t + 6 * HOUR);
          nReadings++;
        }
        continue;
      }
      const lg = i.logger ? loggerByCode[i.logger] : null;
      const offFrom = lg ? loggerOfflineFrom(lg, now) : null;
      const step = (t: number) => (t < now - 21 * DAY ? (i.type === 'SAA' ? 12 * HOUR : 6 * HOUR) : i.type === 'SAA' ? 6 * HOUR : HOUR);
      const start = Math.ceil(i.installedAt / HOUR) * HOUR;
      for (let t = start; t <= now; t += step(t)) {
        if (offFrom != null && t > offFrom) break;
        const v = truth(i, t);
        if (!v) continue;
        const raw = rawFor(i, v.value, t);
        await ins.run(id, t, raw?.raw ?? null, raw?.temp ?? null, v.value, 'telemetry', raw ? cid : null, null, null, null, t + 2 * 60e3);
        nReadings++;
        if (v.profile && (t >= now - 21 * DAY || (t / HOUR) % 24 === 5)) for (const p of v.profile) await insP.run(id, t, p.pos, p.value);
      }
      // pembacaan manual paralel (readout portabel) untuk piezometer penampang utama selama masa validasi T2
      if (i.type === 'PZ' && i.tipDepth === 9 && i.offset === 0 && [24200, 24500, 24800].includes(i.sectionSta)) {
        for (let t = i.installedAt + 7 * DAY + 2 * HOUR; t <= Math.min(now, i.installedAt + 120 * DAY); t += 7 * DAY) {
          const v = truth(i, t)!;
          await ins.run(id, t, null, null, +(v.value + noise(i.code + 'M', t, 0.9)).toFixed(1), 'manual', null, null, 'Readout portabel', 3, t + 5 * HOUR);
          nReadings++;
        }
      }
    }
  });
  await tx();

  // ---- kesehatan perangkat
  const insH = db.prepare(`REPLACE INTO device_health(device_type, device_id, ts, battery_v, battery_pct, rssi, snr, internal_temp) VALUES (?,?,?,?,?,?,?,?)`);
  await db.transaction(async () => {
    for (const l of loggers) {
      const inst0 = loggerInstall[l.code] ?? now - 30 * DAY;
      const offFrom = loggerOfflineFrom(l, now);
      let last = 0;
      for (let t = Math.ceil(inst0 / HOUR) * HOUR; t <= now; t += t < now - 3 * DAY ? 6 * HOUR : HOUR) {
        if (offFrom != null && t > offFrom) break;
        const pct = batteryPct(l, t, inst0);
        await insH.run('logger', loggerId[l.code], t, +(3.3 + 0.35 * pct / 100).toFixed(3), +pct.toFixed(1), +(rssiFor(l) + noise(l.code + 'r', t, 2)).toFixed(0), +(8 + noise(l.code + 's', t, 1.5)).toFixed(1), +sensorTemp(l.code, t).toFixed(1));
        last = t;
      }
      await db.prepare('UPDATE logger SET last_seen = ? WHERE id = ?').run(last || null, loggerId[l.code]);
    }
    for (let t = now - 60 * DAY; t <= now; t += 6 * HOUR) {
      const h = ((t / HOUR) + 7) % 24;
      const pct = 78 + 18 * Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));
      await insH.run('gateway', gwId, t, +(12.4 + pct / 100).toFixed(2), +pct.toFixed(0), -71, 12, 36);
    }
  })();

  // ---- aturan alarm (PRD 9.4, ilustratif)
  const rules: [string, number, number, number][] = [
    ['lateral_rate', 5, 10, 20],
    ['settlement_rate', 15, 25, 40],
    ['du_dsigma', 0.6, 0.8, 1.0],
    ['delta_over_s', 0.3, 0.5, 0.7],
    ['toe_h_rate', 5, 10, 20],
  ];
  for (const [p, w, s, b] of rules) {
    for (const [lvl, th] of [['Waspada', w], ['Siaga', s], ['Bahaya', b]] as const) {
      await db.prepare('INSERT INTO alarm_rule(project_id, zone_id, parameter, kind, level, threshold, window_h) VALUES (?,?,?,?,?,?,?)')
        .run(pid, null, p, p.includes('rate') ? 'rate' : 'ratio', lvl, th, 24);
    }
  }

  // ---- evaluasi alarm historis (45 hari terakhir), lalu konfirmasi yang sudah lama
  const all = await db.prepare('SELECT id FROM instrument').all() as { id: number }[];
  for (let t = now - 45 * DAY; t <= now; t += t < now - 3 * DAY ? 12 * HOUR : HOUR) {
    for (const { id } of all) await evaluateInstrument(await getInstrument(id), t);
  }
  await evaluateDevices(now);
  const notes = [
    'Diperiksa di lapangan; penimbunan diperlambat sementara, laju kembali normal.',
    'Sesuai prediksi tahap berjalan. Frekuensi pembacaan dipertahankan.',
    'Dikonfirmasi; koordinasi dengan kontraktor untuk jeda 3 hari.',
  ];
  const old = await db.prepare(`SELECT id, ts FROM alarm_event WHERE category = 'geoteknik' AND ts < ?`).all(now - 5 * DAY) as { id: number; ts: number }[];
  for (const [k, e] of old.entries()) await db.prepare('UPDATE alarm_event SET ack_by = 2, ack_note = ?, ack_at = ? WHERE id = ?').run(notes[k % notes.length], e.ts + (2 + (k % 5)) * HOUR, e.id);

  // ---- log pemeliharaan & rekomendasi contoh
  const mlog = [
    ['logger', 'LG-01', '2026-02-10', 'Penggantian antena (terkena ekskavator)', 'Conduit HDPE diperpanjang 6 m'],
    ['logger', 'LG-06', '2026-05-14', 'Pemasangan surge protector tambahan', 'Setelah sambaran petir 12 Mei'],
    ['instrument', 'GN-05', '2026-06-09', 'Penyambungan batang settlement plate', 'Batang +1,5 m untuk tahap surcharge; offset dicatat'],
    ['gateway', 'GW-01', '2026-08-02', 'Pembersihan panel surya', 'Tegangan pengisian naik 0,4 V'],
  ];
  for (const [t, c, dt, a, note] of mlog) {
    const id = t === 'logger' ? loggerId[c] : t === 'gateway' ? gwId : instId[c];
    await db.prepare('INSERT INTO maintenance_log(device_type, device_id, ts, action, note, by_user) VALUES (?,?,?,?,?,?)').run(t, id, Date.parse(dt + 'T10:00:00+07:00'), a, note, 4);
  }
  await db.prepare('INSERT INTO recommendation(zone_id, decision, text, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(zoneId['Z-02'], 'Tahan', 'Surcharge dipertahankan. U Asaoka belum mencapai 90%; evaluasi ulang dua minggu lagi.', 2, now - 6 * DAY);

  const count = ((await db.prepare('SELECT COUNT(*) n FROM reading').get()) as any).n;
  const alarms = await db.prepare('SELECT category, level, COUNT(*) n FROM alarm_event WHERE cleared_at IS NULL GROUP BY category, level').all();
  console.log(`Seed selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)} s: ${instruments.length} instrumen, ${loggers.length} logger, ${count} bacaan (${nReadings} ditulis).`);
  console.log('Alarm terbuka:', alarms);
  console.log(`Login: geotek@stesygeo.local / stesygeo2026  ·  token gateway GW-01: ${GATEWAY_TOKEN}`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main();
