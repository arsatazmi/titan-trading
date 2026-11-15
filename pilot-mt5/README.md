# Titan — penghubung laptop MT5 demo (eksperimental)

Penghubung ini BARU dan belum diuji end-to-end pada terminal HFM. Satu tes order BTC demo terpisah telah dibuka dan ditutup, namun tes bot/website yang tersedia masih memakai mock, bukan broker nyata. **Jangan aktifkan order sebelum uji koneksi read-only bersama saat pasar tersedia.** Akun real diblokir, bot hanya untuk HFM MT5 demo hedging. Pilih XAUUSD atau #BTCUSD dari panel admin, satu simbol dalam satu waktu. MT4 belum tersedia. Tidak ada analisis berita, tidak ada jaminan profit atau batas rugi.

Portal masih portal demo yang admin bawaannya bisa diakses publik. Kunci perangkat ini melindungi perintah perangkat secara terpisah, tetapi sistem keseluruhan belum diaudit dan tidak aman untuk data atau trading nyata. Jaga kerahasiaan kunci; jangan kirimkan kunci, nomor akun, atau password broker ke chat. Jangan gunakan di komputer/terminal berisi informasi sensitif. Reset data demo pada web akan memutus pairing perangkat.

## 1. Persiapan laptop Windows
- Pastikan MT5 HFM sudah login manual ke akun DEMO hedging, tersambung dan simbol XAUUSD tersedia di Market Watch. Jangan masukkan password broker ke aplikasi ini.
- Ekstrak ZIP ke folder tetap, buka PowerShell di dalam folder itu. Jika Python tersedia sebagai `py`, jalankan:

```
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest -v test_bridge test_bot test_btc
.\.venv\Scripts\python.exe bridge.py --setup
```

Perintah terakhir membuat file rahasia `bridge-device.json` dan menampilkan ID serta kunci perangkat. Simpan file itu secara privat, jangan unggah/berikan kepada siapa pun. Jika ingin melihat lagi pada laptop: `.\.venv\Scripts\python.exe bridge.py --show-device`.

## 2. Sambungkan ke website dalam mode read-only
1. Login admin di https://titan-trading-puce.vercel.app/admin.
2. Di bagian **Hubungkan laptop MT5 demo**, ketik ID dan kunci perangkat dari laptop lalu klik **Hubungkan**. Kunci hanya disimpan sementara di form browser.
3. Jalankan di PowerShell:

```
.\.venv\Scripts\python.exe bridge.py
```

Program ini default **read-only** dan tidak menerima izin order. Tunggu sekitar 10–30 detik lalu lihat status laptop di panel. Saldo, equity, jumlah posisi, dan status demo dapat dikirim ke web; password dan nomor login broker tidak dikirim. Status bukan feed tick realtime dan dapat terlambat. Buka PowerShell dan MT5 terus-menerus; Ctrl+C berhenti.

## 3. Kontrol order (jangan jalankan sebelum pengujian HFM)
Program hanya dapat memproses perintah order setelah pengguna memulai ulang dengan flag lokal `--enable-demo-trading`, lalu menekan **Start demo** di panel admin. Flag ini dapat membuka dan menutup order otomatis pada akun demo yang sedang aktif. **Prototipe ini belum diuji dengan HFM; jangan aktifkan sekarang.** Start memerlukan halaman panel terbuka: jika tidak diperbarui atau sambungan hilang, izin siklus baru kedaluwarsa setelah sekitar 35 detik, ditambah waktu pemeriksaan sampai 10 detik. Siklus yang sudah berjalan bisa selesai lebih lambat. Stop tidak membatalkan order yang sudah terkirim dan tidak menutup posisi yang sudah terbuka. Periksa MT5 secara langsung.

Bot adalah eksperimen ORB buy-only XAUUSD pada sesi New York, bukan strategi teruji, tidak memakai berita, dan mungkin tidak membuka order saat syarat belum terpenuhi. Estimasi 0,5% per order, 1% risiko gabungan/rugi harian, dan maksimal 20 posisi bukan jaminan. Slippage, spread, gap, komisi, disconnect, order yang ditolak, serta order manual dapat menyebabkan rugi lebih besar. Penutupan pada profit tidak dijamin.

Jalankan satu proses saja untuk satu akun di satu laptop. File `bot-state.sqlite3` menyimpan identitas akun yang di-hash dan status intent untuk mencegah order rangkap. Jangan hapus state. Jika muncul hasil order tidak pasti atau lock, hentikan dan periksa riwayat MT5 sebelum bertindak. Jika berganti akun demo, program memblokir; jangan menghapus state tanpa rekonsiliasi. Tidak ada distributed lock untuk beberapa laptop.

Ide opening-range diadaptasi secara eksperimental dari skill `trader-entry` pada https://github.com/Jakeschincariol/day-trader-skill (MIT); proyek tersebut bukan konektor HFM dan tidak memvalidasi strategi ini.

## Memperbarui penghubung yang sudah terpasang
1. Hentikan proses lama dengan Ctrl+C dan pastikan tidak ada bot lain berjalan.
2. Ekstrak ZIP pembaruan lalu salin file program ke folder penghubung lama. Jangan hapus atau mengganti `bridge-device.json`, `bot-state.sqlite3`, `.venv`, atau file lock tanpa pemeriksaan. ZIP baru tidak berisi file pribadi tersebut.
3. Jalankan lagi `bridge.py` tanpa flag untuk read-only, lalu pasangkan seperti biasa dengan ID dan kunci yang sama.
4. Pilot BTC memakai ORB New York yang sama dengan emas, bukan strategi BTC 24/7. Aktifkan satu simbol saja. Jika posisi bot pada simbol lain masih terbuka, pergantian simbol diblokir; periksa dan tutup secara manual sebelum beralih. Stop tidak menutup posisi.

PENTING: Pada pengujian pengguna, waktu tick dan candle HFM tampak sekitar dua jam di depan UTC. Penghubung ini belum mengoreksi perbedaan itu; ia tetap memblokir quote yang dianggap tidak valid. Tes order otomatis BTC melalui website dan strategi belum dilakukan. Jangan mengaktifkan order sebelum semantik waktu, termasuk riwayat, sudah diverifikasi dan diuji.

Server yang menyertai paket ini memblokir perintah order dari website untuk kedua simbol sampai alur waktu dan batas rugi diuji. Mengganti ZIP saja tidak menambahkan blokir ke website yang masih memakai versi server lama. Mode read-only tetap dapat dijalankan.
