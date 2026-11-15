# Titan Vault — Account Portal

Portal akun satu halaman dengan autentikasi sungguhan, paket langganan USD, konfirmasi
pembayaran, akun broker MT4/MT5, dan dashboard master. Data tersimpan di Supabase
(Postgres + Supabase Auth); tidak ada data contoh, tidak ada simulasi.

**Produksi:** https://titan-trading-puce.vercel.app
**Master dashboard:** https://titan-trading-puce.vercel.app/admin

## Fitur

| Bagian | Perilaku |
| --- | --- |
| Auth | Daftar / masuk dengan **email atau username** + password melalui Supabase Auth. Username tanpa `@` (mis. `starboy`) dipetakan ke identitas internal `starboy@titanvault.local`. Sesi disimpan dalam cookie `HttpOnly`, `SameSite=Lax`, `Secure` di produksi, dengan refresh-token rotation. |
| Paket | PRO $50 (1 akun), BRONZE $100 (3 akun), PLATINUM $250 (unlimited). |
| Pembayaran | MTN Mobile Money `0788087502` / Nakasiita Shakirah, Airtel Money `0743453912` / Nakalema Sumayah, Binance USDT TRC20 `TBghDNeXQ6sh6g3moaFvt5cPDx2DUEqtYz`, WhatsApp `https://wa.me/256743453912`. |
| Bukti bayar | Klien mengirim metode, identitas pengirim, nama kontak, dan TID. Status masuk `pending` sampai disetujui master. |
| Akun broker | Tambah / ubah / hapus akun MT4/MT5 (nama, broker, server, login, password, catatan). Password broker dienkripsi AES-256-GCM di database dan hanya didekripsi untuk pemiliknya. |
| Start / Stop bot | Perintah disimpan sebagai data nyata dan dicatat di audit log. Kontrol terkunci bila status langganan bukan `active`. |
| Master | `/admin` untuk mengubah paket/status, menyetujui/menolak pembayaran, melihat feed perintah bot dan audit log. Akses hanya untuk email di `ADMIN_EMAILS`. |

## Struktur

```
public/index.html          Portal (auth + akun + paket + pembayaran)
public/backend.js          Bridge API: Supabase Auth/Postgres, bukan Firebase pihak ketiga
public/admin.html          Master dashboard
public/auth-callback.html  Penukaran token OAuth
server.mjs                 API + penyaji statis (dipakai lokal dan di Vercel)
api/index.js               Vercel function untuk /api
api/[path].js             Vercel function untuk /api/:name (semua endpoint flat)
supabase/schema.sql        Skema produksi (titan_vault_users, titan_vault_events)
scripts/smoke.mjs          Uji rute statis, config, dan proteksi API
vercel.json                Konfigurasi Vercel
```

## Variabel lingkungan

| Nama | Keterangan |
| --- | --- |
| `SUPABASE_URL` | `https://zwiatrbdvetqcjivqomo.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Kunci service role — hanya sisi server, jangan pernah dikirim ke browser |
| `SUPABASE_ANON_KEY` | Kunci anon untuk endpoint token Supabase Auth |
| `ADMIN_EMAILS` | Daftar owner/master dipisah koma (`arsatazmi12@gmail.com`, `starboy@titanvault.local`). Flag `titan_vault_users.is_admin` di database juga dihormati sebagai owner. |
| `GOOGLE_OAUTH_ENABLED` | `false` sampai provider Google diaktifkan di Supabase Auth |

Salin `.env.example` ke `.env` untuk menjalankan lokal, lalu:

```bash
npm run smoke   # uji dasar
npm start       # http://localhost:3000
```

## Catatan integrasi

- **Continue with Google** sengaja tidak diaktifkan sampai OAuth Google dikonfigurasi di
  Supabase (Client ID/Secret + redirect URI). Tombolnya menampilkan pesan jujur, bukan
  login palsu. Setelah provider aktif, ubah `GOOGLE_OAUTH_ENABLED=true` dan tombol langsung
  memakai `/auth/v1/authorize` → `/auth-callback.html`.
- **Eksekusi MT5** berada di worker/bridge yang berjalan pada mesin dengan terminal MT5,
  bukan di serverless Vercel. Portal mengeluarkan feed perintah nyata di
  `GET /api/admin-commands` (memerlukan sesi master); worker membaca `running`, `login`,
  `server`, `platform` dan menghubungkan ke terminal. Kredensial broker tidak dikirim lewat
  feed ini.
- Folder `pilot-mt5/` berisi riset bridge HFM dan bukan bagian dari portal web.

## Skema database

`supabase/schema.sql` mendefinisikan dua tabel dengan RLS aktif dan grant hanya untuk
`service_role`. Browser tidak pernah mengakses database langsung; semua permintaan lewat
`server.mjs` dengan sesi terverifikasi dan pemeriksaan origin/CSRF.
