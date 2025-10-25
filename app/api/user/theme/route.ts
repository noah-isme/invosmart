import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ThemeUpdateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { authOptions } from "@/server/auth";

const DEFAULT_THEME = {
  primary: "#6366f1",
  accent: "#22d3ee",
  mode: "dark" as const,
};

const isHex = (value: string) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);

const normalizeHex = (value: string | null | undefined, fallback: string) => {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  return isHex(trimmed) ? trimmed : fallback;
};

const normalizeMode = (mode: string | null | undefined) => (mode === "light" ? "light" : "dark");

export async function GET(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      themePrimary: true,
      themeAccent: true,
      themeMode: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const theme = {
    primary: normalizeHex(user.themePrimary, DEFAULT_THEME.primary),
    accent: normalizeHex(user.themeAccent, DEFAULT_THEME.accent),
    mode: normalizeMode(user.themeMode),
  } as const;

  return NextResponse.json({ data: theme });
}

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
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = ThemeUpdateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data tema tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { themePrimary, themeAccent, themeMode } = parsed.data;

  if (typeof themePrimary === "undefined" && typeof themeAccent === "undefined" && typeof themeMode === "undefined") {
    return NextResponse.json({ error: "Tidak ada perubahan tema yang dikirim" }, { status: 400 });
  }

  try {
    const updated = await db.user.update({
      where: { id: session.user.id },
      data: {
        themePrimary: typeof themePrimary !== "undefined" ? themePrimary.toLowerCase() : undefined,
        themeAccent: typeof themeAccent !== "undefined" ? themeAccent.toLowerCase() : undefined,
        themeMode: typeof themeMode !== "undefined" ? themeMode : undefined,
      },
      select: {
        themePrimary: true,
        themeAccent: true,
        themeMode: true,
      },
    });

    const theme = {
      primary: normalizeHex(updated.themePrimary, DEFAULT_THEME.primary),
      accent: normalizeHex(updated.themeAccent, DEFAULT_THEME.accent),
      mode: normalizeMode(updated.themeMode),
    } as const;

    return NextResponse.json({ data: theme });
  } catch {
    return NextResponse.json({ error: "Gagal memperbarui tema" }, { status: 500 });
  }
}
