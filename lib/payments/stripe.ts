import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // @ts-expect-error: newer api version
  apiVersion: '2025-06-30.acacia', // use latest stable
  typescript: true,
});
