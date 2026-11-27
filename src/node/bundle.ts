import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { fileHeader, HASH_PREFIX } from "../hash.js";
import { validateManifest, type ManifestError } from "../manifest.js";
import { bundlePathProblem, compareBytes } from "../paths.js";
import { parseSignatureFile } from "../signature.js";
import { LIMITS, MANIFEST_FILE, SIGNATURE_FILE, type NormalizedManifest, type SignatureFile } from "../types.js";

/** A refusal with the daemon's `error.data` shape (`invalid-bundle`, `invalid-manifest`, …). */
export class BundleError extends Error {
  constructor(
    readonly data:
      | { code: "invalid-bundle"; detail: string; path: string | null }
      | { code: "path-not-found"; detail: string }
      | ManifestError,
  ) {
    super(`${data.code}: ${data.detail}`);
    this.name = "BundleError";
  }
}

export interface BundleEntry {
  /** Bundle path (relative, `/` separators). */
  path: string;
  /** Raw UTF-8 bytes of `path`, as on disk. */
  pathBytes: Uint8Array;
  /** Absolute file path. */
  absPath: string;
  size: number;
}

export interface ScannedBundle {
  root: string;
  /** Bundle files (hashed and served), sorted bytewise by path. Excludes the root `intent-app.sig`. */
  files: BundleEntry[];
  /** The root `intent-app.sig`, when present. Not a bundle file. */
  signatureFile: BundleEntry | null;
  /** Count and size of `files` (the signature file is excluded, as in `App`). */
  fileCount: number;
  sizeBytes: number;
}

export interface LoadedBundle extends ScannedBundle {
  manifest: NormalizedManifest;
  bundleHash: string;
  /** The parsed `intent-app.sig`, or null. Shape-checked only; never verified in M1. */
  signature: SignatureFile | null;
}

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Walk a bundle directory and check the limits of protocol §5.60: regular
 * files only (a symlink, device or socket anywhere is `invalid-bundle`),
 * at most 2000 files, 16 MiB each, 64 MiB in total. The root
 * `intent-app.sig` (at most 16 KiB) counts toward the limits but is kept
 * apart from `files`. Empty directories are ignored. The bundle root itself
 * may be reached through a symlink.
 */
export async function scanBundle(root: string): Promise<ScannedBundle> {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    throw new BundleError({ code: "path-not-found", detail: `no directory ${root}` });
  }
  if (!rootStat.isDirectory()) throw new BundleError({ code: "path-not-found", detail: `${root} is not a directory` });

  const files: BundleEntry[] = [];
  let signatureFile: BundleEntry | null = null;
  let count = 0;
  let total = 0;
  const enc = new TextEncoder();

  async function walk(absDir: string, relBytes: Uint8Array | null): Promise<void> {
    const names = await readdir(absDir, { encoding: "buffer" });
    for (const nameBuf of names) {
      const nameBytes = new Uint8Array(nameBuf.buffer, nameBuf.byteOffset, nameBuf.byteLength);
      let name: string;
      try {
        name = fatalUtf8.decode(nameBytes);
      } catch {
        throw new BundleError({ code: "invalid-bundle", detail: "a file name is not valid UTF-8", path: null });
      }
      const relPathBytes =
        relBytes === null ? nameBytes : concat(relBytes, enc.encode("/"), nameBytes);
      const relPath = relBytes === null ? name : fatalUtf8.decode(relPathBytes);
      const abs = join(absDir, name);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        throw new BundleError({ code: "invalid-bundle", detail: "symlinks are not allowed", path: relPath });
      }
      if (st.isDirectory()) {
        await walk(abs, relPathBytes);
        continue;
      }
      if (!st.isFile()) {
        throw new BundleError({ code: "invalid-bundle", detail: "only regular files are allowed", path: relPath });
      }
      const problem = bundlePathProblem(relPath);
      if (problem !== null) throw new BundleError({ code: "invalid-bundle", detail: `bad path: ${problem}`, path: relPath });
      if (st.size > LIMITS.maxFileBytes) {
        throw new BundleError({ code: "invalid-bundle", detail: "a file is larger than 16 MiB", path: relPath });
      }
      const entry = { path: relPath, pathBytes: relPathBytes, absPath: abs, size: st.size };
      if (relBytes === null && name === SIGNATURE_FILE) {
        if (st.size > LIMITS.maxSignatureBytes) {
          throw new BundleError({ code: "invalid-bundle", detail: "larger than 16 KiB", path: SIGNATURE_FILE });
        }
        signatureFile = entry;
      } else {
        files.push(entry);
      }
      if (++count > LIMITS.maxFiles) {
        throw new BundleError({ code: "invalid-bundle", detail: "more than 2000 files", path: null });
      }
      total += st.size;
      if (total > LIMITS.maxTotalBytes) {
        throw new BundleError({ code: "invalid-bundle", detail: "the bundle is larger than 64 MiB", path: null });
      }
    }
  }

  await walk(root, null);
  files.sort((a, b) => compareBytes(a.pathBytes, b.pathBytes));
  const sigSize = (signatureFile as BundleEntry | null)?.size ?? 0;
  return { root, files, signatureFile, fileCount: files.length, sizeBytes: total - sigSize };
}

/** Hash scanned files by streaming their content (node:crypto). */
export async function hashScannedBundle(bundle: ScannedBundle): Promise<string> {
  const h = createHash("sha256");
  for (const f of bundle.files) {
    h.update(fileHeader(f.pathBytes, f.size));
    let seen = 0;
    for await (const chunk of createReadStream(f.absPath)) {
      seen += (chunk as Buffer).length;
      h.update(chunk as Buffer);
    }
    if (seen !== f.size) {
      throw new BundleError({ code: "invalid-bundle", detail: "a file changed while hashing", path: f.path });
    }
  }
  return HASH_PREFIX + h.digest("hex");
}

/** The bundle hash of a directory (contract "Bundle hash"). Checks the limits too. */
export async function hashBundleDir(root: string): Promise<string> {
  return hashScannedBundle(await scanBundle(root));
}

/**
 * Load a bundle like `app.install` (without copying): scan, check the
 * limits, validate the manifest against the bundle's files and hash it.
 * Throws `BundleError` with the daemon's error data.
 */
export async function loadBundle(root: string, opts: { install?: boolean } = {}): Promise<LoadedBundle> {
  const scanned = await scanBundle(root);
  const manifestEntry = scanned.files.find((f) => f.path === MANIFEST_FILE);
  if (manifestEntry === undefined) {
    throw new BundleError({ code: "path-not-found", detail: `no ${MANIFEST_FILE} in ${root}` });
  }
  if (manifestEntry.size > LIMITS.maxManifestBytes) {
    throw new BundleError({ code: "invalid-manifest", detail: "larger than 64 KiB", field: "" });
  }
  const raw = new Uint8Array(await readFile(manifestEntry.absPath));
  const res = validateManifest(raw, { files: scanned.files.map((f) => f.path), install: opts.install ?? true });
  if (!res.ok) throw new BundleError(res.error);
  let signature: SignatureFile | null = null;
  if (scanned.signatureFile !== null) {
    const sig = parseSignatureFile(new Uint8Array(await readFile(scanned.signatureFile.absPath)));
    if (!sig.ok) throw new BundleError({ code: "invalid-bundle", detail: sig.error.detail, path: SIGNATURE_FILE });
    signature = sig.signature;
  }
  return { ...scanned, manifest: res.manifest, bundleHash: await hashScannedBundle(scanned), signature };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
