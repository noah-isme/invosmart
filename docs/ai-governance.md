# InvoSmart AI Governance & Explainability Layer

## Arsitektur

```
+----------------+       +---------------------+       +-------------------+
| Observability  | ----> | AI Optimizer Engine | ----> | Optimization Log  |
| (PostHog, ... )|       | (GPT-4o-mini)       |       |  + Policy Status   |
+----------------+       +---------------------+       +-------------------+
          |                         |                               |
          |                         v                               v
          |              +---------------------+          +-------------------+
          |              | Governance Policy   |          | Explanation Log   |
          |              | (lib/ai/policy.ts)  |          | (AI Why/Context)  |
          |                         |                     +-------------------+
          |                         v                               |
          |              +---------------------+                    |
          |              | Trust Score Engine  |<------------------+
          |              | (lib/ai/trustScore) |                    |
          |                         |                               |
          +-------------------------+-------------------------------+
                                    |
                                    v
                        +-----------------------------+
                        | DevTools UI (AI Tuning,     |
                        | Learning, Audit Explorer)   |
                        +-----------------------------+
```

## Komponen Utama

- **Policy Layer (`lib/ai/policy.ts`)** — Mendefinisikan kategori tindakan (UI, API, Data) dengan ambang confidence dan aturan auto-apply.
- **Explainability API (`/api/ai/explain`)** — Menghasilkan JSON penjelasan `{ why, context, data_basis, confidence }` dan menyimpannya ke `ExplanationLog`.
- **Trust Score (`lib/ai/trustScore.ts`)** — Menghitung skor kesehatan AI berdasarkan keberhasilan deploy, rollback rate, dan pelanggaran kebijakan.
- **Audit Trail Explorer (`/devtools/ai-audit`)** — Visualisasi kronologis dari `OptimizationLog` + `ExplanationLog` dengan filter dan ekspor CSV/PDF.
- **Dashboard Integrations** — AI Tuning & Learning menampilkan trust score, status kebijakan, dan penjelasan terbaru.

## Kebijakan AI

| Kategori | Aksi yang Diizinkan | Confidence Minimum | Auto-apply |
|----------|--------------------|--------------------|------------|
| UI       | read, modify, auto-apply | 70% | Diizinkan jika ≥75% |
| API      | read, modify            | 85% | Tidak, kecuali ≥90% |
| DATA     | read                    | 90% | Tidak diizinkan     |

- Rute kritis (`/auth`, `/admin`, `/app`, `/devtools`, `/api/internal`) selalu memerlukan review manual.
- Pelanggaran kebijakan memicu event `ai_policy_violation` dan menolak auto-apply ketika governance aktif.
- Semua rekomendasi dan penjelasan dicatat untuk audit yang dapat diverifikasi.

## Alur Explainability

1. Admin memanggil `POST /api/ai/explain` dengan `recommendation_id`.
2. Sistem memvalidasi policy, memanggil GPT-4o-mini (fallback deterministik bila gagal), dan menyimpan hasil ke `ExplanationLog`.
3. Trust score terbaru disematkan pada log untuk memudahkan audit.
4. UI AI Tuning & Learning menarik penjelasan terbaru dan menampilkannya berdampingan dengan status kebijakan.

## Audit & Kepatuhan

- Audit Trail Explorer mendukung filter tanggal, status rekomendasi, dan status kebijakan.
- Ekspor laporan tersedia dalam format CSV dan PDF untuk kebutuhan regulator.
- Semua perubahan tercatat dengan timestamp, actor, alasan, dan basis data yang digunakan AI.

## Pengujian

Lihat `test/explain-api.test.ts`, `test/policy-layer.test.ts`, `app/__tests__/audit-page.test.tsx`, dan `lib/__tests__/trust-score.test.ts` untuk cakupan test governance.
