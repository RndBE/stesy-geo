# STESY GEO — Sistem Monitoring Konsolidasi Tanah

Implementasi MVP (Fase 1) dari [prd.md](prd.md): aplikasi web untuk memantau konsolidasi tanah lunak pada timbunan jalan dengan preloading + PVD. Aplikasi ini mencakup ingestion telemetri, analisis prediksi penurunan, alarm dini, keputusan tahap timbunan, digital twin 3D, dan laporan mingguan.

Data contoh memakai studi kasus PRD Bagian 9 (segmen STA 24+000 – 25+000, ±65 instrumen, 28 logger), berisi riwayat sintetis sejak Desember 2025 dan simulator gateway yang mengirim data live.

## Menjalankan

Butuh Node.js ≥ 18.

```bash
npm run setup      # install dependensi server & web
npm run seed       # buat basis data contoh (MySQL, basis data stesygeo)
npm run build      # build frontend ke web/dist
npm start          # API + frontend di http://localhost:8080, broker MQTT di :1883
```

Di terminal lain, jalankan simulator gateway. Simulator mengirim bacaan mentah (Hz + suhu) lewat MQTT setiap 60 detik, dan saat start mengirim ulang (backfill) 48 jam terakhir:

```bash
npm run simulate
```

Opsi simulator: `--http` (kirim lewat HTTP push, bukan MQTT), `--every 30`, `--backfill 72`.

Basis data diambil dari environment: `STESYGEO_DB_HOST` (127.0.0.1), `STESYGEO_DB_PORT` (3306),
`STESYGEO_DB_USER` (root), `STESYGEO_DB_PASSWORD` (kosong), `STESYGEO_DB_NAME` (stesygeo).
Skema dibuat otomatis saat pertama tersambung; `npm run seed` mengosongkan lalu mengisi ulang.

### Probe inclinometer live

Satu instrumen `INC` bisa disuapi probe inclinometer sungguhan yang menerbitkan ke broker MQTT-nya
sendiri dengan topik `Logger_<id>` (payload `sensorN: {nama, nilai, satuan}`, nama `Step<n>_X`,
`Step<n>_Y`, `Step<n>_T`, `Step<n>_AZ`). Bentuk probe muncul sebagai penampil 3D di layar Digital twin, dan satu
bacaan profil defleksi disimpan berkala supaya grafik, analisis, dan alarm ikut hidup.

```bash
STESYGEO_PROBE_MQTT_URL=mqtt://192.168.1.10:1883 STESYGEO_PROBE_MQTT_USER=... STESYGEO_PROBE_MQTT_PASS=... npm start
```

| Variabel | Bawaan | Arti |
|---|---|---|
| `STESYGEO_PROBE_MQTT_URL` | — | broker alat. Kosong = fitur mati |
| `STESYGEO_PROBE_MQTT_USER` / `_PASS` | — | kredensial broker |
| `STESYGEO_PROBE_TOPIC` | `Logger_30083` | topik data; `/status` dan `/info` ikut dilanggan |
| `STESYGEO_PROBE_INSTRUMENT` | `INC-01` | kode instrumen tujuan |
| `STESYGEO_PROBE_GAUGE_MM` | `500` | jarak antar sumbu u-joint |
| `STESYGEO_PROBE_PERSIST_MS` | `expected_interval_min` instrumen | jeda minimum antar bacaan tersimpan |
| `STESYGEO_PROBE_RATE_WINDOW_MS` | `60000` | jendela perhitungan laju pergeseran |

#### Perhitungan pergeseran

Per segmen: `ΔA = gauge × sin A`, `ΔB = gauge × sin B` (sama dengan kolom `dA_mm`/`dB_mm` di CSV
firmware), resultannya `hypot(ΔA, ΔB) = gauge × sin T`.

Kumulatif dijumlahkan sebagai **vektor per bidang** — `cumA = ΣΔA`, `cumB = ΣΔB`, resultan
`hypot(cumA, cumB)` — bukan menjumlahkan besaran resultan tiap segmen. Segmen yang miring ke arah
berlawanan memang saling meniadakan; menjumlahkan besarannya melaporkan pergeseran yang tidak
pernah terjadi (pada probe demo selisihnya sampai 26%).

Jeda simpan mengikuti `expected_interval_min` instrumen tujuan kecuali diisi lewat env. Alat mengirim
tiap detik dan penampil 3D memakai semuanya; yang masuk basis data hanya satu cuplikan per jeda itu.
INC-01 disetel 1 menit. Ambang data basi tidak ikut terpengaruh: `isStale` memakai
`max(interval × 3, 6 jam)`, jadi lantai 6 jamnya yang menang.

Acuan nol disimpan di `instrument.meta.probe_baseline`, jadi bertahan saat server dimulai ulang.
Selama ada acuan, deformasi = kumulatif − acuan, dan nilai itu pula yang masuk tabel `reading`.

| Endpoint | Peran | Arti |
|---|---|---|
| `GET /api/probe` | viewer | keadaan probe saat ini |
| `POST /api/probe/baseline` | engineer | setel acuan dari keadaan probe sekarang |
| `DELETE /api/probe/baseline` | engineer | hapus acuan, kembali ke pergeseran mutlak |

Laju pergeseran simpul teratas dihitung dari jendela bergulir (bawaan 60 detik) dan baru muncul
setelah jendelanya terisi seperempat — di bawah itu pembaginya terlalu kecil dan angkanya meledak.

