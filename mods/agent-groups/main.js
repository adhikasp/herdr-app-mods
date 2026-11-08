// Agent groups: every agent under Needs you / Working / Done / Idle, newest change
// first in each group, with how long ago it changed. Open it with
// `"ctrl-alt-a": "mod.open:agent-groups"` in keys.json.
//
//   j/k, up/down   move          g / G   first / last
//   enter, click   focus the agent and close
//   p              pin or unpin the selected agent (pins lead their group)
//   esc, q         close
//
// The shipped `agents` mod (the sidebar list) already offers a priority view; this
// is the same idea as a keyboard-first popup, sorted by when each agent last changed.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { agents, closeOverlay, hc, props, run, spaces, terminals, theme } from "herdr";
import { ago, build, rows as flatten } from "./groups.js";

const HEAD = 30;
const ROW = 46;
const LIST_MAX = 460;

function icon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

export default class AgentGroups extends View {
  init(_props, cx) {
    this.selId = null;
    this.at = 0;
    this.items = [];
    this.since = {}; // address -> {status, ms}: when core says the status last changed
    this.fetching = false;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());
    // "5m" must keep counting while the list is open.
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // terminals() does not always carry `status_ms`; ask core for the agents it lacks.
  fetchSince(list, cx) {
    this.fetching = true;
    cx.spawn(async (cx) => {
      for (const a of list) {
        try {
          const r = await hc(["get", a.address, "--json"]);
          const ms = r.code === 0 ? JSON.parse(r.stdout).status_ms : null;
          this.since[a.address] = { status: a.status, ms: ms ?? null };
        } catch {
          this.since[a.address] = { status: a.status, ms: null };
        }
      }
      this.fetching = false;
      cx.notify();
    });
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  go(item) {
    if (!item) return;
    run("agent.focus", { terminal: item.address });
    this.close();
  }

  select(i, cx) {
    this.at = Math.max(0, Math.min(this.items.length - 1, i));
    this.selId = this.items[this.at]?.id ?? null;
    const row = this.rowIndex.get(this.selId);
    if (row != null) this.scroll.scroll_to_item(row);
    cx.notify();
  }

  key(e, cx) {
    const k = e.key;
    const m = e.modifiers;
    const stop = () => cx.stop_propagation();
    const ch = e.key_char ?? "";
    if (k === "escape" || (!m.control && ch === "q")) return stop(), this.close();
    if (k === "down" || ch === "j" || (m.control && (k === "n" || k === "j"))) return stop(), this.select(this.at + 1, cx);
    if (k === "up" || ch === "k" || (m.control && (k === "p" || k === "k"))) return stop(), this.select(this.at - 1, cx);
    if (k === "pagedown") return stop(), this.select(this.at + 6, cx);
    if (k === "pageup") return stop(), this.select(this.at - 6, cx);
    if (ch === "g") return stop(), this.select(0, cx);
    if (ch === "G") return stop(), this.select(this.items.length - 1, cx);
    if (k === "enter") return stop(), this.go(this.items[this.at]);
    if (ch === "p" && !m.control) {
      const it = this.items[this.at];
      if (it) run("terminal.pin", { terminal: it.address, pinned: !it.pinned });
      return stop();
    }
  }

  statusGlyph(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(13).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (status === "done") return div().size(8).mx(3).flex_none().rounded(4).bg(t.done);
    return div().size(8).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  rowEl(t, r, on, now) {
    if (r.header) {
      return h_flex().h(HEAD).px(14).pt(10).gap(6).items_center().text_size(11).font_semibold()
        .child(div().text_color(t[r.status] ?? t.dim).child(r.label))
        .child(div().text_color(t.dim).child(String(r.count)));
    }
    const pic = icon(r.program, 16, t.foreground);
    const urgent = r.status === "blocked" || r.status === "done";
    return h_flex().h(ROW).mx(4).px(10).gap(10).items_center().rounded(8)
      .when(on, (el) => el.bg(t.hover))
      .child(this.statusGlyph(t, r.status))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(
        v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(13).text_color(r.status === "idle" ? t.muted : t.foreground).when(urgent, (d) => d.font_semibold()).child(r.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(r.sub)),
      )
      .when(r.pinned, (el) => el.child(div().flex_none().px(5).h(16).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).flex().items_center().child("pinned")))
      .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(r.machine)))
      .child(div().flex_none().w(34).text_right().text_size(11).text_color(t.dim).child(ago(r.at, now)));
  }

  render(cx) {
    const t = theme();
    const list = agents();
    const known = terminals().map((x) => ({ address: x.address, status_ms: x.status_ms ?? this.since[x.address]?.ms ?? null }));
    const lacking = list.filter((a) => !known.find((x) => x.address === a.address)?.status_ms && this.since[a.address]?.status !== a.status);
    if (lacking.length && !this.fetching) this.fetchSince(lacking, cx);
    const groups = build({ agents: list, terminals: known, spaces: spaces() });
    const rows = flatten(groups);
    this.items = rows.filter((r) => !r.header);
    this.rowIndex = new Map(rows.map((r, i) => [r.id, i]));
    // Keep the selection on the same agent when the list reorders under it.
    const at = this.selId ? this.items.findIndex((i) => i.id === this.selId) : -1;
    this.at = at >= 0 ? at : Math.max(0, Math.min(this.at, this.items.length - 1));
    this.selId = this.items[this.at]?.id ?? null;
    const sizes = rows.map((r) => (r.header ? HEAD : ROW));
    const total = sizes.reduce((a, b) => a + b, 0);
    const now = Date.now();
    const waiting = groups.find((g) => g.status === "blocked")?.items.length ?? 0;

    return v_flex()
      .id("agent-groups")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Agents"))
          .when(waiting > 0, (el) => el.child(div().mr(10).text_size(11).text_color(t.blocked).child(`${waiting} need${waiting === 1 ? "s" : ""} you`)))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        rows.length === 0
          ? div().h(60).flex().items_center().text_color(t.dim).child("No agent has reported a status yet.")
          : v_flex().relative().h(Math.min(LIST_MAX, total)).flex_none().child(
              v_virtual_list(
                "ag-list", rows.length, sizes, (i) => rows[i].id,
                (range) => rows.slice(range.start, range.end).map((r, k) => this.rowEl(t, r, !r.header && r.id === this.selId, now)),
              )
                .track_scroll(this.scroll)
                .size_full()
                .on_item_click((key) => {
                  const it = this.items.find((i) => i.id === key);
                  if (it) this.go(it);
                }),
            ),
      )
      .child(div().h(16).text_size(11).text_color(t.dim).child("j/k move · enter focus · p pin · esc close"));
  }
}
