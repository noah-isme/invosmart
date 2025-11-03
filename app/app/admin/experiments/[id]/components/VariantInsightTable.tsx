import { ExperimentAxis } from "@prisma/client";

const formatNumber = (value: number) => value.toLocaleString("id-ID");
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const variantTitle = (variant: SerializableVariant) => {
  const rawPayload = variant.payload;
  const payload = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : {};
  if (typeof payload.hook === "string" && payload.hook) return payload.hook;
  if (typeof payload.caption === "string" && payload.caption) return payload.caption;
  if (typeof payload.cta === "string" && payload.cta) return payload.cta;
  if (typeof payload.schedule === "object" && payload.schedule) {
    const schedule = payload.schedule as { day?: string; hour?: number; window?: string };
    return `${schedule.day ?? "Hari"} • ${schedule.hour ?? "--"}`;
  }
  return variant.variantKey;
};

type SerializableVariant = {
  id: number;
  variantKey: string;
  payload: unknown;
  aiExplanation?: string | null;
  confidence?: number | null;
  performance: {
    impressions: number;
    clicks: number;
    conversions: number;
    dwellMs: number;
  };
  engagement: {
    score: number;
    ctr: number;
    conversionRate: number;
    averageDwellMs: number;
  };
  uplift: number;
  pValue: number;
  totalSample: number;
  isWinner: boolean;
};

type SerializableExperiment = {
  experiment: {
    axis: ExperimentAxis;
  };
  variants: SerializableVariant[];
  baselineVariantId: number | null;
  winnerVariantId: number | null;
};

type VariantInsightTableProps = {
  experiment: SerializableExperiment;
};

export function VariantInsightTable({ experiment }: VariantInsightTableProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5">
      <header className="border-b border-white/10 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Varian &amp; Metrik</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-white/80">
          <thead className="bg-white/10 text-xs uppercase text-white/60">
            <tr>
              <th className="px-6 py-3">Varian</th>
              <th className="px-6 py-3">Penjelasan</th>
              <th className="px-6 py-3">Confidence</th>
              <th className="px-6 py-3">Impressions</th>
              <th className="px-6 py-3">CTR</th>
              <th className="px-6 py-3">Konversi</th>
              <th className="px-6 py-3">Dwell Avg</th>
              <th className="px-6 py-3">Skor</th>
              <th className="px-6 py-3">p-value</th>
            </tr>
          </thead>
          <tbody>
            {experiment.variants.map((variant) => (
              <tr
                key={variant.id}
                className={`border-t border-white/10 ${variant.isWinner ? "bg-emerald-500/10" : ""}`}
              >
                <td className="px-6 py-3 align-top">
                  <div className="flex flex-col">
                    <span className="font-medium text-white">{variantTitle(variant)}</span>
                    <span className="text-xs text-white/50">Key: {variant.variantKey}</span>
                  </div>
                </td>
                <td className="px-6 py-3 align-top max-w-[260px] text-xs text-white/60">
                  {variant.aiExplanation ?? "—"}
                </td>
                <td className="px-6 py-3 align-top">{variant.confidence ? formatPercent(variant.confidence) : "–"}</td>
                <td className="px-6 py-3 align-top">{formatNumber(variant.performance.impressions)}</td>
                <td className="px-6 py-3 align-top">{formatPercent(variant.engagement.ctr)}</td>
                <td className="px-6 py-3 align-top">{formatNumber(variant.performance.conversions)}</td>
                <td className="px-6 py-3 align-top">{Math.round(variant.engagement.averageDwellMs)} ms</td>
                <td className="px-6 py-3 align-top">{variant.engagement.score.toFixed(2)}</td>
                <td className="px-6 py-3 align-top">{variant.pValue.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
