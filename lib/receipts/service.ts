/**
 * Receipt service - create, retrieve, token generation
 */

import { PrismaClient, ReceiptPosition } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

export type CreateReceiptInput = {
  paymentId: string;
  positionPreset: ReceiptPosition;
  stampCompanySealEnabled?: boolean;
  stampPaidEnabled?: boolean;
  signatureEnabled?: boolean;
  actor?: string;
};

export async function createReceipt(
  db: PrismaClient,
  input: CreateReceiptInput
) {
  const payment = await db.payment.findUnique({
    where: { id: input.paymentId },
    include: { invoice: true },
  });

  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.invoice.status !== 'PAID') {
    throw new Error('Invoice must be PAID to generate receipt');
  }

  const receiptNo = await generateReceiptNumber(db);
  const verifyToken = generateVerifyToken();

  const receipt = await db.receipt.create({
    data: {
      paymentId: input.paymentId,
      receiptNo,
      verifyToken,
      positionPreset: input.positionPreset,
      stampCompanySealEnabled: input.stampCompanySealEnabled ?? false,
      stampPaidEnabled: input.stampPaidEnabled ?? true,
      signatureEnabled: input.signatureEnabled ?? false,
    },
  });

  await db.receiptAuditLog.create({
    data: {
      receiptId: receipt.id,
      action: 'CREATE',
      actor: input.actor || 'system',
      meta: { positionPreset: input.positionPreset },
    },
  });

  return { receipt, receiptNo, verifyToken };
}

export async function getReceipt(db: PrismaClient, id: string) {
  return db.receipt.findUnique({
    where: { id },
    include: {
      payment: {
        include: { invoice: { include: { user: true } } },
      },
    },
  });
}

export async function generateReceiptNumber(db: PrismaClient): Promise<string> {
  const now = new Date();
  const prefix = `RCP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count = await db.receipt.count({
    where: { receiptNo: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

export function generateVerifyToken(): string {
  const random = randomBytes(32);
  return createHash('sha256').update(random).digest('hex');
}

export async function logAudit(
  db: PrismaClient,
  receiptId: string,
  action: string,
  actor: string,
  meta?: unknown
) {
  await db.receiptAuditLog.create({
    data: {
      receiptId,
      action,
      actor,
      meta: meta ? JSON.parse(JSON.stringify(meta)) : null,
    },
  });
}
