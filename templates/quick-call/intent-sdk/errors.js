// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
/** Error codes that a bridge call can reject with (contract: "Errors seen by the app"). */
export const BRIDGE_ERROR_CODES = [
    "forbidden",
    "unavailable",
    "shortcut-unavailable",
    "not-supported",
    "disconnected",
    "internal",
    "invalid-key",
    "value-too-large",
    "quota-exceeded",
    "rate-limited",
    "provider-unknown",
    "model-unknown",
    "timeout",
    "invalid-params",
];
/** The error that every bridge call rejects with. */
export class IntentError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message ?? code);
        this.name = "IntentError";
        this.code = code;
        if (data !== undefined)
            this.data = data;
    }
    toJSON() {
        return this.data === undefined
            ? { code: this.code, message: this.message }
            : { code: this.code, message: this.message, data: this.data };
    }
}
export function isIntentError(e) {
    return e instanceof IntentError;
}
/**
 * Turn any rejection value into an `IntentError`.
 *
 * A host can reject with an `IntentError`, a plain `{ code, message, data? }`
 * object (what survives Electron's contextBridge) or an `Error` that carries a
 * `code`. Anything else becomes `internal`.
 */
export function toIntentError(e) {
    if (e instanceof IntentError)
        return e;
    if (e !== null && typeof e === "object") {
        const o = e;
        if (typeof o.code === "string" && o.code.length > 0) {
            const data = o.data !== null && typeof o.data === "object" && !Array.isArray(o.data)
                ? o.data
                : undefined;
            return new IntentError(o.code, typeof o.message === "string" ? o.message : o.code, data);
        }
        if (typeof o.message === "string")
            return new IntentError("internal", o.message);
    }
    return new IntentError("internal", typeof e === "string" ? e : "internal error");
}
