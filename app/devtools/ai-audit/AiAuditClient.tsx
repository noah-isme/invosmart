"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";

export type AuditEntry = {
  id: string;
  route: string;
  suggestion: string;
  impact: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  policyStatus: "ALLOWED" | "REVIEW" | "BLOCKED";
  policyReason?: string | null;
  explanation: string | null;
  explanationContext: string | null;
  dataBasis: string[];
  confidence: number;
  trustScore: number | null;
  createdAt: string;
  explanationCreatedAt: string | null;
};

type Filters = {
  search: string;
  status: AuditEntry["status"] | "ALL";
  policyStatus: AuditEntry["policyStatus"] | "ALL";
  startDate: string;
  endDate: string;
};

type AiAuditClientProps = {
  entries: AuditEntry[];
};

const statusLabel: Record<AuditEntry["status"], string> = {
  PENDING: "Pending",
  APPLIED: "Applied",
  REJECTED: "Rejected",
};

const policyLabel: Record<AuditEntry["policyStatus"], string> = {
  ALLOWED: "Allowed",
  REVIEW: "Review",
  BLOCKED: "Blocked",
};

const badgeClass = {
  PENDING: "bg-amber-500/10 text-amber-100 border border-amber-500/30",
  APPLIED: "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30",
  REJECTED: "bg-rose-500/10 text-rose-200 border border-rose-500/30",
} as const;

const policyBadgeClass = {
  ALLOWED: "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30",
  REVIEW: "bg-amber-500/10 text-amber-200 border border-amber-500/30",
  BLOCKED: "bg-rose-500/10 text-rose-200 border border-rose-500/30",
} as const;

const initialFilters: Filters = {
  search: "",
  status: "ALL",
  policyStatus: "ALL",
  startDate: "",
  endDate: "",
};

