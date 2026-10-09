// `test` and `expect` for the e2e specs, extended with:
//
// - api          request context (same identity as the test's storageState)
//                whose calls carry the CSRF header and a fresh x-forwarded-for
// - factory      the API factories bound to `api`
// - stub         provider-stub control (auto: /__requests and /__fixtures are
//                reset before every test)
// - payments     checkout helpers: wait for the stub checkout page, forge and
//                post signed provider webhooks
// - persona      open a browser context signed in as one of the five personas
// - isolatedUser a fresh user + workspace with a logged-in browser context
// - guards       (auto) the only place that maps the Midtrans snap.js hosts to
//                the stub; aborts and fails any other browser request to a
//                non-loopback host; fails on an unexpected 429; collects
//                pageerror and securitypolicyviolation events (SEC-08)
//
// Every browser context made here (the default `context`, persona and
// isolatedUser contexts) gets its own x-forwarded-for and the guards.
import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

import {
  E2E_PERSONA_PASSWORD,
  E2E_PERSONAS,
  E2E_STUB_URL,
  personaStorageStatePath,
  type E2ePersona,
} from "./playwright.env";
import * as factories from "./support/api-factories";
import { apiRequest, type ApiRequestOptions, type LoggedInUser } from "./support/api-factories";
import { uniqueForwardedFor } from "./support/auth";

export { expect };

// ---------------------------------------------------------------------------
// api
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Api = {
  /** The underlying context (cookie jar = the acting user's session). */
  request: APIRequestContext;
  fetch(method: Method, url: string, options?: ApiRequestOptions): Promise<APIResponse>;
  get(url: string, options?: ApiRequestOptions): Promise<APIResponse>;
  post(url: string, options?: ApiRequestOptions): Promise<APIResponse>;
  put(url: string, options?: ApiRequestOptions): Promise<APIResponse>;
  patch(url: string, options?: ApiRequestOptions): Promise<APIResponse>;
  delete(url: string, options?: ApiRequestOptions): Promise<APIResponse>;
};

function makeApi(request: APIRequestContext, onResponse: (response: APIResponse) => void): Api {
  const send = async (method: Method, url: string, options?: ApiRequestOptions) => {
    const response = await apiRequest(request, method, url, options);
    onResponse(response);
    return response;
  };
  return {
    request,
    fetch: send,
    get: (url, options) => send("GET", url, options),
    post: (url, options) => send("POST", url, options),
    put: (url, options) => send("PUT", url, options),
    patch: (url, options) => send("PATCH", url, options),
    delete: (url, options) => send("DELETE", url, options),
  };
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

type Rest<F> = F extends (request: APIRequestContext, ...rest: infer A) => infer R ? (...rest: A) => R : never;

function bindFactories(request: APIRequestContext) {
  const bind =
    <F extends (request: APIRequestContext, ...rest: never[]) => unknown>(fn: F) =>
    (...rest: Parameters<Rest<F>>) =>
      (fn as unknown as (r: APIRequestContext, ...a: unknown[]) => ReturnType<F>)(request, ...rest);
  return {
    request,
    registerUser: bind(factories.registerUser),
    listWorkspaces: bind(factories.listWorkspaces),
    createWorkspace: bind(factories.createWorkspace),
    switchWorkspace: bind(factories.switchWorkspace),
    ensureActiveWorkspace: bind(factories.ensureActiveWorkspace),
    createClient: bind(factories.createClient),
    createInvoice: bind(factories.createInvoice),
    createTemplate: bind(factories.createTemplate),
    createApiKey: bind(factories.createApiKey),
    createReminderRule: bind(factories.createReminderRule),
    inviteMember: bind(factories.inviteMember),
    acceptInvitation: bind(factories.acceptInvitation),
    createSlackEndpoint: bind(factories.createSlackEndpoint),
    getPaymentAttempt: bind(factories.getPaymentAttempt),
    payInvoiceViaMidtrans: bind(factories.payInvoiceViaMidtrans),
    payInvoiceViaStripe: bind(factories.payInvoiceViaStripe),
    createReceipt: bind(factories.createReceipt),
    createExperiment: bind(factories.createExperiment),
  };
}
export type Factory = ReturnType<typeof bindFactories> & {
  /** The same factories acting as another user (another request context). */
  as(request: APIRequestContext): ReturnType<typeof bindFactories>;
};

// ---------------------------------------------------------------------------
// stub
// ---------------------------------------------------------------------------

export type StubRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json?: unknown;
  at: string;
};

