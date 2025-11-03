"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ScheduleRecommendation } from "@/lib/ai/scheduler";

const formatDateTime = (value: string) => new Date(value).toLocaleString("id-ID", { hour12: false });

const defaultMetrics = {
  impressions: "",
  clicks: "",
  conversions: "",
  dwellMs: "60000",
};

type SerializableVariant = {
  id: number;
  variantKey: string;
  payload: unknown;
};

type VariantActionPanelProps = {
  experimentId: number;
  contentId: number;
  organizationId?: string;
  variants: SerializableVariant[];
  winnerVariantId?: number;
  scheduleRecommendation?: ScheduleRecommendation | null;
};

const variantLabel = (variant: SerializableVariant) => {
  const rawPayload = variant.payload;
  const payload = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : {};
  if (typeof payload.hook === "string" && payload.hook) return payload.hook;
  if (typeof payload.caption === "string" && payload.caption) return payload.caption;
  if (typeof payload.cta === "string" && payload.cta) return payload.cta;
  if (typeof payload.schedule === "object" && payload.schedule) {
    const schedule = payload.schedule as { day?: string; hour?: number; window?: string };
    return `${schedule.day ?? "Hari"} ${schedule.hour ?? ""}`;
  }
  return variant.variantKey;
};

export function VariantActionPanel({
  experimentId,
  contentId,
  organizationId,
  variants,
  winnerVariantId,
  scheduleRecommendation,
}: VariantActionPanelProps) {
  const router = useRouter();
  const [metricsState, setMetricsState] = useState(defaultMetrics);
  const [selectedVariant, setSelectedVariant] = useState(() => variants[0]?.id ?? 0);
  const [winnerCandidate, setWinnerCandidate] = useState(() => winnerVariantId ?? variants[0]?.id ?? 0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const variantOptions = useMemo(() => variants.map((variant) => ({ id: variant.id, label: variantLabel(variant) })), [variants]);

  const handleGenerateVariant = async () => {
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/opt/local/variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimentId }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Gagal membuat varian baru");
      }

      setFeedback("Varian AI baru dihasilkan.");
      await router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordMetrics = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/opt/local/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: selectedVariant,
          impressions: Number.parseInt(metricsState.impressions || "0", 10),
          clicks: Number.parseInt(metricsState.clicks || "0", 10),
          conversions: Number.parseInt(metricsState.conversions || "0", 10),
          dwellMs: Number.parseInt(metricsState.dwellMs || "0", 10),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Gagal mencatat metrik");
      }

      setFeedback("Metrik varian diperbarui.");
      setMetricsState(defaultMetrics);
      await router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleChooseWinner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/opt/choose-winner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimentId, variantId: winnerCandidate }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Gagal memilih pemenang");
      }

      setFeedback("Pemenang eksperimen diset.");
      await router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplySchedule = async () => {
    if (!scheduleRecommendation) return;
    setLoading(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/opt/schedule/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          contentId,
          experimentId,
          recommendation: scheduleRecommendation,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Gagal menerapkan jadwal");
      }

      const data = await response.json();
      if (!data.applied) {
        setError(data.message ?? "Perlu approval manual");
      } else {
        setFeedback("Jadwal otomatis diterapkan dan dicatat di AUTO log.");
      }
      await router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Tindakan Eksperimen</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4">
            <h3 className="text-sm font-semibold text-white">Generate Variant AI</h3>
            <p className="text-xs text-white/60">
              Sistem akan membuat varian baru berbasis pola global dan baseline konten.
            </p>
            <button
              onClick={handleGenerateVariant}
              disabled={loading}
              className="self-start rounded-full bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-400"
            >
              {loading ? "Memproses..." : "Generate Variant"}
            </button>
          </div>

          <form className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4" onSubmit={handleRecordMetrics}>
            <h3 className="text-sm font-semibold text-white">Catat Metrik Varian</h3>
            <label className="text-xs text-white/60">
              Varian
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white"
                value={selectedVariant}
                onChange={(event) => setSelectedVariant(Number.parseInt(event.target.value, 10))}
              >
                {variantOptions.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs text-white/60">
              <label>
                Impressions
                <input
                  type="number"
                  min={0}
                  value={metricsState.impressions}
                  onChange={(event) => setMetricsState((prev) => ({ ...prev, impressions: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-white"
                />
              </label>
              <label>
                Clicks
                <input
                  type="number"
                  min={0}
                  value={metricsState.clicks}
                  onChange={(event) => setMetricsState((prev) => ({ ...prev, clicks: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-white"
                />
              </label>
              <label>
                Conversions
                <input
                  type="number"
                  min={0}
                  value={metricsState.conversions}
                  onChange={(event) => setMetricsState((prev) => ({ ...prev, conversions: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-white"
                />
              </label>
              <label>
                Dwell (ms)
                <input
                  type="number"
                  min={0}
                  value={metricsState.dwellMs}
                  onChange={(event) => setMetricsState((prev) => ({ ...prev, dwellMs: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-white"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="self-start rounded-full bg-white/20 px-4 py-2 text-xs font-semibold text-white hover:bg-white/30"
            >
              {loading ? "Memproses..." : "Simpan Metrik"}
            </button>
          </form>
        </div>

        <form className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4" onSubmit={handleChooseWinner}>
          <h3 className="text-sm font-semibold text-white">Tetapkan Pemenang</h3>
          <p className="text-xs text-white/60">Pemenang akan menutup eksperimen dan siap diterapkan permanen.</p>
          <label className="text-xs text-white/60">
            Varian Pemenang
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white"
              value={winnerCandidate}
              onChange={(event) => setWinnerCandidate(Number.parseInt(event.target.value, 10))}
            >
              {variantOptions.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="self-start rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
          >
            {loading ? "Memproses..." : "Set Pemenang"}
          </button>
        </form>

        {scheduleRecommendation && (
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Rekomendasi Jadwal</h3>
                <p className="text-xs text-white/60">
                  {scheduleRecommendation.reason} • {formatDateTime(scheduleRecommendation.recommendedAt)}
                </p>
                <p className="text-xs text-white/40">
                  Confidence {Math.round(scheduleRecommendation.confidence * 100)}% • Quota sisa {scheduleRecommendation.quotaRemaining}/{scheduleRecommendation.limit}
                </p>
              </div>
              <button
                onClick={handleApplySchedule}
                disabled={loading || !scheduleRecommendation.autoEligible}
                className="rounded-full bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/10"
              >
                {scheduleRecommendation.autoEligible ? "Auto Apply" : "Butuh Approval"}
              </button>
            </div>
          </div>
        )}

        {feedback && <p className="text-sm text-emerald-300">{feedback}</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </section>
  );
}
