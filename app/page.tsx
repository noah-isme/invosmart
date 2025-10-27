import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  Circle,
  CreditCard,
  FileText,
  Flag,
  LineChart,
  MessageSquare,
  Printer,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Feature = {
  title: string;
  description: string;
  icon: LucideIcon;
  highlight?: string;
};

type WorkflowStep = {
  title: string;
  description: string;
  icon: LucideIcon;
  detail: string;
};

type Insight = {
  title: string;
  description: string;
};

type SprintTask = {
  title: string;
  description: string;
  status: "done" | "pending";
};

type Sprint = {
  badge: string;
  title: string;
  objective: string;
  tasks: SprintTask[];
};

const mvpFeatures: Feature[] = [
  {
    title: "Autentikasi & Otorisasi",
    description:
      "Login & Register aman dengan email/password, dukungan Google OAuth, dan sesi berbasis JWT.",
    icon: ShieldCheck,
    highlight: "Google OAuth + JWT",
  },
  {
    title: "Dashboard Invoice",
    description:
      "Pantau semua invoice dalam satu tempat dengan filter status, quick stats, dan highlight invoice terbaru.",
    icon: LineChart,
    highlight: "Paid / Unpaid / Draft",
  },
  {
    title: "AI Invoice Generator",
    description:
      "Konversi instruksi natural language menjadi invoice profesional lengkap dengan detail klien dan perhitungan otomatis.",
    icon: BrainCircuit,
    highlight: "GPT-4 powered",
  },
  {
    title: "Manual Invoice Form",
    description:
      "Alternatif pembuatan invoice manual dengan validasi menyeluruh dan perhitungan subtotal, pajak, serta total otomatis.",
    icon: FileText,
  },
  {
    title: "Export ke PDF",
    description:
      "Template modern dan customizable siap dikirim dengan opsi download atau preview sebelum kirim ke klien.",
    icon: Printer,
  },
  {
    title: "Manajemen Status",
    description:
      "Atur status invoice dari draft hingga paid dengan reminder otomatis untuk invoice overdue.",
    icon: BellRing,
  },
];

const workflow: WorkflowStep[] = [
  {
    title: "Input & Parsing",
    description:
      "Pengguna memasukkan instruksi teks atau form manual, sistem memvalidasi dan mem-parsing detail invoice.",
    icon: MessageSquare,
    detail: "Natural language → structured data",
  },
  {
    title: "Generasi & Review",
    description:
      "AI menyusun invoice, menghitung total, dan menyiapkan template; pengguna dapat melakukan edit lanjutan.",
    icon: Sparkles,
    detail: "Auto-fill form + AI suggestion",
  },
  {
    title: "Distribusi & Tracking",
    description:
      "Invoice disimpan di dashboard, dapat diunduh sebagai PDF, dan status pembayaran dipantau otomatis.",
    icon: TrendingUp,
    detail: "Reminder & analytics ready",
  },
];

const insights: Insight[] = [
  {
    title: "Insight Pembayaran",
    description:
      "Identifikasi klien yang paling cepat membayar dan invoice yang sering terlambat untuk strategi tindak lanjut.",
  },
  {
    title: "Analitik Pendapatan",
    description:
      "Lihat tren pendapatan bulanan/tahunan, kategori layanan terbanyak, dan perbandingan periode otomatis.",
  },
  {
    title: "Rekomendasi AI",
    description:
      "AI memberikan rekomendasi aksi seperti menghubungi klien tertentu, optimasi harga, hingga peluang upsell.",
  },
];

const successMetrics: Insight[] = [
  {
    title: "< 2s page load",
    description: "Optimasi performa front-end untuk pengalaman responsif di perangkat apa pun.",
  },
  {
    title: "> 90 accessibility score",
    description: "Komitmen terhadap aksesibilitas dengan audit rutin Lighthouse dan praktik terbaik UI.",
  },
  {
    title: "> 80% test coverage",
    description: "Pipeline CI memastikan regressions tertangkap sejak awal melalui test dan lint otomatis.",
  },
  {
    title: "Zero critical bugs",
    description: "Monitoring real-time dan review code ketat menjaga kualitas produksi.",
  },
];

