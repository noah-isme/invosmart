import { NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { logAuditEvent, AuditAction, AuditEntity } from '@/lib/audit/auditLogger';
import { fromGatewayMinorUnit } from '@/lib/payments/money';

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
          const gatewayPaymentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.id;
          const paidCurrency = session.currency?.toUpperCase() || invoice.currency.toUpperCase();
          const paidAmount = session.amount_total === null || session.amount_total === undefined
            ? invoice.total
            : fromGatewayMinorUnit(session.amount_total, paidCurrency);

          if (paidCurrency !== invoice.currency.toUpperCase() || Math.round(paidAmount) !== invoice.total) {
            return NextResponse.json({ error: 'Payment amount or currency does not match invoice' }, { status: 400 });
          }

          const existingPayment = await db.payment.findFirst({
            where: { gatewayProvider: 'stripe', gatewayPaymentId },
            select: { id: true },
          });
          if (existingPayment) {
            return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
          }

          await db.$transaction(async (tx) => {
            const payment = await tx.payment.create({
              data: {
                invoiceId,
                paidAmount,
                paidCurrency,
                paidAt: new Date(),
                method: 'stripe',
                gatewayProvider: 'stripe',
                gatewayPaymentId,
                gatewayStatus: session.payment_status,
                gatewayMetadata: JSON.parse(JSON.stringify(session)),
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
              await logAuditEvent({
                userId,
                action: AuditAction.INVOICE_UPDATE,
                entity: AuditEntity.INVOICE,
                entityId: invoiceId,
                details: { paymentId: payment.id, gateway: 'stripe', event: 'PAYMENT_RECEIVED' },
              });
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