const toCsv = (rows: AuditEntry[]) => {
  const header = [
    "ID",
    "Route",
    "Suggestion",
    "Impact",
    "Status",
    "Policy",
    "PolicyReason",
    "Confidence",
    "TrustScore",
    "Explanation",
    "Context",
    "DataBasis",
    "CreatedAt",
    "ExplanationCreatedAt",
  ];
  const body = rows.map((row) =>
    [
      row.id,
      row.route,
      row.suggestion,
      row.impact,
      row.status,
      row.policyStatus,
      row.policyReason ?? "",
      String(Math.round(row.confidence * 100)),
      row.trustScore != null ? String(row.trustScore) : "",
      row.explanation ?? "",
      row.explanationContext ?? "",
      row.dataBasis.join("; "),
      row.createdAt,
      row.explanationCreatedAt ?? "",
    ]
      .map((value) => `"${value.replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
};

const exportCsv = (rows: AuditEntry[]) => {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ai-audit-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const exportPdf = async (rows: AuditEntry[]) => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fontSize = 10;
  let y = 800;

  const drawLine = (text: string) => {
    page.drawText(text, { x: 40, y, size: fontSize, font });
    y -= fontSize + 4;
    if (y < 60) {
      page.drawText("-- continued --", { x: 40, y: 40, size: fontSize - 2, font });
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  drawLine("InvoSmart AI Governance Audit");
  drawLine(`Generated at: ${new Date().toISOString()}`);
  drawLine("");

  rows.forEach((row) => {
    drawLine(`Route: ${row.route} (${row.status}/${row.policyStatus})`);
    drawLine(`Suggestion: ${row.suggestion}`);
    drawLine(`Impact: ${row.impact}`);
    drawLine(`Confidence: ${Math.round(row.confidence * 100)}% | Trust Score: ${row.trustScore ?? "-"}`);
    if (row.policyReason) {
      drawLine(`Policy: ${row.policyReason}`);
    }
    if (row.explanation) {
      drawLine(`Why: ${row.explanation}`);
    }
    if (row.explanationContext) {
      drawLine(`Context: ${row.explanationContext}`);
    }
    if (row.dataBasis.length) {
      drawLine(`Data basis: ${row.dataBasis.join("; ")}`);
    }
    drawLine(`Logged at: ${row.createdAt}`);
    drawLine("");
  });

  const bytes = await pdf.save();
  const arrayBuffer = (bytes.buffer as ArrayBuffer).slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ai-audit-${Date.now()}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const filterEntries = (entries: AuditEntry[], filters: Filters) =>
  entries.filter((entry) => {
    if (filters.search) {
      const query = filters.search.toLowerCase();
      if (!entry.route.toLowerCase().includes(query) && !entry.suggestion.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filters.status !== "ALL" && entry.status !== filters.status) {
      return false;
    }

    if (filters.policyStatus !== "ALL" && entry.policyStatus !== filters.policyStatus) {
      return false;
    }

    if (filters.startDate) {
      const entryDate = new Date(entry.createdAt);
      if (entryDate < new Date(filters.startDate)) {
        return false;
      }
    }

    if (filters.endDate) {
      const entryDate = new Date(entry.createdAt);
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      if (entryDate > end) {
        return false;
      }
    }

    return true;
  });

export function AiAuditClient({ entries }: AiAuditClientProps) {
  const [filters, setFilters] = useState<Filters>(initialFilters);

  const filtered = useMemo(() => filterEntries(entries, filters), [entries, filters]);

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-xl font-semibold text-text">Filter audit trail</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-2 text-xs uppercase tracking-[0.24em] text-text/50">
            Kata kunci
            <input
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="route atau tindakan"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text focus:border-white/20 focus:outline-none"
            />
          </label>
          <label className="space-y-2 text-xs uppercase tracking-[0.24em] text-text/50">
            Status rekomendasi
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as Filters["status"] }))}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text focus:border-white/20 focus:outline-none"
            >
              <option value="ALL">Semua</option>
              <option value="PENDING">Pending</option>
              <option value="APPLIED">Applied</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <label className="space-y-2 text-xs uppercase tracking-[0.24em] text-text/50">
            Status kebijakan
            <select
              value={filters.policyStatus}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, policyStatus: event.target.value as Filters["policyStatus"] }))
              }
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text focus:border-white/20 focus:outline-none"
            >
              <option value="ALL">Semua</option>
              <option value="ALLOWED">Allowed</option>
              <option value="REVIEW">Review</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-xs uppercase tracking-[0.24em] text-text/50">
              Dari
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text focus:border-white/20 focus:outline-none"
              />
            </label>
            <label className="space-y-2 text-xs uppercase tracking-[0.24em] text-text/50">
              Sampai
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text focus:border-white/20 focus:outline-none"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setFilters(initialFilters)}>
            Reset
          </Button>
          <Button onClick={() => exportCsv(filtered)}>Export CSV</Button>
          <Button onClick={() => void exportPdf(filtered)}>Export PDF</Button>
        </div>
      </div>

      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-text">Audit trail</h3>
            <p className="text-xs text-text/60">{filtered.length} dari {entries.length} entri ditampilkan.</p>
          </div>
        </header>

        <div className="space-y-3">
          {filtered.map((entry) => (
            <article key={entry.id} className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text">{entry.route}</p>
                  <p className="text-xs text-text/60">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass[entry.status]}`}>
                    {statusLabel[entry.status]}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${policyBadgeClass[entry.policyStatus]}`}>
                    {policyLabel[entry.policyStatus]}
                  </span>
                </div>
              </div>
              <p className="text-sm text-text/80">{entry.suggestion}</p>
              <p className="text-xs text-text/60">Impact: {entry.impact}</p>
              {entry.policyReason && (
                <p className="text-xs text-amber-200">Policy note: {entry.policyReason}</p>
              )}
              {entry.explanation && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-text/75">
                  <p className="font-semibold text-text">Why</p>
                  <p className="mt-1 text-sm text-text/80">{entry.explanation}</p>
                  {entry.explanationContext && <p className="mt-1 text-[11px] text-text/60">{entry.explanationContext}</p>}
                  {entry.dataBasis.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {entry.dataBasis.map((item, index) => (
                        <li key={index} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px]">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-text/50">
                <span>Confidence {Math.round(entry.confidence * 100)}%</span>
                {entry.trustScore != null && <span>Trust score {entry.trustScore}</span>}
                {entry.explanationCreatedAt && <span>Explained {new Date(entry.explanationCreatedAt).toLocaleString()}</span>}
              </div>
            </article>
          ))}

          {filtered.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-sm text-text/60">
              Tidak ada entri yang cocok dengan filter saat ini.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
