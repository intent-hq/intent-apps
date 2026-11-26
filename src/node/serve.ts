import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";

import { APP_CSP } from "../types.js";
import { loadBundle } from "./bundle.js";
import { contentTypeFor } from "./mime.js";

export interface ServeOptions {
  port?: number;
  host?: string;
}

/**
 * Serve a bundle for a plain browser, like the `intent-app://` scheme does:
 * only the bundle's regular files, the app CSP on every response, the entry
 * at `/`. The bundle is read again on each request, so edits show on reload.
 * There is no `window.intent` here: the SDK falls back to its mock bridge.
 */
export async function serveBundle(root: string, opts: ServeOptions = {}): Promise<{ server: Server; url: string }> {
  await loadBundle(root, { install: false });
  const server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, type: string, body: string | Uint8Array) => {
        res.writeHead(status, {
          "Content-Type": type,
          "Content-Security-Policy": APP_CSP,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(body);
      };
      try {
        if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain; charset=utf-8", "method not allowed");
        const bundle = await loadBundle(root, { install: false });
        const url = new URL(req.url ?? "/", "http://localhost");
        let path: string;
        try {
          path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        } catch {
          return send(400, "text/plain; charset=utf-8", "bad path");
        }
        if (path === "") path = bundle.manifest.entry;
        const file = bundle.files.find((f) => f.path === path);
        if (file === undefined) return send(404, "text/plain; charset=utf-8", "file-not-found");
        return send(200, contentTypeFor(file.path), new Uint8Array(await readFile(file.absPath)));
      } catch (e) {
        return send(500, "text/plain; charset=utf-8", String((e as Error).message));
      }
    })();
  });
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 5179, host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : opts.port ?? 5179;
  return { server, url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/` };
}
