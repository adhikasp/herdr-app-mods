// What tab-tools decides, with no host imports so `node --test` runs it.

export const DEFAULTS = {
  // Hide the tab bar while the shown space has a single tab.
  hide_bar_when_single_tab: false,
  // The layout node id of the tab bar (the shipped layouts call it "tabs").
  tab_bar_id: "tabs",
};

/** The layout node with this id, or null. */
export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** "layout.hide" / "layout.show" when the bar's visibility is wrong for the space, else null. */
export function barCommand(space, bar, cfg) {
  if (!cfg.hide_bar_when_single_tab || !space || !bar) return null;
  const lone = (space.tabs?.length ?? 0) <= 1;
  return Boolean(bar.hidden) !== lone ? (lone ? "layout.hide" : "layout.show") : null;
}

/** `{id, index}` (1-based) to move the active tab by `delta`, or null at an end. */
export function moveTab(space, delta) {
  const at = space?.tabs?.findIndex((t) => t.active) ?? -1;
  const to = at + delta;
  if (at < 0 || to < 0 || to >= space.tabs.length) return null;
  return { id: space.tabs[at].id, index: to + 1 };
}

/** What a key command asks for: `tab_move:-1`, `tab_move:1`, `worktree:new`, `worktree:open`. */
export function parseCommand(c) {
  const move = /^tab_move:(-?\d+)$/.exec(c);
  if (move) return { kind: "move", delta: Number(move[1]) };
  const tree = /^worktree:(new|open)$/.exec(c);
  if (tree) return { kind: "worktree", action: tree[1] };
  return null;
}
