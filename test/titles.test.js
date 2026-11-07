import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, cleanTitle, formatTitle, parseEnvKey, parseReply, plan, requestBody, spaceAllowed } from "../mods/tab-titles/titles.js";

const prog = { key: "claude", name: "Claude Code" };
const tab = (id, name, named) => ({ id, name, named });
const agent = (address, tabId, title) => ({ address, tab: tabId, title, program: prog });
const cfg = { ...DEFAULTS, settle_ms: 0 };
const run = (o) => plan({ spaces: [], agents: [], cfg, now: 1000, ...o });

test("cleanTitle and formatTitle", () => {
  assert.equal(cleanTitle("✳ Fix login", prog), "Fix login");
  assert.equal(cleanTitle("Claude Code", prog), "");
  assert.equal(cleanTitle("OC | Rotate keys", null), "Rotate keys");
  assert.equal(formatTitle("  a   b  ", cfg), "a b");
  assert.equal(formatTitle("Fix Login", { ...cfg, lowercase_titles: true }), "fix login");
  assert.equal(Array.from(formatTitle("x".repeat(60), cfg)).length, 40);
  assert.ok(formatTitle("x".repeat(60), cfg).endsWith("…"));
});

test("an unnamed tab takes its agent's task title", () => {
  const r = run({ spaces: [{ id: "s", tabs: [tab("t1", "1", false)] }], agents: [agent("t1", "t1", "✳ Fix login")] });
  assert.deepEqual(r.renames, [{ tabId: "t1", name: "Fix login" }]);
  assert.deepEqual(r.state.t1, { name: "Fix login" });
});

test("nothing to name while the title is generic", () => {
  const r = run({ spaces: [{ id: "s", tabs: [tab("t1", "1", false)] }], agents: [agent("t1", "t1", "Claude Code")] });
  assert.deepEqual(r.renames, []);
});

test("a tab someone named is never touched", () => {
  const r = run({ spaces: [{ id: "s", tabs: [tab("t1", "my work", true)] }], agents: [agent("t1", "t1", "Fix login")] });
  assert.deepEqual(r.renames, []);
  assert.equal(r.state.t1, undefined);
});

test("our name stays pinned to the first title by default", () => {
  const spaces = [{ id: "s", tabs: [tab("t1", "Fix login", true)] }];
  const r = run({ spaces, agents: [agent("t1", "t1", "Something else")], state: { t1: { name: "Fix login" } } });
  assert.deepEqual(r.renames, []);
});

test("follow_new_sessions retitles our own name, and only ours", () => {
  const spaces = [{ id: "s", tabs: [tab("t1", "Fix login", true)] }];
  const c = { ...cfg, follow_new_sessions: true };
  const r = run({ spaces, cfg: c, agents: [agent("t1", "t1", "New task")], state: { t1: { name: "Fix login" } } });
  assert.deepEqual(r.renames, [{ tabId: "t1", name: "New task" }]);
  const theirs = run({ spaces: [{ id: "s", tabs: [tab("t1", "Mine now", true)] }], cfg: c, agents: [agent("t1", "t1", "New task")], state: { t1: { name: "Fix login" } } });
  assert.deepEqual(theirs.renames, []);
  assert.equal(theirs.state.t1.yielded, true, "a changed name means it was renamed under us");
});

test("a yielded tab stays theirs until the name is cleared", () => {
  const c = { ...cfg, follow_new_sessions: true };
  const state = { t1: { name: "Fix login", yielded: true } };
  const still = run({ spaces: [{ id: "s", tabs: [tab("t1", "Mine", true)] }], cfg: c, agents: [agent("t1", "t1", "Task")], state });
  assert.deepEqual(still.renames, []);
  const cleared = run({ spaces: [{ id: "s", tabs: [tab("t1", "1", false)] }], cfg: c, agents: [agent("t1", "t1", "Task")], state });
  assert.deepEqual(cleared.renames, [{ tabId: "t1", name: "Task" }]);
  assert.equal(cleared.state.t1.yielded, undefined);
});

test("a title must hold still for settle_ms before it is written", () => {
  const c = { ...cfg, settle_ms: 3000 };
  const spaces = [{ id: "s", tabs: [tab("t1", "1", false)] }];
  const a = run({ spaces, cfg: c, agents: [agent("t1", "t1", "Fix")], now: 1000 });
  assert.deepEqual(a.renames, []);
  assert.equal(a.wake, 3000);
  const b = run({ spaces, cfg: c, agents: [agent("t1", "t1", "Fix login")], seen: a.seen, now: 2000 });
  assert.deepEqual(b.renames, [], "a changed title restarts the clock");
  const d = run({ spaces, cfg: c, agents: [agent("t1", "t1", "Fix login")], seen: b.seen, now: 5200 });
  assert.deepEqual(d.renames, [{ tabId: "t1", name: "Fix login" }]);
});

