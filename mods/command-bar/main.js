// Command bar: one fuzzy search over spaces, tabs, agents, named terminals,
// machines and every app command (with its key). Open it with
// `"alt-o": "mod.open:command-bar"` in keys.json.
//
//   type          fuzzy search; space separates terms, all must match
//   s a t p m c   (then space or colon) keep the search to spaces / agents / tabs /
//                 panes / machines / commands: `s web`, `a:claude`
//   > or :        the command palette, with each command's key
//   @ % !         agents / panes / only what needs you
//   up/down       move (also ctrl+n/p, ctrl+j/k); tab / shift+tab cycles the kind
//   enter         go; esc closes
//   ctrl+d twice  close the selected row's tab; ctrl+r renames it
//
// Modal mode ({"modal": true} in config/command-bar.json): the list opens in
// "list" mode, j/k move, g/G jump, "/" starts a search, ">" the palette, and any
// other character starts the search with itself; esc leaves the search, then closes.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import {
  agents, appHome, closeOverlay, commands, focused, keys, layouts, machines, panes, props, readTextFile,
  run, setShared, shared, spaces, terminals, theme, themes,
} from "herdr";
import { KIND_CYCLE, KIND_LABEL, buildItems, search } from "./items.js";

const DEFAULTS = { modal: false, scope: "all", mru: 30 };
const ROW = 30;
const LIST_MAX = 420;
const GLYPH = { space: "#", tab: "$", pane: "%", command: ">", machine: "@", agent: "●" };

function icon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

/** Split text into runs of matched and unmatched characters. */
function runs(text, positions) {
  const chars = Array.from(text);
  const hit = new Set(positions ?? []);
  const out = [];
  chars.forEach((c, i) => {
    const on = hit.has(i);
    const last = out[out.length - 1];
    if (last && last.on === on) last.text += c;
    else out.push({ text: c, on });
  });
  return out;
}

