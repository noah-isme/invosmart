import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { BrandingSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { authOptions } from "@/server/auth";

type BrandingPayload = Partial<Record<"logoUrl" | "primaryColor" | "fontFamily", string | null>>;

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const normalizePayload = (input: unknown): BrandingPayload => {
  if (!input || typeof input !== "object") {
    return {};
  }

  const payload = input as Record<string, unknown>;
  const normalized: BrandingPayload = {};

  if (hasOwn(payload, "logoUrl")) {
    const value = typeof payload.logoUrl === "string" ? payload.logoUrl.trim() : "";
    normalized.logoUrl = value.length ? value : null;
  }

  if (hasOwn(payload, "primaryColor")) {
    const value = typeof payload.primaryColor === "string" ? payload.primaryColor.trim() : "";
    normalized.primaryColor = value.length ? value : null;
  }

  if (hasOwn(payload, "fontFamily")) {
    const value = typeof payload.fontFamily === "string" ? payload.fontFamily.trim() : "";
    normalized.fontFamily = value.length ? value : null;
  }

  return normalized;
};

export async function PUT(request: NextRequest) {
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
    return NextResponse.json(
      { error: "Payload tidak valid. Pastikan mengirim JSON yang benar." },
      { status: 400 },
    );
  }

  const sanitized = normalizePayload(json);
  const parsed = BrandingSchema.safeParse(sanitized);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data branding tidak valid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updateData: Parameters<typeof db.user.update>[0]["data"] = {};

  if (hasOwn(parsed.data, "logoUrl")) {
    updateData.logoUrl = parsed.data.logoUrl ?? null;
  }

  if (hasOwn(parsed.data, "primaryColor")) {
    updateData.primaryColor = parsed.data.primaryColor
      ? parsed.data.primaryColor.toLowerCase()
      : null;
  }

  if (hasOwn(parsed.data, "fontFamily")) {
    updateData.fontFamily = parsed.data.fontFamily ?? null;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "Tidak ada perubahan yang dikirim." },
      { status: 400 },
    );
  }

  try {
    const updated = await db.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        logoUrl: true,
        primaryColor: true,
        fontFamily: true,
      },
    });

    return NextResponse.json({ data: updated });
  } catch {
    return NextResponse.json(
      { error: "Tidak dapat memperbarui branding saat ini." },
      { status: 500 },
    );
  }
}
