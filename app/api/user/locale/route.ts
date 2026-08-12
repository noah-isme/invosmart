import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { LocaleUpdateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { authOptions } from "@/server/auth";

export async function GET(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { locale: true },
    });

    return NextResponse.json({ data: { locale: user?.locale ?? "en" } });
  } catch {
    return NextResponse.json({ error: "Failed to fetch locale preference" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = LocaleUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid locale value. Supported locales: en, id", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { locale } = parsed.data;

  try {
    const updated = await db.user.update({
      where: { id: session.user.id },
      data: { locale },
      select: { locale: true },
    });

    return NextResponse.json({ data: { locale: updated.locale }, success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update locale preference" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return PATCH(request);
}