export type Stub = {
  url: string;
  /** Requests the stub recorded since the test started, optionally by path prefix. */
  requests(pathPrefix?: string): Promise<StubRequest[]>;
  /** Force the next `count` calls under `target` to answer `status` or `fixture`. */
  force(rule: { target: string; status?: number; fixture?: string; count?: number }): Promise<void>;
  reset(): Promise<void>;
};

// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------

export type Payments = {
  /** Wait for `page` to reach the stub checkout page; returns the session/token id. */
  waitForCheckoutPage(page: Page): Promise<string>;
  midtransNotification: typeof factories.midtransNotification;
  stripeCheckoutCompletedEvent: typeof factories.stripeCheckoutCompletedEvent;
  postMidtransNotification(notification: Record<string, unknown>): Promise<APIResponse>;
  postStripeEvent(event: Record<string, unknown>, options?: { secret?: string; timestamp?: number }): Promise<APIResponse>;
};

// ---------------------------------------------------------------------------
// guards
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// lib/security/csp.ts getSnapScriptUrl(): https://app[.sandbox].midtrans.com/snap/snap.js
const MIDTRANS_SNAP_HOSTS = new Set(["app.sandbox.midtrans.com", "app.midtrans.com"]);
const MIDTRANS_SNAP_PATH = "/snap/snap.js";
export const EXPECTS_429 = "expects-429";

export type CspViolation = {
  pageUrl: string;
  blockedURI: string;
  violatedDirective: string;
  effectiveDirective: string;
  sourceFile: string;
};

export type Guards = {
  /** Install the guards on a context (done for every context these fixtures create). */
  install(context: BrowserContext): Promise<void>;
  /** Messages that will fail the test at teardown. */
  readonly violations: string[];
  /** Uncaught page errors, for SEC-08 style assertions. */
  readonly pageErrors: Error[];
  /** securitypolicyviolation events, for SEC-08. */
  readonly cspViolations: CspViolation[];
  /** Snap requests served from the stub's /snap.js, by original URL. */
  readonly snapRequests: string[];
  /** Record an unexpected 429 seen outside a browser context (api fixtures). */
  checkApiResponse(response: APIResponse): void;
};

const expects429 = (testInfo: TestInfo) => testInfo.annotations.some((a) => a.type === EXPECTS_429);

function makeGuards(testInfo: TestInfo): Guards {
  const violations: string[] = [];
  const pageErrors: Error[] = [];
  const cspViolations: CspViolation[] = [];
  const snapRequests: string[] = [];
  const installed = new WeakSet<BrowserContext>();

  const on429 = (url: string, source: string) => {
    if (!expects429(testInfo)) {
      violations.push(
        `guards: unexpected 429 from ${url} (${source}; annotate the test with { type: "${EXPECTS_429}" } if it is deliberate)`,
      );
    }
  };

  const route = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || LOOPBACK_HOSTS.has(url.hostname)) {
      return route.fallback();
    }
    if (MIDTRANS_SNAP_HOSTS.has(url.hostname) && url.pathname === MIDTRANS_SNAP_PATH) {
      snapRequests.push(url.href);
      const response = await route.fetch({ url: `${E2E_STUB_URL}/snap.js` });
      return route.fulfill({ response, headers: { "content-type": "application/javascript" } });
    }
    violations.push(`guards: blocked browser request to non-loopback host: ${route.request().method()} ${url.href}`);
    return route.abort("blockedbyclient");
  };

  return {
    violations,
    pageErrors,
    cspViolations,
    snapRequests,
    checkApiResponse(response) {
      if (response.status() === 429) on429(response.url(), "api request");
    },
    async install(context) {
      if (installed.has(context)) return;
      installed.add(context);
      await context.route("**/*", route);
      context.on("response", (response) => {
        if (response.status() === 429) on429(response.url(), "browser");
      });
      context.on("weberror", (webError) => pageErrors.push(webError.error()));
      await context.exposeBinding("__e2eReportCspViolation", (source, violation: Omit<CspViolation, "pageUrl">) => {
        cspViolations.push({ pageUrl: source.page?.url() ?? "", ...violation });
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const report = (window as unknown as { __e2eReportCspViolation?: (v: unknown) => void })
            .__e2eReportCspViolation;
          report?.({
            blockedURI: event.blockedURI,
            violatedDirective: event.violatedDirective,
            effectiveDirective: event.effectiveDirective,
            sourceFile: event.sourceFile,
          });
        });
      });
    },
  };
}

