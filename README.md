# Adaptasi Vercel + Supabase

Lihat [DEPLOY.md](DEPLOY.md) untuk status, batasan, dan langkah deploy.
Source tetap demo; dokumentasi lokal di bawah masih berlaku tanpa environment Supabase.

# TitanTrading — Portal Demo (Klien + Admin)

Portal langganan & kontrol bot **simulasi** dengan gaya fitur portal trading berlangganan:
daftar/masuk → pilih paket → konfirmasi pembayaran manual → admin menyetujui →
tambah akun broker demo → start/stop bot simulasi.

> **Mode demo penuh.** Tidak ada trading nyata, tidak ada pembayaran nyata,
> tidak ada koneksi MT4/MT5. Jangan masukkan password broker asli — hanya ID demo.

## Jalankan

```bash
cd titantrading
node server.mjs          # http://localhost:3000
```

Tidak perlu `npm install` — hanya memakai Node.js bawaan (>= 20).

## Akun demo bawaan

| Role | Email | Password |
|---|---|---|
| Admin | `admin@titantrading.demo` | `TitanAdmin!2026` |
| Klien (Pro aktif) | `client@titantrading.demo` | `TitanClient!2026` |
| Klien (menunggu bayar) | `pending@titantrading.demo` | `TitanPending!2026` |

Halaman: `/` (beranda + login/daftar + paket), `/app` (dashboard klien), `/admin` (panel admin).

## Uji otomatis

```bash
npm run smoke
```

Menjalankan server di port acak dengan database sementara dan memeriksa:
login, RBAC admin, CSRF, batas akun per paket, blokir bot saat langganan nonaktif,
alur pembayaran → persetujuan admin → bot bisa jalan, registrasi, dan halaman statis.

## Fitur

- **Klien:** profil, status langganan, konfirmasi pembayaran manual (4 metode demo),
  CRUD akun broker demo (MT4/MT5, tanpa kolom password), start/stop bot simulasi
  dengan equity/PnL demo, riwayat pembayaran, log aktivitas.
- **Admin:** statistik, antrian pembayaran (setujui/tolak + alasan), aktivasi/nonaktifkan
  langganan, suspend/aktifkan pengguna, ubah harga & batas akun paket, log global,
  reset data demo.
- **Keamanan:** password di-hash (scrypt), sesi cookie HttpOnly + token CSRF,
  batas percobaan login, batas akun ditegakkan di server, bot otomatis berhenti
  saat langganan kedaluwarsa/dinonaktifkan, semua aksi tercatat di log.

## Struktur

```
server.mjs          API + static server (tanpa dependensi)
lib/store.mjs       Penyimpanan JSON + logika domain (paket, langganan, simulasi)
public/             index.html, app.html, admin.html, styles.css, shared.js
scripts/smoke.mjs   Uji end-to-end
data/               db.json + .secret (dibuat otomatis saat pertama jalan)
```

## Menuju versi produksi

1. Ganti penyimpanan JSON dengan database nyata (mis. Supabase/Postgres) + migrasi.
2. Tambah rate-limit persisten, email verifikasi, dan audit log terpisah.
3. Untuk trading nyata: worker MT5 terpisah dengan kredensial terenkripsi
   (mis. KMS/vault) — jangan simpan password broker sebagai teks biasa.
4. Tambahkan pembayaran otomatis (payment gateway) bila diperlukan.
