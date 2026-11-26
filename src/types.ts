/**
 * Types and constants of the Intent apps contract (protocol §5.60,
 * docs/protocol/methods/apps.md in intent-hq/intent). Keep in step with it.
 */

export const BRIDGE_VERSION = 1 as const;
export const MANIFEST_VERSION = 1 as const;
export const MANIFEST_FILE = "intent-app.json";

/** Content-Security-Policy on every `intent-app://` response. */
export const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'self'; base-uri 'none'; form-action 'none'";

export const FEATURES = ["notifications", "models", "globalShortcuts", "alwaysOnTop"] as const;
export type Feature = (typeof FEATURES)[number];
export type Level = 1 | 2 | 3;
export type Platform = "mac" | "windows" | "linux" | "intent-os";

export const LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxManifestBytes: 64 * 1024,
  maxPathBytes: 512,
  storage: {
    maxKeyBytes: 256,
    maxValueBytes: 256 * 1024,
    quotaBytes: 10 * 1024 * 1024,
    listDefaultLimit: 100,
    listMaxLimit: 1000,
  },
  notify: {
    maxTitleChars: 128,
    maxBodyChars: 1024,
    maxTagChars: 64,
    perWindow: 10,
    windowMs: 60_000,
  },
  complete: {
    maxPromptChars: 200_000,
    maxSystemChars: 50_000,
    minTimeoutMs: 1000,
    maxTimeoutMs: 300_000,
    defaultTimeoutMs: 120_000,
    maxInFlight: 2,
    inFlightRetryAfterMs: 1000,
  },
  shortcuts: {
    maxPerApp: 10,
  },
} as const;

/** `intent-app.json` as written by the author. */
export interface Manifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  entry?: string;
  permissions: { level: Level; features?: Feature[] };
  window?: Partial<WindowSpec> & { minWidth?: number; minHeight?: number };
}

/** The `window` object of `App` and `AppSession`, with defaults applied. */
export interface WindowSpec {
  width: number;
  height: number;
  minWidth: number | null;
  minHeight: number | null;
  resizable: boolean;
  alwaysOnTop: boolean;
}

/** A manifest with every default applied (the manifest part of `App`). */
export interface NormalizedManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string | null;
  icon: string | null;
  entry: string;
  permissions: { level: Level; features: Feature[] };
  window: WindowSpec;
}

export interface AppInfo {
  appId: string;
  name: string;
  version: string;
  bundleHash: string;
  level: Level;
  features: string[];
  platform: Platform;
  bridgeVersion: 1;
}

export interface AppModel {
  id: string;
  displayName: string;
}

export interface AppModelProvider {
  providerId: string;
  displayName: string;
  available: boolean;
  reason: string | null;
  defaultModel: string | null;
  models: AppModel[];
}

export interface ModelsListResult {
  defaultProvider: string | null;
  providers: AppModelProvider[];
}

export interface CompleteRequest {
  prompt: string;
  system?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  provider: string;
  model: string;
}

export interface StorageListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface StorageListResult {
  keys: string[];
  nextCursor: string | null;
}

export interface NotificationRequest {
  title: string;
  body?: string;
  tag?: string;
}

export type SessionEndReason = "closed" | "revoked" | "uninstalled" | "updated" | "disconnected";

export interface BridgeEventMap {
  shortcut: { accelerator: string };
  "session-ended": { reason: SessionEndReason };
}

export type BridgeEventType = keyof BridgeEventMap;

/** `window.intent`, injected by the app host (or the mock bridge). */
export interface IntentBridge {
  readonly bridgeVersion: 1;
  app: { info(): Promise<AppInfo> };
  storage: {
    get(key: string): Promise<unknown | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list(opts?: StorageListOptions): Promise<StorageListResult>;
  };
  notifications: { show(n: NotificationRequest): Promise<{ notificationId: string }> };
  models: {
    list(): Promise<ModelsListResult>;
    complete(req: CompleteRequest): Promise<CompleteResult>;
  };
  window: { setAlwaysOnTop(on: boolean): Promise<void>; close(): Promise<void> };
  shortcuts: {
    register(accelerator: string): Promise<void>;
    unregister(accelerator: string): Promise<boolean>;
    unregisterAll(): Promise<void>;
  };
  on<T extends BridgeEventType>(type: T, listener: (data: BridgeEventMap[T]) => void): () => void;
}

/** Bridge call names (the `call` of the `intent-app:invoke` IPC message). */
export const BRIDGE_CALLS = [
  "app.info",
  "storage.get",
  "storage.set",
  "storage.delete",
  "storage.list",
  "notifications.show",
  "models.list",
  "models.complete",
  "window.setAlwaysOnTop",
  "window.close",
  "shortcuts.register",
  "shortcuts.unregister",
  "shortcuts.unregisterAll",
] as const;
export type BridgeCall = (typeof BRIDGE_CALLS)[number];

/** The IPC channels between the app preload and the host main process. */
export const IPC_CHANNELS = {
  invoke: "intent-app:invoke",
  event: "intent-app:event",
} as const;
