import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/server/auth';
import { ensureReceiptsEnabled } from '@/lib/receipts/guards';
import { getReceipt, logAudit } from '@/lib/receipts/service';
import { generateReceiptPdf } from '@/lib/receipts/pdf';
import { canReadWorkspace, resolveWorkspaceContextForRequest } from '@/lib/workspaces';

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

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) {
    return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });
  }

  const { id } = await context.params;
  
  const receipt = await getReceipt(db, id, workspace.organizationId);
  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  const ownsReceipt = workspace.organizationId
    ? receipt.payment.invoice.organizationId === workspace.organizationId
    : receipt.payment.invoice.userId === session.user.id;
  if (!ownsReceipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  try {
    const pdfBuffer = await generateReceiptPdf(receipt);

    await logAudit(
      db,
      receipt.id,
      'PDF_GENERATED',
      session.user.email || session.user.id,
      { size: pdfBuffer.length }
    );

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="receipt-${receipt.receiptNo}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate PDF: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
