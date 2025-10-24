import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { hash } from "@/lib/hash";
import { RegisterSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "auth");
  if (limited) {
    return limited;
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

  const parsed = RegisterSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data registrasi tidak valid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  try {
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email sudah terdaftar." },
        { status: 409 },
      );
    }

    const hashedPassword = await hash(password);

    await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Terjadi kesalahan internal. Silakan coba lagi." },
      { status: 500 },
    );
  }
}
