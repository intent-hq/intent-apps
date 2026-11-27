// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
import { LIMITS } from "./types.js";
const encoder = new TextEncoder();
export function utf8(s) {
    return encoder.encode(s);
}
export function utf8Length(s) {
    return encoder.encode(s).length;
}
/** Bytewise comparison (ascending), as for sorting bundle paths. */
export function compareBytes(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const d = a[i] - b[i];
        if (d !== 0)
            return d;
    }
    return a.length - b.length;
}
/** Compare two strings by their UTF-8 bytes (not by UTF-16 code units). */
export function compareUtf8(a, b) {
    return compareBytes(utf8(a), utf8(b));
}
/** Control characters (contract "Validation rules"): C0, DEL and C1. */
export const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
/** Printable ASCII (contract "Validation rules"): U+0021–U+007E, no space. */
export const PRINTABLE_ASCII_RE = /^[\x21-\x7e]*$/;
/** "After trim": remove leading and trailing Unicode White_Space (not String.prototype.trim). */
export function trimWhiteSpace(s) {
    return s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
/** Count Unicode code points (what the contract calls "chars"). */
export function charCount(s) {
    let n = 0;
    for (const _ of s)
        n++;
    return n;
}
/**
 * Check the syntax of a bundle path: relative, `/` separators, no `..`
 * segment, no leading `/`, no `\`, no NUL, at most 512 UTF-8 bytes.
 * Returns a reason, or null when the syntax is good. It does not check that
 * the file exists.
 */
export function bundlePathProblem(p) {
    if (p.length === 0)
        return "empty path";
    if (p.startsWith("/"))
        return "leading /";
    if (p.includes("\\"))
        return "contains \\";
    if (p.includes("\0"))
        return "contains NUL";
    if (isLoneSurrogate(p))
        return "not valid UTF-8";
    if (utf8Length(p) > LIMITS.maxPathBytes)
        return `longer than ${LIMITS.maxPathBytes} UTF-8 bytes`;
    for (const seg of p.split("/")) {
        if (seg === "..")
            return "contains a .. segment";
        if (seg === "")
            return "empty segment";
        if (seg === ".")
            return "contains a . segment";
    }
    return null;
}
function isLoneSurrogate(s) {
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}
