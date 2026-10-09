import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const getServerSessionMock = vi.mocked(getServerSession);

// A signed-in user who is not a platform admin, e.g. the owner of a personal
// workspace that registered an address from the deprecated ADMIN_EMAILS list.
const nonAdmin = { user: { id: "cuid_attacker", email: "owner@example.com" }, expires: "2099-01-01" };

type Gate = { name: string; invoke: () => Promise<unknown> };

// Removing a gate from any of these makes the corresponding case fail: without
// it the component proceeds past the guard instead of redirecting.
const gates: Gate[] = [
  {
    name: "app/admin/audit-logs page",
    invoke: async () => (await import("@/app/app/admin/audit-logs/page")).default({}),
  },
  {
    name: "app/admin/audit-log page (alias)",
    invoke: async () => (await import("@/app/app/admin/audit-log/page")).default({}),
  },
  {
    name: "app/admin/uptime layout",
    invoke: async () => (await import("@/app/app/admin/uptime/layout")).default({ children: null }),
  },
  {
    name: "app/admin/feature-flags layout",
    invoke: async () => (await import("@/app/app/admin/feature-flags/layout")).default({ children: null }),
  },
  { name: "devtools/perf", invoke: async () => (await import("@/app/devtools/perf/page")).default() },
  { name: "devtools/ai-agents", invoke: async () => (await import("@/app/devtools/ai-agents/page")).default() },
  { name: "devtools/ai-audit", invoke: async () => (await import("@/app/devtools/ai-audit/page")).default({}) },
  { name: "devtools/ai-autonomy", invoke: async () => (await import("@/app/devtools/ai-autonomy/page")).default() },
  { name: "devtools/ai-federation", invoke: async () => (await import("@/app/devtools/ai-federation/page")).default() },
  { name: "devtools/ai-learning", invoke: async () => (await import("@/app/devtools/ai-learning/page")).default() },
  { name: "devtools/ai-tuning", invoke: async () => (await import("@/app/devtools/ai-tuning/page")).default() },
];

describe("platform-admin page and layout gates", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getServerSessionMock.mockResolvedValue(nonAdmin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(gates)("$name redirects a non-admin session to /app", async ({ invoke }) => {
    await expect(invoke()).rejects.toThrow("NEXT_REDIRECT:/app");
  });

  it.each(gates)("$name does not render for an anonymous visitor", async ({ invoke }) => {
    getServerSessionMock.mockResolvedValue(null);
    await expect(invoke()).rejects.toThrow(/NEXT_REDIRECT:\/(app|auth\/login)$/);
  });
});
