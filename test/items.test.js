import test from "node:test";
import assert from "node:assert/strict";
import {
  buildItems, cleanTitle, commandArgs, commandRows, commandTitle, formatKeys, parseQuery, restingOrder, search,
} from "../mods/command-bar/items.js";

const prog = (key, name) => ({ key, name, icon: null, tint: false, tile: null, color: null, shell: false, agent: true });
const tab = (id, name, extra = {}) => ({ id, index: 1, name, named: !/^\d+$/.test(name), active: false, status: null, panes: 1, zoomed: false, settled: false, ...extra });
const space = (id, name, tabs, extra = {}) => ({ id, index: 1, name, named: true, folder: `/w/${name}`, machine: null, branch: null, active: false, status: null, tabs, ...extra });
const agent = (address, tabId, spaceId, spaceName, status, title, seq, extra = {}) => ({
  address, pane: `p-${address}`, space: spaceId, space_name: spaceName, tab: tabId, tab_index: 1, tab_name: "1",
  status, app: "claude-code", program: prog("claude", "Claude Code"), title, seq, pinned: false, focused: false, ...extra,
});

const spaces = [
  space("s1", "my-life", [tab("t1", "1", { active: true, status: "working" }), tab("t2", "notes")], { active: true, status: "working" }),
  space("s2", "api", [tab("t3", "fix login", { status: "blocked" }), tab("t4", "3", { status: "done" })], { status: "blocked", branch: "main" }),
  space("s3", "vps-box", [tab("t5", "1")], { machine: "vps" }),
];
const agents = [
  agent("t1", "t1", "s1", "my-life", "working", "✳ Assistant overview", 9, { focused: true }),
  agent("t7", "t3", "s2", "api", "blocked", "✳ Rotate API keys", 5),
  agent("t8", "t4", "s2", "api", "done", "✳ Write release notes", 7),
];
const commands = [
  { name: "tab.new", args: [{ name: "name", required: false }], about: "Make a tab" },
  { name: "tab.close", args: [{ name: "id", required: false }], about: "Close a tab" },
  { name: "space.select", args: [{ name: "index", required: false }, { name: "id", required: false }], about: "Show a space" },
  { name: "pane.split", args: [{ name: "direction", required: true }], about: "Split" },
  { name: "space.move", args: [{ name: "id", required: true }, { name: "index", required: true }], about: "Move" },
  { name: "app.reset", args: [], about: "escape hatch" },
  { name: "layout.switch", args: [{ name: "name", required: false }], about: "Show a layout" },
  { name: "app.theme", args: [{ name: "name", required: true }], about: "Use a theme" },
];
const keys = [
  { section: "global", keys: "ctrl-shift-t", action: "tab.new" },
  { section: "global", keys: "alt-3", action: "space.select:3" },
  { section: "global", keys: "ctrl-shift-o", action: "pane.split:right" },
  { section: "terminal", keys: "ctrl-shift-c", action: "terminal.copy" },
  { section: "terminal", keys: "ctrl-left", action: "send:\u001bb" },
  { section: "global", keys: "ctrl-v", action: "terminal" },
  { section: "global", keys: "alt-o", action: "mod.open:command-bar" },
];
const data = {
  spaces, agents, commands, keys, layouts: ["main", "work"], themes: [{ name: "atom-one-dark" }],
  machines: [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }],
  terminals: [
    { address: "t1", state: "live", name: null, title: "x", labels: {} },
    { address: "t20", state: "live", name: "build-watch", title: "", labels: { where: "api / 3" }, program: prog("shell", "bash") },
    { address: "t21", state: "live", name: null, parent: "t7", template: "reviewer", title: "", status: "working", program: prog("claude", "Claude Code") },
  ],
  panes: [{ pane: "p-t20", terminal: "t20", tab: "t3", title: "", cwd: null, branch: null, status: null, app: null, program: prog("shell", "bash"), focused: false, zoomed: false, movable: false }],
  focused: { space: "s1", tab: "t1", pane: "p-t1", terminal: "t1", shown: null, agent: "t1", cwd: "/w" },
};
const items = buildItems(data);
const ids = (r) => r.rows.map((x) => x.item.id);

test("parseQuery: kind prefixes, sigils, plain words", () => {
  assert.deepEqual(parseQuery("s mylf"), { kind: "space", rest: "mylf", prefixed: true });
  assert.deepEqual(parseQuery("s:mylf"), { kind: "space", rest: "mylf", prefixed: true });
  assert.deepEqual(parseQuery("space: mylf"), { kind: "space", rest: "mylf", prefixed: true });
  assert.deepEqual(parseQuery("> split"), { kind: "command", rest: "split", prefixed: true });
  assert.deepEqual(parseQuery(":split"), { kind: "command", rest: "split", prefixed: true });
  assert.deepEqual(parseQuery("@ claude"), { kind: "agent", rest: "claude", prefixed: true });
  assert.deepEqual(parseQuery("s"), { kind: "all", rest: "s", prefixed: false });
  assert.deepEqual(parseQuery("s "), { kind: "space", rest: "", prefixed: true });
  assert.deepEqual(parseQuery("fix login"), { kind: "all", rest: "fix login", prefixed: false });
});

test("formatKeys", () => {
  assert.equal(formatKeys("ctrl-shift-p"), "Ctrl+Shift+P");
  assert.equal(formatKeys("alt-left"), "Alt+←");
  assert.equal(formatKeys("ctrl--"), "Ctrl+-");
  assert.equal(formatKeys("f2"), "F2");
  assert.equal(formatKeys("cmd-k"), "Super+K");
});

