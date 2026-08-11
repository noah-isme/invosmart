'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap: any;
  }
}

interface PaymentGatewayModalProps {
  invoiceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function PaymentGatewayModal({ invoiceId, isOpen, onClose }: PaymentGatewayModalProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!isOpen) return null;

  const handleStripe = async () => {
    setLoading('stripe');
    setError(null);
    try {
      const res = await fetch('/api/payments/stripe/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize Stripe');
      window.location.href = data.url;
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message);
      setLoading(null);
    }
  };

  const handleMidtrans = async () => {
    setLoading('midtrans');
    setError(null);
    try {
      const res = await fetch('/api/payments/midtrans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize Midtrans');
      
      // Call Midtrans Snap
      if (window.snap) {
        window.snap.pay(data.token, {
          onSuccess: function () {
            router.push(`/app/invoices/${invoiceId}?payment=success`);
            onClose();
          },
          onPending: function () {
            router.push(`/app/invoices/${invoiceId}?payment=pending`);
            onClose();
          },
          onError: function () {
            setError('Payment failed or cancelled.');
            setLoading(null);
          },
          onClose: function () {
            setLoading(null);
          },
        });
      } else {
        throw new Error('Midtrans snap.js not loaded');
      }
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message);
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="glass-panel max-w-md w-full p-6 relative rounded-2xl">
        <button
          onClick={onClose}
          disabled={!!loading}
          className="absolute top-4 right-4 text-gray-400 hover:text-white disabled:opacity-50"
        >
          &times;
        </button>
        <h2 className="text-xl font-bold text-white mb-4">Select Payment Method</h2>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleStripe}
            disabled={!!loading}
            className={`w-full flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors ${loading === 'stripe' ? 'opacity-70' : ''} disabled:cursor-not-allowed`}
          >
            <div className="flex flex-col text-left">
              <span className="font-semibold text-white">Stripe</span>
              <span className="text-sm text-gray-400">Credit Card, International Payments</span>
            </div>
            {loading === 'stripe' ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span className="text-2xl">💳</span>
            )}
          </button>

          <button
            onClick={handleMidtrans}
            disabled={!!loading}
            className={`w-full flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors ${loading === 'midtrans' ? 'opacity-70' : ''} disabled:cursor-not-allowed`}
          >
            <div className="flex flex-col text-left">
              <span className="font-semibold text-white">Midtrans</span>
              <span className="text-sm text-gray-400">GoPay, OVO, Virtual Account, QRIS</span>
            </div>
            {loading === 'midtrans' ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span className="text-2xl">📱</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
