# RUNBOOK — AI Content Auto-Optimization Engine

Panduan operasi harian untuk tim growth & reliability. Fokus pada eksperimen konten, scheduler, dan
audit log AI.

## Environment & Konfigurasi

| Variable | Default | Deskripsi |
| --- | --- | --- |
| `ENABLE_AI_OPTIMIZER_LOCAL` | `true` | Aktifkan endpoint eksperimen lokal |
| `ENABLE_AI_OPTIMIZER_GLOBAL` | `true` | Aktifkan sinyal global & scheduler |
| `ENABLE_AI_OPTIMIZER` | `true` | Flag fallback jika dua flag di atas tidak di-set |
| `AI_SA_MAX_AUTOPUBLISH_PER_DAY` | `2` | Kuota autopublish per hari per organisasi |

Pastikan Prisma schema terbaru: `npx prisma generate` setelah perubahan schema.

## Alur Operasional

1. **Mulai Eksperimen**
   - UI: `/app/admin/experiments`
   - API: `POST /api/opt/local/start`
   - Input minimal: `contentId`, axis, baseline hook/caption/CTA atau schedule

2. **Generate Varian**
   - UI: tombol "Generate Variant" di halaman detail
   - API: `POST /api/opt/local/variant`
   - Opsional: set `tone` (`bold|curious|urgent`) & `targetMetric` (`ctr|conversions|dwell`)

3. **Kumpulkan Metrik**
   - UI: form "Catat Metrik Varian"
   - API: `POST /api/opt/local/metrics`
   - Pastikan impressions >= 50 sebelum memeriksa autop publish

4. **Analisis & Winner**
   - Halaman detail menampilkan CTR, konversi, dwell, p-value
   - API: `POST /api/opt/choose-winner`
   - Status eksperimen otomatis menjadi `completed`

5. **Scheduler**
   - API: `POST /api/opt/schedule/recommend`
   - Auto-apply (jika eligible): `POST /api/opt/schedule/apply`
   - Quota & confidence dapat dilihat pada response `recommendation`

6. **AUTO Log & Revert**
   - UI: `/app/admin/auto-actions`
   - API: `GET /api/opt/auto/logs`
   - Revert: `POST /api/opt/auto/revert` dengan `actionId`

## Troubleshooting

### 1. Autopublish Ditolak
- Periksa response `evaluation.reason` dari `applyScheduleRecommendation`
- Pastikan quota harian belum habis (`AI_SA_MAX_AUTOPUBLISH_PER_DAY`)
- Cek confidence & sample size (>= 50). Jika kurang, jalankan manual approval.

### 2. Tidak Ada Rekomendasi Schedule
- Pastikan ada eksperimen axis `SCHEDULE` dengan metrik > 0
- Jalankan training global: `POST /api/opt/global/train`
- Jika tetap kosong, fallback ke manual scheduling (UI menampilkan error 404)

### 3. Variants Tidak Muncul di UI
- API `GET /api/opt/variants/:id` untuk inspeksi data mentah
- Pastikan `variant_metrics` memiliki entri (impressions > 0)
- Jalankan ulang `npx prisma generate` bila deploy baru

### 4. Revert Gagal
- Pastikan `actionId` valid dan status bukan `reverted`
- Cek DB `ai_auto_actions` secara manual jika perlu (`prisma studio`)

## Monitoring & Alerting

- Tambahkan integrasi PostHog/Sentry di masa depan untuk menghubungkan log autop actions dengan
  event performa.
- Untuk saat ini, pantau tabel `ai_auto_actions` dan `global_content_signals` menggunakan Prisma
  Studio (`npm run db:studio`).

## Command Ringan

```bash
# Regenerasi client Prisma setelah update schema
npx prisma generate

# Jalankan lint & test
npm run lint
npm test

# Build production bundle (Next.js)
npm run build
```

## Recovery Checklist

1. Lakukan revert auto action jika ditemukan anomali.
2. Set eksperimen ke `paused` via Prisma Studio bila ingin menghentikan varian sementara.
3. Jika scheduler salah rekomendasi, hapus record di `global_content_signals` dan jalankan training
   ulang (`POST /api/opt/global/train`).
4. Laporkan perubahan signifikan melalui dashboard AUTO agar tim growth aware.
