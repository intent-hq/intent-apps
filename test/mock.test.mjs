import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockBridge, IntentError, connect, resetConnection, wrapBridge } from "../dist/index.js";
import { runCompliance, formatResults } from "../dist/compliance/index.js";

const ALL = ["notifications", "models", "globalShortcuts", "alwaysOnTop"];
const fast = { complete: async (req) => `echo ${req.prompt}` };

async function codeOf(p) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof IntentError, `not an IntentError: ${e}`);
    return e;
  }
  assert.fail("expected a rejection");
}

const configs = [
  { level: 1, features: [] },
  { level: 2, features: [] },
  { level: 2, features: ["models"] },
  { level: 2, features: ["notifications", "globalShortcuts"] },
  { level: 2, features: ALL },
];

for (const expect of configs) {
  test(`mock passes the compliance suite at level ${expect.level} with [${expect.features}]`, async () => {
    const slow = { complete: (req, signal) => new Promise((r) => setTimeout(() => r(`echo ${req.prompt}`), 50)) };
    const bridge = createMockBridge({ level: expect.level, features: expect.features, onNotify: () => {}, ...slow });
    const results = await runCompliance(bridge, {
      expect,
      liveModelCall: true,
      showNotification: true,
      destructive: true,
    });
    const failed = results.filter((r) => r.status === "fail");
    assert.equal(failed.length, 0, formatResults(results));
    assert.ok(results.filter((r) => r.status === "pass").length >= 12);
    assert.equal(bridge.mock.usedBytes(), 0, "compliance cleanup left keys behind");
  });
}

test("compliance catches a broken bridge", async () => {
  const good = createMockBridge({ level: 2, features: ["models"] });
  const broken = {
    ...good,
    storage: { ...good.storage, get: async (k) => ((await good.storage.get(k)) ?? null) },
    models: { ...good.models, list: async () => ({ providers: [] }) },
  };
  const results = await runCompliance(broken, { expect: { level: 2, features: ["models"] } });
  const failed = results.filter((r) => r.status === "fail").map((r) => r.name);
  assert.ok(failed.includes("storage.get of a missing key resolves undefined"), failed.join("\n"));
  assert.ok(failed.includes("models.list has the AppModelProvider shape"), failed.join("\n"));
});

test("default features follow the level", async () => {
  assert.deepEqual((await createMockBridge({ level: 1 }).app.info()).features, []);
  assert.deepEqual((await createMockBridge().app.info()).features, ALL);
});

test("feature misses are forbidden with the daemon detail", async () => {
  const b = createMockBridge({ level: 2, features: [] });
  const e = await codeOf(b.notifications.show({ title: "x" }));
  assert.equal(e.code, "forbidden");
  assert.equal(e.message, "feature notifications not approved");
  assert.equal((await codeOf(createMockBridge({ level: 1 }).models.list())).code, "forbidden");
});

test("notification rate limit with retryAfterMs from the rolling window", async () => {
  let t = 1_000_000;
  const b = createMockBridge({ now: () => t, onNotify: () => {} });
  for (let i = 0; i < 10; i++) {
    await b.notifications.show({ title: `n${i}` });
    t += 1000;
  }
  const e = await codeOf(b.notifications.show({ title: "over" }));
  assert.equal(e.code, "rate-limited");
  assert.equal(e.data.retryAfterMs, 50_000);
  t += 50_000;
  await b.notifications.show({ title: "after the window" });
});

test("a tag replaces the earlier notification", async () => {
  const b = createMockBridge({ onNotify: () => {} });
  await b.notifications.show({ title: "one", tag: "t" });
  await b.notifications.show({ title: "two", tag: "t" });
  await b.notifications.show({ title: "other" });
  assert.deepEqual(b.mock.notifications.map((n) => n.title), ["two", "other"]);
});

test("models.complete: defaults, echo, unavailable and timeout", async () => {
  const b = createMockBridge();
  const r = await b.models.complete({ prompt: "hi" });
  assert.deepEqual(r, { text: "(mock mock-echo) hi", provider: "mock", model: "mock-echo" });
  const up = await b.models.complete({ prompt: "hi", model: "mock-upper" });
  assert.equal(up.text, "(mock mock-upper) HI");
  const off = await codeOf(b.models.complete({ prompt: "hi", provider: "mock-offline" }));
  assert.deepEqual([off.code, off.message], ["unavailable", "Not signed in (mock)"]);
  const gate = createMockBridge({ complete: () => ({ available: false, reason: "gate closed" }) });
  assert.equal((await codeOf(gate.models.complete({ prompt: "hi" }))).code, "unavailable");
  const hang = createMockBridge({ complete: () => new Promise(() => {}) });
  const t0 = Date.now();
  assert.equal((await codeOf(hang.models.complete({ prompt: "hi", timeoutMs: 1000 }))).code, "timeout");
  assert.ok(Date.now() - t0 >= 990);
  const none = createMockBridge({ models: { defaultProvider: null, providers: [] } });
  assert.equal((await codeOf(none.models.complete({ prompt: "hi" }))).code, "unavailable");
});

test("in-flight limit: the third concurrent call is rate-limited", async () => {
  const b = createMockBridge({ complete: () => new Promise((r) => setTimeout(() => r("ok"), 30)) });
  const settled = await Promise.allSettled([1, 2, 3].map(() => b.models.complete({ prompt: "x" })));
  assert.deepEqual(settled.map((s) => s.status), ["fulfilled", "fulfilled", "rejected"]);
  assert.equal(settled[2].reason.code, "rate-limited");
  assert.equal(settled[2].reason.data.retryAfterMs, 1000);
  await b.models.complete({ prompt: "after" });
});

