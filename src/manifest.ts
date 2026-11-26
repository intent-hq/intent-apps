import { bundlePathProblem, charCount, CONTROL_RE, PRINTABLE_ASCII_RE, trimWhiteSpace, utf8Length } from "./paths.js";
import {
  FEATURES,
  LIMITS,
  MANIFEST_VERSION,
  type Feature,
  type Level,
  type NormalizedManifest,
  type WindowSpec,
} from "./types.js";

export const APP_ID_RE = /^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$/;

/** SemVer 2.0.0, the regex from semver.org. */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const WINDOW_DEFAULTS: WindowSpec = {
  width: 960,
  height: 640,
  minWidth: null,
  minHeight: null,
  resizable: true,
  alwaysOnTop: false,
};

const TOP_KEYS = new Set([
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "icon",
  "entry",
  "permissions",
  "window",
  "publisher",
  "updateUrl",
]);
const PERMISSION_KEYS = new Set(["level", "features"]);
const WINDOW_KEYS = new Set(["width", "height", "minWidth", "minHeight", "resizable", "alwaysOnTop"]);
const PUBLISHER_KEYS = new Set(["name", "url", "keyId"]);

/** 1–256 printable ASCII chars (U+0021–U+007E): `publisher.keyId` and the signature `keyId`. */
export const KEY_ID_RE = /^[\x21-\x7e]{1,256}$/;

/**
 * An https URL (`publisher.url`, `updateUrl`): printable ASCII only, at most
 * 2048 chars, the lowercase prefix `https://`, no backslash, no `/` right
 * after `https://`, and an absolute WHATWG URL with a non-empty host. The
 * last two rules refuse forms that the URL parser would repair. The string
 * is stored as written.
 */
export function httpsUrlProblem(v: string): string | null {
  if (v.length < 1 || v.length > LIMITS.maxUrlChars) return `must be 1–${LIMITS.maxUrlChars} chars`;
  if (!PRINTABLE_ASCII_RE.test(v)) return "must be printable ASCII (no spaces)";
  if (!v.startsWith("https://")) return 'must start with "https://"';
  if (v.includes("\\")) return "must not contain a backslash";
  if (v.charAt(8) === "/") return 'must not have "/" right after "https://"';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "must be an absolute URL";
  }
  if (u.protocol !== "https:") return "must be an https URL";
  if (u.hostname === "") return "must have a host";
  return null;
}

/** Error data of a refused manifest, as in the daemon's `error.data`. */
export interface ManifestError {
  code: "invalid-manifest" | "level-unavailable";
  detail: string;
  /** JSON pointer of the offending value ("" for the whole document). Only for `invalid-manifest`. */
  field?: string;
}

export type ManifestResult =
  | { ok: true; manifest: NormalizedManifest }
  | { ok: false; error: ManifestError };

export interface ValidateManifestOptions {
  /**
   * Bundle paths of the bundle's regular files. When given, `icon` and
   * `entry` must name one of them.
   */
  files?: Iterable<string>;
  /**
   * Also apply the install rule of Milestone 1: a level 3 manifest is
   * `level-unavailable`. Default true.
   */
  install?: boolean;
}

class Invalid extends Error {
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}


function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function pointer(...parts: (string | number)[]): string {
  return parts.map((p) => "/" + String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}

function checkKeys(obj: Record<string, unknown>, allowed: Set<string>, base: string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new Invalid(pointer(...base, k), `unknown key "${k}"`);
  }
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Invalid(field, "must be an integer");
  if (v < min || v > max) throw new Invalid(field, `must be ${min}–${max}`);
  return v;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(field, "must be a boolean");
  return v;
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Invalid(field, "must be a string");
  return v;
}

