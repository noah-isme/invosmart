import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
) {
  const params = await context.params;
  const idParam = params?.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  if (!id) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
  }

  const invoice = await db.invoice.findUnique({ where: { id } });

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: invoice });
}
