// Tab titles: names tabs nobody named after their agent's task title, so every
// list (the tab bar, the sidebar, the command bar) shows the work instead of
// "3". It never touches a tab someone named, and gives one up for good the
// moment someone renames a tab it named.
//
// It must stay alive to work, so put it in your layout where it takes no room:
//
//   "floating": [{ "id": "tab-titles", "content": { "mod": "tab-titles" }, "edge": "bottom", "align": "end" }]
//
// (on any node; it renders nothing while floating). Or as a 1 px block:
//
//   { "id": "tab-titles", "type": "block", "size": { "px": 1 }, "content": { "mod": "tab-titles" } }
//
// Given a real pane or tab it shows what it has done, which is how to check it.
// Settings: config/tab-titles.json in the app home (see README).
//
// Only one copy acts at a time: copies share a lease through shared state.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { agents, appHome, exec, home, placement, props, readTextFile, run, setShared, shared, spaces, theme } from "herdr";
import { configPath, mergeConfig } from "./config.js";
import { Lease } from "./lease.js";
import { complete, describe } from "./llm.js";
import { DEFAULTS, nameFromContent, plan, requestBody } from "./titles.js";

const STATE = "tab-titles.state";
const BEAT_MS = 20000;
const POLL_MS = 5000;

export default class TabTitles extends View {
  init(_props, cx) {
    this.cfg = { ...DEFAULTS };
    this.ready = false; // nothing is renamed before the config is read
    this.seen = {};
    this.failUntil = {};
    this.asking = new Set();
    this.wakeAt = 0;
    this.log = [];
    this.lease = new Lease("tab-titles.lease", { shared, setShared }); // the newest copy takes over
    cx.timer.every(BEAT_MS, () => this.lease.beat());
    // A copy that is not on screen is not re-rendered when agents change, but its
    // timers keep running: this slow tick is what keeps a hidden copy working.
    // On screen (a floating or 1 px block) render does the work on every change.
    cx.timer.every(POLL_MS, (cx) => this.evaluate(cx));
    cx.spawn(async (cx) => {
      // defaults < config/tab-titles.json < props.config (a layout block's props scopes one copy)
      let text = null;
      try {
        text = await readTextFile(configPath(appHome(), "tab-titles", await this.envVar("HERDR_MODS_CONFIG_DIR")));
      } catch {} // no file is fine
      const { cfg, error } = mergeConfig(DEFAULTS, text, props());
      if (error) console.log("tab-titles: config/tab-titles.json ignored:", error);
      this.cfg = cfg;
      this.ready = true;
      cx.notify();
    });
  }

  close() {
    this.lease.release();
  }

  note(text) {
    this.log = [{ at: Date.now(), text }, ...this.log].slice(0, 12);
  }

  async envVar(name) {
    try {
      const r = await exec("printenv", [name]);
      return r.code === 0 ? r.stdout.trim() || null : null;
    } catch {
      return null;
    }
  }

  // The model's name for a tab holding several agents. One request, titles only, to any
  // OpenAI-compatible endpoint (see llm.js for the llm_* settings).
  async nameFromModel(titles, cx) {
    // mods have no setTimeout: a cx.timer stands in for it
    const sleep = (ms) => new Promise((resolve) => cx.timer.after(ms, resolve));
    const io = { env: (n) => this.envVar(n), read: (p) => readTextFile(p), home: home(), sleep };
    const reply = await complete(this.cfg, io, requestBody(this.cfg.llm_model, titles));
    const name = nameFromContent(reply);
    if (!name) throw new Error("model reply had no name");
    return name;
  }

  apply(p, cx) {
    this.seen = p.seen;
    const before = JSON.stringify(shared(STATE) ?? {});
    const after = JSON.stringify(p.state);
    if (p.wake != null && (this.wakeAt === 0 || Date.now() + p.wake < this.wakeAt)) {
      this.wakeAt = Date.now() + p.wake;
      cx.timer.after(p.wake + 50, (cx) => {
        this.wakeAt = 0;
        cx.notify();
      });
    }
    const asks = p.llm.filter((a) => !this.asking.has(a.tabId));
    if (before === after && !p.renames.length && !asks.length) return;
    cx.spawn(async (cx) => {
      // The state first: when the rename lands the next render must see the name as ours.
      if (before !== after) setShared(STATE, p.state);
      for (const r of p.renames) {
        try {
          run("tab.rename", { id: r.tabId, name: r.name });
          this.note(`named ${r.tabId} “${r.name}”`);
        } catch (e) {
          this.note(`rename failed: ${String(e)}`);
        }
      }
      for (const a of asks) {
        this.asking.add(a.tabId);
        try {
          const name = await this.nameFromModel(a.titles, cx);
          const state = { ...(shared(STATE) ?? {}), [a.tabId]: { name, key: a.key } };
          setShared(STATE, state);
          run("tab.rename", { id: a.tabId, name });
          this.note(`named ${a.tabId} “${name}” from ${a.titles.length} agents`);
        } catch (e) {
          this.failUntil[a.tabId] = Date.now() + this.cfg.llm_retry_ms;
          this.note(`model naming failed: ${String(e)}`);
        }
        this.asking.delete(a.tabId);
      }
      cx.notify();
    });
  }

  evaluate(cx) {
    if (!this.ready || !this.cfg.enabled || !this.lease.holds()) return;
    this.apply(
      plan({ spaces: spaces(), agents: agents(), state: shared(STATE) ?? {}, seen: this.seen, cfg: this.cfg, now: Date.now(), failUntil: this.failUntil }),
      cx,
    );
  }

  render(cx) {
    const t = theme();
    this.evaluate(cx);
    if (placement()) return div(); // floating: nothing to draw
    const state = shared(STATE) ?? {};
    const mine = Object.keys(state).length;
    const time = (ms) => new Date(ms).toLocaleTimeString([], { hour12: false });
    return v_flex().size_full().overflow_hidden().bg(t.surface).p(12).gap(4).text_size(12).text_color(t.muted)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Tab titles"))
      .child(div().child(`${this.cfg.enabled ? "on" : "off"} · ${this.lease.holds() ? "acting" : "standing by (another copy holds the lease)"} · ${mine} tab${mine === 1 ? "" : "s"} named by me`))
      .child(div().child(`follow new sessions: ${this.cfg.follow_new_sessions ? "yes" : "no"} · several agents: ${this.cfg.multi_agent_titles ? "model-named" : "left alone"}`))
      .child(div().child(this.cfg.multi_agent_titles ? `model: ${describe(this.cfg)}` : "model: not used"))
      .children(this.log.map((l) => div().text_color(t.dim).child(`${time(l.at)}  ${l.text}`)));
  }
}
