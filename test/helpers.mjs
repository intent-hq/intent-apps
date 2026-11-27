import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

export function vectorFiles(v) {
  return v.files.map((f) => ({
    path: f.path,
    content:
      "contentBase64" in f
        ? new Uint8Array(Buffer.from(f.contentBase64, "base64"))
        : new Uint8Array(Buffer.from(f.contentRepeat.text.repeat(f.contentRepeat.count), "utf8")),
  }));
}
