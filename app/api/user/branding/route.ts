import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { BrandingSchema, type BrandingInput } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { authOptions } from "@/server/auth";

type BrandingPayload = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  fontFamily?: string | null;
  syncWithTheme?: boolean;
  useThemeForPdf?: boolean;
};

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

const normalizeBoolean = (value: unknown) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return Boolean(value);
};

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

  if (hasOwn(payload, "syncWithTheme")) {
    normalized.syncWithTheme = normalizeBoolean(payload.syncWithTheme);
  }

  if (hasOwn(payload, "useThemeForPdf")) {
    normalized.useThemeForPdf = normalizeBoolean(payload.useThemeForPdf);
  }

  return normalized;
};

const buildUpdateData = (data: BrandingInput) => {
  const updateData: Parameters<typeof db.user.update>[0]["data"] = {};

  if (hasOwn(data, "logoUrl")) {
    updateData.logoUrl = data.logoUrl ?? null;
  }

  if (hasOwn(data, "primaryColor")) {
    updateData.primaryColor = data.primaryColor ? data.primaryColor.toLowerCase() : null;
  }

  if (hasOwn(data, "fontFamily")) {
    updateData.fontFamily = data.fontFamily ?? null;
  }

  if (hasOwn(data, "syncWithTheme")) {
    updateData.brandingSyncWithTheme = Boolean(data.syncWithTheme);
  }

  if (hasOwn(data, "useThemeForPdf")) {
    updateData.useThemeForPdf = Boolean(data.useThemeForPdf);
  }

  return updateData;
};

const respondUnauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const handleUpdate = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return respondUnauthorized();
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

  const updateData = buildUpdateData(parsed.data);

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
        brandingSyncWithTheme: true,
        useThemeForPdf: true,
      },
    });

    return NextResponse.json({ data: updated });
  } catch {
    return NextResponse.json(
      { error: "Tidak dapat memperbarui branding saat ini." },
      { status: 500 },
    );
  }
};

export async function PUT(request: NextRequest) {
  return handleUpdate(request);
}

export async function PATCH(request: NextRequest) {
  return handleUpdate(request);
}
