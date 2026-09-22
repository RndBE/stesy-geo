# PRD — Sistem Monitoring Konsolidasi Tanah (Nama kerja: STESY GEO)

| Atribut | Keterangan |
|---|---|
| Versi dokumen | 0.2 (draf untuk review) |
| Tanggal | 21 September 2026 |
| Status | Draft |
| Perubahan v0.2 | Tambah Bagian 8 (Sistem Telemetri & Sensor) dan Bagian 9 (Studi Kasus Jalan); penyesuaian kebutuhan ingestion, model data, arsitektur, rilis, dan risiko |
| Pemilik produk | _(isi)_ |
| Reviewer teknis | Geotechnical Lead, Tech Lead, UI/UX Lead |
| Platform | Web (desktop-first, tetap usable di tablet lapangan) |

---

## 1. Ringkasan

STESY GEO adalah aplikasi web untuk memantau proses konsolidasi tanah lunak pada pekerjaan timbunan (jalan tol, reklamasi, runway, kawasan industri, tanggul) yang diperbaiki dengan preloading, surcharge, PVD (Prefabricated Vertical Drain), atau vacuum consolidation. Sistem mengumpulkan data instrumen geoteknik — dengan mengalihkan pengambilan data dari pembacaan manual ke **telemetri otomatis** — menjalankan analisis prediksi penurunan secara otomatis, memberi peringatan dini terhadap ketidakstabilan, dan menyajikan semuanya dalam **digital twin** 3D yang merepresentasikan kondisi timbunan dan lapisan tanah secara mendekati real-time.

Keputusan utama yang harus didukung sistem ini sederhana tapi mahal jika salah: **kapan timbunan boleh dinaikkan ke tahap berikutnya, dan kapan surcharge boleh dibongkar.**

Studi kasus pertama adalah **timbunan jalan di atas tanah lunak** (Bagian 9).

---

## 2. Latar Belakang & Masalah

Di banyak proyek, data monitoring konsolidasi masih dikelola dengan cara berikut:

- Seluruh pengambilan data di lapangan masih manual (waterpass, readout portabel, probe inklinometer). Pembacaan settlement plate dan piezometer dicatat manual, lalu diketik ulang ke spreadsheet oleh tim berbeda. Jeda antara pembacaan dan analisis bisa 3–7 hari.
- Plot Asaoka dan hiperbolik dikerjakan per instrumen secara manual; hasilnya bergantung pada siapa yang memilih rentang data.
- Tidak ada satu tampilan yang menggabungkan penurunan, tekanan air pori, dan pergerakan lateral dalam satu konteks ruang. Engineer harus membayangkan sendiri hubungan antar-instrumen.
- Peringatan stabilitas (laju penurunan atau deformasi lateral yang melonjak) sering baru disadari setelah retak muncul di timbunan.
- Frekuensi pembacaan manual (umumnya harian–mingguan) terlalu jarang untuk menangkap respons tekanan air pori dan deformasi lateral saat penimbunan berlangsung.
- Laporan mingguan ke owner/konsultan memakan waktu 1–2 hari kerja setiap minggu.

**Dampak:** keputusan penimbunan tertunda (biaya waktu alat berat), atau sebaliknya diambil terlalu cepat (risiko kelongsoran timbunan dan penurunan sisa pascakonstruksi).

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan

1. Menjadi satu sumber data untuk seluruh instrumen konsolidasi di proyek, dengan **telemetri sebagai jalur data utama** dan input manual sebagai cadangan/kontrol.
2. Menghasilkan prediksi penurunan akhir dan derajat konsolidasi per instrumen serta per zona, diperbarui otomatis setiap ada data baru.
3. Memberikan peringatan dini stabilitas timbunan berdasarkan kriteria yang dapat dikonfigurasi.
4. Menyajikan digital twin yang membantu engineer memahami kondisi lapangan secara spasial dan mensimulasikan skenario.
5. Memangkas waktu penyusunan laporan mingguan dari hitungan hari menjadi hitungan menit.

### 3.2 Non-Tujuan (fase ini)

- Bukan pengganti software analisis elemen hingga (PLAXIS, GeoStudio, dsb.). STESY GEO dapat mengimpor hasilnya, tetapi tidak menjalankan FEM penuh.
- Tidak mencakup desain PVD/timbunan dari nol.
- STESY GEO tidak memproduksi sensor atau logger, dan tidak mengikat proyek ke satu merek; integrasi dilakukan lewat protokol dan API terbuka.
- Tidak mencakup manajemen kontrak, progres fisik non-geoteknik, atau keuangan proyek.
- Aplikasi mobile native belum masuk lingkup; input lapangan cukup melalui web responsif.

---

## 4. Pengguna & Persona

| Persona | Peran | Kebutuhan utama |
|---|---|---|
| **Geotechnical Engineer** (pengguna inti) | Menganalisis data, merekomendasikan tahap timbunan | Plot yang dapat dipercaya, kontrol atas parameter analisis, back-analysis |
| **Surveyor / Teknisi Instrumen** | Membaca dan memasukkan data lapangan | Form input cepat, validasi langsung, bisa bekerja dengan sinyal lemah |
| **Teknisi Telemetri / Instrumentasi** | Memasang dan merawat sensor, logger, gateway | Status kesehatan perangkat, alarm teknis, log pemeliharaan |
| **Site Manager / Kontraktor** | Mengatur jadwal alat dan material | Status zona "boleh timbun / tahan", perkiraan tanggal |
| **Konsultan Pengawas / Owner** | Menyetujui tahapan | Laporan ringkas, jejak audit, akses baca-saja |
| **Administrator** | Mengelola proyek, pengguna, instrumen | Manajemen hak akses, konfigurasi ambang batas |

---

## 5. Konteks Teknis Geoteknik

Bagian ini menjadi acuan agar tim produk dan developer memahami domain.

### 5.1 Instrumen yang didukung

| Instrumen | Parameter terukur | Frekuensi umum | Mode input |
|---|---|---|---|
| Settlement plate | Penurunan vertikal di dasar timbunan (mm) | Harian – mingguan | Manual (survey leveling) |
| Settlement cell / profile gauge | Penurunan profil (mm) | Otomatis / harian | Logger |
| Piezometer (vibrating wire / pneumatik) | Tekanan air pori (kPa) | 1 jam – harian | Logger / manual |
| Standpipe / observation well | Muka air tanah (m) | Mingguan | Manual |
| Inclinometer | Deformasi lateral terhadap kedalaman (mm) | Mingguan | Manual (probe) / in-place |
| Extensometer magnetik | Penurunan per lapisan (mm) | Mingguan | Manual |
| Survey patok (displacement stake) | Pergerakan horizontal & vertikal kaki timbunan | Harian – mingguan | Manual / total station |
| Tinggi timbunan | Elevasi puncak timbunan (m) | Harian | Manual (dari kontraktor) |

Kolom "Mode input" di atas menggambarkan kondisi saat ini. Padanan telemetri untuk setiap instrumen dijelaskan di Bagian 8.3.

### 5.2 Metode analisis yang wajib ada

**a. Metode Asaoka (1978)**
Data penurunan pada interval waktu konstan Δt dipasangkan sebagai ρᵢ terhadap ρᵢ₋₁, lalu diregresi linear:

```
ρᵢ = β₀ + β₁ · ρᵢ₋₁
ρ_akhir = β₀ / (1 − β₁)
```

Sistem harus melakukan resampling/interpolasi data ke Δt konstan, dan membiarkan engineer memilih rentang data (setelah beban konstan).

**b. Metode Hiperbolik (Tan, 1971; Sridharan)**

```
t / ρ = α + β · t
ρ_akhir = 1 / β
```

`t` dihitung sejak beban mencapai tinggi konstan.

**c. Teori konsolidasi — vertikal dan radial**

- Vertikal (Terzaghi): `T_v = c_v · t / H_dr²`, U_v dari solusi standar.
- Radial dengan PVD (Hansbo, 1981), dengan efek smear:

```
U_h = 1 − exp(−8 · T_h / μ)
T_h = c_h · t / D_e²
μ   = ln(n/s) + (k_h/k_s) · ln(s) − 0.75     (tanpa well resistance)
n   = D_e / d_w
```

