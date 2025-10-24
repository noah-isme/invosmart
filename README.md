# InvoSmart – Smart Invoice Assistant

> Aplikasi web Next.js untuk freelancer dan bisnis kecil yang membantu membuat, mengelola, dan menganalisis invoice secara otomatis berbasis AI.

---

## 🚀 Getting Started

### Prasyarat
- **Node.js 18.18+** atau **Node.js 20+**
- **npm 9+** (dibundel bersama Node.js)

### Instalasi & Pengembangan Lokal
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Siapkan environment**
   Salin berkas contoh dan isi kredensial Anda:
   ```bash
   cp .env.example .env
   ```
   Nilai yang wajib diisi minimal:
   - `NEXTAUTH_SECRET` → gunakan string acak yang kuat.
   - `DATABASE_URL` → `file:./dev.db` sudah cukup untuk pengembangan lokal (SQLite). Ganti ke URL Postgres saat deploy.
   - `NEXTAUTH_URL` → alamat dasar aplikasi (default `http://localhost:3000`).
   Google OAuth bersifat opsional; cukup tambahkan `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` ketika ingin mengaktifkan login Google.
3. **Jalankan pemeriksaan kualitas**
   ```bash
   npm run lint
   npm run test
   npm run build
   ```
   Ketiga perintah di atas mencerminkan pipeline CI utama (_lint → test → build_) yang harus lulus sebelum fitur dianggap siap.
4. **Mulai server pengembangan**
   ```bash
   npm run dev
   ```
5. Buka `http://localhost:3000` untuk melihat antarmuka awal InvoSmart.

### Scripts
- `npm run dev` – Menjalankan Next.js dalam mode pengembangan dengan HMR.
- `npm run lint` – Menjalankan ESLint (`eslint.config.mjs`) untuk memastikan kualitas kode App Router.
- `npm run test` – Menjalankan Vitest + Testing Library untuk menguji komponen App Router.
- `npm run build` – Membuat build produksi Next.js.
- `npm start` – Menjalankan server produksi setelah build.
- `npm run qa:lighthouse` – Menjalankan Lighthouse CI lokal untuk memverifikasi performa, aksesibilitas, dan SEO.

## 📊 Insight & QA Finalization
- New endpoint: `/api/insight/revenue`
- Dashboard charts: Monthly Revenue & Paid/Overdue distribution
- Performance target: Lighthouse ≥90
- Security: Rate limiting + headers + input sanitization

### API Reference – Invoice CRUD
| Method | Endpoint | Deskripsi |
| --- | --- | --- |
| GET | `/api/invoices` | Mengambil 20 invoice terbaru milik pengguna. Gunakan query `?status=PAID` untuk filter. |
| POST | `/api/invoices` | Membuat invoice baru dengan nomor otomatis (format `INV-YYYYMM-SEQ`). |
| GET | `/api/invoices/:id` | Mendapatkan detail invoice tertentu dan memperbarui status overdue secara otomatis. |
| PUT | `/api/invoices/:id` | Memperbarui data invoice (client, item, status). Status PAID menambahkan `paidAt`, status SENT mengubah `issuedAt`. |
| DELETE | `/api/invoices/:id` | Menghapus invoice milik pengguna aktif. |

## 📄 Export & Branding
- Unduh invoice sebagai PDF melalui endpoint `GET /api/invoices/[id]/pdf` atau tombol **Download PDF** di halaman detail invoice.
- Setiap file PDF memuat logo, warna utama, dan font sesuai pengaturan branding pengguna serta menyertakan watermark "InvoSmart".
- Kelola preferensi branding di `/app/settings/branding` untuk mengunggah URL logo, memilih warna utama, dan font (sans/serif/mono).
- Preferensi tersimpan per pengguna di database dan otomatis diterapkan pada generator PDF berikutnya.

---

## 🔑 Authentication

### Alur Register & Login
1. Buka `/auth/register` untuk membuat akun baru. Masukkan nama lengkap, email, dan password minimal 6 karakter.
2. Setelah registrasi berhasil Anda akan diarahkan ke halaman login (`/auth/login`) dengan pesan sukses.
3. Login menggunakan kredensial yang baru dibuat atau klik **“Lanjutkan dengan Google”** jika sudah mengaktifkan OAuth.
4. Setelah login sukses pengguna akan diarahkan ke dashboard utama di `/app`.
5. Semua halaman di bawah `/app/**` diproteksi oleh middleware NextAuth. Gunakan tombol **Keluar** pada dashboard atau profil untuk mengakhiri sesi dengan aman.

