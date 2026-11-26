// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
/**
 * Types and constants of the Intent apps contract (protocol §5.60,
 * docs/protocol/methods/apps.md in intent-hq/intent). Keep in step with it.
 */
export const BRIDGE_VERSION = 1;
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "intent-app.json";
/** Content-Security-Policy on every `intent-app://` response. */
export const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'self'; base-uri 'none'; form-action 'none'";
export const FEATURES = ["notifications", "models", "globalShortcuts", "alwaysOnTop"];
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
};
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
];
/** The IPC channels between the app preload and the host main process. */
export const IPC_CHANNELS = {
    invoke: "intent-app:invoke",
    event: "intent-app:event",
};
