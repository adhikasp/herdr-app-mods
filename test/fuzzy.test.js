import test from "node:test";
import assert from "node:assert/strict";
import { matchText, matchFields, prepare, splitQuery, term } from "../mods/command-bar/fuzzy.js";

test("splitQuery keeps quoted phrases together", () => {
  assert.deepEqual(splitQuery("tri  work"), ["tri", "work"]);
  assert.deepEqual(splitQuery(`"fix login" api`), ["fix login", "api"]);
  assert.deepEqual(splitQuery("   "), []);
});

test("subsequence match, positions point at the matched characters", () => {
  const m = matchText("pilf", "pi-life");
  assert.ok(m);
  assert.deepEqual(m.positions, [0, 1, 3, 5]);
  assert.equal(matchText("xyz", "pi-life"), null);
  assert.equal(matchText("life", ""), null);
});

test("smart case: lowercase ignores case, an uppercase letter is exact", () => {
  assert.ok(matchText("pilife", "PI-Life"));
  assert.equal(matchText("PI", "pi-life"), null);
  assert.ok(matchText("PI", "PI-life"));
});

test("word boundaries and runs beat scattered matches", () => {
  const boundary = matchText("tab", "tab one").score;
  const scattered = matchText("tab", "the amber basket").score;
  assert.ok(boundary > scattered);
  const run = matchText("work", "working").score;
  const gapped = matchText("work", "w-o-r-k").score;
  assert.ok(run > gapped);
});

test("camelCase and digit transitions score as boundaries", () => {
  assert.ok(matchText("ct", "closeTab").score > matchText("ct", "scatter").score);
});

test("repeated needle characters take distinct positions", () => {
  const m = matchText("aa", "banana");
  assert.ok(m);
  assert.equal(new Set(m.positions).size, 2);
  assert.ok(m.positions[0] < m.positions[1]);
});

test("unicode text keeps positions in code points", () => {
  const m = matchText("ab", "✳ ab");
  assert.deepEqual(m.positions, [2, 3]);
});

test("matchFields ANDs terms across fields and weights the title", () => {
  const fields = [
    { prepared: prepare("fix login"), weight: 1 },
    { prepared: prepare("pi-life main"), weight: 0.5 },
  ];
  const hit = matchFields([term("fix"), term("pilf")], fields);
  assert.ok(hit);
  assert.deepEqual(hit.positions[0], [0, 1, 2]);
  assert.deepEqual(hit.positions[1], [0, 1, 3, 5]);
  assert.equal(matchFields([term("fix"), term("zzz")], fields), null);
});

test("empty term matches everything", () => {
  assert.deepEqual(matchText("", "anything"), { score: 0, positions: [] });
});
