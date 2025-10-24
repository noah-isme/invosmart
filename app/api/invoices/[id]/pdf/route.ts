import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { generateInvoicePDF } from "@/lib/pdf-generator";
import { authOptions } from "@/server/auth";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const resolveParams = async (
  params: RouteContext["params"],
): Promise<string | null> => {
  const resolved = await params;
  const value = resolved?.id;

  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = await resolveParams(context.params);

  if (!id) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
  }

  const invoice = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pdfBytes = await generateInvoicePDF(invoice, user);
  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=invoice-${invoice.number}.pdf`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
