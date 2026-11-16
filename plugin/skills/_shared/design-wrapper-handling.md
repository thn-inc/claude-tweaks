# Design Wrapper Result Handling

Canonical contract for skills that invoke `/claude-tweaks:design-wrapper <mode>`. The wrapper returns one of four shape categories; this file defines what each means and how callers should respond.

Referenced from `/build` (Common Step 1.7 / pre-build), `/test` (Step 1.5 / test), `/review` (Step 6.5 / review), and any future caller. Each caller keeps its own mode-specific Result Handling table — this file documents the **universal return shapes** and the **why-skips-don't-fail** rationale so callers don't duplicate them.

## Return shapes

| Shape | When | What the caller does |
|-------|------|---------------------|
| `{result: "ok" \| "pass" \| "advisory", ...}` | The mode ran and produced output | Act on the output per the mode's contract (inject references, fail on errors, surface findings — see each caller's mode-specific table). |
| `{result: "fail", findings: [...]}` | The mode ran and found blocking issues (e.g., `test` mode found `severity: warning`) | Fail the caller's gate. Surface findings to the user. Do not auto-fix — design findings require human judgment. |
| `{skipped: {reason: ...}}` | Non-frontend project, Impeccable not installed, kill-switch disabled, no UI files in diff, or other legitimate skip condition | Note the skip in the caller's log and proceed. **Skip is not a failure.** |
| `{deferred: {reason: ...}}` | Reserved shape for a future decision-staging outcome — no mode currently returns this (see below) | Treat as skip and proceed. |

## Why skips don't fail

The wrapper skips for legitimate, non-error reasons:

- The project is backend-only (no frontend files detected).
- The Impeccable plugin is not installed.
- The kill switch is enabled (`design-integration: disabled` in project policy).
- There are no UI files in the changed diff.

None of these are errors. The design CLI is a value-add on frontend projects — its absence must never block a passing build, test, or review. Callers report the skip reason in their summary and continue.

## Why `deferred` is reserved but currently unused

No mode's actual "Output to caller" contract (`design-wrapper/modes/*.md`) ever returns `{deferred: ...}` today — including `survey`, whose full return contract resolves only to `{mode, result: "ok", context, recommendations, suppressed}` or a skip object (see `design-wrapper/modes/survey.md`). This shape is defined here for callers to handle defensively, in case a future mode adds a genuine decision-staging outcome. If a caller receives `{deferred: ...}` from any mode today, that is a wrapper bug; treat as skip and proceed (the wrapper will log it for follow-up).

## Why `live` mode has no auto-mode branch

Every other mode either runs deterministically or degrades to a skip under `auto`. `live` cannot — it hands control to a human clicking in their own browser, which structurally requires a human to be present. Callers must gate invocation to interactive, standalone contexts themselves; the wrapper's own preconditions do not (and cannot) enforce this, since "is a human present" isn't a signal the wrapper can check.

## Routing findings into Step 3 (for `/review`)

When `/review` receives `{result: "advisory", findings: [...]}` and the user wants to action design findings inline, treat each finding as an additional row in the Code Review Findings table with category `Design Quality`. This keeps the resolution mechanics consistent with code-review findings (fix now / defer / accept).

## Routing references into the implementer (for `/build`)

When `/build` receives `{result: "ok", loaded: [...], context_size: <n>}` from `pre-build`, inject the loaded reference paths and contents into the implementer subagent's prompt. When `context_size` exceeds the implementer's budget (rough threshold: 8000 tokens), summarize the references rather than passing them whole.

## Caller-side pre-check (skip the `Skill()` load when the wrapper would no-op)

The invocation, the `skip`/`proceed` handling and the rules for when the wrapper is skipped live in `_shared/skill-load-gate.md` (`bin/skill-gate.js`) — callers cite that file, not this one. `bin/design-detect.js` stays the wrapper's own Layers 1-3 twin, used by the wrapper's own preconditions (`design-wrapper/SKILL.md`). Where a caller passes `--surface`, it finds the value this way:

- `--surface` — the record's materialized header `surface:` field (`flow/materialize.md`), when exactly one record is in scope (read from the frontmatter of `$PIPELINE_RUN_DIR/work/*-spec.md` when present — a `current-branch` run — else of the worktree mirror `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, where `{worktree}` is `run-state.json`'s `worktree` (else `worktreeAtClose`; a per-spec `spec-{N}/` run dir takes it from the parent run's `run-state.json`) and `{run-id}` is the run dir's path after its `.claude-tweaks/pipelines/` segment — a worktree run commits the header only on its branch, so the main-checkout run dir holds none until merge). Omit when no single record is resolvable (a multi-record run scoped to more than one spec, or a standalone invocation with no active pipeline run) — the CLI degrades to a `null` surface exactly as the wrapper's own Layer 2 does when no `Surface:` line exists, and Layer 1/Layer 3 still apply. Never approximate a surface value by other means (label text, file-path guessing) — omitting the flag is the only correct way to say "unknown."
