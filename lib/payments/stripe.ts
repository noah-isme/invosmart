import Stripe from 'stripe';

const configuredSecretKey = process.env.STRIPE_SECRET_KEY?.trim();

// Stripe validates the key during construction. Keep module evaluation safe
// for build-time route collection, then let request handlers return a clear
// 503 when the provider has not been configured in the current environment.
export const stripe = new Stripe(configuredSecretKey || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
});

export const isStripeConfigured = Boolean(configuredSecretKey);
