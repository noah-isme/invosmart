import { AutoActionType } from "@prisma/client";

import { serializeAutoAction } from "@/lib/ai/approval-gates";
import { db } from "@/lib/db";

type AutoActionPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const resolveSearchParams = async (
  searchParams: AutoActionPageProps["searchParams"],
) => (await searchParams) ?? {};

const actionLabel: Record<AutoActionType, string> = {
  AUTOPUBLISH: "Autopublish",
  SCHEDULE_UPDATE: "Schedule Update",
  AUTO_REVERT: "Auto Revert",
  AUTO_CTA_TUNE: "CTA Tune",
};

const formatDateTime = (value: string) => new Date(value).toLocaleString("id-ID", { hour12: false });

export default async function AutoActionsPage({ searchParams }: AutoActionPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const organizationId =
    typeof resolvedSearchParams.organizationId === "string" ? resolvedSearchParams.organizationId : undefined;
  const actionTypeParam =
    typeof resolvedSearchParams.actionType === "string" ? resolvedSearchParams.actionType : undefined;

  const actionType = actionTypeParam && actionTypeParam in AutoActionType ? (actionTypeParam as AutoActionType) : undefined;

  const actions = await db.aiAutoAction.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      ...(actionType ? { actionType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const serialized = actions.map((action) => serializeAutoAction(action));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5">
      <header className="flex flex-col gap-2 border-b border-white/10 px-6 py-4">
        <h1 className="text-lg font-semibold text-white">AUTO Actions Log</h1>
        <p className="text-xs text-white/60">
          Menampilkan 50 tindakan otomatis terbaru. Gunakan query string ?organizationId=&lt;uuid&gt; untuk filter per organisasi.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-white/80">
          <thead className="bg-white/10 text-xs uppercase text-white/60">
            <tr>
              <th className="px-6 py-3">Waktu</th>
              <th className="px-6 py-3">Organisasi</th>
              <th className="px-6 py-3">Aksi</th>
              <th className="px-6 py-3">Konten</th>
              <th className="px-6 py-3">Eksperimen</th>
              <th className="px-6 py-3">Varian</th>
              <th className="px-6 py-3">Confidence</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Alasan</th>
            </tr>
          </thead>
          <tbody>
            {serialized.map((action) => (
              <tr key={action.id} className="border-t border-white/10">
                <td className="px-6 py-3">{formatDateTime(action.createdAt)}</td>
                <td className="px-6 py-3">{action.organizationId ?? "Global"}</td>
                <td className="px-6 py-3">{actionLabel[action.actionType]}</td>
                <td className="px-6 py-3">{action.contentId ?? "–"}</td>
                <td className="px-6 py-3">{action.experimentId ?? "–"}</td>
                <td className="px-6 py-3">{action.variantId ?? "–"}</td>
                <td className="px-6 py-3">{action.confidence ? `${(action.confidence * 100).toFixed(1)}%` : "–"}</td>
                <td className="px-6 py-3">{action.status}</td>
                <td className="px-6 py-3 max-w-[320px] text-xs text-white/60">{action.reason ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
