#!/usr/bin/env node
import { resolve } from "node:path";

import { BundleError, loadBundle } from "./bundle.js";
import { initApp } from "./init.js";
import { serveBundle } from "./serve.js";

const USAGE = `intent-apps — tools for Intent app bundles

Usage:
  intent-apps validate <dir>              Check a bundle like app.install does (JSON result)
  intent-apps hash <dir>                  Print the bundle hash
  intent-apps serve <dir> [--port N]      Serve the bundle with the app CSP (mock bridge)
  intent-apps init <dir> --id <id> --name <name>   Start an app from the template
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, dirArg, ...rest] = argv;
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (cmd === undefined || dirArg === undefined) {
    process.stdout.write(USAGE);
    return 2;
  }
  const dir = resolve(dirArg);
  try {
    switch (cmd) {
      case "validate": {
        const b = await loadBundle(dir);
        console.log(
          JSON.stringify(
            {
              ok: true,
              manifest: b.manifest,
              bundleHash: b.bundleHash,
              fileCount: b.fileCount,
              sizeBytes: b.sizeBytes,
              signature: b.signature === null ? null : { ...b.signature, status: "unverified", verified: false },
            },
            null,
            2,
          ),
        );
        return 0;
      }
      case "hash": {
        console.log((await loadBundle(dir, { install: false })).bundleHash);
        return 0;
      }
      case "serve": {
        const port = flag(rest, "--port");
        const { url } = await serveBundle(dir, port === undefined ? {} : { port: Number(port) });
        console.log(`Serving ${dir} at ${url} (mock bridge, app CSP). Ctrl+C to stop.`);
        return new Promise<number>(() => {});
      }
      case "init": {
        const id = flag(rest, "--id");
        const name = flag(rest, "--name");
        if (id === undefined || name === undefined) {
          process.stderr.write("init needs --id and --name\n");
          return 2;
        }
        await initApp(dir, { id, name });
        console.log(`Created ${dir}. Next: intent-apps serve ${dirArg}`);
        return 0;
      }
      default:
        process.stdout.write(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof BundleError) {
      console.log(JSON.stringify({ ok: false, error: e.data }, null, 2));
      return 1;
    }
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exitCode = code;
});
