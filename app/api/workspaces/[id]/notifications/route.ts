import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";
import { encryptWorkspaceSecret } from "@/lib/team/secrets";
import { isValidSlackWebhookUrl } from "@/lib/team/slack";

type RouteContext = { params: Promise<{ id: string }> };
const endpointSchema = z.object({
  type: z.literal("SLACK"),
  webhookUrl: z.string().url(),
  enabled: z.boolean().optional().default(true),
});

const getAdminContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_workspace") ? context : "forbidden" as const;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const context = await resolveWorkspaceContext(session.user.id, id);
  if (!context || context.organizationId !== id) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const endpoints = await db.workspaceNotificationEndpoint.findMany({
    where: { organizationId: id },
    select: { id: true, type: true, enabled: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data: endpoints });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const context = await getAdminContext(session.user.id, id);
  if (context === "forbidden") return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  if (!context) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const parsed = endpointSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidSlackWebhookUrl(parsed.data?.webhookUrl)) {
    return NextResponse.json({ error: "A valid Slack incoming webhook is required" }, { status: 400 });
  }
  let secretCiphertext: string;
  try {
    secretCiphertext = encryptWorkspaceSecret(parsed.data.webhookUrl);
  } catch (error) {
    console.error("[WorkspaceNotifications] Encryption is not configured:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Notification encryption is not configured" }, { status: 503 });
  }

  const endpoint = await db.workspaceNotificationEndpoint.upsert({
    where: { organizationId_type: { organizationId: id, type: parsed.data.type } },
    create: { organizationId: id, type: parsed.data.type, secretCiphertext, enabled: parsed.data.enabled },
    update: { secretCiphertext, enabled: parsed.data.enabled },
    select: { id: true, type: true, enabled: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ data: endpoint });
}