export default class CommandBar extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.cfg = { ...DEFAULTS, ...(p.config ?? {}) };
    this.commands = commands();
    this.keys = keys();
    this.layouts = layouts();
    this.themes = themes();
    this.filter = typeof p.query === "string" ? p.query : "";
    this.kind = p.kind && p.kind !== "all" ? p.kind : null;
    this.mode = "search";
    this.at = 0;
    this.selId = null;
    this.arm = null;
    this.rows = [];
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search spaces, tabs, agents, commands…", value: this.filter });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.arm = null;
      this.selId = null;
      this.at = 0;
      this.scroll.scroll_to_item(0);
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.rows[this.at]));
    this.input.on("focus", (_e, cx) => {
      this.mode = "search";
      cx.notify();
    });
    this.input.focus();
    cx.timer.after(600, () => (this.mode === "search" ? this.input.focus() : this.handle.focus()));
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/config/command-bar.json`);
        if (text) this.cfg = { ...this.cfg, ...JSON.parse(text), ...(p.config ?? {}) };
      } catch (e) {
        console.log("command-bar: bad config/command-bar.json:", String(e));
      }
      if (!this.kind && this.cfg.scope && this.cfg.scope !== "all") this.kind = this.cfg.scope;
      if (this.cfg.modal && !this.filter && p.mode !== "search") this.leaveSearch(cx);
      cx.notify();
    });
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  leaveSearch(cx) {
    this.mode = "list";
    this.input.set_value("");
    this.filter = "";
    this.selId = null;
    this.at = 0;
    this.handle.focus();
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  startSearch(text, cx) {
    this.mode = "search";
    this.input.set_value(text);
    this.filter = text;
    this.selId = null;
    this.at = 0;
    this.input.focus();
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  remember(id) {
    const keep = Math.max(1, Number(this.cfg.mru) || 30);
    const old = (shared("command-bar.mru") ?? []).filter((x) => x !== id);
    setShared("command-bar.mru", [id, ...old].slice(0, keep));
  }

  go(row) {
    if (!row) return;
    const { action, id } = row.item;
    this.remember(id);
    run(action.name, action.args ?? {});
    this.close();
  }

  select(i, cx) {
    this.at = Math.max(0, Math.min(this.rows.length - 1, i));
    this.selId = this.rows[this.at]?.item.id ?? null;
    this.scroll.scroll_to_item(this.at);
    cx.notify();
  }

  cycleKind(dir, cx) {
    const now = this.result?.kind && KIND_CYCLE.includes(this.result.kind) ? this.result.kind : "all";
    const i = KIND_CYCLE.indexOf(this.kind ?? now);
    const next = KIND_CYCLE[(i + dir + KIND_CYCLE.length) % KIND_CYCLE.length];
    this.kind = next === "all" ? null : next;
    this.selId = null;
    this.at = 0;
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  key(e, cx) {
    const k = e.key;
    const m = e.modifiers;
    const stop = () => cx.stop_propagation();
    if (k !== "d" || !m.control) this.arm = null;
    if (k === "escape") {
      stop();
      if (this.cfg.modal && this.mode === "search") this.leaveSearch(cx);
      else this.close();
      return;
    }
    if (k === "down" || (m.control && (k === "n" || k === "j"))) return stop(), this.select(this.at + 1, cx);
    if (k === "up" || (m.control && (k === "p" || k === "k"))) return stop(), this.select(this.at - 1, cx);
    if (k === "pagedown") return stop(), this.select(this.at + 8, cx);
    if (k === "pageup") return stop(), this.select(this.at - 8, cx);
    if (k === "tab") return stop(), this.cycleKind(m.shift ? -1 : 1, cx);
    if (k === "enter" && this.mode === "list") return stop(), this.go(this.rows[this.at]);
    const item = this.rows[this.at]?.item;
    if (m.control && k === "d" && item?.tabId) {
      stop();
      if (this.arm === item.tabId) {
        this.arm = null;
        run("tab.close", { id: item.tabId, confirmed: true });
      } else {
        this.arm = item.tabId;
      }
      cx.notify();
      return;
    }
    if (m.control && k === "r" && item?.tabId) {
      stop();
      run("tab.rename", { id: item.tabId });
      return;
    }
    if (this.mode === "list" && !m.control && !m.alt && !m.platform) {
      const ch = e.key_char ?? "";
      if (ch === "j") return stop(), this.select(this.at + 1, cx);
      if (ch === "k") return stop(), this.select(this.at - 1, cx);
      if (ch === "g") return stop(), this.select(0, cx);
      if (ch === "G") return stop(), this.select(this.rows.length - 1, cx);
      if (ch === "/") return stop(), this.startSearch("", cx);
      if (ch && ch >= " " && ch !== "\u007f") return stop(), this.startSearch(ch, cx);
    }
  }

  statusGlyph(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    const glyph = status === "blocked" ? "◉" : status === "done" ? "●" : "";
    return div().w(12).flex_none().text_color(t[status] ?? t.dim).child(glyph);
  }

  rowEl(t, r, on) {
    const it = r.item;
    const lead = icon(it.program, 15, t.foreground) ?? div().text_color(t.dim).child(GLYPH[it.kind] ?? "");
    const title = h_flex().flex_none().whitespace_nowrap().children(
      runs(it.title, r.positions[0]).map((s) => div().text_color(s.on ? t.accent : t.foreground).when(s.on, (d) => d.font_bold()).child(s.text)),
    );
    const summary = it.summary
      ? h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().ml(8).children(
          runs(it.summary, r.positions[1]).map((s) => div().text_color(s.on ? t.accent : t.dim).when(s.on, (d) => d.font_semibold()).child(s.text)),
        )
      : div().flex_1();
    return h_flex()
      .h(ROW)
      .mx(4)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(7)
      .when(on, (el) => el.bg(t.hover))
      .child(h_flex().w(16).flex_none().justify_center().child(lead))
      .child(this.statusGlyph(t, it.status))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().items_center().child(title).child(summary))
      .when(Boolean(it.detail), (el) => el.child(div().flex_none().max_w(220).truncate().text_size(11).text_color(t.dim).child(it.detail)));
  }

  render(cx) {
    const t = theme();
    const items = buildItems({
      spaces: spaces(), agents: agents(), terminals: terminals(), panes: panes(), machines: machines(),
      focused: focused(), commands: this.commands, keys: this.keys, layouts: this.layouts, themes: this.themes,
    });
    const mru = shared("command-bar.mru") ?? [];
    this.result = search(items, this.filter, { mru, kind: this.kind });
    const rows = (this.rows = this.result.rows);
    // Keep the selection on the same row when live data reorders the list.
    const at = this.selId ? rows.findIndex((r) => r.item.id === this.selId) : -1;
    this.at = at >= 0 ? at : Math.max(0, Math.min(this.at, rows.length - 1));
    this.selId = rows[this.at]?.item.id ?? null;
    const sel = rows[this.at]?.item;
    const chip = KIND_LABEL[this.result.kind] ?? this.result.kind;
    const height = Math.min(LIST_MAX, Math.max(ROW, rows.length * ROW));
    const hint = this.arm
      ? null
      : this.mode === "list"
        ? "j/k move · / search · > commands · enter go · esc close"
        : "enter go · tab filter · ctrl+d close tab · esc close";

    return v_flex()
      .id("command-bar")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1()
          .border_color(this.mode === "search" ? t.accent : t.input).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
          .child(
            div().flex_none().px(8).h(20).rounded(5).bg(t.raised).text_size(11).text_color(this.result.kind === "all" ? t.dim : t.foreground)
              .flex().items_center().child(chip + (this.result.widened ? " (widened)" : "")),
          ),
      )
      .child(
        rows.length === 0
          ? div().h(ROW * 2).px(10).flex().items_center().text_color(t.dim).child(`No ${chip === "everything" ? "match" : chip} match “${this.result.rest}”`)
          : v_flex().relative().h(height).flex_none().child(
              v_virtual_list(
                "cb-list", rows.length, ROW, (i) => rows[i].item.id,
                (range) => rows.slice(range.start, range.end).map((r, k) => this.rowEl(t, r, range.start + k === this.at)),
              )
                .track_scroll(this.scroll)
                .size_full()
                .on_item_click((key, cx) => {
                  const i = this.rows.findIndex((r) => r.item.id === key);
                  if (i >= 0) this.go(this.rows[i]);
                }),
            ),
      )
      .child(
        h_flex().h(18).items_center().text_size(11).text_color(t.dim)
          .when(Boolean(this.arm), (el) => el.child(div().text_color(t.blocked).child(`ctrl+d again to close tab “${sel?.title ?? ""}”`)))
          .when(Boolean(hint), (el) => el.child(hint))
          .child(div().flex_1())
          .child(`${rows.length} result${rows.length === 1 ? "" : "s"}`),
      );
  }
}