- Gabungan (Carrillo): `U = 1 − (1 − U_v)(1 − U_h)`

**d. Disipasi tekanan air pori**
Derajat konsolidasi dari piezometer: `U = 1 − Δu(t) / Δu₀`, dengan Δu adalah tekanan air pori ekses (dikurangi tekanan hidrostatis referensi).

**e. Kriteria stabilitas timbunan (early warning)**

- Laju penurunan harian dan laju deformasi lateral kaki timbunan.
- Rasio δ/S (deformasi lateral terhadap penurunan) dan diagram Matsuo–Kawamura (S terhadap δ/S).
- Kenaikan tekanan air pori ekses terhadap penambahan beban (rasio Δu/Δσ).
- Laju deformasi inklinometer maksimum pada kedalaman kritis.

Semua ambang batas dapat dikonfigurasi per proyek dan per zona, karena nilai acuannya berbeda antarspesifikasi.

---

## 6. Kebutuhan Fungsional

Prioritas: **P0** = wajib untuk MVP, **P1** = rilis kedua, **P2** = nice-to-have.

### 6.1 Manajemen Proyek & Zona

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-PRJ-01 | Membuat proyek dengan sistem koordinat (UTM zona yang relevan, mis. UTM 49S untuk Jawa bagian tengah) dan datum elevasi | P0 |
| F-PRJ-02 | Membagi proyek menjadi zona/segmen (mis. STA 12+000 – 12+500) dengan poligon | P0 |
| F-PRJ-03 | Menyimpan parameter tanah per zona: stratigrafi, γ, c_v, c_h, C_c, C_r, e₀, OCR, k_h/k_s | P0 |
| F-PRJ-04 | Menyimpan spesifikasi PVD: pola (segitiga/persegi), jarak, panjang, dimensi, d_w, d_s | P0 |
| F-PRJ-05 | Menyimpan riwayat tahapan penimbunan (rencana vs aktual) | P0 |
| F-PRJ-06 | Import data borlog/CPTu (format AGS, CSV) untuk membangun stratigrafi | P1 |

### 6.2 Registrasi & Input Data Instrumen

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-INS-01 | Registrasi instrumen: kode, tipe, koordinat, elevasi, kedalaman tip, tanggal pasang, pembacaan awal (zero reading), status | P0 |
| F-INS-02 | Form input manual per instrumen (tetap dipakai untuk kontrol & cadangan) dengan validasi langsung (lonjakan > n × simpangan baku ditandai) | P0 |
| F-INS-03 | Import massal CSV/XLSX dengan pemetaan kolom yang dapat disimpan sebagai template | P0 |
| F-INS-04 | Ingestion otomatis dari data logger melalui MQTT/HTTP API (rinci di Bagian 8.5) | P0 |
| F-INS-05 | Konversi bacaan mentah (frekuensi VW → kPa) memakai faktor kalibrasi dan koreksi suhu/barometrik per sensor | P0 |
| F-INS-06 | Penanganan penggantian instrumen rusak (menyambung seri data dengan offset tercatat) | P1 |
| F-INS-07 | Mode input offline: data tersimpan lokal di perangkat dan disinkronkan saat koneksi kembali | P2 |
| F-INS-08 | Lampiran foto kondisi instrumen per pembacaan | P2 |

### 6.3 Dashboard Proyek

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-DSH-01 | Status tiap zona: derajat konsolidasi saat ini, prediksi penurunan akhir, sisa penurunan, estimasi tanggal mencapai U target | P0 |
| F-DSH-02 | Indikator status keputusan per zona: **Lanjut timbun / Tahan / Siap bongkar surcharge / Perlu tinjauan** | P0 |
| F-DSH-03 | Daftar alarm aktif dan belum dikonfirmasi | P0 |
| F-DSH-04 | Indikator kesegaran data (instrumen yang terlambat dibaca) | P0 |
| F-DSH-05 | Ringkasan tren 7/30 hari | P1 |

### 6.4 Analisis

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-ANL-01 | Plot waktu–penurunan–tinggi timbunan (sumbu ganda) per instrumen | P0 |
| F-ANL-02 | Analisis Asaoka otomatis dengan Δt yang dapat diatur dan rentang data yang dipilih lewat brush pada grafik | P0 |
| F-ANL-03 | Analisis hiperbolik otomatis, menampilkan R² dan titik yang diabaikan | P0 |
| F-ANL-04 | Kurva prediksi teoretis (Terzaghi + Hansbo) dari parameter desain, dibandingkan dengan data aktual | P0 |
| F-ANL-05 | Plot disipasi tekanan air pori ekses & derajat konsolidasi dari piezometer | P0 |
| F-ANL-06 | Profil inklinometer (deformasi kumulatif & inkremental terhadap kedalaman), dengan overlay beberapa tanggal | P0 |
| F-ANL-07 | Back-analysis: mencari c_h (dan opsional c_v) yang paling cocok dengan data aktual (least squares), menampilkan rentang ketidakpastian | P1 |
| F-ANL-08 | Diagram Matsuo–Kawamura per penampang | P1 |
| F-ANL-09 | Perbandingan antarmetode dalam satu tabel (Asaoka vs hiperbolik vs teoretis) dan selisihnya | P0 |
| F-ANL-10 | Setiap hasil analisis tersimpan sebagai snapshot beserta parameter input dan versi algoritma (dapat direproduksi) | P0 |

### 6.5 Alarm & Notifikasi

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-ALM-01 | Ambang tiga level: **Waspada – Siaga – Bahaya** per parameter per zona | P0 |
| F-ALM-02 | Aturan berbasis nilai, laju (per hari), dan rasio (δ/S, Δu/Δσ) | P0 |
| F-ALM-03 | Notifikasi via email dan WhatsApp/Telegram (gateway pihak ketiga) | P1 |
| F-ALM-04 | Konfirmasi alarm (acknowledge) dengan catatan tindakan, tercatat di log | P0 |
| F-ALM-05 | Penekanan alarm palsu: alarm hanya terpicu jika dua pembacaan berurutan melewati ambang, atau dikonfirmasi instrumen tetangga | P1 |

### 6.6 Digital Twin

Lihat Bagian 7 untuk spesifikasi rinci.

### 6.7 Pelaporan

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-RPT-01 | Laporan mingguan otomatis (PDF) dengan template yang dapat diatur: ringkasan, grafik per instrumen, tabel prediksi, alarm | P0 |
| F-RPT-02 | Ekspor data mentah dan hasil analisis (CSV/XLSX) | P0 |
| F-RPT-03 | Kolom tanda tangan/persetujuan digital oleh engineer dan pengawas | P1 |
| F-RPT-04 | Laporan dalam Bahasa Indonesia dan Bahasa Inggris | P1 |

### 6.8 Pengguna, Hak Akses & Audit

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-USR-01 | Role: Admin, Engineer, Surveyor, Viewer (Owner/Pengawas) | P0 |
| F-USR-02 | Hak akses per proyek | P0 |
| F-USR-03 | Audit log untuk setiap perubahan data, ambang batas, dan parameter analisis (siapa, kapan, nilai lama → baru) | P0 |
| F-USR-04 | SSO (Google Workspace / Microsoft Entra) | P2 |

---

## 7. Spesifikasi Digital Twin

### 7.1 Definisi dalam konteks produk

Digital twin di STESY GEO **bukan sekadar model 3D yang dihias sensor**. Ia adalah representasi terhubung dari tiga lapis:

1. **Geometri** — permukaan tanah asli, lapisan tanah, timbunan per tahap, grid PVD, lokasi instrumen.
2. **Kondisi terukur** — nilai terbaru dari setiap instrumen, dipetakan ke posisinya.
3. **Model perilaku** — model konsolidasi terkalibrasi (hasil back-analysis) yang mengisi celah antarinstrumen dan memproyeksikan kondisi ke masa depan.

Twin harus selalu membedakan secara visual antara **nilai terukur**, **nilai interpolasi**, dan **nilai prediksi**. Ini penting untuk kepercayaan engineer.