test("multi-agent tabs are left alone unless multi_agent_titles is on", () => {
  const spaces = [{ id: "s", tabs: [tab("t1", "1", false)] }];
  const agents = [agent("a", "t1", "Fix login"), agent("b", "t1", "Write docs")];
  assert.deepEqual(run({ spaces, agents }).llm, []);
  const r = run({ spaces, agents, cfg: { ...cfg, multi_agent_titles: true } });
  assert.equal(r.llm.length, 1);
  assert.deepEqual(r.llm[0].titles, ["Fix login", "Write docs"]);
  const again = run({ spaces, agents, cfg: { ...cfg, multi_agent_titles: true }, state: { t1: { name: "Docs and login", key: r.llm[0].key } } });
  assert.deepEqual(again.llm, [], "the request repeats only when the titles change");
  const backoff = run({ spaces, agents, cfg: { ...cfg, multi_agent_titles: true }, failUntil: { t1: 5000 } });
  assert.deepEqual(backoff.llm, []);
});

test("state forgets tabs that are gone", () => {
  const r = run({ spaces: [{ id: "s", tabs: [tab("t2", "1", false)] }], state: { t1: { name: "x" } } });
  assert.equal(r.state.t1, undefined);
});

test("requestBody and parseReply", () => {
  const b = requestBody("m/x", ["a b", 'c "d"']);
  assert.equal(b.model, "m/x");
  assert.equal(b.messages[1].content, 'Session titles:\n- a b\n- c "d"\n');
  assert.equal(parseReply('{"choices":[{"message":{"content":"\\n\\"World Clock Tab Fix.\\"\\nextra"}}]}'), "World Clock Tab Fix");
  assert.equal(parseReply('{"error":{"message":"no"}}'), null);
  assert.equal(parseReply('{"choices":[{"message":{"content":""}}]}'), null);
  assert.equal(parseReply("not json"), null);
});

test("parseEnvKey takes the last matching line and strips quotes", () => {
  assert.equal(parseEnvKey("A=1\nexport KEY='old'\nKEY=\"sk-test\"\n", "KEY"), "sk-test");
  assert.equal(parseEnvKey("OTHER=1", "KEY"), null);
  assert.equal(parseEnvKey("KEY=\n", "KEY"), null);
});

test("only_spaces and exclude_spaces scope what is managed", () => {
  const spaces = [
    { id: "a", name: "telegram - ops", tabs: [tab("t1", "1", false)] },
    { id: "b", name: "api", tabs: [tab("t2", "1", false)] },
  ];
  const agents = [agent("x", "t1", "Fix"), agent("y", "t2", "Docs")];
  const ex = run({ spaces, agents, cfg: { ...cfg, exclude_spaces: ["^telegram"] } });
  assert.deepEqual(ex.renames.map((r) => r.tabId), ["t2"]);
  const only = run({ spaces, agents, cfg: { ...cfg, only_spaces: ["^telegram"] } });
  assert.deepEqual(only.renames.map((r) => r.tabId), ["t1"]);
  assert.equal(spaceAllowed("x", { only_spaces: ["("] }), false, "a bad regex matches nothing");
  assert.equal(spaceAllowed("x", {}), true);
});

test("a title that is just the terminal's address is not a task title", () => {
  const spaces = [{ id: "s", tabs: [tab("t1", "1", false)] }];
  assert.deepEqual(run({ spaces, agents: [agent("t1z", "t1", "t1z")] }).renames, []);
  assert.deepEqual(run({ spaces, agents: [agent("box/t7", "t1", "t7")] }).renames, []);
  const multi = run({ spaces, agents: [agent("a", "t1", "Fix login"), agent("t1z", "t1", "t1z")], cfg: { ...cfg, multi_agent_titles: true } });
  assert.deepEqual(multi.llm, [], "one real title is not enough to ask the model");
});

test("the model is asked only after the titles hold still", () => {
  const c = { ...cfg, multi_agent_titles: true, settle_ms: 3000 };
  const spaces = [{ id: "s", tabs: [tab("t1", "1", false)] }];
  const agents = [agent("a", "t1", "Fix login"), agent("b", "t1", "Write docs")];
  const first = run({ spaces, agents, cfg: c, now: 1000 });
  assert.deepEqual(first.llm, []);
  const later = run({ spaces, agents, cfg: c, seen: first.seen, now: 4200 });
  assert.equal(later.llm.length, 1);
});