function bundlePath(v: unknown, field: string, ext: RegExp, extName: string, files: Set<string> | null): string {
  const p = str(v, field);
  const problem = bundlePathProblem(p);
  if (problem !== null) throw new Invalid(field, `bad bundle path: ${problem}`);
  if (!ext.test(p)) throw new Invalid(field, `must name a ${extName} file`);
  if (files !== null && !files.has(p)) throw new Invalid(field, `no file "${p}" in the bundle`);
  return p;
}

function normalize(doc: unknown, files: Set<string> | null): NormalizedManifest {
  if (!isObject(doc)) throw new Invalid("", "manifest must be a JSON object");
  checkKeys(doc, TOP_KEYS, []);

  for (const k of ["manifestVersion", "id", "name", "version", "permissions"]) {
    if (!(k in doc)) throw new Invalid(pointer(k), `missing required key "${k}"`);
  }

  if (doc.manifestVersion !== MANIFEST_VERSION) throw new Invalid("/manifestVersion", "must be exactly 1");

  const id = str(doc.id, "/id");
  if (!APP_ID_RE.test(id)) throw new Invalid("/id", "must match ^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$");

  const name = str(doc.name, "/name");
  const nameLen = charCount(trimWhiteSpace(name));
  if (nameLen < 1 || nameLen > 64) throw new Invalid("/name", "must be 1–64 chars after trim");
  if (CONTROL_RE.test(name)) throw new Invalid("/name", "must not contain control characters");

  const version = str(doc.version, "/version");
  if (version.length > 64) throw new Invalid("/version", "must be at most 64 chars");
  if (!SEMVER_RE.test(version)) throw new Invalid("/version", "must be a SemVer 2.0.0 version");

  let description: string | null = null;
  if ("description" in doc) {
    description = str(doc.description, "/description");
    if (charCount(description) > 280) throw new Invalid("/description", "must be at most 280 chars");
  }

  const icon = "icon" in doc ? bundlePath(doc.icon, "/icon", /\.png$/i, "PNG (.png)", files) : null;
  const entry = "entry" in doc ? bundlePath(doc.entry, "/entry", /\.html$/i, ".html", files) : "index.html";
  if (!("entry" in doc) && files !== null && !files.has(entry)) {
    throw new Invalid("/entry", 'no "entry" key and no index.html in the bundle');
  }

  const perms = doc.permissions;
  if (!isObject(perms)) throw new Invalid("/permissions", "must be an object");
  checkKeys(perms, PERMISSION_KEYS, ["permissions"]);
  if (!("level" in perms)) throw new Invalid("/permissions/level", 'missing required key "level"');
  if (perms.level !== 1 && perms.level !== 2 && perms.level !== 3) {
    throw new Invalid("/permissions/level", "must be 1, 2 or 3");
  }
  const level = perms.level as Level;
  const features: Feature[] = [];
  if ("features" in perms) {
    if (!Array.isArray(perms.features)) throw new Invalid("/permissions/features", "must be an array");
    perms.features.forEach((f: unknown, i: number) => {
      const field = pointer("permissions", "features", i);
      if (typeof f !== "string" || !(FEATURES as readonly string[]).includes(f)) {
        throw new Invalid(field, `must be one of ${FEATURES.join(", ")}`);
      }
      if (features.includes(f as Feature)) throw new Invalid(field, `duplicate feature "${f}"`);
      features.push(f as Feature);
    });
  }
  if (level === 1 && features.length > 0) {
    throw new Invalid("/permissions/features", "a level 1 manifest must have no features");
  }

  const window: WindowSpec = { ...WINDOW_DEFAULTS };
  if ("window" in doc) {
    const w = doc.window;
    if (!isObject(w)) throw new Invalid("/window", "must be an object");
    checkKeys(w, WINDOW_KEYS, ["window"]);
    if ("width" in w) window.width = int(w.width, "/window/width", 320, 4096);
    if ("height" in w) window.height = int(w.height, "/window/height", 240, 4096);
    if ("minWidth" in w) window.minWidth = int(w.minWidth, "/window/minWidth", 320, window.width);
    if ("minHeight" in w) window.minHeight = int(w.minHeight, "/window/minHeight", 240, window.height);
    if ("resizable" in w) window.resizable = bool(w.resizable, "/window/resizable");
    if ("alwaysOnTop" in w) window.alwaysOnTop = bool(w.alwaysOnTop, "/window/alwaysOnTop");
    if (window.alwaysOnTop && !features.includes("alwaysOnTop")) {
      throw new Invalid("/window/alwaysOnTop", 'true needs the "alwaysOnTop" feature');
    }
  }

  let publisher: NormalizedManifest["publisher"] = null;
  if ("publisher" in doc) {
    const p = doc.publisher;
    if (!isObject(p)) throw new Invalid("/publisher", "must be an object");
    checkKeys(p, PUBLISHER_KEYS, ["publisher"]);
    if (!("name" in p)) throw new Invalid("/publisher/name", 'missing required key "name"');
    const pName = str(p.name, "/publisher/name");
    const pLen = charCount(trimWhiteSpace(pName));
    if (pLen < 1 || pLen > 128) throw new Invalid("/publisher/name", "must be 1–128 chars after trim");
    if (CONTROL_RE.test(pName)) throw new Invalid("/publisher/name", "must not contain control characters");
    let url: string | null = null;
    if ("url" in p) {
      url = str(p.url, "/publisher/url");
      const problem = httpsUrlProblem(url);
      if (problem !== null) throw new Invalid("/publisher/url", problem);
    }
    let keyId: string | null = null;
    if ("keyId" in p) {
      keyId = str(p.keyId, "/publisher/keyId");
      if (!KEY_ID_RE.test(keyId)) throw new Invalid("/publisher/keyId", "must be 1–256 printable ASCII chars");
    }
    publisher = { name: pName, url, keyId };
  }

  let updateUrl: string | null = null;
  if ("updateUrl" in doc) {
    updateUrl = str(doc.updateUrl, "/updateUrl");
    const problem = httpsUrlProblem(updateUrl);
    if (problem !== null) throw new Invalid("/updateUrl", problem);
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    id,
    name,
    version,
    description,
    icon,
    entry,
    permissions: { level, features },
    window,
    publisher,
    updateUrl,
  };
}