### 7.2 Kebutuhan

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-DT-01 | Viewer 3D timbunan dan lapisan tanah (dari stratigrafi zona), dengan exaggeration vertikal yang dapat diatur (1× – 10×) | P0 |
| F-DT-02 | Marker instrumen di posisi sebenarnya; klik untuk membuka panel data ringkas dan tautan ke analisis | P0 |
| F-DT-03 | Pewarnaan permukaan dasar timbunan berdasarkan penurunan terukur (interpolasi kriging/IDW), dengan legenda berskala mm | P0 |
| F-DT-04 | Irisan penampang (cross-section) pada STA mana pun: menampilkan stratigrafi, PVD, profil inklinometer, dan kontur tekanan air pori ekses | P0 |
| F-DT-05 | **Time slider**: memutar ulang kondisi dari awal penimbunan hingga hari ini, lalu berlanjut ke prediksi (garis waktu dibedakan jelas: histori vs proyeksi) | P0 |
| F-DT-06 | Mode tampilan: Penurunan / Derajat konsolidasi / Tekanan air pori / Deformasi lateral / Status alarm / **Kesehatan perangkat telemetri** | P0 |
| F-DT-07 | **Simulasi skenario (what-if)**: mengubah jadwal tahap timbunan, tinggi surcharge, atau tanggal bongkar, lalu melihat dampak ke U, penurunan sisa, dan indikasi stabilitas | P1 |
| F-DT-08 | Kalibrasi berkelanjutan: parameter model diperbarui dari back-analysis terbaru; setiap versi parameter tersimpan | P1 |
| F-DT-09 | Tampilan peta 2D (basemap satelit/topografi) yang sinkron dengan viewer 3D | P0 |
| F-DT-10 | Import model eksternal: permukaan (LandXML, DXF/DWG via konversi, GeoTIFF DEM) dan model BIM/IFC untuk struktur di sekitar | P2 |
| F-DT-11 | Tingkat keyakinan: area dengan kerapatan instrumen rendah ditandai dengan arsir/transparansi lebih tinggi | P1 |

### 7.3 Alur data twin

```
Instrumen / input manual
        │
        ▼
Ingestion & validasi  ──►  Time-series DB
        │
        ▼
Analysis service (Asaoka, hiperbolik, Hansbo, back-analysis)
        │
        ▼
Twin state builder
  - grid spasial per zona (resolusi ±5 m)
  - interpolasi nilai terukur
  - proyeksi dari model terkalibrasi
        │
        ▼
Twin API (snapshot per tanggal, diff incremental)
        │
        ▼
Viewer 3D + peta 2D di browser
```

### 7.4 Batasan

- Model perilaku memakai solusi analitis 1D + radial per sel grid, bukan FEM 2D/3D. Ini disebutkan eksplisit di UI (tooltip "Metode model").
- Hasil FEM eksternal dapat diimpor sebagai lapisan pembanding, bukan dijalankan di dalam sistem.

---

## 8. Sistem Telemetri & Sensor

### 8.1 Latar belakang

Saat ini seluruh pembacaan instrumen di lapangan dilakukan manual: waterpass untuk settlement plate, readout portabel untuk piezometer, probe untuk inklinometer, dan total station untuk patok geser. STESY GEO dirancang untuk memindahkan pengambilan data ke **telemetri otomatis** secara bertahap, dengan input manual tetap tersedia sebagai cadangan dan pembanding.

Prinsip utamanya: **STESY GEO tidak terkunci ke satu vendor.** Sensor dan logger boleh dari merek berbeda, selama datanya bisa masuk lewat MQTT, HTTP, atau API vendor.

### 8.2 Arsitektur telemetri

```
 LAPANGAN                              JARINGAN                    STESY GEO
┌─────────────────────────┐
│ Sensor                  │
│ - Piezometer VW         │
│ - Settlement cell VW    │──► Logger nirkabel ──► Gateway ──4G/──► Ingestion service
│ - ShapeArray / IPI      │    (LoRa / mesh /      (surya +   VSAT   - MQTT broker
│ - GNSS rover            │     seluler)            baterai)         - HTTP endpoint
│ - Rain gauge, barometer │                                          - Adapter API vendor
└─────────────────────────┘                                                │
                                                                           ▼
                                                           Validasi → konversi → koreksi
                                                                           │
                                                                           ▼
                                                             Time-series DB → analisis,
                                                             alarm, digital twin
```

Lapisan yang harus ada:

1. **Sensor** — mengubah besaran fisik (tekanan, sudut, posisi) menjadi sinyal yang bisa dibaca mesin (frekuensi VW, digital RS-485/SDI-12, 4–20 mA, atau posisi GNSS).
2. **Logger (edge device)** — membaca sensor pada jadwal tertentu, menyimpan buffer lokal, dan mengirim data. Wajib bertenaga baterai atau surya.
3. **Gateway** — menerima data dari banyak logger dan meneruskannya ke internet (4G; VSAT jika tanpa sinyal seluler).
4. **Ingestion service STESY GEO** — menerima, memvalidasi, mengonversi, dan menyimpan data.

### 8.3 Pemetaan instrumen manual → telemetri

| Instrumen manual saat ini | Pengganti telemetri | Prinsip kerja | Catatan pemilihan |
|---|---|---|---|
| Settlement plate (waterpass) | **VW liquid settlement cell** (single / multipoint) | Transduser tekanan VW dihubungkan selang berisi cairan ke tangki referensi di tanah stabil; perubahan tekanan = perubahan elevasi | Opsi utama untuk timbunan. Tangki referensi harus di luar zona pengaruh dan dicek elevasinya secara berkala |
| Settlement plate (waterpass) | **GNSS pada batang settlement plate** | Receiver GNSS presisi mm di ujung batang; posisi dihitung relatif terhadap base station | Bisa memanfaatkan plat yang sudah ada. Butuh langit terbuka dan base station stabil. Batang harus disambung saat timbunan naik |
| Deretan settlement plate / profile gauge | **ShapeArray horizontal (SAAX)** atau hydrostatic profile gauge otomatis | Rangkaian sensor kemiringan di dalam pipa melintang di bawah timbunan menghasilkan profil penurunan kontinu | Ideal untuk digital twin karena memberi profil penuh satu penampang. Biaya per unit lebih tinggi |
| Piezometer (readout portabel) | **Piezometer VW + logger** | Sama; hanya pembacaannya diotomatisasi | Piezometer VW yang sudah terpasang cukup disambung ke logger. Piezometer pneumatik/Casagrande perlu diganti |
| Standpipe / sumur pengamatan | **Pressure transducer (VW / 4–20 mA) di dalam pipa** | Tekanan kolom air → muka air tanah | Murah, masuk ke logger yang sama |
| Inklinometer probe manual | **In-place inclinometer (IPI)** atau **ShapeArray vertikal (SAAV)** | Rangkaian sensor kemiringan permanen di dalam casing | SAAV dapat dimasukkan ke casing lama tanpa bor ulang. IPI lebih murah jika jumlah titik kedalaman sedikit |
| Extensometer magnetik | **Extensometer VW / potensiometer (rod extensometer)** | Perpindahan antar-jangkar diukur sensor di kepala | Hanya jika penurunan per lapisan memang dibutuhkan |
| Patok geser kaki timbunan | **GNSS** atau **robotic total station (AMTS) + prisma** | Posisi 3D otomatis | GNSS untuk titik tersebar; AMTS untuk banyak titik dalam satu garis pandang |
| *(belum ada)* | **Rain gauge** | Curah hujan | Penting di iklim tropis: hujan memengaruhi muka air dan tekanan pori |
| *(belum ada)* | **Barometer** | Tekanan udara | Untuk koreksi barometrik piezometer VW yang tidak ber-vent |
| Tinggi timbunan (laporan kontraktor) | Input harian terstruktur + survei GNSS rover; **drone fotogrametri** (P2) | Elevasi puncak timbunan | Belum praktis diotomatisasi penuh; tetap diinput, tetapi divalidasi |

### 8.4 Opsi logger & komunikasi

