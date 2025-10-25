import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  InvoiceCreateSchema,
  InvoiceStatusEnum,
  type InvoiceStatusValue,
  generateInvoiceNumber,
} from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { calculateTotals } from "@/lib/invoice-utils";
import { markUserOverdueInvoices } from "@/lib/invoices";
import { authOptions } from "@/server/auth";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

export async function GET(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const userId = session.user.id;

  await markUserOverdueInvoices(db, userId);

  const statusParam = request.nextUrl.searchParams.get("status");

  let statusFilter: InvoiceStatusValue | undefined;

  if (statusParam && statusParam.toUpperCase() !== "ALL") {
    const parsedStatus = InvoiceStatusEnum.safeParse(statusParam.toUpperCase());

    if (!parsedStatus.success) {
      return invalidRequest("Invalid status filter");
    }

    statusFilter = parsedStatus.data;
  }

  const where = {
    userId,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [invoices, revenueAggregate, unpaidCount, overdueCount] = await Promise.all([
    db.invoice.findMany({
      where,
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    db.invoice.aggregate({
      where: { userId, status: InvoiceStatusEnum.enum.PAID },
      _sum: { total: true },
    }),
    db.invoice.count({ where: { userId, status: InvoiceStatusEnum.enum.UNPAID } }),
    db.invoice.count({ where: { userId, status: InvoiceStatusEnum.enum.OVERDUE } }),
  ]);

  const revenue = revenueAggregate._sum.total ?? 0;

  return NextResponse.json({
    data: invoices,
    stats: {
      revenue,
      unpaid: unpaidCount,
      overdue: overdueCount,
    },
  });
}

export async function POST(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const userId = session.user.id;

  const json = await request.json();
  const parsed = InvoiceCreateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const items = parsed.data.items;
  const { subtotal, total, tax } = calculateTotals(items, parsed.data.taxRate);

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return invalidRequest("Invalid dueAt value");
  }

  const invoiceNumber = await generateInvoiceNumber(db);

  const now = new Date();
  const status: InvoiceStatusValue =
    parsed.data.status === InvoiceStatusEnum.enum.SENT
      ? InvoiceStatusEnum.enum.SENT
      : InvoiceStatusEnum.enum.DRAFT;
  if (
    parsed.data.status &&
    parsed.data.status !== InvoiceStatusEnum.enum.DRAFT &&
    parsed.data.status !== InvoiceStatusEnum.enum.SENT
  ) {
    return invalidRequest("Invalid initial invoice status");
  }

  const invoice = await db.invoice.create({
    data: {
      number: invoiceNumber,
      client: parsed.data.client,
      items,
      subtotal,
      tax,
      total,
      status,
      issuedAt: now,
      dueAt,
      paidAt: null,
      notes: parsed.data.notes ?? null,
      userId,
    },
  });

  return NextResponse.json({ data: invoice }, { status: 201 });
}
