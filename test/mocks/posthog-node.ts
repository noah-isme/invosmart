import { vi } from "vitest";

export class PostHog {
  capture = vi.fn();
  shutdownAsync = vi.fn(async () => {});

  constructor(public key: string, public options?: Record<string, unknown>) {}
}
