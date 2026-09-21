---
name: review
description: Use when a build is complete and you need analytical judgment on code quality, correctness, and simplicity before wrapping up. Gates on /claude-tweaks:test passing. The quality gate between implementation and lifecycle cleanup.
argument-hint: "[<spec-number>|<file-path>...|base:<ref>|visual <url-or-description>|journey:<name>|discover] [full] [low|medium|high|xhigh|max]"
---

# Review — Analytical Judgment Gate

Post-build quality gate. `/claude-tweaks:test` answers "does it work?" — `/claude-tweaks:review` answers "is it good?" Reviews, refines, and approves the code before handing off to wrap-up. Part of the workflow lifecycle:

Lifecycle: `/claude-tweaks:test` → **`/claude-tweaks:review`** → `/claude-tweaks:wrap-up`

## When to Use

- A `/claude-tweaks:build` session just finished and needs quality verification
- You want to verify code before creating a PR
- Code was written outside the workflow and needs a structured review
- `/claude-tweaks:help` recommends reviewing a spec that appears complete
- You need a visual browser review of the running application
- You want to discover and document user journeys in a brownfield project

## Overview

`/claude-tweaks:test` verifies that code works mechanically — types pass, lint is clean, tests are green, QA stories execute successfully. `/claude-tweaks:review` assumes all that has passed and asks a different question: is this code *good enough to ship?*

This skill is the analytical quality gate — spec compliance, human-judgment code review, and quality summary. Visual browser inspection is handled by `/claude-tweaks:visual-review`. Mechanical verification lives in `/claude-tweaks:test`.

## Review Modes

| Mode | Syntax | What runs |
|------|--------|-----------|
| **code** (default) | `/claude-tweaks:review 42` | Steps 1-7, including Step 6 (visual-review recommendation only, non-blocking), Step 6.5 (Design Quality Pass via Impeccable), and Step 6.7 (late findings routing): spec compliance, test gate, change analysis, code review, hindsight, simplification, visual-review recommendation, design quality pass, summary |
| **full** | `/claude-tweaks:review 42 full` | Code review (Steps 1-5) + visual browser review via `/claude-tweaks:visual-review` (Step 6) + Design Quality Pass via Impeccable (Step 6.5) + late findings routing (Step 6.7) + summary (Step 7) |
| **visual** | `/claude-tweaks:review visual {url}` | Delegates entirely to `/claude-tweaks:visual-review` — page mode |
| **journey** | `/claude-tweaks:review journey:{name}` | Delegates entirely to `/claude-tweaks:visual-review` — journey mode |
| **discover** | `/claude-tweaks:review discover` | Delegates entirely to `/claude-tweaks:visual-review` — discover mode |

Code mode is the default. Append `full` to include a visual pass after code review. Use `visual`, `journey:`, or `discover` for browser-only reviews — these delegate entirely to `/claude-tweaks:visual-review`.

When invoked by `/claude-tweaks:flow`, review runs in **full** mode by default (code + visual). Flow handles browser detection and falls back to code mode when no browser backend is available.

**Effort** is a separate, orthogonal argument — see Input resolution below and `code-mode-steps.md`'s Step 2.5. It applies only within `code`/`full` modes (where Steps 1-7's lens system runs); it's a no-op when combined with `visual`, `journey:`, or `discover`, which delegate entirely to `/claude-tweaks:visual-review` and skip Steps 1-7 outright.

## Input

`$ARGUMENTS` = spec number, file paths, a `base:{ref}` scope, mode, effort tier, or visual review target.

### Resolve the input:

1. **Spec number** (e.g., "42") — find all files changed for that spec via git history. Mode: code.
2. **Spec number + `full`** (e.g., "42 full") — code review + visual browser review
3. **File paths** — review those specific files. Mode: code. Append `full` (e.g. `/claude-tweaks:review src/foo.ts full`) to run full mode instead — code review scoped to those files, followed by a visual browser review pass (Step 6). With no spec to resolve an explicit journey/URL target, Step 6 falls back to `/claude-tweaks:visual-review discover`'s own UI-file/affected-journey detection, same as code mode's Step 6 behavior.
4. **`visual` + URL or description** (e.g., "visual http://localhost:3000") — browser review only (page mode)
5. **`journey:{name}`** (e.g., "journey:checkout") — browser review only (journey mode)
6. **`discover`** — browser review only (discover mode)
7. **No arguments** — resolve changed files per `_shared/scope-resolution.md`'s deterministic fallback ladder. Mode: code. Append `full` (e.g. `/claude-tweaks:review full`) to run full mode on this same git-diff-derived scope — code review followed by a visual browser review pass (Step 6), resolved via `/claude-tweaks:visual-review discover`'s UI-file/affected-journey detection since no spec exists to look up an explicit target.
8. **Effort token** — the literal `low`, `medium`, `high`, `xhigh`, or `max`, appearing anywhere among the other tokens above (e.g. `/claude-tweaks:review 42 high` or `/claude-tweaks:review 42 full xhigh`). Sets the `review-effort` tier explicitly (see `code-mode-steps.md` Step 2.5), overriding derivation. Order-independent relative to the other tokens. Unambiguous against the rest of this grammar — spec numbers are numeric, `full`/`visual`/`journey:`/`discover` are fixed keywords that never collide with the five effort words. A standalone effort token with no other tokens (e.g. `/claude-tweaks:review high`) sets the tier and otherwise falls back to rule 7 — no spec number, so scope resolves per rule 7's ladder, same as no arguments at all.
9. **`base:{ref}`** (e.g. `/claude-tweaks:review base:v1.2.0`, `base:v1.2.0 high`) — a whole-branch scope: every first-parent commit from `{ref}` to `origin/{integration-branch}` (the integration branch per `_shared/integration-branch.md`, fetched first), spanning many already-merged PRs. Mode: code. No spec exists to check, so Step 1 is skipped; Step 2's `{base}` is `{ref}` and `{branch}` is `origin/{integration-branch}` (the first-parent walk, never `--merges` exclusion — every squash-merged PR is one commit on that line); effort derives from the diff heuristic unless rule 8's token is given. This is the pre-bump gate `/claude-tweaks:release` Step 3 runs (design stance 8, `[IL-97]`) — findings stage per `_shared/staged-patch.md` exactly as on a spec review, and Step 7's summary records the tier.