| Ekosistem | Topologi & jangkauan | Kelebihan | Perhatian |
|---|---|---|---|
| **Worldsensing Loadsensing** | LoRa, star; jangkauan hingga ±15 km (line of sight) | Satu ekosistem untuk VW, analog, digital, GNSS; baterai sangat awet; bisa jaringan privat | Platform CMT milik vendor; STESY GEO ambil data via API/MQTT |
| **Geokon GeoNet** | Mesh radio; opsi logger seluler, Wi-Fi, satelit | Cocok untuk lokasi tanpa line of sight; tersedia OpenAPI | Terutama untuk sensor Geokon & VW |
| **Campbell Scientific (CR1000X, CR6) + multiplexer** | Kabel ke sensor, logger kirim via 4G | Sangat fleksibel, tahan lama, bisa hitung di logger | Kabel panjang rentan rusak oleh alat berat; perlu pemrograman |
| **RST, Sisgeo, Encardio** | Beragam (radio, seluler) | Alternatif merek dengan distributor di Asia | Cek dukungan API/MQTT |

**Syarat minimum logger agar kompatibel dengan STESY GEO:**
- Menyimpan buffer lokal minimal 30 hari jika koneksi putus, lalu mengirim ulang otomatis (backfill).
- Mengirim data mentah (mis. frekuensi Hz atau digit) **dan** suhu sensor, bukan hanya nilai terkonversi.
- Menyediakan metadata kesehatan: tegangan baterai, kekuatan sinyal (RSSI/SNR), suhu internal, waktu pengiriman terakhir.
- Timestamp dalam UTC dengan sinkronisasi waktu otomatis.
- Data dapat diakses via MQTT, HTTP push, atau REST API terdokumentasi.

### 8.5 Kebutuhan fungsional telemetri

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-TLM-01 | Registrasi logger & gateway: merek, model, nomor seri, lokasi, kanal, firmware | P0 |
| F-TLM-02 | Pemetaan kanal logger → instrumen, dengan riwayat (jika sensor dipindah kanal) | P0 |
| F-TLM-03 | Ingestion via MQTT (TLS) dan HTTP push dengan autentikasi token per gateway | P0 |
| F-TLM-04 | Adapter pull API vendor (mis. Worldsensing CMT, Geokon OpenAPI, Campbell LoggerNet) yang berjalan terjadwal | P0 untuk vendor pilot, P1 untuk lainnya |
| F-TLM-05 | Penyimpanan nilai mentah + nilai terkonversi + versi faktor kalibrasi yang dipakai | P0 |
| F-TLM-06 | Konversi VW: polinomial/linear dari sertifikat kalibrasi, koreksi suhu, koreksi barometrik | P0 |
| F-TLM-07 | Koreksi settlement cell hidrostatik terhadap perubahan elevasi tangki referensi (dari survei berkala) | P0 |
| F-TLM-08 | Deduplikasi dan penerimaan data terlambat (backfill) tanpa merusak hasil analisis; analisis dihitung ulang otomatis bila ada data lama masuk | P0 |
| F-TLM-09 | Dashboard kesehatan perangkat: baterai, sinyal, last seen, persentase kelengkapan data per 24 jam | P0 |
| F-TLM-10 | Alarm teknis (terpisah dari alarm geoteknik): logger offline > N jam, baterai < 20%, nilai di luar rentang fisik sensor, lompatan nilai tidak wajar | P0 |
| F-TLM-11 | Tampilan **pembanding manual vs telemetri** untuk masa transisi, dengan selisih dan statistiknya | P0 |
| F-TLM-12 | Upload sertifikat kalibrasi (PDF) per sensor dan pengingat kalibrasi ulang | P1 |
| F-TLM-13 | Frekuensi pembacaan adaptif: otomatis dipercepat saat alarm Waspada aktif atau saat penimbunan berlangsung (jika logger mendukung konfigurasi jarak jauh) | P2 |
| F-TLM-14 | Log pekerjaan pemeliharaan: penggantian baterai, perbaikan kabel, penyambungan batang | P1 |

### 8.6 Frekuensi pembacaan default

| Parameter | Saat penimbunan aktif | Masa tunggu (waiting period) | Alasan |
|---|---|---|---|
| Tekanan air pori | 1 jam | 3–6 jam | Respons tekanan pori terhadap beban cepat; indikator stabilitas utama |
| Penurunan (settlement cell / GNSS) | 1–3 jam | 6–12 jam | GNSS perlu sesi pengamatan untuk presisi mm; data dirata-ratakan harian untuk analisis |
| Profil penurunan (SAAX) | 6 jam | 12–24 jam | Perubahan lambat |
| Deformasi lateral (IPI/SAAV) | 1 jam | 6 jam | Indikator ketidakstabilan timbunan |
| Curah hujan | 10–15 menit | 10–15 menit | Kejadian hujan singkat |
| Tekanan udara | 1 jam | 1 jam | Mengikuti piezometer |

Analisis Asaoka memakai data yang di-resample ke interval konstan (mis. harian), sehingga data berfrekuensi tinggi tidak mengganggu metode tersebut.

### 8.7 Daya, proteksi, dan keamanan fisik

- **Daya:** logger memakai baterai lithium internal; gateway memakai panel surya + baterai dengan otonomi minimal 5 hari tanpa matahari (musim hujan).
- **Petir:** gateway dan logger berkabel panjang wajib memakai surge protector dan pentanahan. Petir adalah penyebab kerusakan yang sering terjadi di lokasi terbuka.
- **Alat berat:** kabel dan selang dilindungi conduit HDPE dan ditanam; kepala instrumen di area timbunan ditandai dengan tiang dan bendera, serta dicatat di gambar kerja kontraktor.
- **Vandalisme & pencurian:** panel surya dan box logger dipasang di tiang tinggi dengan kotak terkunci; lokasi gateway dipilih dekat pos jaga jika memungkinkan.
- **Banjir & genangan:** box logger minimal IP67 dan dipasang di atas elevasi genangan tertinggi yang pernah tercatat.

### 8.8 Regulasi & pengadaan di Indonesia

- Perangkat LoRa wajib memakai pita frekuensi yang berlaku di Indonesia (AS923-2, 920–923 MHz). Perangkat versi Eropa (868 MHz) atau Amerika (915 MHz) tidak boleh dipakai.
- Perangkat radio wajib memiliki **sertifikat alat/perangkat telekomunikasi dari SDPPI (Kominfo/Komdigi)**. Minta bukti sertifikat dari distributor sebelum pembelian.
- Untuk proyek pemerintah/BUMN, periksa persyaratan **TKDN** yang mungkin memengaruhi pilihan merek atau skema pengadaan.
- Harga sensor dan logger jarang dipublikasikan dan bervariasi antarproyek; minta penawaran dari minimal tiga distributor.

### 8.9 Strategi transisi manual → telemetri

| Tahap | Durasi | Aktivitas |
|---|---|---|
| T1 — Pilot | 1 zona, 2–3 bulan | Pasang telemetri lengkap di satu segmen; pembacaan manual tetap berjalan paralel dengan frekuensi biasa |
| T2 — Validasi | Bersamaan dengan T1 | Bandingkan manual vs telemetri (F-TLM-11). Kriteria lulus: selisih penurunan ≤ ±5 mm dan tekanan pori ≤ ±2 kPa pada ≥ 90% pasangan data |
| T3 — Perluasan | Bertahap per zona | Telemetri jadi sumber data utama; manual dikurangi menjadi pengecekan bulanan (settlement plate kontrol & tangki referensi) |
| T4 — Operasi | Sampai akhir masa pemantauan | Pemeliharaan terjadwal, kalibrasi, penggantian baterai |

Beberapa settlement plate manual **tetap dipertahankan sepanjang proyek** sebagai kontrol independen, karena kegagalan sensor otomatis bisa tidak terdeteksi tanpa pembanding.

---

## 9. Studi Kasus Awal: Timbunan Jalan di Atas Tanah Lunak

Studi kasus pertama STESY GEO adalah **pekerjaan timbunan jalan (jalan tol/jalan nasional)** di atas lempung lunak. Angka di bagian ini adalah **contoh ilustratif** untuk mendefinisikan fitur dan konfigurasi; nilai sebenarnya diambil dari dokumen desain dan spesifikasi proyek pilot.

### 9.1 Mengapa jalan dipilih lebih dulu

