# InvoSmart Autonomous Optimization Loop

InvoSmart v1.5 memperkenalkan *autonomous optimization loop* yang memadukan lima agen (Optimizer, Learning, Governance, Insight, dan Recovery) dalam satu siklus adaptif. Dokumen ini merangkum arsitektur, alur keputusan, dan kontrol adaptif yang memastikan sistem tetap resilien tanpa intervensi manual.

## Arsitektur Tingkat Tinggi

```
┌──────────────┐   telemetry    ┌──────────────────┐
│ Observability│ ─────────────▶ │ Adaptive Scheduler│
└─────┬────────┘                └────────┬─────────┘
      │                                     │
      │ loop metrics                        │ interval & concurrency
      ▼                                     ▼
┌──────────────┐     priorities     ┌────────────────┐
│ Priority Core│ ◀────────────────▶ │ Orchestrator   │
└─────┬────────┘                    └────────┬───────┘
      │ recovery actions                      │ events
      ▼                                       ▼
┌──────────────┐   rollback / re-eval ┌──────────────┐
│ RecoveryAgent│ ───────────────────▶ │ AI Agents    │
└──────────────┘                      └──────────────┘
```

1. **Adaptive Scheduler** mengatur frekuensi loop dengan fungsi `adaptiveInterval` dan modul `lib/ai/scaler.ts`.
2. **Priority Core** menghitung bobot dinamis (`lib/ai/priority.ts`) dan mencatatnya ke tabel Prisma `AgentPriority`.
3. **RecoveryAgent** memonitor regresi performa serta skor kepercayaan (`lib/ai/recoveryAgent.ts`). Semua tindakan dicatat di tabel `RecoveryLog`.
4. **Orchestrator** menerima insight loop dan menyebarkan ke agen melalui Redis Stream.
5. **Autonomy Dashboard** (`/app/devtools/ai-autonomy`) memberikan visibilitas real-time, termasuk kontrol manual override.

## Siklus Loop

Setiap iterasi `runLoop()` melakukan langkah berikut:

1. **Sampling Telemetri** – Mengambil snapshot orchestrator dan skor kepercayaan (`getTrustScore`).
2. **Prioritization** – `updateAgentPriorities` menghitung bobot baru berdasarkan load, keberhasilan loop, dan error rate.
3. **Scaling** – `evaluateScaling` menilai backlog & latency untuk menentukan concurrency dan interval baru.
4. **Recovery Sweep** – `runRecoverySweep` mendeteksi regresi >10% dan mengeksekusi rollback atau re-evaluasi otomatis.
5. **Event Dispatch** – Insight loop direkam ke stream orchestrator dan dapat dianalisis di dashboard.

## Kontrol Adaptif

- **Flag Enablement** – `ENABLE_AI_AUTONOMY=true` mengaktifkan loop. Bila false, modul berhenti dan menjaga state terakhir.
- **Adaptive Interval** – Interval dihitung ulang setiap iterasi menggunakan kombinasi load, trust score, keberhasilan, dan error rate.
- **Auto Scaling** – Kombinasi backlog dan latency menentukan status `scale_up`, `steady`, atau `scale_down`.
- **Manual Override** – Dashboard menyediakan tombol pause/resume yang memanggil `startAutonomyLoop` atau `stopAutonomyLoop`.

## Telemetry & Audit

- **AgentPriority**: menyimpan bobot agent, confidence, dan alasan penyesuaian.
- **RecoveryLog**: mendokumentasikan rollback, re-evaluasi, dan alasan pemulihan.
- **Autonomy Dashboard**: menampilkan grafik load/trust serta riwayat tindakan recovery.

## Validasi

Gunakan env berikut untuk menjalankan pipeline:

```bash
ENABLE_AI_AUTONOMY=true \
ENABLE_AI_OPTIMIZER=true \
ENABLE_AI_LEARNING=true \
ENABLE_AI_GOVERNANCE=true \
ENABLE_AI_ORCHESTRATION=true \
DATABASE_URL="file:./dev.db" \
REDIS_URL="redis://localhost:6379" \
npm run lint && npm run test && CI=1 npm run build
```

Tes baru meliputi:

- `lib/__tests__/loop.test.ts`
- `lib/__tests__/priority.test.ts`
- `lib/__tests__/recovery-agent.test.ts`
- `lib/__tests__/scaler.test.ts`
- `app/devtools/__tests__/autonomy-dashboard.test.tsx`

Hasil loop dan prioritas terbaru tersedia di tabel Prisma untuk audit maupun debugging mendalam.