Firmware lama tanpa slot `_T`/`_AZ` tetap jalan: keduanya dipulihkan dari sudut bidang. Firmware
memakai `A = atan2(ax, hypot(ay, az))` sehingga `ux = sin A` dan `uy = sin B`, jadi
`T = acos(sqrt(1 − sin²A − sin²B))` dan `azim = atan2(sin B, sin A)`.

Untuk mode pengembangan dengan hot reload, jalankan `npm run dev:api` dan `npm run dev:web` (Vite di :5173, dengan proxy `/api` ke :8080).

Akun contoh (kata sandi `stesygeo2026`):

| Email | Role |
|---|---|
| geotek@stesygeo.local | engineer |
| surveyor@stesygeo.local, teknisi@stesygeo.local | surveyor |
| pengawas@stesygeo.local | viewer (owner/pengawas) |
| admin@stesygeo.local | admin |

Token gateway GW-01 (MQTT username `GW-01`, password = token): `gw01-dev-7f3c9a1e5b`.

Tes unit analisis: `npm test`. Termasuk verifikasi contoh hitungan PRD 9.2 (μ ≈ 3,13, t₉₀ ≈ 5,7 bulan).

## Skenario contoh

Seed menghasilkan keempat status keputusan:

| Zona | Kondisi | Status |
|---|---|---|
| Z-01 STA 24+000–24+300 | Surcharge sejak Maret, c_h lapangan tinggi | **Siap bongkar surcharge** |
| Z-02 STA 24+300–24+600 | Surcharge, U Asaoka ±87% | **Tahan** |
| Z-03 STA 24+600–24+900 | Surcharge baru dipasang, laju lateral INC-06 > 10 mm/hari | **Perlu tinjauan** |
| Z-04 Oprit 24+900–25+000 | Tahap 3/6 selesai, Δu terdisipasi | **Lanjut timbun** |

Gangguan telemetri yang disimulasikan: logger LG-02 offline 30 jam, baterai LG-08 16%, dan tangki referensi settlement cell turun 2,7 mm (dikoreksi otomatis).

## Struktur

```
server/src/
  analysis/        Asaoka, hiperbolik, Terzaghi + Hansbo + Carrillo, back-analysis c_h, konversi VW (+ tes)
  domain.ts        tinggi timbunan, analisis per instrumen, status & kriteria keputusan zona (PRD 9.4)
  alarms.ts        alarm geoteknik 3 level + penekanan alarm palsu; alarm teknis perangkat
  ingest.ts        ingestion MQTT/HTTP: pemetaan kanal, kalibrasi, koreksi suhu/baro/tangki, dedup, backfill
  twin.ts          twin state builder (histori + proyeksi 180 hari) & profil memanjang jalan
  report.ts        laporan mingguan HTML siap cetak (ID/EN)
  routes.ts        REST API        index.ts  server + broker MQTT + SSE
  scenario.ts      tata letak instrumen PRD 9.3 + model "kebenaran" untuk seed & simulator
web/src/
  pages/           11 layar PRD 14 + daftar instrumen
  twin/            viewer Three.js & irisan penampang
  components/      peta MapLibre, ECharts, komponen UI
```

## Cakupan terhadap PRD

Sudah diimplementasikan: semua kebutuhan P0 pada 6.1–6.8, 7.2, 8.5, dan 9.5, ditambah sebagian P1: back-analysis c_h dengan rentang ketidakpastian, kalibrasi zona dari back-analysis, what-if skenario, profil & tabel Matsuo–Kawamura (δ/S), timbunan kompensasi, modul oprit, penekanan alarm palsu, laporan bilingual, dan log pemeliharaan.

**Penyimpangan dari stack PRD 11.** Lingkungan pengembangan tidak memiliki Python/pip maupun Docker, sehingga backend ditulis dalam **Node.js + TypeScript (Express)** dengan **SQLite**. Skema tabel mengikuti PRD 12 dan siap dipindah ke PostgreSQL + PostGIS + TimescaleDB. Penyimpangan lain:

- Hash kata sandi memakai scrypt (bawaan Node), belum Argon2.
- PDF dibuat lewat dialog cetak peramban dari HTML laporan, belum WeasyPrint/Playwright.
- Broker MQTT (Aedes) berjalan tanpa TLS di pengembangan. Produksi perlu MQTTS/TLS di depan broker.
- Basemap peta memakai tile Esri World Imagery / OpenStreetMap langsung. Untuk produksi, gunakan penyedia tile berlisensi.

**Belum dikerjakan:**

- Notifikasi WhatsApp/Telegram/email (F-ALM-03)
- Import AGS/CPTu (F-PRJ-06)
- Penyambungan seri instrumen yang diganti (F-INS-06)
- Mode offline (F-INS-07)
- Foto per pembacaan (F-INS-08)
- Upload sertifikat kalibrasi (F-TLM-12). Metadata dan tanggal kalibrasi ulang sudah ada.
- Frekuensi adaptif (F-TLM-13)
- Adapter pull API vendor (F-TLM-04). Jalur MQTT/HTTP push sudah ada.
- Tanda tangan digital (F-RPT-03)
- SSO (F-USR-04)
- Import IFC/LandXML (F-DT-10)

**Batasan model** (juga tertulis di UI): model perilaku twin berupa solusi analitis 1D + radial per sel, bukan FEM. Sisa penurunan hanya mencakup konsolidasi primer. Indikasi stabilitas pada skenario memakai H_kritis tak-terdrainase, bukan analisis stabilitas lereng. Semua angka di data contoh bersifat ilustratif.
