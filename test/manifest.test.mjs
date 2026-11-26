import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { validateManifest } from "../dist/index.js";
import { readJson } from "./helpers.mjs";

const { cases } = readJson("test-vectors/manifests.json");
const schema = readJson("schema/intent-app.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, unicodeRegExp: true });
const validateSchema = ajv.compile(schema);

for (const c of cases) {
  test(`manifest ${c.name}`, () => {
    const input = c.manifestText ?? c.manifest;
    const opts = {};
    if (c.files) opts.files = c.files;
    if (c.install !== undefined) opts.install = c.install;
    const r = validateManifest(input, opts);
    if (c.valid) {
      assert.equal(r.ok, true, JSON.stringify(r.error));
      if (c.normalized) assert.deepEqual(r.manifest, c.normalized);
    } else {
      assert.equal(r.ok, false, "expected a refusal");
      assert.equal(r.error.code, c.code);
      assert.equal(r.error.field, c.field ?? undefined);
      assert.equal(typeof r.error.detail, "string");
    }
    if (c.manifestText === undefined) {
      assert.equal(validateSchema(c.manifest), c.schemaValid, `schema: ${JSON.stringify(validateSchema.errors)}`);
    }
  });
}

test("raw bytes: UTF-8 and size rules", () => {
  const ok = new TextEncoder().encode(JSON.stringify(cases[0].manifest));
  assert.equal(validateManifest(ok).ok, true);
  const bad = validateManifest(new Uint8Array([0x7b, 0xff, 0x7d]));
  assert.equal(bad.ok, false);
  assert.equal(bad.error.field, "");
  const big = new TextEncoder().encode(JSON.stringify({ ...cases[0].manifest, description: "x".repeat(70000) }));
  const r = validateManifest(big);
  assert.equal(r.ok, false);
  assert.match(r.error.detail, /64 KiB/);
});

test("the JSON schema itself is valid draft 2020-12", () => {
  assert.equal(ajv.validateSchema(schema), true);
});