test("storage quota: quota-exceeded changes nothing", async () => {
  const b = createMockBridge();
  const chunk = "q".repeat(256 * 1024 - 2);
  let i = 0;
  let err;
  for (; i < 50; i++) {
    try {
      await b.storage.set(`k${i}`, chunk);
    } catch (e) {
      err = e;
      break;
    }
  }
  assert.equal(err.code, "quota-exceeded");
  assert.equal(err.data.limitBytes, 10 * 1024 * 1024);
  assert.equal(err.data.usedBytes, b.mock.usedBytes());
  assert.equal(await b.storage.get(`k${i}`), undefined);
  await b.storage.set("k0", "small");
  await b.storage.set(`k${i}`, chunk);
});

test("storage keeps a copy, not a reference", async () => {
  const b = createMockBridge();
  const v = { a: [1] };
  await b.storage.set("k", v);
  v.a.push(2);
  const got = await b.storage.get("k");
  assert.deepEqual(got, { a: [1] });
  got.a.push(3);
  assert.deepEqual(await b.storage.get("k"), { a: [1] });
  assert.equal((await codeOf(b.storage.set("k", undefined))).code, "invalid-params");
  assert.equal((await codeOf(b.storage.set("k", 10n))).code, "invalid-params");
});

test("localStorage-like backend persists across bridges", async () => {
  const m = new Map();
  const ls = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  await createMockBridge({ appId: "one-app", storage: ls }).storage.set("x", 1);
  assert.equal(await createMockBridge({ appId: "one-app", storage: ls }).storage.get("x"), 1);
  assert.equal(await createMockBridge({ appId: "two-app", storage: ls }).storage.get("x"), undefined);
});

test("session end: listeners run, then every call is disconnected", async () => {
  const b = createMockBridge();
  const seen = [];
  const off = b.on("session-ended", (d) => seen.push(d.reason));
  b.on("session-ended", () => {
    throw new Error("a throwing listener must not stop others");
  });
  b.on("session-ended", (d) => seen.push(`second:${d.reason}`));
  b.mock.endSession("revoked");
  b.mock.endSession("closed");
  assert.deepEqual(seen, ["revoked", "second:revoked"]);
  assert.equal((await codeOf(b.storage.get("k"))).code, "disconnected");
  assert.equal((await codeOf(b.app.info())).code, "disconnected");
  off();
});

test("window.close ends the session with reason closed", async () => {
  let closed = false;
  const b = createMockBridge({ onClose: () => (closed = true) });
  const seen = [];
  b.on("session-ended", (d) => seen.push(d.reason));
  await b.window.close();
  assert.equal(closed, true);
  assert.deepEqual(seen, ["closed"]);
});

test("shortcuts: events, taken accelerators and the limit of 10", async () => {
  const b = createMockBridge({ takenShortcuts: ["Alt+T"] });
  const pressed = [];
  b.on("shortcut", (d) => pressed.push(d.accelerator));
  await b.shortcuts.register("Alt+K");
  assert.equal(b.mock.pressShortcut("Alt+K"), true);
  assert.equal(b.mock.pressShortcut("Alt+J"), false);
  assert.deepEqual(pressed, ["Alt+K"]);
  assert.equal((await codeOf(b.shortcuts.register("Alt+T"))).code, "shortcut-unavailable");
  for (let i = 1; i <= 9; i++) await b.shortcuts.register(`Alt+F${i}`);
  assert.equal((await codeOf(b.shortcuts.register("Alt+F10"))).code, "shortcut-unavailable");
  await b.shortcuts.register("Alt+K");
  await b.window.setAlwaysOnTop(true);
  assert.equal(b.mock.alwaysOnTop, true);
  assert.throws(() => createMockBridge({ level: 1 }).on("shortcut", () => {}), (e) => e.code === "forbidden");
});

test("wrapBridge turns plain-object rejections into IntentError", async () => {
  const base = createMockBridge();
  const hostLike = {
    ...base,
    storage: {
      ...base.storage,
      get: () => Promise.reject({ code: "invalid-key", message: "bad key", data: { x: 1 } }),
      set: () => Promise.reject(new Error("boom")),
      delete: () => Promise.reject("weird"),
    },
  };
  const c = wrapBridge(hostLike);
  const e1 = await codeOf(c.storage.get("k"));
  assert.deepEqual([e1.code, e1.message, e1.data], ["invalid-key", "bad key", { x: 1 }]);
  assert.equal((await codeOf(c.storage.set("k", 1))).code, "internal");
  assert.equal((await codeOf(c.storage.delete("k"))).code, "internal");
  assert.throws(() => wrapBridge({ ...base, bridgeVersion: 2 }), (e) => e.code === "not-supported");
});

test("connect: host bridge, mock fallback and mock: never", () => {
  resetConnection();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const c = connect();
    assert.equal(c.isMock, true);
    assert.notEqual(c.mock, null);
    assert.equal(connect(), c, "cached");
    resetConnection();
    assert.throws(() => connect({ mock: "never" }), (e) => e.code === "not-supported");
    globalThis.intent = createMockBridge({ appId: "host-app" });
    resetConnection();
    const h = connect();
    assert.equal(h.isMock, false);
    resetConnection();
    assert.equal(connect({ mock: "always" }).isMock, true);
  } finally {
    delete globalThis.intent;
    resetConnection();
    console.warn = warn;
  }
});