### Konfigurasi Google OAuth
1. Buka [Google Cloud Console](https://console.cloud.google.com/) dan buat project baru (atau gunakan yang sudah ada).
2. Aktifkan **OAuth consent screen** dan tambahkan domain `http://localhost:3000` (atau domain produksi) sebagai authorized domain.
3. Buat kredensial **OAuth Client ID** dengan tipe **Web application**.
4. Tambahkan `http://localhost:3000/api/auth/callback/google` sebagai **Authorized redirect URI** (ganti domain sesuai nilai `NEXTAUTH_URL` saat deploy).
5. Salin `Client ID` dan `Client Secret` lalu isi ke variabel `.env`:
   ```bash
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```
6. Simpan berkas `.env` dan restart server pengembangan agar NextAuth memuat konfigurasi baru.

## 📊 Invoice Dashboard & API

Dashboard baru tersedia di `/app/dashboard` setelah login. Modul ini mencakup:

- **Tabel Invoice** – daftar 20 invoice terbaru lengkap dengan nomor, klien, nilai, status, dan jatuh tempo.
- **Filter Status** – tombol All/Draft/Sent/Paid/Unpaid/Overdue yang melakukan fetch ulang ke `/api/invoices` dengan query `status`.
- **Aksi Cepat** – ubah status langsung dari tabel (update ke API) dan hapus invoice.
- **Widget Statistik** – ringkasan total pendapatan (status PAID), jumlah invoice unpaid, serta overdue.
- **Auto status** – nomor invoice otomatis `INV-{YYYY}{MM}-{SEQ}`, status berubah ke OVERDUE bila melewati `dueAt`, perubahan ke SENT mengisi `issuedAt`, dan PAID mencatat `paidAt`.

Contoh payload `POST /api/invoices`:

```json
{
  "client": "PT Kreatif Nusantara",
  "items": [
    { "name": "UI Design", "qty": 2, "price": 750000 },
    { "name": "UX Research", "qty": 1, "price": 500000 }
  ],
  "taxRate": 0.1,
  "dueAt": "2024-11-30T00:00:00.000Z"
}
```

Respons berisi detail lengkap invoice dengan nomor otomatis, subtotal, total, dan metadata status.

Contoh payload `PUT /api/invoices/:id` (update status):

```json
{
  "id": "inv-1",
  "client": "PT Kreatif Nusantara",
  "items": [{ "name": "UI Design", "qty": 2, "price": 750000 }],
  "subtotal": 1500000,
  "tax": 150000,
  "total": 1650000,
  "status": "PAID",
  "issuedAt": "2024-11-01T00:00:00.000Z",
  "dueAt": "2024-11-15T00:00:00.000Z",
  "taxRate": 0.1
}
```

---

## 💼 Invoice Form & Detail Workflow

- `/app/invoices/new` → formulir invoice manual dengan perhitungan subtotal, pajak 10%, dan total secara real-time.
- `/app/invoices/[id]` → halaman detail lengkap untuk melihat metadata invoice, mengirim, menandai lunas, atau menghapus.
- Validasi Zod berjalan di klien & server. Nilai subtotal/tax/total dihitung ulang di server agar aman dari manipulasi.
- Aksi status dilindungi dialog konfirmasi dan otomatis memperbarui `issuedAt`/`paidAt` sesuai transisi.

Contoh payload form yang lolos validasi:

```json
{
  "client": "PT Kreatif Nusantara",
  "items": [
    { "name": "UI Design", "qty": 2, "price": 750000 },
    { "name": "UX Research", "qty": 1, "price": 500000 }
  ],
  "taxRate": 0.1,
  "dueAt": "2024-11-30T00:00:00.000Z",
  "status": "SENT"
}
```

Contoh payload update status yang valid:

```json
{
  "id": "inv-1",
  "client": "PT Kreatif Nusantara",
  "items": [{ "name": "UI Design", "qty": 2, "price": 750000 }],
  "subtotal": 1500000,
  "tax": 150000,
  "total": 1650000,
  "status": "PAID",
  "issuedAt": "2024-11-01T00:00:00.000Z",
  "dueAt": "2024-11-15T00:00:00.000Z",
  "taxRate": 0.1
}
```

---

## 🤖 AI Invoice Generator

- **Endpoint**: `POST /api/invoices/ai`
- **Input**: `{ "prompt": string }`
- **Output**: `{ "data": { client, items[], dueAt?, notes? } }` – seluruh payload sudah divalidasi Zod sebelum dikirim ke frontend.
- **Frontend**: `/app/ai-invoice` menampilkan textarea prompt, preview hasil AI, serta form edit penuh.
- **Kegunaan**: Mengubah instruksi natural language menjadi draft invoice yang siap disimpan sebagai draft maupun dikirim.

Contoh request:

```http
POST /api/invoices/ai
Content-Type: application/json

{
  "prompt": "Buat invoice 2.5 juta untuk desain logo dan brand guide klien PT Alpha due 14 hari"
}
```

Contoh respons sukses:

```json
{
  "data": {
    "client": "PT Alpha",
    "items": [
      { "name": "Desain Logo", "qty": 1, "price": 1500000 },
      { "name": "Brand Guidelines", "qty": 1, "price": 1000000 }
    ],
    "dueAt": "2024-06-15T00:00:00.000Z",
    "notes": "Pembayaran maksimal 14 hari setelah invoice diterima."
  }
}
```

Jika AI gagal mengembalikan struktur valid, endpoint merespons `400` dengan pesan ramah pengguna dan payload `fallback` berisi draft kosong agar pengguna dapat melanjutkan secara manual.

---

## 🧱 Arsitektur & Stack

| Layer | Teknologi | Highlight |
| --- | --- | --- |
| Front-end | [Next.js 15 (App Router)](https://nextjs.org/) | SSR & SSG siap, integrasi API Routes untuk MVP. |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) | Utility-first dengan konfigurasi minimal dan desain gelap modern. |
| Bahasa | TypeScript | Type-safety untuk komponen UI & utilitas. |
| Testing | [Vitest](https://vitest.dev/) + Testing Library | Pengujian React Server Component dengan environment JSDOM. |
| Ikon | [lucide-react](https://lucide.dev/) | Ikon outline ringan dan konsisten. |

Struktur direktori utama:
```
app/
  ├─ layout.tsx      → Global layout & metadata
  ├─ page.tsx        → Landing page sesuai roadmap README
  ├─ globals.css     → Styling global Tailwind v4
  └─ __tests__/      → Unit test Vitest
public/              → Asset statis (favicon, logo, dll.)
vitest.config.mts     → Konfigurasi Vitest + alias Next.js
eslint.config.mjs    → Konfigurasi lint Next.js core web vitals
```

---

## 🎯 Fokus MVP (3–4 Minggu Pertama)

1. **Autentikasi & Otorisasi**
   - Login/Register email & password.
   - Integrasi Google OAuth.
   - Session management dengan JWT & refresh token aman.
2. **Dashboard Invoice**
   - Daftar invoice dengan filter status: **Paid / Unpaid / Draft**.
   - Quick stats: total pendapatan, invoice pending, overdue highlight.
3. **AI Invoice Generator**
   - Input natural language (contoh: _"buat invoice 2 juta untuk desain logo klien ABC"_).
   - Parsing GPT-4 untuk mengisi form otomatis.
   - Review manual sebelum publish.
4. **Manual Invoice Form**
   - Form lengkap dengan validasi & auto-calculation subtotal/pajak/total.
5. **Export ke PDF**
   - Template profesional, opsi download & preview.
   - Custom branding (logo, warna, font).
6. **Manajemen Status Invoice**
   - Alur status: Draft → Sent → Paid/Unpaid.
   - Timestamp otomatis + reminder invoice overdue.

---

## 🤖 Insight & Analitik
- Insight pembayaran: klien tercepat, invoice sering terlambat.
- Analitik pendapatan: tren bulanan/tahunan, kategori layanan, perbandingan periode.
- Rekomendasi AI: aksi proaktif (follow up, upsell, optimasi harga).

---

## 🗺️ Roadmap Lanjutan

### Phase 2 – Setelah MVP
- AI Chat Assistant untuk query bisnis natural language.
- Dashboard analytics lanjutan dan insight otomatis.
- Integrasi pembayaran Stripe & Midtrans.
- Email automation dengan template kustom dan reminder.
- Multi-template invoice & custom branding lanjutan.
- Client management (contact details, riwayat invoice, notes/tags).
- Recurring invoices & subscription billing.

### Phase 3 – Visi Jangka Panjang
- Mobile app (React Native) & multi-language support.
- Multi-currency & third-party API integration.
- Advanced reporting & custom dashboards.
- Team collaboration & role-based access control.
- Expense tracking, inventory integration, predictive analytics.
- Notifikasi multi-channel (WhatsApp/Telegram), marketplace freelancer, dan resource edukatif.

---

## 📊 Success Metrics
- ⚡ **Page load < 2 detik**.
- 📱 **100% responsive** di device utama.
- ♿ **Accessibility score > 90** (Lighthouse).
- 🐛 **Zero critical bugs** di produksi.
- ✅ **Test coverage > 80%** dengan lint/test/build otomatis.

---

## 🔐 Keamanan
- JWT dengan expiration & refresh token.
- Password hashing bcrypt (salt 10).
- Validasi & sanitasi input (Zod/Valibot).
- Rate limiting untuk endpoint sensitif.
- CORS terkendali & HTTPS only di produksi.
- Pencegahan SQL/NoSQL injection (ORM/ODM).
- Proteksi XSS & header keamanan standar.

---

## 🤝 Kontribusi
1. Fork repository ini.
2. Buat branch fitur: `git checkout -b feature/nama-fitur`.
3. Luluskan pipeline lokal: `npm run lint && npm run test && npm run build`.
4. Commit perubahan Anda dan push branch.
5. Buka Pull Request dengan deskripsi detail fitur/bugfix.

Panduan tambahan tersedia di `CONTRIBUTING.md` (coming soon).

---

## 📄 Lisensi
Project ini dirilis dengan lisensi **MIT**. Lihat berkas `LICENSE` untuk detail.

---

## 📞 Support
- 🐛 Laporkan issue melalui GitHub Issues.
- 📧 Email: your.email@example.com.
- 💬 Discord Community: _coming soon_.

---

<div align="center">
  <strong>Dibangun dengan ❤️ untuk freelancer dan bisnis kecil</strong>
</div>
