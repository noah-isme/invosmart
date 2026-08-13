const SLACK_WEBHOOK_HOSTS = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 250;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 30_000;

export const DEFAULT_SLACK_WEBHOOK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const DEFAULT_SLACK_WEBHOOK_MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;

export type SlackWebhookPayload = Record<string, unknown>;

export type SlackWebhookErrorCode =
  | "not-configured"
  | "invalid-url"
  | "invalid-config"
  | "invalid-payload"
  | "timeout"
  | "network-error"
  | "http-error";

export type SlackWebhookNotifierOptions = {
  /** Defaults to `SLACK_WEBHOOK_URL` when omitted. */
  webhookUrl?: string | null;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  /** Injection points keep retries and timeout paths deterministic in tests. */
  fetchImpl?: typeof globalThis.fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

export type SlackWebhookSuccess = {
  ok: true;
  status: number;
  attempts: number;
};

export type SlackWebhookFailure = {
  ok: false;
  code: SlackWebhookErrorCode;
  /** Stable, redacted message. It never contains the webhook URL or response body. */
  message: string;
  attempts: number;
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
};

export type SlackWebhookResult = SlackWebhookSuccess | SlackWebhookFailure;

export type SlackWebhookUrlValidation =
  | { valid: true; url: string }
  | { valid: false; code: "invalid-url"; message: "Slack webhook URL is invalid" };

type ValidatedNotifierConfig = {
  webhookUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
  fetchImpl: typeof globalThis.fetch;
  sleep: (delayMs: number) => Promise<void>;
};

const failure = (
  code: SlackWebhookErrorCode,
  message: string,
  attempts = 0,
  extra: Partial<Pick<SlackWebhookFailure, "retryable" | "status" | "retryAfterMs">> = {},
): SlackWebhookFailure => ({
  ok: false,
  code,
  message,
  attempts,
  retryable: extra.retryable ?? false,
  ...(extra.status === undefined ? {} : { status: extra.status }),
  ...(extra.retryAfterMs === undefined ? {} : { retryAfterMs: extra.retryAfterMs }),
});

const isFiniteIntegerInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && Number.isFinite(value) && value >= min && value <= max;

const isFiniteNumberInRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/**
 * Incoming webhooks are deliberately restricted to Slack's HTTPS hosts and
 * `/services/...` path. This prevents a tenant-configured URL from becoming a
 * generic server-side request/SSRF primitive.
 */
export const isValidSlackWebhookUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !SLACK_WEBHOOK_HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return false;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    return (
      segments.length === 4 &&
      segments[0] === "services" &&
      segments.slice(1).every((segment) => /^[A-Za-z0-9._~-]+$/.test(segment))
    );
  } catch {
    return false;
  }
};

/** Structured counterpart to `isValidSlackWebhookUrl` for config endpoints. */
export const validateSlackWebhookUrl = (value: unknown): SlackWebhookUrlValidation =>
  isValidSlackWebhookUrl(value)
    ? { valid: true, url: value }
    : { valid: false, code: "invalid-url", message: "Slack webhook URL is invalid" };

/**
 * Returns a normalized config error without echoing the supplied URL. The
 * result is intentionally data-only so callers can expose it to telemetry.
 */
const validateConfig = (
  options: SlackWebhookNotifierOptions,
): SlackWebhookFailure | ValidatedNotifierConfig => {
  const configuredUrl = options.webhookUrl === undefined ? process.env.SLACK_WEBHOOK_URL : options.webhookUrl;
  if (configuredUrl == null || configuredUrl === "") {
    return failure("not-configured", "Slack webhook is not configured");
  }
  if (!isValidSlackWebhookUrl(configuredUrl)) {
    return failure("invalid-url", "Slack webhook URL is invalid");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  if (!isFiniteIntegerInRange(timeoutMs, 1, MAX_TIMEOUT_MS)) {
    return failure("invalid-config", "Slack webhook notifier configuration is invalid");
  }
  if (!isFiniteIntegerInRange(maxAttempts, 1, MAX_ATTEMPTS)) {
    return failure("invalid-config", "Slack webhook notifier configuration is invalid");
  }
  if (!isFiniteNumberInRange(backoffMs, 0, MAX_BACKOFF_MS)) {
    return failure("invalid-config", "Slack webhook notifier configuration is invalid");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return failure("invalid-config", "Slack webhook notifier configuration is invalid");
  }

  return {
    webhookUrl: configuredUrl,
    timeoutMs,
    maxAttempts,
    backoffMs,
    fetchImpl,
    sleep: options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))),
  };
};

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const getRetryAfterMs = (response: Response): number | undefined => {
  const value = response.headers?.get("retry-after")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_AFTER_MS);
};

const retryDelay = (
  attempt: number,
  backoffMs: number,
  retryAfterMs: number | undefined,
): number =>
  retryAfterMs ?? Math.min(backoffMs * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_AFTER_MS);

const toPayloadBody = (payload: unknown): string | undefined => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  try {
    const body = JSON.stringify(payload);
    return body === undefined ? undefined : body;
  } catch {
    return undefined;
  }
};

class SlackTimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "SlackTimeoutError";
  }
}

/**
 * Sends a Slack Block Kit/incoming-webhook payload with bounded retries.
 * Provider response bodies and raw exception messages are intentionally
 * discarded so secrets cannot leak into logs or API responses.
 */
export async function sendSlackWebhook(
  payload: unknown,
  options: SlackWebhookNotifierOptions = {},
): Promise<SlackWebhookResult> {
  const body = toPayloadBody(payload);
  if (body === undefined) {
    return failure("invalid-payload", "Slack webhook payload is invalid");
  }

  const config = validateConfig(options);
  if ("code" in config) return config;

  let lastFailure: SlackWebhookFailure | undefined;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;

    try {
      const response = await new Promise<Response>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          didTimeout = true;
          controller.abort();
          reject(new SlackTimeoutError());
        }, config.timeoutMs);

        config
          .fetchImpl(config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          })
          .then(resolve, reject);
      });

      if (response.ok || (response.status >= 200 && response.status < 300)) {
        return { ok: true, status: response.status, attempts: attempt };
      }

      const retryable = isRetryableStatus(response.status);
      const retryAfterMs = retryable ? getRetryAfterMs(response) : undefined;
      lastFailure = failure(
        "http-error",
        `Slack webhook responded with HTTP ${response.status}`,
        attempt,
        { retryable, status: response.status, retryAfterMs },
      );

      if (!retryable || attempt >= config.maxAttempts) return lastFailure;
      await config.sleep(retryDelay(attempt, config.backoffMs, retryAfterMs));
    } catch (error: unknown) {
      const timedOut = didTimeout || error instanceof SlackTimeoutError;
      const code: SlackWebhookErrorCode = timedOut ? "timeout" : "network-error";
      lastFailure = failure(
        code,
        timedOut ? "Slack webhook request timed out" : "Slack webhook request failed",
        attempt,
        { retryable: true },
      );

      if (attempt >= config.maxAttempts) return lastFailure;
      await config.sleep(retryDelay(attempt, config.backoffMs, undefined));
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  // The loop always returns from success or failure; this is a defensive
  // fallback in case the implementation is changed in the future.
  return lastFailure ?? failure("network-error", "Slack webhook request failed");
}

/** Alias phrasing used by notification-oriented integrations. */
export const notifySlack = sendSlackWebhook;
export const sendSlackNotification = sendSlackWebhook;
