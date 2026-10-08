import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
} from "@/lib/security/csrf";

/**
 * Browser-side half of the CSRF double-submit protection.
 *
 * The middleware issues a non-httpOnly `csrf-token` cookie; this helper reads
 * it and echoes it in the `x-csrf-token` header on same-origin mutating
 * requests. The token is never attached to cross-origin requests.
 */

/** Read the CSRF token from `document.cookie`. Returns null outside the browser or when absent. */
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  let cookieString = "";
  try {
    cookieString = document.cookie;
  } catch {
    return null;
  }

  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue;

    const raw = part.slice(separator + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method =
    init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }
  try {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Drop-in replacement for `fetch` that adds the `x-csrf-token` header to
 * same-origin POST/PUT/PATCH/DELETE requests. Other requests, cross-origin
 * requests, and calls made when no token cookie exists are passed through
 * to `fetch` unchanged. An explicitly supplied `x-csrf-token` header wins.
 */
export function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!CSRF_PROTECTED_METHODS.includes(resolveMethod(input, init)) || !isSameOrigin(input)) {
    return fetch(input, init);
  }

  const token = getCsrfTokenFromCookie();
  if (!token) {
    return fetch(input, init);
  }

  const headers = new Headers(
    init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
  );
  if (!headers.has(CSRF_HEADER_NAME)) {
    headers.set(CSRF_HEADER_NAME, token);
  }

  return fetch(input, { ...init, headers });
}
