# Changelog

## Unreleased

- `command-bar`: key bindings written as `{command, args}` (a split with a direction and an agent, say) are
  listed in the palette with the value of their first argument and their keys. `Pane: split right` and
  `Pane: split down` are listed even with no binding at all. Running a row still fills only that first
  argument.
- `command-bar`: an empty result reads `No matches for “…”` instead of `No match match “…”`.

## 0.1.0

First release: `command-bar`, `tab-titles` and `agent-groups`, rewritten from the terminal-UI plugins
(herdr-command-plugin and herdr-agent-groups) as Herdr app mods.
