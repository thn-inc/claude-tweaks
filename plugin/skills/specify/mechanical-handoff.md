# Specify — Mechanical-Handoff Template (Steps 3-9 subagent dispatch)

Canonical dispatch prompt for delegating decomposition mode's mechanical range — Step 3 through
Step 9, all in `decomposition-mode-closeout.md` (this skill's directory) — to a subagent, once
the interactive Steps in `decomposition-mode.md` (1, 2, 2.6, 2.5, 2.5d) have resolved in the main
thread. Read this file only when actually delegating; the default single-threaded path (the same
thread continues straight from Step 2.5d into `decomposition-mode-closeout.md`'s Step 3) never
loads it, and never changes because this file exists.

Per the Subagent Contract (`_shared/subagent-output-contract.md`): the agent only sees what's in
its own prompt — references to sibling files, or to "the conversation above," don't reach it.
Every input Steps 3-9 need from the interactive steps must therefore be composed into the dispatch
prompt explicitly, below. This template is genuinely reusable across every decomposition shape
this skill supports — a design doc with resolved overlap, one with resolved ambiguity, a
`phase-N`-scoped decomposition, and the `needs:definition` origin-redirect — because the
required-inputs list is exhaustive, not repro-case-specific: an input a given run doesn't carry
(e.g. no frontend surface, so no Step 2.5 answers) is simply omitted from that run's composed
prompt, never a reason to fork the template.

## Required inputs (compose every one that applies — never partial)

| Input | Source | Why Steps 3-9 need it |
|---|---|---|
| Work-unit list | Step 2's decomposition output — each unit's title, technical approach, key files, draft acceptance criteria, sizing/type signal | Step 3 turns each unit into a sub-issue body |
| Collapse decision | Step 2.6's verdict — kept-parent / 2-unit independent collapse / 1-unit collapse, plus the parent's own draft body when kept | Step 3 branches its whole create sequence on this; Step 9's summary and origin-closure logic both read it |
| Dependency graph | Step 1's Overlap Analysis resolutions (`Blocked by #N` from companion/extend/replace decisions) plus Step 2's Implicit Dependency Detection groups (file-overlap flags) | Step 4 (Link and order) wires every relationship this pass produces |
| Step 2.5 answers (frontend specs only — omit entirely for backend/infra) | `design-intent:`, `ui-stack:`, and the resolved `shape` from Step 2.5 | Step 3 writes these onto each sub-issue's metadata lines |
| Accepted scaffold path (frontend specs only — omit unless Step 2.5b-ii's variant exploration ran and a direction was accepted) | Step 2.5b-ii's `visual_reference` output (`design-pre-steps.md` item 5) | Step 3 prefixes `Visual-reference: {scaffold path}` on every generated sub-issue covering that surface — `record-creation-subissues.md`'s Body section (#1346's split of `record-creation.md`) |
| Diagram suggestions (omit if Step 2.5d emitted none) | Step 2.5d's output — at most two recommendations | Step 9's summary renders them under `### Diagram suggestions` |
| Design doc — path and, if it will be deleted before the subagent could read it, its full content | Resolve-the-input | Step 4 absorbs remaining Decision Rationale / Assumptions / Cross-Spec Promises from it; Step 7 deletes it (or marks it, under `phase-N`) |
| `phase-N` (omit if this run is not phase-scoped) | The invocation's own argument | Step 7's delete-vs-mark table branches on whether this run targeted one phase of a multi-phase doc |
| `--surface` override (omit if not given) | The invocation's own argument | Step 3 applies it to every produced record |
| `$ORIGIN_RECORD_NUM` (omit unless this run was reached via the `needs:definition` redirect) | `specify/SKILL.md`'s Resolve-the-input case 1 | Step 3's origin-set carve-out and Step 9's origin-closure branch both key off this |
| `$PIPELINE_RUN_DIR`, `work-backend` | Run context | Every write call in Steps 3-9 is driver-conditional and, in `auto` mode, logs to this run's `decisions.md` |

## Dispatch prompt

```
Task scope: Execute decomposition mode's mechanical range — Step 3 through Step 9 — for the
decomposition described below. Read `decomposition-mode-closeout.md` in
`plugin/skills/specify/` for the full procedure (record creation, linking, the multi-persona
red-team dispatch, self-review, deletion of the consumed design doc, and the Step 9
summary/commit). Do not read `decomposition-mode.md` — its interactive Steps (1-2.5d) have
already resolved; everything you need from them is provided below.

Work units: {Step 2's list — title, technical approach, key files, draft acceptance criteria,
sizing/type per unit}
Collapse decision: {Step 2.6's verdict, plus the parent's draft body when kept}
Dependency graph: {Blocked-by links from Step 1's Overlap Analysis + Step 2's Implicit
Dependency Detection groups}
Design doc: {path, or full content when it will be deleted before you could read it}
[Design pre-step answers — frontend specs only: design-intent: {value}, ui-stack: {value},
shape: {value}]
[Accepted scaffold path — frontend specs only, omit unless Step 2.5b-ii accepted a variant:
Visual-reference: {scaffold path}]
[Diagram suggestions — omit if none: {Step 2.5d's output}]
[phase-N: {value} — omit if this run is not phase-scoped]
[--surface: {value} — omit if not given]
[$ORIGIN_RECORD_NUM: {value} — omit unless this run entered via the needs:definition redirect]
Run context: work-backend={value}, PIPELINE_RUN_DIR={value}

OUTPUT FORMAT (required): Return the Step 9 summary exactly as `decomposition-mode-closeout.md`'s
own Step 9 template renders it (Work Units Created table, Collapse outcome line, Existing Records
Modified, Artifacts Removed, Diagram suggestions when present, Actions Performed table) — no
paraphrase, so the caller can relay it without having watched the work happen.

Status line (required): after the summary above, on its own trailing line — the last non-empty
line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```

`[Use: Standard]` — resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`.
This is a whole-procedure execution dispatch (record creation through commit), not a lightweight
fan-out, so it warrants Standard rather than Fast; it is a single dispatch, not a fan-out, so the
Subagent Contract's per-fan-out Frontier restriction doesn't apply either way.
