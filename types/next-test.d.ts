declare module "next/server" {
  // Provide lightweight test-time shims. We use `unknown` instead of `any`
  // and export minimal shapes so tests can cast when they need runtime
  // behaviour.
  export type NextRequest = unknown;
  export const NextRequest: unknown;
  export type NextResponse = unknown;
  export const NextResponse: unknown;
}

declare module "@sentry/nextjs" {
  export function withSentryConfig<T = unknown>(config: T, options?: unknown): T;
}
