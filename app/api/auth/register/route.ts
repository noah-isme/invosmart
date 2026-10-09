import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { hash } from "@/lib/hash";
import { RegisterSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { createUserWithPersonalWorkspace, isUniqueConstraintError } from "@/lib/workspaces";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent, getClientIp, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";

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

    // User, personal workspace, OWNER membership and activeOrganizationId are
    // written in one transaction so a new account never exists without a
    // workspace (required under WORKSPACE_AUTH_MODE=enforce).
    const user = await createUserWithPersonalWorkspace<{
      id: string;
      email: string;
      name: string | null;
    }>({ name, email, password: hashedPassword });

    void logAuditEvent({
      userId: user.id,
      action: AuditAction.AUTH_REGISTER,
      entity: AuditEntity.USER,
      entityId: user.id,
      details: {
        email: user.email,
        name: user.name,
      },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    // Concurrent registration with the same email: the transaction (and its
    // workspace) rolled back; report it the same way as the pre-check.
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "Email sudah terdaftar." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Terjadi kesalahan internal. Silakan coba lagi." },
      { status: 500 },
    );
  }
}
