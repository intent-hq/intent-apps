import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { Sha256, sha256Hex } from "../dist/index.js";

const ref = (b) => createHash("sha256").update(b).digest("hex");

test("matches node:crypto for every length 0–300", () => {
  for (let n = 0; n <= 300; n++) {
    const b = new Uint8Array(randomBytes(n));
    assert.equal(sha256Hex(b), ref(b), `length ${n}`);
  }
});

test("matches node:crypto with random chunking on 1 MiB", () => {
  const b = new Uint8Array(randomBytes(1024 * 1024 + 17));
  const h = new Sha256();
  let i = 0;
  while (i < b.length) {
    const n = Math.min(b.length - i, 1 + Math.floor(Math.random() * 5000));
    h.update(b.subarray(i, i + n));
    i += n;
  }
  assert.equal(h.hex(), ref(b));
});

test("known answer: abc", () => {
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
