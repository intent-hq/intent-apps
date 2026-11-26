/** `app.readBundle` mimeType by extension (protocol §5.60), no charset parameter. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function mimeTypeFor(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_TYPES[base.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/** The Content-Type header the host sends: `; charset=utf-8` for `text/*`. */
export function contentTypeFor(path: string): string {
  const m = mimeTypeFor(path);
  return m.startsWith("text/") ? `${m}; charset=utf-8` : m;
}
