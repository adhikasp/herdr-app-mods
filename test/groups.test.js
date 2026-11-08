import test from "node:test";
import assert from "node:assert/strict";
import { GROUPS, ago, build, cleanTitle, rows } from "../herdr-mods/agent-groups/mods/agent-groups/groups.js";

const prog = { key: "claude", name: "Claude Code", icon: null };
const agent = (address, tab, status, title, extra = {}) => ({ address, tab, space_name: "api", status, title, seq: 1, program: prog, pinned: false, focused: false, ...extra });
const spaces = [{ tabs: [{ id: "t1", name: "fix login", named: true }, { id: "t2", name: "2", named: false }] }];

test("ago", () => {
  const now = 10_000_000;
  assert.equal(ago(null, now), "");
  assert.equal(ago(now - 30_000, now), "now");
  assert.equal(ago(now - 5 * 60_000, now), "5m");
  assert.equal(ago(now - 2 * 3600_000, now), "2h");
  assert.equal(ago(now - 3 * 86400_000, now), "3d");
});

test("cleanTitle", () => {
  assert.equal(cleanTitle("✳ Fix login", prog), "Fix login");
  assert.equal(cleanTitle("Claude Code", prog), "");
  assert.equal(cleanTitle("~/Workspace/x", prog), "");
});

test("groups follow status order and skip empty ones", () => {
  const g = build({ agents: [agent("a", "t1", "idle", "x"), agent("b", "t2", "blocked", "y")], spaces });
  assert.deepEqual(g.map((x) => x.status), ["blocked", "idle"]);
  assert.deepEqual(GROUPS.map((x) => x.label), ["Needs you", "Working", "Done", "Idle"]);
});

test("newest change first within a group; pinned agents lead", () => {
  const terminals = [{ address: "a", status_ms: 100 }, { address: "b", status_ms: 300 }, { address: "c", status_ms: 200 }];
  const agents = [agent("a", "t1", "working", "a"), agent("b", "t1", "working", "b"), agent("c", "t1", "working", "c", { pinned: true })];
  const g = build({ agents, terminals, spaces });
  assert.deepEqual(g[0].items.map((i) => i.address), ["c", "b", "a"]);
});

test("titles: a named tab wins, else the cleaned terminal title, else the program", () => {
  const g = build({
    agents: [agent("a", "t1", "idle", "✳ Rotate keys"), agent("b", "t2", "idle", "✳ Write docs"), agent("c", "t2", "idle", "Claude Code"), agent("t9", "t2", "idle", "t9")],
    spaces,
  });
  const by = Object.fromEntries(g[0].items.map((i) => [i.address, i]));
  assert.equal(by.a.title, "fix login");
  assert.equal(by.a.sub, "api · Rotate keys · Claude Code");
  assert.equal(by.b.title, "Write docs");
  assert.equal(by.c.title, "Claude Code");
  assert.equal(by.t9.title, "Claude Code", "an unset title reads as the address");
});

test("rows interleave headers and items", () => {
  const r = rows(build({ agents: [agent("a", "t1", "done", "x"), agent("b", "t1", "done", "y")], spaces }));
  assert.equal(r.length, 3);
  assert.equal(r[0].header, true);
  assert.equal(r[0].count, 2);
});

test("a machine address names its machine", () => {
  const g = build({ agents: [agent("box/t7", "t1", "idle", "x")], spaces });
  assert.equal(g[0].items[0].machine, "box");
});
