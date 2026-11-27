import { IntentError, toIntentError } from "./errors.js";
import { createMockBridge, type MockBridge, type MockBridgeOptions } from "./mock.js";
import { BRIDGE_VERSION, type IntentBridge } from "./types.js";

export interface ConnectOptions {
  /**
   * What to do when the page has no `window.intent` (a plain browser):
   * - `"auto"` (default): use the mock bridge and log a warning.
   * - `"never"`: throw `not-supported`.
   * - `"always"`: use the mock bridge even inside the app host (tests).
   */
  mock?: "auto" | "never" | "always";
  /** Options for the mock bridge, when it is used. */
  mockOptions?: MockBridgeOptions;
}

/** The typed client: the bridge with every rejection turned into an `IntentError`. */
export type IntentClient = IntentBridge & {
  /** True when the client talks to the mock bridge, not the app host. */
  readonly isMock: boolean;
  /** The mock controls, when `isMock`. */
  readonly mock: MockBridge["mock"] | null;
};

function globalBridge(): unknown {
  return (globalThis as { intent?: unknown }).intent;
}

/** True when the app host injected `window.intent`. */
export function hasBridge(): boolean {
  const b = globalBridge();
  return b !== null && typeof b === "object";
}

function wrapAsync<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      throw toIntentError(e);
    }
  };
}

/** Wrap a bridge object (host or mock) as an `IntentClient`. */
export function wrapBridge(bridge: IntentBridge, isMock = false): IntentClient {
  if (bridge.bridgeVersion !== BRIDGE_VERSION) {
    throw new IntentError("not-supported", `Unsupported bridge version ${String(bridge.bridgeVersion)}`);
  }
  const b = bridge;
  return {
    bridgeVersion: BRIDGE_VERSION,
    isMock,
    mock: isMock ? ((bridge as MockBridge).mock ?? null) : null,
    app: { info: wrapAsync(() => b.app.info()) },
    storage: {
      get: wrapAsync((key: string) => b.storage.get(key)),
      set: wrapAsync((key: string, value: unknown) => b.storage.set(key, value)),
      delete: wrapAsync((key: string) => b.storage.delete(key)),
      list: wrapAsync((opts?: Parameters<IntentBridge["storage"]["list"]>[0]) =>
        opts === undefined ? b.storage.list() : b.storage.list(opts),
      ),
    },
    notifications: { show: wrapAsync((n: Parameters<IntentBridge["notifications"]["show"]>[0]) => b.notifications.show(n)) },
    models: {
      list: wrapAsync(() => b.models.list()),
      complete: wrapAsync((req: Parameters<IntentBridge["models"]["complete"]>[0]) => b.models.complete(req)),
    },
    window: {
      setAlwaysOnTop: wrapAsync((on: boolean) => b.window.setAlwaysOnTop(on)),
      close: wrapAsync(() => b.window.close()),
    },
    shortcuts: {
      register: wrapAsync((acc: string) => b.shortcuts.register(acc)),
      unregister: wrapAsync((acc: string) => b.shortcuts.unregister(acc)),
      unregisterAll: wrapAsync(() => b.shortcuts.unregisterAll()),
    },
    on(type, listener) {
      try {
        return b.on(type, listener);
      } catch (e) {
        throw toIntentError(e);
      }
    },
  };
}

let cached: IntentClient | null = null;

/**
 * Get the `window.intent` client. Inside the Intent app host this wraps the
 * injected bridge; in a plain browser it falls back to the mock bridge
 * (unless `mock: "never"`). The first call decides; later calls return the
 * same client.
 */
export function connect(opts: ConnectOptions = {}): IntentClient {
  if (cached !== null) return cached;
  const mode = opts.mock ?? "auto";
  if (mode !== "always" && hasBridge()) {
    cached = wrapBridge(globalBridge() as IntentBridge, false);
  } else if (mode === "never") {
    throw new IntentError("not-supported", "window.intent is missing: open this app in Intent");
  } else {
    if (mode === "auto") {
      console.warn("[intent] window.intent is missing; using the mock bridge (plain browser).");
    }
    cached = wrapBridge(createMockBridge(opts.mockOptions), true);
  }
  return cached;
}

/** Forget the cached client (tests). */
export function resetConnection(): void {
  cached = null;
}
