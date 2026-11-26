import { Sha256 } from "./sha256.js";
import { compareBytes, utf8 } from "./paths.js";

/** One file of a bundle, in memory. `path` is a string (UTF-8 encoded) or raw bytes. */
export interface BundleFile {
  path: string | Uint8Array;
  content: Uint8Array;
}

export const HASH_PREFIX = "sha256:";
export const BUNDLE_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * The bytes fed to SHA-256 before a file's content:
 * path bytes, 0x00, the length as ASCII decimal digits, 0x00.
 */
export function fileHeader(pathBytes: Uint8Array, length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("bad file length");
  const len = utf8(String(length));
  const out = new Uint8Array(pathBytes.length + 1 + len.length + 1);
  out.set(pathBytes, 0);
  out[pathBytes.length] = 0;
  out.set(len, pathBytes.length + 1);
  out[out.length - 1] = 0;
  return out;
}

/**
 * Incremental bundle hasher. Call `file()` once per file **in sorted order**
 * (bytewise by path), then `content()` with that file's bytes (in any number
 * of chunks), then `finish()`. `bundleHash()` does the sorting for you.
 */
export class BundleHasher {
  private readonly sha = new Sha256();
  private last: Uint8Array | null = null;
  private expected = 0;
  private seen = 0;

  file(pathBytes: Uint8Array, length: number): this {
    this.endFile();
    if (this.last !== null && compareBytes(this.last, pathBytes) >= 0) {
      throw new Error("BundleHasher: paths must be unique and in ascending byte order");
    }
    this.last = pathBytes;
    this.sha.update(fileHeader(pathBytes, length));
    this.expected = length;
    this.seen = 0;
    return this;
  }

  content(chunk: Uint8Array): this {
    if (this.last === null) throw new Error("BundleHasher: content before file");
    this.seen += chunk.length;
    if (this.seen > this.expected) throw new Error("BundleHasher: more content than the declared length");
    this.sha.update(chunk);
    return this;
  }

  finish(): string {
    this.endFile();
    return HASH_PREFIX + this.sha.hex();
  }

  private endFile(): void {
    if (this.last !== null && this.seen !== this.expected) {
      throw new Error("BundleHasher: less content than the declared length");
    }
  }
}

/** Compute the bundle hash (contract "Bundle hash") of in-memory files. */
export function bundleHash(files: Iterable<BundleFile>): string {
  const entries = Array.from(files, (f) => ({
    path: typeof f.path === "string" ? utf8(f.path) : f.path,
    content: f.content,
  }));
  entries.sort((a, b) => compareBytes(a.path, b.path));
  const h = new BundleHasher();
  for (const e of entries) h.file(e.path, e.content.length).content(e.content);
  return h.finish();
}
