import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { InsightClient } from "./InsightClient";
import { getRevenueInsight } from "@/lib/analytics";
import { db } from "@/lib/db";
import {
  InvoiceStatusEnum,
  parseInvoiceStatus,
  type InvoiceInsightSummary,
} from "@/lib/schemas";
import { authOptions } from "@/server/auth";

type SummaryTotals = {
  revenue: number;
  paidInvoices: number;
  overdueInvoices: number;
  outstandingInvoices: number;
  averageInvoice: number;
};

type InvoiceSummaryRecord = {
  total: number;
  status: unknown;
  client: string;
  issuedAt: Date;
};

const buildSummary = async (userId: string) => {
  const [revenueInsight, invoices] = await Promise.all([
    getRevenueInsight(userId),
    db.invoice.findMany({
      where: { userId },
      select: {
        total: true,
        status: true,
        client: true,
        issuedAt: true,
      },
    }),
  ]);

  const invoiceRecords = invoices as InvoiceSummaryRecord[];

  const totals = invoiceRecords.reduce(
    (acc: SummaryTotals, invoice: InvoiceSummaryRecord) => {
      const status = parseInvoiceStatus(invoice.status);

      if (status === InvoiceStatusEnum.enum.PAID) {
        acc.revenue += invoice.total;
        acc.paidInvoices += 1;
      }
      if (status === InvoiceStatusEnum.enum.OVERDUE) {
        acc.overdueInvoices += 1;
      }
      if (
        status === InvoiceStatusEnum.enum.SENT ||
        status === InvoiceStatusEnum.enum.UNPAID ||
        status === InvoiceStatusEnum.enum.OVERDUE
      ) {
        acc.outstandingInvoices += 1;
      }
      return acc;
    },
    {
      revenue: 0,
      paidInvoices: 0,
      overdueInvoices: 0,
      outstandingInvoices: 0,
      averageInvoice: 0,
    } as SummaryTotals,
  );

  totals.averageInvoice = invoices.length ? Math.round(totals.revenue / invoices.length) : 0;

  const clientMap = new Map<string, { revenue: number; paidInvoices: number; overdueInvoices: number }>();

  invoiceRecords.forEach((invoice) => {
    const status = parseInvoiceStatus(invoice.status);

    const entry = clientMap.get(invoice.client) ?? {
      revenue: 0,
      paidInvoices: 0,
      overdueInvoices: 0,
    };

    if (status === InvoiceStatusEnum.enum.PAID) {
      entry.revenue += invoice.total;
      entry.paidInvoices += 1;
    }

    if (status === InvoiceStatusEnum.enum.OVERDUE) {
      entry.overdueInvoices += 1;
    }

    clientMap.set(invoice.client, entry);
  });

  const topClients = Array.from(clientMap.entries())
    .map(([client, value]) => ({ client, ...value }))
    .sort((a, b) => b.revenue - a.revenue);

  const recentInvoices = invoiceRecords
    .slice()
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
    .slice(0, 8)
    .map((invoice) => ({
      client: invoice.client,
      total: invoice.total,
      status: parseInvoiceStatus(invoice.status),
      issuedAt: invoice.issuedAt.toISOString(),
    }));

  const lastMonth = revenueInsight.revenue.at(-1) ?? 0;
  const previousMonth = revenueInsight.revenue.at(-2) ?? 0;

  const summary: InvoiceInsightSummary = {
    totals,
    monthlyRevenue: revenueInsight.months.map((month, index) => ({
      month,
      revenue: revenueInsight.revenue[index] ?? 0,
      paid: revenueInsight.paid[index] ?? 0,
      overdue: revenueInsight.overdue[index] ?? 0,
    })),
    topClients,
    recentInvoices,
    period: {
      label: `${revenueInsight.months[0] ?? ""} – ${
        revenueInsight.months[revenueInsight.months.length - 1] ?? ""
      }`,
      months: revenueInsight.months,
      currency: "IDR",
    },
    trend: {
      lastMonth,
      previousMonth,
    },
  };

  return { summary, revenueInsight } as const;
};

export const metadata = {
  title: "AI Invoice Insights",
};

export default async function InvoiceInsightPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const data = await buildSummary(session.user.id);

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <InsightClient summary={data.summary} revenueInsight={data.revenueInsight} />
    </main>
  );
}
