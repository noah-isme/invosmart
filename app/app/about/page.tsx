import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tentang InvoSmart",
};

const changelog = [
  {
    version: "v1.0.0",
    date: "Desember 2024",
    highlights: [
      "Peluncuran AI Invoice Insights dengan rekomendasi kontekstual.",
      "Integrasi tema AI dan generator PDF profesional.",
      "Peningkatan performa dan aksesibilitas untuk rilis publik.",
    ],
  },
];

export default function AboutPage() {
  return (
    <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 pb-24 pt-10">
      <section className="glass-surface relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-10 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.18),_transparent_60%)]" />
        <div className="relative space-y-4">
          <p className="text-xs uppercase tracking-[0.42em] text-text/50">Visi produk</p>
          <h1 className="text-4xl font-semibold text-text">InvoSmart v1.0.0</h1>
          <p className="max-w-2xl text-base text-text/70">
            InvoSmart membantu bisnis kreatif mengelola invoice, branding, dan insight finansial dalam satu workspace modern.
            Rilis publik v1.0.0 menghadirkan pengalaman premium dengan AI insight, tema adaptif, serta performa tinggi yang siap untuk klien enterprise.
          </p>
          <dl className="grid gap-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-sm text-text/70 md:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Build version</dt>
              <dd className="text-base font-semibold text-text">v1.0.0</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Status</dt>
              <dd className="text-base font-semibold text-text">Public Release</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Repository</dt>
              <dd className="text-base font-semibold text-text/80">
                <a
                  href="https://github.com/invosmart"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-4 transition hover:text-text"
                >
                  github.com/invosmart
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold text-text">Changelog singkat</h2>
          <p className="text-sm text-text/65">Highlight rilis publik terbaru.</p>
        </header>
        <div className="space-y-4">
          {changelog.map((entry) => (
            <article
              key={entry.version}
              className="glass-surface space-y-3 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-text">{entry.version}</h3>
                <span className="text-sm text-text/60">{entry.date}</span>
              </div>
              <ul className="list-disc space-y-2 pl-5 text-sm text-text/70">
                {entry.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
