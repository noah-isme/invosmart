import { describe, it, expect } from 'vitest';
import {
  PAID_STAMP_SVG,
  COMPANY_SEAL_PLACEHOLDER_SVG,
  getDigitalSignatureBlock,
  svgToDataUrl
} from '@/lib/receipts/stamp-assets';

describe('receipts-stamp-assets', () => {
  it('PAID stamp SVG contains LUNAS text', () => {
    expect(PAID_STAMP_SVG).toContain('LUNAS');
    expect(PAID_STAMP_SVG).toContain('<svg');
  });

  it('Company seal placeholder contains text', () => {
    expect(COMPANY_SEAL_PLACEHOLDER_SVG).toContain('STEMPEL');
    expect(COMPANY_SEAL_PLACEHOLDER_SVG).toContain('PERUSAHAAN');
  });

  it('generates digital signature block', () => {
    const date = new Date('2025-01-15');
    const sig = getDigitalSignatureBlock('John Doe', 'CEO', date);
    expect(sig).toContain('John Doe');
    expect(sig).toContain('CEO');
    expect(sig).toContain('2025');
  });

  it('converts SVG to data URL', async () => {
    const dataUrl = await svgToDataUrl('<svg></svg>');
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
