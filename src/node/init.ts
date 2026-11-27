import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_ID_RE } from "../manifest.js";
import { MANIFEST_FILE } from "../types.js";

export interface InitOptions {
  id: string;
  name: string;
  /** Template directory name under `templates/`. Default `quick-call`. */
  template?: string;
}

/** The repository's `templates/` directory (next to `dist/`). */
export function templatesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");
}

/** Copy a template to `dest` (which must be missing or empty) and set its id and name. */
export async function initApp(dest: string, opts: InitOptions): Promise<void> {
  if (!APP_ID_RE.test(opts.id)) throw new Error(`bad app id "${opts.id}": use 3–64 of a-z, 0-9 and -`);
  const src = join(templatesDir(), opts.template ?? "quick-call");
  await mkdir(dest, { recursive: true });
  if ((await readdir(dest)).length > 0) throw new Error(`${dest} is not empty`);
  await cp(src, dest, { recursive: true });
  const mPath = join(dest, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(mPath, "utf8")) as Record<string, unknown>;
  manifest.id = opts.id;
  manifest.name = opts.name;
  manifest.version = "0.1.0";
  await writeFile(mPath, JSON.stringify(manifest, null, 2) + "\n");
}
