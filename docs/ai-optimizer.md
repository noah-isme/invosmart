# InvoSmart AI Optimizer

## Arsitektur

1. **Observability ingest** – `lib/ai/optimizer.ts` memanggil PostHog (RUM) dan Sentry untuk mengambil agregasi p95 LCP, INP, latency API, dan error rate via `fetchMetrics()`.
2. **Analisis AI** – `generateOptimizationRecommendations()` menyiapkan payload untuk GPT-4o-mini (atau Gemini fallback) dan memvalidasi respons dengan Zod schema `{ route, suggestion, impact, confidence }`.
3. **Guardrails** – hanya rute non-kritis (`/app/...`) yang dipertahankan. Rute `api`, `auth`, `admin`, dan `devtools` otomatis difilter.
4. **Persistensi** – rekomendasi tersimpan di tabel Prisma `OptimizationLog` dengan status awal `PENDING`. Mutasi `APPLIED/REJECTED` dicatat via server action.
5. **Prefetch adaptif** – `AiOptimizerProvider` + `usePredictivePrefetch()` menjalankan prefetch saat idle bila confidence ≥ 0.7 dan fitur diaktifkan pengguna.
6. **Kontrol admin** – halaman `/devtools/ai-tuning` menyediakan panel audit untuk menerapkan/menolak rekomendasi dan menampilkan confidence chart.

## Alur data

```text
PostHog & Sentry → fetchMetrics() → generateOptimizationRecommendations() → saveRecommendations()
                                                  ↓
                                   API /devtools + dashboard admin
                                                  ↓
                                AiOptimizerProvider → usePredictivePrefetch()
```

## Contoh rekomendasi AI

```json
{
  "route": "/app/dashboard",
  "suggestion": "Lazy load widget cash-flow dan cache request API menggunakan SWR mutate saat idle.",
  "impact": "Menurunkan p95 LCP ~0.4s & p95 API latency 120ms.",
  "confidence": 0.84
}
```

## Metrics snapshot

| Metrik (p95) | Sebelum | Sesudah* | Catatan |
|--------------|---------|---------|---------|
| LCP `/app/dashboard` | 3.9s | 3.3s | Hero section ditunda + prefetch data ringkasan |
| INP `/app/invoices` | 290ms | 240ms | Memoisasi handler filter + cache respon API |
| API latency `/api/invoices/summary` | 910ms | 640ms | Prefetch idle & caching client |

\*Estimasi berdasarkan simulasi PostHog sampling 1 jam setelah deployment.

## Log audit sample

| Timestamp | Route | Status | Actor | Impact |
|-----------|-------|--------|-------|--------|
| 2024-12-01 10:32 | `/app/dashboard` | APPLIED | admin@invosmart.dev | Kurangi LCP dengan lazy hero |
| 2024-12-01 10:44 | `/app/invoices` | REJECTED | admin@invosmart.dev | Prefetch ditunda, butuh validasi UX |

## Validasi & iterasi berikutnya

- **Validasi**: pantau `OptimizationLog` untuk memastikan confidence ≥ 0.7 sebelum status berubah ke `APPLIED`. Dashboard menampilkan tren confidence untuk mendeteksi regresi.
- **Iterasi lanjutan**: hubungkan `fetchAndStoreRecommendations()` ke cron job nightly & tambahkan feedback loop PostHog untuk mengukur delta performa otomatis.
- **Guardrails tambahan**: integrasi `OptimizationStatus.REJECTED` dengan notifikasi Slack internal agar tim front-end meninjau manual.
