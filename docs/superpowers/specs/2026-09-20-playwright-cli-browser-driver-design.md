# Playwright CLI browser driver: reference doc + init detection

**Status:** draft

## Context

This is sub-project 2 of a larger initiative to replace `agent-browser` (this plugin's current
browser-automation backend) with Playwright CLI (`@playwright/cli`), triggered by two confirmed
`agent-browser` defects tracked in #2537: a synthetic locator click can report success without
the target's registered handler firing (repro: icon-sized buttons inside table rows), and the
screenshot pipeline can silently return a stale/dead frame after an `os error 35` (EAGAIN)
failure with no daemon-side self-heal. Neither defect is fixable from this repo — `agent-browser`'s
own source isn't vendored here.

The full initiative decomposes into four ordered sub-projects:

1. **Spike** (done) — validated Playwright CLI runs genuinely headless (no display server needed)
   and that its default `click` fires the real handler on the icon-button-in-table-row repro case
   (confirmed via re-snapshotting DOM state, not just trusting the tool's own success report).
   Did not test the `os error 35`-equivalent screenshot-degradation case specifically.
2. **This spec** — the reference doc + init detection change, below.
3. Migrate the ~28 consumer files (`plugin/skills/browse`, `demo`, `flow`, `init`, `review`,
   `routine`, `specify`'s own template, `stories` ×6, `test` ×2, `visual-review` ×6,
   `plugin/agents/qa-agent.md`) off `agent-browser`'s CLI syntax onto Playwright CLI's, citing
   this sub-project's reference doc instead of `agent-browser-reference.md`.
4. Retire `agent-browser` — remove it as a backend option entirely once every consumer has
   migrated; update `docs/donts.md`'s rule (which currently pins `agent-browser` by name as "the
   only backend working in both interactive sessions and hosted Routines").

Today's `agent-browser-reference.md` is a pure markdown convention-pin — no Node.js code layer
exists anywhere in this pattern; every skill constructs the raw CLI command string itself, inline,
via Bash, using the abstract-operation vocabulary that reference doc documents. This spec follows
the identical pattern for Playwright CLI, rather than introducing a new architectural shape
(a Node.js driver module was considered and dropped — nothing in the spike surfaced a reliability
gap Playwright's own `click`/`screenshot` commands don't already cover, so there is nothing left
for a wrapper layer to do that the existing doc-only pattern doesn't already handle).

## Scope

In scope:
- A new reference doc, `plugin/skills/browse/playwright-cli-reference.md`, mirroring
  `agent-browser-reference.md`'s structure and conventions.
- Updating `plugin/skills/init/bootstrap/step-07-browser-integration.md` to detect `playwright-cli`
  instead of `agent-browser`.

Out of scope (later sub-projects):
- Rewriting any of the ~28 consumer files to actually use the new doc/tool.
- Removing `agent-browser-reference.md` or any `agent-browser` mention elsewhere.
- Anything in `docs/donts.md`.

## Design

### `plugin/skills/browse/playwright-cli-reference.md`

Mirrors `agent-browser-reference.md`'s section shape:

**Authority.** Pinned against a specific `@playwright/cli` version (the one installed during the
spike — confirm the exact version at write time via `npx playwright-cli --version`). Defers to the
tool's own bundled self-docs as authoritative for anything this file doesn't cover — Playwright CLI
ships `node_modules/playwright-core/lib/tools/skills/playwright-cli/SKILL.md` (analogous to
`agent-browser skills get core`), plus topic-specific sub-docs under its own `references/`
directory (`session-management.md`, `storage-state.md`, `playwright-tests.md`, etc.) — this file
documents only the subset this plugin speaks. Same "on any command error, or before using a
command/flag this file does not list, consult the self-docs — never guess flags from memory" rule.

**Daemon/session model.** No implicit daemon the way `agent-browser` has one. Playwright CLI
manages browser processes directly; named sessions are `-s=<name>` (agent-browser: `--session
<name>` — same concept, different flag spelling). `playwright-cli list` / `close-all` / `kill-all`
are the direct equivalents of agent-browser's `session list` / `close --all` — `close-all` is the
residue-sweep idiom to carry forward verbatim (run at the start of a multi-session skill run;
idempotent no-op when nothing is open).

**Operation vocabulary table.** The abstract-operation → concrete-command translation table,
updated for Playwright CLI's verbs:

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

Two cautions carried forward from `agent-browser-reference.md`, restated for the new tool:
- **Refs are session-scoped and regenerate on every snapshot — never store them.** Same rule,
  unchanged mechanism.
- **`find` here is read-only** (search + return matching nodes with context) — the opposite of
  agent-browser's `find`, whose bare/action-less form defaults to clicking. This is the one place
  the translation is not a mechanical rename: a consumer file migrating a `find ... click` call
  must switch to `snapshot` (or `find` for the read) to get a ref, then a separate `click <ref>` —
  never assume `find` alone acts on the page under the new tool. Flag this explicitly in the doc so
  sub-project 3's migration doesn't inherit the old assumption silently.
- **Always pass absolute output paths** (screenshots, and anything else the CLI writes to disk) —
  confirmed during the spike that a relative path resolves against the invoking shell's cwd, which
  is not guaranteed stable across separate tool calls in this harness.

**Installation.** `npx --no-install playwright-cli --version` is the tool's own documented
presence check (falls back to a global install when available). No daemon auto-start to document —
each `open`/`attach` call is explicit.

### `plugin/skills/init/bootstrap/step-07-browser-integration.md`

Replace the `agent-browser`-specific detection with the Playwright CLI equivalent: same "missing →
surface the install hint and continue, never block init" posture (browser features stay optional;
every other skill degrades gracefully without one) — only the tool name and the presence-check
command change.

## Testing

No `npm test` coverage needed — both changes are markdown/prose, no executable code (the doc-only
pattern this whole spec follows has no test suite of its own today, matching
`agent-browser-reference.md`'s own precedent).

## Non-Goals

- Migrating any of the ~28 consumer files (sub-project 3).
- Removing `agent-browser` or its reference doc (sub-project 4).
- A Node.js driver/wrapper module — considered and explicitly dropped (see Context).
