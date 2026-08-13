import { describe, expect, it } from "vitest";

import {
  REQUIRED_STAGING_ENV,
  checkNodeVersion,
  inspectRepository,
  parseArgs,
  validateStagingEnvironment,
} from "./release-certification.mjs";

const validStagingEnvironment = () =>
  Object.fromEntries([
    ["DATABASE_URL", "postgresql://staging:secret@db.internal:5432/invosmart?schema=public"],
    ["NEXTAUTH_URL", "https://staging.invosmart.example"],
    ["NEXTAUTH_SECRET", "a-long-staging-secret"],
    ["CRON_SECRET", "a-long-cron-secret"],
    ["STRIPE_SECRET_KEY", "sk_test_staging"],
    ["STRIPE_WEBHOOK_SECRET", "whsec_staging"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_staging"],
    ["MIDTRANS_SERVER_KEY", "SB-Mid-server-staging"],
    ["MIDTRANS_CLIENT_KEY", "SB-Mid-client-staging"],
    ["NEXT_PUBLIC_MIDTRANS_CLIENT_KEY", "SB-Mid-client-staging"],
    ["RESEND_API_KEY", "re_staging"],
    ["RESEND_FROM_EMAIL", "billing@staging.invosmart.example"],
    ["RESEND_WEBHOOK_SECRET", "whsec_resend_staging"],
  ]);

describe("release certification preflight", () => {
  it("accepts Node 20 and rejects other major versions", () => {
    expect(checkNodeVersion("20.19.0").ok).toBe(true);
    expect(checkNodeVersion("v20.1.0").ok).toBe(true);
    expect(checkNodeVersion("22.1.0").ok).toBe(false);
  });

  it("keeps ordinary CI secret-free while staging mode opts into migration checks", () => {
    expect(parseArgs([], {}).mode).toBe("ci");
    expect(parseArgs(["--mode=staging", "--check-migrations", "--run-gates"], {})).toMatchObject({
      mode: "staging",
      checkMigrations: true,
      runGates: true,
    });
  });

  it("requires every staging provider setting and rejects placeholders", () => {
    const valid = validateStagingEnvironment(validStagingEnvironment());
    expect(valid.ok).toBe(true);
    expect(valid.missing).toEqual([]);
    expect(valid.placeholders).toEqual([]);

    const incomplete = validStagingEnvironment();
    delete incomplete.RESEND_WEBHOOK_SECRET;
    incomplete.STRIPE_SECRET_KEY = "sk_test_...";
    const result = validateStagingEnvironment(incomplete);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("RESEND_WEBHOOK_SECRET");
    expect(result.placeholders).toContain("STRIPE_SECRET_KEY");
  });

  it("rejects non-PostgreSQL databases and insecure staging URLs by default", () => {
    const invalid = validStagingEnvironment();
    invalid.DATABASE_URL = "file:./dev.db";
    invalid.NEXTAUTH_URL = "http://localhost:3000";
    const result = validateStagingEnvironment(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "DATABASE_URL must use a PostgreSQL connection string",
        expect.stringContaining("NEXTAUTH_URL must use https"),
      ]),
    );
    expect(validateStagingEnvironment(invalid, { allowHttp: true }).errors).toContain(
      "DATABASE_URL must use a PostgreSQL connection string",
    );
  });

  it("finds the repository gate entrypoints and payment migration", () => {
    const result = inspectRepository(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.migrationCount).toBeGreaterThan(0);
    expect(REQUIRED_STAGING_ENV).toContain("DATABASE_URL");
  });
});
