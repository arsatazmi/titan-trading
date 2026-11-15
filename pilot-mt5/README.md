# Titan — penghubung HFM MT5 demo (eksperimental)

**Hanya untuk akun DEMO HFM MT5 hedging.** Akun real dan netting diblokir. Perintah dari web baru dapat membuat order setelah flag lokal diberikan dan tombol Start demo ditekan. Jalur strategi otomatis web → MT5 **belum diuji end-to-end pada broker**. Satu order BTC demo terpisah pernah dibuka dan ditutup; itu bukan bukti strategi web bekerja. Hasil, profit, penutupan dan batas rugi tidak dijamin.

Portal demo ini belum diaudit dan memiliki akun admin demo lemah/terbuka. Jangan gunakan untuk trading nyata, pembayaran, kredensial broker, atau data sensitif. Jangan bagikan ID/kunci perangkat, nomor akun, atau password broker di chat. Reset data demo di website akan memutus pairing.

## Memperbarui penghubung yang sudah ada

1. Pastikan MT5 login ke akun **demo HFM hedging**, dan periksa tab Trade serta History untuk order yang belum pasti. Stop semua proses bot lain, lalu di PowerShell lama tekan `Ctrl+C`. Stop tidak menutup posisi yang sudah ada.
2. Ekstrak ZIP pembaruan, lalu salin **hanya file program dan README** ke folder penghubung lama. Pertahankan `bridge-device.json`, `bot-state.sqlite3`, `.venv`, file lock, dan seluruh data pribadi. Jangan hapus state/lock untuk mengatasi hasil order yang tidak pasti.
3. Di folder penghubung, uji dependensi secara offline:

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_bridge test_bot test_btc test_hfm_demo_clock test_hfm_clock_research test_shadow_daily_risk
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

- Pilih **XAUUSD** atau **#BTCUSD**, lalu klik **Start demo**. Server hanya menerima bridge protokol 3 terbaru dan quote yang terbaca valid. Tetap buka panel, laptop dan MT5; izin berjalan diperbarui tiap beberapa detik dan habis sekitar 35 detik setelah sambungan terputus. Siklus yang sedang berjalan masih dapat selesai setelah Stop atau lease kedaluwarsa. Stop tidak otomatis menutup posisi; periksa tab Trade MT5.
- Hanya satu simbol dalam satu waktu. Jika posisi bot pada simbol lain masih terbuka, perpindahan diblokir. Sinyal BTC memakai ORB BUY sesi New York yang sama dengan XAUUSD, **bukan** strategi 24 jam; bot bisa menunggu lama dan mungkin tidak membuka order. Tidak ada filter berita. Awal rentang 09:30 NY, sesudah 15 menit menunggu breakout candle M5; jendela hingga 15:30 NY.
- Eksperimen target 0,5% per order, 1% risiko gabungan/rugi harian dan maksimal 20 posisi. Ini estimasi, **bukan batas kerugian**. Spread, komisi, gap, slippage, posisi manual, gangguan jaringan, hasil order tidak pasti, atau penolakan broker bisa mengubah hasil. TP disetel sekitar 2R; penutupan profit tidak dijamin.
- Saat hasil order tidak pasti, bot menyimpan intent dan memblokir order baru. Jangan hapus `bot-state.sqlite3` atau lock tanpa memeriksa posisi serta riwayat MT5. Tidak ada distributed lock untuk laptop lain: jangan jalankan bridge lain pada akun yang sama.

## Waktu server HFM

Sampel pada 15 November 2026 menunjukkan waktu tick, candle dan transaksi sekitar dua jam di depan UTC. Bridge ini memakai model kandidat waktu server HFM GMT+2 musim dingin/GMT+3 musim panas, bukan offset +2 tetap; model memblokir siklus bila data/quote tidak konsisten atau dekat perubahan DST yang diperkirakan. Jam perubahan broker dan kelengkapan riwayat belum dibuktikan untuk seluruh musim. Jam laptop harus benar. Perhitungan rugi memakai hari New York dan dua pembacaan riwayat; transaksi penyesuaian saldo atau credit membuat proses berhenti. Ini tetap tidak menjamin perhitungan sempurna.

Ide opening-range diadaptasi secara eksperimental dari `trader-entry` pada https://github.com/Jakeschincariol/day-trader-skill (MIT); proyek itu bukan konektor HFM dan tidak memvalidasi strategi ini.