- Proyek jalan di atas tanah lunak (dataran pantai, rawa, bekas tambak) sangat umum di Indonesia dan hampir selalu memakai preloading + PVD.
- Geometrinya linear (berbasis STA), sehingga zona, penampang, dan digital twin lebih mudah distandarkan.
- Keputusan yang dipantau jelas dan berulang: kapan tahap timbunan berikutnya, kapan surcharge dibongkar, dan kapan perkerasan boleh dimulai.
- Risiko biaya jelas: penurunan sisa menyebabkan jalan bergelombang dan retak, terutama di **oprit jembatan** dan transisi struktur.

### 9.2 Deskripsi segmen contoh

| Item | Nilai contoh |
|---|---|
| Segmen | STA 24+000 – 25+000 (1.000 m), jalan 2 × 2 lajur |
| Lebar puncak timbunan | ±24 m |
| Kemiringan lereng | 1V : 2H |
| Tinggi timbunan rencana | 4,0 m |
| Surcharge | 1,5 m (dibongkar setelah kriteria terpenuhi) |
| Oprit jembatan | STA 24+900 – 25+000 (zona transisi) |
| Stratigrafi | 0–2 m lempung kaku (crust); 2–16 m lempung sangat lunak (N-SPT 0–2, c_u 8–15 kPa); 16–20 m lempung sedang; > 20 m pasir padat |
| Parameter lempung sangat lunak | e₀ 2,0–2,5; C_c 0,9–1,2; c_v ≈ 1,5 m²/tahun; c_h ≈ 3 m²/tahun; k_h/k_s = 2 |
| PVD | Pola segitiga, jarak 1,2 m, panjang 16 m, ukuran 100 × 4 mm |
| Tahap penimbunan | ±5 tahap @ 1,0–1,2 m, jeda 2–4 minggu per tahap (sesuai hasil pemantauan) |
| Perkiraan penurunan konsolidasi primer | 1,5–2,0 m (dari analisis desain) |

**Contoh perhitungan waktu dengan PVD (Hansbo):**

```
D_e = 1,05 × 1,2 = 1,26 m            (pola segitiga)
d_w = (a + b) / 2 = (100 + 4) / 2 = 52 mm
n   = D_e / d_w ≈ 24,2
s   = 2 ; k_h/k_s = 2
μ   = ln(24,2/2) + 2·ln(2) − 0,75 ≈ 3,13

U_h = 90%  →  T_h = −ln(0,1) · μ / 8 ≈ 0,90
t   = T_h · D_e² / c_h = 0,90 × 1,26² / 3 ≈ 0,48 tahun ≈ 5,7 bulan
```

Angka ini menjadi **kurva prediksi desain** di STESY GEO. Data telemetri kemudian dipakai untuk back-analysis c_h aktual; jika c_h lapangan lebih rendah, STESY GEO otomatis menggeser estimasi tanggal bongkar surcharge.

### 9.3 Tata letak instrumen & telemetri

**Penampang instrumen utama** di STA 24+200, 24+500, dan 24+800 (tiap penampang):

| Instrumen | Jumlah | Lokasi | Telemetri |
|---|---|---|---|
| VW settlement cell (multipoint) | 3 | As jalan, bahu kiri, bahu kanan | Logger VW |
| ShapeArray horizontal (SAAX) | 1 | Melintang penuh di dasar timbunan (±45 m) | Logger digital |
| Piezometer VW | 4 | As jalan pada kedalaman ±5, 9, 13 m; 1 di bawah kaki lereng pada ±7 m | Logger VW |
| In-place inclinometer / SAAV | 2 | Kaki lereng kiri & kanan, kedalaman 20 m (tertanam di pasir padat) | Logger digital |
| GNSS di batang settlement plate | 1 | As jalan (kontrol independen terhadap settlement cell) | LoRa/seluler |
| GNSS patok kaki timbunan | 2 | 3–5 m di luar kaki lereng kiri & kanan | LoRa/seluler |
| Settlement plate manual (kontrol) | 1 | Dekat as jalan | Manual, bulanan |

**Penampang antara** setiap 100 m (STA 24+100, 24+300, 24+400, 24+600, 24+700): 1 GNSS pada batang settlement plate di as jalan dan 1 piezometer VW pada kedalaman ±9 m.

**Zona transisi oprit jembatan (STA 24+900 – 25+000):** kerapatan ditingkatkan menjadi penampang setiap 25 m, masing-masing dengan 2 settlement cell, karena penurunan diferensial memanjang di sini yang paling berisiko.

**Instrumen seluruh segmen:**
- 1 tangki referensi settlement cell di luar zona pengaruh (≥ 2× tinggi timbunan dari kaki lereng), dicek elevasinya bulanan.
- 1 GNSS base station pada titik stabil (bangunan permanen atau tugu beton di tanah keras).
- 1 rain gauge dan 1 barometer.
- 1 gateway LoRa/mesh bertenaga surya + 4G di sekitar STA 24+500 (jarak ke ujung segmen ±500 m, masih jauh di bawah jangkauan radio).

**Ringkasan perkiraan kuantitas (untuk permintaan penawaran):**

| Item | Perkiraan jumlah |
|---|---|
| VW settlement cell | 9 (penampang utama) + 10 (oprit) = 19 |
| Piezometer VW | 12 + 5 = 17 |
| SAAX | 3 |
| IPI / SAAV (20 m) | 6 |
| GNSS rover | 3 + 6 + 5 = 14 |
| GNSS base | 1 |
| Logger VW (multi-kanal) | ±10 |
| Logger digital (SAA/IPI) | ±9 |
| Gateway | 1 (+1 cadangan) |
| Rain gauge + barometer | 1 set |

Jumlah akhir mengikuti gambar instrumentasi yang disetujui konsultan.

### 9.4 Kriteria keputusan (contoh konfigurasi)

Kriteria di bawah adalah **contoh default** yang dapat diubah per proyek; nilai final ditetapkan konsultan/owner.

**A. Boleh lanjut ke tahap timbunan berikutnya** jika semua terpenuhi:
- Tekanan air pori ekses dari tahap terakhir sudah terdisipasi minimal 50–60% di piezometer as jalan.
- Laju deformasi lateral di kaki lereng di bawah level **Waspada** selama minimal 3 hari berturut-turut.
- Titik pada diagram Matsuo–Kawamura berada di zona aman.
- Tidak ada alarm aktif yang belum dikonfirmasi pada zona tersebut.

**B. Boleh bongkar surcharge** jika semua terpenuhi:
- Derajat konsolidasi gabungan U ≥ 90%, dihitung dari Asaoka **dan** hiperbolik, dengan selisih prediksi penurunan akhir kedua metode ≤ 10%.
- U dari piezometer (disipasi tekanan pori) ≥ 85% di seluruh piezometer as jalan.
- Prediksi penurunan sisa pascakonstruksi di bawah beban rencana memenuhi spesifikasi (contoh: ≤ 10 cm dalam 10 tahun).
- Laju penurunan saat ini di bawah ambang (contoh: < 2 mm/minggu, rata-rata 4 minggu).

**C. Boleh mulai perkerasan** jika:
- Surcharge sudah dibongkar dan elevasi subgrade disesuaikan dengan elevasi rencana (termasuk timbunan kompensasi).
- Penurunan diferensial memanjang di zona oprit memenuhi batas perubahan kemiringan yang disyaratkan.

**Contoh ambang alarm stabilitas (ilustratif):**

| Parameter | Waspada | Siaga | Bahaya |
|---|---|---|---|
| Laju deformasi lateral kaki lereng (mm/hari) | > 5 | > 10 | > 20 |
| Laju penurunan as jalan saat penimbunan (mm/hari) | > 15 | > 25 | > 40 |
| Rasio Δu/Δσ pada tahap berjalan | > 0,6 | > 0,8 | > 1,0 |
| Rasio δ/S (kaki lereng/as jalan) | > 0,3 | > 0,5 | > 0,7 |
| Pergerakan horizontal patok GNSS kaki (mm/hari) | > 5 | > 10 | > 20 |

