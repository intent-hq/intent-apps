import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BundleError, loadBundle, scanBundle, mimeTypeFor, contentTypeFor } from "../dist/node/index.js";
import { ROOT } from "./helpers.mjs";

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-apps-bundle-"));
  cpSync(join(ROOT, "test-vectors/bundles/hello"), dir, { recursive: true });
  return dir;
};

async function refusal(p) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof BundleError, String(e));
    return e.data;
  }
  assert.fail("expected a BundleError");
}

const posix = process.platform !== "win32";

test("loads a good bundle", async () => {
  const b = await loadBundle(fresh());
  assert.equal(b.manifest.id, "hello");
  assert.equal(b.fileCount, 4);
  assert.deepEqual(b.files.map((f) => f.path), ["app.js", "index.html", "intent-app.json", "sub/style.css"]);
});

test("missing manifest is path-not-found", async () => {
  const dir = fresh();
  rmSync(join(dir, "intent-app.json"));
  assert.equal((await refusal(loadBundle(dir))).code, "path-not-found");
  assert.equal((await refusal(loadBundle(join(dir, "nope")))).code, "path-not-found");
});

test("symlinks anywhere are invalid-bundle", { skip: !posix }, async () => {
  const dir = fresh();
  symlinkSync("app.js", join(dir, "sub/link.js"));
  const d = await refusal(loadBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", "sub/link.js"]);
  const dir2 = fresh();
  symlinkSync(tmpdir(), join(dir2, "outside"));
  assert.equal((await refusal(loadBundle(dir2))).code, "invalid-bundle");
});

test("a FIFO is invalid-bundle", { skip: process.platform !== "linux" }, async () => {
  const dir = fresh();
  execFileSync("mkfifo", [join(dir, "pipe")]);
  const d = await refusal(scanBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", "pipe"]);
});

test("more than 2000 files is invalid-bundle; 2000 is fine", async () => {
  const dir = fresh();
  mkdirSync(join(dir, "many"));
  for (let i = 0; i < 1996; i++) writeFileSync(join(dir, "many", `f${i}`), "");
  assert.equal((await scanBundle(dir)).fileCount, 2000);
  writeFileSync(join(dir, "many", "one-more"), "");
  const d = await refusal(scanBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", null]);
});

test("a file over 16 MiB is invalid-bundle; 16 MiB is fine", async () => {
  const dir = fresh();
  writeFileSync(join(dir, "big.bin"), "");
  truncateSync(join(dir, "big.bin"), 16 * 1024 * 1024);
  await scanBundle(dir);
  truncateSync(join(dir, "big.bin"), 16 * 1024 * 1024 + 1);
  const d = await refusal(scanBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", "big.bin"]);
});

test("a total over 64 MiB is invalid-bundle", async () => {
  const dir = fresh();
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(dir, `b${i}.bin`), "");
    truncateSync(join(dir, `b${i}.bin`), 16 * 1024 * 1024);
  }
  const d = await refusal(scanBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", null]);
});

test("a backslash in a file name is invalid-bundle", { skip: !posix }, async () => {
  const dir = fresh();
  writeFileSync(join(dir, "a\\b.txt"), "");
  assert.equal((await refusal(scanBundle(dir))).code, "invalid-bundle");
});

test("a non-UTF-8 file name is invalid-bundle", { skip: process.platform !== "linux" }, async () => {
  const dir = fresh();
  const name = Buffer.concat([Buffer.from(dir + "/"), Buffer.from([0x66, 0xff, 0x2e, 0x74])]);
  try {
    writeFileSync(name, "");
  } catch {
    return;
  }
  assert.equal((await refusal(scanBundle(dir))).code, "invalid-bundle");
});

test("manifest errors carry field pointers; icon must exist", async () => {
  const dir = fresh();
  writeFileSync(
    join(dir, "intent-app.json"),
    JSON.stringify({ manifestVersion: 1, id: "hello", name: "Hello", version: "1.0.0", icon: "missing.png", permissions: { level: 1 } }),
  );
  const d = await refusal(loadBundle(dir));
  assert.deepEqual([d.code, d.field], ["invalid-manifest", "/icon"]);
});

test("level 3 is level-unavailable at install", async () => {
  const dir = fresh();
  writeFileSync(
    join(dir, "intent-app.json"),
    JSON.stringify({ manifestVersion: 1, id: "hello", name: "Hello", version: "1.0.0", permissions: { level: 3 } }),
  );
  assert.equal((await refusal(loadBundle(dir))).code, "level-unavailable");
});

test("mime types follow the readBundle table", () => {
  assert.equal(mimeTypeFor("a/b/index.html"), "text/html");
  assert.equal(mimeTypeFor("x.mjs"), "text/javascript");
  assert.equal(mimeTypeFor("x.map"), "application/json");
  assert.equal(mimeTypeFor("x.woff2"), "font/woff2");
  assert.equal(mimeTypeFor("README"), "application/octet-stream");
  assert.equal(mimeTypeFor("x.tar.gz"), "application/octet-stream");
  assert.equal(contentTypeFor("x.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("x.png"), "image/png");
});
