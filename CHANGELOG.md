# Changelog

## Unreleased

- `idle-reaper` on macOS: the shell's folder is found with `lsof` when there is no `/proc` (shared by the mod and
  the script); `scripts/idle-reaper` adds `~/.local/bin` (`HC_INSTALL_DIR`), Homebrew and `/usr/sbin` to a bare
  `PATH`, so it runs under launchd and cron; the app home honours `XDG_CONFIG_HOME` (also in `scripts/install`).
  `contrib/` has a launchd agent and a systemd service and timer.
- New `idle-reaper` mod, with `scripts/idle-reaper` to run the same pass from a timer when no window is open.
- New `tab-tools` mod: hide the tab bar for a one-tab space, move a tab left or right, open the worktree dialogs.
- `shared/lease.js`: the "only one copy acts" lease, used by `tab-titles` and `idle-reaper`.
- `tab-titles`: a model request no longer calls `setTimeout` (mods have none); the timeout runs on a mod timer.
- `tab-titles`: the model endpoint takes a base URL as well as a full URL, and the token can come from `llm_key`,
  any environment variable (`llm_key_env`), or a file (`llm_key_file`, an env file or a bare token). `llm_auth`
  selects bearer, none (local servers) or a named header; `llm_headers` and `llm_timeout_ms` are new. Older
  configs work unchanged. The panel shows the endpoint and model, never the token.
- `shared/llm.js` and `shared/config.js` are the common model client and config loader, copied into mods by
  `scripts/sync-shared`. `HERDR_MODS_CONFIG_DIR` moves the config folder.
- `command-bar`: key bindings written as `{command, args}` (a split with a direction and an agent, say) are
  listed in the palette with the value of their first argument and their keys. `Pane: split right` and
  `Pane: split down` are listed even with no binding at all. Running a row still fills only that first
  argument.
- `command-bar`: an empty result reads `No matches for “…”` instead of `No match match “…”`.

## 0.1.0

First release: `command-bar`, `tab-titles` and `agent-groups`, rewritten from the terminal-UI plugins
(herdr-command-plugin and herdr-agent-groups) as Herdr app mods.
