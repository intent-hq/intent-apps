import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { parseSignatureFile, signatureMessage, unverifiedAppSignature, bundleHash } from "../dist/index.js";
import { BundleError, loadBundle, scanBundle, serveBundle } from "../dist/node/index.js";
import { ROOT, readJson } from "./helpers.mjs";

const doc = readJson("test-vectors/signatures.json");
const ajv = new Ajv2020({ strict: true, unicodeRegExp: true });
const schema = ajv.compile(readJson("schema/intent-app-sig.schema.json"));
const SIG = JSON.stringify(doc.cases[0].sig);

for (const c of doc.cases) {
  test(`signature ${c.name}`, () => {
    const r = parseSignatureFile(c.sigText !== undefined ? new TextEncoder().encode(c.sigText) : c.sig);
    assert.equal(r.ok, c.valid, JSON.stringify(r.error));
    if (!c.valid) assert.deepEqual([r.error.code, r.error.path], ["invalid-bundle", "intent-app.sig"]);
    if (c.sig !== undefined) assert.equal(schema(c.sig), c.valid, JSON.stringify(schema.errors));
  });
}

test("reserved signed message", () => {
  const m = signatureMessage(doc.signedMessage.bundleHash);
  assert.equal(Buffer.from(m).toString("hex"), doc.signedMessage.messageHex);
  assert.equal(new TextDecoder().decode(m), doc.signedMessage.messageUtf8);
});

test("App.signature in M1 is never verified", () => {
  const s = unverifiedAppSignature(parseSignatureFile(SIG).signature);
  assert.equal(s.status, "unverified");
  assert.equal(s.verified, false);
});

test("in-memory hash skips only the root intent-app.sig", () => {
  const f = { path: "a.txt", content: new Uint8Array([1]) };
  const sig = (path) => ({ path, content: new TextEncoder().encode(SIG) });
  assert.equal(bundleHash([f, sig("intent-app.sig")]), bundleHash([f]));
  assert.notEqual(bundleHash([f, sig("sub/intent-app.sig")]), bundleHash([f]));
  assert.notEqual(bundleHash([f, sig("Intent-app.sig")]), bundleHash([f]));
});

const signed = () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-apps-sig-"));
  cpSync(join(ROOT, "test-vectors/bundles/hello-signed"), dir, { recursive: true });
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

test("a signed bundle: same hash, counts and sizes exclude the sig, signature returned", async () => {
  const plain = await loadBundle(join(ROOT, "test-vectors/bundles/hello"));
  const b = await loadBundle(signed());
  assert.equal(b.bundleHash, plain.bundleHash);
  assert.equal(b.fileCount, plain.fileCount);
  assert.equal(b.sizeBytes, plain.sizeBytes);
  assert.equal(b.files.some((f) => f.path === "intent-app.sig"), false);
  assert.equal(b.signature.algorithm, "ed25519");
  assert.equal(b.signature.bundleHash === b.bundleHash, false, "a mismatched bundleHash is stored, not refused");
  assert.equal(plain.signature, null);
});

test("a malformed or oversized sig is invalid-bundle with path intent-app.sig", async () => {
  const dir = signed();
  writeFileSync(join(dir, "intent-app.sig"), "{}");
  assert.deepEqual(await refusal(loadBundle(dir)), {
    code: "invalid-bundle",
    detail: 'missing key "sigVersion"',
    path: "intent-app.sig",
  });
  writeFileSync(join(dir, "intent-app.sig"), " ".repeat(16 * 1024 + 1));
  const d = await refusal(scanBundle(dir));
  assert.deepEqual([d.code, d.path], ["invalid-bundle", "intent-app.sig"]);
});

test("a nested intent-app.sig is an ordinary bundle file", async () => {
  const dir = signed();
  writeFileSync(join(dir, "sub", "intent-app.sig"), "not json at all");
  const b = await loadBundle(dir);
  assert.ok(b.files.some((f) => f.path === "sub/intent-app.sig"));
  assert.equal(b.fileCount, 5);
});

test("the sig counts toward the 2000-file limit", async () => {
  const dir = signed();
  mkdirSync(join(dir, "many"));
  for (let i = 0; i < 1995; i++) writeFileSync(join(dir, "many", `f${i}`), "");
  assert.equal((await scanBundle(dir)).fileCount, 1999);
  writeFileSync(join(dir, "many", "one-more"), "");
  assert.equal((await refusal(scanBundle(dir))).code, "invalid-bundle");
});

test("the dev server does not serve intent-app.sig", async () => {
  const { server, url } = await serveBundle(signed(), { port: 0 });
  try {
    assert.equal((await fetch(url + "intent-app.sig")).status, 404);
    assert.equal((await fetch(url + "app.js")).status, 200);
  } finally {
    server.close();
  }
});
