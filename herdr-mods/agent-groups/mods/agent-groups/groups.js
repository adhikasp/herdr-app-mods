// How agent-groups sorts agents into groups. Pure, no host imports.
//
// The app already knows what the TUI plugin had to track by hand: "done" turns
// "idle" once someone looks at it, on any window. So the groups are simply the
// agent's status; within each group the agent that changed most recently is first.

export const GROUPS = [
  { status: "blocked", label: "Needs you" },
  { status: "working", label: "Working" },
  { status: "done", label: "Done" },
  { status: "idle", label: "Idle" },
];

const GENERIC = new Set(["", "claude", "claude code", "codex", "opencode", "shell", "bash", "zsh", "fish", "sh"]);

/** A terminal title worth showing: no status glyph, vendor prefix, folder suffix or path. */
export function cleanTitle(raw, program) {
  const text = String(raw ?? "").trim();
  if (/^[~/]|^[A-Za-z]:\\/.test(text) || /^\S+@\S+/.test(text)) return "";
  let s = text.replace(/^OC \| /, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  s = s.replace(/\s+\|\s+[\w.@~/-]+$/, "").trim();
  const l = s.toLowerCase();
  if (GENERIC.has(l) || l === program?.name?.toLowerCase() || l === program?.key) return "";
  return s;
}

/** "now", "5m", "2h", "3d" for a time in ms since the epoch. Empty when unknown. */
export function ago(at, now = Date.now()) {
  if (!at) return "";
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Groups for the list: `[{status, label, items: [{id, address, title, sub, status, at, program, pinned, machine}]}]`,
 * empty groups left out, each sorted newest change first (pinned agents lead their group).
 * `terminals` supplies `status_ms` (when the status last changed).
 */
export function build({ agents = [], terminals = [], spaces = [] }) {
  const since = new Map(terminals.map((t) => [t.address, t.status_ms ?? null]));
  const tabs = new Map(spaces.flatMap((s) => s.tabs.map((t) => [t.id, t])));
  const items = agents.map((a) => {
    const tab = tabs.get(a.tab);
    const live = a.title === a.address ? "" : cleanTitle(a.title, a.program);
    const named = tab?.named ? tab.name : "";
    const slash = a.address.indexOf("/");
    return {
      id: `a:${a.address}`,
      address: a.address,
      title: named || live || a.program?.name || "agent",
      sub: [a.space_name, named && live && live !== named ? live : "", a.program?.name].filter(Boolean).join(" · "),
      status: a.status,
      at: since.get(a.address) ?? null,
      seq: a.seq ?? 0,
      program: a.program,
      pinned: Boolean(a.pinned),
      machine: slash > 0 ? a.address.slice(0, slash) : "",
      focused: Boolean(a.focused),
    };
  });
  return GROUPS.map((g) => ({
    ...g,
    items: items
      .filter((i) => i.status === g.status)
      .sort((x, y) => Number(y.pinned) - Number(x.pinned) || (y.at ?? 0) - (x.at ?? 0) || y.seq - x.seq),
  })).filter((g) => g.items.length);
}

/** Flatten groups to the rows a list draws: headers and items. */
export function rows(groups) {
  return groups.flatMap((g) => [{ id: `h:${g.status}`, header: true, label: g.label, status: g.status, count: g.items.length }, ...g.items]);
}
