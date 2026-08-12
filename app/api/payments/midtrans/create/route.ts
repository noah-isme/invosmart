import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/lib/db';
import { midtransSnap } from '@/lib/payments/midtrans';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invoiceId } = await request.json();
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const invoice = await db.invoice.findFirst({
      where: {
        id: invoiceId,
        userId: session.user.id,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Prepare items for Midtrans
    type InvoiceItem = { id?: string; rate?: number; quantity?: number; description?: string };
    const items = ((invoice.items as InvoiceItem[]) || []).map((item) => ({
      id: item.id || `item_${Math.random().toString(36).substring(2, 11)}`,
      price: Math.round(item.rate || 0),
      quantity: item.quantity || 1,
      name: item.description?.substring(0, 50) || 'Item',
    }));

    const transactionDetails = {
      transaction_details: {
        order_id: `${invoiceId}-${Date.now()}`,
        gross_amount: invoice.total,
      },
      item_details: items,
      customer_details: {
        first_name: invoice.client,
      },
    };

    const transaction = await midtransSnap.createTransaction(transactionDetails);

    return NextResponse.json({
      token: transaction.token,
      redirectUrl: transaction.redirect_url,
    });
  } catch (error) {
    console.error('Error creating Midtrans transaction:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
