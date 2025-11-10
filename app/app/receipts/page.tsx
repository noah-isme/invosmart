'use client';
import Link from 'next/link';

import { useState } from 'react';
import { RECEIPTS_COPY } from '@/lib/receipts/ui-copy';
import { useSelectedPayment, useReceiptOptions } from '@/lib/receipts/state';

function ReceiptsTabs() {
  const [active, setActive] = useState<'select' | 'create'>('select');
  const [selected] = useSelectedPayment();
  const [opts] = useReceiptOptions();
  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4" data-testid="receipts-tabs-shell">
      <div role="tablist" aria-label="Receipt Flow" className="flex gap-2">
        {(['select','create'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active === key ? 'bg-primary text-white' : 'bg-white/10 text-text/70 hover:text-text'}`}
          >
            {key === 'select' ? RECEIPTS_COPY.tabs.select : RECEIPTS_COPY.tabs.create}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-4 text-[10px] text-text/50">Tabs: Pilih Payment lalu atur opsi & preview.</div>
        {active === 'select' ? (
          <div data-testid="paid-payments-table-placeholder" className="text-xs text-text/70">
            Placeholder daftar pembayaran (PAID) – akan diisi komponen T2.
          </div>
        ) : (
          <div data-testid="receipt-options-placeholder" className="space-y-2 text-xs text-text/70">
            <p>Selected Payment: {selected ?? 'None'}</p>
            <p>Preset: {opts.positionPreset}</p>
            <p>Stamps: Seal {opts.enableCompanySeal ? 'ON' : 'OFF'} | Paid {opts.enablePaidStamp ? 'ON' : 'OFF'} | Signature {opts.enableSignature ? 'ON' : 'OFF'}</p>
            <p className="italic">Panel opsi & preview akan diimplementasi T3/T4.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [paymentId, setPaymentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    receiptId: string;
    receiptNo: string;
    verifyToken: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!paymentId.trim()) {
      setError('Payment ID required');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/receipts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          positionPreset: 'bottom-right',
          enablePaidStamp: true,
          enableCompanySeal: false,
          enableSignature: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create receipt');
        return;
      }

      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-text">{RECEIPTS_COPY.title}</h1>
        <p className="mt-1 text-sm text-text/60">{RECEIPTS_COPY.subtitle}</p>
      </div>
      <ReceiptsTabs />

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/app-settings/receipts"
          className="rounded-xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10"
        >
          <h3 className="font-semibold text-text">⚙️ Settings</h3>
          <p className="mt-2 text-sm text-text/60">Konfigurasi default</p>
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-semibold text-text">Create Receipt</h2>
        
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text">Payment ID</label>
            <input
              type="text"
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
              placeholder="Enter payment ID"
              className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-text"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={loading}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Receipt'}
          </button>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-400">❌ {error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-4 rounded-lg border border-green-500/20 bg-green-500/10 p-6">
              <h3 className="text-lg font-semibold text-green-400">✅ Receipt Created!</h3>
              <div className="space-y-2">
                <p className="text-sm text-green-300">Receipt: {result.receiptNo}</p>
                <p className="text-xs text-green-300/70">ID: {result.receiptId}</p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/receipts/${result.receiptId}/pdf`}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white"
                >
                  Download PDF
                </a>
                <a
                  href={`/receipts/${result.receiptId}/verify?token=${result.verifyToken}`}
                  className="rounded-lg border border-green-500/30 px-4 py-2 text-sm text-green-300"
                >
                  Verify
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
