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
] as const;

export type KnownErrorCode = (typeof BRIDGE_ERROR_CODES)[number];
export type ErrorCode = KnownErrorCode | (string & {});

/** The error that every bridge call rejects with. */
export class IntentError extends Error {
  readonly code: ErrorCode;
  readonly data?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, data?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "IntentError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }

  toJSON(): { code: ErrorCode; message: string; data?: Record<string, unknown> } {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

export function isIntentError(e: unknown): e is IntentError {
  return e instanceof IntentError;
}

/**
 * Turn any rejection value into an `IntentError`.
 *
 * A host can reject with an `IntentError`, a plain `{ code, message, data? }`
 * object (what survives Electron's contextBridge) or an `Error` that carries a
 * `code`. Anything else becomes `internal`.
 */
export function toIntentError(e: unknown): IntentError {
  if (e instanceof IntentError) return e;
  if (e !== null && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown; data?: unknown };
    if (typeof o.code === "string" && o.code.length > 0) {
      const data =
        o.data !== null && typeof o.data === "object" && !Array.isArray(o.data)
          ? (o.data as Record<string, unknown>)
          : undefined;
      return new IntentError(o.code, typeof o.message === "string" ? o.message : o.code, data);
    }
    if (typeof o.message === "string") return new IntentError("internal", o.message);
  }
  return new IntentError("internal", typeof e === "string" ? e : "internal error");
}
