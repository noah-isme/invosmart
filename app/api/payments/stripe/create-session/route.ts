import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { db } from '@/lib/db';
import { stripe } from '@/lib/payments/stripe';

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

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    type InvoiceItem = { description?: string; rate?: number; quantity?: number };
    const items = (invoice.items as InvoiceItem[]) || [];
    const line_items = items.map((item) => ({
      price_data: {
        currency: invoice.currency.toLowerCase() || 'idr',
        product_data: {
          name: item.description || 'Item',
        },
        unit_amount: Math.round((item.rate || 0) * 100), // Stripe expects amounts in cents for USD, or smallest unit.
      },
      quantity: item.quantity || 1,
    }));

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${origin}/app/invoices/${invoiceId}?payment=success`,
      cancel_url: `${origin}/app/invoices/${invoiceId}?payment=cancelled`,
      metadata: {
        invoiceId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
