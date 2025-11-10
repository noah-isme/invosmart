import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { formatAmount, formatDate } from '@/lib/receipts/format';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function ReceiptVerifyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-8 text-center">
          <h1 className="text-xl font-bold text-red-400">Token Tidak Valid</h1>
          <p className="mt-2 text-sm text-red-300">
            URL verifikasi harus menyertakan token
          </p>
        </div>
      </div>
    );
  }

  const receipt = await db.receipt.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          invoice: { include: { user: true } },
        },
      },
    },
  });

  if (!receipt || receipt.verifyToken !== token) {
    // Log invalid verification attempt
    if (receipt) {
      await db.receiptAuditLog.create({
        data: {
          receiptId: receipt.id,
          action: 'VERIFY_FAILED',
          actor: 'public',
          meta: { reason: 'invalid_token' },
        },
      });
    }
    return notFound();
  }

  // Log successful verification
  await db.receiptAuditLog.create({
    data: {
      receiptId: receipt.id,
      action: 'VERIFY_SUCCESS',
      actor: 'public',
      meta: { timestamp: new Date().toISOString() },
    },
  });

  const { payment } = receipt;
  const { invoice } = payment;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className="text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-green-500/20 p-4">
            <svg
              className="h-12 w-12 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-text">
            Receipt Terverifikasi
          </h1>
          <p className="mt-2 text-sm text-text/70">
            Bukti pembayaran ini valid dan terdaftar dalam sistem
          </p>
        </div>

        <div className="space-y-4 border-t border-white/10 pt-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-text/60">No. Bukti</p>
              <p className="mt-1 font-medium text-text">{receipt.receiptNo}</p>
            </div>
            <div>
              <p className="text-xs text-text/60">Tanggal</p>
              <p className="mt-1 font-medium text-text">
                {formatDate(receipt.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text/60">Invoice</p>
              <p className="mt-1 font-medium text-text">{invoice.number}</p>
            </div>
            <div>
              <p className="text-xs text-text/60">Pelanggan</p>
              <p className="mt-1 font-medium text-text">{invoice.client}</p>
            </div>
            <div>
              <p className="text-xs text-text/60">Jumlah Dibayar</p>
              <p className="mt-1 text-lg font-bold text-green-500">
                {formatAmount(payment.paidAmount, payment.paidCurrency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text/60">Metode</p>
              <p className="mt-1 font-medium text-text">
                {payment.method || '-'}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 text-center">
          <p className="text-xs text-text/50">
            Dikeluarkan oleh {invoice.user.name || 'InvoSmart'}
          </p>
          <p className="mt-1 text-xs text-text/40">
            Dokumen ini diverifikasi melalui sistem InvoSmart
          </p>
        </div>
      </div>
    </div>
  );
}
