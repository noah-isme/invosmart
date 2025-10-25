import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pusat Bantuan",
};

const faqs = [
  {
    question: "Bagaimana cara menghasilkan insight AI?",
    answer:
      "Buka halaman AI Invoice Insights dan tekan tombol Regenerate Insight. Sistem akan mengirim ringkasan data invoice ke model GPT-4o untuk menghasilkan analisis personal.",
  },
  {
    question: "Apa yang terjadi jika layanan AI sedang down?",
    answer:
      "InvoSmart otomatis menampilkan insight fallback lokal sehingga Anda tetap mendapatkan rekomendasi yang relevan tanpa menghentikan pekerjaan.",
  },
  {
    question: "Bagaimana cara menghubungkan tema brand?",
    answer:
      "Gunakan menu Settings → Branding untuk menyinkronkan warna brand dengan tema aplikasi dan template PDF Anda.",
  },
];

export default function HelpPage() {
  return (
    <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 pb-24 pt-10">
      <section className="glass-surface relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-10 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-accent)_/_0.16),_transparent_60%)]" />
        <div className="relative space-y-4">
          <p className="text-xs uppercase tracking-[0.42em] text-text/50">Support & FAQ</p>
          <h1 className="text-4xl font-semibold text-text">Pusat Bantuan</h1>
          <p className="max-w-2xl text-base text-text/70">
            Temukan jawaban cepat untuk pertanyaan umum dan akses dokumentasi API InvoSmart.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-text/80">
            <Link
              href="mailto:support@invosmart.io"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 py-2 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              support@invosmart.io
            </Link>
            <a
              href="https://api.invosmart.dev/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-transparent px-4 py-2 text-text/80 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Dokumentasi API ↗
            </a>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-text">Pertanyaan yang sering diajukan</h2>
        <div className="space-y-4">
          {faqs.map((faq) => (
            <article
              key={faq.question}
              className="glass-surface space-y-2 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]"
            >
              <h3 className="text-lg font-semibold text-text">{faq.question}</h3>
              <p className="text-sm leading-relaxed text-text/70">{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
