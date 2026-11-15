# Deploy produksi Titan Vault

## Target

| Item | Nilai |
| --- | --- |
| Proyek Vercel | `titan-trading` (`prj_bugsz8RLq80NIkn9FBALHiJEV9Rz`) |
| Team | `team_fnvWqz7sFTrpEb6CTQKnriO7` |
| Alias produksi | `titan-trading-puce.vercel.app` |
| Supabase | `zwiatrbdvetqcjivqomo` (region `ap-southeast-1`) |
| Branch kerja | `arena/e1b6686c-titan-trading` |

`taitanxbot.online` hanya referensi tampilan; domain itu tidak dipetakan ke proyek ini.

## Konfigurasi yang sudah diterapkan

1. Supabase Auth:
   - `site_url = https://titan-trading-puce.vercel.app`
   - URI allow list mencakup tiga alias Vercel + `http://localhost:3000` dan `:3001`
   - `mailer_autoconfirm = true`, signup aktif, refresh-token rotation aktif
   - Google OAuth masih nonaktif (lihat catatan di README)
2. Migrasi `titan_vault_real_backend`: tabel `titan_vault_users` dan
   `titan_vault_events` dengan RLS + grant `service_role` saja.
3. Environment variables pada proyek Vercel: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`,
   `ADMIN_EMAILS`, `GOOGLE_OAUTH_ENABLED`.
4. `vercel.json`: dua Serverless Function (`api/index.js`, `api/[path].js`) dengan
   `includeFiles: public/**`, rewrite `/admin` → `/admin.html`.

## Cara deploy ulang

Karena produksi Vercel terhubung ke branch `main`, sedangkan pekerjaan ini berada di
branch Arena, deploy produksi dilakukan langsung dari file:

```bash
# melalui Vercel CLI (dari root repo)
vercel --prod --yes
```

Atau lewat konektor Vercel: `create_deployment` dengan `target=production`,
`project=prj_bugsz8RLq80NIkn9FBALHiJEV9Rz`, `team_id=team_fnvWqz7sFTrpEb6CTQKnriO7`
dan seluruh file source sebagai `files`.


## Hasil verifikasi produksi

Deployment `dpl_34GtC9NZxHopVB981PwmtXuc3RxH` (READY / PROMOTED) pada commit `5db90d5`:

- `/api/health` → `healthy` dengan `checks.database`, `checks.authAnonKey`, `checks.authAdminApi` seluruhnya `true`
- Halaman `/`, `/admin`, `/backend.js`, `/auth-callback.html` → `200`
- Endpoint terlindungi → `401` tanpa sesi
- Uji alur nyata (buat akun → masuk → verifikasi token → tulis → baca → hapus akun uji) → berhasil, tanpa akun uji tersisa
- `npm run smoke` → 19 lulus, 0 gagal

## Verifikasi setelah deploy

```bash
curl -s https://titan-trading-puce.vercel.app/api/health
curl -s https://titan-trading-puce.vercel.app/api/config
TITAN_LIVE_BASE=https://titan-trading-puce.vercel.app npm run smoke
```

Halaman `/`, `/admin`, `/auth-callback.html`, `/backend.js` harus `200`.
Endpoint `/api/state` dan `/api/admin/*` harus `401` tanpa sesi.
