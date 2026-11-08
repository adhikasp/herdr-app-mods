import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, appFor, plan, typable, resumeCommand } from "../mods/idle-reaper/reaper.js";
import { augmentPath, makeCwdOf, parseLsofCwd, run, samePath } from "../mods/idle-reaper/runner.js";
import { Lease } from "../shared/lease.js";
import { barCommand, findNode, moveTab, parseCommand } from "../mods/tab-tools/tools.js";

const H = 3600;
const NOW = 1_000_000;
const cfg = {
  ...DEFAULTS,
  groups: [{ name: "telegram", match: "^(telegram|tg-.*)$", exempt: "^telegram$", close_after_s: 90 * 60, max_live: 2, min_idle_s: 15 * 60 }],
};
const term = (key, o = {}) => ({ key, token: `${key}@1`, name: null, app: "claude-code", status: "idle", idle_since: NOW - 5 * H, focused: false, hasStatus: true, session: "abc-123", title: "x", ...o });

test("appFor maps what hc reports to an apps key", () => {
  assert.equal(appFor(DEFAULTS.apps, "claude-code"), "claude-code");
  assert.equal(appFor(DEFAULTS.apps, undefined, "claude"), "claude-code");
  assert.equal(appFor(DEFAULTS.apps, "pi", "bash"), null);
});

test("typable and resumeCommand", () => {
  assert.ok(typable("claude --resume 0a1b-2c3d"));
  assert.ok(!typable("opencode --session ses_abc")); // `_` has no key name
  assert.ok(!typable("cd ~/x"));
  assert.equal(resumeCommand(DEFAULTS.apps.opencode, "ses_1"), "opencode --session ses_1");
});

test("an agent idle past park_after_s is parked, a fresh one is kept", () => {
  const p = plan({ cfg, now: NOW, terms: [term("t1"), term("t2", { idle_since: NOW - 60 })] });
  assert.deepEqual(p.park.map((j) => j.key), ["t1"]);
  assert.deepEqual(Object.keys(p.keep), ["t2"]);
});

test("never touched: focused, working, blocked, named, no session, no app", () => {
  const terms = [term("a", { focused: true }), term("b", { status: "working" }), term("c", { status: "blocked" }), term("d", { name: "build" }), term("e", { session: null }), term("f", { app: null })];
  const p = plan({ cfg, now: NOW, terms });
  assert.deepEqual([p.park, p.closeParked, p.closeGroup].map((x) => x.length), [0, 0, 0]);
  assert.deepEqual(Object.keys(p.keep), []);
});

test("a parked pane is closed after close_after_s, kept before, forgotten once resumed or recycled", () => {
  const parked = (idle) => ({ terminal_id: "t1@1", idle_since: NOW - idle, parked: true, cmd: "claude --resume abc" });
  const shell = (o) => term("t1", { app: null, status: null, hasStatus: false, session: null, ...o });
  assert.deepEqual(plan({ cfg, now: NOW, terms: [shell()], state: { t1: parked(4 * 86400) } }).closeParked.map((j) => j.key), ["t1"]);
  assert.deepEqual(Object.keys(plan({ cfg, now: NOW, terms: [shell()], state: { t1: parked(86400) } }).keep), ["t1"]);
  assert.deepEqual(Object.keys(plan({ cfg, now: NOW, terms: [term("t1")], state: { t1: parked(4 * 86400) } }).keep), []); // agent runs again
  const recycled = plan({ cfg, now: NOW, terms: [shell({ token: "t1@2" })], state: { t1: parked(4 * 86400) } });
  assert.equal(recycled.closeParked.length, 0); // same address, new terminal: the old record means nothing
});

test("a group closes by age, and by cap (least recently used first, never fresher than min_idle_s)", () => {
  const g = (key, name, idleMin) => term(key, { name, app: null, session: null, idle_since: NOW - idleMin * 60 });
  const terms = [g("a", "tg-1", 200), g("b", "tg-2", 30), g("c", "tg-3", 20), g("d", "tg-4", 10), g("m", "telegram", 9999)];
  const p = plan({ cfg, now: NOW, terms });
  // 4 non-exempt members, cap 2: the two least recently used (a, b) are over the cap and idle >= min_idle_s
  assert.deepEqual(p.closeGroup.map((c) => [c.key, c.reason]), [["a", "over cap"], ["b", "over cap"]]);
  assert.deepEqual(Object.keys(p.keep).sort(), ["c", "d", "m"]); // the exempt `telegram` is kept, never closed
  const over = plan({ cfg, now: NOW, terms: [g("x", "tg-1", 40), g("y", "tg-2", 10), g("z", "tg-3", 5)] });
  assert.deepEqual(over.closeGroup.map((c) => c.key), ["x"]); // over the cap by one; the oldest goes
  const young = plan({ cfg, now: NOW, terms: [g("x", "tg-1", 10), g("y", "tg-2", 8), g("z", "tg-3", 5)] });
  assert.deepEqual(young.closeGroup, []); // over the cap, but nothing has been idle for min_idle_s yet
});

