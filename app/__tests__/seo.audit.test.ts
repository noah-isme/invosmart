import { describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";

describe("app metadata", () => {
  it("defines title, description, and theme color", () => {
    expect(metadata.title).toMatchObject({
      default: "InvoSmart – Smart AI Invoice & Insight Platform",
      template: "%s | InvoSmart",
    });
    expect(metadata.description).toBe(
      "Kelola invoice, tema, dan insight finansial secara otomatis dengan kecerdasan buatan.",
    );
    expect(metadata.openGraph?.title).toBe("InvoSmart – Smart AI Invoice & Insight Platform");
    expect(metadata.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#ffffff" },
      { media: "(prefers-color-scheme: dark)", color: "#0e1016" },
    ]);
  });
});
