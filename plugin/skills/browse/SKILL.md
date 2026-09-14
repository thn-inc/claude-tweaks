---
name: browse
description: Use when you need browser automation via agent-browser — defines session naming, screenshot/trace paths, and operation vocabulary used by /stories, /visual-review, /review, and /demo. Keywords - browse, browser, agent-browser, screenshot, scrape, automation.
argument-hint: "[<url>|<task description>] [--session <name> ...] [set viewport <wxh>|set device \"<name>\"] [backend=chrome ...] [--quick]"
---

# Browse — Browser Conventions

Conventions skill for browser automation. Defines session naming, screenshot/trace paths, lifecycle, and the abstract operation vocabulary that `/claude-tweaks:stories`, `/claude-tweaks:visual-review`, `/claude-tweaks:review`, `/claude-tweaks:demo`, and the `qa-agent` all speak. Concrete `agent-browser` syntax lives in `agent-browser-reference.md` in this skill's directory.

```
                             [ /claude-tweaks:browse ] ← utility (no fixed lifecycle position)
                                        ↑
   Used by: /claude-tweaks:stories, /claude-tweaks:visual-review,
            /claude-tweaks:review (visual + qa modes), /claude-tweaks:demo
            (Validate — headless entry-point check), qa-agent, ad-hoc tasks
```

## When to Use

- `/claude-tweaks:stories` is exploring a site or validating generated stories against the live DOM
- `/claude-tweaks:visual-review` is walking pages or journeys for UI quality findings
- `/claude-tweaks:review` is running its visual or QA modes
- `/claude-tweaks:demo`'s Validate step opens and closes a headless session at a record's resolved entry point to confirm it renders (Show then hands the browser to the human directly via `open`/`xdg-open` — no agent-browser session held)
- A consumer skill needs to dispatch parallel agents that each drive a browser
- Ad-hoc browser ops — navigate, screenshot, scrape, fill a form, check a deployment

## Requirements

`agent-browser` must be installed. See `_shared/browser-detection.md` for the detect / install / verify procedure, daemon lifecycle (auto-starts on port 4848), and recovery (`agent-browser doctor`).

## Input

`$ARGUMENTS` is freeform — a URL, a task description, or a session-management command. There is no fixed argument schema; the skill translates the request into one or more `agent-browser` operations.

