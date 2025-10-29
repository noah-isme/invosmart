import { vi } from "vitest";

const createMockSpan = () => ({
  setStatus: vi.fn(),
  setAttribute: vi.fn(),
  spanContext: () => ({ traceId: "mock-trace-id" }),
});

let activeSpan = createMockSpan();

export const init = vi.fn();
export const captureException = vi.fn();
export const startSpan = vi.fn((_, callback: (span: ReturnType<typeof createMockSpan>) => unknown) => {
  activeSpan = createMockSpan();
  const result = callback(activeSpan);
  return result;
});
export const getCurrentHub = vi.fn(() => ({
  getScope: () => ({
    getSpan: () => activeSpan,
  }),
}));
