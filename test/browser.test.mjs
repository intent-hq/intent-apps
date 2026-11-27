// End-to-end: the template app runs in a plain headless Chrome with the mock
// bridge, served with the app CSP. Drives the page over the DevTools protocol
// (no dependencies). Skips when no Chrome is found, unless
// INTENT_APPS_REQUIRE_BROWSER=1 (CI sets it).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { serveBundle } from "../dist/node/index.js";
import { ROOT } from "./helpers.mjs";

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [];
  const pw = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()) {
      for (const sub of readdirSync(join(pw, d))) candidates.push(join(pw, d, sub, "chrome-headless-shell"));
    }
  }
  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  return candidates.find((c) => existsSync(c)) ?? null;
}

const chrome = findChrome();
const required = process.env.INTENT_APPS_REQUIRE_BROWSER === "1";

/** DevTools protocol over --remote-debugging-pipe (fd 3 in, fd 4 out, NUL-delimited JSON). */
function pipeCdp(proc) {
  let buf = "";
  let id = 0;
  const pending = new Map();
  const events = [];
  proc.stdio[4].setEncoding("utf8");
  proc.stdio[4].on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) events.push(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      const t = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`CDP ${method} timed out`));
      }, 15_000);
      pending.set(i, {
        method,
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      proc.stdio[3].write(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }) + "\0");
    });
  return { send, events };
}

test("template app runs in a plain browser with the mock bridge", { skip: !chrome && !required ? "no Chrome found" : false, timeout: 60_000 }, async () => {
  assert.ok(chrome, "INTENT_APPS_REQUIRE_BROWSER=1 but no Chrome found (set CHROME_BIN)");
  const { server, url } = await serveBundle(join(ROOT, "templates/quick-call"), { port: 0 });
  const profile = mkdtempSync(join(tmpdir(), "intent-apps-chrome-"));
  const proc = spawn(
    chrome,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  proc.on("error", () => {});
  proc.stderr.resume();
  try {
    const browser = pipeCdp(proc);
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const page = {
      send: (method, params) => browser.send(method, params, sessionId),
      events: browser.events,
    };
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Page.enable");
    await page.send("Page.navigate", { url });

    const evaluate = async (expression) => {
      const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const waitFor = async (expression, ms = 15_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await evaluate(expression)) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${expression}`);
    };

    await waitFor(`document.querySelectorAll("#provider option").length > 0`);
    const state = await evaluate(`({
      badge: !document.getElementById("mock-badge").hidden,
      providers: [...document.querySelectorAll("#provider option")].map((o) => o.value),
      models: [...document.querySelectorAll("#model option")].map((o) => o.value),
      hasBridge: typeof window.intent,
    })`);
    assert.deepEqual(state, { badge: true, providers: ["mock", "mock-offline"], models: ["mock-echo", "mock-upper"], hasBridge: "undefined" });

    await evaluate(`(() => {
      document.getElementById("model").value = "mock-upper";
      document.getElementById("prompt").value = "hello from the browser test";
      document.getElementById("ask").click();
    })()`);
    await waitFor(`document.getElementById("answer").textContent.length > 0`);
    const answer = await evaluate(`({
      text: document.getElementById("answer").textContent,
      meta: document.getElementById("answer-meta").textContent,
      history: [...document.querySelectorAll("#history li")].map((li) => li.title),
      stored: JSON.parse(localStorage.getItem("intent-app-mock:mock-app:history")),
    })`);
    assert.equal(answer.text, "(mock mock-upper) HELLO FROM THE BROWSER TEST");
    assert.match(answer.meta, /^mock · mock-upper · /);
    assert.deepEqual(answer.history, ["hello from the browser test"]);
    assert.deepEqual(answer.stored, ["hello from the browser test"]);

    const csp = await evaluate(`fetch("/").then(() => "fetched", (e) => "blocked")`);
    assert.equal(csp, "blocked", "connect-src 'none' must block fetch");

    const problems = page.events.filter(
      (e) =>
        (e.method === "Runtime.exceptionThrown") ||
        (e.method === "Log.entryAdded" && e.params.entry.level === "error" && !/connect-src|Refused to connect|Failed to fetch/.test(e.params.entry.text)),
    );
    assert.deepEqual(problems.map((p) => JSON.stringify(p.params).slice(0, 300)), []);
  } finally {
    proc.kill("SIGKILL");
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
