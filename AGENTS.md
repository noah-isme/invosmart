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
export const agentRoleSchema = z.enum(['optimizer', 'learning', 'governance', 'insight', 'recovery', 'federation']);
export const mapEventTypeSchema = z.enum(['recommendation', 'evaluation', 'policy_update', 'insight_report', 'recovery_action']);

export const agentPriority: Record<AgentRole, number> = {
  governance: 90,
  recovery: 85,
  optimizer: 75,
  learning: 60,
  insight: 45,
  federation: 35,
};
```

Setiap event memiliki struktur dasar:
```typescript
{
  traceId: string,
  type: 'recommendation' | 'evaluation' | 'policy_update' | 'insight_report' | 'recovery_action',
  source: AgentRole,
  target?: AgentRole,
  priority: number (1-100),
  timestamp: ISO8601 string,
  payload: { summary, context, ... }
}
```

### Resolusi Konflik Prioritas
Jika terjadi konflik instruksi antara agen, Orchestrator memutus keputusan berdasarkan bobot prioritas dinamis:
$$\text{Priority Order: } \text{Governance (90)} > \text{Recovery (85)} > \text{Optimizer (75)} > \text{Learning (60)} > \text{Insight (45)} > \text{Federation (35)}$$

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

1. **Sampling Metrik**: Membaca metrik performa p95 LCP, INP, dan latensi API. Setiap telemetri melacak `regressionDetected`, `recoveryAction`, dan `rollbackCount` untuk trend analysis.
2. **Prioritization**: Memperbarui bobot agen di tabel `AgentPriority` berbasis beban kerja sistem melalui `PrioritySignal`.
3. **Scaling**: Modul [lib/ai/scaler.ts](file:///home/noah/project/invosmart/lib/ai/scaler.ts) menghitung frekuensi interval baru agar sistem hemat daya saat idle dan agresif saat sibuk berdasarkan latency, backlog, dan trust score.
4. **Recovery Sweep**: `RecoveryAgent` memverifikasi apakah ada optimasi bermasalah dengan menganalisis regresi kepercayaan (>10%) atau error rate (>15%), lalu memicu action (noop/rollback/reevaluate). Recovery event didispatch ke stream agar agen lain dapat bereaksi.
5. **Event Dispatching**: Semua events (recommendation, evaluation, policy_update, insight_report, recovery_action) dipersistensi ke DB dan Redis stream untuk audit trail dan cross-agent visibility.

---

## 4. Instruksi Pengembangan bagi Developer

### Menambahkan Agen Baru
1. Daftarkan tipe agen baru di `agentRoleSchema` enum pada berkas [lib/ai/protocol.ts](file:///home/noah/project/invosmart/lib/ai/protocol.ts).
2. Tambahkan prioritas agen ke `agentPriority` record (1-100, sesuaikan dengan hierarki sistem).
3. Tambahkan entry ke `AGENT_NAMES` map untuk UI labeling.
4. Buat kelas/modul agen baru di direktori `lib/ai/` (contoh: `myAgent.ts`).
5. Call `registerAgent()` pada module load untuk mendaftarkan ke Orchestrator registry.
6. Implementasikan dispatch event melalui `dispatchEvent()` untuk komunikasi antar-agen.
7. Buat file pengujian di bawah `lib/__tests__/` untuk memverifikasi fungsionalitas logika agen dan event dispatch.

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

## 5. Status Integrasi Recovery Agent

**Status**: ✅ COMPLETED (2026-08-02)

Recovery Agent kini fully integrated ke dalam MAP protocol dengan:
- ✅ Registered di `agentRoleSchema` dengan priority 85
- ✅ Event type `recovery_action` di `mapEventTypeSchema`
- ✅ `runRecoverySweep()` dispatches recovery events ke orchestrator
- ✅ Loop telemetry tracks `regressionDetected`, `recoveryAction`, `rollbackCount`
- ✅ Documentation: `.omo/plans/recovery-agent-integration.md`

Lihat [.omo/plans/recovery-agent-integration.md](./.omo/plans/recovery-agent-integration.md) untuk detail implementasi dan roadmap lanjutan.

---

## 6. Rencana Iterasi Berikutnya (Task Checklist)

Berikut adalah beberapa tugas pengembangan agen yang telah selesai (Phase 1) dan yang akan datang:

**✅ Phase 1 — Selesai (2026-08-11)**
- [x] Migrasi dari local template-based bandit model ke **contextual bandit model (LinUCB)** penuh di `lib/ai/content-local-optimizer.ts`.
- [x] Integrasi webhook Discord/Slack pada `ai_auto_actions` agar admin mendapatkan alert real-time (`lib/ai/webhooks.ts`).
- [x] Menambahkan dukungan enkripsi asimetris RSA-2048/AES-256-GCM untuk payload bus data Federation di `lib/federation/bus.ts`.
- [x] Migrasi database ke PostgreSQL dengan `prisma migrate dev` dan dokumentasi di `docs/DATABASE.md`.
- [x] Implementasi CSRF protection (Double Submit Cookie) dan Content-Security-Policy di `middleware.ts` dan `next.config.ts`.
- [x] Implementasi audit logging komprehensif (`lib/audit/auditLogger.ts`) untuk invoice, auth, dan AI auto-actions, dengan admin UI di `/app/admin/audit-logs`.

**📅 Phase 2 — Berikutnya**

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
