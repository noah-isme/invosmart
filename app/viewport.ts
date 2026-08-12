import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1016" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // Common for PWAs
};
