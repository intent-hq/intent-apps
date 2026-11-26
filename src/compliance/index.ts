/**
 * Bridge compliance suite: checks that a `window.intent` implementation (the
 * desktop app host, or the mock bridge) follows protocol §5.60. It has no
 * test-runner dependency: run it in an app window, in a browser or in Node and
 * read the results.
 */
import { toIntentError } from "../errors.js";
import { BUNDLE_HASH_RE } from "../hash.js";
import { compareUtf8 } from "../paths.js";
import { BRIDGE_VERSION, FEATURES, LIMITS, type Feature, type IntentBridge, type Level } from "../types.js";

export interface ComplianceOptions {
  /** The approved level and features of the session under test. */
  expect: { level: Level; features: Feature[] };
  /** Storage key prefix for the suite's keys. They are deleted at the end. Default `__compliance/`. */
  keyPrefix?: string;
  /** Make one real `models.complete` call (costs a model call on a real host). Default false. */
  liveModelCall?: boolean;
  /** Show one real notification. Default false. */
  showNotification?: boolean;
  /**
   * Run checks that hit limits: the notification rate limit, the model
   * in-flight limit (needs `liveModelCall`) and the storage quota (writes
   * about 10 MiB). Default false.
   */
  destructive?: boolean;
  /** Only run checks whose name contains this string. */
  filter?: string;
}

export interface ComplianceResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

class CheckFailed extends Error {}
class Skip extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new CheckFailed(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new CheckFailed(`${msg}: expected ${e}, got ${a}`);
}

async function rejects(p: () => Promise<unknown> | unknown, code: string, msg: string): Promise<Record<string, unknown> | undefined> {
  try {
    await p();
  } catch (e) {
    const err = toIntentError(e);
    if (err.code !== code) throw new CheckFailed(`${msg}: expected code ${code}, got ${err.code} (${err.message})`);
    return err.data;
  }
  throw new CheckFailed(`${msg}: expected rejection with ${code}, but it resolved`);
}

function syncThrows(fn: () => unknown, code: string, msg: string): void {
  let threw = false;
  let result: unknown;
  try {
    result = fn();
  } catch (e) {
    threw = true;
    const err = toIntentError(e);
    if (err.code !== code) throw new CheckFailed(`${msg}: expected code ${code}, got ${err.code} (${err.message})`);
  }
  if (!threw) {
    if (result instanceof Promise) result.catch(() => {});
    throw new CheckFailed(`${msg}: expected a synchronous throw with ${code}`);
  }
}

type Check = { name: string; run: () => Promise<void> };

