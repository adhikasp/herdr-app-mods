// A small, host-free client for any OpenAI-compatible chat endpoint, shared by the mods that call a model.
//
// This file is the source of truth. Mods are self-contained (a mod folder is linked or copied into the app on
// its own and cannot import across folders), so `scripts/sync-shared` copies it into each mod that uses it,
// and a test fails if a copy drifts. Edit it here, then run `scripts/sync-shared`.
//
// One config shape, the same keys in every mod (put them in the mod's config/<mod>.json):
//
//   llm_url         endpoint: a base URL (`https://api.openai.com/v1`, `http://localhost:11434/v1`) or the full
//                   chat-completions URL. `/chat/completions` is added when the URL has no such path.
//   llm_model       model name as that endpoint knows it.
//   llm_key         the token itself (visible in the config file: prefer one of the next two).
//   llm_key_env     name of an environment variable holding the token (default OPENROUTER_API_KEY).
//   llm_key_file    a file with `NAME=token` (NAME is llm_key_env) or holding only the token. `~/` allowed.
//   llm_env_file    older name of llm_key_file; still read.
//   llm_auth        "bearer" (default; `Authorization: Bearer <token>`), "none" (no token: local servers), or
//                   a header name (`api-key`, `x-api-key`) that receives the bare token.
//   llm_headers     extra headers, e.g. {"HTTP-Referer": "https://example.com"}.
//   llm_timeout_ms  give up on a request after this long.
//
// The token is looked up in that order: llm_key, the environment variable, the file.

export const LLM_DEFAULTS = {
  llm_url: "https://openrouter.ai/api/v1/chat/completions",
  llm_model: "openai/gpt-4o-mini",
  llm_key: "",
  llm_key_env: "OPENROUTER_API_KEY",
  llm_key_file: "",
  llm_env_file: "",
  llm_auth: "bearer",
  llm_headers: {},
  llm_timeout_ms: 20000,
};

/** The chat-completions URL for a base URL or a full one (a query string, as Azure uses, is kept). */
export function endpoint(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  const q = raw.indexOf("?");
  const base = (q < 0 ? raw : raw.slice(0, q)).replace(/\/+$/, "");
  const query = q < 0 ? "" : raw.slice(q);
  return (/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`) + query;
}

/** The last `NAME=value` line of an env file (`export NAME=...` and quotes allowed). */
export function parseEnvKey(text, name) {
  let found = null;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!name || !line.startsWith(`${name}=`)) continue;
    const v = line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
    if (v) found = v;
  }
  return found;
}

/** A token from a file's text: the `NAME=` line when there is one, else the file's only line if it is bare. */
export function parseKeyText(text, name) {
  const named = parseEnvKey(text, name);
  if (named) return named;
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length !== 1) return null;
  const only = lines[0].replace(/^["']|["']$/g, "");
  return /\s/.test(only) || /^(export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(only) ? null : only || null;
}

/** `~/x` as an absolute path. */
export function expandHome(path, home) {
  const p = String(path ?? "");
  return p === "~" ? home : p.startsWith("~/") ? `${home}/${p.slice(2)}` : p;
}

/** The config with defaults filled in (and the older llm_env_file read as llm_key_file). */
export function llmConfig(cfg = {}) {
  const c = { ...LLM_DEFAULTS, ...cfg };
  if (!c.llm_key_file && c.llm_env_file) c.llm_key_file = c.llm_env_file;
  return c;
}

/** Whether the endpoint needs a token. */
export const needsKey = (cfg) => String(llmConfig(cfg).llm_auth).toLowerCase() !== "none";

/**
 * Find the token. `io` supplies the host: `env(name)` resolves a variable's value or null,
 * `read(path)` a file's text or null, `home` the home folder.
 * @returns `{key, from}` — `from` is "config", "env", "file", "none" (no token wanted) or null (not found).
 */
export async function resolveKey(cfg, io) {
  const c = llmConfig(cfg);
  if (!needsKey(c)) return { key: null, from: "none" };
  if (String(c.llm_key).trim()) return { key: String(c.llm_key).trim(), from: "config" };
  if (c.llm_key_env) {
    try {
      const v = await io.env(c.llm_key_env);
      if (v && v.trim()) return { key: v.trim(), from: "env" };
    } catch {}
  }
  if (c.llm_key_file) {
    try {
      const k = parseKeyText(await io.read(expandHome(c.llm_key_file, io.home)), c.llm_key_env);
      if (k) return { key: k, from: "file" };
    } catch {}
  }
  return { key: null, from: null };
}

/** Request headers for a token (null when the endpoint wants none). */
export function headers(cfg, key) {
  const c = llmConfig(cfg);
  const h = { "Content-Type": "application/json", ...(c.llm_headers ?? {}) };
  const auth = String(c.llm_auth).trim();
  if (key && auth.toLowerCase() === "bearer") h.Authorization = `Bearer ${key}`;
  else if (key && auth.toLowerCase() !== "none") h[auth] = key;
  return h;
}

/** The reply text of a chat-completions response body, or null. */
export function replyContent(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const content = value?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

/**
 * One chat completion. `io` as for resolveKey, plus an optional `fetch` (default the global one) and `sleep`.
 * @param {object} body  `{messages, max_tokens?, temperature?, ...}`; `model` is filled from the config.
 * @returns the reply text. Throws with a short message that never contains the token.
 */
export async function complete(cfg, io, body) {
  const c = llmConfig(cfg);
  const url = endpoint(c.llm_url);
  if (!url) throw new Error("llm_url is empty");
  const { key } = await resolveKey(c, io);
  if (!key && needsKey(c)) {
    const where = [c.llm_key_env && `$${c.llm_key_env}`, c.llm_key_file, "llm_key"].filter(Boolean).join(", ");
    throw new Error(`no API token (looked in ${where}; set llm_auth to "none" for a server without one)`);
  }
  const doFetch = io.fetch ?? fetch;
  const timeout = Number(c.llm_timeout_ms) || 20000;
  // Mods have no setTimeout: the host passes `io.sleep(ms)` (a promise) to get a timeout; without it there is none.
  const racers = [doFetch(url, { method: "POST", headers: headers(c, key), body: JSON.stringify({ model: c.llm_model, ...body }) })];
  if (io.sleep) {
    racers.push(
      io.sleep(timeout).then(() => {
        throw new Error(`model request timed out after ${timeout} ms`);
      }),
    );
  }
  const r = await Promise.race(racers);
  if (!r.ok) throw new Error(`model request failed: HTTP ${r.status}`);
  const content = replyContent(await r.text());
  if (content == null) throw new Error("model reply had no content");
  return content;
}

/** A summary of the settings that is safe to show: never the token. */
export function describe(cfg) {
  const c = llmConfig(cfg);
  return `${endpoint(c.llm_url)} · ${c.llm_model} · auth ${needsKey(c) ? String(c.llm_auth) : "none"}`;
}
