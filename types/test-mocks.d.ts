declare module "@/lib/db" {
  // Tests mock the Prisma client. Provide a minimal `PrismaClientLike` that
  // exposes commonly used properties; tests can cast to `unknown` when needed.
  import type { PrismaClient } from "@prisma/client";
  const db: PrismaClient;
  export { db };
}

declare module "@sentry/nextjs" {
  export const init: ((opts?: unknown) => void) | undefined;
  export const captureException: ((err: unknown) => void) | undefined;
}

declare module "posthog-js" {
  const posthog: { capture?: (event: string, props?: Record<string, unknown>) => void };
  export default posthog;
}
