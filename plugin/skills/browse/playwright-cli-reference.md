# Playwright CLI reference

Reference for the `playwright-cli` (`@playwright/cli`) commands used by claude-tweaks
skills. The full Playwright CLI is broader; this file documents only what consumer
skills speak.

## Authority: the CLI's own docs outrank this file

Playwright CLI ships version-matched self-documentation: `node_modules/playwright-core/
lib/tools/skills/playwright-cli/SKILL.md` plus its `references/` sub-docs. This file is
a convenience pin of the subset claude-tweaks speaks, verified against
`@playwright/cli` 0.1.21. **On any command error, or before using a command or flag
this file does not list, consult the bundled self-docs — never guess flags from
memory.** Before this file is finalized (or re-verified against a version bump),
cross-check every row in the Operation vocabulary table below against those bundled
docs command-by-command — this record's table was transcribed from research and one
spike, not independently verified row-by-row. When the self-docs and this file
disagree, the self-docs win; note the drift so it can be filed upstream against this
plugin.

## Session model

There is no persistent background daemon (unlike `agent-browser`, which auto-starts
one on port 4848) — each `open`/`attach` call starts or reuses a named browser process
directly, and `list`/`close-all`/`kill-all` operate on that set of processes this CLI
invocation tree manages, not on a daemon.

Named sessions provide isolation, selected via the `-s=<name>` flag on every command.
One session per parallel agent, one per QA story instance. Session names are
kebab-case derived from purpose (`checkout-flow`, `signup-neg-1`).

| Operation | Command |
|---|---|
| Open a session at a URL | `playwright-cli -s=<name> open <url>` |
| Close a session | `playwright-cli -s=<name> close` |
| Close every session (graceful) | `playwright-cli close-all` |
| Force-kill every browser process | `playwright-cli kill-all` |
| List active sessions | `playwright-cli list` |

`close-all` and `kill-all` are distinct: `close-all` closes sessions gracefully,
`kill-all` forcefully terminates the underlying browser processes. Prefer `close-all`
as the residue sweep at the start of a multi-session run (idempotent — a no-op when
nothing is open); reach for `kill-all` only when a session is stuck and `close-all`
doesn't clear it.

## Operation vocabulary

The translation table consumer skills speak, mapped against the `agent-browser`
command each row replaces. Use the abstract operation names in documentation;
translate to the concrete command at invocation. Only `open`/`goto`/`snapshot`/
`click`/`screenshot` were confirmed against a real repro during the spike (marked
below); every other row is transcribed from Playwright CLI's own published
documentation, not independently verified — cross-check those rows against the
bundled self-docs (Authority above) before relying on them.

