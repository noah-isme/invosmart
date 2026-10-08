import midtrans from 'midtrans-client';
import { e2eProviderBase } from './e2e-provider-base';

export const midtransSnap = new midtrans.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

// INVOSMART_E2E_PROVIDER_BASE_URL (test-only, loopback-only) redirects Snap API
// calls to the e2e provider stub. Only this instance is shadowed; the
// ApiConfig.SNAP_* statics are never modified.
if (e2eProviderBase) {
  const base = e2eProviderBase.origin;
  midtransSnap.apiConfig.getSnapApiBaseUrl = () =>
    midtransSnap.apiConfig.isProduction ? `${base}/snap-production/v1` : `${base}/snap-sandbox/v1`;
}