### 9.5 Kebutuhan khusus modul jalan

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-JLN-01 | Import alignment jalan (LandXML/CSV STA–koordinat) dan elevasi rencana (profil memanjang) | P0 |
| F-JLN-02 | Semua lokasi instrumen dan zona dinyatakan dalam **STA + offset** (kiri/kanan as), selain koordinat UTM | P0 |
| F-JLN-03 | **Profil memanjang penurunan** sepanjang segmen: penurunan terukur, prediksi akhir, dan penurunan sisa per STA | P0 |
| F-JLN-04 | **Perhitungan timbunan kompensasi**: selisih elevasi aktual vs elevasi rencana setelah penurunan, beserta estimasi volume per segmen | P1 |
| F-JLN-05 | Modul **zona transisi oprit**: perubahan kemiringan memanjang akibat penurunan diferensial dan pengecekan terhadap batas spesifikasi | P1 |
| F-JLN-06 | Status keputusan per segmen 100 m dalam bentuk **strip diagram STA** (mirip straight-line diagram) | P0 |
| F-JLN-07 | Laporan mingguan format jalan: tabel per STA, profil memanjang, penampang utama | P0 |

### 9.6 Digital twin untuk jalan

- **Model koridor**: timbunan dibangun dari alignment + penampang tipikal per STA, bukan model 3D bebas.
- **Mode profil memanjang**: garis elevasi rencana, elevasi timbunan aktual, dan elevasi dasar timbunan (terukur & prediksi) sepanjang STA.
- **Mode penampang**: di setiap penampang utama, tampilkan profil SAAX (cekungan penurunan), piezometer, dan profil IPI dalam satu irisan.
- **Skenario jalan**: “Jika surcharge dibongkar tanggal X, berapa penurunan sisa per STA?” dan “Jika tahap 4 dipercepat 1 minggu, bagaimana indikasi stabilitas di penampang terlemah?”
- **Strip status STA** yang sinkron dengan viewer 3D: klik segmen di strip → kamera terbang ke segmen tersebut.

### 9.7 Kriteria sukses studi kasus

| Metrik | Target pilot |
|---|---|
| Kelengkapan data telemetri (data diterima / data dijadwalkan) | ≥ 95% |
| Selisih telemetri vs manual (penurunan) | ≤ ±5 mm pada ≥ 90% pasangan data |
| Waktu dari data lapangan ke rekomendasi tahap timbunan | < 1 hari kerja |
| Selisih prediksi penurunan akhir saat U = 70% vs hasil akhir | ≤ 15% |
| Tidak ada kejadian ketidakstabilan timbunan tanpa alarm sebelumnya | 100% |

---

## 10. Kebutuhan Non-Fungsional

| Kategori | Target |
|---|---|
| Kinerja | Dashboard termuat < 2,5 detik (P75) pada koneksi 10 Mbps; grafik 10.000 titik tetap interaktif (≥ 50 fps pan/zoom) |
| Viewer 3D | ≥ 30 fps pada laptop kelas menengah (GPU terintegrasi) untuk proyek hingga 5 km dengan 500 instrumen |
| Latensi data | Data logger tampil di dashboard < 5 menit setelah diterima |
| Kelengkapan data telemetri | ≥ 95% per bulan per instrumen (di luar gangguan perangkat yang tercatat) |
| Ketahanan ingestion | Tidak ada data hilang saat server tidak tersedia hingga 30 hari (ditopang buffer logger + backfill) |
| Ketersediaan | 99,5% bulanan |
| Keamanan | HTTPS/TLS 1.2+, enkripsi at-rest, hashing password (Argon2), rate-limit API, pemisahan data antarproyek |
| Kepatuhan data | Mengikuti UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi untuk data pengguna |
| Retensi | Data mentah disimpan minimal selama umur proyek + 5 tahun |
| Kompatibilitas | Chrome, Edge, Firefox, Safari versi dua tahun terakhir; lebar layar minimal 1024 px untuk fitur penuh, 768 px untuk input lapangan |
| Aksesibilitas | Kontras teks minimal WCAG AA; tidak mengandalkan warna saja untuk status (selalu ada label/ikon/pola) |
| Reproduksibilitas | Setiap hasil analisis dapat dihitung ulang identik dari snapshot input |

---

## 11. Arsitektur & Stack yang Diusulkan

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Frontend | React + TypeScript (Vite atau Next.js) | Ekosistem luas, typing ketat untuk data teknis |
| Grafik | Apache ECharts atau uPlot (time-series padat) | Performa tinggi untuk ribuan titik |
| 3D | Three.js via React Three Fiber | Kontrol penuh atas shader pewarnaan dan irisan |
| Peta 2D | MapLibre GL | Open source, mendukung vector tiles |
| Backend API | FastAPI (Python) | Dekat dengan ekosistem numerik (NumPy, SciPy) |
| Analysis worker | Python + Celery/RQ | Analisis berat berjalan di latar belakang |
| Database | PostgreSQL + PostGIS + TimescaleDB | Spasial dan time-series dalam satu mesin |
| Ingestion | MQTT broker (Mosquitto/EMQX) + HTTP endpoint | Standar untuk data logger |
| Adapter vendor | Worker terjadwal per vendor (Worldsensing CMT, Geokon OpenAPI, Campbell LoggerNet, dll.) yang menormalkan data ke format internal | Menghindari ketergantungan pada satu merek |
| Penyimpanan file | S3-compatible (MinIO atau cloud) | Laporan, foto, model 3D |
| Laporan PDF | Template HTML → PDF (WeasyPrint/Playwright) | Tata letak konsisten dengan tampilan web |
| Deploy | Docker; opsi cloud atau on-premise untuk owner BUMN yang mensyaratkannya | Fleksibilitas kontrak |

---

## 12. Model Data (Inti)

```
Project (id, name, type[jalan|reklamasi|...], crs_epsg, vertical_datum, created_at)
 ├─ Alignment (project_id, name, sta_geometry, design_profile)      -- modul jalan
 └─ Zone (id, project_id, code, sta_start, sta_end, polygon)
     ├─ SoilLayer (zone_id, top_elev, bottom_elev, name, γ, cv, ch, Cc, Cr, e0, OCR, kh_ks)
     ├─ PVDSpec (zone_id, pattern, spacing, length, a, b, dw, ds)
     ├─ FillStage (zone_id, stage_no, planned_date, actual_date, target_elev, actual_elev)
     └─ Instrument (id, zone_id, type, code, x, y, z, sta, offset, tip_depth, installed_at,
                    zero_reading, calib_json, status)
         └─ Reading (instrument_id, ts, raw_value, raw_temp, value, unit,
                     source[manual|telemetry], calib_id, flag, entered_by, received_at)

Gateway (id, project_id, vendor, model, serial, x, y, power_type, last_seen)
Logger (id, gateway_id, vendor, model, serial, firmware, x, y, channels, last_seen)
LoggerChannel (logger_id, channel_no, instrument_id, valid_from, valid_to)
DeviceHealth (device_id, ts, battery_v, rssi, snr, internal_temp)
Calibration (instrument_id, valid_from, coeffs_json, certificate_file)
ReferenceCheck (instrument_id|tank_id, ts, elevation, method)     -- tangki referensi / base GNSS
MaintenanceLog (device_id, ts, action, note, by)

AnalysisRun (id, instrument_id|zone_id, method, params_json, input_hash,
             result_json, algo_version, created_by, created_at)
AlarmRule (id, zone_id, parameter, kind[value|rate|ratio], level, threshold, window)
AlarmEvent (id, rule_id, instrument_id, ts, value, level, ack_by, ack_note, ack_at)
TwinSnapshot (id, zone_id, as_of, grid_ref, params_version, is_projection)
AuditLog (id, user_id, entity, entity_id, action, before_json, after_json, ts)
```

---

## 13. Arah Desain UI

### 13.1 Prinsip

Tampilan harus terasa seperti **instrumen kerja seorang engineer**, bukan landing page startup. Rujukan suasana: panel kontrol SCADA modern, lembar gambar teknik, dan layar survei total station — dengan glassmorphism dipakai secara terukur, bukan sebagai gimmick.

1. **Data dulu, dekorasi belakangan.** Setiap elemen visual harus membawa informasi.
2. **Kepadatan yang terkendali.** Engineer terbiasa dengan layar padat; jangan buang ruang untuk kartu-kartu besar berisi satu angka.
3. **Satuan selalu tampil.** Tidak ada angka tanpa satuan (mm, kPa, m, %, hari).
4. **Presisi yang jujur.** Jumlah desimal mengikuti ketelitian instrumen (penurunan 0 desimal mm, tekanan 1 desimal kPa), bukan dibuat seragam.

