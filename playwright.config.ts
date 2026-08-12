import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "test/e2e",
  // Vitest integration suites also live under test/e2e; keep Playwright's
  // release gate limited to browser specs.
  testMatch: "**/*.spec.ts",
  outputDir: "QA-report/results",
  reporter: "list",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    port: PORT,
    env: {
      NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