/** Fail the test at teardown when a guard tripped. */
function assertNoViolations(guards: Guards): void {
  if (guards.violations.length > 0) {
    throw new Error(guards.violations.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// persona / isolatedUser
// ---------------------------------------------------------------------------

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  api: Api;
  factory: ReturnType<typeof bindFactories>;
};

export type PersonaSession = BrowserSession & { persona: E2ePersona; email: string };
export type IsolatedUser = BrowserSession & { user: LoggedInUser };
/** A fresh logged-in user with a workspace, request-only (no browser). */
export type ApiUser = { user: LoggedInUser; api: Api; factory: ReturnType<typeof bindFactories> };

type ContextDefaults = Pick<
  BrowserContextOptions,
  "baseURL" | "viewport" | "userAgent" | "deviceScaleFactor" | "isMobile" | "hasTouch" | "locale" | "reducedMotion" | "serviceWorkers"
>;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

type Fixtures = {
  api: Api;
  factory: Factory;
  stub: Stub;
  payments: Payments;
  persona: (persona: E2ePersona) => Promise<PersonaSession>;
  isolatedUser: IsolatedUser;
  /** Create fresh request-only users (each its own cookie jar and workspace); usable in the `api` project. */
  newApiUser: (tag?: string) => Promise<ApiUser>;
  guards: Guards;
  /** Option-shaped defaults used for contexts the fixtures create. */
  _contextDefaults: ContextDefaults;
  /** Fresh request contexts disposed after the test. */
  _newRequestContext: (storageState?: BrowserContextOptions["storageState"]) => Promise<APIRequestContext>;
  /** Fresh guarded browser contexts closed after the test. */
  _newBrowserContext: (storageState: BrowserContextOptions["storageState"]) => Promise<BrowserContext>;
};

export const test = base.extend<Fixtures>({
  // A fresh x-forwarded-for per test for the default browser context (the
  // app's rate limits key on it). A spec's own test.use() replaces it.
  extraHTTPHeaders: async ({}, use) => {
    await use({ "x-forwarded-for": uniqueForwardedFor() });
  },

  guards: [
    async ({}, use, testInfo) => {
      const guards = makeGuards(testInfo);
      await use(guards);
      assertNoViolations(guards);
    },
    { auto: true },
  ],

  context: async ({ context, guards }, use) => {
    await guards.install(context);
    await use(context);
  },

  _contextDefaults: async (
    { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, reducedMotion, serviceWorkers },
    use,
  ) => {
    await use({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, reducedMotion, serviceWorkers });
  },

  _newRequestContext: async ({ playwright, baseURL }, use) => {
    const created: APIRequestContext[] = [];
    await use(async (storageState) => {
      const request = await playwright.request.newContext({ baseURL, storageState });
      created.push(request);
      return request;
    });
    await Promise.all(created.map((request) => request.dispose()));
  },

  _newBrowserContext: async ({ browser, guards, _contextDefaults }, use) => {
    const created: BrowserContext[] = [];
    await use(async (storageState) => {
      const context = await (browser as Browser).newContext({
        ..._contextDefaults,
        storageState,
        extraHTTPHeaders: { "x-forwarded-for": uniqueForwardedFor() },
      });
      created.push(context);
      await guards.install(context);
      return context;
    });
    await Promise.all(created.map((context) => context.close()));
  },

  api: async ({ storageState, guards, _newRequestContext }, use) => {
    const request = await _newRequestContext(storageState);
    await use(makeApi(request, guards.checkApiResponse));
  },

  factory: async ({ api }, use) => {
    await use({ ...bindFactories(api.request), as: (request) => bindFactories(request) });
  },

  stub: [
    async ({ playwright }, use) => {
      const control = await playwright.request.newContext({ baseURL: E2E_STUB_URL });
      const reset = async () => {
        for (const path of ["/__requests", "/__fixtures"]) {
          const response = await control.delete(path);
          if (!response.ok()) throw new Error(`stub DELETE ${path} -> ${response.status()}`);
        }
      };
      await reset();
      await use({
        url: E2E_STUB_URL,
        reset,
        async requests(pathPrefix) {
          const response = await control.get("/__requests");
          const all = (await response.json()) as StubRequest[];
          return pathPrefix ? all.filter((entry) => entry.path.startsWith(pathPrefix)) : all;
        },
        async force(rule) {
          const response = await control.post("/__fixtures", { data: rule });
          if (!response.ok()) throw new Error(`stub POST /__fixtures -> ${response.status()}: ${await response.text()}`);
        },
      });
      await control.dispose();
    },
    { auto: true },
  ],

  payments: async ({ api }, use) => {
    await use({
      async waitForCheckoutPage(page) {
        const pattern = new RegExp(`^${E2E_STUB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/checkout/([^/?#]+)`);
        await page.waitForURL(pattern);
        await expect(page.getByRole("heading", { name: "Stub checkout" })).toBeVisible();
        return pattern.exec(page.url())![1];
      },
      midtransNotification: factories.midtransNotification,
      stripeCheckoutCompletedEvent: factories.stripeCheckoutCompletedEvent,
      postMidtransNotification: (notification) => factories.postMidtransNotification(api.request, notification),
      postStripeEvent: (event, options) => factories.postStripeEvent(api.request, event, options),
    });
  },

  persona: async ({ guards, _newBrowserContext, _newRequestContext }, use) => {
    await use(async (persona) => {
      const storageState = personaStorageStatePath(persona);
      const context = await _newBrowserContext(storageState);
      const request = await _newRequestContext(storageState);
      return {
        persona,
        email: E2E_PERSONAS[persona],
        context,
        page: await context.newPage(),
        api: makeApi(request, guards.checkApiResponse),
        factory: bindFactories(request),
      };
    });
  },

  isolatedUser: async ({ guards, _newBrowserContext, _newRequestContext }, use, testInfo) => {
    const request = await _newRequestContext({ cookies: [], origins: [] });
    const user = await factories.registerAndLogin(request, {
      email: factories.uniqueEmail(`isolated-${testInfo.workerIndex}`),
    });
    const context = await _newBrowserContext(await request.storageState());
    await use({ user, context, page: await context.newPage(), api: makeApi(request, guards.checkApiResponse), factory: bindFactories(request) });
  },

  newApiUser: async ({ guards, _newRequestContext }, use, testInfo) => {
    await use(async (tag = "api-user") => {
      const request = await _newRequestContext({ cookies: [], origins: [] });
      const user = await factories.registerAndLogin(request, {
        email: factories.uniqueEmail(`${tag}-${testInfo.workerIndex}`),
      });
      return { user, api: makeApi(request, guards.checkApiResponse), factory: bindFactories(request) };
    });
  },
});

/** storageState for test.use(), e.g. test.use({ storageState: personaState("viewer") }). */
export const personaState = personaStorageStatePath;
/** Credentials for the fixed personas (AUTH-02 logs in through the UI). */
export const personaCredentials = (persona: E2ePersona) => ({ email: E2E_PERSONAS[persona], password: E2E_PERSONA_PASSWORD });
