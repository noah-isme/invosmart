import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authOptions } from '@/server/auth';
import { ensureReceiptsEnabled, ensurePositionPreset } from '@/lib/receipts/guards';
import { createReceipt } from '@/lib/receipts/service';
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from '@/lib/workspaces';

const CreateReceiptSchema = z.object({
  paymentId: z.string().min(1),
  positionPreset: z.enum(['bottom-left', 'bottom-right', 'center']),
  enableCompanySeal: z.boolean().optional().default(false),
  enablePaidStamp: z.boolean().optional().default(true),
  enableSignature: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    ensureReceiptsEnabled();
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 403 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canWriteWorkspace(workspace)) {
    return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { paymentId, positionPreset, enableCompanySeal, enablePaidStamp, enableSignature } = parsed.data;

  // The receipt service intentionally accepts a payment id only. Verify the
  // payment belongs to the active workspace before invoking it so a caller
  // cannot mint a receipt for another tenant's paid invoice.
  const payment = await db.payment.findFirst({
    where: {
      id: paymentId,
      invoice: workspace.organizationId
        ? { organizationId: workspace.organizationId }
        : { userId: session.user.id },
    },
    select: { id: true },
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  try {
    const position = ensurePositionPreset(positionPreset);
    
    const result = await createReceipt(db, {
      paymentId,
      organizationId: workspace.organizationId ?? undefined,
      positionPreset: position,
      stampCompanySealEnabled: enableCompanySeal,
      stampPaidEnabled: enablePaidStamp,
      signatureEnabled: enableSignature,
      actor: session.user.email || session.user.id,
    });

    return NextResponse.json({
      receiptId: result.receipt.id,
      receiptNo: result.receiptNo,
      verifyToken: result.verifyToken,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
