// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
import { BUNDLE_HASH_RE } from "./hash.js";
import { KEY_ID_RE } from "./manifest.js";
import { utf8 } from "./paths.js";
import { LIMITS, SIGNATURE_FILE, SIGNATURE_VERSION } from "./types.js";
/**
 * Publisher and signature data are **reserved** in M1: they are stored and
 * returned, their shape is checked, and they are never verified. Do not
 * show a publisher as confirmed or treat a signature as trust.
 */
const SIG_KEYS = ["sigVersion", "algorithm", "keyId", "bundleHash", "signature"];
export const SIGNATURE_ALGORITHM_RE = /^[a-z0-9-]{1,32}$/;
/** base64url without padding, 1–1024 chars. */
export const SIGNATURE_VALUE_RE = /^[A-Za-z0-9_-]{1,1024}$/;
/** Prefix of the reserved signed message. */
export const SIGNATURE_MESSAGE_PREFIX = "intent-app-sig-v1\n";
function fail(detail) {
    return { ok: false, error: { code: "invalid-bundle", detail, path: SIGNATURE_FILE } };
}
/**
 * Check the shape of an `intent-app.sig` file (raw bytes, a JSON string or a
 * parsed value). A malformed file is `invalid-bundle` with
 * `path: "intent-app.sig"`. A well-formed file whose `bundleHash` or `keyId`
 * does not match the bundle is **not** an error.
 */
export function parseSignatureFile(input) {
    let doc = input;
    if (input instanceof Uint8Array) {
        if (input.length > LIMITS.maxSignatureBytes)
            return fail("larger than 16 KiB");
        try {
            doc = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
        }
        catch {
            return fail("not valid UTF-8");
        }
    }
    if (typeof doc === "string") {
        if (utf8(doc).length > LIMITS.maxSignatureBytes)
            return fail("larger than 16 KiB");
        try {
            doc = JSON.parse(doc);
        }
        catch {
            return fail("not JSON");
        }
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc))
        return fail("must be a JSON object");
    const o = doc;
    for (const k of Object.keys(o)) {
        if (!SIG_KEYS.includes(k))
            return fail(`unknown key "${k}"`);
    }
    for (const k of SIG_KEYS)
        if (!(k in o))
            return fail(`missing key "${k}"`);
    if (o.sigVersion !== SIGNATURE_VERSION)
        return fail("sigVersion must be exactly 1");
    if (typeof o.algorithm !== "string" || !SIGNATURE_ALGORITHM_RE.test(o.algorithm)) {
        return fail("algorithm must be 1–32 chars of [a-z0-9-]");
    }
    if (typeof o.keyId !== "string" || !KEY_ID_RE.test(o.keyId))
        return fail("keyId must be 1–256 printable ASCII chars");
    if (typeof o.bundleHash !== "string" || !BUNDLE_HASH_RE.test(o.bundleHash)) {
        return fail('bundleHash must be "sha256:" and 64 lowercase hex chars');
    }
    if (typeof o.signature !== "string" || !SIGNATURE_VALUE_RE.test(o.signature)) {
        return fail("signature must be base64url without padding, 1–1024 chars");
    }
    return {
        ok: true,
        signature: {
            sigVersion: SIGNATURE_VERSION,
            algorithm: o.algorithm,
            keyId: o.keyId,
            bundleHash: o.bundleHash,
            signature: o.signature,
        },
    };
}
/** The reserved signed message: UTF-8 of "intent-app-sig-v1\n" + bundleHash. Not used in M1. */
export function signatureMessage(bundleHash) {
    return utf8(SIGNATURE_MESSAGE_PREFIX + bundleHash);
}
/** `App.signature` as M1 returns it: always `unverified`, never `verified`. */
export function unverifiedAppSignature(sig) {
    return { ...sig, status: "unverified", verified: false };
}