const futureHighlights: Feature[] = [
  {
    title: "AI Chat Assistant",
    description:
      "Assistant percakapan untuk menjawab pertanyaan bisnis seperti status pembayaran dan performa klien.",
    icon: MessageSquare,
    highlight: "Phase 2",
  },
  {
    title: "Payment Integration",
    description:
      "Integrasi Stripe & Midtrans untuk penerimaan pembayaran langsung dari invoice.",
    icon: CreditCard,
    highlight: "Phase 2",
  },
  {
    title: "Team Collaboration",
    description:
      "Kelola multi-user, akses role-based, dan kolaborasi tim pada invoice & klien.",
    icon: Users,
    highlight: "Phase 3",
  },
];

const sprintPhaseOne: {
  title: string;
  objective: string;
  sprints: Sprint[];
  deliverables: string[];
} = {
  title: "Phase 1 — MVP Development Sprint Plan",
  objective:
    "Tujuan: memastikan setiap dev environment, API, dan lint/test pipeline konsisten.",
  sprints: [
    {
      badge: "🗂️",
      title: "Sprint 0 — Persiapan & Fondasi Teknis",
      objective:
        "Tujuan: memastikan setiap dev environment, API, dan lint/test pipeline konsisten.",
      tasks: [
        {
          title: "Setup .env lokal",
          description:
            "Variabel: NEXT_PUBLIC_API_URL, JWT_SECRET, OPENAI_API_KEY, GEMINI_API_KEY",
          status: "pending",
        },
        {
          title: "Konfigurasi API Routes",
          description: "/api/auth, /api/invoices, /api/users",
          status: "pending",
        },
        {
          title: "Setup ORM (Prisma / Drizzle)",
          description: "Skema awal: User, Invoice",
          status: "pending",
        },
        {
          title: "Tambahkan seed & mock data",
          description: "Data dummy invoice untuk pengujian UI",
          status: "pending",
        },
        {
          title: "Perbarui CI lint/test/build",
          description: "Pastikan pipeline masih hijau",
          status: "pending",
        },
      ],
    },
    {
      badge: "🔐",
      title: "Sprint 1 — Authentication & Authorization",
      objective:
        "Tujuan: user dapat login, register, dan mengakses dashboard dengan session aman.",
      tasks: [
        {
          title: "Register & Login",
          description: "Email–password (NextAuth/Supabase Auth)",
          status: "pending",
        },
        {
          title: "JWT & Refresh Token",
          description: "Middleware auth di server routes",
          status: "pending",
        },
        {
          title: "Google OAuth",
          description: "Integrasi via NextAuth Google provider",
          status: "pending",
        },
        {
          title: "Protected Routes",
          description: "Redirect otomatis bila belum login",
          status: "pending",
        },
        {
          title: "Profile Page (optional)",
          description: "Menampilkan nama & email user aktif",
          status: "pending",
        },
        {
          title: "Testing",
          description: "Unit + integration (Vitest)",
          status: "pending",
        },
      ],
    },
    {
      badge: "💼",
      title: "Sprint 2 — Dashboard & Invoice CRUD",
      objective:
        "Tujuan: user bisa melihat, membuat, dan mengelola invoice manual.",
      tasks: [
        {
          title: "Dashboard utama",
          description: "Statistik: total pendapatan, unpaid, overdue",
          status: "pending",
        },
        {
          title: "Daftar invoice",
          description: "Filter berdasarkan status: Paid / Unpaid / Draft",
          status: "pending",
        },
        {
          title: "Form manual invoice",
          description: "Validasi Zod/Valibot, auto subtotal & pajak",
          status: "pending",
        },
        {
          title: "CRUD operasi",
          description: "Buat, edit, hapus, ubah status invoice",
          status: "pending",
        },
        {
          title: "Invoice detail view",
          description: "Halaman detail dengan metadata lengkap",
          status: "pending",
        },
        {
          title: "Testing",
          description: "Unit test form & API routes",
          status: "pending",
        },
      ],
    },
    {
      badge: "🤖",
      title: "Sprint 3 — AI Invoice Generator",
      objective:
        "Tujuan: user bisa membuat invoice melalui natural language (GPT-4 integration).",
      tasks: [
        {
          title: "Input prompt",
          description: "Textarea input: “buat invoice 2 juta …”",
          status: "pending",
        },
        {
          title: "Parsing via GPT-4 API",
          description: "Generate JSON draft (client, amount, desc)",
          status: "pending",
        },
        {
          title: "Review & edit hasil",
          description: "Form preview editable sebelum submit",
          status: "pending",
        },
        {
          title: "Validasi hasil",
          description: "Pastikan hasil GPT sesuai schema invoice",
          status: "pending",
        },
        {
          title: "Testing",
          description: "Mock OpenAI responses di Vitest",
          status: "pending",
        },
      ],
    },
    {
      badge: "🧾",
      title: "Sprint 4 — Export & Branding",
      objective:
        "Tujuan: user bisa mengekspor invoice profesional.",
      tasks: [
        {
          title: "Export ke PDF",
          description: "Gunakan pdf-lib / jsPDF",
          status: "pending",
        },
        {
          title: "Custom branding",
          description: "Logo, warna, font milik user",
          status: "pending",
        },
        {
          title: "Preview invoice",
          description: "Modal preview sebelum download",
          status: "pending",
        },
        {
          title: "Nomor invoice otomatis",
          description: "Format: INV-{tahun}{bulan}{seq}",
          status: "pending",
        },
        {
          title: "Testing",
          description: "Snapshot PDF output",
          status: "pending",
        },
      ],
    },
    {
      badge: "📊",
      title: "Sprint 5 — Insight & Analytics",
      objective:
        "Tujuan: menampilkan statistik sederhana berbasis data invoice.",
      tasks: [
        {
          title: "Pendapatan bulanan",
          description: "Grafik bar/line (Recharts)",
          status: "pending",
        },
        {
          title: "Invoice overdue",
          description: "Reminder & highlight warna",
          status: "pending",
        },
        {
          title: "Insight AI sederhana",
          description: "Misal “klien ABC sering telat bayar”",
          status: "pending",
        },
        {
          title: "Testing",
          description: "Mock dataset analytics",
          status: "pending",
        },
      ],
    },
    {
      badge: "🧹",
      title: "Sprint 6 — QA & Hardening",
      objective:
        "Tujuan: memastikan performa & kualitas produksi siap.",
      tasks: [
        {
          title: "Lint/Test/Build",
          description: "Semua pipeline hijau",
          status: "pending",
        },
        {
          title: "Responsiveness",
          description: "Uji di mobile/tablet/desktop",
          status: "pending",
        },
        {
          title: "Accessibility",
          description: "Lighthouse > 90",
          status: "pending",
        },
        {
          title: "Performance",
          description: "Page load < 2 detik",
          status: "pending",
        },
        {
          title: "Security",
          description: "Rate limit, sanitize input, HTTPS only",
          status: "pending",
        },
      ],
    },
  ],
  deliverables: [
    "Auth & Dashboard berfungsi penuh.",
    "CRUD invoice + AI generator dasar.",
    "Export PDF siap digunakan.",
    "Insight sederhana tampil.",
    "Pipeline CI stabil.",
  ],
};

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_55%),_radial-gradient(circle_at_bottom,_rgba(59,130,246,0.15),_transparent_60%)]" />
      <header className="border-b border-slate-800/60 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-20 md:px-10 md:py-24 lg:px-16">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-2xl flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Smart Invoice Assistant
              </span>
              <h1 className="text-4xl font-semibold leading-tight text-slate-50 sm:text-5xl">
                Buat, kelola, dan analisis invoice profesional dalam hitungan detik.
              </h1>
              <p className="text-lg text-slate-300 md:text-xl">
                InvoSmart menggabungkan AI, automasi, dan analitik bisnis untuk membantu freelancer serta bisnis kecil menyederhanakan arus kas dan meningkatkan profesionalitas.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Link
                  href="#mvp"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-500 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  Lihat MVP
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="#roadmap"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700 px-6 py-3 text-base font-semibold text-slate-100 transition hover:border-cyan-500 hover:text-cyan-200"
                >
                  Baca Roadmap Teknis
                </Link>
              </div>
            </div>
            <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-900/70 p-4">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-400">AI generated</p>
                <p className="mt-2 text-3xl font-semibold text-slate-50">Invoice <span className="text-cyan-300">98%</span> lebih cepat</p>
              </div>
              <div className="rounded-2xl bg-slate-900/70 p-4">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Reminder otomatis</p>
                <p className="mt-2 text-3xl font-semibold text-slate-50">Kurangi tagihan terlambat hingga <span className="text-cyan-300">45%</span></p>
              </div>
              <div className="rounded-2xl bg-slate-900/70 p-4 md:col-span-2">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Insight real-time</p>
                <p className="mt-2 text-3xl font-semibold text-slate-50">Pantau pendapatan & kesehatan bisnis secara otomatis</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-6 py-20 md:px-10 lg:px-16">
        <section id="plan" className="space-y-12">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
              🧭 Phase 1
            </span>
            <h2 className="text-3xl font-semibold text-slate-50 md:text-4xl">
              {sprintPhaseOne.title}
            </h2>
            <p className="max-w-3xl text-lg text-slate-300">{sprintPhaseOne.objective}</p>
          </div>
          <div className="flex flex-col gap-6">
            {sprintPhaseOne.sprints.map((sprint) => (
              <div
                key={sprint.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="text-2xl">
                        {sprint.badge}
                      </span>
                      <h3 className="text-xl font-semibold text-slate-50 md:text-2xl">
                        {sprint.title}
                      </h3>
                    </div>
                    <p className="max-w-3xl text-sm text-slate-300 md:text-base">
                      {sprint.objective}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 self-start rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300 md:self-center">
                    <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                    Backlog siap
                  </span>
                </div>
                <ul className="mt-6 space-y-4">
                  {sprint.tasks.map((task) => (
                    <li key={task.title} className="flex items-start gap-3">
                      <span className="mt-1 flex h-6 w-6 items-center justify-center">
                        {task.status === "done" ? (
                          <CheckCircle2 className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                        ) : (
                          <Circle className="h-5 w-5 text-slate-600" aria-hidden="true" />
                        )}
                        <span className="sr-only">
                          {task.status === "done" ? "Selesai" : "Belum selesai"}
                        </span>
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-100 md:text-base">
                          {task.title}
                        </p>
                        <p className="text-xs text-slate-400 md:text-sm">{task.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-cyan-500/40 bg-cyan-500/10 p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-900">
                <Flag className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-slate-50 md:text-xl">
                  🚀 Deliverables Akhir Phase 1
                </h3>
                <ul className="space-y-2 text-sm text-slate-100 md:text-base">
                  {sprintPhaseOne.deliverables.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-1 h-2 w-2 rounded-full bg-cyan-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
        <section id="mvp" className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold text-slate-50">Fitur MVP InvoSmart</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Fokus awal kami adalah menghadirkan pengalaman pembuatan invoice yang lengkap: autentikasi aman, dashboard komprehensif, hingga generator AI dan ekspor PDF profesional.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {mvpFeatures.map((feature) => (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-cyan-500/60 hover:bg-slate-900/70"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
                    <feature.icon className="h-6 w-6" />
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl font-semibold text-slate-50">{feature.title}</h3>
                      {feature.highlight ? (
                        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                          {feature.highlight}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-300">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold text-slate-50">Alur Kerja Otomatis</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Proses end-to-end memastikan invoice siap dikirim dalam tiga langkah utama—mulai dari input perintah hingga analitik pembayaran.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {workflow.map((step) => (
              <div
                key={step.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
                  <step.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-50">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{step.description}</p>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold text-slate-50">Insight & Analitik AI</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Insight otomatis membantu Anda mengambil keputusan bisnis yang lebih cepat, mulai dari analisa cashflow hingga rekomendasi tindak lanjut.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {insights.map((insight) => (
              <div
                key={insight.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-50">{insight.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">{insight.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold text-slate-50">Key Success Metrics</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Deliverable teknis dan kualitas produk dipantau terus-menerus untuk memastikan pengalaman kelas profesional bagi pengguna akhir.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {successMetrics.map((metric) => (
              <div
                key={metric.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-50">{metric.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">{metric.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="roadmap" className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold text-slate-50">Roadmap Lanjutan</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Setelah MVP, roadmap fokus pada otomatisasi lebih dalam, kolaborasi tim, hingga integrasi pembayaran untuk ekosistem invoicing end-to-end.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {futureHighlights.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
                    <item.icon className="h-6 w-6" />
                  </span>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-slate-50">{item.title}</h3>
                      {item.highlight ? (
                        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                          {item.highlight}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/60 bg-slate-950/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-12 text-sm text-slate-400 md:flex-row md:items-center md:justify-between md:px-10 lg:px-16">
          <p>&copy; {new Date().getFullYear()} InvoSmart. Dibangun dengan ❤️ untuk freelancer dan bisnis kecil.</p>
          <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.18em]">
            <span>AI powered automation</span>
            <span>Secure by design</span>
            <span>Insight driven</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
