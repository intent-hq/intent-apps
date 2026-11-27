// Copies the browser SDK (dist/*.js, no Node or compliance code) into each
// template's intent-sdk/ folder, so a template is a complete static bundle.
// --check exits 1 when a template copy is out of date (CI).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const check = process.argv.includes("--check");
const HEADER = "// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.\n";

if (!existsSync(join(dist, "index.js"))) {
  console.error("dist/ is missing: run `npm run build` first");
  process.exit(1);
}
const sdkFiles = readdirSync(dist).filter((f) => f.endsWith(".js")).sort();
let stale = 0;
for (const t of readdirSync(join(root, "templates"))) {
  const out = join(root, "templates", t, "intent-sdk");
  const want = new Map(sdkFiles.map((f) => [f, HEADER + readFileSync(join(dist, f), "utf8")]));
  const have = existsSync(out) ? readdirSync(out) : [];
  for (const f of have) {
    if (!want.has(f)) {
      stale++;
      if (check) console.error(`stale: templates/${t}/intent-sdk/${f}`);
      else rmSync(join(out, f));
    }
  }
  for (const [f, content] of want) {
    const p = join(out, f);
    if (existsSync(p) && readFileSync(p, "utf8") === content) continue;
    stale++;
    if (check) console.error(`out of date: templates/${t}/intent-sdk/${f}`);
    else {
      mkdirSync(out, { recursive: true });
      writeFileSync(p, content);
    }
  }
}
if (check && stale > 0) {
  console.error("Template SDK copies are out of date: run `npm run build && npm run sync-template`.");
  process.exit(1);
}
console.log(check ? "Template SDK copies are up to date." : `Synced (${stale} file(s) changed).`);
