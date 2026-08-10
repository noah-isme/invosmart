import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { authOptions } from "@/server/auth";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || undefined;
  const entity = searchParams.get("entity") || undefined;
  const userId = searchParams.get("userId") || undefined;
  const tenantId = searchParams.get("tenantId") || undefined;
  const fromDateParam = searchParams.get("fromDate");
  const toDateParam = searchParams.get("toDate");
  const limitParam = searchParams.get("limit");
  const skipParam = searchParams.get("skip");

  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;
  const skip = skipParam ? Math.max(parseInt(skipParam, 10) || 0, 0) : 0;

  const where: Record<string, unknown> = {};

  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;
  if (tenantId) where.tenantId = tenantId;

  if (fromDateParam || toDateParam) {
    const createdAtFilter: Record<string, Date> = {};

    if (fromDateParam) {
      const fromDate = new Date(fromDateParam);
      if (!isNaN(fromDate.getTime())) {
        createdAtFilter.gte = fromDate;
      }
    }

    if (toDateParam) {
      const toDate = new Date(toDateParam);
      if (!isNaN(toDate.getTime())) {
        createdAtFilter.lte = toDate;
      }
    }

    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }
  }

  try {
    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      total,
      limit,
      skip,
    });
  } catch (error) {
    console.error("Failed to query audit logs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
