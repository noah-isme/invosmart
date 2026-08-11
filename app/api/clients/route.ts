import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ClientCreateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  const limited = rateLimit(request, "clients");
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const cursor = searchParams.get("cursor");
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  const where = {
    userId,
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const clients = await db.client.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { invoices: true } }
    }
  });

  let nextCursor: string | null = null;
  if (clients.length > limit) {
    const nextItem = clients.pop();
    nextCursor = nextItem!.id;
  }

  // Calculate revenue for each client
  const clientsWithRevenue = await Promise.all(clients.map(async (client) => {
    const agg = await db.invoice.aggregate({
      where: { clientId: client.id, status: 'PAID' },
      _sum: { total: true }
    });
    return {
      ...client,
      revenue: agg._sum.total || 0,
      invoiceCount: client._count.invoices
    };
  }));

  return NextResponse.json({ items: clientsWithRevenue, nextCursor });
}

export async function POST(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  const limited = rateLimit(request, "clients");
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const userId = session.user.id;
  const json = await request.json();
  const parsed = ClientCreateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // If email is provided, verify uniqueness for this user
  if (parsed.data.email) {
    const existing = await db.client.findUnique({
      where: {
        client_user_email: {
          userId,
          email: parsed.data.email
        }
      }
    });
    if (existing) {
      return NextResponse.json({ error: "A client with this email already exists." }, { status: 400 });
    }
  }

  const client = await db.client.create({
    data: {
      userId,
      ...parsed.data
    }
  });

  void logAuditEvent({
    tenantId: null,
    userId: session.user.id,
    action: AuditAction.CLIENT_CREATE || "CLIENT_CREATE",
    entity: AuditEntity.CLIENT || "CLIENT",
    entityId: client.id,
    details: { name: client.name, email: client.email },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: client }, { status: 201 });
}
