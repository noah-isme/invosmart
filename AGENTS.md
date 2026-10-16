# Panduan Pengerjaan Proyek: InvoSmart

Instruksi untuk developer dan agen AI (Claude Code, Codex, Cursor) yang bekerja di repo ini: perintah, struktur, konvensi, dan cara memverifikasi pekerjaan. Detail arsitektur ada di [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md); indeks semua dokumen ada di [docs/README.md](./docs/README.md).

---

## 1. Ringkasan Sistem Agen AI

InvoSmart memiliki enam agen AI yang dikoordinasikan oleh Orchestrator ([lib/ai/orchestrator.ts](./lib/ai/orchestrator.ts)) melalui **Multi-Agent Protocol (MAP)** dengan skema Zod di [lib/ai/protocol.ts](./lib/ai/protocol.ts). Dokumentasi lengkap: [docs/ai/](./docs/ai/) (orkestrasi, loop otonom, optimizer, learning, governance, federation).

| Agen | Peran | Berkas utama |
|---|---|---|
| Optimizer | Rekomendasi optimasi dari metrik PostHog/Sentry; varian konten (LinUCB) | `lib/ai/optimizer.ts`, `lib/ai/content-local-optimizer.ts` |
| Learning | Evaluasi dampak rekomendasi, pembaruan bobot kepercayaan | `lib/ai/learning.ts` |
| Governance | Membatasi auto-apply pada rute kritis, trust score, log penjelasan | `lib/ai/policy.ts`, `lib/ai/trustScore.ts` |
| Insight | Analisis korelasi lintas metrik | `lib/ai/insightAgent.ts`, `lib/ai/globalInsight.ts` |
| Recovery | Deteksi regresi (>10% trust, >15% error rate) dan rollback otomatis | `lib/ai/recoveryAgent.ts`, `lib/ai/rollback.ts` |
| Federation | Telemetri anonim lintas tenant via protokol FDP yang ditandatangani | `lib/ai/federationAgent.ts`, `lib/federation/bus.ts` |

Resolusi konflik prioritas (`agentPriority` di `lib/ai/protocol.ts`): **Governance (90) > Recovery (85) > Optimizer (75) > Learning (60) > Insight (45) > Federation (35)**.

Loop otonom (`runLoop()` di [lib/ai/loop.ts](./lib/ai/loop.ts)): telemetri → prioritas → scaling ([lib/ai/scaler.ts](./lib/ai/scaler.ts)) → recovery sweep → dispatch event. Detail: [docs/ai/autonomy.md](./docs/ai/autonomy.md).

### Menambahkan Agen Baru
1. Daftarkan tipe agen baru di `agentRoleSchema` enum pada berkas [lib/ai/protocol.ts](./lib/ai/protocol.ts).
2. Tambahkan prioritas agen ke `agentPriority` record (1-100, sesuaikan dengan hierarki sistem).
3. Tambahkan entry ke `AGENT_NAMES` map untuk UI labeling.
4. Buat kelas/modul agen baru di direktori `lib/ai/` (contoh: `myAgent.ts`).
5. Call `registerAgent()` pada module load untuk mendaftarkan ke Orchestrator registry.
6. Implementasikan dispatch event melalui `dispatchEvent()` untuk komunikasi antar-agen.
7. Buat file pengujian di bawah `lib/__tests__/` untuk memverifikasi fungsionalitas logika agen dan event dispatch.
8. Perbarui [docs/ai/](./docs/ai/) dan tabel di atas.

---

## 2. Verifikasi Sebelum Menyatakan Selesai

Jalankan gate yang sama dengan CI (`build-and-test` di `.github/workflows/release.yml`) sebelum commit atau sebelum menyatakan pekerjaan selesai:
```bash
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit (aplikasi)
npm run typecheck:e2e     # tsc untuk test/e2e dan playwright.config.ts
npm run test              # Unit tests (Vitest)
npm run docs:env-check    # setiap process.env yang dibaca kode tercantum di .env.example
npm run docs:route-check  # setiap prefiks app/api/<nama> tercantum di indeks rute (README.md, docs/README.md, docs/API.md)
npm run docs:link-check   # setiap tautan relatif di berkas Markdown mengarah ke berkas yang ada
npm run build             # Build produksi Next.js
```

Jika menyentuh database atau alur pengguna, jalankan juga pengujian integrasi dan end-to-end (Playwright dengan PGlite in-memory dan provider stub lokal; butuh Node 24 dan `npx playwright install chromium`):
```bash
npm run test:integration   # lapisan integrasi DB (Vitest)
npm run e2e:build          # build e2e (wajib sebelum Playwright; `npm run build` biasa menghapus stamp-nya)
npm run test:e2e:smoke     # tier @smoke (gate PR)
npm run test:e2e           # tier penuh (tanpa @staging)
node scripts/e2e-coverage-check.mjs   # setiap halaman dan rute API punya skenario atau waiver
```
Arsitektur, variabel lingkungan, tier, dan cara menambah skenario: [docs/E2E_TESTING.md](./docs/E2E_TESTING.md).

---

## 3. Variabel Lingkungan

[`.env.example`](./.env.example) adalah satu-satunya referensi variabel lingkungan (termasuk flag `ENABLE_AI_*` dan `AI_SA_MAX_AUTOPUBLISH_PER_DAY`). Jangan menduplikasi daftar variabel di dokumen lain; tautkan ke `.env.example`.

---

## 4. Saat mengubah X, perbarui Y

| Jika Anda… | Perbarui |
|---|---|
| Menambah atau mengganti nama variabel lingkungan | `.env.example` (dengan komentar; `npm run docs:env-check` akan gagal jika lupa) |
| Menambah grup rute API baru | Indeks API di `README.md` dan [docs/README.md](./docs/README.md); untuk `/api/v1` juga [docs/API.md](./docs/API.md) dan `lib/openapi.ts` (`npm run docs:route-check` akan gagal jika lupa) |
| Menambah migrasi Prisma | Model data di [docs/DATABASE.md](./docs/DATABASE.md) |
| Menambah penyedia eksternal atau webhook | [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) |
| Mengubah peran atau izin | [docs/WORKSPACE_RBAC.md](./docs/WORKSPACE_RBAC.md) |
| Mengubah autentikasi, CSRF/CSP, rahasia, atau data pribadi | [SECURITY.md](./SECURITY.md) |
| Membalik keputusan yang tercatat di ADR | ADR baru di [docs/adr/](./docs/adr/) yang men-*supersede* ADR lama |
| Mengubah alur rilis, cron, atau langkah migrasi produksi | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Menyelesaikan fitur atau fase | [docs/ROADMAP.md](./docs/ROADMAP.md) (CHANGELOG dibuat oleh semantic-release dari pesan commit) |

---

## 5. Status Proyek

[docs/ROADMAP.md](./docs/ROADMAP.md) adalah satu-satunya pelacak status fase dan fitur. Jangan menambah checklist status di berkas ini atau berkas lain. Riwayat perencanaan lama ada di [docs/archive/](./docs/archive/).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
