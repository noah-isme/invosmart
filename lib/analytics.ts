import { InvoiceStatus } from "@prisma/client";

import { db } from "@/lib/db";

export type RevenueInsight = {
  months: string[];
  revenue: number[];
  paid: number[];
  overdue: number[];
  topClient: { client: string; averageDays: number } | null;
  overdueClients: string[];
};

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

const getMonthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const calculateMonthsRange = (): {
  startDate: Date;
  months: string[];
  monthIndex: Map<string, number>;
} => {
  const now = new Date();
  const months: string[] = [];
  const monthIndex = new Map<string, number>();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const current = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = getMonthKey(current);
    monthIndex.set(key, months.length);
    months.push(monthFormatter.format(current));
  }

  const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  return { startDate, months, monthIndex };
};

const daysBetween = (start: Date, end: Date) => {
  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / millisPerDay));
};

export const getRevenueInsight = async (userId: string): Promise<RevenueInsight> => {
  const { startDate, months, monthIndex } = calculateMonthsRange();
  const revenue = Array<number>(months.length).fill(0);
  const paid = Array<number>(months.length).fill(0);
  const overdue = Array<number>(months.length).fill(0);

  const invoices = await db.invoice.findMany({
    where: {
      userId,
      issuedAt: { gte: startDate },
    },
    select: {
      total: true,
      status: true,
      issuedAt: true,
      client: true,
      paidAt: true,
    },
  });

  const paymentSpeed = new Map<string, { totalDays: number; count: number }>();
  const overdueClients = new Set<string>();

  invoices.forEach((invoice) => {
    const monthKey = getMonthKey(new Date(invoice.issuedAt));
    const index = monthIndex.get(monthKey);

    if (typeof index === "number") {
      if (invoice.status === InvoiceStatus.PAID) {
        revenue[index] += invoice.total;
        paid[index] += 1;
      }

      if (invoice.status === InvoiceStatus.OVERDUE) {
        overdue[index] += 1;
        overdueClients.add(invoice.client);
      }
    }

    if (invoice.status === InvoiceStatus.PAID && invoice.paidAt) {
      const speed = daysBetween(new Date(invoice.issuedAt), new Date(invoice.paidAt));
      const entry = paymentSpeed.get(invoice.client) ?? { totalDays: 0, count: 0 };
      entry.totalDays += speed;
      entry.count += 1;
      paymentSpeed.set(invoice.client, entry);
    }

    if (invoice.status === InvoiceStatus.OVERDUE) {
      overdueClients.add(invoice.client);
    }
  });

  let topClient: RevenueInsight["topClient"] = null;

  paymentSpeed.forEach((value, client) => {
    const averageDays = value.count ? value.totalDays / value.count : Number.POSITIVE_INFINITY;

    if (!topClient || averageDays < topClient.averageDays) {
      topClient = { client, averageDays: Number(averageDays.toFixed(1)) };
    }
  });

  return {
    months,
    revenue,
    paid,
    overdue,
    topClient,
    overdueClients: Array.from(overdueClients).sort(),
  };
};
