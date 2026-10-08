// Provider stub for e2e runs: Stripe, Midtrans, Resend, OpenAI-compatible, PostHog.
// Plain node:http, bound to 127.0.0.1 only. No real provider is ever contacted.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "fixtures");
const HOST = "127.0.0.1";

const readFixture = (name) => {
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });

const tryJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const lastUserText = (body) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const content = messages[i].content;
    if (typeof content === "string") return { text: content, hasImage: false };
    if (Array.isArray(content)) {
      return {
        text: content.filter((p) => p?.type === "text").map((p) => p.text).join("\n"),
        hasImage: content.some((p) => p?.type === "image_url"),
      };
    }
  }
  return { text: "", hasImage: false };
};

const pickFixtureName = (body) => {
  const { text, hasImage } = lastUserText(body);
  if (hasImage) return "receipt-scan";
  const t = text.toLowerCase();
  if (t.includes("malformed")) return "completion-malformed";
  if (t.includes("palet warna")) return "theme-suggest";
  if (t.includes("analis finansial")) return "insight";
  if (t.includes("governance explainer")) return "explain";
  return "invoice-draft";
};

export function createStub({ port = 0 } = {}) {
  let requests = [];
  let rules = [];
  let seq = 0;
  let boundPort = port;

  const base = () => `http://${HOST}:${boundPort}`;

  const record = (entry) => requests.push({ ...entry, at: new Date().toISOString() });

  const send = (res, status, body, type = "application/json") => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "content-type": type });
    res.end(payload);
  };

  const takeRule = (pathname) => {
    const rule = rules.find((r) => r.remaining > 0 && pathname.startsWith(r.target));
    if (!rule) return null;
    rule.remaining -= 1;
    return rule;
  };

  const completion = (content) => ({
    id: `chatcmpl-e2e-${++seq}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "e2e-stub",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: typeof content === "string" ? content : JSON.stringify(content),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  const handler = async (req, res) => {
    const url = new URL(req.url ?? "/", base());
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // Control plane
    if (pathname === "/__health" && method === "GET") return send(res, 200, "ok", "text/plain");
    if (pathname === "/__requests") {
      if (method === "GET") return send(res, 200, requests);
      if (method === "DELETE") {
        requests = [];
        return send(res, 200, { cleared: true });
      }
    }
    if (pathname === "/__fixtures") {
      if (method === "DELETE") {
        rules = [];
        return send(res, 200, { cleared: true });
      }
      if (method === "POST") {
        const body = tryJson(await readBody(req));
        if (!body || typeof body !== "object") return send(res, 400, { error: "invalid json" });
        const { target = "/", status, fixture, count = 1 } = body;
        if (status === undefined && !fixture) return send(res, 400, { error: "status or fixture required" });
        if (fixture && !readFixture(fixture)) return send(res, 400, { error: `unknown fixture ${fixture}` });
        rules.push({ target, status, fixture, remaining: Number(count) });
        return send(res, 200, { queued: true, target, status, fixture, count: Number(count) });
      }
    }

    if (method === "GET" && pathname === "/snap.js") {
      return send(res, 200, fs.readFileSync(path.join(HERE, "snap.js"), "utf8"), "application/javascript");
    }
    const page = pathname.match(/^\/checkout\/([^/]+)$/);
    if (method === "GET" && page) {
      const id = page[1].replace(/[^\w-]/g, "");
      record({ method, path: pathname, headers: req.headers, body: "" });
      return send(res, 200, `<!doctype html><html><head><title>Stub checkout</title></head><body><h1>Stub checkout</h1><p id="session">${id}</p></body></html>`, "text/html");
    }

    // Provider plane: record, then apply forced rules
    const raw = await readBody(req);
    record({ method, path: pathname + url.search, headers: req.headers, body: raw, json: tryJson(raw) });
    const json = tryJson(raw);

    const rule = takeRule(pathname);
    if (rule && rule.status !== undefined && rule.status !== null && !rule.fixture) {
      return send(res, Number(rule.status), { error: { message: `forced ${rule.status} by e2e stub` } });
    }

    if (method === "POST" && pathname === "/v1/checkout/sessions") {
      const id = `cs_test_${++seq}`;
      const form = new URLSearchParams(raw);
      const metadata = {};
      for (const [k, v] of form) {
        const m = k.match(/^metadata\[(.+)\]$/);
        if (m) metadata[m[1]] = v;
      }
      return send(res, rule?.status ?? 200, {
        id,
        object: "checkout.session",
        livemode: false,
        mode: form.get("mode") ?? "payment",
        status: "open",
        payment_status: "unpaid",
        client_reference_id: form.get("client_reference_id"),
        metadata,
        success_url: form.get("success_url"),
        cancel_url: form.get("cancel_url"),
        url: `${base()}/checkout/${id}`,
      });
    }

    if (method === "POST" && /^\/snap-(sandbox|production)\/v1\/transactions$/.test(pathname)) {
      const token = `e2e-snap-token-${++seq}`;
      return send(res, rule?.status ?? 201, {
        token,
        redirect_url: `${base()}/checkout/${token}`,
      });
    }

    if (method === "POST" && pathname === "/resend/emails") {
      return send(res, rule?.status ?? 200, { id: `email_e2e_${++seq}` });
    }

    if (method === "POST" && pathname === "/openai/v1/chat/completions") {
      const header = req.headers["x-e2e-fixture"];
      const name = (typeof header === "string" && header) || rule?.fixture || pickFixtureName(json);
      const fixture = readFixture(name);
      if (!fixture) return send(res, 400, { error: { message: `unknown fixture ${name}` } });
      return send(res, 200, completion(fixture.content));
    }

    if (method === "POST" && pathname.startsWith("/posthog/")) return send(res, 200, {});

    return send(res, 404, { error: "not found", path: pathname });
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => send(res, 500, { error: String(err?.message ?? err) }));
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          boundPort = server.address().port;
          resolve({ port: boundPort, url: base() });
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.E2E_STUB_PORT ?? 4010);
  const stub = createStub({ port });
  stub.listen().then(({ url }) => console.log(`provider stub listening on ${url}`));
  const stop = () => stub.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
