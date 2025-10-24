import { InvoiceStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  InvoiceUpdateSchema,
  type InvoiceUpdateInput,
} from "@/lib/schemas";
import { calculateTotals } from "@/lib/invoice-utils";
import { getStatusSideEffects, isInvoiceOverdue } from "@/lib/invoices";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const notFound = () =>
  NextResponse.json({ error: "Invoice not found" }, { status: 404 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

const resolveId = async (context: RouteContext) => {
  const params = await context.params;
  const idParam = params?.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  return id ?? null;
};

export async function GET(request: NextRequest, context: RouteContext) {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const invoice = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!invoice) {
    return notFound();
  }

  if (invoice.status !== InvoiceStatus.OVERDUE && isInvoiceOverdue(invoice)) {
    const updated = await db.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.OVERDUE },
    });
    return NextResponse.json({ data: updated });
  }

  return NextResponse.json({ data: invoice });
}

const validateUpdateBody = async (request: NextRequest) => {
  try {
    const json = await request.json();
    return InvoiceUpdateSchema.safeParse(json);
  } catch {
    return { success: false } as const;
  }
};

const ensureTotals = (payload: InvoiceUpdateInput) => {
  const totals = calculateTotals(payload.items, payload.taxRate);

  if (totals.subtotal !== payload.subtotal || totals.total !== payload.total) {
    return { success: false as const };
  }

  if (totals.tax !== payload.tax) {
    return { success: false as const };
  }

  return { success: true as const, totals };
};

export async function PUT(request: NextRequest, context: RouteContext) {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const parsed = await validateUpdateBody(request);

  if (!parsed.success) {
    return invalidRequest("Invalid payload");
  }

  if (parsed.data.id !== id) {
    return invalidRequest("Invoice id mismatch");
  }

  const totalsCheck = ensureTotals(parsed.data);

  if (!totalsCheck.success) {
    return invalidRequest("Subtotal atau total tidak valid");
  }

  const issuedAt = new Date(parsed.data.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    return invalidRequest("Invalid issuedAt value");
  }

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return invalidRequest("Invalid dueAt value");
  }

  const existing = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  const now = new Date();
  const sideEffects = getStatusSideEffects(existing.status, parsed.data.status, now);

  const data = {
    client: parsed.data.client,
    items: parsed.data.items,
    subtotal: totalsCheck.totals.subtotal,
    tax: totalsCheck.totals.tax,
    total: totalsCheck.totals.total,
    status: parsed.data.status,
    issuedAt,
    dueAt,
    notes: parsed.data.notes ?? null,
    ...("paidAt" in sideEffects ? { paidAt: sideEffects.paidAt ?? null } : {}),
  } satisfies Parameters<typeof db.invoice.update>[0]["data"];

  if (sideEffects.issuedAt) {
    data.issuedAt = sideEffects.issuedAt;
  }

  if (
    dueAt &&
    dueAt.getTime() < now.getTime() &&
    parsed.data.status !== InvoiceStatus.PAID &&
    (parsed.data.status === InvoiceStatus.SENT || parsed.data.status === InvoiceStatus.UNPAID)
  ) {
    data.status = InvoiceStatus.OVERDUE;
  }

  const updated = await db.invoice.update({
    where: { id },
    data,
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const existing = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  await db.invoice.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
