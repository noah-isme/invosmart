// F20 PWA: PWA-01 (plan .plans/e2e-scenarios.md, "F20 PWA").
//
// Verified against the code:
// - app/layout.tsx renders <PWARegister /> on every page and sets
//   metadata.manifest = "/manifest.json". components/PWARegister.tsx calls
//   navigator.serviceWorker.register("/sw.js") (default scope "/").
// - public/manifest.json has start_url "/app/dashboard".
// - public/sw.js precaches "/", "/app/dashboard" and "/manifest.json" on
//   install. Cache behaviour is not asserted (plan).
//
// Service workers are blocked for every other spec (playwright.config.ts
// use.serviceWorkers = "block"); this spec alone allows them and unregisters
// the worker and deletes its caches before the context closes.
//
// It runs as the default (owner) persona, not signed out: sw.js precaches
// "/app/dashboard" on install, and signed out that URL redirects
// (/api/auth/signin -> /auth/login?callbackUrl=http://localhost...). The CSP
// carries `upgrade-insecure-requests`, so Chromium upgrades the redirected
// fetch to https://localhost, which fails (ERR_SSL_PROTOCOL_ERROR) on the
// plain-http e2e server; cache.addAll() rejects and the worker goes redundant.
// That is an artefact of serving over http, not of production (https).
import { expect, test } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

test.use({ serviceWorkers: "allow" });

type Registration = { scope: string; activeScriptURL: string | null } | null;

test(
  "PWA-01 / registers /sw.js with scope / and /manifest.json starts at /app/dashboard",
  { annotation: covers("/", "/sw.js", "/manifest.json") },
  async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    try {
      await page.goto("/");
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json");

      await expect
        .poll(
          () =>
            page.evaluate(async (): Promise<Registration> => {
              const registration = await navigator.serviceWorker.getRegistration();
              if (!registration) return null;
              // Active = the install step (precache) succeeded.
              return { scope: registration.scope, activeScriptURL: registration.active?.scriptURL ?? null };
            }),
          { message: "navigator.serviceWorker.getRegistration() (see the console-errors attachment)" },
        )
        .toEqual({ scope: `${origin}/`, activeScriptURL: `${origin}/sw.js` });

      const manifest = await page.request.get("/manifest.json");
      expect(manifest.status()).toBe(200);
      expect(((await manifest.json()) as { start_url?: string }).start_url).toBe("/app/dashboard");
    } finally {
      if (consoleErrors.length > 0) {
        await test.info().attach("console-errors", { body: consoleErrors.join("\n"), contentType: "text/plain" });
      }
      // Do not leak the worker or its caches (the context is closed after the test anyway).
      if (page.url().startsWith(origin)) {
        const remaining = await page.evaluate(async () => {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
          return (await navigator.serviceWorker.getRegistrations()).length;
        });
        expect(remaining, "service worker registrations after cleanup").toBe(0);
      }
    }
  },
);
