"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { getSnapScriptUrl } from "@/lib/security/csp";

type Provider = "stripe" | "midtrans";

type SharePayButtonProps = {
  invoiceId: string;
  token: string;
  stripeEnabled: boolean;
  midtransEnabled: boolean;
  /** Provider chosen by the server (lib/payments/checkout.ts pickShareCheckoutProvider). */
  defaultProvider: Provider;
  /** Start the default provider once on mount (`?action=pay` from the invoice email). */
  autoStart: boolean;
};

type SnapCallbacks = {
  onSuccess?: () => void;
  onPending?: () => void;
  onError?: () => void;
  onClose?: () => void;
};
type SnapGlobal = { pay: (token: string, callbacks: SnapCallbacks) => void };

type CheckoutResponse =
  | { provider: "stripe"; url: string }
  | { provider: "midtrans"; token: string; redirectUrl: string | null }
  | { error?: string; retry?: boolean };

const PROVIDER_LABEL: Record<Provider, string> = { stripe: "Stripe", midtrans: "Midtrans" };
// At most 4 requests per click, well inside the route's share-checkout rate
// limit (20/min per IP, app/api/share/checkout/route.ts).
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_500;
const SNAP_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getSnap(): SnapGlobal | null {
  const snap = (window as unknown as { snap?: SnapGlobal }).snap;
  return snap && typeof snap.pay === "function" ? snap : null;
}

async function waitForSnap(): Promise<SnapGlobal> {
  const deadline = Date.now() + SNAP_WAIT_MS;
  for (;;) {
    const snap = getSnap();
    if (snap) return snap;
    if (Date.now() > deadline) throw new Error("The payment window could not be loaded. Please try again.");
    await sleep(200);
  }
}

async function requestCheckout(body: { invoiceId: string; token: string; provider: Provider }) {
  for (let attempt = 0; ; attempt += 1) {
    // Plain fetch: the share-token checkout is CSRF-exempt and this public
    // page never receives a CSRF cookie.
    const response = await fetch("/api/share/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as CheckoutResponse;
    if (response.ok) return data;
    // 409 retry: the checkout is still being prepared. 503 retry: the
    // provider call failed and the server accepts a new attempt shortly.
    if ((response.status === 409 || response.status === 503) && "retry" in data && data.retry && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(("error" in data && data.error) || "Could not start the payment. Please try again.");
  }
}

export default function SharePayButton({
  invoiceId,
  token,
  stripeEnabled,
  midtransEnabled,
  defaultProvider,
  autoStart,
}: SharePayButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const returnTo = useCallback(
    (payment: "success" | "pending") => {
      const params = new URLSearchParams({ token, payment });
      router.replace(`/share/${encodeURIComponent(invoiceId)}?${params.toString()}`);
    },
    [invoiceId, router, token],
  );

  const start = useCallback(
    async (provider: Provider) => {
      setLoading(provider);
      setError(null);
      try {
        const data = await requestCheckout({ invoiceId, token, provider });
        if ("url" in data && data.url) {
          window.location.assign(data.url);
          return;
        }
        if ("token" in data && data.token) {
          const snap = await waitForSnap();
          snap.pay(data.token, {
            onSuccess: () => returnTo("success"),
            onPending: () => returnTo("pending"),
            onError: () => {
              setError("Payment failed or was cancelled.");
              setLoading(null);
            },
            onClose: () => setLoading(null),
          });
          return;
        }
        throw new Error("Could not start the payment. Please try again.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the payment. Please try again.");
        setLoading(null);
      }
    },
    [invoiceId, returnTo, token],
  );

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void start(defaultProvider);
  }, [autoStart, defaultProvider, start]);

  const secondary: Provider | null =
    defaultProvider === "stripe" ? (midtransEnabled ? "midtrans" : null) : stripeEnabled ? "stripe" : null;

  return (
    <section aria-label="Payment" className="mt-6 border-t border-border pt-6">
      {midtransEnabled ? (
        <Script
          src={getSnapScriptUrl(process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY)}
          data-client-key={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY}
          strategy="afterInteractive"
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {secondary ? (
          <button
            type="button"
            onClick={() => void start(secondary)}
            disabled={loading !== null}
            aria-busy={loading === secondary}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading === secondary ? "Starting payment…" : `Pay with ${PROVIDER_LABEL[secondary]}`}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void start(defaultProvider)}
          disabled={loading !== null}
          aria-busy={loading === defaultProvider}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === defaultProvider ? "Starting payment…" : "Pay now"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-right text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
