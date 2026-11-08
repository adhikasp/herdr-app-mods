// Tab tools: small things the app has no setting for. It draws nothing.
//
//  - `hide_bar_when_single_tab` (config/tab-tools.json): the tab bar is hidden while the shown space has one tab.
//  - key commands, bound in keys.json as "<key>": "tab-tools.<command>":
//      tab_move:-1 | tab_move:1      move the shown tab left / right (the app's own tab.move is absolute)
//      worktree:new | worktree:open  the worktree dialogs
//
// It must stay alive to work, so give it a place in your layout where it takes no room:
//
//   { "id": "tab-tools", "type": "block", "size": { "px": 0 }, "content": { "mod": "tab-tools" } }

import { View, div } from "gpui-kit";
import { appHome, exec, layout, nextCommand, openOverlay, panes, props, readTextFile, run, spaces } from "herdr";
import { configPath, mergeConfig } from "./config.js";
import { DEFAULTS, barCommand, findNode, moveTab, parseCommand } from "./tools.js";

export default class TabTools extends View {
  init(_props, cx) {
    this.cfg = { ...DEFAULTS };
    // A hidden block may not render, so the bar check also runs on a slow timer.
    cx.timer.every(1000, () => this.fit());
    cx.spawn(async () => {
      let override = null;
      try {
        const r = await exec("printenv", ["HERDR_MODS_CONFIG_DIR"]);
        if (r.code === 0) override = r.stdout.trim() || null;
      } catch {}
      let text = null;
      try {
        text = await readTextFile(configPath(appHome(), "tab-tools", override));
      } catch {}
      const { cfg, error } = mergeConfig(DEFAULTS, text, props());
      if (error) console.log("tab-tools: config/tab-tools.json ignored:", error);
      this.cfg = cfg;
    });
    cx.spawn(async () => {
      for (;;) this.command(await nextCommand());
    });
  }

  fit() {
    const space = spaces().find((s) => s.active);
    const cmd = barCommand(space, findNode(layout(), this.cfg.tab_bar_id), this.cfg);
    if (cmd) run(cmd, { id: this.cfg.tab_bar_id });
  }

  command(c) {
    const space = spaces().find((s) => s.active);
    const what = parseCommand(c);
    if (!space || !what) return;
    if (what.kind === "move") {
      const m = moveTab(space, what.delta);
      if (m) run("tab.move", m);
      return;
    }
    const open = what.action === "open";
    openOverlay({
      mod: "worktree",
      kind: "dialog",
      width: open ? 560 : 460,
      height: open ? 480 : 280,
      props: { space: space.id, folder: panes().find((p) => p.focused)?.cwd, action: what.action },
    });
  }

  render() {
    this.fit();
    return div();
  }
}
