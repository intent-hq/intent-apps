# intent-apps

SDK, manifest schema, mock bridge, template, agent skill and compliance tests for
**Intent apps**: small static web apps that an agent builds in a workspace and the user
installs into Intent's app library and opens in its own window. Intent apps are a Labs
feature.

The wire contract is §5.60 of the Intent protocol docs
(`docs/protocol/methods/apps.md` in [intent-hq/intent](https://github.com/intent-hq/intent)).
This package implements its app-side parts. It has no Electron or daemon dependency.

## Contents

| Path | What |
| --- | --- |
| `src/` → `@intent-hq/apps` | Typed `window.intent` client (`connect`), `IntentError`, bridge types, manifest validator (`validateManifest`), bundle hash (`bundleHash`, pure TypeScript SHA-256), mock bridge (`createMockBridge`) |
| `src/node/` → `@intent-hq/apps/node` | Bundle directory reader with the contract limits (`loadBundle`, `hashBundleDir`), `app.readBundle` mime table, dev server, `intent-apps` CLI |
| `src/compliance/` → `@intent-hq/apps/compliance` | `runCompliance(bridge, { expect })`: checks any `window.intent` (the desktop app host or the mock) against the contract |
| `schema/intent-app.schema.json` | JSON Schema (2020-12) of `intent-app.json` |
| `test-vectors/` | Bundle hash vectors and manifest validation vectors for other implementations (intentd) |
| `templates/quick-call/` | Template app: a quick model call with provider and model choice |
| `skill/SKILL.md` | Agent skill: how to build, test and install an app |

## Use

```bash
npm ci
npm run build
node dist/node/cli.js validate templates/quick-call   # like app.install, JSON result
node dist/node/cli.js hash templates/quick-call       # the bundle hash
node dist/node/cli.js serve templates/quick-call      # http://127.0.0.1:5179/ with the app CSP and the mock bridge
node dist/node/cli.js init my-app --id my-app --name "My App"
```

In an app (the template vendors the SDK in `intent-sdk/`):

```js
import { connect } from "./intent-sdk/index.js";
const intent = connect(); // window.intent in Intent; the mock bridge in a plain browser
const { text } = await intent.models.complete({ prompt: "Hello" });
```

## Bundle hash

`sha256:` + hex SHA-256 over every regular file of the bundle, sorted by the UTF-8
bytes of its path; for each file: path bytes, `0x00`, the length in ASCII decimal,
`0x00`, the content. `test-vectors/bundle-hash.json` has vectors with the exact
preimage for the small ones; `scripts/verify_vectors.py` checks them with Python's
`hashlib`, independently of the TypeScript code. Implementations should run every
vector and the `directories` entries.

## Manifest vectors

`test-vectors/manifests.json` lists valid and invalid manifests with the expected
`app.install` result (`invalid-manifest` + JSON pointer `field`, or
`level-unavailable`) and the JSON Schema result.

## Compliance suite

```js
import { runCompliance, formatResults } from "@intent-hq/apps/compliance";
const results = await runCompliance(window.intent, { expect: { level: 2, features: ["models"] } });
console.log(formatResults(results));
```

Options `liveModelCall`, `showNotification` and `destructive` (rate limits, 10 MiB
quota) are off by default, because on a real host they cost model calls, show
notifications and fill storage. CI runs every check against the mock bridge.

## Develop

```bash
npm run ci   # build, template SDK copy check, tests (incl. headless Chrome), Python vector check
```

After a change in `src/`, run `npm run build && npm run sync-template` and commit the
updated `templates/*/intent-sdk/`. The browser test uses `CHROME_BIN`, a Playwright
headless shell or a system Chrome, and skips without one (CI requires it).

## License

MIT
