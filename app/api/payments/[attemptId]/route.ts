import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { canReadWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ attemptId: string }> };

/** Return a provider-neutral view of a payment attempt owned by the caller. */
export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attemptId } = await context.params;
  if (!attemptId) {
    return NextResponse.json({ error: "Payment attempt ID required" }, { status: 400 });
  }

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  const attempt = await db.paymentAttempt.findFirst({
    where: {
      id: attemptId,
      invoice: workspace.organizationId
        ? { organizationId: workspace.organizationId }
        : { userId: session.user.id },
    },
    select: {
      id: true,
      provider: true,
      providerOrderId: true,
      providerSessionId: true,
      providerPaymentId: true,
      checkoutUrl: true,
      amount: true,
      currency: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      invoice: { select: { id: true, number: true, status: true } },
      payments: {
        select: {
          id: true,
          paidAmount: true,
          refundedAmount: true,
          paidCurrency: true,
          paidAt: true,
          gatewayStatus: true,
        },
      },
    },
  });

  if (!attempt) {
    return NextResponse.json({ error: "Payment attempt not found" }, { status: 404 });
  }

  return NextResponse.json({
    attemptId: attempt.id,
    provider: attempt.provider,
    orderId: attempt.providerOrderId,
    sessionId: attempt.providerSessionId,
    paymentId: attempt.providerPaymentId,
    checkoutUrl: attempt.checkoutUrl,
    amount: attempt.amount,
    currency: attempt.currency,
    status: attempt.status,
    expiresAt: attempt.expiresAt?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
    invoice: attempt.invoice,
    payments: attempt.payments.map((payment) => ({
      ...payment,
      paidAt: payment.paidAt.toISOString(),
    })),
  });
}