In visual, journey, and discover modes, delegate entirely to `/claude-tweaks:visual-review` — skip Steps 1-7 (an effort token passed alongside one of these mode keywords is silently ignored, since Steps 1-7 are exactly where the lens system it gates lives).

**Flow-context default.** When `$PIPELINE_RUN_DIR` is set (this invocation is running inside a pipeline — `/claude-tweaks:flow` or another orchestrator) and none of rules 2/4/5/6's mode tokens (`full`/`visual`/`journey:`/`discover`) appear anywhere in `$ARGUMENTS`, rules 1 and 7's `Mode: code` resolves to **full** mode instead — code review followed by a visual browser review pass (Step 6). This makes the Overview's documented "flow invokes review in full mode by default" promise self-enforcing rather than dependent on the flow executor remembering to type `full`. An explicit mode token in `$ARGUMENTS` (`full`/`visual`/`journey:`/`discover`) always wins over this default. Standalone invocation (no `$PIPELINE_RUN_DIR`) is unaffected — rules 1 and 7 still resolve to code mode there, unchanged.

## Code-Mode Procedure (Steps 1-7)

**Fast-lane shortcut.** When a pipeline run directory's `config.yml` already reads
`ceremony-profile: fast-lane` (roster tag `review-step-1`, `_shared/ceremony-profile.md`), read
`_shared/fast-lane-digest.md` first — it names every
skip/narrow decision below in one place. It never replaces `code-mode-steps.md`'s actual step
content (Steps 1.5, 2, 2.5, 3-3.6, 5, 6, 6.5, 6.7, 7 still run there); it only saves re-deriving
the skip list for Steps 1, 1.6, and 4 from that file's own header.

In `code` and `full` mode, read `code-mode-steps.md` in this skill's directory now and execute its Steps 1-7 in order. It holds the full procedure: Ceremony-Aware Step Selection (the `fast-lane` skips for Steps 1, 1.6, and 4), Spec Compliance (1), the Test Gate with the verification pass stamp (1.5), Cross-Spec Promises (1.6), change analysis with the Merge-Provenance Check (2), review-effort derivation (2.5), the lens-based code review with its dispatch/debate/routing sub-files (3-3.6 and Step 3 Routing), Implementation Hindsight (4), Simplification (5), Visual Review (6), the Design Quality Pass (6.5), the consolidated late findings routing (6.7), and the summary with verdict (7).

`visual`/`journey`/`discover` modes never read that file — the whole procedure is out of scope for them by the delegation rule above.

## Next Actions

Next Actions are rendered as part of Step 7's review summary — they live in `review-summary-template.md` (the "Next Actions" block at the bottom of the template), conditioned on the verdict (PASS or BLOCKED). The template's signal-driven table determines which options surface (e.g., visual-review options appear only when journeys are affected and a browser is available).

See `review-summary-template.md` in this skill's directory for the full Next Actions tables.

## Component-Skill Contract

`/claude-tweaks:review` is invoked by `/claude-tweaks:flow` as the analytical-quality gate between test and wrap-up. Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (set by `/flow`, `/build`, or other pipeline orchestrators). Direct invocations may pass `--source <parent>` as an explicit fallback. When `$PIPELINE_RUN_DIR` is set, omit the Next Actions block at the end of Step 7's summary — the parent `/flow` owns the handoff and renders its own Pipeline Summary + Next Actions. When invoked directly by a user, render Next Actions per `review-summary-template.md`. /review itself invokes `/claude-tweaks:reflect` (Step 4), `/claude-tweaks:simplify` (Step 5), `/claude-tweaks:visual-review` (Step 6), and `/claude-tweaks:design-wrapper` (Step 6.5) — each is a component skill governed by its own contract (Next-Actions omitted when invoked from here).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Reviewing incomplete specs | Wastes effort — Step 1's spec compliance check catches it, but don't skip it |
| Skipping the test gate to "save time" | Broken code invalidates the review — `/test` must pass first |
| Reviewing unrelated code | Scope creep — only review files changed in the current work |
| Accepting all Implementation Hindsight findings as-is | The action gate exists — "change now" items must be fixed |
| Running review without a prior build | Review assumes recently written code — not a codebase-wide audit |
| Listing code review findings without routing them | Every finding resolves explicitly: fix now, defer with context, or don't fix with stated reason. No implicit drops. |
| Putting findings only in the summary table | The summary records resolutions, not observations. Route first (Step 3 Routing), then summarize (Step 7). |
| Running verification or QA directly in review | Mechanical checks belong in `/claude-tweaks:test` — review gates on it passing, never duplicates it |
| Treating Design Quality findings as authoritative | LLM critiques are opinionated — advisory only; the user judges which to action. Phase 1's design wrapper is read-only. |
| Auto-fixing Design Quality findings in Step 6.5 | Phase 1's design wrapper is read-only; code-modifying behavior ships in Phase 2's polish phase. Route findings through Step 6.7's late findings routing to action them. |