| Pattern | Example | Behavior |
|---------|---------|----------|
| *(none)* | — | List active sessions (`agent-browser session list`) if any are open; otherwise show session conventions and exit |
| `<URL>` | `https://example.com` | Open a default session at the URL and snapshot |
| `<task description>` | `walk the checkout flow on https://example.com` | Plan and execute multi-step ops to satisfy the task |
| `--session <name> open <URL>` | `--session checkout-flow open https://example.com` | Open a named session |
| `--session <name> click <ref>` | `--session checkout-flow click @e12` | Operate within a named session (ref resolved via a prior `find`, e.g. `find role button --name Pay`) |
| `set viewport <wxh>` | `set viewport 1280x800` | Adjust viewport for the active session |
| `set device "<name>"` | `set device "iPhone 14"` | Emulate a device profile |
| `backend=chrome <URL or task>` | `backend=chrome https://app.example.com/settings` | Routes through the native `mcp__claude-in-chrome__*` tools (user's live authenticated Chrome session) instead of `agent-browser`. Human-invoked only. |
| `--quick` | `https://example.com --quick` | Human-invoked ad-hoc mode: relaxes the minimum-two-screenshot and mandatory-trace-on-failure conventions for this invocation only (see Conventions Defined Here). Never used by `/stories`, `/visual-review`, `/review`, `qa-agent`, `/flow`, or a Routine. |

See `agent-browser-reference.md` in this skill's directory for the full operation vocabulary (snapshot, find, fill, type, vitals, trace, batch, react, auth vault, viewport/device flags).

`backend=chrome` is a narrow escape hatch, not a second backend: it covers navigate, read page, click, type/fill, and screenshot only — no vitals, trace, react introspection, or auth vault (the session is already authenticated, so the vault has no job). It is never auto-selected and must never be used by `/stories`, `/visual-review`, `/review`, `qa-agent`, `/flow`, or a Routine — those stay `agent-browser`-only, per `CLAUDE.md`'s `Don'ts`.

## Workflow

For direct invocation (bare URL or task description, not a knowledge-dependency read by a parent skill):

1. Confirm `agent-browser` is installed (see Requirements) — run the detect/verify step from `_shared/browser-detection.md` if not already confirmed this session.
2. Resolve a session name — reuse `--session <name>` if given, otherwise derive a kebab-case name from the task (see Session naming below).
3. Translate the request into ops: `open` the URL, `snapshot`, then `find`/`click`/`fill`/`type` as needed to satisfy a task description. For a bare URL, `open` + `snapshot` is sufficient.
4. Screenshot per the Screenshot path convention (minimum two: initial load, final state) — unless `--quick` is set, see Conventions Defined Here.
5. On any step failure: capture a trace, include its path in the failure report, then close the session.
6. Close the session when the task is done.

## Conventions Defined Here

These are the contract every browser-touching skill follows.

### Session naming

Kebab-case, derived from purpose. One session per parallel agent, one per QA story instance. Session names are visible in the dashboard and in trace paths, so make them descriptive.

Examples: `checkout-flow`, `signup-neg-1`, `pricing-page-review`, `qa-cart-empty-state`.

### Screenshot path

```
.claude-tweaks/artifacts/screenshots/browse/<session>/<NN>_<description>.png
```

`<NN>` is a zero-padded sequence number; `<description>` is a short kebab-case label. Example: `.claude-tweaks/artifacts/screenshots/browse/checkout-flow/02_payment-error.png`.

Minimum two screenshots per task: one after initial load, one at the final state. Annotated screenshots (numbered overlays matching snapshot refs) follow the same path convention. `--quick` (human-invoked, direct ad-hoc use only) relaxes this minimum — see Input.

### Trace path

```
.claude-tweaks/artifacts/traces/<session>/<timestamp>.zip
```

Capture a trace before closing a session whenever a step fails. Failure reports must include the trace path. Artifacts older than 30 days are surfaced for deletion by `/tidy`'s residue sweep (the `artifact` residue finding). `--quick` (human-invoked, direct ad-hoc use only) waives mandatory trace-on-failure for the current invocation — see Input. `/stories`, `/visual-review`, `/review`, `qa-agent`, `/flow`, and Routines never set `--quick`; the full evidentiary discipline stays mandatory for those consumers regardless of how they invoke browser ops.

### Lifecycle

```
open  →  ops (snapshot, find, click, fill, screenshot, vitals, …)  →  close
```

Daemon is implicit. Always close the session when the task is done — leaked sessions consume resources. On step failure: capture trace, then close. List sessions with `agent-browser session list` if you suspect leaks.

### Operation vocabulary

Consumer skills speak abstract operation names (open, snapshot, find, click, fill, type, screenshot, vitals, trace, close, batch, react, auth vault, viewport/device flags, …). No local copy of the concrete mappings lives here — `agent-browser-reference.md` in this skill's directory is the single source of truth for every operation-to-command translation. Read that file directly before invoking commands you do not have memorized; a copy here would drift the moment the reference file's CLI syntax changes.

## Parallel Sessions

Each parallel agent gets its own `--session <unique-name>`. One browser instance per session. Memory cost scales with the number of concurrent sessions, not with the number of commands sent to a session — so reuse a session for sequential ops on the same page, and spin up a fresh session per parallel agent or per QA story instance.

> **Parallel execution:** Dispatch independent browser walks as parallel Task agents — each opens its own session, runs its ops, and returns a per-session result. Assemble results after all agents complete.
>
> **Contract:** Each agent follows `_shared/subagent-output-contract.md` — minimal input, status line first, output template inlined verbatim. [Use: Standard] — browser-walk agents do multi-step navigation and structured observation, which exceeds Fast-profile mechanical extraction. Upgrade to Capable only if the walk requires synthesis of subjective UX judgment. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (`_shared/subagent-dispatch-core.md` § Model Selection). Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.
>
> **Output template:** a browse walk that reports issues/findings uses `_shared/subagent-dispatch-core.md`'s
> Template A; one that reports navigation locations/references uses `_shared/subagent-output-contract.md`'s
> Template B. Read the naming file for the literal template text and inline it verbatim in the
> dispatch prompt — this file only names which one a browse walk uses, it is not the template's
> source. Each agent's first reply line must still be one of `DONE / DONE_WITH_CONCERNS /
> NEEDS_CONTEXT / BLOCKED`, then the chosen template.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:visual-review {url}`** — run a structured visual review against the page or journey just driven (recommended)
`/claude-tweaks:stories` — generate or refresh QA story YAML files from the live DOM
`/claude-tweaks:review {spec} full` — full review pipeline including code, visual, and QA passes
`/claude-tweaks:capture "{idea}"` — save an idea surfaced while exploring the browser

## Component-Skill Contract

`/claude-tweaks:browse` is a conventions skill — it documents the operation vocabulary for `agent-browser` and is consumed transitively by `/claude-tweaks:stories`, `/claude-tweaks:visual-review`, `/claude-tweaks:review`, `/claude-tweaks:demo`, and the registered `qa-agent`. Those callers either inline the relevant operation text directly in their own dispatch prompts (parallel-session pattern) or call `agent-browser` commands by name; they do not "invoke" /browse as a workflow step. As a result, the `## Next Actions` block renders only when a user invokes `/browse` directly — when a parent skill is using these conventions as a knowledge dependency, no parent handoff exists to defer to and no Next Actions render in the parent's context. Detection: there is no `PIPELINE_RUN_DIR` signal because /browse never runs as a pipeline stage.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Polling the dashboard programmatically | `http://localhost:4848` is a human debug surface — scraping is brittle and unsupported |
| Storing `@eN` snapshot refs in YAML or persisted artifacts | Refs are session-scoped and regenerate every snapshot — resolve at runtime via `find` |
| Batching across sessions | One `agent-browser batch` owns one session's lifecycle — never mix session names |
| Using CSS or XPath selectors with `find` | Schema v2 forbids CSS/XPath — semantic locators only (role, name, text, testid, label, placeholder) |
| Generic session names (`test`, `session1`) | Names show up in dashboards and trace paths — derive from purpose |
| Forgetting to close sessions | Leaked sessions consume memory — `close` at the end of a run |
| Skipping the trace on failure | Failure reports without a trace path aren't actionable — capture before closing |
| A consumer skill routes through `backend=chrome` | Breaks portability to hosted Routines — `agent-browser` is the only headless-capable backend; human-invoked only |
| A consumer skill (`/stories`, `/visual-review`, `/review`, `qa-agent`, `/flow`, a Routine) sets `--quick` | Weakens the evidentiary discipline those flows depend on — `--quick` is for human-invoked ad-hoc checks only |
| Skipping `set viewport`/`set device` and relying on env vars | Env-var workarounds are unsupported — use the first-class `set viewport`/`set device` commands |
