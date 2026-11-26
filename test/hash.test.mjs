import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bundleHash, BundleHasher, fileHeader, compareBytes } from "../dist/index.js";
import { hashBundleDir, loadBundle } from "../dist/node/index.js";
import { ROOT, readJson, vectorFiles } from "./helpers.mjs";

const doc = readJson("test-vectors/bundle-hash.json");

for (const v of doc.vectors) {
  test(`vector ${v.name}`, () => {
    const files = vectorFiles(v);
    assert.equal(bundleHash(files), v.hash);
    assert.equal(bundleHash([...files].reverse()), v.hash, "input order must not matter");
    if (v.preimageHex !== undefined) {
      const enc = new TextEncoder();
      const sorted = files.map((f) => ({ p: enc.encode(f.path), c: f.content })).sort((a, b) => compareBytes(a.p, b.p));
      const parts = sorted.flatMap((f) => [fileHeader(f.p, f.c.length), f.c]);
      assert.equal(Buffer.concat(parts).toString("hex"), v.preimageHex);
    }
  });
}

test("vectors cover distinct hashes", () => {
  const hashes = doc.vectors.map((v) => v.hash);
  assert.equal(new Set(hashes).size, hashes.length);
});

for (const d of doc.directories) {
  test(`directory vector ${d.path} (node streaming hasher)`, async () => {
    assert.equal(await hashBundleDir(join(ROOT, "test-vectors", d.path)), d.hash);
  });
}

test("node directory hash equals the in-memory hash for every vector", async () => {
  for (const v of doc.vectors) {
    if (v.files.length === 0 || v.diskRepresentable === false) continue;
    const dir = mkdtempSync(join(tmpdir(), "intent-apps-vec-"));
    for (const f of vectorFiles(v)) {
      const p = join(dir, ...f.path.split("/"));
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, f.content);
    }
    assert.equal(await hashBundleDir(dir), v.hash, v.name);
  }
});

test("empty directories do not change the hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-apps-empty-"));
  cpSync(join(ROOT, "test-vectors/bundles/hello"), dir, { recursive: true });
  mkdirSync(join(dir, "empty/nested"), { recursive: true });
  const hello = doc.directories.find((d) => d.path === "bundles/hello");
  assert.equal(await hashBundleDir(dir), hello.hash);
  assert.equal((await loadBundle(dir)).bundleHash, hello.hash);
});

test("BundleHasher refuses unsorted or duplicate paths and wrong lengths", () => {
  const enc = new TextEncoder();
  assert.throws(() => new BundleHasher().file(enc.encode("b"), 0).file(enc.encode("a"), 0));
  assert.throws(() => new BundleHasher().file(enc.encode("a"), 0).file(enc.encode("a"), 0));
  assert.throws(() => new BundleHasher().file(enc.encode("a"), 2).content(new Uint8Array(1)).finish());
  assert.throws(() => new BundleHasher().file(enc.encode("a"), 1).content(new Uint8Array(2)));
});

test("fileHeader layout", () => {
  assert.deepEqual([...fileHeader(new TextEncoder().encode("a"), 12)], [0x61, 0, 0x31, 0x32, 0]);
});
