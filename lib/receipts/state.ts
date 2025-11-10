import { useState, useEffect } from 'react';

// Lightweight module-level state (non-reactive across tabs but sufficient for simple flow)
let selectedPaymentId: string | null = null;

export type ReceiptOptions = {
  positionPreset: 'bottom-left' | 'bottom-right' | 'center';
  enableCompanySeal: boolean;
  enablePaidStamp: boolean;
  enableSignature: boolean;
};

let receiptOptions: ReceiptOptions = {
  positionPreset: process.env.RECEIPT_DEFAULT_POSITION === 'bottom-left' ? 'bottom-left' : 'bottom-right',
  enableCompanySeal: false,
  enablePaidStamp: true,
  enableSignature: false,
};

export function setSelectedPayment(id: string | null) {
  selectedPaymentId = id;
}

export function getSelectedPayment() {
  return selectedPaymentId;
}

export function setReceiptOptions(next: Partial<ReceiptOptions>) {
  receiptOptions = { ...receiptOptions, ...next };
}

export function getReceiptOptions() {
  return receiptOptions;
}

export function useSelectedPayment() {
  const [value, setValue] = useState<string | null>(() => getSelectedPayment());
  return [value, (id: string | null) => { setSelectedPayment(id); setValue(id); }] as const;
}

export function useReceiptOptions() {
  const [opts, setOpts] = useState<ReceiptOptions>(() => getReceiptOptions());
  const update = (next: Partial<ReceiptOptions>) => {
    setReceiptOptions(next);
    setOpts(getReceiptOptions());
  };
  return [opts, update] as const;
}