test("groups: working or focused members are left alone; a bad regex matches nothing", () => {
  const p = plan({ cfg: { ...cfg, groups: [{ name: "x", match: "(", close_after_s: 1 }] }, now: NOW, terms: [term("t", { name: "tg-1", app: null })] });
  assert.equal(p.closeGroup.length, 0);
  const q = plan({ cfg, now: NOW, terms: [term("t", { name: "tg-1", app: null, status: "working", idle_since: null }), term("u", { name: "tg-2", app: null, focused: true })] });
  assert.equal(q.closeGroup.length, 0);
});

// ---- runner against a fake hc
function fakeIo(terminals, { shellCwd = "/w", dry = false } = {}) {
  const calls = [];
  const live = new Map(terminals.map((t) => [t.address, { ...t }]));
  const io = {
    home: "/h",
    calls,
    state: {},
    hc: async (args) => {
      calls.push(args.join(" "));
      const [cmd, key] = args;
      if (cmd === "ls") return { code: 0, stdout: JSON.stringify({ terminals: [...live.values()].map((t) => ({ address: t.address, state: "live", status: t.status?.state, name: t.name ?? undefined, agent: t.agent })) }) };
      if (cmd === "get") {
        const t = live.get(key);
        return t ? { code: 0, stdout: JSON.stringify(t) } : { code: 1, stdout: "" };
      }
      if (cmd === "send") {
        const t = live.get(key);
        if (t) { delete t.status; t.foreground = { name: "bash", cwd: shellCwd }; }
        return { code: 0, stdout: "" };
      }
      if (cmd === "read") return { code: 0, stdout: live.get(key)?.screen ?? "" };
      if (cmd === "kill") { live.delete(key); return { code: 0, stdout: "" }; }
      return { code: 0, stdout: "" };
    },
    readText: async () => JSON.stringify({ sessionId: "sess-1" }),
    cwdOf: async () => shellCwd,
    focusedTerminal: async () => null,
    readState: async () => io.state,
    writeState: async (o) => { io.state = o; },
    sleep: async () => {},
    log: () => {},
  };
  return io;
}
const claude = (address, o = {}) => ({ address, state: "live", created_ms: 1, name: null, title: "✳ Fix thing", cwd: "/w", pid: 10, argv: ["/usr/bin/bash"], labels: {}, status: { app: "claude-code", state: "idle" }, status_ms: (NOW - 5 * H) * 1000, foreground: { name: "claude", cwd: "/w", pid: 99 }, ...o });

test("runner parks an idle claude: /exit, then the resume command typed without enter", async () => {
  const io = fakeIo([claude("t1")]);
  const lines = await run({ ...cfg }, io, NOW);
  assert.ok(io.calls.includes("send t1 /exit"));
  const typed = io.calls.find((c) => c.startsWith("keys t1 "));
  assert.equal(typed.slice(8).split(" ").map((k) => (k === "space" ? " " : k)).join(""), "claude --resume sess-1");
  assert.ok(!typed.includes("enter"));
  assert.match(lines.join("\n"), /park t1/);
  assert.deepEqual(io.state.t1, { terminal_id: "t1@1", idle_since: NOW - 5 * H, title: "Fix thing", parked: true, cmd: "claude --resume sess-1" });
});

test("runner leaves it alone when the shell is in another folder, and when dry_run", async () => {
  const other = fakeIo([claude("t1")], { shellCwd: "/elsewhere" });
  await run({ ...cfg }, other, NOW);
  assert.ok(!other.calls.some((c) => c.startsWith("send ")));
  const dry = fakeIo([claude("t1")]);
  await run({ ...cfg, dry_run: true }, dry, NOW);
  assert.ok(!dry.calls.some((c) => c.startsWith("send ") || c.startsWith("keys ")));
  assert.deepEqual(dry.state, {});
});

test("runner closes a parked pane only while its screen still holds the resume command", async () => {
  const state = { t1: { terminal_id: "t1@1", idle_since: NOW - 4 * 86400, parked: true, cmd: "claude --resume sess-1", title: "x" } };
  const shell = (screen) => ({ address: "t1", state: "live", created_ms: 1, argv: ["/usr/bin/bash"], labels: {}, foreground: { name: "bash", cwd: "/w" }, screen });
  const a = fakeIo([shell("$ claude --resume sess-1")]);
  a.state = { ...state };
  await run({ ...cfg }, a, NOW);
  assert.ok(a.calls.includes("kill t1") && a.calls.includes("rm t1"));
  assert.deepEqual(a.state, {});
  const b = fakeIo([shell("$ ls")]);
  b.state = { ...state };
  await run({ ...cfg }, b, NOW);
  assert.ok(!b.calls.includes("kill t1")); // touched: forgotten, not closed
});

