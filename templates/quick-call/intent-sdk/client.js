// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
import { IntentError, toIntentError } from "./errors.js";
import { createMockBridge } from "./mock.js";
import { BRIDGE_VERSION } from "./types.js";
function globalBridge() {
    return globalThis.intent;
}
/** True when the app host injected `window.intent`. */
export function hasBridge() {
    const b = globalBridge();
    return b !== null && typeof b === "object";
}
function wrapAsync(fn) {
    return async (...a) => {
        try {
            return await fn(...a);
        }
        catch (e) {
            throw toIntentError(e);
        }
    };
}
/** Wrap a bridge object (host or mock) as an `IntentClient`. */
export function wrapBridge(bridge, isMock = false) {
    if (bridge.bridgeVersion !== BRIDGE_VERSION) {
        throw new IntentError("not-supported", `Unsupported bridge version ${String(bridge.bridgeVersion)}`);
    }
    const b = bridge;
    return {
        bridgeVersion: BRIDGE_VERSION,
        isMock,
        mock: isMock ? (bridge.mock ?? null) : null,
        app: { info: wrapAsync(() => b.app.info()) },
        storage: {
            get: wrapAsync((key) => b.storage.get(key)),
            set: wrapAsync((key, value) => b.storage.set(key, value)),
            delete: wrapAsync((key) => b.storage.delete(key)),
            list: wrapAsync((opts) => opts === undefined ? b.storage.list() : b.storage.list(opts)),
        },
        notifications: { show: wrapAsync((n) => b.notifications.show(n)) },
        models: {
            list: wrapAsync(() => b.models.list()),
            complete: wrapAsync((req) => b.models.complete(req)),
        },
        window: {
            setAlwaysOnTop: wrapAsync((on) => b.window.setAlwaysOnTop(on)),
            close: wrapAsync(() => b.window.close()),
        },
        shortcuts: {
            register: wrapAsync((acc) => b.shortcuts.register(acc)),
            unregister: wrapAsync((acc) => b.shortcuts.unregister(acc)),
            unregisterAll: wrapAsync(() => b.shortcuts.unregisterAll()),
        },
        on(type, listener) {
            try {
                return b.on(type, listener);
            }
            catch (e) {
                throw toIntentError(e);
            }
        },
    };
}
let cached = null;
/**
 * Get the `window.intent` client. Inside the Intent app host this wraps the
 * injected bridge; in a plain browser it falls back to the mock bridge
 * (unless `mock: "never"`). The first call decides; later calls return the
 * same client.
 */
export function connect(opts = {}) {
    if (cached !== null)
        return cached;
    const mode = opts.mock ?? "auto";
    if (mode !== "always" && hasBridge()) {
        cached = wrapBridge(globalBridge(), false);
    }
    else if (mode === "never") {
        throw new IntentError("not-supported", "window.intent is missing: open this app in Intent");
    }
    else {
        if (mode === "auto") {
            console.warn("[intent] window.intent is missing; using the mock bridge (plain browser).");
        }
        cached = wrapBridge(createMockBridge(opts.mockOptions), true);
    }
    return cached;
}
/** Forget the cached client (tests). */
export function resetConnection() {
    cached = null;
}
