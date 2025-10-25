import type { ReactNode } from "react";

type InsightCardProps = {
  title: string;
  description: string;
  recommendation: string;
  icon?: ReactNode;
  highlight?: string;
};

export function InsightCard({ title, description, recommendation, icon, highlight }: InsightCardProps) {
  return (
    <article className="glass-surface relative flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-out hover:-translate-y-1">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.18),_transparent_60%)]" />
      <div className="relative flex items-start gap-4">
        {icon ? (
          <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-xl text-text shadow-[0_12px_30px_rgba(8,10,16,0.35)]">
            {icon}
          </span>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-text">{title}</h3>
          <p className="text-sm text-text/70">{description}</p>
          {highlight ? <p className="text-sm font-medium text-accent/90">{highlight}</p> : null}
        </div>
      </div>
      <div className="relative rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-text/75">
        <p className="font-semibold text-text">Rekomendasi</p>
        <p className="mt-2 leading-relaxed text-text/70">{recommendation}</p>
      </div>
    </article>
  );
}
