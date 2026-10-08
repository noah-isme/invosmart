import Stripe from 'stripe';
import { e2eProviderBase } from './e2e-provider-base';

const configuredSecretKey = process.env.STRIPE_SECRET_KEY?.trim();

// Stripe validates the key during construction. Keep module evaluation safe
// for build-time route collection, then let request handlers return a clear
// 503 when the provider has not been configured in the current environment.
// INVOSMART_E2E_PROVIDER_BASE_URL (test-only, loopback-only) redirects the
// client to the e2e provider stub; when it is unset the options are unchanged.
export const stripe = new Stripe(configuredSecretKey || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
  ...(e2eProviderBase
    ? { host: e2eProviderBase.host, port: e2eProviderBase.port, protocol: e2eProviderBase.protocol }
    : {}),
});

export const isStripeConfigured = Boolean(configuredSecretKey);
