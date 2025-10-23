import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  BrainCircuit,
  CreditCard,
  FileText,
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
