// Vendored from @intent-hq/apps (intent-hq/intent-apps). Do not edit: run `npm run sync-template`.
import { IntentError } from "./errors.js";
import { charCount, compareUtf8, utf8Length } from "./paths.js";
import { BRIDGE_VERSION, LIMITS, } from "./types.js";
export const MOCK_PROVIDERS = {
    defaultProvider: "mock",
    providers: [
        {
            providerId: "mock",
            displayName: "Mock provider",
            available: true,
            reason: null,
            defaultModel: "mock-echo",
            models: [
                { id: "mock-echo", displayName: "Mock echo" },
                { id: "mock-upper", displayName: "Mock upper case" },
            ],
        },
        {
            providerId: "mock-offline",
            displayName: "Mock provider (signed out)",
            available: false,
            reason: "Not signed in (mock)",
            defaultModel: null,
            models: [],
        },
    ],
};
const EMPTY_BUNDLE_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CONTROL_KEY_RE = /[\u0000-\u001f\u007f]/;
const LEVEL2_FEATURES = ["notifications", "models", "globalShortcuts", "alwaysOnTop"];
function invalidParams(detail) {
    return new IntentError("invalid-params", detail, { detail });
}
function forbidden(detail) {
    return new IntentError("forbidden", detail ?? "Forbidden");
}
function encodeCursor(lastKey) {
    let bin = "";
    for (const b of new TextEncoder().encode(lastKey))
        bin += String.fromCharCode(b);
    return "c1." + btoa(bin);
}
function decodeCursor(cursor) {
    if (!cursor.startsWith("c1."))
        return null;
    try {
        const bin = atob(cursor.slice(3));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        return null;
    }
}
function isPlainOptions(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}
class MemoryBackend {
    m = new Map();
    getItem(k) {
        return this.m.get(k) ?? null;
    }
    setItem(k, v) {
        this.m.set(k, v);
    }
    removeItem(k) {
        this.m.delete(k);
    }
    key(i) {
        return Array.from(this.m.keys())[i] ?? null;
    }
    get length() {
        return this.m.size;
    }
}
/**
 * A `window.intent` for a plain browser or a test. It implements the same
 * call names, results and error codes as the desktop app host plus intentd
 * (protocol §5.60), with in-memory or `localStorage` storage and a fake model.
 */
