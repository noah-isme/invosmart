/**
 * Receipt stamp assets (SVG and placeholders)
 */

export const PAID_STAMP_SVG = `
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="90" fill="none" stroke="#22c55e" stroke-width="8"/>
  <circle cx="100" cy="100" r="75" fill="none" stroke="#22c55e" stroke-width="4"/>
  <text x="100" y="110" font-family="Arial, sans-serif" font-size="48" font-weight="bold" 
        fill="#22c55e" text-anchor="middle">LUNAS</text>
</svg>
`;

export const COMPANY_SEAL_PLACEHOLDER_SVG = `
<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg">
  <circle cx="75" cy="75" r="70" fill="none" stroke="#6366f1" stroke-width="6"/>
  <text x="75" y="75" font-family="Arial, sans-serif" font-size="14" 
        fill="#6366f1" text-anchor="middle" dominant-baseline="middle">STEMPEL</text>
  <text x="75" y="95" font-family="Arial, sans-serif" font-size="12" 
        fill="#6366f1" text-anchor="middle" dominant-baseline="middle">PERUSAHAAN</text>
</svg>
`;

export function getDigitalSignatureBlock(name: string, role: string, date: Date): string {
  const dateStr = new Intl.DateTimeFormat('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
  
  return `Ditandatangani secara digital:\n\n${name}\n${role}\n${dateStr}`;
}

export async function svgToDataUrl(svg: string): Promise<string> {
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
