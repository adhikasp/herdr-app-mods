// What tab-titles decides, with no host imports so `node --test` runs it.
//
// Rules (the same ones the TUI's command-plugin kept, adapted to the app, which
// tells us whether a tab was named by someone: `tab.named`):
//   - A tab nobody named gets its agent's task title.
//   - A tab we named keeps being ours while its name is still the one we wrote.
//     If the name changes under us, someone renamed it: it is theirs for good.
//   - A tab someone named is never touched. Clearing its name (tab.rename "")
//     makes it eligible again.
//   - By default a name stays with the first title it was written for; with
//     `follow_new_sessions` it tracks the agent's title (after /clear, a restart).
//   - A tab holding two or more agents is left alone unless `multi_agent_titles`
//     is on, which names it from all their titles with one model request.

export const DEFAULTS = {
  enabled: true,
  follow_new_sessions: false,
  lowercase_titles: false,
  max_length: 40,
  settle_ms: 3000,
  multi_agent_titles: false,
  llm_model: "openai/gpt-4o-mini",
  llm_url: "https://openrouter.ai/api/v1/chat/completions",
  llm_env_file: "",
  llm_retry_ms: 60000,
  // Space-name regexes. Non-empty `only_spaces`: manage only matching spaces.
  // `exclude_spaces`: never manage matching spaces (e.g. ["^telegram"]).
  only_spaces: [],
  exclude_spaces: [],
};

const GENERIC = new Set(["", "claude", "claude code", "codex", "opencode", "shell", "bash", "zsh", "fish", "sh"]);

/** A terminal title worth naming a tab after: no status glyph, vendor prefix, folder suffix or path. */
export function cleanTitle(raw, program) {
  const text = String(raw ?? "").trim();
  if (/^[~/]|^[A-Za-z]:\\/.test(text) || /^\S+@\S+/.test(text)) return "";
  let s = text.replace(/^OC \| /, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  s = s.replace(/\s+\|\s+[\w.@~/-]+$/, "").trim();
  const l = s.toLowerCase();
  if (GENERIC.has(l) || l === program?.name?.toLowerCase() || l === program?.key) return "";
  return s;
}

/** Collapse whitespace, optionally lowercase, cut to `max_length` code points. */
export function formatTitle(title, cfg) {
  let s = String(title ?? "").replace(/\s+/g, " ").trim();
  if (cfg.lowercase_titles) s = s.toLowerCase();
  const chars = Array.from(s);
  const max = Math.max(4, Number(cfg.max_length) || 40);
  if (chars.length > max) s = chars.slice(0, max - 1).join("").trimEnd() + "…";
  return s;
}

/** The task title of an agent, "" while it has none (an unset title reads as the terminal's address). */
export function agentTitle(a, cfg = DEFAULTS) {
  if (!a || a.title === a.address || a.title === String(a.address).split("/").pop()) return "";
  return formatTitle(cleanTitle(a.title, a.program), cfg);
}

const matches = (list, name) =>
  (list ?? []).some((src) => {
    try {
      return new RegExp(src, "u").test(name);
    } catch {
      return false;
    }
  });

/** Whether tab-titles may manage a space by its name. */
export function spaceAllowed(name, cfg) {
  if (cfg.only_spaces?.length && !matches(cfg.only_spaces, name)) return false;
  return !matches(cfg.exclude_spaces, name);
}

const same = (a, b) => String(a).trim() === String(b).trim();

/**
 * Decide what to rename.
 * @param {object} i  `{spaces, agents, state, seen, cfg, now, failUntil}`
 *   state: `{[tabId]: {name, key?, yielded?}}` persisted; seen: `{[tabId]: {cand, at}}` in memory.
 * @returns `{renames: [{tabId, name}], llm: [{tabId, titles, key}], state, seen, wake}`
 *   `state` is a fresh object (compare with JSON to see whether it changed);
 *   `wake` is ms until a pending title settles, or null.
 */
export function plan({ spaces, agents, state = {}, seen = {}, cfg = DEFAULTS, now = Date.now(), failUntil = {} }) {
  const next = {};
  const nextSeen = {};
  const renames = [];
  const llm = [];
  let wake = null;
  const settle = (tabId, cand) => {
    const s = seen[tabId];
    const first = !s || s.cand !== cand ? now : s.at;
    nextSeen[tabId] = { cand, at: first };
    const left = first + cfg.settle_ms - now;
    if (left > 0) {
      wake = wake == null ? left : Math.min(wake, left);
      return false;
    }
    return true;
  };

  for (const sp of spaces) {
    const allowed = spaceAllowed(sp.name ?? "", cfg);
    for (const tab of sp.tabs) {
      const st = state[tab.id];
      if (st) next[tab.id] = st;
      if (!allowed) continue;
      let ours = false;
      if (tab.named) {
        if (!st || st.yielded) continue;
        if (!same(st.name, tab.name)) {
          next[tab.id] = { ...st, yielded: true }; // renamed under us: theirs for good
          continue;
        }
        ours = true;
      } else if (st?.yielded) {
        next[tab.id] = { name: st.name }; // the name was cleared: eligible again
      }
      const here = agents.filter((a) => a.tab === tab.id);
      if (here.length === 1) {
        const cand = agentTitle(here[0], cfg);
        if (!cand || /^\d+$/.test(cand)) continue;
        if (ours && !cfg.follow_new_sessions) continue; // pinned to the first title
        if (ours && same(cand, tab.name)) continue;
        if (!settle(tab.id, cand)) continue;
        next[tab.id] = { name: cand };
        renames.push({ tabId: tab.id, name: cand });
      } else if (here.length >= 2 && cfg.multi_agent_titles) {
        const titles = [...new Set(here.map((a) => agentTitle(a, { ...cfg, max_length: 80 })).filter(Boolean))];
        if (titles.length < 2) continue;
        const key = [...titles].sort().join("\n");
        if (st?.key === key && (ours || !tab.named)) continue; // asked for exactly these titles already
        if ((failUntil[tab.id] ?? 0) > now) continue;
        if (!settle(`llm:${tab.id}`, key)) continue; // titles still changing: wait
        llm.push({ tabId: tab.id, titles, key });
      }
    }
  }
  for (const id of Object.keys(next)) {
    // forget tabs that are gone
    if (!spaces.some((s) => s.tabs.some((t) => t.id === id))) delete next[id];
  }
  return { renames, llm, state: next, seen: nextSeen, wake };
}

export const LLM_SYSTEM =
  "You name terminal tabs that hold several AI coding agent sessions. " +
  "Reply with ONLY the tab name: 2-4 words, at most 28 characters, no quotes, no trailing punctuation.";

export function requestBody(model, titles) {
  return {
    model,
    max_tokens: 600,
    temperature: 0.2,
    messages: [
      { role: "system", content: LLM_SYSTEM },
      { role: "user", content: `Session titles:\n${titles.map((t) => `- ${t}`).join("\n")}\n` },
    ],
  };
}

/** The model's tab name from a chat-completions response body, or null. */
export function parseReply(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const content = value?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const line = content.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const name = line.replace(/^["'`]+|["'`.]+$/g, "").trim();
  return name || null;
}

/** The last `NAME=value` line of an env file (`export NAME=...` and quotes allowed). */
export function parseEnvKey(text, name) {
  let found = null;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line.startsWith(`${name}=`)) continue;
    const v = line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
    if (v) found = v;
  }
  return found;
}
