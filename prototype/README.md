# STESY GEO — Prototipe Frontend (data dummy)

Ini prototipe tampilan STESY GEO yang berjalan sepenuhnya di browser, tanpa backend dan tanpa database. Tampilan dan fitur halamannya sama dengan aplikasi di folder `../web`, tetapi semua data diambil dari file JSON dummy di `public/data/`. Hasil build berupa situs statis, jadi cukup diunggah ke VPS dan disajikan oleh nginx.

Perilaku prototipe:
- **Login** dengan salah satu akun demo (`geotek@`, `surveyor@`, `teknisi@`, `pengawas@`, `admin@stesygeo.local`) tanpa kata sandi. Role mengikuti akun yang dipilih.
- **Waktu** di data dummy digeser otomatis saat halaman dibuka, sehingga "data terbaru" selalu tampil beberapa menit lalu dan grafik selalu berakhir di hari ini.
- **Analisis Asaoka/hiperbolik** dihitung ulang di browser saat Δt atau rentang brush diubah.
- **Perubahan** seperti input manual, konfirmasi alarm, snapshot, dan log pemeliharaan hanya disimpan di memori, lalu hilang saat halaman dimuat ulang.
- **Skenario what-if dan back-analysis** memakai hasil contoh tetap.
- **Laporan dan ekspor CSV** berupa file contoh statis.
- **Tanpa data live:** tidak ada koneksi MQTT maupun pembaruan real-time.

## Build & uji lokal

```bash
npm install
npm run build      # hasil di dist/
npm run preview    # buka http://localhost:4173
```

## Pasang di VPS

1. Buat paket di komputer lokal:
   ```bash
   npm run pack       # → stesygeo-prototype.tar.gz (isi dist/, ±3 MB)
   ```
2. Unggah dan ekstrak di VPS:
   ```bash
   scp stesygeo-prototype.tar.gz user@IP-VPS:/tmp/
   ssh user@IP-VPS
   sudo mkdir -p /var/www/stesygeo && sudo tar -xzf /tmp/stesygeo-prototype.tar.gz -C /var/www/stesygeo
   ```
3. Konfigurasi nginx: salin `deploy/nginx-stesygeo.conf` ke `/etc/nginx/sites-available/stesygeo` dan ganti `server_name`. Lalu:
   ```bash
   sudo ln -s /etc/nginx/sites-available/stesygeo /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d stesygeo.domain-anda.id   # opsional, HTTPS
   ```

Konfigurasi nginx memuat `try_files … /index.html`. Tanpa baris itu, membuka langsung URL seperti `/twin` atau `/zona/3` akan menghasilkan 404.

**Dipasang di subfolder** (misalnya `https://domain.id/stesygeo/`): build dengan `BASE_PATH=/stesygeo/ npm run build`, ekstrak ke `/var/www/html/stesygeo`, lalu di nginx pakai `location /stesygeo/ { try_files $uri $uri/ /stesygeo/index.html; }`.

## Memperbarui data dummy

Data dummy diambil dari aplikasi STESY GEO lengkap yang sedang berjalan (folder `../server`). Server itu harus aktif di port 8080 saat perintah ini dijalankan:

```bash
npm run data -- http://localhost:8080 admin@stesygeo.local stesygeo2026
npm run pack
```

## Struktur

```
public/data/        data dummy (JSON, HTML laporan, CSV)
src/mock/           API tiruan + rumus Asaoka/hiperbolik untuk hitung ulang di browser
src/                halaman & komponen (salinan dari ../web, dengan api.ts diarahkan ke src/mock)
tools/              skrip pengambil data dummy
deploy/             konfigurasi nginx
```

Peta satelit/topografi memuat tile dari Esri dan OpenStreetMap, sehingga browser pengguna butuh akses internet. Font diambil dari Google Fonts.
