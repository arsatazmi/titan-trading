# Titan — penghubung HFM MT5 demo (eksperimental)

**Hanya untuk akun DEMO HFM MT5 hedging.** Akun real dan netting diblokir. Perintah dari web baru dapat membuat order setelah flag lokal diberikan dan tombol Start demo ditekan. Jalur strategi otomatis web → MT5 **belum diuji end-to-end pada broker**. Satu order BTC demo terpisah pernah dibuka dan ditutup; itu bukan bukti strategi web bekerja. Hasil, profit, penutupan dan batas rugi tidak dijamin.

Portal demo ini belum diaudit dan memiliki akun admin demo lemah/terbuka. Jangan gunakan untuk trading nyata, pembayaran, kredensial broker, atau data sensitif. Jangan bagikan ID/kunci perangkat, nomor akun, atau password broker di chat. Reset data demo di website akan memutus pairing.

## Memperbarui penghubung yang sudah ada

1. Pastikan MT5 login ke akun **demo HFM hedging**, dan periksa tab Trade serta History untuk order yang belum pasti. Stop semua proses bot lain, lalu di PowerShell lama tekan `Ctrl+C`. Stop tidak menutup posisi yang sudah ada.
2. Ekstrak ZIP pembaruan, lalu salin **hanya file program dan README** ke folder penghubung lama. Pertahankan `bridge-device.json`, `bot-state.sqlite3`, `.venv`, file lock, dan seluruh data pribadi. Jangan hapus state/lock untuk mengatasi hasil order yang tidak pasti.
3. Di folder penghubung, uji dependensi secara offline:

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_bridge test_bot test_btc test_btc_rolling test_hfm_demo_clock test_hfm_clock_research test_shadow_daily_risk
```

4. Jalankan mode pantau read-only:

```powershell
.\.venv\Scripts\python.exe bridge.py
```

Login di https://titan-trading-puce.vercel.app/admin dan hubungkan ID/kunci perangkat lama. Untuk melihat kembali di laptop: ` .\.venv\Scripts\python.exe bridge.py --show-device`. Jangan kirim hasilnya ke chat. Status laptop dapat mengirim saldo/equity dan jumlah posisi ke web, tanpa nomor akun atau password broker. Status bukan feed realtime penuh.

## Menjalankan demo (eksperimental)

- Tutup semua EA/bot lain dan pastikan tidak ada proses bridge lain. Di MT5 demo, Algo Trading dan izin akun harus aktif; menyalakannya juga bisa mengaktifkan EA lain, jadi cek terlebih dahulu.
- Hentikan proses read-only dengan `Ctrl+C`, lalu jalankan:

```powershell
.\.venv\Scripts\python.exe bridge.py --enable-demo-trading
```

- Pilih **XAUUSD** atau **#BTCUSD**, lalu klik **Start demo**. Untuk BTC server memerlukan bridge protokol 4; XAUUSD minimal protokol 3. Quote harus terbaca valid. Tetap buka panel, laptop dan MT5; izin berjalan diperbarui tiap beberapa detik dan habis sekitar 35 detik setelah sambungan terputus. Siklus yang sedang berjalan masih dapat selesai setelah Stop atau lease kedaluwarsa. Stop tidak otomatis menutup posisi; periksa tab Trade MT5.
- Hanya satu simbol dalam satu waktu. Jika posisi bot pada simbol lain masih terbuka, perpindahan diblokir. BTC: setiap candle M5 yang sudah tutup dibandingkan dengan high/low 12 candle M5 sebelumnya (1 jam); BUY hanya bila close di atas high dan sinyal berumur maksimal 60 detik. Tidak ada batas sesi NY dan tidak ada filter berita; ketersediaan bergantung broker. Maksimal satu posisi BTC milik bot pada satu waktu. Candle kurang/lonjakan waktu membuat order diblokir. Emas tetap menggunakan ORB 09:30–09:45 NY, jendela hingga 15:30 NY.
- Eksperimen target 0,5% per order, 1% risiko gabungan/rugi harian dan maksimal 20 posisi. Ini estimasi, **bukan batas kerugian**. Spread, komisi, gap, slippage, posisi manual, gangguan jaringan, hasil order tidak pasti, atau penolakan broker bisa mengubah hasil. SL memakai titik tengah rentang dan TP disetel sekitar 2R, tetapi logika lama juga dapat menutup posisi bot lebih awal bila estimasi profit bersih positif; penutupan profit tidak dijamin.
- Saat hasil order tidak pasti, bot menyimpan intent dan memblokir order baru. Jangan hapus `bot-state.sqlite3` atau lock tanpa memeriksa posisi serta riwayat MT5. Tidak ada distributed lock untuk laptop lain: jangan jalankan bridge lain pada akun yang sama.

## Waktu server HFM

Sampel pada 15 November 2026 menunjukkan waktu tick, candle dan transaksi sekitar dua jam di depan UTC. Bridge ini memakai model kandidat waktu server HFM GMT+2 musim dingin/GMT+3 musim panas, bukan offset +2 tetap; model memblokir siklus bila data/quote tidak konsisten atau dekat perubahan DST yang diperkirakan. Jam perubahan broker dan kelengkapan riwayat belum dibuktikan untuk seluruh musim. Jam laptop harus benar. Perhitungan rugi memakai hari New York dan dua pembacaan riwayat; transaksi penyesuaian saldo atau credit membuat proses berhenti. Ini tetap tidak menjamin perhitungan sempurna.

Sinyal BTC adalah adaptasi rolling-range terpisah, bukan entry upstream saham. BTC memakai kalkulasi midpoint/2R dan validasi minimum jarak stop dari `trader-exit` upstream (berbasis pembulatan sen), lalu disesuaikan dengan tick dan ukuran lot MT5. Risk check dan sizing upstream saham tidak dipakai; pengaman HFM di bot ini adalah adaptasi. Sumber https://github.com/Jakeschincariol/day-trader-skill (MIT); lisensi di `DAY_TRADER_SKILL_LICENSE.txt`. Proyek upstream bukan konektor HFM dan tidak memvalidasi strategi ini.
