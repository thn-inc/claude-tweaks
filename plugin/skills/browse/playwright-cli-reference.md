# Playwright CLI reference

Reference for the `playwright-cli` (`@playwright/cli`) commands used by claude-tweaks skills.
The full Playwright CLI is broader; this file documents only what consumer skills speak.

## Authority: the CLI's own docs outrank this file

This file is a convenience pin of the subset claude-tweaks speaks, verified against
`@playwright/cli` 0.1.0. For anything not covered here, consult the tool's own bundled
self-docs: `node_modules/playwright-core/lib/tools/skills/playwright-cli/SKILL.md` plus its
`references/` sub-docs. **On any command error, or before using a command or flag this file
does not list, consult the self-docs — never guess flags from memory.** When the self-docs and
this file disagree, the self-docs win; note the drift so it can be filed upstream against this
plugin.

## Daemon / session model

Each `open`/`attach` call is explicit — unlike `agent-browser`, there is no implicit daemon
auto-started by the first command. Named sessions (`-s=<name>`) provide isolation, one per
parallel agent or QA story instance.

| Operation | Command |
|---|---|
| Open a session at a URL | `playwright-cli -s=<name> open <url>` |
| List active sessions | `playwright-cli list` |
| Close every session | `playwright-cli close-all` |
| Kill every session (force) | `playwright-cli kill-all` |

## Operation vocabulary

The translation table consumer skills speak, alongside the equivalent `agent-browser` command
for anyone migrating a call site.

| Operation | agent-browser (today) | Playwright CLI (new) |
|---|---|---|
| Open a session at a URL | `agent-browser --session <name> open <url>` | `playwright-cli -s=<name> open <url>` |
| Navigate within a session | `agent-browser --session <name> open <url>` | `playwright-cli -s=<name> goto <url>` |
| Close a session | `agent-browser --session <name> close` | `playwright-cli -s=<name> close` |
| Close every session | `agent-browser close --all` | `playwright-cli close-all` |
| List active sessions | `agent-browser session list` | `playwright-cli list` |
| Ref-based element snapshot | `snapshot -i -c` (`@eN` refs) | `snapshot` (`eN` refs) |
| Act on a ref | `click @e3` | `click e3` |
| Locator-based find+act | `find <locator> <value> <action>` | `find "<text>"` (read-only — see caution below) |
| Fill a field | `fill @e5 "<text>"` | `fill e5 "<text>"` |
| Screenshot | `screenshot <path>` (positional) | `screenshot --filename=<path>` (flag) |
| Text-only assertion | plain `snapshot` (no refs) | `find "<text>"` or `eval` against the page |

## Cautions

- **Refs are session-scoped and regenerate on every snapshot** — never store them (unchanged
  rule, unchanged mechanism, carried forward from `agent-browser`).
- **`find` under Playwright CLI is read-only** — the opposite of `agent-browser`'s
  action-defaulting bare `find`, whose action-less form defaults to clicking the element.
  `playwright-cli find "<text>"` searches and returns matching nodes; it never performs an
  action on its own. This is the one place the translation is not a mechanical rename, and a
  future migration inheriting the old assumption would silently mutate pages it meant only to
  inspect.
- **Always pass absolute output paths.** Screenshots, and anything else the CLI writes to disk,
  must be passed as absolute paths — a relative path resolves against the invoking shell's cwd,
  which is not guaranteed stable across separate tool calls (confirmed during the spike).

## Known gaps

The `os error 35`-equivalent screenshot-degradation case `agent-browser` exhibits was not
validated during the spike that selected this backend — this file does not claim full parity
coverage of that failure mode. If a future consumer needs degradation-detection guidance for
Playwright CLI, that is new content to add then, not something backfilled here speculatively.

## See also

- `agent-browser-reference.md` — the backend this tool replaces; structural template for this
  file. Consumer skills still cite it until the migration (sub-project 3) moves them over.