/**
 * Validate an `intent-app.json` document (a parsed value, a JSON string or
 * the raw file bytes) the way `app.install` does, and apply the defaults.
 */
export function validateManifest(input: unknown, opts: ValidateManifestOptions = {}): ManifestResult {
  let doc: unknown = input;
  if (input instanceof Uint8Array) {
    if (input.length > LIMITS.maxManifestBytes) {
      return { ok: false, error: { code: "invalid-manifest", detail: "larger than 64 KiB", field: "" } };
    }
    try {
      doc = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return { ok: false, error: { code: "invalid-manifest", detail: "not valid UTF-8", field: "" } };
    }
  }
  if (typeof doc === "string") {
    if (utf8Length(doc) > LIMITS.maxManifestBytes) {
      return { ok: false, error: { code: "invalid-manifest", detail: "larger than 64 KiB", field: "" } };
    }
    try {
      doc = JSON.parse(doc);
    } catch (e) {
      return { ok: false, error: { code: "invalid-manifest", detail: `not JSON: ${(e as Error).message}`, field: "" } };
    }
  }
  const files = opts.files === undefined ? null : new Set(opts.files);
  let manifest: NormalizedManifest;
  try {
    manifest = normalize(doc, files);
  } catch (e) {
    if (e instanceof Invalid) {
      return { ok: false, error: { code: "invalid-manifest", detail: e.detail, field: e.field } };
    }
    throw e;
  }
  if ((opts.install ?? true) && manifest.permissions.level === 3) {
    return { ok: false, error: { code: "level-unavailable", detail: "level 3 is not available in this version" } };
  }
  return { ok: true, manifest };
}
