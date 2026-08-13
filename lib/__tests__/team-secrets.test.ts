import { describe, expect, it } from "vitest";

import { decryptWorkspaceSecret, encryptWorkspaceSecret } from "@/lib/team/secrets";

describe("workspace notification secret encryption", () => {
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("round-trips with a 32-byte application key", () => {
    const encoded = encryptWorkspaceSecret("https://hooks.slack.com/services/T/B/X", key);
    expect(encoded).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(decryptWorkspaceSecret(encoded, key)).toBe("https://hooks.slack.com/services/T/B/X");
    expect(encoded).not.toContain("hooks.slack.com");
  });

  it("fails closed for wrong keys and malformed ciphertext", () => {
    const encoded = encryptWorkspaceSecret("secret", key);
    expect(() => decryptWorkspaceSecret(encoded, `${key.slice(0, -1)}0`)).toThrow();
    expect(() => decryptWorkspaceSecret("v1:bad:bad:bad", key)).toThrow();
    expect(() => encryptWorkspaceSecret("", key)).toThrow(TypeError);
  });
});
