// What the command bar lists and how it orders and filters it. Pure: it takes
// plain snapshots of what `herdr` returns (spaces(), agents(), terminals(),
// panes(), machines(), commands(), keys(), layouts(), themes()) and returns rows,
// so `node --test` runs it without the app.

import { matchFields, prepare, splitQuery, term } from "./fuzzy.js";

export const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

/** Kind prefixes: the first word of a query, followed by a space or a colon. */
export const PREFIXES = {
  s: "space", w: "space", ws: "space", space: "space", workspace: "space",
  a: "agent", agent: "agent",
  t: "tab", tab: "tab",
  p: "pane", pane: "pane",
  c: "command", cmd: "command", command: "command",
  m: "machine", machine: "machine",
};

/** Kinds in the order Tab cycles them. */
export const KIND_CYCLE = ["all", "agent", "tab", "space", "pane", "machine", "command"];

export const KIND_LABEL = {
  all: "everything", agent: "agents", tab: "tabs", space: "spaces", pane: "panes",
  machine: "machines", command: "commands", attention: "needs you",
};

/**
 * Split a raw query into a kind and the text to match.
 * `>` or `:` first means commands; `@` agents; `%` panes; `!` what needs you.
 * `s web`, `s:web` and `space: web` mean "spaces matching web". A lone `s`
 * with nothing after it is still a search for an s.
 */
export function parseQuery(raw) {
  const q = raw.replace(/^\s+/, "");
  const sigil = { ">": "command", ":": "command", "@": "agent", "%": "pane", "!": "attention" }[q[0]];
  if (sigil) return { kind: sigil, rest: q.slice(1).trim(), prefixed: true };
  const m = /^([A-Za-z]+)(?::\s*|\s+)(.*)$/s.exec(q);
  if (m && PREFIXES[m[1].toLowerCase()]) return { kind: PREFIXES[m[1].toLowerCase()], rest: m[2].trim(), prefixed: true };
  return { kind: "all", rest: q.trim(), prefixed: false };
}

const MOD = { cmd: "Super", super: "Super", ctrl: "Ctrl", shift: "Shift", alt: "Alt", option: "Alt" };
const KEY = {
  left: "←", right: "→", up: "↑", down: "↓", pageup: "PgUp", pagedown: "PgDn", escape: "Esc",
  enter: "Enter", backspace: "⌫", delete: "Del", space: "Space", tab: "Tab", insert: "Ins", home: "Home", end: "End",
};

