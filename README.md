# herdr-app-mods

**Run ten coding agents at once without losing track of any of them.**

[Herdr](https://herdr.dev) is a desktop app for running AI coding agents side by side. These are the mods that make
it feel like it was built for the way you actually work: jump anywhere in two keystrokes, tabs that name themselves,
and agents that tidy up after themselves instead of eating your RAM for three days.

Five small mods, MIT licensed, no build step, no dependencies. Install them with one script; remove them with one flag.

| | Mod | The pitch |
| --- | --- | --- |
| ⌨️ | [`command-bar`](#command-bar) | **One box to go anywhere.** Fuzzy-search every space, tab, agent, terminal, machine and app command. Agents that need you come first. |
| 🏷️ | [`tab-titles`](#tab-titles) | **Tabs that name themselves.** Your tab says "Fix login race", not "3". Never touches a tab you named. Optional LLM naming, with *your* endpoint and key. |
| 🚦 | [`agent-groups`](#agent-groups) | **Who needs me?** A keyboard-first popup: Needs you / Working / Done / Idle, newest first, pin the ones you care about. |
| 🧹 | [`idle-reaper`](#idle-reaper) | **Agents that clean up after themselves.** Idle for hours? Parked, with the resume command already typed. Forgotten for days? Closed. |
| 🪛 | [`tab-tools`](#tab-tools) | **The small stuff the app has no setting for.** Hide the tab bar on one-tab spaces, move tabs by key, open the worktree dialogs. |

## Try it in 60 seconds

```sh
git clone https://github.com/adhikasp/herdr-app-mods
cd herdr-app-mods
scripts/install            # links every mod into ~/.config/herdr-app/mods (or $HERDR_APP_HOME)
```

Linked mods hot-reload when you save a file in the clone, so hacking on one is a save away. Bind the two you open by
hand in your `keys.json` (the app keeps only the keys you edit):

```json
{
  "global": {
    "ctrl-alt-o": "mod.open:command-bar",
    "ctrl-alt-a": "mod.open:agent-groups"
  }
}
```

The other three work in the background. Give each a zero-size block in your layout (the shipped layouts are
read-only: `herdr-app do layout.clone '{"name":"main","as":"mine"}'` makes one you can edit):

```json
{ "id": "tab-titles",  "type": "block", "size": { "px": 0 }, "content": { "mod": "tab-titles" } },
{ "id": "idle-reaper", "type": "block", "size": { "px": 0 }, "content": { "mod": "idle-reaper" } },
{ "id": "tab-tools",   "type": "block", "size": { "px": 0 }, "content": { "mod": "tab-tools" } }
```

Not for you after all?

```sh
scripts/install --uninstall      # removes only what the script installed
scripts/install --copy           # or copy instead of linking
scripts/install idle-reaper      # or install just one
```

Everything is configured the same way: a small JSON file per mod in `~/.config/herdr-app/config/<mod>.json`, and a
layout block's `props.config` overrides it for that one copy. Set `HERDR_MODS_CONFIG_DIR` to keep the files somewhere
else (a dotfiles repo, say).

## What you get

### command-bar

Stop hunting through spaces and tabs. One fuzzy box reaches all of it:

```
type          fuzzy search; space separates terms, all must match; smart case
s a t p m c   (then a space or colon) keep the search to spaces / agents / tabs / panes / machines /
              commands: `s web`, `a:claude`. A prefix that matches nothing searches everything.
> or :        the command palette: every command and key binding, with its keys
@  %  !       agents / named terminals / only what needs you
up, down      move (ctrl+n/p, ctrl+j/k too); tab and shift+tab cycle the kind
enter         go; esc closes
ctrl+d twice  close the selected row's tab; ctrl+r renames it
```

- **Needs-you first.** At rest the list is: agents that need you, then finished ones, then recents, then the rest.
  The place you are in never comes first.
- **It never lies about your keys.** Palette rows come from the app's own `commands()` and `keys()`, so what you see
  is what you bound, including layouts and themes (`Layout: switch main`, `Theme: app.theme …`). Splits bound with a
  direction and an agent show up as `Pane: split right`, with their key.
- **Enter does the obvious thing:** shows a space, focuses an agent, starts a space on a machine, runs a command.

<details>
<summary><code>config/command-bar.json</code></summary>

| Key | Default | Meaning |
| --- | --- | --- |
| `modal` | `false` | Open in a vim-style list: `j`/`k` move, `g`/`G` jump, `/` searches, `>` opens the palette, any other character starts the search with itself, `esc` leaves the search and then closes. |
| `scope` | `"all"` | The kind the bar opens on: `agent`, `tab`, `space`, `pane`, `machine`, `command`. |
| `mru` | `30` | How many recent picks to remember (shared state `command-bar.mru`). |

Enter on a palette split fills only the command's first argument, so you get a shell, not the agent your own key
starts.

</details>

### tab-titles

The agent's own task title becomes the tab name, so the tab bar, the sidebar and the command bar show the *work*
instead of a number. Works with whatever sets a terminal title: Claude Code, OpenCode, Codex.

- A tab nobody named takes its agent's title once it has held still for a few seconds (no flicker while it types).
- A tab it named stays its own while the name is the one it wrote. **Rename it yourself and it is yours for good**;
  clear the name and it can be retitled.
- A tab *you* named is never touched.
- A tab with several agents? Leave it alone, or let a model name it from their titles (below).

**Bring your own model.** `multi_agent_titles` can name a many-agent tab with one small request. It speaks the
OpenAI chat-completions protocol, so it works with OpenAI, OpenRouter, Azure, a local Ollama or LM Studio, or
anything else that does:

```json
{ "multi_agent_titles": true, "llm_url": "http://localhost:11434/v1", "llm_model": "qwen3:8b", "llm_auth": "none" }
```

Only the tab's session titles leave your machine, and only when you turn this on. The token comes from the first of
`llm_key`, the environment variable you name, or a file, and it is never shown in the panel or in an error.

<details>
<summary><code>config/tab-titles.json</code></summary>

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `follow_new_sessions` | `false` | `true` keeps retitling a name it wrote as the agent's title changes (after `/clear`, a restart); `false` pins the first title. |
| `lowercase_titles` | `false` | Lowercase generated titles. |
| `max_length` | `40` | Longest title, in characters. |
| `settle_ms` | `3000` | A title must stay the same this long before it is written. |
| `only_spaces` / `exclude_spaces` | `[]` | Space-name regexes. Non-empty `only_spaces` limits the mod to matching spaces; `exclude_spaces` skips matching ones (`["^telegram"]`). |
| `multi_agent_titles` | `false` | Name a tab with several agents from one model request over their titles (they leave your machine). Repeats only when the titles change. |
| `llm_url` | OpenRouter | Any OpenAI-compatible endpoint: a base URL (`https://api.openai.com/v1`, `http://localhost:11434/v1`) or the full chat-completions URL. |
| `llm_model` | `openai/gpt-4o-mini` | The model, as that endpoint names it. |
| `llm_key` | `""` | The token itself. It sits in the file in plain text; prefer the next two. |
| `llm_key_env` | `OPENROUTER_API_KEY` | Name of the environment variable that holds the token. |
| `llm_key_file` | `""` | A file with a `NAME=token` line (`NAME` is `llm_key_env`) or holding only the token (`~/` allowed). `llm_env_file` is the older name. |
| `llm_auth` | `bearer` | `bearer` sends `Authorization: Bearer <token>`; `none` sends no token (a local server); any other word is a header name that gets the bare token (`api-key` for Azure, `x-api-key`). |
| `llm_headers` | `{}` | Extra request headers. |
| `llm_timeout_ms` | `20000` | Give up on a request after this long. |
| `llm_retry_ms` | `60000` | Wait this long after a failed request before asking again for that tab. |

A copy that is not on screen is re-checked every 5 seconds; one that is on screen reacts to every change. Only one
copy acts at a time.

</details>

### agent-groups

The sidebar already has a priority view; this is the same idea as a popup you drive without the mouse: **Needs you**,
**Working**, **Done**, **Idle**, each sorted by when the agent last changed. `j`/`k` move, `enter` (or a click)
focuses, `p` pins, `esc` or `q` closes. Pins lead their group. It reads herdr-core's status timestamps, not
transcripts, so it never touches your files.

### idle-reaper

Ten agents, three of them idle since lunch. The reaper looks every ten minutes and does two things:

- **Park.** An agent idle for 4 hours is exited with `/exit`, and its resume command (`claude --resume <id>`) is
  typed at the shell prompt *without Enter*. One keypress brings the session back, exactly where you left it.
- **Close.** A parked pane nobody came back to for 3 days is closed, but only if its screen still shows the typed
  command. If you touched it, the reaper forgets it instead.

It is careful by design: it never touches a focused terminal, an agent that is working or blocked, or a terminal you
named. A pane is left alone when its shell sits in another folder than the agent, or when the terminal runs the agent
itself with no shell underneath. Try it risk-free with `"dry_run": true`: it logs what it *would* do and changes
nothing.

**Groups** bound sessions that should be closed rather than parked, like one agent per chat topic:

```json
{
  "groups": [
    { "name": "chat", "match": "^(bot|chat-.*)$", "exempt": "^bot$", "close_after_s": 5400, "max_live": 6, "min_idle_s": 900 }
  ]
}
```

Idle for `close_after_s` and it is closed; beyond `max_live` the least recently used go first (never one idle less
than `min_idle_s`); `exempt` names are never touched.

**Any agent, not just two.** `apps` says how to resume each program: the names herdr-core reports for it, a `resume`
template, and where the session id lives (a JSON file, or a terminal label). Claude Code and OpenCode are built in;
add yours with a few lines of JSON.

**Works with the window closed.** A mod only runs while the app window is open, so `scripts/idle-reaper` runs the
*same code* from a timer for the rest of the time (`--dry-run`, `--force`). It needs `node`, does nothing while a
window is up, so the two never act together, and they share one state file. Ready-made timers are in
[`contrib/`](contrib): a systemd service and timer, and a launchd agent for macOS.

**On macOS.** The mod runs as is. Behind the scenes: macOS has no `/proc`, so the shell's folder comes from `lsof`
(`/usr/sbin/lsof`, shipped with the system); the timer script adds `~/.local/bin` (where Herdr links `hc` and
`herdr-app`) and Homebrew's folders to the bare `PATH` launchd gives it; and the app home is `~/.config/herdr-app`
there too (`XDG_CONFIG_HOME` and `HERDR_APP_HOME` are honoured). Agent folders are compared as real paths, so a trailing
slash does not matter.

<details>
<summary><code>config/idle-reaper.json</code></summary>

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `dry_run` | `false` | Log what would happen; change nothing. |
| `interval_s` | `600` | How often the mod looks (60 at least). |
| `park_after_s` | `14400` | Idle this long before an agent is parked (4 h). `0` turns parking off. |
| `close_after_s` | `259200` | A parked pane untouched this long (counted from when it went idle) is closed (3 days). |
| `apps` | Claude Code, OpenCode | How to resume each program: `match` (names), `resume` (template with `{id}`), `session_file` + `session_key`, or `session_label`. |
| `groups` | `[]` | `{name, match, exempt, close_after_s, max_live, min_idle_s}`; see above. |

A resume command has to be typeable by `hc keys`, which has no `_ : & ~ (` or capitals; a command that needs them
(OpenCode's `ses_…` ids) is not parked. Give the mod a real block instead of a zero-size one to see its last log
lines.

</details>

### tab-tools

The things the app has no setting for. It draws nothing.

- **Hide the tab bar** while the shown space has one tab (`hide_bar_when_single_tab`, off by default).
- **Move tabs by key.** The app's own `tab.move` is absolute; these are relative: `"alt-shift-h": "tab-tools.tab_move:-1"`,
  `"alt-shift-l": "tab-tools.tab_move:1"`.
- **Worktree dialogs on a key:** `"tab-tools.worktree:new"` and `"tab-tools.worktree:open"`.

`config/tab-tools.json`: `hide_bar_when_single_tab` (default `false`) and `tab_bar_id` (default `"tabs"`, the layout
node of the tab bar).

## Trust, in plain words

Mods are trusted code with command and network access, so here is exactly what these do:

- `command-bar`, `agent-groups` read herdr-core (`hc`) and change nothing.
- `tab-titles` runs `printenv` to find a token you pointed it at, renames tabs, and makes one HTTPS request to the
  endpoint you configured, *only* if you turn on `multi_agent_titles`.
- `idle-reaper` runs `hc` to read terminals and, outside `dry_run`, to exit, close and type into **idle** agent panes.
  That is the one mod that acts on your terminals; read `herdr-mods/idle-reaper/mods/idle-reaper/reaper.js` first, it is the whole policy.
- `tab-tools` runs layout and tab commands.

Nothing else leaves your machine. No telemetry, no accounts.

## Made to be modified

- **Pure logic, real tests.** Each mod keeps its decisions in plain modules with no `herdr` imports, so
  `npm test` runs 69 tests under plain Node, no app needed. `main.js` is the only file that touches the app.
- **One config shape, one model client.** `shared/llm.js` (any OpenAI-compatible endpoint, the token lookup),
  `shared/config.js` (defaults < `config/<mod>.json` < block props) and `shared/lease.js` ("only one copy acts") are
  the single source. Mods cannot import across folders, so `scripts/sync-shared` copies them in and a test fails if a
  copy drifts. A new mod that calls a model takes the same `llm_*` keys for free.
- **Check before you ship.** `scripts/check` runs `herdr-app check` on every mod, the drift check and the tests.
  `scripts/fake-agent` is a stand-in agent (status + terminal title) for trying a mod without a real one.

```sh
npm test            # fuzzy matching, ranking, titling rules, grouping, the reaper's policy and runner
scripts/check       # herdr-app check on every mod, then the tests
scripts/sync-shared # copy shared/*.js into the mods that use them
scripts/gallery     # redraw herdr-mods/*/preview.png from synthetic data (Hyprland; own app home and core)
```

Each mod lives in `herdr-mods/<name>/` the way the [Herdr gallery](https://herdr.dev/gallery/?type=mods) expects:
`mods/<name>/` (the mod), a `RECIPE.md` (a brief another agent can rebuild it from) and a `preview.png`. The previews
are screenshots of an isolated Herdr fed with made-up spaces and agents (`scripts/gallery`, `gallery/`), never of a
real desktop.

Developed and used daily on Linux. The mods are plain JavaScript on the app's mod API. `idle-reaper` has been
reviewed for macOS (see above) and its macOS paths are covered by tests with a faked system, but it has not been run
on a Mac; Windows is untested. Issues and pull requests welcome.

## Coming from the terminal UI?

These started as rewrites of the terminal-UI plugins and keep their behaviour where the app allows it. What the app
cannot do (yet): no live preview of the selected pane in the command bar and no `running_time` column; no
per-machine title watcher and no tab status glyphs (the app draws status itself); `agent-groups` does not read Claude
or OpenCode transcripts; the Ovis web client is not ported (it drives the terminal UI's socket).

## Credits

Behaviour and fuzzy scoring follow [herdr-command-plugin](https://github.com/adhikasp/herdr-command-plugin), which
grew out of [jeffarese/herdr-bar](https://github.com/jeffarese/herdr-bar). MIT licensed.
