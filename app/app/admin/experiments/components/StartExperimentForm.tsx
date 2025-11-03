"use client";

import { ExperimentAxis } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const axisOptions: { value: ExperimentAxis; label: string; helper: string }[] = [
  { value: "HOOK", label: "Hook", helper: "Pembuka untuk menarik perhatian" },
  { value: "CAPTION", label: "Caption", helper: "Penjelasan utama konten" },
  { value: "CTA", label: "CTA", helper: "Ajak pengguna bertindak" },
  { value: "SCHEDULE", label: "Scheduling", helper: "Waktu publikasi" },
];

const scheduleDays = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

type BaselineState = {
  hook: string;
  caption: string;
  cta: string;
  scheduleDay: string;
  scheduleHour: number;
};

const defaultBaseline: BaselineState = {
  hook: "",
  caption: "",
  cta: "",
  scheduleDay: "Senin",
  scheduleHour: 9,
};

export function StartExperimentForm() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string>("");
  const [contentId, setContentId] = useState<string>("");
  const [axis, setAxis] = useState<ExperimentAxis>("HOOK");
  const [baseline, setBaseline] = useState<BaselineState>(defaultBaseline);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    const payload: Record<string, unknown> = {};
    if (baseline.hook) payload.hook = baseline.hook;
    if (baseline.caption) payload.caption = baseline.caption;
    if (baseline.cta) payload.cta = baseline.cta;
    if (axis === "SCHEDULE") {
      payload.schedule = {
        day: baseline.scheduleDay,
        hour: baseline.scheduleHour,
      };
    }

    try {
      const response = await fetch("/api/opt/local/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId || undefined,
          contentId: Number.parseInt(contentId, 10),
          axis,
          baseline: payload,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Gagal membuat eksperimen");
      }

      setMessage("Eksperimen dimulai. Variasi baseline siap diukur.");
      setBaseline(defaultBaseline);
      setContentId("");
      await router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-xl font-semibold text-white">Mulai Eksperimen</h2>
          <p className="text-sm text-white/60">
            Pilih sumbu optimasi dan berikan baseline konten untuk dibandingkan dengan varian AI.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Organization ID (opsional)
            <input
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
              placeholder="UUID organisasi"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Content ID
            <input
              value={contentId}
              onChange={(event) => setContentId(event.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
              type="number"
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Axis
            <select
              value={axis}
              onChange={(event) => setAxis(event.target.value as ExperimentAxis)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
            >
              {axisOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-white/50">
              {axisOptions.find((option) => option.value === axis)?.helper}
            </span>
          </label>
        </div>

        {axis !== "SCHEDULE" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-white/80">
              Hook
              <input
                value={baseline.hook}
                onChange={(event) => setBaseline((prev) => ({ ...prev, hook: event.target.value }))}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
                placeholder="Contoh: Hemat 40% waktu tim marketing"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-white/80">
              CTA
              <input
                value={baseline.cta}
                onChange={(event) => setBaseline((prev) => ({ ...prev, cta: event.target.value }))}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
                placeholder="Contoh: Coba Gratis"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-white/80 md:col-span-2">
              Caption
              <textarea
                value={baseline.caption}
                onChange={(event) => setBaseline((prev) => ({ ...prev, caption: event.target.value }))}
                className="min-h-[120px] rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
                placeholder="Paragraf utama yang menjelaskan nilai konten"
              />
            </label>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-white/80">
              Hari
              <select
                value={baseline.scheduleDay}
                onChange={(event) => setBaseline((prev) => ({ ...prev, scheduleDay: event.target.value }))}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
              >
                {scheduleDays.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-white/80">
              Jam (24h)
              <input
                type="number"
                min={0}
                max={23}
                value={baseline.scheduleHour}
                onChange={(event) =>
                  setBaseline((prev) => ({ ...prev, scheduleHour: Number.parseInt(event.target.value, 10) }))
                }
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
              />
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
            disabled={loading}
          >
            {loading ? "Memproses..." : "Mulai Eksperimen"}
          </button>
          {message && <span className="text-sm text-emerald-300">{message}</span>}
          {error && <span className="text-sm text-red-300">{error}</span>}
        </div>
      </form>
    </section>
  );
}