### 13.2 Glassmorphism yang profesional

Glass hanya dipakai pada **lapisan yang melayang di atas konteks spasial** — panel di atas viewer 3D dan peta, drawer instrumen, command palette. Halaman tabel dan formulir memakai permukaan solid agar mudah dibaca.

| Token | Nilai | Catatan |
|---|---|---|
| `--glass-bg` | `rgba(16, 22, 28, 0.62)` (gelap) / `rgba(248, 250, 251, 0.68)` (terang) | Opasitas cukup tinggi agar teks tetap terbaca |
| `--glass-blur` | `14px` | Lebih dari 20px mulai terasa "kabur mewah", bukan teknis |
| `--glass-border` | `1px solid rgba(255,255,255,0.08)` | Garis tipis, bukan glow |
| `--glass-highlight` | `inset 0 1px 0 rgba(255,255,255,0.06)` | Kilap tepi atas yang halus |
| `--radius-panel` | `6px` | Sudut tegas; hindari 16–24px yang terlalu "bubbly" |
| `--radius-control` | `3px` | Tombol & input |
| Bayangan | `0 8px 24px rgba(0,0,0,0.28)` satu lapis | Tanpa bayangan berwarna |

Latar di belakang glass bukan gradien ungu-biru abstrak, melainkan **konten nyata**: peta, model 3D, atau pola grid milimeter samar (garis 1 px setiap 8 px, garis tebal setiap 40 px, opasitas 3–5%).

### 13.3 Palet warna

Dasar netral kebiruan-abu seperti baja; aksen diambil dari bahasa visual lapangan (cat marka survei, rompi keselamatan), bukan dari tren aplikasi SaaS.

| Peran | Warna | Hex |
|---|---|---|
| Latar utama (gelap) | Graphite | `#0F1419` |
| Permukaan | Slate | `#1A2129` |
| Garis/pembatas | Steel line | `#2B3540` |
| Teks utama | Paper | `#E6E9EC` |
| Teks sekunder | Pencil | `#8A96A3` |
| Aksen utama | Survey orange | `#E8772E` |
| Data seri 1 | Cyan tinta | `#4FB3C8` |
| Data seri 2 | Olive | `#A3B24A` |
| Status aman | Hijau | `#3FA66B` |
| Waspada | Kuning | `#D9B23A` |
| Siaga | Oranye | `#E07B2E` |
| Bahaya | Merah | `#D04A3F` |
| Prediksi/proyeksi | Garis putus-putus, warna seri dengan opasitas 70% | — |

Mode terang disediakan untuk cetak dan pemakaian di bawah matahari lapangan.

### 13.4 Tipografi

| Penggunaan | Font | Catatan |
|---|---|---|
| UI & teks | IBM Plex Sans | Karakter teknis, tetap netral |
| Angka, koordinat, kode instrumen, satuan | IBM Plex Mono / JetBrains Mono | `font-variant-numeric: tabular-nums` agar kolom angka rata |
| Label kecil & header tabel | Plex Sans, 11px, uppercase, letter-spacing 0.06em | Gaya kop gambar teknik |

Ukuran dasar 13–14px. Hierarki dibangun dari bobot dan warna, bukan dari judul raksasa.

### 13.5 Agar tidak terlihat "dibuat AI"

Daftar ini dipakai sebagai checklist review desain:

**Hindari**
- Gradien ungu–biru–pink, blob berpendar, dan orb 3D dekoratif.
- Ikon emoji atau ilustrasi 3D "clay" berwarna pastel.
- Hero section dengan kalimat pemasaran seperti "Revolutionize your…" di dalam aplikasi kerja.
- Grid kartu seragam berisi satu angka besar + ikon + teks "↑ 12% from last week" di setiap kartu.
- Semua sudut sangat membulat, semua elemen diberi bayangan.
- Teks placeholder yang generik ("Lorem ipsum", "Sensor A", "Project Alpha").
- Animasi berlebihan (fade-in setiap kartu, angka yang berputar naik).

**Lakukan**
- Pakai istilah lapangan yang benar: STA, SP-12, PZ-03, INC-07, elevasi +3.450, "zero reading", "tahap timbunan 4".
- Tampilkan metadata kecil yang hanya dipedulikan engineer: waktu pembacaan terakhir, siapa yang membaca, faktor kalibrasi, versi algoritma.
- Gunakan elemen khas gambar teknik: skala grafis, panah utara, kop berisi nomor revisi, garis dimensi pada penampang.
- Grafik dengan grid, sumbu berlabel lengkap, dan anotasi tahap timbunan sebagai garis vertikal bernomor.
- Layout asimetris sesuai kebutuhan: panel analisis lebar, panel parameter sempit.
- Ikon garis sederhana 1.5px (Lucide/Phosphor) dengan beberapa ikon kustom untuk tipe instrumen.
- Micro-interaction hanya fungsional: hover crosshair pada grafik, highlight instrumen saat baris tabel di-hover.

### 13.6 Komponen kunci

- **Status strip** di atas: nama proyek, zona aktif, waktu data terbaru, jumlah alarm per level, jam lokal (WIB/WITA/WIT sesuai proyek).
- **Instrument chip**: kode + tipe + titik status berwarna + usia data ("2 j lalu").
- **Crosshair chart**: pembacaan nilai di semua seri pada waktu yang sama.
- **Parameter panel**: input numerik dengan satuan menempel di kanan, nilai default desain ditampilkan samar sebagai pembanding.
- **Timeline tahap timbunan**: bar horizontal rencana vs aktual.

---

## 14. Layar Utama

| # | Layar | Isi utama |
|---|---|---|
| 1 | **Overview proyek** | Peta zona berwarna status keputusan, status strip, tabel zona ringkas, alarm aktif |
| 2 | **Digital Twin** | Viewer 3D layar penuh, panel glass: mode tampilan, time slider, legenda, daftar instrumen; tombol irisan penampang |
| 3 | **Zona** | Timeline tahap timbunan, tabel instrumen, grafik gabungan penurunan–tinggi timbunan, ringkasan prediksi |
| 4 | **Instrumen** | Grafik time-series, tabel pembacaan, metadata & kalibrasi, riwayat alarm |
| 5 | **Workspace analisis** | Pilih metode (Asaoka/hiperbolik/teoretis/back-analysis), grafik interaktif dengan brush, tabel hasil, simpan snapshot |
| 6 | **Input data** | Form cepat per rute survei (urutan instrumen sesuai jalur jalan di lapangan), import CSV |
| 7 | **Alarm** | Daftar, filter level/zona, acknowledge dengan catatan |
| 8 | **Laporan** | Pilih periode & template, pratinjau, ekspor PDF |
| 9 | **Telemetri** | Peta perangkat, status baterai & sinyal, alarm teknis, pemetaan kanal, pembanding manual vs telemetri, log pemeliharaan |
| 10 | **Profil memanjang (jalan)** | Strip status STA, profil elevasi rencana vs aktual vs prediksi, zona oprit |
| 11 | **Pengaturan** | Pengguna, role, ambang alarm, parameter tanah, CRS |

---

## 15. Alur Pengguna Utama

**A0. Data telemetri masuk otomatis**
1. Logger membaca sensor sesuai jadwal dan mengirim ke gateway → STESY GEO.
2. STESY GEO mengonversi, mengoreksi (suhu, barometrik, tangki referensi), dan menyimpan data.
3. Analisis dan evaluasi alarm berjalan otomatis; engineer melihat hasil terbaru setiap pagi tanpa menunggu input.
4. Jika logger offline atau baterai lemah, teknisi telemetri menerima alarm teknis.

**A. Surveyor memasukkan pembacaan kontrol manual**
1. Buka "Input data" → pilih rute "Zona 3 – sisi kiri".
2. Form menampilkan instrumen berurutan beserta pembacaan sebelumnya.
3. Nilai yang menyimpang ditandai kuning saat diketik; surveyor dapat menambahkan catatan.
4. Simpan → analisis otomatis berjalan di latar; alarm dievaluasi.

