'use client';

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  CreditCard,
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

type Metric = {
  label: string;
  value: string;
  detail: string;
};

type ExperienceHighlight = {
  tag: string;
  title: string;
  description: string;
  accent: string;
};

type Testimonial = {
  quote: string;
  author: string;
  role: string;
};

const viewport = { once: true, amount: 0.25 };

const fadeUp = {
  hidden: { opacity: 0, y: 36 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: "easeOut" } },
};

const blurIn = {
  hidden: { opacity: 0, filter: "blur(6px)", y: 20 },
  visible: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.9, ease: "easeOut" } },
};

const heroStats: Metric[] = [
  { label: "Invoice diproses", value: "12K+", detail: "per bulan" },
  { label: "Nilai transaksi", value: "$8.2M", detail: "nilai tahunan" },
  { label: "Skor kepuasan", value: "4.9/5", detail: "420+ bisnis" },
];

const premiumFeatures: Feature[] = [
  {
    title: "AI Invoice Composer",
    description:
      "Masukkan perintah natural, InvoSmart menyusun invoice dengan detail klien, termin, dan multi-item otomatis.",
    icon: BrainCircuit,
    highlight: "GPT-4 native",
  },
  {
    title: "Live Cashflow Board",
    description:
      "Dashboard signature menampilkan paid, overdue, dan proyeksi kas nyata agar keputusan finansial makin cepat.",
    icon: LineChart,
    highlight: "Realtime",
  },
  {
    title: "Signature PDF Export",
    description:
      "Template premium dengan logo, tipografi, dan cover letter elegan siap dikirim dalam sekali klik.",
    icon: Printer,
    highlight: "Brand kit",
  },
  {
    title: "Smart Reminder Engine",
    description:
      "Rangkaian reminder otomatis via email & WhatsApp menjaga cashflow tanpa perlu mengejar manual.",
    icon: BellRing,
    highlight: "Auto follow-up",
  },
  {
    title: "Payment-ready Links",
    description:
      "Lampirkan tautan Stripe, Midtrans, atau VA sehingga klien dapat langsung membayar dari invoice.",
    icon: CreditCard,
    highlight: "Instant pay",
  },
  {
    title: "Role-based Workspace",
    description:
      "Kelola akses finance, partner, hingga legal dengan audit trail detail untuk setiap perubahan.",
    icon: Users,
    highlight: "Team mode",
  },
];

const experienceHighlights: ExperienceHighlight[] = [
  {
    tag: "Brand layer",
    title: "Template signature siap tayang",
    description:
      "Cuplikan invoice tampil seperti dek presentasi: cover hero, palet warna eksklusif, dan tipografi custom.",
    accent: "bg-emerald-500/15 text-emerald-200",
  },
  {
    tag: "Smart fields",
    title: "Dynamic data binding",
    description:
      "Field otomatis menarik histori klien, termin, pajak, dan mata uang sesuai konteks tanpa copy–paste.",
    accent: "bg-cyan-500/15 text-cyan-200",
  },
  {
    tag: "Audit trail",
    title: "Timeline status transparan",
    description:
      "Pantau siapa yang membuka, menyetujui, dan membayar invoice secara real-time langsung dari dashboard.",
    accent: "bg-violet-500/15 text-violet-200",
  },
];

const automationFlow: WorkflowStep[] = [
  {
    title: "Input & intent",
    description:
      "Pengguna menulis instruksi natural atau mengisi form elegan, AI memahami konteks proyek dan termin.",
    icon: MessageSquare,
    detail: "Bahasa natural → data rapi",
  },
  {
    title: "Compose & approve",
    description:
      "Draft lengkap beserta angka dan brand kit otomatis siap direview, diedit, lalu dikunci dengan signature.",
    icon: Sparkles,
    detail: "AI drafting + human review",
  },
  {
    title: "Publish & track",
    description:
      "Invoice dikirim bersama tautan pembayaran, reminder aktif, dan analitik pembayaran real-time.",
    icon: TrendingUp,
    detail: "Reminder + insight",
  },
];

