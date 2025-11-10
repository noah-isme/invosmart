import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authOptions } from '@/server/auth';
import { ensureReceiptsEnabled, ensurePositionPreset } from '@/lib/receipts/guards';
import { createReceipt } from '@/lib/receipts/service';

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

  try {
    const position = ensurePositionPreset(positionPreset);
    
    const result = await createReceipt(db, {
      paymentId,
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
