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
