// Refuses any database URL that is not the loopback pglite instance of this e2e run.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertE2eDatabaseUrl(url, expectedPort, label = "DATABASE_URL") {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error(`e2e guard: ${label} is empty`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`e2e guard: ${label} is not a valid URL`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `e2e guard: ${label} host "${parsed.hostname}" is not loopback (expected 127.0.0.1, localhost or [::1])`,
    );
  }
  if (String(parsed.port) !== String(expectedPort)) {
    throw new Error(`e2e guard: ${label} port "${parsed.port}" does not match E2E_DB_PORT ${expectedPort}`);
  }
  return parsed;
}

export function assertE2eDatabaseUrls({ DATABASE_URL, DIRECT_URL }, expectedPort) {
  assertE2eDatabaseUrl(DATABASE_URL, expectedPort, "DATABASE_URL");
  assertE2eDatabaseUrl(DIRECT_URL, expectedPort, "DIRECT_URL");
}