export function createMockBridge(options = {}) {
    const level = options.level ?? 2;
    const features = [...(options.features ?? (level >= 2 ? LEVEL2_FEATURES : []))];
    const info = {
        appId: options.appId ?? "mock-app",
        name: options.name ?? "Mock App",
        version: options.version ?? "0.0.0",
        bundleHash: options.bundleHash ?? EMPTY_BUNDLE_HASH,
        level,
        features: [...features],
        platform: options.platform ?? "linux",
        bridgeVersion: BRIDGE_VERSION,
    };
    const backend = options.storage === undefined || options.storage === "memory" ? new MemoryBackend() : options.storage;
    const prefix = `intent-app-mock:${info.appId}:`;
    const models = options.models ?? MOCK_PROVIDERS;
    const now = options.now ?? (() => Date.now());
    const taken = new Set(options.takenShortcuts ?? []);
    const notifications = [];
    const notifyTimes = [];
    const shortcuts = new Set();
    const listeners = {
        shortcut: new Set(),
        "session-ended": new Set(),
    };
    const inFlight = new Set();
    let alwaysOnTop = false;
    let ended = null;
    let notifySeq = 0;
    const emit = (type, data) => {
        for (const l of [...listeners[type]]) {
            try {
                l(data);
            }
            catch (e) {
                console.error("intent mock: listener failed", e);
            }
        }
    };
    /** Daemon method: allowlisted from `minLevel`, plus a service-level feature check. */
    const daemon = (minLevel, feature) => {
        if (ended !== null)
            throw new IntentError("disconnected", "The app session ended");
        if (level < minLevel)
            throw forbidden();
        if (feature !== undefined && !features.includes(feature)) {
            throw forbidden(`feature ${feature} not approved`);
        }
    };
    /** Host-local call: level and feature checked by the host. */
    const host = (minLevel, feature) => {
        if (ended !== null)
            throw new IntentError("disconnected", "The app session ended");
        if (level < minLevel || (feature !== undefined && !features.includes(feature))) {
            throw forbidden(feature === undefined ? undefined : `feature ${feature} not approved`);
        }
    };
    const storageKeys = () => {
        const keys = [];
        for (let i = 0; i < backend.length; i++) {
            const k = backend.key(i);
            if (k !== null && k.startsWith(prefix))
                keys.push(k.slice(prefix.length));
        }
        return keys;
    };
    const usedBytes = () => {
        let n = 0;
        for (const k of storageKeys())
            n += utf8Length(k) + utf8Length(backend.getItem(prefix + k) ?? "");
        return n;
    };
    const checkKey = (key) => {
        if (typeof key !== "string")
            throw invalidParams("key must be a string");
        const n = utf8Length(key);
        if (n < 1 || n > LIMITS.storage.maxKeyBytes || CONTROL_KEY_RE.test(key)) {
            throw new IntentError("invalid-key", "Storage keys are 1–256 UTF-8 bytes without control characters");
        }
        return key;
    };
    const bridge = {
        bridgeVersion: BRIDGE_VERSION,
        app: {
            async info() {
                host(1);
                return { ...info, features: [...info.features] };
            },
        },
        storage: {
            async get(key) {
                daemon(1);
                const k = checkKey(key);
                const raw = backend.getItem(prefix + k);
                return raw === null ? undefined : JSON.parse(raw);
            },
            async set(key, value) {
                daemon(1);
                const k = checkKey(key);
                if (value === undefined)
                    throw invalidParams("value is required");
                let json;
                try {
                    json = JSON.stringify(value);
                }
                catch {
                    throw invalidParams("value must be JSON");
                }
                if (json === undefined)
                    throw invalidParams("value must be JSON");
                const vBytes = utf8Length(json);
                if (vBytes > LIMITS.storage.maxValueBytes) {
                    throw new IntentError("value-too-large", "Storage values are at most 256 KiB as compact JSON");
                }
                const old = backend.getItem(prefix + k);
                const oldBytes = old === null ? 0 : utf8Length(k) + utf8Length(old);
                const after = usedBytes() - oldBytes + utf8Length(k) + vBytes;
                if (after > LIMITS.storage.quotaBytes) {
                    throw new IntentError("quota-exceeded", "Storage quota exceeded", {
                        limitBytes: LIMITS.storage.quotaBytes,
                        usedBytes: usedBytes(),
                    });
                }
                backend.setItem(prefix + k, json);
            },
            async delete(key) {
                daemon(1);
                const k = checkKey(key);
                const had = backend.getItem(prefix + k) !== null;
                backend.removeItem(prefix + k);
                return had;
            },
            async list(opts) {
                daemon(1);
                if (opts !== undefined && !isPlainOptions(opts))
                    throw invalidParams("options must be an object");
                const p = opts?.prefix ?? "";
                if (typeof p !== "string")
                    throw invalidParams("prefix must be a string");
                const limit = opts?.limit ?? LIMITS.storage.listDefaultLimit;
                if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.storage.listMaxLimit) {
                    throw invalidParams("limit must be an integer 1–1000");
                }
                let after = null;
                if (opts?.cursor !== undefined && opts.cursor !== null) {
                    if (typeof opts.cursor !== "string")
                        throw invalidParams("cursor must be a string");
                    after = decodeCursor(opts.cursor);
                    if (after === null)
                        throw invalidParams("invalid cursor");
                }
                const keys = storageKeys()
                    .filter((k) => k.startsWith(p))
                    .sort(compareUtf8)
                    .filter((k) => after === null || compareUtf8(k, after) > 0);
                const page = keys.slice(0, limit);
                const nextCursor = keys.length > limit ? encodeCursor(page[page.length - 1]) : null;
                return { keys: page, nextCursor };
            },
        },
        notifications: {
            async show(n) {
                daemon(2, "notifications");
                if (!isPlainOptions(n))
                    throw invalidParams("notification must be an object");
                const { title, body, tag } = n;
                if (typeof title !== "string")
                    throw invalidParams("title must be a string");
                const tLen = charCount(title.trim());
                if (tLen < 1 || tLen > LIMITS.notify.maxTitleChars)
                    throw invalidParams("title must be 1–128 chars after trim");
                if (body !== undefined && (typeof body !== "string" || charCount(body) > LIMITS.notify.maxBodyChars)) {
                    throw invalidParams("body must be a string of at most 1024 chars");
                }
                if (tag !== undefined) {
                    if (typeof tag !== "string")
                        throw invalidParams("tag must be a string");
                    const len = charCount(tag);
                    if (len < 1 || len > LIMITS.notify.maxTagChars)
                        throw invalidParams("tag must be 1–64 chars");
                }
                const t = now();
                while (notifyTimes.length > 0 && notifyTimes[0] <= t - LIMITS.notify.windowMs)
                    notifyTimes.shift();
                if (notifyTimes.length >= LIMITS.notify.perWindow) {
                    const retryAfterMs = Math.max(1, notifyTimes[0] + LIMITS.notify.windowMs - t);
                    throw new IntentError("rate-limited", "Too many notifications", { retryAfterMs });
                }
                notifyTimes.push(t);
                const notificationId = `mock-n-${++notifySeq}`;
                const shown = { title, notificationId };
                if (body !== undefined)
                    shown.body = body;
                if (tag !== undefined) {
                    shown.tag = tag;
                    const i = notifications.findIndex((x) => x.tag === tag);
                    if (i >= 0)
                        notifications.splice(i, 1);
                }
                notifications.push(shown);
                (options.onNotify ?? ((x) => console.info("[intent mock] notification", x)))(shown);
                return { notificationId };
            },
        },
        models: {
            async list() {
                daemon(2, "models");
                return structuredClone(models);
            },
            async complete(req) {
                daemon(2, "models");
                if (!isPlainOptions(req))
                    throw invalidParams("request must be an object");
                const { prompt, system, reasoningEffort } = req;
                if (typeof prompt !== "string")
                    throw invalidParams("prompt must be a string");
                const pLen = charCount(prompt);
                if (pLen < 1 || pLen > LIMITS.complete.maxPromptChars)
                    throw invalidParams("prompt must be 1–200000 chars");
                if (system !== undefined && (typeof system !== "string" || charCount(system) > LIMITS.complete.maxSystemChars)) {
                    throw invalidParams("system must be a string of at most 50000 chars");
                }
                if (reasoningEffort !== undefined && typeof reasoningEffort !== "string") {
                    throw invalidParams("reasoningEffort must be a string");
                }
                const timeoutMs = req.timeoutMs ?? LIMITS.complete.defaultTimeoutMs;
                if (!Number.isInteger(timeoutMs) ||
                    timeoutMs < LIMITS.complete.minTimeoutMs ||
                    timeoutMs > LIMITS.complete.maxTimeoutMs) {
                    throw invalidParams("timeoutMs must be an integer 1000–300000");
                }
                if (req.provider !== undefined && typeof req.provider !== "string")
                    throw invalidParams("provider must be a string");
                if (req.model !== undefined && typeof req.model !== "string")
                    throw invalidParams("model must be a string");
                const providerId = req.provider ?? models.defaultProvider;
                if (providerId === null) {
                    throw new IntentError("unavailable", "No model provider is available");
                }
                const provider = models.providers.find((p) => p.providerId === providerId);
                if (provider === undefined)
                    throw new IntentError("provider-unknown", `Unknown provider ${providerId}`);
                if (!provider.available)
                    throw new IntentError("unavailable", provider.reason ?? "Provider unavailable");
                const modelId = req.model ?? provider.defaultModel;
                if (modelId === null)
                    throw new IntentError("unavailable", "The provider has no default model");
                if (req.model !== undefined && !provider.models.some((m) => m.id === modelId)) {
                    throw new IntentError("model-unknown", `Unknown model ${modelId}`);
                }
                if (inFlight.size >= LIMITS.complete.maxInFlight) {
                    throw new IntentError("rate-limited", "Too many model calls in flight", {
                        retryAfterMs: LIMITS.complete.inFlightRetryAfterMs,
                    });
                }
                const ac = new AbortController();
                inFlight.add(ac);
                let timer;
                try {
                    const call = Promise.resolve((options.complete ?? defaultComplete)({ ...req, prompt, provider: providerId, model: modelId }, ac.signal));
                    const timeout = new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            ac.abort();
                            reject(new IntentError("timeout", "The model call timed out"));
                        }, timeoutMs);
                    });
                    const out = await Promise.race([call, timeout]);
                    if (ended !== null)
                        throw new IntentError("disconnected", "The app session ended");
                    if (typeof out !== "string")
                        throw new IntentError("unavailable", out.reason);
                    return { text: out, provider: providerId, model: modelId };
                }
                finally {
                    clearTimeout(timer);
                    inFlight.delete(ac);
                }
            },
        },
        window: {
            async setAlwaysOnTop(on) {
                host(2, "alwaysOnTop");
                if (typeof on !== "boolean")
                    throw invalidParams("on must be a boolean");
                alwaysOnTop = on;
            },
            async close() {
                host(1);
                options.onClose?.();
                controls.endSession("closed");
            },
        },
        shortcuts: {
            async register(accelerator) {
                host(2, "globalShortcuts");
                if (typeof accelerator !== "string" || accelerator.trim() === "") {
                    throw invalidParams("accelerator must be a non-empty string");
                }
                if (shortcuts.has(accelerator))
                    return;
                if (shortcuts.size >= LIMITS.shortcuts.maxPerApp) {
                    throw new IntentError("shortcut-unavailable", "At most 10 shortcuts per app");
                }
                if (taken.has(accelerator))
                    throw new IntentError("shortcut-unavailable", `${accelerator} is taken`);
                shortcuts.add(accelerator);
            },
            async unregister(accelerator) {
                host(2, "globalShortcuts");
                if (typeof accelerator !== "string")
                    throw invalidParams("accelerator must be a string");
                return shortcuts.delete(accelerator);
            },
            async unregisterAll() {
                host(2, "globalShortcuts");
                shortcuts.clear();
            },
        },
        on(type, listener) {
            if (type !== "shortcut" && type !== "session-ended") {
                throw new IntentError("not-supported", `Unknown event ${String(type)}`);
            }
            if (typeof listener !== "function")
                throw invalidParams("listener must be a function");
            if (type === "shortcut" && (level < 2 || !features.includes("globalShortcuts"))) {
                throw forbidden("feature globalShortcuts not approved");
            }
            const set = listeners[type];
            set.add(listener);
            return () => {
                set.delete(listener);
            };
        },
    };
    const controls = {
        endSession(reason) {
            if (ended !== null)
                return;
            ended = reason;
            for (const ac of inFlight)
                ac.abort();
            shortcuts.clear();
            emit("session-ended", { reason });
        },
        pressShortcut(accelerator) {
            if (ended !== null || !shortcuts.has(accelerator))
                return false;
            emit("shortcut", { accelerator });
            return true;
        },
        get notifications() {
            return notifications;
        },
        get shortcuts() {
            return shortcuts;
        },
        get alwaysOnTop() {
            return alwaysOnTop;
        },
        get ended() {
            return ended;
        },
        usedBytes,
    };
    return Object.assign(bridge, { mock: controls });
}
async function defaultComplete(req, signal) {
    await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 150);
        signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new IntentError("timeout", "The model call timed out"));
        });
    });
    const text = req.model === "mock-upper" ? req.prompt.toUpperCase() : req.prompt;
    return `(mock ${req.model}) ${text}`;
}
