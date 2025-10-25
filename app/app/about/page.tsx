import Link from "next/link";
import { Metadata } from "next";

import {
  APP_VERSION,
  CHANGELOG_PATH,
  getCommitHashShort,
  getReadableBuildDate,
} from "@/lib/release";

export const metadata: Metadata = {
  title: "Tentang InvoSmart",
};

export default function AboutPage() {
  const buildDate = getReadableBuildDate();
  const commitShort = getCommitHashShort();

  return (
    <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 pb-24 pt-10">
      <section className="glass-surface relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-10 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.18),_transparent_60%)]" />
        <div className="relative space-y-4">
          <p className="text-xs uppercase tracking-[0.42em] text-text/50">Visi produk</p>
          <h1 className="text-4xl font-semibold text-text">InvoSmart {APP_VERSION}</h1>
          <p className="max-w-2xl text-base text-text/70">
            InvoSmart membantu bisnis kreatif mengelola invoice, branding, dan insight finansial dalam satu workspace modern.
            Rilis publik {APP_VERSION} menghadirkan pengalaman premium dengan AI insight, tema adaptif, serta performa tinggi yang siap untuk klien enterprise.
          </p>
          <dl className="grid gap-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-sm text-text/70 md:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Build version</dt>
              <dd className="text-base font-semibold text-text">{APP_VERSION}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Build date</dt>
              <dd className="text-base font-semibold text-text">{buildDate}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.32em] text-text/40">Commit</dt>
              <dd className="text-base font-semibold text-text">{commitShort}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-4 text-sm text-text/70">
            <Link
              href={CHANGELOG_PATH}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Lihat changelog lengkap
              <span aria-hidden>↗</span>
            </Link>
            <a
              href="https://github.com/invosmart"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              GitHub Repository
              <span aria-hidden>↗</span>
            </a>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold text-text">Changelog singkat</h2>
          <p className="text-sm text-text/65">Highlight rilis publik terbaru.</p>
        </header>
        <article className="glass-surface space-y-3 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-text">{APP_VERSION}</h3>
            <span className="text-sm text-text/60">{buildDate}</span>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm text-text/70">
            <li>🎨 Complete AI theme & branding sync</li>
            <li>📊 Added AI-powered insights</li>
            <li>🧾 PDF and dashboard fully integrated</li>
            <li>🚀 Production telemetry and CI/CD pipeline</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
