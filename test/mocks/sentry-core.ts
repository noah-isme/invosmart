import { vi } from "vitest";

const createMockSpan = () => ({
  spanContext: () => ({ traceId: "mock-trace-id" }),
});

let activeSpan = createMockSpan();

export const getCurrentHub = vi.fn(() => ({
  getScope: () => ({
    getSpan: () => activeSpan,
  }),
}));

export const __setMockSpan = (span: { spanContext: () => { traceId: string } }) => {
  activeSpan = span;
};

