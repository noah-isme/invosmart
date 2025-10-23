import { vi } from "vitest";

export const hash = vi.fn(async (value: string) => `hashed-${value}`);
export const compare = vi.fn(async () => true);
