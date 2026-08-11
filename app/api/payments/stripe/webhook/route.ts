import { NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import auditLogger from '@/lib/audit/auditLogger';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as import('stripe').Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoiceId;
    const userId = session.metadata?.userId;

    if (invoiceId) {
      try {
        const invoice = await db.invoice.findUnique({
          where: { id: invoiceId }
        });

        if (invoice) {
          await db.$transaction(async (tx) => {
            const payment = await tx.payment.create({
              data: {
                invoiceId,
                paidAmount: session.amount_total ? session.amount_total / 100 : invoice.total,
                paidCurrency: session.currency?.toUpperCase() || invoice.currency,
                paidAt: new Date(),
                method: 'stripe',
                gatewayProvider: 'stripe',
                gatewayPaymentId: session.payment_intent as string,
                gatewayStatus: session.payment_status,
                gatewayMetadata: session,
              },
            });

            await tx.invoice.update({
              where: { id: invoiceId },
              data: {
                status: 'PAID',
                paidAt: new Date(),
              },
            });

            if (userId) {
              await auditLogger.log(
                userId,
                'PAYMENT_RECEIVED',
                'Invoice',
                invoiceId,
                { paymentId: payment.id, gateway: 'stripe' }
              );
            }
          });
        }
      } catch (error) {
        console.error('Error processing Stripe webhook:', error);
        // Continue, Stripe expects 200 anyway
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
