# agent-browser reference

Reference for the `agent-browser` commands used by claude-tweaks skills. The full
agent-browser CLI is broader; this file documents only what consumer skills speak.

## Authority: the CLI's own docs outrank this file

agent-browser ships version-matched self-documentation: `agent-browser skills get core`
(add `--full` for the complete command reference; `agent-browser skills list` shows
specialized guides). This file is a convenience pin of the subset claude-tweaks speaks,
verified against agent-browser 0.27.0. **On any command error, or before using a command
or flag this file does not list, consult the self-docs — never guess flags from memory.**
When the self-docs and this file disagree, the self-docs win; note the drift so it can be
filed upstream against this plugin.

## Daemon

The agent-browser daemon is implicit. The first `agent-browser` command auto-starts
it on port 4848. Skills do not manage the daemon. Recovery on crash:
`agent-browser doctor`. Dashboard is a human debug surface at
`http://localhost:4848` — do not poll it programmatically.

## Sessions

Named sessions provide isolation. One session per parallel agent, one per QA story
instance. Session names are kebab-case derived from purpose
(`checkout-flow`, `signup-neg-1`).

| Operation | Command |
|---|---|
| Open a session at a URL | `agent-browser --session <name> open <url>` |
| Close a session | `agent-browser --session <name> close` |
| Close every session | `agent-browser close --all` |
| List active sessions | `agent-browser session list` |

`close --all` is the residue sweep: run it when a skill starts a multi-session run
(idempotent — a no-op when nothing is open) so sessions leaked by an interrupted
earlier run cannot accumulate.

## Operation vocabulary

The translation table consumer skills speak. Use these abstract operation names in
documentation; translate to the concrete command at invocation.

Two command families act on elements:

