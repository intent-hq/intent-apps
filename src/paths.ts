import { LIMITS } from "./types.js";

const encoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** Bytewise comparison (ascending), as for sorting bundle paths. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Compare two strings by their UTF-8 bytes (not by UTF-16 code units). */
export function compareUtf8(a: string, b: string): number {
  return compareBytes(utf8(a), utf8(b));
}

/** Count Unicode code points (what the contract calls "chars"). */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Check the syntax of a bundle path: relative, `/` separators, no `..`
 * segment, no leading `/`, no `\`, no NUL, at most 512 UTF-8 bytes.
 * Returns a reason, or null when the syntax is good. It does not check that
 * the file exists.
 */
export function bundlePathProblem(p: string): string | null {
  if (p.length === 0) return "empty path";
  if (p.startsWith("/")) return "leading /";
  if (p.includes("\\")) return "contains \\";
  if (p.includes("\0")) return "contains NUL";
  if (isLoneSurrogate(p)) return "not valid UTF-8";
  if (utf8Length(p) > LIMITS.maxPathBytes) return `longer than ${LIMITS.maxPathBytes} UTF-8 bytes`;
  for (const seg of p.split("/")) {
    if (seg === "..") return "contains a .. segment";
    if (seg === "") return "empty segment";
    if (seg === ".") return "contains a . segment";
  }
  return null;
}

function isLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}
