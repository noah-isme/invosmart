import test from "node:test";
import assert from "node:assert/strict";
import { createStub } from "./server.mjs";

let stub;
let url;
test.before(async () => {
  stub = createStub({ port: 0 });
  ({ url } = await stub.listen());
});
test.after(() => stub.close());
test.beforeEach(async () => {
  await fetch(`${url}/__requests`, { method: "DELETE" });
  await fetch(`${url}/__fixtures`, { method: "DELETE" });
});

const post = (p, body, headers = {}) =>
  fetch(`${url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
const chat = (content, headers) =>
  post("/openai/v1/chat/completions", { messages: [{ role: "user", content }] }, headers);
const content = async (res) => JSON.parse((await res.json()).choices[0].message.content);

test("listens on 127.0.0.1 only and reports health", async () => {
  assert.equal(stub.server.address().address, "127.0.0.1");
  const res = await fetch(`${url}/__health`);
  assert.equal(await res.text(), "ok");
});

test("stripe checkout session has sdk-shaped fields and a working page", async () => {
  const res = await fetch(`${url}/v1/checkout/sessions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "mode=payment&client_reference_id=invo_1&metadata[invoiceId]=inv1",
  });
  const s = await res.json();
  assert.match(s.id, /^cs_test_\d+$/);
  assert.equal(s.object, "checkout.session");
  assert.equal(s.client_reference_id, "invo_1");
  assert.equal(s.metadata.invoiceId, "inv1");
  assert.equal(s.url, `${url}/checkout/${s.id}`);
  assert.equal((await fetch(s.url)).status, 200);
});

test("midtrans sandbox and production paths are distinct and recorded", async () => {
  const a = await (await post("/snap-sandbox/v1/transactions")).json();
  const b = await (await post("/snap-production/v1/transactions")).json();
  assert.ok(a.token && a.redirect_url && b.token);
  const reqs = await (await fetch(`${url}/__requests`)).json();
  assert.deepEqual(reqs.map((r) => r.path), ["/snap-sandbox/v1/transactions", "/snap-production/v1/transactions"]);
  await fetch(`${url}/__requests`, { method: "DELETE" });
  assert.deepEqual(await (await fetch(`${url}/__requests`)).json(), []);
});

test("resend and posthog", async () => {
  assert.ok((await (await post("/resend/emails")).json()).id);
  assert.deepEqual(await (await post("/posthog/capture/")).json(), {});
});

test("openai: default, keyword, image and header selection", async () => {
  assert.equal((await content(await chat("buat invoice"))).client, "Acme Stub Co");
  assert.equal((await content(await chat("Buatkan palet warna primer"))).primary, "#0F766E");
  assert.ok((await content(await chat("Anda adalah analis finansial"))).totalRevenue);
  assert.ok((await content(await chat("Anda adalah AI governance explainer"))).why);
  const img = [{ type: "text", text: "scan" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }];
  assert.equal((await content(await chat(img))).client, "Toko Stub Mart");
  const mal = await (await chat("x", { "x-e2e-fixture": "completion-malformed" })).json();
  assert.throws(() => JSON.parse(mal.choices[0].message.content));
  assert.equal((await chat("x", { "x-e2e-fixture": "nope" })).status, 400);
});

test("fixtures: force status for the next N calls then recover", async () => {
  await post("/__fixtures", { target: "/openai", status: 503, count: 2 });
  assert.equal((await chat("a")).status, 503);
  assert.equal((await chat("a")).status, 503);
  assert.equal((await chat("a")).status, 200);
});

test("fixtures: a forced Resend status uses Resend's error body shape", async () => {
  await post("/__fixtures", { target: "/resend/emails", status: 500 });
  const forced = await post("/resend/emails", { to: "a@invosmart.test" });
  assert.equal(forced.status, 500);
  assert.deepEqual(await forced.json(), {
    statusCode: 500,
    name: "application_error",
    message: "forced 500 by e2e stub",
  });
  assert.equal((await post("/resend/emails", { to: "a@invosmart.test" })).status, 200);
});

test("fixtures: force a fixture once", async () => {
  await post("/__fixtures", { target: "/openai", fixture: "theme-suggest" });
  assert.equal((await content(await chat("anything"))).label, "Stub Teal");
  assert.equal((await content(await chat("anything"))).client, "Acme Stub Co");
});

test("snap.js is served and calls onSuccess on the next tick", async () => {
  const res = await fetch(`${url}/snap.js`);
  assert.match(res.headers.get("content-type"), /javascript/);
  const window = {};
  new Function("window", "setTimeout", await res.text())(window, setTimeout);
  let called = false;
  const done = new Promise((resolve) =>
    window.snap.pay("tok", { onSuccess: () => { called = true; resolve(); } }),
  );
  assert.equal(called, false);
  await done;
  assert.equal(called, true);
});

test("unknown route 404s", async () => {
  assert.equal((await post("/nope")).status, 404);
});
