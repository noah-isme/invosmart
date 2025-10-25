import config from "../next.config";

import { describe, expect, it } from "vitest";

describe("next.js configuration", () => {
  it("enables modern performance optimizations", () => {
    expect(config.compress).toBe(true);
    expect(config.images?.formats).toEqual([
      "image/avif",
      "image/webp",
    ]);
    expect(config.experimental?.optimizeCss).toBe(true);
  });

  it("defines immutable cache headers for static assets", async () => {
    const headers = await config.headers?.();
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/_next/static/(.*)" }),
        expect.objectContaining({ source: "/_next/image" }),
      ]),
    );
  });
});
