# Phase 12 — AI Content Auto-Optimization Engine

Phase 12 menghadirkan mesin optimasi konten menyeluruh untuk permukaan internal. Mesin ini
menggabungkan eksperimen lokal per konten, pembelajaran lintas konten, dan automasi terkontrol
untuk scheduling serta CTA. Seluruh alur dibangun dengan prinsip explainability, auditability, dan
kontrol quota semi-autonomous (SA).

## Arsitektur Tingkat Tinggi

```
┌─────────────────────┐        ┌──────────────────────┐
│  Local Optimizer    │        │   Global Optimizer    │
│  (per content)      │        │   (cross content)     │
│  • Variants (H/C/CTA│        │  • Aggregated signals │
│  • Bandit scoring   │◄──────►│  • Schedule signals   │
│  • P-value checks   │        │  • Seasonal windows   │
└────────┬────────────┘        └─────────┬────────────┘
         │                               │
         │                               │
         ▼                               ▼
┌──────────────────────┐       ┌────────────────────────┐
│  Scheduler & SA Gate │       │    Dashboards (EXP/AUTO)│
│  • Safe windows      │       │  • Experiment Explorer  │
│  • Quota guard       │       │  • Variant compare      │
│  • Explainable logs  │       │  • AUTO log + revert    │
└──────────────────────┘       └────────────────────────┘
```

### Data & Storage

Prisma schema diperluas dengan tabel:

- `content_experiments` — metadata eksperimen per konten & axis (hook, caption, CTA, schedule)
- `content_variants` — varian AI & baseline, payload JSON, confidence, explanation
- `variant_metrics` — agregat impressions, clicks, conversions, dwell, disertai CTR tersimpan
- `ai_auto_actions` — audit log autopublish/schedule update/CTA tuning/revert
- `global_content_signals` — sinyal lintas konten (top performer, rekomendasi jam, window)

Semua tabel mendukung organisasi opsional (UUID) sehingga bisa dipakai lintas tenant.

## Local Optimizer

File: `lib/ai/content-local-optimizer.ts`

Fitur utama:

1. **Start Experiment** – membuat eksperimen & baseline variant. Payload baseline fleksibel
   (hook/caption/cta/schedule). Status default `running`.
2. **Generate Variant** – heuristik generatif ringan memanfaatkan pola template + sinyal global
   (tone, target metric, sinyal global). Confidence meningkat seiring iterasi.
3. **Scoring** – memanfaatkan `lib/ai/scoring.ts` (w1 CTR, w2 Konversi, w3 Dwell). P-value & uplift
   dihitung via `lib/stats/ab.ts` (approximate z-test + uplift).
4. **Metrics ingestion** – endpoint `/api/opt/local/metrics` melakukan agregasi kumulatif per varian.
5. **Winner selection** – `/api/opt/choose-winner` menutup eksperimen (status `completed`) dan
   menetapkan varian pemenang.

Semua output diserialisasi agar aman untuk konsumsi API & UI (`serializeExperimentSummary`).

## Global Optimizer

File: `lib/ai/content-global-optimizer.ts`

- Mengagregasi performa varian 7 hari & 30 hari, menyusun daftar top performer per axis.
- Untuk axis `SCHEDULE`, dihitung bucket day-hour dengan bobot skor & volume → rekomendasi window.
- Sinyal disimpan di `global_content_signals` dengan unique key (org, axis, window).
- Endpoint `/api/opt/global/train` menjalankan training, `/api/opt/schedule/recommend` memanfaatkan
  sinyal plus data lokal.

## Scheduler & Approval Gates

- `lib/ai/scheduler.ts` mengkombinasikan varian terbaik (axis schedule) dan sinyal global. Output
  mematuhi jam low-risk (09-11, 14-16, 20) dan menghitung quota autopublish.
- `lib/ai/approval-gates.ts` menerapkan aturan SA: confidence minimum (0.8 umum, 0.75 schedule),
  sample size default 50, CTA high-stakes wajib approval, quota harian (`AI_SA_MAX_AUTOPUBLISH_PER_DAY`).
- Log auto actions dicatat via `logAutoAction`, revert via `markAutoActionReverted`.

## API Surface

Semua route berada di `/api/opt/*` dengan auth NextAuth (Pro+ gating dapat ditambah lewat hook).

### Local Experimentation
- `POST /api/opt/local/start`
- `POST /api/opt/local/variant`
- `POST /api/opt/local/metrics`
- `GET /api/opt/experiments`
- `GET /api/opt/variants/:experimentId`
- `POST /api/opt/choose-winner`

### Global & Scheduler
- `POST /api/opt/global/train`
- `POST /api/opt/schedule/recommend`
- `POST /api/opt/schedule/apply`

### Auto Actions
- `GET /api/opt/auto/logs`
- `POST /api/opt/auto/revert`

## Dashboards

### `/app/admin/experiments`
- Start experiment form (hook/caption/CTA/schedule)
- Tabel eksperimen dengan status, varian, uplift, link ke detail

### `/app/admin/experiments/[id]`
- Komparasi varian (metrik, p-value, confidence)
- Panel aksi: generate varian, catat metrik, pilih pemenang
- Untuk axis schedule → rekomendasi jadwal + auto-apply bila eligible

### `/app/admin/auto-actions`
- Log AUTO (waktu, action, confidence, alasan)
- Siap filter via query string (`?organizationId=...` atau `?actionType=...`)

## Bandit vs P-value

- **Bandit heuristik**: local generator memilih template berbeda berdasarkan varian index & target metric.
- **Analisis statistik**: uplift & p-value (two-tailed z-test) memastikan keputusan pemenang tetap
  punya bukti kuantitatif. Scheduler memanfaatkan sample size sebagai guard.

## Approval & Safety

- SA quota: default 2 autopublish/day/org (`AI_SA_MAX_AUTOPUBLISH_PER_DAY`) → disesuaikan via env.
- CTA high-stakes tidak auto: perlu set flag `highStakes` saat memanggil `evaluateAutoPublish`.
- Semua tindakan autop mencatat `reason`, `confidence`, `status` → memudahkan audit & revert.
- Revert manual (`POST /api/opt/auto/revert`) mengubah status menjadi `reverted`.

## Testing & Observability

### Unit/Vitest
- `lib/ai/scoring` & `lib/stats/ab` mudah dites (lihat `lib/__tests__` untuk contoh).
- Gate SA (`lib/ai/approval-gates.ts`) dirancang pure logic sehingga bisa diunit-test.

### Manual Scenario
1. Mulai eksperimen hook/caption/CTA → generate 2–3 varian.
2. Catat metrik dummy via `/api/opt/local/metrics` atau UI detail.
3. Periksa tabel variant (CTR, dwell, p-value) → pilih pemenang.
4. Untuk axis schedule, minta rekomendasi → auto apply jika quota tersedia.
5. Cek `/app/admin/auto-actions` → pastikan log & revert bekerja.

## Rollback & Recovery

- Semua perubahan AI terekam; revert cukup memanggil `POST /api/opt/auto/revert` atau update manual.
- Baseline selalu tersimpan sebagai varian `baseline`, sehingga fallback cepat.
- Scheduler memeriksa quota; jika auto gagal, UI menampilkan status "Butuh Approval".

## Next Steps (Phase 13+)
- Perluasan ke surface tambahan (gallery cards, banners, email subject lines).
- Integrasi model bandit kontekstual penuh, bukan heuristik template.
- Realtime monitoring autop actions + notifikasi Slack/email.
