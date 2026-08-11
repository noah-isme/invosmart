import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import auditLogger from '@/lib/audit/auditLogger';

export async function POST(request: Request) {
  try {
    const notification = await request.json();

    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';

    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');

    if (expectedSignature !== notification.signature_key) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    // The orderId format we used was `${invoiceId}-${timestamp}`
    const invoiceId = orderId.split('-')[0];

    if (
      transactionStatus === 'capture' ||
      transactionStatus === 'settlement'
    ) {
      if (transactionStatus === 'capture' && fraudStatus === 'challenge') {
        // Challenged, wait for action
        return NextResponse.json({ received: true });
      }

      const invoice = await db.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (invoice && invoice.status !== 'PAID') {
        await db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              invoiceId,
              paidAmount: parseFloat(grossAmount),
              paidCurrency: notification.currency || invoice.currency,
              paidAt: new Date(notification.settlement_time || notification.transaction_time || new Date()),
              method: notification.payment_type || 'midtrans',
              gatewayProvider: 'midtrans',
              gatewayPaymentId: notification.transaction_id,
              gatewayStatus: transactionStatus,
              gatewayMetadata: notification,
            },
          });

          await tx.invoice.update({
            where: { id: invoiceId },
            data: {
              status: 'PAID',
              paidAt: new Date(),
            },
          });

          if (invoice.userId) {
            await auditLogger.log(
              invoice.userId,
              'PAYMENT_RECEIVED',
              'Invoice',
              invoiceId,
              { paymentId: payment.id, gateway: 'midtrans' }
            );
          }
        });
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error handling Midtrans notification:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
