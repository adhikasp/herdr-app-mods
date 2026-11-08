# herdr-app-mods

Mods for the [Herdr](https://herdr.dev) desktop app (not the terminal UI), written in the app's JS mod format.
They started as rewrites of three terminal-UI plugins and keep their behaviour where the app allows it.

| Mod | What it does |
| --- | --- |
| [`command-bar`](mods/command-bar) | One fuzzy search over spaces, tabs, agents, named terminals, machines and every app command, with the key bound to each. |
| [`tab-titles`](mods/tab-titles) | Names tabs nobody named after their agent's task title. Never touches a tab you named. |
| [`agent-groups`](mods/agent-groups) | A popup listing agents under Needs you / Working / Done / Idle, newest change first. |

## Install

```sh
git clone https://github.com/adhikasp/herdr-app-mods
cd herdr-app-mods
scripts/install            # links every mod into ~/.config/herdr-app/mods (or $HERDR_APP_HOME)
scripts/install --copy     # copies instead of linking
scripts/install --uninstall
```

Linked mods hot-reload when you save a file here. Then bind keys in `keys.json` (the app keeps only the keys
you edit, so add these to your own file):

```json
{
  "global": {
    "ctrl-alt-o": "mod.open:command-bar",
    "ctrl-alt-a": "mod.open:agent-groups"
  }
}
```

Mods are trusted code with command and network access. `tab-titles` calls `printenv`, and, only if you turn on
`multi_agent_titles`, one HTTPS request to an OpenAI-compatible endpoint. `command-bar` and `agent-groups`
run `hc` (herdr-core) read-only. Nothing else leaves your machine.

Settings live in `config/<mod>.json` inside the app home (`~/.config/herdr-app/config/`). A layout block's
`props.config` overrides the file for that copy.

## command-bar

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

At rest the list is: agents that need you, then finished ones, then recents, then the rest; the place you
are in never comes first. Enter on a space shows it, on an agent focuses it, on a machine starts a space there,
on a command runs it. Palette rows come from `commands()` and `keys()`, so they always match your bindings;
layouts and themes are listed too (`Layout: switch main`, `Theme: app.theme …`). A key written as
`{command, args}` is listed under the value of the command's first argument, so a split bound with a direction
and an agent shows as `Pane: split right` with its key; `Pane: split right` and `Pane: split down` are listed
even when nothing is bound to them. Enter fills only that first argument, so a palette split gives you a shell,
not the agent your key starts.

`config/command-bar.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `modal` | `false` | Open in a vim-style list: `j`/`k` move, `g`/`G` jump, `/` searches, `>` opens the palette, any other character starts the search with itself, `esc` leaves the search and then closes. |
| `scope` | `"all"` | The kind the bar opens on: `agent`, `tab`, `space`, `pane`, `machine`, `command`. |
| `mru` | `30` | How many recent picks to remember (shared state `command-bar.mru`). |

## tab-titles

An agent's terminal title (Claude's session title, OpenCode's, Codex's) becomes the tab name, so the tab bar, the
sidebar and the command bar show the work instead of "3". Rules:

- a tab nobody named takes its agent's task title once it has held still for `settle_ms`;
- a tab it named stays its own while the name is the one it wrote. Rename it yourself and it is yours for good;
  clear the name (`tab.rename` with an empty name) and it can be retitled;
- a tab you named is never touched;
- tabs holding two or more agents are left alone unless `multi_agent_titles` is on.

The mod only works while a copy is running, so give it a place in your layout where it takes no room:

```json
{ "id": "tab-titles", "type": "block", "size": { "px": 0 }, "content": { "mod": "tab-titles" } }
```

(a floating block works too). A copy that is not on screen is re-checked every 5 seconds; one that is on screen
reacts to every change. Only one copy acts at a time.

`config/tab-titles.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `follow_new_sessions` | `false` | `true` keeps retitling a name it wrote as the agent's title changes (after `/clear`, a restart); `false` pins the first title. |
| `lowercase_titles` | `false` | Lowercase generated titles. |
| `max_length` | `40` | Longest title, in characters. |
| `settle_ms` | `3000` | A title must stay the same this long before it is written. |
| `only_spaces` / `exclude_spaces` | `[]` | Space-name regexes. Non-empty `only_spaces` limits the mod to matching spaces; `exclude_spaces` skips matching ones (`["^telegram"]`). |
| `multi_agent_titles` | `false` | Name a tab with several agents from one model request over their titles (they leave your machine). Repeats only when the titles change. |
| `llm_model` | `openai/gpt-4o-mini` | Model for `multi_agent_titles`. |
| `llm_url` | OpenRouter chat completions | Any OpenAI-compatible endpoint. |
| `llm_env_file` | `""` | File with an `OPENROUTER_API_KEY=` line (`~/` allowed), used when the environment variable is unset. |
| `llm_retry_ms` | `60000` | Wait this long after a failed request before asking again for that tab. |

## agent-groups

The sidebar's `agents` mod already has a priority view. This is the same grouping as a keyboard-first popup, sorted
by when each agent last changed (from herdr-core's status timestamps). `j`/`k` move, `enter` or a click focuses,
`p` pins, `esc` or `q` closes. Pins lead their group. "Done turns idle once you look at it" is the app's own
behaviour, so there is no read marker to keep.

## Development

```sh
npm test            # node --test test/*.test.js: fuzzy matching, ranking, titling rules, grouping
scripts/check       # herdr-app check on every mod, then the tests
scripts/fake-agent  # a stand-in agent (OSC 7501 status + terminal title) for trying mods
```

Each mod keeps its pure logic in plain modules (`fuzzy.js`, `items.js`, `titles.js`, `groups.js`) with no `herdr`
imports, so the tests run under plain Node. `main.js` is the only file that touches the app.
Mods are self-contained: a mod folder is linked into the app on its own, so shared code is copied, not imported
across folders.

## Differences from the terminal-UI plugins

- No live preview of the selected pane in the command bar, and no `running_time` column.
- No per-machine title watcher and no tab status glyphs: the app draws status itself.
- `agent-groups` does not read Claude or OpenCode transcripts; it sorts by the status-change time core reports.
- The Ovis web client is not ported (it drives the terminal UI's socket).

## Credits

Behaviour and fuzzy scoring follow [herdr-command-plugin](https://github.com/adhikasp/herdr-command-plugin), which
grew out of [jeffarese/herdr-bar](https://github.com/jeffarese/herdr-bar). MIT licensed.