const insightModules: Insight[] = [
  {
    title: "Insight pembayaran",
    description:
      "Identifikasi klien yang cepat, lambat, hingga churn risk dengan satu tatapan di cashflow board.",
  },
  {
    title: "Forecast pendapatan",
    description:
      "Proyeksi bulanan dan tahunan otomatis membantu Anda merencanakan hiring atau investasi berikutnya.",
  },
  {
    title: "Rekomendasi AI",
    description:
      "Mesin rekomendasi memberi saran kapan follow-up, menawar ulang harga, atau upsell layanan.",
  },
];

const guaranteePoints: Insight[] = [
  {
    title: "< 2 detik",
    description: "Halaman dimuat super cepat dengan optimasi streaming & image delivery terbaru.",
  },
  {
    title: "> 90 skor aksesibilitas",
    description: "Kontras, keyboard navigation, dan audit rutin memastikan semua user nyaman.",
  },
  {
    title: "> 80% coverage",
    description: "Unit & e2e test menjaga fitur kritikal tetap stabil sebelum menyentuh produksi.",
  },
  {
    title: "Zero critical bugs",
    description: "Observability real-time + alerting memastikan isu krusial tertangani < 30 menit.",
  },
];

const testimonials: Testimonial[] = [
  {
    quote:
      "InvoSmart menggantikan tiga tools berbeda. Invoice kami sekarang menyerupai coffee table book sekaligus bisa dibayar langsung.",
    author: "Nadya Putri",
    role: "Founder, Atelier Nord",
  },
  {
    quote:
      "Dashboard-nya seperti wealth report pribadi. Reminder otomatisnya membuat kami berhenti mengirim chat penagihan manual.",
    author: "Arsen Pratama",
    role: "Finance Lead, SCALE Digital",
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_55%),_radial-gradient(circle_at_bottom,_rgba(14,165,233,0.16),_transparent_50%)]" />
      <div className="absolute -left-20 top-24 -z-10 h-72 w-72 rounded-full bg-cyan-500/20 blur-[120px]" aria-hidden="true" />
      <div className="absolute bottom-0 right-0 -z-10 h-80 w-80 rounded-full bg-violet-600/10 blur-[140px]" aria-hidden="true" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-24 px-6 py-16 md:px-10 lg:px-16">
        <motion.header
          className="relative isolate overflow-hidden rounded-[40px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-16 shadow-[0_40px_120px_rgba(15,23,42,0.7)] md:px-12"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        >
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="space-y-8">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-slate-200">
                InvoSmart OS 02
              </span>
              <div className="space-y-6">
                <h1 className="text-4xl font-semibold leading-tight text-slate-50 sm:text-5xl">
                  Suite invoicing premium yang terasa seperti concierge pribadi.
                </h1>
                <p className="text-lg text-slate-300">
                  Kombinasi AI, automasi pembayaran, dan desain editorial menjadikan setiap invoice terasa eksklusif—tanpa meninggalkan efisiensi operasional.
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Link
                  href="#experience"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400/90 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Mulai demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="#features"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 px-6 py-3 text-base font-semibold text-slate-100 transition hover:border-cyan-400"
                >
                  Jelajahi produk
                </Link>
              </div>
              <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
                {["AI invoice composer", "PDF elegan siap kirim", "Insight cashflow real-time", "Payment link terpasang"].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                      <span>{item}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 rounded-[32px] bg-gradient-to-br from-cyan-500/30 via-white/5 to-transparent blur-3xl" aria-hidden="true" />
              <motion.div
                className="relative rounded-[32px] border border-white/10 bg-white/5 p-8 backdrop-blur"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
                whileHover={{ y: -4 }}
              >
                <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Luxury control board</p>
                <p className="mt-4 text-4xl font-semibold text-slate-50">Kas bersih +48%</p>
                <p className="mt-2 text-sm text-slate-300">Automasi reminder & payment link aktif.</p>
                <div className="mt-8 space-y-5">
                  <motion.div
                    className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 6, repeat: Infinity, repeatType: "mirror" }}
                  >
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Auto reminder</span>
                      <span className="text-cyan-300">On schedule</span>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-slate-800">
                      <div className="h-2 w-3/4 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />
                    </div>
                  </motion.div>
                  <motion.div
                    className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 5, repeat: Infinity, repeatType: "mirror" }}
                  >
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Designer PDF</span>
                      <span className="text-cyan-300">Ready</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-slate-400">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Palette</p>
                        <p className="mt-1 text-lg font-semibold text-slate-50">Noir</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Typeface</p>
                        <p className="mt-1 text-lg font-semibold text-slate-50">Clash</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Seal</p>
                        <p className="mt-1 text-lg font-semibold text-slate-50">Digital</p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
          <div className="mt-12 grid gap-4 border-t border-white/5 pt-10 sm:grid-cols-3">
            {heroStats.map((stat, index) => (
              <motion.div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewport}
                transition={{ delay: 0.15 * index, duration: 0.65, ease: "easeOut" }}
              >
                <p className="text-sm uppercase tracking-[0.35em] text-slate-400">{stat.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-50">{stat.value}</p>
                <p className="text-sm text-slate-400">{stat.detail}</p>
              </motion.div>
            ))}
          </div>
        </motion.header>

        <motion.section
          id="experience"
          className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <motion.div
            className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-10"
            variants={blurIn}
            viewport={viewport}
            whileHover={{ borderColor: "rgba(255,255,255,0.35)" }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/10" aria-hidden="true" />
            <div className="relative z-10 space-y-6">
              <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Experience layer</p>
              <h2 className="text-3xl font-semibold text-slate-50">Invoice yang terasa seperti presentasi executive.</h2>
              <p className="text-lg text-slate-300">
                Kustomisasi menyeluruh tanpa kompleksitas: highlight proyek, section ringkasan, hingga CTA pembayaran menyatu dalam satu kanvas elegan.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Mode</p>
                  <p className="mt-2 text-2xl font-semibold">Client ready</p>
                  <p className="text-sm text-slate-400">Checklist legal, PPN, dan data bank otomatis.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Signature</p>
                  <p className="mt-2 text-2xl font-semibold">E-sign locked</p>
                  <p className="text-sm text-slate-400">Audit trail menunjukkan waktu & perangkat.</p>
                </div>
              </div>
            </div>
          </motion.div>
          <div className="grid gap-6">
            {experienceHighlights.map((highlight) => (
              <motion.div
                key={highlight.title}
                className="rounded-[28px] border border-white/10 bg-slate-950/60 p-6"
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                whileHover={{ y: -6, borderColor: "rgba(255,255,255,0.4)" }}
              >
                <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${highlight.accent}`}>
                  {highlight.tag}
                </span>
                <h3 className="mt-4 text-xl font-semibold text-slate-50">{highlight.title}</h3>
                <p className="mt-2 text-sm text-slate-300">{highlight.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          id="features"
          className="space-y-8"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-200">Premium capabilities</p>
            <h2 className="text-3xl font-semibold text-slate-50">Satu platform untuk membuat, mengirim, hingga menutup invoice.</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Setiap fitur dirancang menyerupai fintech kelas atas: aksen halus, transisi lembut, dan fokus pada detail bisnis kritikal.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {premiumFeatures.map((feature) => (
              <motion.div
                key={feature.title}
                className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-slate-950/60 via-slate-900/40 to-slate-950/60 p-6"
                variants={scaleIn}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                whileHover={{ y: -4, borderColor: "rgba(255,255,255,0.35)" }}
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-cyan-300">
                    <feature.icon className="h-6 w-6" />
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl font-semibold text-slate-50">{feature.title}</h3>
                      {feature.highlight ? (
                        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">
                          {feature.highlight}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-300">{feature.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          className="space-y-8"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-200">Automation DNA</p>
            <h2 className="text-3xl font-semibold text-slate-50">Workflow otomasi yang menjaga pengalaman premium.</h2>
            <p className="max-w-3xl text-lg text-slate-300">
              Mulai dari brief singkat hingga invoice lunas, setiap langkah dibantu AI namun tetap menyisakan sentuhan manusia untuk akurasi.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {automationFlow.map((step) => (
              <motion.div
                key={step.title}
                className="rounded-[28px] border border-white/10 bg-slate-950/60 p-6"
                variants={scaleIn}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                whileHover={{ y: -4, borderColor: "rgba(255,255,255,0.35)" }}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-cyan-300">
                  <step.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-50">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{step.description}</p>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200">{step.detail}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <motion.div className="space-y-6" variants={fadeUp}>
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-200">Insight & intelligence</p>
            <h2 className="text-3xl font-semibold text-slate-50">Analitik dan rekomendasi yang siap ditindaklanjuti.</h2>
            <div className="grid gap-6 md:grid-cols-2">
              {insightModules.map((insight) => (
                <motion.div
                  key={insight.title}
                  className="rounded-[26px] border border-white/10 bg-slate-950/60 p-6"
                  variants={scaleIn}
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                >
                  <h3 className="text-lg font-semibold text-slate-50">{insight.title}</h3>
                  <p className="mt-3 text-sm text-slate-300">{insight.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
          <motion.div
            className="rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950/60 via-slate-900/50 to-slate-950/60 p-8"
            variants={blurIn}
            viewport={viewport}
          >
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-cyan-300">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Quality pledge</p>
                <h3 className="text-xl font-semibold text-slate-50">Stabil, aman, dan siap produksi.</h3>
              </div>
            </div>
            <ul className="mt-8 space-y-5 text-sm text-slate-300">
              {guaranteePoints.map((point) => (
                <li key={point.title} className="flex gap-3">
                  <CheckCircle2 className="mt-1 h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-slate-50">{point.title}</p>
                    <p>{point.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.section>

        <motion.section
          className="space-y-8"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-200">Trusted voices</p>
            <h2 className="text-3xl font-semibold text-slate-50">Dirancang untuk studio kreatif, konsultan, hingga venture-backed startup.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {testimonials.map((testimonial) => (
              <motion.div
                key={testimonial.author}
                className="rounded-[28px] border border-white/10 bg-slate-950/60 p-6"
                variants={scaleIn}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
              >
                <p className="text-lg leading-relaxed text-slate-200">“{testimonial.quote}”</p>
                <div className="mt-4 text-sm text-slate-400">
                  <p className="font-semibold text-slate-50">{testimonial.author}</p>
                  <p>{testimonial.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          className="rounded-[36px] border border-white/10 bg-gradient-to-r from-cyan-500/20 via-violet-500/20 to-cyan-500/20 px-8 py-12 text-center backdrop-blur"
          variants={blurIn}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          <p className="text-sm uppercase tracking-[0.4em] text-slate-200">Ready to elevate</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-50">Bawa pengalaman invoice premium ke semua klien Anda.</h2>
          <p className="mt-3 text-lg text-slate-200">
            Mulai dengan demo terpandu atau langsung hubungkan workspace Anda dan rasakan alur baru yang lebih elegan.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              Masuk Workspace
            </Link>
            <Link
              href="mailto:hello@invosmart.app"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-base font-semibold text-white transition hover:border-white"
            >
              Hubungi konsultan
            </Link>
          </div>
        </motion.section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-12 text-sm text-slate-400 md:flex-row md:items-center md:justify-between md:px-10 lg:px-16">
          <p>&copy; {new Date().getFullYear()} InvoSmart. Crafted for mereka yang menghargai detail.</p>
          <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.25em]">
            <span>AI concierge</span>
            <span>Secure by design</span>
            <span>Insight driven</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