export async function runCompliance(bridge: IntentBridge, opts: ComplianceOptions): Promise<ComplianceResult[]> {
  const pfx = opts.keyPrefix ?? "__compliance/";
  const { level } = opts.expect;
  const has = (f: Feature) => level >= 2 && opts.expect.features.includes(f);
  const checks: Check[] = [];
  const check = (name: string, run: () => Promise<void>) => checks.push({ name, run });

  check("bridgeVersion is 1", async () => {
    eq(bridge.bridgeVersion, BRIDGE_VERSION, "bridgeVersion");
  });

  check("app.info has the AppInfo shape", async () => {
    const info = await bridge.app.info();
    eq(Object.keys(info).sort(), ["appId", "bridgeVersion", "bundleHash", "features", "level", "name", "platform", "version"], "keys");
    assert(typeof info.appId === "string" && info.appId.length >= 3, "appId");
    assert(typeof info.name === "string" && info.name.length > 0, "name");
    assert(typeof info.version === "string", "version");
    assert(BUNDLE_HASH_RE.test(info.bundleHash), `bundleHash ${info.bundleHash}`);
    eq(info.level, level, "level");
    eq([...info.features].sort(), [...opts.expect.features].sort(), "features");
    assert(info.features.every((f) => (FEATURES as readonly string[]).includes(f)), "unknown feature");
    assert(["mac", "windows", "linux", "intent-os"].includes(info.platform), `platform ${info.platform}`);
    eq(info.bridgeVersion, 1, "bridgeVersion");
  });

  check("storage round-trips JSON values", async () => {
    const values: unknown[] = [{ a: [1, "two", { three: true }] }, [1, 2], "text ✓", 42.5, true, null, 0, ""];
    for (const [i, v] of values.entries()) {
      await bridge.storage.set(`${pfx}v${i}`, v);
      eq(await bridge.storage.get(`${pfx}v${i}`), v, `value ${i}`);
    }
  });

  check("storage.set resolves undefined", async () => {
    eq(await bridge.storage.set(`${pfx}u`, 1), undefined, "result");
  });

  check("storage.get of a missing key resolves undefined", async () => {
    const v = await bridge.storage.get(`${pfx}missing`);
    assert(v === undefined, `expected undefined, got ${JSON.stringify(v)}`);
  });

  check("storage.delete resolves deleted", async () => {
    await bridge.storage.set(`${pfx}d`, 1);
    eq(await bridge.storage.delete(`${pfx}d`), true, "first delete");
    eq(await bridge.storage.delete(`${pfx}d`), false, "second delete");
    assert((await bridge.storage.get(`${pfx}d`)) === undefined, "deleted key still found");
  });

  check("storage.list filters by prefix, sorts by UTF-8 bytes and pages", async () => {
    const base = `${pfx}list/`;
    const names = ["b", "a", "é", "\u{1F600}", "ｚ", "a/b", "a-b", "B"];
    for (const n of names) await bridge.storage.set(base + n, n);
    await bridge.storage.set(`${pfx}listx`, "outside");
    const expected = names.map((n) => base + n).sort(compareUtf8);
    const all = await bridge.storage.list({ prefix: base, limit: 1000 });
    eq(all.keys, expected, "single page");
    eq(all.nextCursor, null, "nextCursor of the last page");
    const paged: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { keys: string[]; nextCursor: string | null } = await bridge.storage.list(
        cursor === null ? { prefix: base, limit: 3 } : { prefix: base, limit: 3, cursor },
      );
      assert(page.keys.length <= 3, "page longer than limit");
      paged.push(...page.keys);
      cursor = page.nextCursor;
      assert(++pages <= 10, "too many pages");
    } while (cursor !== null);
    eq(paged, expected, "paged keys");
  });

  check("storage.list rejects bad options with invalid-params", async () => {
    await rejects(() => bridge.storage.list({ limit: 0 }), "invalid-params", "limit 0");
    await rejects(() => bridge.storage.list({ limit: 1001 }), "invalid-params", "limit 1001");
    await rejects(() => bridge.storage.list({ cursor: "\u0000not a cursor" }), "invalid-params", "bad cursor");
  });

  check("storage keys follow the key rule", async () => {
    await rejects(() => bridge.storage.set("", 1), "invalid-key", "empty key");
    await rejects(() => bridge.storage.set(`${pfx}a\u0000b`, 1), "invalid-key", "NUL in key");
    await rejects(() => bridge.storage.set(`${pfx}a\u007fb`, 1), "invalid-key", "DEL in key");
    await rejects(() => bridge.storage.set(`${pfx}a\u0085b`, 1), "invalid-key", "C1 control in key");
    await rejects(() => bridge.storage.get(`${pfx}a\nb`), "invalid-key", "newline in get");
    const k256 = pfx + "é".repeat((256 - pfx.length) / 2) + (pfx.length % 2 === 1 ? "x" : "");
    assert(new TextEncoder().encode(k256).length === 256, "test key length");
    await bridge.storage.set(k256, 1);
    await bridge.storage.delete(k256);
    await rejects(() => bridge.storage.set(k256 + "x", 1), "invalid-key", "257-byte key");
  });

  check("storage values are at most 256 KiB as compact JSON", async () => {
    const max = "x".repeat(LIMITS.storage.maxValueBytes - 2);
    await bridge.storage.set(`${pfx}big`, max);
    await bridge.storage.delete(`${pfx}big`);
    await rejects(() => bridge.storage.set(`${pfx}big`, max + "x"), "value-too-large", "256 KiB + 1");
  });

  const daemonGated: [string, Feature, () => Promise<unknown>][] = [
    ["notifications.show (empty title)", "notifications", () => bridge.notifications.show({ title: "" })],
    ["models.list", "models", () => bridge.models.list()],
  ];
  for (const [name, feature, call] of daemonGated) {
    check(`${name} is refused without ${feature}`, async () => {
      if (has(feature)) throw new Skip(`${feature} is approved`);
      await rejects(call, "forbidden", name);
    });
  }

  const hostGated: [string, Feature, () => Promise<unknown>][] = [
    ["window.setAlwaysOnTop", "alwaysOnTop", () => bridge.window.setAlwaysOnTop(false)],
    ["shortcuts.register", "globalShortcuts", () => bridge.shortcuts.register("CommandOrControl+Alt+Shift+F12")],
    ["shortcuts.unregisterAll", "globalShortcuts", () => bridge.shortcuts.unregisterAll()],
  ];
  for (const [name, feature, call] of hostGated) {
    check(`${name} ${"is refused without"} ${feature}`, async () => {
      if (has(feature)) throw new Skip(`${feature} is approved`);
      await rejects(call, "forbidden", name);
    });
  }

  check("models.complete is refused without models", async () => {
    if (has("models")) throw new Skip("models is approved");
    await rejects(() => bridge.models.complete({ prompt: "hi" }), "forbidden", "complete");
  });

  check("notifications.show validates its input", async () => {
    if (!has("notifications")) throw new Skip("notifications not approved");
    await rejects(() => bridge.notifications.show({ title: "   " }), "invalid-params", "blank title");
    await rejects(() => bridge.notifications.show({ title: "x".repeat(129) }), "invalid-params", "129-char title");
    await rejects(() => bridge.notifications.show({ title: "t", body: "x".repeat(1025) }), "invalid-params", "long body");
    await rejects(() => bridge.notifications.show({ title: "t", tag: "" }), "invalid-params", "empty tag");
    await rejects(() => bridge.notifications.show({ title: "t", tag: "x".repeat(65) }), "invalid-params", "long tag");
  });

  check("notifications.show resolves a notificationId", async () => {
    if (!has("notifications")) throw new Skip("notifications not approved");
    if (!opts.showNotification) throw new Skip("showNotification is off");
    const r = await bridge.notifications.show({ title: "Compliance check", body: "Intent apps bridge test", tag: "compliance" });
    eq(Object.keys(r), ["notificationId"], "keys");
    assert(typeof r.notificationId === "string" && r.notificationId.length > 0, "notificationId");
  });

  check("models.list has the AppModelProvider shape", async () => {
    if (!has("models")) throw new Skip("models not approved");
    const r = await bridge.models.list();
    eq(Object.keys(r).sort(), ["defaultProvider", "providers"], "keys");
    assert(r.defaultProvider === null || typeof r.defaultProvider === "string", "defaultProvider");
    assert(Array.isArray(r.providers), "providers");
    for (const p of r.providers) {
      eq(Object.keys(p).sort(), ["available", "defaultModel", "displayName", "models", "providerId", "reason"], "provider keys");
      assert(typeof p.providerId === "string" && typeof p.displayName === "string", "provider ids");
      assert(typeof p.available === "boolean", "available");
      assert(p.reason === null || typeof p.reason === "string", "reason");
      assert(p.defaultModel === null || typeof p.defaultModel === "string", "defaultModel");
      for (const m of p.models) eq(Object.keys(m).sort(), ["displayName", "id"], "model keys");
    }
    if (r.defaultProvider !== null) {
      assert(r.providers.some((p) => p.providerId === r.defaultProvider), "defaultProvider is listed");
    }
  });

  check("models.complete validates its input", async () => {
    if (!has("models")) throw new Skip("models not approved");
    await rejects(() => bridge.models.complete({ prompt: "" }), "invalid-params", "empty prompt");
    await rejects(() => bridge.models.complete({ prompt: "hi", timeoutMs: 999 }), "invalid-params", "timeoutMs 999");
    await rejects(() => bridge.models.complete({ prompt: "hi", timeoutMs: 300_001 }), "invalid-params", "timeoutMs 300001");
    await rejects(
      () => bridge.models.complete({ prompt: "hi", provider: "no-such-provider-compliance" }),
      "provider-unknown",
      "unknown provider",
    );
    const { providers } = await bridge.models.list();
    const p = providers.find((x) => x.available);
    if (p !== undefined) {
      await rejects(
        () => bridge.models.complete({ prompt: "hi", provider: p.providerId, model: "no-such-model-compliance" }),
        "model-unknown",
        "unknown model",
      );
    }
    const off = providers.find((x) => !x.available);
    if (off !== undefined) {
      await rejects(() => bridge.models.complete({ prompt: "hi", provider: off.providerId }), "unavailable", "unavailable provider");
    }
  });

  check("models.complete answers text, provider and model", async () => {
    if (!has("models")) throw new Skip("models not approved");
    if (!opts.liveModelCall) throw new Skip("liveModelCall is off");
    const { defaultProvider, providers } = await bridge.models.list();
    const p = providers.find((x) => x.providerId === defaultProvider && x.available);
    if (p === undefined) throw new Skip("no available default provider");
    const r = await bridge.models.complete({ prompt: "Answer with the single word: ok" });
    eq(Object.keys(r).sort(), ["model", "provider", "text"], "keys");
    eq(r.provider, p.providerId, "provider echo");
    assert(typeof r.text === "string" && typeof r.model === "string", "types");
  });

  check("raw rejections are plain { code, message, data? } objects", async () => {
    let raw: unknown;
    try {
      await bridge.storage.set("", 1);
    } catch (e) {
      raw = e;
    }
    assert(raw !== undefined, "storage.set with an empty key resolved");
    assert(raw !== null && typeof raw === "object" && !(raw instanceof Error), "rejection is not a plain object");
    const o = raw as Record<string, unknown>;
    assert(Object.keys(o).every((k) => k === "code" || k === "message" || k === "data"), `extra keys ${Object.keys(o)}`);
    eq(o.code, "invalid-key", "code");
    assert(typeof o.message === "string", "message");
    if ("data" in o) {
      assert(o.data !== null && typeof o.data === "object" && Object.keys(o.data as object).length > 0, "data present but empty");
    }
  });

  check("on() throws synchronously for unknown types and returns an unsubscribe function", async () => {
    syncThrows(() => bridge.on("no-such-event" as "shortcut", () => {}), "not-supported", "unknown event");
    const off = bridge.on("session-ended", () => {});
    assert(typeof off === "function", "unsubscribe is a function");
    off();
  });

  check("on(shortcut) throws forbidden synchronously without globalShortcuts", async () => {
    if (has("globalShortcuts")) throw new Skip("globalShortcuts is approved");
    syncThrows(() => bridge.on("shortcut", () => {}), "forbidden", "on(shortcut)");
  });

  check("shortcuts register and unregister", async () => {
    if (!has("globalShortcuts")) throw new Skip("globalShortcuts not approved");
    const acc = "CommandOrControl+Alt+Shift+F12";
    try {
      await bridge.shortcuts.register(acc);
    } catch (e) {
      if (toIntentError(e).code === "shortcut-unavailable") throw new Skip(`${acc} is taken on this machine`);
      throw e;
    }
    eq(await bridge.shortcuts.register(acc), undefined, "registering a held accelerator again is a no-op");
    eq(await bridge.shortcuts.unregister(acc), true, "unregister registered");
    eq(await bridge.shortcuts.unregister(acc), false, "unregister again");
    await bridge.shortcuts.unregisterAll();
  });

  check("an 11th distinct shortcut is invalid-params", async () => {
    if (!has("globalShortcuts")) throw new Skip("globalShortcuts not approved");
    if (!opts.destructive) throw new Skip("destructive is off");
    await bridge.shortcuts.unregisterAll();
    try {
      let held = 0;
      for (let i = 1; i <= 24 && held < 10; i++) {
        try {
          await bridge.shortcuts.register(`CommandOrControl+Alt+Shift+F${i}`);
          held++;
        } catch (e) {
          if (toIntentError(e).code !== "shortcut-unavailable") throw e;
        }
      }
      if (held < 10) throw new Skip("not enough free accelerators on this machine");
      await rejects(() => bridge.shortcuts.register("CommandOrControl+Alt+Shift+Insert"), "invalid-params", "11th shortcut");
    } finally {
      await bridge.shortcuts.unregisterAll();
    }
  });

  check("window.setAlwaysOnTop resolves undefined", async () => {
    if (!has("alwaysOnTop")) throw new Skip("alwaysOnTop not approved");
    eq(await bridge.window.setAlwaysOnTop(true), undefined, "on");
    eq(await bridge.window.setAlwaysOnTop(false), undefined, "off");
  });

  check("notifications are rate-limited at 10 per 60 s", async () => {
    if (!has("notifications")) throw new Skip("notifications not approved");
    if (!opts.destructive) throw new Skip("destructive is off");
    let data: Record<string, unknown> | undefined;
    for (let i = 0; i < 11; i++) {
      try {
        await bridge.notifications.show({ title: `Rate limit ${i}`, tag: "compliance-rate" });
      } catch (e) {
        const err = toIntentError(e);
        assert(err.code === "rate-limited", `expected rate-limited, got ${err.code}`);
        data = err.data;
        break;
      }
    }
    assert(data !== undefined, "no rate-limited after 11 calls");
    assert(typeof data.retryAfterMs === "number" && data.retryAfterMs > 0, "retryAfterMs");
  });

  check("a third concurrent models.complete is rate-limited", async () => {
    if (!has("models")) throw new Skip("models not approved");
    if (!opts.destructive || !opts.liveModelCall) throw new Skip("needs destructive and liveModelCall");
    const calls = [0, 1, 2].map(() => bridge.models.complete({ prompt: "Answer with the single word: ok" }).then(
      () => null,
      (e: unknown) => toIntentError(e),
    ));
    const errs = (await Promise.all(calls)).filter((e) => e !== null);
    assert(errs.length >= 1, "no call was refused");
    const err = errs.find((e) => e.code === "rate-limited");
    assert(err !== undefined, `expected rate-limited, got ${errs.map((e) => e.code).join(", ")}`);
    eq(err.data?.retryAfterMs, LIMITS.complete.inFlightRetryAfterMs, "retryAfterMs");
  });

  check("storage quota is 10 MiB per app", async () => {
    if (!opts.destructive) throw new Skip("destructive is off");
    const chunk = "q".repeat(LIMITS.storage.maxValueBytes - 2);
    let data: Record<string, unknown> | undefined;
    for (let i = 0; i < 50 && data === undefined; i++) {
      try {
        await bridge.storage.set(`${pfx}quota/${String(i).padStart(2, "0")}`, chunk);
      } catch (e) {
        const err = toIntentError(e);
        assert(err.code === "quota-exceeded", `expected quota-exceeded, got ${err.code}`);
        data = err.data ?? {};
      }
    }
    assert(data !== undefined, "no quota-exceeded after 50 × 256 KiB");
    eq(data.limitBytes, LIMITS.storage.quotaBytes, "limitBytes");
    assert(typeof data.usedBytes === "number" && data.usedBytes <= LIMITS.storage.quotaBytes, "usedBytes");
  });

  const results: ComplianceResult[] = [];
  for (const c of checks) {
    if (opts.filter !== undefined && !c.name.includes(opts.filter)) continue;
    try {
      await c.run();
      results.push({ name: c.name, status: "pass" });
    } catch (e) {
      if (e instanceof Skip) results.push({ name: c.name, status: "skip", detail: e.message });
      else results.push({ name: c.name, status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  await cleanup(bridge, pfx);
  return results;
}

async function cleanup(bridge: IntentBridge, pfx: string): Promise<void> {
  try {
    let cursor: string | null = null;
    const keys: string[] = [];
    do {
      const page: { keys: string[]; nextCursor: string | null } = await bridge.storage.list(
        cursor === null ? { prefix: pfx, limit: 1000 } : { prefix: pfx, limit: 1000, cursor },
      );
      keys.push(...page.keys);
      cursor = page.nextCursor;
    } while (cursor !== null);
    for (const k of keys) await bridge.storage.delete(k);
  } catch {
    // Best effort: a failed cleanup must not hide the results.
  }
}

/** Format results as a short text report. */
export function formatResults(results: ComplianceResult[]): string {
  const icon = { pass: "PASS", fail: "FAIL", skip: "SKIP" } as const;
  const lines = results.map((r) => `${icon[r.status]}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const n = (s: ComplianceResult["status"]) => results.filter((r) => r.status === s).length;
  lines.push(`${n("pass")} passed, ${n("fail")} failed, ${n("skip")} skipped`);
  return lines.join("\n");
}
