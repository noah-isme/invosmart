import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { logAuditEvent, AuditAction, AuditEntity } from '@/lib/audit/auditLogger';

export async function POST(request: Request) {
  try {
    const notification = await request.json();

    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';

    if (typeof orderId !== 'string' || statusCode === undefined || grossAmount === undefined) {
      return NextResponse.json({ error: 'Invalid notification payload' }, { status: 400 });
    }

    const statusCodeValue = String(statusCode);
    const grossAmountValue = String(grossAmount);

    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCodeValue}${grossAmountValue}${serverKey}`)
      .digest('hex');

    if (expectedSignature !== notification.signature_key) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    // The orderId format we used was `${invoiceId}-${timestamp}`
    if (!orderId || typeof notification.signature_key !== 'string') {
      return NextResponse.json({ error: 'Invalid notification payload' }, { status: 400 });
    }

    const separator = orderId.lastIndexOf('-');
    const invoiceId = separator > 0 ? orderId.slice(0, separator) : orderId;

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

      const paidAmount = Number(grossAmount);
      const paidCurrency = String(notification.currency || invoice?.currency || 'IDR').toUpperCase();

      if (!Number.isFinite(paidAmount) || !invoice || paidCurrency !== invoice.currency.toUpperCase() || Math.round(paidAmount) !== invoice.total) {
        return NextResponse.json({ error: 'Payment amount or currency does not match invoice' }, { status: 400 });
      }

      const existingPayment = await db.payment.findFirst({
        where: { gatewayProvider: 'midtrans', gatewayPaymentId: notification.transaction_id },
        select: { id: true },
      });

      if (!existingPayment && invoice.status !== 'PAID') {
        await db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              invoiceId,
              paidAmount,
              paidCurrency,
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
            await logAuditEvent({
              userId: invoice.userId,
              action: AuditAction.INVOICE_UPDATE,
              entity: AuditEntity.INVOICE,
              entityId: invoiceId,
              details: { paymentId: payment.id, gateway: 'midtrans', event: 'PAYMENT_RECEIVED' },
            });
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
