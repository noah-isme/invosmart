import { describe, it, expect, beforeEach } from 'vitest';
import { generateReceiptPdf } from '@/lib/receipts/pdf';

describe('receipts-pdf', () => {
  const mockReceipt = {
    id: '1',
    receiptNo: 'RCP-202501-0001',
    verifyToken: 'a'.repeat(64),
    positionPreset: 'bottom_right' as const,
    stampPaidEnabled: true,
    stampCompanySealEnabled: false,
    signatureEnabled: false,
    createdAt: new Date('2025-01-15'),
    paymentId: '1',
    payment: {
      id: '1',
      invoiceId: '1',
      paidAmount: 1000000,
      paidCurrency: 'IDR',
      paidAt: new Date('2025-01-15'),
      method: 'Transfer Bank',
      note: 'Test payment',
      createdAt: new Date('2025-01-15'),
      invoice: {
        id: '1',
        number: 'INV-2025-001',
        client: 'PT Test Corp',
        items: [],
        subtotal: 900000,
        tax: 100000,
        total: 1000000,
        status: 'PAID' as const,
        issuedAt: new Date('2025-01-01'),
        dueAt: new Date('2025-01-31'),
        paidAt: new Date('2025-01-15'),
        notes: null,
        userId: '1',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-15'),
        user: {
          id: '1',
          name: 'Test Company',
          email: 'test@example.com',
          password: null,
          logoUrl: null,
          primaryColor: null,
          fontFamily: null,
          brandingSyncWithTheme: false,
          useThemeForPdf: false,
          themePrimary: '#6366F1',
          themeAccent: '#22D3EE',
          themeMode: 'dark',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      },
    },
  };

  it('generates PDF buffer with minimum size', async () => {
    const buffer = await generateReceiptPdf(mockReceipt);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('PDF contains receipt number marker', async () => {
    const buffer = await generateReceiptPdf(mockReceipt);
    const pdfString = buffer.toString('latin1');
    expect(pdfString).toContain('RCP-202501-0001');
  });

  it('PDF contains company name', async () => {
    const buffer = await generateReceiptPdf(mockReceipt);
    const pdfString = buffer.toString('latin1');
    expect(pdfString).toContain('Test Company');
  });

  it('handles signature enabled flag', async () => {
    const withSig = { ...mockReceipt, signatureEnabled: true };
    const buffer = await generateReceiptPdf(withSig);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
