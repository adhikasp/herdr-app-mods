import test from "node:test";
import assert from "node:assert/strict";
import { complete, describe, endpoint, headers, parseKeyText, resolveKey } from "../shared/llm.js";
import { configPath, mergeConfig } from "../shared/config.js";

const io = (env = {}, files = {}, fetchImpl) => ({
  env: async (n) => env[n] ?? null,
  read: async (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  },
  home: "/h",
  fetch: fetchImpl,
});

test("endpoint takes a base URL or a full one", () => {
  assert.equal(endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpoint("http://localhost:11434/v1/"), "http://localhost:11434/v1/chat/completions");
  assert.equal(endpoint("https://openrouter.ai/api/v1/chat/completions"), "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(endpoint("https://x.openai.azure.com/openai/deployments/d?api-version=1"), "https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=1");
  assert.equal(endpoint("https://x/y/chat/completions?k=1"), "https://x/y/chat/completions?k=1");
  assert.equal(endpoint(""), "");
});

test("parseKeyText: NAME= line, or a file holding only the token", () => {
  assert.equal(parseKeyText("A=1\nMY_KEY=sk-1\n", "MY_KEY"), "sk-1");
  assert.equal(parseKeyText("# secret\nsk-abc123\n", "MY_KEY"), "sk-abc123");
  assert.equal(parseKeyText("OTHER=1\n", "MY_KEY"), null); // an env file without our name is not a bare token
  assert.equal(parseKeyText("two\nlines\n", "MY_KEY"), null);
  assert.equal(parseKeyText("", "MY_KEY"), null);
});

test("token order: llm_key, then the variable, then the file", async () => {
  const files = { "/h/k.txt": "sk-file\n" };
  assert.deepEqual(await resolveKey({ llm_key: " sk-cfg " }, io({ OPENROUTER_API_KEY: "sk-env" }, files)), { key: "sk-cfg", from: "config" });
  assert.deepEqual(await resolveKey({}, io({ OPENROUTER_API_KEY: "sk-env" }, files)), { key: "sk-env", from: "env" });
  assert.deepEqual(await resolveKey({ llm_key_env: "MINE", llm_key_file: "~/k.txt" }, io({ OPENROUTER_API_KEY: "x" }, files)), { key: "sk-file", from: "file" });
  assert.deepEqual(await resolveKey({ llm_env_file: "~/k.txt" }, io({}, files)), { key: "sk-file", from: "file" }); // older name
  assert.deepEqual(await resolveKey({ llm_key_file: "/missing" }, io()), { key: null, from: null });
  assert.deepEqual(await resolveKey({ llm_auth: "none" }, io()), { key: null, from: "none" });
});

test("headers: bearer, none, or a named header", () => {
  assert.equal(headers({}, "t").Authorization, "Bearer t");
  assert.equal(headers({ llm_auth: "api-key" }, "t")["api-key"], "t");
  assert.equal(headers({ llm_auth: "api-key" }, "t").Authorization, undefined);
  assert.equal(headers({ llm_auth: "none" }, null).Authorization, undefined);
  assert.equal(headers({ llm_headers: { "HTTP-Referer": "r" } }, "t")["HTTP-Referer"], "r");
});

test("complete sends the model and token to the configured endpoint", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "hi" } }] }) };
  };
  const cfg = { llm_url: "http://localhost:1234/v1", llm_model: "local-m", llm_key: "tok" };
  assert.equal(await complete(cfg, io({}, {}, fetchImpl), { messages: [{ role: "user", content: "x" }] }), "hi");
  assert.equal(seen.url, "http://localhost:1234/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(JSON.parse(seen.init.body).model, "local-m");
});

test("complete: keyless server, missing token, HTTP error; the token never appears in an error", async () => {
  const okFetch = async (_u, init) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }), init });
  assert.equal(await complete({ llm_auth: "none", llm_url: "http://localhost:11434/v1" }, io({}, {}, okFetch), { messages: [] }), "ok");
  await assert.rejects(complete({}, io({}, {}, okFetch), { messages: [] }), /no API token \(looked in \$OPENROUTER_API_KEY/);
  const bad = async () => ({ ok: false, status: 401, text: async () => "" });
  await assert.rejects(complete({ llm_key: "sk-secret" }, io({}, {}, bad), { messages: [] }), (e) => /HTTP 401/.test(e.message) && !e.message.includes("sk-secret"));
  const empty = async () => ({ ok: true, status: 200, text: async () => "{}" });
  await assert.rejects(complete({ llm_key: "k" }, io({}, {}, empty), { messages: [] }), /no content/);
});

test("complete times out", async () => {
  const slow = () => new Promise(() => {});
  const withSleep = { ...io({}, {}, slow), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  await assert.rejects(complete({ llm_key: "k", llm_timeout_ms: 20 }, withSleep, { messages: [] }), /timed out/);
});

test("describe never shows the token", () => {
  const d = describe({ llm_key: "sk-secret", llm_url: "http://h/v1", llm_model: "m" });
  assert.ok(!d.includes("sk-secret"));
  assert.match(d, /http:\/\/h\/v1\/chat\/completions · m · auth bearer/);
});

test("config layers: defaults < file < props.config; a bad file is reported", () => {
  const defaults = { a: 1, b: 1, c: 1 };
  assert.deepEqual(mergeConfig(defaults, '{"b":2,"c":2}', { config: { c: 3 } }), { cfg: { a: 1, b: 2, c: 3 }, error: null });
  assert.deepEqual(mergeConfig(defaults, null, undefined), { cfg: defaults, error: null });
  assert.equal(mergeConfig(defaults, "{oops", null).error !== null, true);
  assert.deepEqual(mergeConfig(defaults, "{oops", null).cfg, defaults);
  assert.equal(mergeConfig(defaults, "[1]", null).error, "not a JSON object");
});

test("configPath honours an override folder", () => {
  assert.equal(configPath("/app", "tab-titles", null), "/app/config/tab-titles.json");
  assert.equal(configPath("/app", "tab-titles", "/etc/mods/"), "/etc/mods/tab-titles.json");
});
