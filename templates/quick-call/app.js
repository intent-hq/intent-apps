// Quick Call: a small Intent app that sends one prompt to a model.
// All daemon access goes through window.intent (the SDK wraps it). In a plain
// browser the SDK falls back to its mock bridge, so this page also runs with
// `intent-apps serve` or any static file server.
import { connect, IntentError } from "./intent-sdk/index.js";

// The mock options apply only in a plain browser (no window.intent).
const intent = connect({
  mockOptions: { name: "Quick Call", level: 2, features: ["models", "notifications"], storage: globalThis.localStorage },
});
const HISTORY_KEY = "history";
const LAST_CHOICE_KEY = "lastChoice";

const $ = (id) => document.getElementById(id);
const providerSel = $("provider");
const modelSel = $("model");
const statusEl = $("status");
let providers = [];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function describeError(e) {
  if (!(e instanceof IntentError)) return String(e);
  switch (e.code) {
    case "forbidden":
      return "This app is not allowed to call models. Approve the models feature in Intent.";
    case "unavailable":
      return `No model is available: ${e.message}`;
    case "rate-limited":
      return `Too many calls. Try again in ${Math.ceil((e.data?.retryAfterMs ?? 1000) / 1000)} s.`;
    case "timeout":
      return "The model did not answer in time.";
    case "disconnected":
      return "The connection to Intent closed.";
    default:
      return `${e.code}: ${e.message}`;
  }
}

function fillModels() {
  const p = providers.find((x) => x.providerId === providerSel.value);
  modelSel.replaceChildren();
  for (const m of p?.models ?? []) {
    const opt = new Option(m.displayName, m.id);
    if (m.id === p.defaultModel) opt.selected = true;
    modelSel.add(opt);
  }
  modelSel.disabled = !p || p.models.length === 0;
}

async function loadProviders() {
  const res = await intent.models.list();
  providers = res.providers;
  const last = await intent.storage.get(LAST_CHOICE_KEY);
  providerSel.replaceChildren();
  for (const p of providers) {
    const opt = new Option(p.available ? p.displayName : `${p.displayName} (unavailable)`, p.providerId);
    opt.disabled = !p.available;
    providerSel.add(opt);
  }
  const preferred = providers.find((p) => p.available && p.providerId === last?.provider)
    ?? providers.find((p) => p.available && p.providerId === res.defaultProvider)
    ?? providers.find((p) => p.available);
  if (preferred) providerSel.value = preferred.providerId;
  fillModels();
  if (last?.model && [...modelSel.options].some((o) => o.value === last.model)) modelSel.value = last.model;
  if (!preferred) setStatus("No model provider is available. Sign in to a provider in Intent.", true);
}

async function renderHistory() {
  const items = (await intent.storage.get(HISTORY_KEY)) ?? [];
  const list = $("history");
  list.replaceChildren();
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    li.title = text;
    li.addEventListener("click", () => {
      $("prompt").value = text;
      $("prompt").focus();
    });
    list.append(li);
  }
}

async function remember(prompt) {
  const items = (await intent.storage.get(HISTORY_KEY)) ?? [];
  const next = [prompt, ...items.filter((x) => x !== prompt)].slice(0, 8);
  await intent.storage.set(HISTORY_KEY, next);
  await intent.storage.set(LAST_CHOICE_KEY, { provider: providerSel.value, model: modelSel.value });
}

async function ask(event) {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  const system = $("system").value.trim();
  const button = $("ask");
  button.disabled = true;
  setStatus("Thinking…");
  $("answer").textContent = "";
  $("answer-meta").textContent = "";
  const started = performance.now();
  try {
    const req = { prompt };
    if (system) req.system = system;
    if (providerSel.value) req.provider = providerSel.value;
    if (modelSel.value) req.model = modelSel.value;
    const res = await intent.models.complete(req);
    $("answer").textContent = res.text;
    $("answer-meta").textContent = `${res.provider} · ${res.model} · ${((performance.now() - started) / 1000).toFixed(1)} s`;
    setStatus("");
    await remember(prompt);
    await renderHistory();
    if (!document.hasFocus() && info.features.includes("notifications")) {
      intent.notifications.show({ title: "Answer ready", body: res.text.slice(0, 200), tag: "answer" }).catch(() => {});
    }
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    button.disabled = false;
  }
}

const info = await intent.app.info();
document.title = info.name;
$("app-name").textContent = info.name;
$("mock-badge").hidden = !intent.isMock;
providerSel.addEventListener("change", fillModels);
$("ask-form").addEventListener("submit", ask);
intent.on("session-ended", ({ reason }) => setStatus(`Session ended (${reason}).`, true));
try {
  await loadProviders();
} catch (e) {
  setStatus(describeError(e), true);
}
await renderHistory();
