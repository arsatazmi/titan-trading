# Titan Trading — status & deployment

## Selesai
- ZIP asli diekstrak dan source diadaptasi untuk Vercel Functions.
- Tabel `public.titan_demo_state` dibuat di Supabase Titan Trading.
- RLS aktif; hanya service_role mendapat akses tabel, tidak ada policy publik.
- State disimpan sebagai JSONB dengan revision check untuk mencegah lost update.
- Environment production/preview sudah dipasang pada project Vercel `titan-trading`.
- Uji lokal: 28/28; uji backend dengan Supabase nyata: 28/28 (sebelum pembatasan tick 15 detik).

## Belum selesai
- Source tersedia di GitHub: https://github.com/arsatazmi/titan-trading (publik).
- Belum ada deployment Vercel yang terverifikasi. Konektor tidak menyediakan
  projectSettings/konfirmasi autodeteksi yang dapat diperlukan pada deployment pertama.

## Alternatif upload GitHub (untuk repo baru)
```sh
gh auth login
# Di folder source yang berisi package.json:
git init -b main
git add .
git commit -m "Adapt Titan Trading demo for Vercel and Supabase"
gh repo create titan-trading --public --source=. --remote=origin --push
```
Jika memakai repo lokal yang telah diinisialisasi dalam workspace, lewati init/add/commit.
Jangan commit .env, data/, atau service role key.

## Deploy dari dashboard Vercel
1. Buka project titan-trading yang sudah ada, sambungkan repo GitHub yang baru.
2. Preset Other, root folder tempat package.json berada, output directory `public`.
3. Build command kosong; aplikasi tidak memerlukan dependencies.
4. Environment SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY telah disiapkan
   untuk production/preview. Jangan expose key ke browser.
5. Deploy, lalu cek /, /app, /admin, /api/health serta login dan pembayaran simulasi.

## Peringatan
Demo saja, bukan produksi. Password demo di README bersifat publik. Jangan
masukkan data pribadi, kredensial broker asli, atau uang nyata. Admin demo
bisa diakses pengunjung yang mengetahui kredensialnya, termasuk reset data.
Rate limiter login masih in-memory per instance (tidak global/persisten).
Simulasi berjalan saat API dipanggil, maksimal sekali per 15 detik, bukan worker trading.
State satu dokumen cocok untuk demo, bukan arsitektur multi-user berskala besar.
Konflik concurrent request mengembalikan 409 state_conflict tanpa menimpa state lain.
Uji Supabase telah membuat/mengubah data demo. Tidak ada data nyata dimigrasikan.
