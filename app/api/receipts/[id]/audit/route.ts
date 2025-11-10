import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/server/auth';
import { ensureReceiptsEnabled } from '@/lib/receipts/guards';
import { getReceipt } from '@/lib/receipts/service';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
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

  const { id } = await context.params;

  const receipt = await getReceipt(db, id);
  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  if (receipt.payment.invoice.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const auditLogs = await db.receiptAuditLog.findMany({
    where: { receiptId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ data: auditLogs });
}