test("Lease: the newest copy takes over, the holder renews, a stale lease is free", () => {
  const store = {};
  const api = { shared: (k) => store[k] ?? null, setShared: (k, v) => { store[k] = v; } };
  const a = new Lease("k", api, 1000);
  const b = new Lease("k", api, 1000);
  assert.ok(!a.holds() && b.holds());
  assert.ok(a.holds(Date.now() + 5000)); // b stopped renewing
  b.release();
  assert.equal(store.k, null);
});

test("tab-tools: bar hides for a lone tab, tabs move relative, commands parse", () => {
  const cfgT = { hide_bar_when_single_tab: true };
  const lone = { tabs: [{ id: "a", active: true }] };
  const two = { tabs: [{ id: "a" }, { id: "b", active: true }] };
  assert.equal(barCommand(lone, { hidden: false }, cfgT), "layout.hide");
  assert.equal(barCommand(lone, { hidden: true }, cfgT), null);
  assert.equal(barCommand(two, { hidden: true }, cfgT), "layout.show");
  assert.equal(barCommand(lone, { hidden: false }, { hide_bar_when_single_tab: false }), null);
  assert.deepEqual(moveTab(two, -1), { id: "b", index: 1 });
  assert.equal(moveTab(two, 1), null);
  assert.deepEqual(parseCommand("tab_move:-1"), { kind: "move", delta: -1 });
  assert.deepEqual(parseCommand("worktree:open"), { kind: "worktree", action: "open" });
  assert.equal(parseCommand("nope"), null);
  assert.equal(findNode({ id: "r", children: [{ id: "x", children: [{ id: "tabs" }] }] }, "tabs").id, "tabs");
});

// ---- macOS: no /proc, lsof for the shell's folder, a bare launchd PATH
test("parseLsofCwd reads the n field of lsof -F output", () => {
  assert.equal(parseLsofCwd("p4242\nfcwd\nn/Users/dev/my proj\n"), "/Users/dev/my proj");
  assert.equal(parseLsofCwd("p4242\nfcwd\n"), null);
  assert.equal(parseLsofCwd("p4242\nfcwd\nn\n"), null);
  assert.equal(parseLsofCwd(""), null);
});

test("makeCwdOf: /proc where there is one, lsof (also by absolute path) where there is not, null otherwise", async () => {
  const linux = makeCwdOf(async (cmd) => (cmd === "readlink" ? { code: 0, stdout: "/home/u/p\n" } : { code: 1, stdout: "" }));
  assert.equal(await linux(7), "/home/u/p");
  const calls = [];
  const mac = makeCwdOf(async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "readlink") return { code: 1, stdout: "" }; // BSD readlink -f on a path that does not exist
    if (cmd === "lsof") throw new Error("ENOENT"); // launchd PATH has no /usr/sbin
    return { code: 0, stdout: `p${args[3]}\nfcwd\nn/Users/u/p\n` };
  });
  assert.equal(await mac(7), "/Users/u/p");
  assert.deepEqual(calls, ["readlink", "lsof", "/usr/sbin/lsof"]);
  assert.equal(await makeCwdOf(async () => ({ code: 1, stdout: "" }))(7), null);
  assert.equal(await makeCwdOf(async () => { throw new Error("x"); })(7), null);
  assert.equal(await mac(0), null);
});

test("samePath ignores a trailing slash, nothing else", () => {
  assert.ok(samePath("/Users/u/p/", "/Users/u/p"));
  assert.ok(!samePath("/Users/u/p", "/Users/u/q"));
  assert.ok(!samePath(null, null));
});

test("augmentPath puts the folders hc lives in first, once", () => {
  assert.equal(augmentPath("/usr/bin:/bin", ["/Users/u/.local/bin", undefined, "/usr/bin"]), "/Users/u/.local/bin:/usr/bin:/bin");
  assert.equal(augmentPath(undefined, ["/a"]), "/a");
});

test("runner parks a macOS-shaped terminal: zsh under a node-run agent, shell folder found through lsof", async () => {
  const mac = claude("t1", { argv: ["/bin/zsh"], foreground: { name: "node", cwd: "/Users/u/p", pid: 99 }, cwd: "/Users/u/p" });
  const io = fakeIo([mac], { shellCwd: "/Users/u/p/" }); // lsof may add or drop a trailing slash
  const lines = await run({ ...cfg }, io, NOW);
  assert.match(lines.join("\n"), /park t1/);
  assert.ok(io.calls.includes("send t1 /exit"));
});

test("runner does not park when the shell's folder cannot be found at all", async () => {
  const io = fakeIo([claude("t1")]);
  io.cwdOf = async () => null;
  await run({ ...cfg }, io, NOW);
  assert.ok(!io.calls.some((c) => c.startsWith("send ")));
});