| Operation | agent-browser (today) | Playwright CLI (new) |
|---|---|---|
| Open a session at a URL | `agent-browser --session <name> open <url>` | `playwright-cli -s=<name> open <url>` (spike-confirmed) |
| Navigate within a session | `agent-browser --session <name> open <url>` | `playwright-cli -s=<name> goto <url>` (spike-confirmed; note both agent-browser cells are the same command — agent-browser's `open` is overloaded for both first-open and subsequent navigation, where Playwright CLI splits them into `open`/`goto`) |
| Close a session | `agent-browser --session <name> close` | `playwright-cli -s=<name> close` (per tool docs) |
| Close every session (graceful) | `agent-browser close --all` | `playwright-cli close-all` (per tool docs) |
| Force-kill every browser process | *(no agent-browser equivalent documented)* | `playwright-cli kill-all` (per tool docs — distinct from `close-all`: forcefully terminates the underlying browser processes rather than closing sessions gracefully) |
| List active sessions | `agent-browser session list` | `playwright-cli list` (per tool docs) |
| Ref-based element snapshot | `snapshot -i -c` (`@eN` refs) | `snapshot` (`eN` refs) (spike-confirmed) |
| Act on a ref | `click @e3` | `click e3` (spike-confirmed) |
| Locator-based find+act | `find <locator> <value> <action>` | `find "<text>"` — **read-only, text-only** (see caution below; no direct translation for role/testid/css locators) |
| Fill a field | `fill @e5 "<text>"` | `fill e5 "<text>"` (per tool docs, not spike-tested) |
| Check a checkbox on a ref | *(via `find`'s `check` action)* | `check e5` (per tool docs, not spike-tested — inferred by analogy to `fill`'s ref-argument convention; verb name confirmed present in the CLI's own command list) |
| Hover over a ref | *(via `find`'s `hover` action)* | `hover e5` (per tool docs, not spike-tested — inferred by analogy to `fill`'s ref-argument convention; verb name confirmed present in the CLI's own command list) |
| Press a key / key combo (no locator — acts on whatever currently has focus) | `agent-browser --session <name> press "<value>"` | `playwright-cli -s=<name> press "<value>"` (investigated during #2670's follow-up to #2645-#2649's migration — per the CLI's own published documentation, `playwright.dev/agent-cli/commands/keyboard-mouse`, which mirrors the bundled `SKILL.md`; not spike-tested. Same focus-based semantics as `agent-browser`'s `press` — no ref/locator argument, e.g. `Enter`, `Control+a`, `Alt+ArrowLeft`) |
| Screenshot | `screenshot <path>` (positional) | `screenshot --filename=<path>` (flag) (spike-confirmed) |
| Text-only assertion | plain `snapshot` (no refs) | `find "<text>"` or `eval` against the page (per tool docs) |
| Start trace recording | `trace start` | `tracing-start` (per the CLI's own bundled self-docs/published docs — `node_modules/playwright-core/lib/tools/skills/playwright-cli/references/tracing.md`, mirrored at `github.com/microsoft/playwright-cli`; not spike-tested) |
| Stop trace recording | `trace stop <path>` | `tracing-stop` — **takes no output-path argument** (per the same bundled self-docs; not spike-tested). Unlike `agent-browser`'s `trace stop <path>`, the trace is auto-written to `.playwright-cli/traces/trace-<tool-timestamp>.trace` (plus a sibling `.network` file and a `resources/` directory) relative to the working directory — there is no way to choose the output path or filename. A caller that needs the file at a specific location must locate and move it after `tracing-stop` returns. This directory is not session-scoped (shared across all sessions in the same working directory). |
| Resize the viewport | `set viewport <w> <h>` | `resize <w> <h>` (per the CLI's own published documentation — `github.com/microsoft/playwright-cli`'s README and `playwright.dev/agent-cli/capabilities`; not spike-tested) |
| Bundle multiple ops into one process invocation | `agent-browser batch --session <name> "<op1>" "<op2>" ...` | *(investigated during #2645-#2649's migration — no Playwright CLI equivalent found)* — run the equivalent ops as separate sequential commands against the same `-s=<name>` session instead |
| Diagnose / recover a stuck session | `agent-browser doctor` | *(investigated during #2645-#2649's migration — no Playwright CLI equivalent found)* — there is no diagnostic command; `close-all` (or `kill-all` if that doesn't clear it) resets the process set, then re-open |
| Capture Web Vitals | `agent-browser --session <name> vitals` | *(investigated during #2645-#2649's migration — no Playwright CLI equivalent found)* — no command surfaces LCP/CLS/INP/TTFB/FCP; a hand-written `eval` script against `PerformanceObserver`/the `web-vitals` library could approximate this manually but is not a documented capability of this CLI |

### Cautions

- Refs are session-scoped and regenerate on every snapshot — never store them
  (unchanged rule, unchanged mechanism from `agent-browser`).
- `find` under Playwright CLI is **read-only and text-only** — the opposite of
  `agent-browser`'s action-defaulting, locator-flexible `find`. This is not a
  mechanical rename: an `agent-browser` call using a role/testid/css locator (not
  plain text) has no direct Playwright CLI equivalent — re-derive it as `snapshot` to
  obtain a ref, then a separate `click <ref>`/`fill <ref> <text>`. A migration that
  inherits the old "find always finds-and-acts" assumption would silently either fail
  to translate, or, worse, mutate a page it meant only to inspect.
- Always pass **absolute output paths** — a relative path resolves against the
  invoking shell's cwd, which is not guaranteed stable across separate tool calls
  (confirmed during the spike).
- `tracing-stop` has **no output-path argument at all** — the opposite gap from the
  paths caution above. It writes to a fixed, tool-chosen relative location
  (`.playwright-cli/traces/`) that is not session-scoped. A consumer that needs the
  trace at a specific absolute path (e.g. per-story, per-session) must locate the
  freshly-written file and move it there itself immediately after `tracing-stop`
  returns, disambiguating by exact modification time rather than "most recent" alone
  when multiple sessions may stop tracing concurrently.
- Only `open`/`goto`/`snapshot`/`click`/`screenshot` were spike-verified against a
  real repro; every other row above is transcribed from Playwright CLI's own
  published documentation, not independently confirmed.

## Installation / detection

`npx --no-install playwright-cli --version` is the tool's own documented presence
check (per its docs — not independently spike-verified here). See
`_shared/browser-detection.md` for the full detect / install / verify procedure.

## Anti-Patterns

No local copy here — `SKILL.md`'s own Anti-Patterns table in this skill's directory
is the single source of truth, the same "no local copy" principle
`agent-browser-reference.md` documents for itself.
