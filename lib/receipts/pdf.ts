/**
 * Receipt PDF Generator - Separate document from invoice
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Receipt, Payment, Invoice, User } from '@prisma/client';
import { formatAmount, formatDate, formatDateTime } from './format';
import { PAID_STAMP_SVG, COMPANY_SEAL_PLACEHOLDER_SVG, getDigitalSignatureBlock, svgToDataUrl } from './stamp-assets';

type ReceiptWithRelations = Receipt & {
  payment: Payment & {
    invoice: Invoice & { user: User };
  };
};

type StampConfig = {
  enabled: boolean;
  svg: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
};

export async function generateReceiptPdf(receipt: ReceiptWithRelations): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const { width: pageWidth, height: pageHeight } = page.getSize();
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const { payment } = receipt;
  const { invoice, paidAmount, paidAt, method, note } = payment;
  const { user, client, number: invoiceNumber, total: invoiceTotal } = invoice;
  
  // Header - Company Name & Logo
  let yPos = pageHeight - 60;
  page.drawText(user.name || 'InvoSmart', {
    x: 50,
    y: yPos,
    size: 20,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.3),
  });
  
  // Title
  yPos -= 40;
  page.drawText('BUKTI PEMBAYARAN', {
    x: 50,
    y: yPos,
    size: 16,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.4),
  });
  
  // Receipt metadata
  yPos -= 30;
  const metaFontSize = 11;
  const lineHeight = 18;
  
  const metadata = [
    ['No. Bukti:', receipt.receiptNo],
    ['Tanggal:', formatDateTime(receipt.createdAt)],
    ['Invoice:', invoiceNumber],
    ['Pelanggan:', client],
    ['', ''],
    ['Jumlah Tagihan:', formatAmount(invoiceTotal)],
    ['Jumlah Dibayar:', formatAmount(paidAmount, payment.paidCurrency)],
    ['Metode Pembayaran:', method || '-'],
    ['Tanggal Bayar:', formatDate(paidAt)],
  ];
  
  for (const [label, value] of metadata) {
    if (label) {
      page.drawText(label, {
        x: 50,
        y: yPos,
        size: metaFontSize,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      page.drawText(value, {
        x: 200,
        y: yPos,
        size: metaFontSize,
        font: label.startsWith('Jumlah') ? fontBold : font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    yPos -= lineHeight;
  }
  
  // Notes
  if (note) {
    yPos -= 10;
    page.drawText('Catatan:', {
      x: 50,
      y: yPos,
      size: metaFontSize,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });
    yPos -= lineHeight;
    page.drawText(note, {
      x: 50,
      y: yPos,
      size: 10,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    yPos -= 30;
  }
  
  // Verification token hint
  yPos -= 40;
  page.drawText('Token Verifikasi: ' + receipt.verifyToken.substring(0, 16) + '...', {
    x: 50,
    y: yPos,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  
  // Apply stamps based on position preset and flags
  const stamps: StampConfig[] = [];
  
  if (receipt.stampPaidEnabled) {
    stamps.push(createStampConfig('PAID', receipt.positionPreset, pageWidth, pageHeight));
  }
  
  if (receipt.stampCompanySealEnabled) {
    stamps.push(createStampConfig('SEAL', receipt.positionPreset, pageWidth, pageHeight, true));
  }
  
  for (const stamp of stamps) {
    if (stamp.enabled) {
      await embedSvgStamp(pdfDoc, page, stamp);
    }
  }
  
  // Digital signature block
  if (receipt.signatureEnabled && user.name) {
    const sigBlock = getDigitalSignatureBlock(user.name, 'Authorized', new Date());
    const sigLines = sigBlock.split('\n');
    let sigY = 150;
    page.drawText('___________________', {
      x: pageWidth - 200,
      y: sigY,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    sigY -= 15;
    for (const line of sigLines) {
      page.drawText(line, {
        x: pageWidth - 200,
        y: sigY,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      sigY -= 12;
    }
  }
  
  // Footer
  page.drawText('Dokumen ini dihasilkan secara otomatis oleh sistem InvoSmart', {
    x: 50,
    y: 40,
    size: 8,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });
  
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function createStampConfig(
  type: 'PAID' | 'SEAL',
  position: string,
  pageWidth: number,
  pageHeight: number,
  offsetForSecond = false
): StampConfig {
  const baseConfig = {
    enabled: true,
    svg: type === 'PAID' ? PAID_STAMP_SVG : COMPANY_SEAL_PLACEHOLDER_SVG,
    width: type === 'PAID' ? 120 : 100,
    height: type === 'PAID' ? 120 : 100,
    opacity: 0.9,
  };
  
  let x = 72;
  let y = pageHeight - 200;
  
  switch (position) {
    case 'bottom_left':
      x = 72 + (offsetForSecond ? 140 : 0);
      y = 120;
      break;
    case 'bottom_right':
      x = pageWidth - 220 - (offsetForSecond ? 140 : 0);
      y = 120;
      break;
    case 'center':
      x = pageWidth / 2 - 100 + (offsetForSecond ? 120 : -20);
      y = pageHeight / 2 - 60;
      baseConfig.opacity = 0.15;
      break;
  }
  
  return { ...baseConfig, x, y };
}

async function embedSvgStamp(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  config: StampConfig
): Promise<void> {
  try {
    const dataUrl = await svgToDataUrl(config.svg);
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;
    
    const svgImage = await pdfDoc.embedPng(Buffer.from(base64, 'base64')).catch(() => null);
    if (!svgImage) return;
    
    page.drawImage(svgImage, {
      x: config.x,
      y: config.y,
      width: config.width,
      height: config.height,
      opacity: config.opacity,
    });
  } catch (error) {
    console.error('Failed to embed stamp:', error);
  }
}
