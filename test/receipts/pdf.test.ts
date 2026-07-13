import { describe, it, expect, beforeEach } from 'vitest';
import { generateReceiptPdf } from '@/lib/receipts/pdf';
import zlib from 'zlib';

function getPdfTextContent(buffer: Buffer): string {
  const streams: string[] = [];
  let pos = 0;
  
  while (true) {
    const streamStart = buffer.indexOf('stream', pos);
    if (streamStart === -1) break;
    
    const streamEnd = buffer.indexOf('endstream', streamStart);
    if (streamEnd === -1) break;
    
    let dataStart = streamStart + 6;
    if (buffer[dataStart] === 13) dataStart++;
    if (buffer[dataStart] === 10) dataStart++;
    
    let dataEnd = streamEnd;
    if (buffer[dataEnd - 1] === 10) dataEnd--;
    if (buffer[dataEnd - 1] === 13) dataEnd--;
    
    const streamContent = buffer.subarray(dataStart, dataEnd);
    try {
      const decompressed = zlib.inflateSync(streamContent);
      streams.push(decompressed.toString('utf8'));
    } catch (e) {
      try {
        const decompressed = zlib.inflateRawSync(streamContent);
        streams.push(decompressed.toString('utf8'));
      } catch (err) {
        // ignore
      }
    }
    
    pos = streamEnd + 9;
  }
  return streams.join('\n');
}

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
    const content = getPdfTextContent(buffer);
    const hexMarker = Buffer.from('RCP-202501-0001').toString('hex').toUpperCase();
    expect(content).toContain(hexMarker);
  });

  it('PDF contains company name', async () => {
    const buffer = await generateReceiptPdf(mockReceipt);
    const content = getPdfTextContent(buffer);
    const hexMarker = Buffer.from('Test Company').toString('hex').toUpperCase();
    expect(content).toContain(hexMarker);
  });

  it('handles signature enabled flag', async () => {
    const withSig = { ...mockReceipt, signatureEnabled: true };
    const buffer = await generateReceiptPdf(withSig);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
