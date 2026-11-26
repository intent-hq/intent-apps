import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { APP_CSP } from "../dist/index.js";
import { loadBundle, serveBundle } from "../dist/node/index.js";
import { ROOT } from "./helpers.mjs";

const CLI = join(ROOT, "dist/node/cli.js");
const TEMPLATE = join(ROOT, "templates/quick-call");

test("validate: template passes, a missing manifest fails with the daemon error data", () => {
  const out = JSON.parse(execFileSync(process.execPath, [CLI, "validate", TEMPLATE], { encoding: "utf8" }));
  assert.equal(out.ok, true);
  assert.equal(out.manifest.id, "quick-call");
  assert.match(out.bundleHash, /^sha256:[0-9a-f]{64}$/);
  const bad = spawnSync(process.execPath, [CLI, "validate", join(ROOT, "schema")], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).error.code, "path-not-found");
});

test("hash: equals loadBundle", async () => {
  const out = execFileSync(process.execPath, [CLI, "hash", TEMPLATE], { encoding: "utf8" }).trim();
  assert.equal(out, (await loadBundle(TEMPLATE)).bundleHash);
});

test("init: copies the template with a new id and name", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "intent-apps-init-")), "my-app");
  execFileSync(process.execPath, [CLI, "init", dir, "--id", "my-app", "--name", "My App"]);
  const b = await loadBundle(dir);
  assert.deepEqual([b.manifest.id, b.manifest.name, b.manifest.version], ["my-app", "My App", "0.1.0"]);
  const bad = spawnSync(process.execPath, [CLI, "init", dir, "--id", "My App", "--name", "x"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
});

test("serve: app CSP, content types, entry at /, only bundle files", async () => {
  const { server, url } = await serveBundle(TEMPLATE, { port: 0 });
  try {
    const root = await fetch(url);
    assert.equal(root.status, 200);
    assert.equal(root.headers.get("content-security-policy"), APP_CSP);
    assert.equal(root.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await root.text(), readFileSync(join(TEMPLATE, "index.html"), "utf8"));
    const js = await fetch(new URL("intent-sdk/index.js", url));
    assert.equal(js.headers.get("content-type"), "text/javascript; charset=utf-8");
    const png = await fetch(new URL("icon.png", url));
    assert.equal(png.headers.get("content-type"), "image/png");
    for (const p of ["nope.js", "..%2Fpackage.json", "%2e%2e/package.json", "intent-sdk"]) {
      const r = await fetch(url + p);
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get("content-security-policy"), APP_CSP);
    }
  } finally {
    server.close();
  }
});