- **Ref-based** — `snapshot -i -c` returns the accessibility tree with `@eN` refs;
  act on a ref (`click @e3`). Refs are session-scoped and regenerate on every
  snapshot — never store them. This is a different purpose from plain `snapshot`
  (no `-i`/`-c` flags): plain `snapshot` is for a static-text assertion ("does the
  page say X") and returns the page's text tree with no `@eN` refs; reach for
  `snapshot -i -c` only when the next step needs to act on or inspect a specific
  interactive element by ref.
- **Locator-based** — `find <locator> <value> <action> [text]` locates semantically
  and performs the action in one command. **The action argument is mandatory in this
  plugin's usage: a bare `find` with no action defaults to clicking the element**
  (verified v0.27.0), so an "is it there?" probe phrased as `find` mutates the page.
  For pure existence/assertion checks, use `snapshot` and inspect the tree, or
  `is visible <sel>` / `wait --text <text>` — never an action-less `find`.
  **`<action>` only resolves to `click`/`fill`/`check`/`hover` in this pinned
  version** — agent-browser's own self-docs (Authority above) also show
  `select`/`press`/`type` as `find` actions, but none of those three resolved
  against a real v0.27.0 daemon (verified); this is the kind of drift the Authority
  section says to note and file upstream, not a case where the self-docs should be
  trusted over observed behavior. There is no `find ... select` fallback for a
  dropdown interaction: take a full `snapshot -i -c` to get the option's `@eN` ref,
  then run the top-level `select @eN <value>` command as a separate call.
  `press` has the same fallback shape as `select`, but simpler: it is not a `find`
  action, but it is a real, working top-level command that needs no locator at all
  — `agent-browser --session <name> press "<key>"` presses a key (or combo, e.g.
  `Control+a`) at whatever element currently has focus (verified v0.27.0).
  **`find role <role> ... --name X` only reliably resolves the `button` role** —
  `link` and `heading` silently fail to match (the command exits clean with no
  match, not an error) even when a same-named element with that role exists on the
  page. Locate a link or heading with a different locator (`text`, `testid`, or
  `label`) instead of `role`.

| Operation | Command |
|---|---|
| open | `agent-browser --session <name> open <url>` |
| snapshot (interactive, compact) | `agent-browser --session <name> snapshot -i -c` |
| act by role + name | `agent-browser --session <name> find role <role> <action> --name "<name>"` |
| act by testid | `agent-browser --session <name> find testid <id> <action>` |
| act by text | `agent-browser --session <name> find text "<text>" <action> [--exact]` |
| act by label | `agent-browser --session <name> find label "<label>" <action>` |
| act by placeholder | `agent-browser --session <name> find placeholder "<text>" <action>` |
| fill via locator | `agent-browser --session <name> find label "<label>" fill "<value>"` |
| click ref | `agent-browser --session <name> click <ref>` |
| fill ref | `agent-browser --session <name> fill <ref> "<value>"` |
| type ref | `agent-browser --session <name> type <ref> "<text>"` |
| press key at current focus | `agent-browser --session <name> press "<key>"` |
| assert visible | `agent-browser --session <name> is visible <sel>` |
| wait for text | `agent-browser --session <name> wait --text "<text>"` |
| wait for URL | `agent-browser --session <name> wait --url "<glob>"` |
| screenshot | `agent-browser --session <name> screenshot <path>` |
| annotated screenshot | `agent-browser --session <name> screenshot --annotate <path>` |
| close | `agent-browser --session <name> close` |

The screenshot path is a positional argument — there is no `--filename` flag.
`--annotate` overlays numbered `[N]` labels matching `@eN` snapshot refs and prints
a legend. `screenshot` has two known limitations in this pinned version: it can
fail with an OS-level error under concurrent sessions (a transient condition —
retry once before treating it as a real failure), and it rejects an output path
containing a space — keep screenshot paths space-free (the kebab-case
session/description convention above already does this).

**`os error 35` (EAGAIN) can outlive the retry.** The transient failure above is
usually a single missed capture, but it has been observed to leave the daemon
session's screenshot pipeline permanently degraded: once a session hits `os error
35`, every later `screenshot`/`screenshot --annotate` call in that same daemon
session can exit `0` while returning a dead/stale frame — the retry-once guidance
does not recover this case, because the call is no longer failing, it is silently
returning wrong data. There is no in-CLI recovery for an already-degraded session
short of `agent-browser doctor` (restarts the daemon; ends every open session) or
closing this session and opening a fresh one. A consumer skill that judges
anything from a captured frame (not just the accessibility snapshot) must treat
every frame from a session that has hit this error as unreliable for the rest of
that session's life, not just retry the one failed call —
`plugin/agents/qa-agent.md`'s Screenshot Capture Degradation section implements
this for `/claude-tweaks:test qa`'s execution path.

`click` (both the ref form and the locator-based `find ... click` form) does
**not** auto-scroll the target into view — a below-the-fold click reports success
but lands nowhere. Pin a tall viewport (`set viewport <width> <height>`, below) so
the elements a story walk clicks stay in the visible area, rather than relying on
click to scroll for you. `plugin/agents/qa-agent.md`'s Setup step already applies
this as a `1440x1600` default whenever a story's `**Viewport:**` is unset, so this
note is enforced for `/claude-tweaks:test qa`'s own execution path, not advisory
only — a caller driving agent-browser outside that path still needs to set its own
viewport explicitly.

**A reported-success click is not proof the target's handler ran.** Both click
forms have been observed to report success on certain elements (repro: small
icon-sized buttons inside table rows) while the element's own registered click
handler never fires — no network request, no state change — even though the same
element responds correctly to a CSS-selector-based click, keyboard activation
(focus then `press "Enter"`), or a raw coordinate click. The locator resolved the
right element; the synthetic click dispatch itself was not equivalent to a
trusted user click for it. This is narrower than the below-the-fold case above
(which agent-browser reports honestly as "clicked, wrong place") — here the
command's own success signal cannot be trusted at all for the affected elements.
There is no reliable client-side workaround for the affected elements from this
plugin's usage surface (no `find ... select`-style fallback exists for it, and no
vendored source is available in this repo to patch the dispatch path itself) —
a story step whose `verify` immediately after such a click finds no expected
effect should not be assumed to mean the *app* is broken; `plugin/agents/qa-agent.md`'s
evidence-precedence rules call this out explicitly in its failure reporting so a
human triaging a QA report can distinguish this known tooling gap from a real
regression.

## Viewport and device

First-class flags for viewport and device emulation. Cross-platform — no shell-specific workarounds needed.

| Operation | Command |
|---|---|
| Set viewport | `agent-browser --session <name> set viewport <width> <height>` |
| Set device | `agent-browser --session <name> set device "<device-name>"` |

## Color scheme

Native `prefers-color-scheme` emulation — a session-startup flag, set once when the
session opens rather than a per-command action. Verified against agent-browser 0.27.0:
opening the same `prefers-color-scheme`-driven fixture under each value produces the
computed style the media query maps to (`--color-scheme light` → the light branch's
declared color; `--color-scheme dark` → the dark branch's) — confirmed via `get styles`
against a minimal fixture whose only styling is a `prefers-color-scheme: dark` media
query, not merely read off `--help`.

| Operation | Command |
|---|---|
| Open a session emulating dark mode | `agent-browser --session <name> --color-scheme dark open <url>` |
| Open a session emulating light mode | `agent-browser --session <name> --color-scheme light open <url>` |
| Open a session with no preference | `agent-browser --session <name> --color-scheme no-preference open <url>` |

Use this to verify a change scoped to the non-default color scheme in a project whose
theming is driven solely by `prefers-color-scheme` media queries (no in-app toggle) —
drive the live app in the scheme under test directly, rather than building a standalone
HTML fixture with the target CSS and scheme copied in. The flag applies for the life of
the session; open a second `--session` with the other value to compare both schemes side
by side.

## Batch mode

Run multiple operations in a single process invocation against one session.
Reduces token + latency overhead for multi-step walks.

```
agent-browser --session <name> batch "open <url>" "snapshot -i -c" "screenshot <path>"
```

Anti-pattern: do not batch across sessions. Each `batch` invocation is one session's
lifecycle.

## React introspection (opt-in)

Used by `/stories` source-aware mode (Step 1.5) when the source files are
`.tsx`/`.jsx`. Silent skip on non-React apps.

| Operation | Command |
|---|---|
| React component tree | `agent-browser --session <name> react tree` |
| Inspect component at ref | `agent-browser --session <name> react inspect <ref>` |

## Vitals

Captures Web Vitals (LCP, CLS, INP, TTFB, FCP). Used by `/visual-review` for the
"Performance" finding category.

```
agent-browser --session <name> vitals
```

## Trace (start early, save on failure)

Tracing is record-then-stop: a trace can only be saved for the interval after
`trace start` ran, so a validation or QA session that wants failure traces starts
recording immediately after `open` — there is no way to capture a trace
retroactively once a step has already failed.

```
agent-browser --session <name> trace start
# ... steps ...
agent-browser --session <name> trace stop .claude-tweaks/artifacts/traces/<session>/<timestamp>.zip   # on failure, BEFORE close
```

Path convention: `.claude-tweaks/artifacts/traces/<session>/<timestamp>.zip`. On success, just `close` —
recording ends with the session (`trace stop` without a path saves to a temp
directory, which is residue, not a discard). The output is a Chrome DevTools
trace: open it via Chrome DevTools → Performance → Load profile (there is no
`trace view` subcommand).

`.claude-tweaks/artifacts/` is tooling residue, not project content — it belongs in `.gitignore` (init's suggested block covers it),
and users manage retention/cleanup.

## Auth Vault

Stores credentials encrypted, locally. The LLM never sees passwords.

| Operation | Command |
|---|---|
| Save credentials (one-time, by user) | `agent-browser auth save <vault-name> --url <login-url> --username <user> --password <pass>` |
| Log a session in from the vault | `agent-browser --session <name> auth login <vault-name>` |
| List saved vaults | `agent-browser auth list` |

`auth save` also accepts `--password-stdin` so the password never lands in shell
history. `auth login` navigates to the saved login URL, waits for the form fields,
and submits — run it after `open` and before the first interactive step.

Stories reference a vault by name via the story-level `auth: { vault: "<name>" }`
field. See `skills/stories/SKILL.md` for the schema.

## Anti-Patterns

No local copy here — `SKILL.md`'s own Anti-Patterns table in this skill's directory is the single source of truth (same "no local copy" principle as the Operation Mapping section above). Read that table directly rather than relying on a second, independently-worded copy in this reference file — a copy here already drifted once (this table covered only CSS selectors where `SKILL.md`'s now covers CSS and XPath both).