/** `ctrl-shift-p` → `Ctrl+Shift+P`. A trailing `--` is the minus key. */
export function formatKeys(spec) {
  const parts = spec.endsWith("--") ? [...spec.slice(0, -2).split("-").filter(Boolean), "-"] : spec.split("-");
  return parts
    .map((p) => {
      const l = p.toLowerCase();
      if (MOD[l]) return MOD[l];
      if (KEY[l]) return KEY[l];
      if (/^f\d+$/.test(l)) return l.toUpperCase();
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("+");
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NUMERIC_ARGS = new Set(["index", "lines", "pages", "px", "weight"]);
const SKIP_COMMANDS = new Set(["app.reset", "window.close", "app.quit"]);

/** Commands whose one required argument is a fixed pair: the palette lists each, bound or not. */
const ARG_VALUES = { "pane.split": ["right", "down"] };

/**
 * A key binding's action as `{name, value}`. Two forms in keys.json:
 * `"pane.split:right"`, and `{command: "pane.split", args: {direction: "right", argv: [...]}}`.
 * The value is the command's first argument, the one the title shows.
 */
export function bindingAction(action, cmd) {
  if (typeof action === "string") {
    const i = action.indexOf(":");
    return { name: i < 0 ? action : action.slice(0, i), value: i < 0 ? undefined : action.slice(i + 1) };
  }
  if (!action || typeof action.command !== "string") return null;
  const first = cmd?.args?.[0]?.name;
  const value = first ? action.args?.[first] : undefined;
  const scalar = typeof value === "string" || typeof value === "number";
  return { name: action.command, value: scalar ? String(value) : undefined };
}

/** `pane.split` + `right` → "Pane: split right". */
export function commandTitle(name, value) {
  const [noun, ...verb] = name.split(".");
  const v = verb.join(" ").replace(/_/g, " ");
  return `${cap(noun)}: ${v}${value != null && value !== "" ? ` ${value}` : ""}`;
}

/**
 * Palette rows: every key binding that runs a command (with its keys), then a
 * command whose only argument is a fixed pair (`pane.split`), then every command
 * that needs no argument, then one row per layout and theme.
 */
export function commandRows({ commands = [], keys = [], layouts = [], themes = [] }) {
  const byName = new Map(commands.map((c) => [c.name, c]));
  const rows = new Map();
  const add = (name, value, hotkeys, about) => {
    const id = `${name}:${value ?? ""}`;
    const row = rows.get(id) ?? { name, value, hotkeys: [], about };
    for (const h of hotkeys) if (!row.hotkeys.includes(h)) row.hotkeys.push(h);
    rows.set(id, row);
  };
  const ordered = [...keys].sort((a, b) => (a.section === "global" ? 0 : 1) - (b.section === "global" ? 0 : 1));
  for (const k of ordered) {
    const name = typeof k.action === "string" ? k.action.split(":")[0] : k.action?.command;
    if (typeof name !== "string" || name === "terminal" || name === "send") continue;
    const cmd = byName.get(name);
    if (!cmd || SKIP_COMMANDS.has(name)) continue;
    const at = bindingAction(k.action, cmd);
    add(at.name, at.value, [formatKeys(k.keys)], cmd.about);
  }
  for (const [name, values] of Object.entries(ARG_VALUES)) {
    const cmd = byName.get(name);
    if (!cmd || SKIP_COMMANDS.has(name)) continue;
    for (const v of values) if (!rows.has(`${name}:${v}`)) add(name, v, [], cmd.about);
  }
  for (const c of commands) {
    if (SKIP_COMMANDS.has(c.name) || c.args.some((a) => a.required)) continue;
    if (!rows.has(`${c.name}:`)) add(c.name, undefined, [], c.about);
  }
  for (const name of layouts) add("layout.switch", name, [], byName.get("layout.switch")?.about);
  for (const t of themes) add("app.theme", t.name ?? t, [], byName.get("app.theme")?.about);
  return [...rows.values()].map((r) => ({ ...r, title: commandTitle(r.name, r.value) }));
}

/** The arguments to hand `run()` for a row: the value fills the command's first argument. */
export function commandArgs(commands, name, value) {
  if (value == null || value === "") return {};
  const first = commands.find((c) => c.name === name)?.args?.[0]?.name;
  if (!first) return {};
  return { [first]: NUMERIC_ARGS.has(first) && /^-?\d+$/.test(value) ? Number(value) : value };
}

const GENERIC = new Set(["", "claude", "claude code", "codex", "opencode", "shell", "bash", "zsh", "fish", "sh"]);

/** A terminal title worth showing: no leading status glyph, vendor prefix, folder suffix or path. */
export function cleanTitle(raw, program) {
  const text = String(raw ?? "").trim();
  if (/^[~/]|^[A-Za-z]:\\/.test(text) || /^\S+@\S+/.test(text)) return ""; // a path or user@host is not a task
  let s = text.replace(/^OC \| /, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  s = s.replace(/\s+\|\s+[\w.@~/-]+$/, "").trim(); // Codex appends " | folder"
  const l = s.toLowerCase();
  if (GENERIC.has(l) || l === program?.name?.toLowerCase() || l === program?.key) return "";
  return s;
}

const p = (text) => prepare(text);

/** Every row the bar can show, before filtering. */
export function buildItems(data) {
  const { spaces = [], agents = [], terminals = [], panes = [], machines = [], focused = null } = data;
  const items = [];
  const tabOf = new Map();
  const spaceOf = new Map();
  spaces.forEach((sp, si) => {
    spaceOf.set(sp.id, { sp, si });
    sp.tabs.forEach((tab, ti) => tabOf.set(tab.id, { sp, tab, si, ti }));
  });
  const agentTabs = new Set(agents.map((a) => a.tab));
  const agentAddrs = new Set(agents.map((a) => a.address));
  const paneTerminals = new Set(panes.map((x) => x.terminal).filter(Boolean));
  const curTab = focused?.tab ?? null;

  spaces.forEach((sp, si) => {
    items.push({
      id: `space:${sp.id}`, kind: "space", title: sp.name, summary: sp.branch ? `⎇ ${sp.branch}` : "",
      detail: sp.machine ?? "", extra: [sp.folder, sp.machine, sp.branch].filter(Boolean).join(" "),
      status: sp.status, order: [si, -1], current: sp.active,
      action: { name: "space.select", args: { id: sp.id } },
    });
    sp.tabs.forEach((tab, ti) => {
      items.push({
        id: `tab:${tab.id}`, kind: "tab", hasAgents: agentTabs.has(tab.id),
        title: tab.named ? tab.name : `Tab ${tab.name}`, summary: "", detail: sp.name, extra: sp.name,
        status: tab.status, order: [si, ti], current: tab.id === curTab || (sp.active && tab.active),
        tabId: tab.id, named: tab.named, spaceName: sp.name,
        action: { name: "tab.select", args: { id: tab.id } },
      });
    });
  });

  agents.forEach((a, ai) => {
    const t = tabOf.get(a.tab);
    const live = a.title === a.address ? "" : cleanTitle(a.title, a.program);
    const named = t?.tab?.named ? t.tab.name : "";
    const title = named || live || a.program?.name || "agent";
    const slash = a.address.indexOf("/");
    const machine = slash > 0 ? a.address.slice(0, slash) : "";
    items.push({
      id: `agent:${a.address}`, kind: "agent", title,
      summary: named && live && live !== named ? live : "",
      detail: [machine, a.space_name].filter(Boolean).join(" · "),
      extra: [a.space_name, a.program?.name, a.app, machine].filter(Boolean).join(" "),
      status: a.status, program: a.program, seq: a.seq,
      order: [spaceOf.get(a.space)?.si ?? 99, t?.ti ?? 99, ai],
      current: a.tab === curTab && (a.focused || !agents.some((x) => x.tab === curTab && x.focused)),
      tabId: a.tab, address: a.address, pinned: a.pinned,
      action: { name: "agent.focus", args: { terminal: a.address } },
    });
  });

  terminals.forEach((x, ti) => {
    if (x.state && x.state !== "live") return;
    if (!x.name && !x.parent) return;
    if (agentAddrs.has(x.address)) return;
    const hasPane = paneTerminals.has(x.address);
    items.push({
      id: `pane:${x.address}`, kind: "pane",
      title: x.name || x.template || x.program?.name || x.address,
      summary: cleanTitle(x.title, x.program), detail: x.labels?.where ?? x.where ?? "",
      extra: [x.program?.name, x.cwd, x.address].filter(Boolean).join(" "),
      status: x.status && x.status !== "error" ? x.status : x.status === "error" ? "blocked" : null,
      program: x.program, order: [98, ti], current: false, address: x.address,
      action: hasPane
        ? { name: "pane.focus", args: { terminal: x.address } }
        : { name: "terminal.peek", args: { terminal: x.address } },
    });
  });

  machines.forEach((m, mi) => {
    if (!m.name) return;
    items.push({
      id: `machine:${m.name}`, kind: "machine", title: m.name, summary: "new space",
      detail: m.layout === "ready" ? "" : m.layout, extra: "machine remote ssh",
      status: null, order: [99, mi], current: false,
      action: { name: "space.new", args: { machine: m.name } },
    });
  });

  commandRows(data).forEach((r, ci) => {
    items.push({
      id: `command:${r.name}:${r.value ?? ""}`, kind: "command", title: r.title, summary: "",
      detail: r.hotkeys.slice(0, 2).join(" / "), extra: r.name,
      status: null, order: [100, ci], current: false, bound: r.hotkeys.length > 0,
      action: { name: r.name, args: commandArgs(data.commands ?? [], r.name, r.value) },
    });
  });
  return items;
}

const cmpOrder = (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || (a.order[2] ?? 0) - (b.order[2] ?? 0);
const urgent = (i) => i.status === "blocked" || i.status === "done";

/** The list at rest: what needs you, recents, then the rest. The place you are in never comes first. */
export function restingOrder(items, { mru = [] } = {}) {
  const places = items.filter((i) => i.kind !== "command" && !(i.kind === "tab" && i.hasAgents));
  const used = new Set();
  const take = (list) => list.filter((i) => !used.has(i.id) && (used.add(i.id), true));
  const unread = take(
    places
      .filter((i) => (i.kind === "agent" || i.kind === "tab") && urgent(i) && !i.current)
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || (b.seq ?? 0) - (a.seq ?? 0)),
  );
  const byId = new Map(places.map((i) => [i.id, i]));
  const recent = take(mru.map((id) => byId.get(id)).filter((i) => i && !i.current));
  const here = take(places.filter((i) => i.current && i.kind !== "space"));
  const work = take(
    places
      .filter((i) => i.kind === "agent" || i.kind === "tab" || i.kind === "pane")
      .sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || cmpOrder(a, b)),
  );
  const spaces = take(places.filter((i) => i.kind === "space").sort(cmpOrder));
  const machines = take(places.filter((i) => i.kind === "machine").sort(cmpOrder));
  return [...unread, ...recent, ...here, ...work, ...spaces, ...machines];
}

function candidates(items, kind) {
  switch (kind) {
    case "all": return items.filter((i) => !(i.kind === "tab" && i.hasAgents));
    case "tab": return items.filter((i) => i.kind === "tab");
    case "attention": return items.filter((i) => i.kind !== "command" && i.kind !== "space" && !(i.kind === "tab" && i.hasAgents) && urgent(i));
    default: return items.filter((i) => i.kind === kind);
  }
}

function naturalOrder(items, kind) {
  if (kind === "command") {
    return [...items].sort((a, b) => Number(Boolean(b.bound)) - Number(Boolean(a.bound)) || a.title.localeCompare(b.title));
  }
  if (kind === "agent" || kind === "attention") {
    return [...items].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || (b.seq ?? 0) - (a.seq ?? 0) || cmpOrder(a, b));
  }
  return [...items].sort(cmpOrder);
}

/**
 * Filter and rank. `kind` overrides the prefix parsed from `raw` (Tab cycles it).
 * Returns `{rows: [{item, positions: [title, summary]}], kind, rest, widened}`.
 */
export function search(items, raw, { mru = [], kind: forced = null, limit = 300 } = {}) {
  let parsed = parseQuery(raw);
  if (forced && forced !== "all") parsed = { kind: forced, rest: raw.trim(), prefixed: false };
  const run = (kind, rest) => {
    const pool = candidates(items, kind).filter((i) => kind !== "all" || rest || i.kind !== "command");
    if (!rest) {
      const rows = kind === "all" ? restingOrder(items, { mru }) : naturalOrder(pool, kind);
      return rows.map((item) => ({ item, positions: [[], []] }));
    }
    const terms = splitQuery(rest).map(term);
    const short = rest.length <= 2;
    const out = [];
    for (const item of pool) {
      const m = matchFields(terms, [
        { prepared: item.pt ?? (item.pt = p(item.title)), weight: 1 },
        { prepared: item.ps ?? (item.ps = p(item.summary)), weight: 0.6 },
        { prepared: item.pe ?? (item.pe = p(item.extra)), weight: 0.5 },
      ]);
      if (!m) continue;
      let score = m.score;
      const r = mru.indexOf(item.id);
      if (r >= 0) score += Math.max(0, 20 - r);
      score += (STATUS_RANK[item.status] ?? 0) * 0.5;
      if (item.current) score -= 5;
      if (item.kind === "command" && kind === "all" && short) score -= 10000;
      out.push({ item, score, positions: m.positions });
    }
    out.sort((a, b) => b.score - a.score || cmpOrder(a.item, b.item));
    return out.map(({ item, positions }) => ({ item, positions }));
  };
  let kind = parsed.kind;
  let rows = run(kind, parsed.rest);
  let widened = false;
  if (!rows.length && parsed.prefixed && kind !== "attention" && parsed.rest && !/^[>:@%!]/.test(raw.trim())) {
    // The prefix was an ordinary word after all: search everything for the whole query.
    kind = "all";
    rows = run("all", raw.trim());
    widened = true;
  }
  return { rows: rows.slice(0, limit), kind, rest: parsed.rest, widened };
}
