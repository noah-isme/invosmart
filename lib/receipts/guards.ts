/**
 * Receipt feature guards and validation
 */

import { ReceiptPosition } from '@prisma/client';

export function ensureFeatureEnabled(featureName: string): void {
  const enabled = process.env[`ENABLE_${featureName}`] === 'true';
  if (!enabled) {
    throw new Error(`Feature ${featureName} is not enabled`);
  }
}

export function ensureReceiptsEnabled(): void {
  ensureFeatureEnabled('RECEIPTS');
}

export function ensureReceiptStampsEnabled(): void {
  ensureFeatureEnabled('RECEIPT_STAMPS');
}

export function ensurePositionPreset(position: string): ReceiptPosition {
  const allowed = (process.env.RECEIPT_ALLOWED_POSITIONS || 'bottom-left,bottom-right,center')
    .split(',')
    .map(p => p.trim());
  
  if (!allowed.includes(position)) {
    throw new Error(`Position ${position} not allowed. Allowed: ${allowed.join(', ')}`);
  }
  
  const mapped: Record<string, ReceiptPosition> = {
    'bottom-left': 'bottom_left',
    'bottom-right': 'bottom_right',
    'center': 'center',
  };
  
  return mapped[position] as ReceiptPosition;
}
