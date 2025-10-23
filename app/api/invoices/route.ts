import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvoiceCreate } from "@/lib/schemas";

export async function GET() {
  const invoices = await db.invoice.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: invoices });
}

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = InvoiceCreate.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, draft: parsed.data });
}