**B. Engineer memutuskan tahap timbunan berikutnya**
1. Buka zona → lihat U gabungan saat ini (mis. 84%) dan status "Tahan".
2. Buka Workspace analisis → cek Asaoka & hiperbolik untuk 4 settlement plate; bandingkan.
3. Buka Digital Twin → irisan di STA tengah zona; cek kontur tekanan air pori & inklinometer.
4. Jalankan skenario: naikkan timbunan 1,0 m pada tanggal X → lihat indikasi stabilitas.
5. Simpan snapshot analisis dan buat rekomendasi tertulis yang tertaut ke snapshot.

**C. Alarm stabilitas di malam hari**
1. Laju deformasi lateral INC-07 melewati ambang Siaga → notifikasi ke engineer on-call.
2. Engineer membuka tautan → langsung ke profil inklinometer dengan perbandingan tiga pembacaan terakhir.
3. Engineer mengonfirmasi alarm dengan catatan tindakan (mis. hentikan penimbunan zona 3).

---

## 16. Metrik Keberhasilan

| Metrik | Baseline (estimasi) | Target 6 bulan |
|---|---|---|
| Jeda pembacaan → analisis tersedia | 3–7 hari | < 1 jam (manual), < 5 menit (logger) |
| Waktu menyusun laporan mingguan | 8–16 jam | < 1 jam |
| Instrumen dengan data terlambat | tidak terukur | < 5% |
| Kelengkapan data telemetri | — | ≥ 95% |
| Porsi instrumen yang sudah telemetri (di zona aktif) | 0% | ≥ 80% |
| Alarm stabilitas yang dikonfirmasi < 2 jam | tidak terukur | > 90% |
| Selisih prediksi penurunan akhir (Asaoka) vs aktual saat U > 90% | — | ≤ 10% |
| Pengguna aktif mingguan / pengguna terdaftar | — | > 70% |

---

## 17. Rencana Rilis

| Fase | Durasi | Cakupan |
|---|---|---|
| **0 — Discovery** | 3 minggu | Wawancara pengguna di 2 proyek, audit format data eksisting, validasi rumus dengan geotechnical lead, **pemilihan vendor telemetri & permintaan penawaran untuk segmen jalan pilot** |
| **1 — MVP** | 12 minggu | Proyek/zona, modul jalan dasar (STA, profil memanjang, strip status), instrumen, input manual & CSV, **ingestion telemetri untuk vendor pilot, kesehatan perangkat, pembanding manual vs telemetri**, dashboard, Asaoka, hiperbolik, teoretis, alarm dasar, twin 3D (geometri + pewarnaan penurunan + time slider histori), laporan PDF |
| **2 — Otomasi** | 8 minggu | Adapter vendor tambahan, back-analysis, timbunan kompensasi & modul oprit, Matsuo–Kawamura, notifikasi WA/Telegram, twin: irisan penampang lengkap & kontur tekanan pori |
| **3 — Simulasi** | 8 minggu | What-if skenario penimbunan, kalibrasi berkelanjutan, indikator keyakinan spasial |
| **4 — Integrasi** | berkelanjutan | Import IFC/LandXML, SSO, mode offline, API publik |

---

## 18. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kualitas data lapangan buruk (salah zero reading, instrumen rusak) | Prediksi menyesatkan | Validasi saat input, flag data, fitur penyambungan seri, dan penanda tingkat keyakinan |
| Engineer tidak percaya hasil otomatis | Adopsi rendah | Semua analisis transparan & dapat diubah; tampilkan input, rentang data, R², versi algoritma |
| Viewer 3D berat di laptop lapangan | Pengalaman buruk | Level of detail, mode 2D ringan, batasi resolusi grid |
| Sensor/kabel rusak oleh alat berat | Data hilang, biaya penggantian | Conduit tertanam, penandaan di lapangan, koordinasi gambar kerja dengan kontraktor, cadangan pembacaan manual |
| Pencurian/vandalisme panel surya & logger | Jaringan terputus | Tiang tinggi, box terkunci, lokasi dekat pos jaga, alarm offline cepat |
| Tangki referensi / base GNSS ikut bergerak | Seluruh data penurunan bias | Tempatkan di luar zona pengaruh, cek survei bulanan (F-TLM-07) |
| Ketergantungan pada satu vendor telemetri | Biaya & fleksibilitas | Arsitektur adapter, syarat API terbuka di spesifikasi pengadaan |
| Perangkat radio belum bersertifikat SDPPI | Tertunda saat pengadaan/inspeksi | Wajibkan bukti sertifikat dalam dokumen penawaran |
| Konektivitas buruk di lokasi | Data tidak masuk | Input offline (fase 4), antrean sinkron di logger |
| Ambang alarm tidak cocok per proyek | Alarm palsu / terlewat | Ambang dapat dikonfigurasi, masa kalibrasi 2 minggu pertama tanpa notifikasi eksternal |
| Model analitis disalahartikan sebagai FEM | Keputusan keliru | Label metode eksplisit di twin dan laporan |

---

## 19. Pertanyaan Terbuka

1. Proyek pilot mana yang akan dipakai, dan format data apa yang saat ini mereka gunakan?
2. Merek sensor dan logger apa yang sudah ada di proyek sasaran, dan apakah instrumen VW yang sudah terpasang bisa langsung disambung ke logger telemetri?
3. Segmen jalan mana yang dipakai sebagai pilot, dan apakah dokumen desain (stratigrafi, parameter tanah, gambar instrumentasi, spesifikasi penurunan sisa) sudah tersedia?
4. Apakah biaya pengadaan telemetri masuk anggaran kontraktor, konsultan, atau owner?
5. Bagaimana cakupan sinyal 4G di lokasi pilot (perlu VSAT atau tidak)?
6. Apakah owner mensyaratkan deployment on-premise?
7. Standar ambang alarm mana yang dipakai sebagai default (spesifikasi owner, pedoman Kementerian PU, atau rekomendasi konsultan)?
8. Apakah vacuum consolidation perlu didukung sejak MVP (membutuhkan sensor tekanan vakum dan model beban yang berbeda)?
9. Siapa yang berwenang final menyetujui status "Siap bongkar surcharge" di dalam sistem?

---

## 20. Glosarium

| Istilah | Arti |
|---|---|
| Konsolidasi | Proses berkurangnya volume tanah jenuh akibat keluarnya air pori di bawah beban |
| PVD | Prefabricated Vertical Drain; drainase vertikal untuk mempercepat konsolidasi |
| Preloading / surcharge | Beban timbunan sementara (melebihi beban rencana) untuk mempercepat penurunan |
| Settlement plate | Pelat di dasar timbunan dengan batang yang diukur elevasinya |
| Piezometer | Sensor tekanan air pori |
| Inklinometer | Pipa dan probe untuk mengukur deformasi lateral terhadap kedalaman |
| c_v, c_h | Koefisien konsolidasi arah vertikal dan horizontal |
| U | Derajat konsolidasi (%) |
| Smear zone | Zona tanah terganggu di sekitar PVD akibat pemasangan mandrel |
| STA | Stationing; penanda jarak sepanjang trase |
| Telemetri | Pengambilan dan pengiriman data pengukuran secara otomatis dari lapangan ke server |
| Vibrating wire (VW) | Prinsip sensor yang mengukur frekuensi getar kawat tegang; stabil untuk jangka panjang dan umum pada instrumen geoteknik |
| Data logger | Perangkat di lapangan yang membaca sensor terjadwal, menyimpan, dan mengirim data |
| Gateway | Perangkat yang mengumpulkan data dari banyak logger dan meneruskannya ke internet |
| LoRa | Teknologi radio jarak jauh berdaya rendah untuk logger nirkabel |
| GNSS | Sistem navigasi satelit (GPS, GLONASS, Galileo, BeiDou); dengan pengolahan diferensial bisa mencapai presisi milimeter |
| ShapeArray / IPI | Rangkaian sensor kemiringan permanen untuk profil deformasi otomatis |
| Oprit | Timbunan pendekat jembatan; zona rawan penurunan diferensial |
| Timbunan kompensasi | Timbunan tambahan untuk mengembalikan elevasi rencana setelah penurunan |
| Digital twin | Representasi digital yang terhubung dengan data lapangan dan model perilaku, dapat dipakai untuk menganalisis serta memproyeksikan kondisi |
