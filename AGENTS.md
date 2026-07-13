# Panduan Pengerjaan Proyek: Sistem Agen AI InvoSmart

Dokumen ini merangkum arsitektur agen, cara kerja protokol kolaborasi multi-agen, alur eksekusi otonom, serta panduan pengerjaan proyek bagi pengembang yang bekerja pada sistem agen AI InvoSmart.

---

## 1. Daftar Agen & Peran Aktual

InvoSmart mengintegrasikan enam agen AI utama yang berjalan secara terdistribusi dan dikoordinasikan oleh Orchestrator:

| Nama Agen | Peran & Deskripsi | Berkas Kode Utama |
|---|---|---|
| **Optimizer Agent** | Mengambil metrik (PostHog/Sentry) dan menghasilkan rekomendasi optimasi visual, API, dan performa serta mengoptimalkan varian konten. | [lib/ai/optimizer.ts](file:///home/noah/project/invosmart/lib/ai/optimizer.ts)<br>[lib/ai/content-local-optimizer.ts](file:///home/noah/project/invosmart/lib/ai/content-local-optimizer.ts) |
| **Learning Agent** | Mengevaluasi dampak rekomendasi setelah diterapkan, melakukan kalkulasi composite impact, dan memperbarui bobot kepercayaan (*confidence weight*). | [lib/ai/learning.ts](file:///home/noah/project/invosmart/lib/ai/learning.ts) |
| **Governance Agent** | Menjaga keamanan sistem dengan membatasi *auto-apply* pada rute kritis, memantau skor kepercayaan AI, dan menghasilkan log penjelasan keputusan. | [lib/ai/policy.ts](file:///home/noah/project/invosmart/lib/ai/policy.ts)<br>[lib/ai/trustScore.ts](file:///home/noah/project/invosmart/lib/ai/trustScore.ts) |
| **Insight Agent** | Melakukan analisis korelasi lintas metrik performa aplikasi untuk memberikan rekomendasi optimasi yang lebih akurat. | [lib/ai/insightAgent.ts](file:///home/noah/project/invosmart/lib/ai/insightAgent.ts)<br>[lib/ai/globalInsight.ts](file:///home/noah/project/invosmart/lib/ai/globalInsight.ts) |
| **Recovery Agent** | Memantau anomali performa secara berkala (regresi >10%) dan melakukan *rollback* otomatis jika ada penurunan performa yang disebabkan oleh aksi AI. | [lib/ai/recoveryAgent.ts](file:///home/noah/project/invosmart/lib/ai/recoveryAgent.ts)<br>[lib/ai/rollback.ts](file:///home/noah/project/invosmart/lib/ai/rollback.ts) |
| **Federation Agent** | Menghubungkan telemetri anonim lintas tenant melalui protokol FDP yang ditandatangani untuk konsensus bobot agen dan analisis kesehatan jaringan global. | [lib/ai/federationAgent.ts](file:///home/noah/project/invosmart/lib/ai/federationAgent.ts) |

---

## 2. Protokol MAP & Komunikasi Agen

Semua agen berkomunikasi secara tidak langsung melalui broker pesan sentral di [lib/ai/orchestrator.ts](file:///home/noah/project/invosmart/lib/ai/orchestrator.ts) menggunakan **Multi-Agent Protocol (MAP)**.

### Skema Event MAP (Zod)
Setiap pesan divalidasi menggunakan skema Zod di [lib/ai/protocol.ts](file:///home/noah/project/invosmart/lib/ai/protocol.ts):
```typescript
export const AgentEventSchema = z.object({
  traceId: z.string(),
  type: z.enum(['recommendation', 'evaluation', 'policy_update', 'insight_report', 'telemetry_sync', 'model_update']),
  source: z.enum(['optimizer', 'learning', 'governance', 'insight', 'recovery', 'federation']),
  target: z.string().optional(),
  priority: z.number().min(0).max(100),
  timestamp: z.date(),
  payload: z.any(),
});
```

### Resolusi Konflik Prioritas
Jika terjadi konflik instruksi antara agen, Orchestrator memutus keputusan berdasarkan bobot prioritas dinamis:
$$\text{Priority Order: } \text{Governance} > \text{Optimizer} > \text{Learning} > \text{Insight}$$

---

## 3. Siklus Loop Otonom (Autonomous Loop)

Modul [lib/ai/loop.ts](file:///home/noah/project/invosmart/lib/ai/loop.ts) menjalankan alur iteratif `runLoop()` sebagai berikut:

```
Telemetry Ingestion (PostHog/Sentry) 
                 ▼
Dynamic Prioritization (Update Agent Weights)
                 ▼
Adaptive Scaling (Adjust Concurrency & Interval)
                 ▼
Recovery Sweep (Verify regression & run Rollback)
                 ▼
Event Dispatching (Update DB & Redis Streams)
```

1. **Sampling Metrik**: Membaca metrik performa p95 LCP, INP, dan latensi API.
2. **Prioritization**: Memperbarui bobot agen di tabel `AgentPriority` berbasis beban kerja sistem.
3. **Scaling**: Modul [lib/ai/scaler.ts](file:///home/noah/project/invosmart/lib/ai/scaler.ts) menghitung frekuensi interval baru agar sistem hemat daya saat idle dan agresif saat sibuk.
4. **Recovery Sweep**: `RecoveryAgent` memverifikasi apakah ada optimasi bermasalah lalu memicu rollback.

---

## 4. Instruksi Pengembangan bagi Developer

### Menambahkan Agen Baru
1. Daftarkan tipe agen baru di skema `AgentEventSchema` pada berkas [lib/ai/protocol.ts](file:///home/noah/project/invosmart/lib/ai/protocol.ts).
2. Buat kelas/modul agen baru di direktori `lib/ai/` (contoh: `myAgent.ts`).
3. Daftarkan agen pada registry Orchestrator di [lib/ai/orchestrator.ts](file:///home/noah/project/invosmart/lib/ai/orchestrator.ts).
4. Buat file pengujian di bawah `lib/__tests__/` untuk memverifikasi fungsionalitas logika agen.

### Menjalankan Uji Mutu (Lint & Test)
Pastikan semua kode mematuhi standar kualitas sebelum melakukan commit:
```bash
# Menjalankan Linter
npm run lint

# Menjalankan Unit Tests (Vitest)
npm run test

# Menjalankan Build Produksi Next.js
npm run build
```

### Variabel Lingkungan Terkait Agen
Tambahkan konfigurasi berikut ke `.env` Anda:
```bash
# Aktifkan seluruh loop otonom & optimasi AI
ENABLE_AI_OPTIMIZER=true
ENABLE_AI_LEARNING=true
ENABLE_AI_GOVERNANCE=true
ENABLE_AI_AUTONOMY=true
ENABLE_AI_FEDERATION=true

# Batas kuota auto-publish per hari per tenant
AI_SA_MAX_AUTOPUBLISH_PER_DAY=2
```

---

## 5. Rencana Iterasi Berikutnya (Task Checklist)

Berikut adalah beberapa tugas pengembangan agen yang akan datang:
- [ ] Migrasi dari local template-based bandit model ke contextual bandit model penuh di `lib/ai/content-local-optimizer.ts`.
- [ ] Integrasi webhook Discord/Slack pada `ai_auto_actions` agar admin mendapatkan alert real-time.
- [ ] Menambahkan dukungan enkripsi asimetris tambahan untuk payload bus data Federation di `lib/federation/bus.ts`.
