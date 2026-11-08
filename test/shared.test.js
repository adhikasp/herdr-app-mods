import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

// Mods cannot import across folders, so shared/*.js is copied into each mod. A copy must equal its source.
test("every copy of a shared file equals shared/", () => {
  const shared = readdirSync(join(root, "shared")).filter((f) => f.endsWith(".js"));
  let copies = 0;
  for (const mod of readdirSync(join(root, "mods"))) {
    for (const f of shared) {
      const copy = join(root, "mods", mod, f);
      if (!existsSync(copy)) continue;
      copies++;
      assert.equal(readFileSync(copy, "utf8"), readFileSync(join(root, "shared", f), "utf8"), `mods/${mod}/${f} drifted: run scripts/sync-shared`);
    }
  }
  assert.ok(copies > 0);
});