test("commandRows: bindings first with keys, args-free extras, layouts and themes; unsafe ones dropped", () => {
  const rows = commandRows(data);
  const by = (t) => rows.find((r) => r.title === t);
  assert.deepEqual(by("Tab: new").hotkeys, ["Ctrl+Shift+T"]);
  assert.deepEqual(by("Space: select 3").hotkeys, ["Alt+3"]);
  assert.deepEqual(by("Pane: split right").hotkeys, ["Ctrl+Shift+O"]);
  assert.ok(by("Tab: close"), "unbound but argument-free");
  assert.equal(by("Pane: split"), undefined, "required argument and no value");
  assert.equal(by("App: reset"), undefined);
  assert.equal(by("Space: move"), undefined);
  assert.ok(by("Layout: switch work"));
  assert.ok(by("Theme: atom-one-dark") === undefined && by("App: theme atom-one-dark"));
  assert.equal(rows.some((r) => r.name === "mod.open"), false, "mod.open is not in this fixture's commands()");
});

test("commandArgs: value fills the first argument; indexes become numbers", () => {
  assert.deepEqual(commandArgs(commands, "space.select", "3"), { index: 3 });
  assert.deepEqual(commandArgs(commands, "pane.split", "right"), { direction: "right" });
  assert.deepEqual(commandArgs(commands, "layout.switch", "work"), { name: "work" });
  assert.deepEqual(commandArgs(commands, "tab.new", undefined), {});
});

test("cleanTitle drops glyphs, vendor prefix, folder suffix, generic names and paths", () => {
  assert.equal(cleanTitle("✳ Fix login bug", null), "Fix login bug");
  assert.equal(cleanTitle("OC | Refactor api", null), "Refactor api");
  assert.equal(cleanTitle("Add tests | herdr-app-mods", null), "Add tests");
  assert.equal(cleanTitle("Claude Code", null), "");
  assert.equal(cleanTitle("bash", { key: "shell", name: "bash" }), "");
  assert.equal(cleanTitle("~/Workspace/x", null), "");
  assert.equal(cleanTitle("me@host: ~", null), "");
});

test("buildItems: agent row takes the tab name, else the cleaned title; tabs with agents are hidden at rest", () => {
  const a7 = items.find((i) => i.id === "agent:t7");
  assert.equal(a7.title, "fix login");
  assert.equal(a7.summary, "Rotate API keys");
  const a8 = items.find((i) => i.id === "agent:t8");
  assert.equal(a8.title, "Write release notes");
  assert.equal(items.find((i) => i.id === "pane:t20").action.name, "pane.focus");
  assert.equal(items.find((i) => i.id === "pane:t21").action.name, "terminal.peek", "a sub-agent without a pane is peeked");
  assert.equal(items.find((i) => i.id === "machine:vps").action.args.machine, "vps");
  assert.equal(items.filter((i) => i.kind === "pane").length, 2);
});

test("restingOrder: needs you, then done, then recents, current never first, commands absent", () => {
  const order = restingOrder(items, { mru: ["tab:t2"] }).map((i) => i.id);
  assert.deepEqual(order.slice(0, 3), ["agent:t7", "agent:t8", "tab:t2"]);
  assert.ok(order.indexOf("agent:t1") > 2, "the agent you are in sits after unread and recents");
  assert.equal(order.some((i) => i.startsWith("command:")), false);
  assert.ok(order.indexOf("space:s1") > order.indexOf("agent:t1"), "spaces after work");
});

test("search: space prefix finds the my-life space", () => {
  const r = search(items, "s mylf");
  assert.equal(r.kind, "space");
  assert.equal(r.rows[0].item.id, "space:s1");
  assert.deepEqual(r.rows[0].positions[0], [0, 1, 3, 5]);
});

test("search: a prefix that matches nothing widens back to everything", () => {
  const r = search(items, "tab fix");
  assert.equal(r.kind, "tab");
  assert.ok(ids(r).includes("tab:t3"));
  const w = search(items, "p rotate");
  assert.equal(w.widened, true);
  assert.equal(w.kind, "all");
  assert.ok(ids(w).includes("agent:t7"));
});

test("search: > lists commands with hotkeys; short queries rank places before commands", () => {
  const c = search(items, "> new");
  assert.equal(c.kind, "command");
  assert.equal(c.rows[0].item.title, "Tab: new");
  assert.equal(c.rows[0].item.detail, "Ctrl+Shift+T");
  const short = search(items, "ta");
  const firstCmd = ids(short).findIndex((i) => i.startsWith("command:"));
  const lastPlace = ids(short).findLastIndex((i) => !i.startsWith("command:"));
  assert.ok(firstCmd === -1 || firstCmd > lastPlace);
});

test("search: ! lists only what needs you; tab kind lists every tab including agent tabs", () => {
  const n = search(items, "!");
  assert.deepEqual(ids(n).sort(), ["agent:t7", "agent:t8", "pane:t21"].filter((i) => i !== "pane:t21").sort());
  const tabs = search(items, "t ");
  assert.equal(tabs.rows.length, 5);
});

test("search: forced kind (Tab cycling) keeps the typed text as the query", () => {
  const r = search(items, "api", { kind: "agent" });
  assert.equal(r.kind, "agent");
  assert.deepEqual(ids(r), ["agent:t7", "agent:t8"]);
});

test("search: recents lift an equal match", () => {
  const base = search(items, "notes");
  assert.ok(ids(base).includes("tab:t2"));
  const r = search(items, "1", { mru: ["tab:t5"] });
  assert.equal(r.rows[0].item.id, "tab:t5");
});
