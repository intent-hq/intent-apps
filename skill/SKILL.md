---
name: intent-app
description: Build a small static web app that the user can install into Intent's app library and open in its own window (Intent apps, Labs). Use when the user asks for an "app", "tool", "widget" or "utility" to run in Intent, or for an intent-app.json bundle.
---

# Build an Intent app

An Intent app is a folder of static files (HTML, CSS, JavaScript, images) with an
`intent-app.json` manifest at its root. The user installs it into the app library,
approves its permissions and opens it in its own window. The app talks to Intent only
through `window.intent`. Intent apps are a Labs feature: tell the user so.

## 1. Start from the template

Copy `templates/quick-call/` from `intent-hq/intent-apps` (or run
`intent-apps init <dir> --id <id> --name "<Name>"`). It contains:

| File | Purpose |
| --- | --- |
| `intent-app.json` | Manifest (edit `id`, `name`, `version`, `permissions`) |
| `index.html`, `app.js`, `style.css` | The app |
| `icon.png` | 256 px square PNG icon |
| `intent-sdk/` | The SDK, vendored. Do not edit. Import `./intent-sdk/index.js` |

Put the bundle in its own folder in the workspace, for example `apps/<id>/`.

## 2. Write the manifest

```json
{
  "manifestVersion": 1,
  "id": "pomodoro-timer",
  "name": "Pomodoro Timer",
  "version": "1.0.0",
  "description": "A focus timer.",
  "icon": "icon.png",
  "entry": "index.html",
  "permissions": { "level": 2, "features": ["notifications"] },
  "window": { "width": 480, "height": 360, "resizable": true }
}
```

Rules (an install fails with `invalid-manifest` and a JSON pointer otherwise):

- `id`: 3–64 chars of `a-z`, `0-9`, `-`, not starting or ending with `-`. It is the
  app's identity: keep it when you change the app.
- `name`: 1–64 chars, no control characters. `version`: SemVer such as `1.2.0`.
- `description` at most 280 chars. `icon` a `.png` file and `entry` an `.html` file in
  the bundle (default `index.html`).
- No other keys. `window`: `width` 320–4096 (default 960), `height` 240–4096
  (default 640), optional `minWidth`/`minHeight` up to the size, `resizable`,
  `alwaysOnTop` (needs the `alwaysOnTop` feature).
- Validate with the schema `schema/intent-app.schema.json` or
  `intent-apps validate <dir>`.

## 3. Ask for the least access

| Level | Grants | Use for |
| --- | --- | --- |
| 1 | Browser APIs and per-app storage. `features` must be `[]` | Timers, calculators, notes |
| 2 | Level 1 plus the features you list | Apps that call models or notify |
| 3 | Full access | Not available yet: install refuses it |

Level 2 features: `models` (model calls), `notifications`, `globalShortcuts`,
`alwaysOnTop`. Request only what the app uses. The user can decline features, so the
app must work, or explain itself, when a call rejects with `forbidden`.

## 4. Use window.intent

```js
import { connect, IntentError } from "./intent-sdk/index.js";

const intent = connect(); // the host bridge in Intent, the mock bridge in a plain browser

const info = await intent.app.info();                  // appId, name, level, features, platform
await intent.storage.set("settings", { minutes: 25 }); // any JSON, ≤ 256 KiB per value, 10 MiB per app
const settings = await intent.storage.get("settings"); // undefined when missing
const { keys, nextCursor } = await intent.storage.list({ prefix: "notes/" });

await intent.notifications.show({ title: "Break time", body: "5 minutes", tag: "timer" });

const { providers, defaultProvider } = await intent.models.list();
const { text, provider, model } = await intent.models.complete({
  prompt: "Summarize: ...",
  system: "Answer in one paragraph.", // optional; also provider, model, reasoningEffort, timeoutMs
});

intent.on("session-ended", ({ reason }) => { /* save state; the window closes */ });
```

Every call rejects with `IntentError { code, message, data? }`. Handle at least
`forbidden` (feature not approved), `unavailable` (no model provider signed in),
`rate-limited` (`data.retryAfterMs`), `timeout` and `disconnected`. Model calls are
one-shot (no streaming) and at most 2 run at a time.

## 5. Stay inside the sandbox

The app runs under this Content-Security-Policy, with no network access:

- All code and assets are files in the bundle. No CDN, no remote scripts, fonts or
  images, no `fetch`/XHR/WebSocket (`connect-src 'none'`).
- No inline `<script>` and no `eval`: use `<script type="module" src="app.js">`.
  Inline styles are allowed.
- No forms that submit (`form-action 'none'`), no iframes, no plugins.
- Use `intent.storage` (or `localStorage`/IndexedDB, which are per app) for state.

Bundle limits: at most 2000 files, 16 MiB per file, 64 MiB in total, no symlinks.
Do not add build tools unless the user asks; plain ES modules work. If you do bundle,
commit the built output in the bundle folder.

## 6. Test in a plain browser

Run `intent-apps serve <dir>` (serves the bundle with the app CSP at
`http://127.0.0.1:5179/`). Without `window.intent` the SDK uses its mock bridge: storage
in `localStorage`, a mock model that echoes the prompt, notifications in the console.
Check the console for CSP errors.

## 7. Install

Validate first. Then install with the `app.install` method through the Intent workspace
API, `dryRun: true` first:

```js
await ws.rpc("app.install", { workspaceId, path: "apps/pomodoro-timer", dryRun: true });
await ws.rpc("app.install", { workspaceId, path: "apps/pomodoro-timer" });
// after a change: { ..., replace: true } (the user must approve the new version)
```

Agents cannot approve an app or open it. Tell the user to open the app library in
Intent, review the permissions and approve. Every change to any file gives a new
bundle hash, and the user must approve again.
