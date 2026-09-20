# Build Options — full resolution rules, invocation examples, and the Record-vs-Spec-vs-Design mode table

Loaded by `/claude-tweaks:build` when the user (or this skill) needs the full matrix of execution and git strategies, the invocation grammar, or the record-vs-spec-vs-design mode lookup. The SKILL.md keeps a compact summary; this file owns the verbose detail.

## Build Options

Two orthogonal choices control how `/build` runs. Combine them freely:

| Axis | Option | Behavior | Best for |
|------|--------|----------|----------|
| **Execution** | `subagent` (default) | Invokes `/superpowers:subagent-driven-development`. Fresh subagent per task; one automated reviewer per task returns both a spec-compliance and a quality verdict — informed by the parent spec's own Acceptance Criteria excerpt, not just the task's own brief — then a single whole-branch review runs at the end. No human in the loop. Push commits promptly. | Solo work, trusted pipeline |
| **Execution** | `batched` | Invokes `/superpowers:executing-plans`. Executes 3 tasks per batch, pauses for human review after each batch. User approves, requests changes, or skips tasks. Push after each approved batch. | Complex specs, unfamiliar code, hands-on review |
| **Git** | `worktree` (default) | Before execution, invokes `/superpowers:using-git-worktrees` to create an isolated workspace with dependency install and baseline test verification. All commits land in the worktree on a feature branch. At handoff, delegates to `/superpowers:finishing-a-development-branch` (merge, PR, keep, or discard). | Parallel work, team projects, risky changes, safe automation |
| **Git** | `current-branch` | Commits land directly on the current branch. No isolation — simple and fast. | Quick local edits, no isolation needed |

When `.claude-tweaks/policy.yml` sets `worktree-always: true`, the Git axis above collapses to `worktree` only — `current-branch` is not offered by the prompt, is rejected if passed explicitly (see "Default resolution" step 0 below for what "rejected" means procedurally), and every invocation example and default-resolution rule below that mentions `current-branch` is inapplicable for a project with this policy on. The mechanical PreToolUse gate denies any edit outside a worktree regardless of what this file's defaults say (see `_shared/git-discipline.md`).

When `.claude-tweaks/policy.yml` sets `execution-strategy: subagent-only` (or `batched-only`), the Execution axis above collapses to that single strategy — the `-only` suffix is the lock: the other value is not offered by the prompt and is rejected if passed explicitly (same procedural meaning as above), and every invocation example and default-resolution rule below that mentions the locked-out value is inapplicable for a project with this policy on. Plain `subagent`/`batched` set an overridable default, not a lock. Unlike `worktree-always`, the lock has no mechanical backstop — there is no interceptable tool call for "which execution strategy did the assistant choose" — so this lever is honored by the assistant reading `.claude-tweaks/policy.yml`, the same as every other auto-mode-contract lever (see `_shared/git-discipline.md` for the full enforcement-asymmetry note).

```
/claude-tweaks:build 42                         → subagent + worktree (default)
/claude-tweaks:build 42 current-branch          → subagent + current branch (no isolation)
/claude-tweaks:build 42 batched                 → human-reviewed batches + worktree
/claude-tweaks:build 42 batched current-branch  → human-reviewed batches + current branch
/claude-tweaks:build 42 auto                    → subagent + worktree, no confirmations
/claude-tweaks:build 42 auto current-branch     → subagent + current-branch, no confirmations
```

### Default resolution

0. **Policy lever lock** (checked first): resolve `execution-strategy` — a `-only` value (`subagent-only`/`batched-only`) locks the Execution axis, and/or `worktree-always: true` locks the Git axis, fixing that axis outright — a locked axis is never asked about, and an explicit CLI argument that contradicts it (`batched` under `execution-strategy: subagent-only`, `current-branch` under `worktree-always`) is rejected rather than silently honored. Plain `execution-strategy` values (`subagent`/`batched`) are not locks — they are defaults an explicit argument overrides, applied at step 2 below. **What "rejected" means procedurally:** substitute the locked value for the contradicting argument (never hard-stop with an error, and never invent an `AskUserQuestion` prompt — the axis is locked, not a decision) and surface a single one-line inline notice before proceeding: `"{axis} is locked to {value} by .claude-tweaks/policy.yml — ignoring the {argument} argument."` This applies uniformly in both interactive and `auto` mode; it is not itself an auto-decision-log entry (no judgment was exercised — policy is definitional), just a visible heads-up so the user isn't left wondering why their argument had no effect. The remaining precedence order below applies only to axes not locked by policy.
1. Explicit arguments (`/claude-tweaks:build 42 batched current-branch`) — always win
2. Project policy — resolve both unlocked axes with ONE resolver call: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" execution-strategy git-strategy`, applying each envelope's `value` (its `source` field says whether `.claude-tweaks/policy.yml` set it or the schema default applied)
3. Fallback — the resolver's schema defaults, `subagent` + `worktree`, apply through the same call when policy is silent (no separate read)
4. `auto` keyword — skip intermediate confirmation prompts. Uses defaults (`subagent` + `worktree`) unless overridden. Architecture alignment (Common Step 4.5) auto-routes deviations per the auto-mode contract: Beneficial→AUTO (log spec edit commit), Update the spec→STAGED, Fix now→KEPT-PROMPT. Decisions that warrant human judgment are staged to the Wrap-Up Review Console rather than stopping the pipeline mid-flow — see `_shared/auto-mode-contract.md` for the silences inventory and the HARD-GATE exemption list.

## Input

`$ARGUMENTS` = record reference (`#N`), design doc path, or topic name — optionally followed by execution strategy (`batched`), git strategy (`worktree`), `auto`, and/or the standalone tokens `profile=<fast|standard|capable|frontier>` (Common Step 2 model-profile override) and `ops=confirm` (Step 2.5 auto-executable-command confirmation). All optional tokens are matched by keyword, not position — any order works (e.g. `/claude-tweaks:build #42 auto current-branch` and `/claude-tweaks:build #42 current-branch auto` are equivalent).

### Model profile override (`profile=`)

`tier=<fast|standard|capable|frontier>` is accepted as a backward-compatible alias for `profile=<...>` — parsed identically, resolving the same way, not a second independent code path. **Removal condition:** drop the `tier=` alias at the next minor version once one full release cycle has passed with no reported use.

| Token | Effect |
|---|---|
| `profile=fast` / `profile=standard` / `profile=capable` | Overrides the `size:`-derived per-task implementer profile for this run only (see Common Step 2). |
| `profile=frontier` (or the `tier=frontier` alias) | The human-typed hardest-build opt-in — reachable **only** via this literal typed token, never auto-selected. Full guard statement (canonical): `skills/build/dispatch.md` (read from Common Step 2) — cited here, not restated. |

**Two distinct bounds, not one.** `profile=frontier` requires the `subagent` execution strategy (`dispatch.md`'s strategy-precondition step) — this is a *sequential-dispatch* requirement satisfying the Subagent Contract's no-parallel-fan-out rule for Frontier, and it bounds nothing about spend by itself. The actual **cost bound** is the separate `frontier-run-cap` policy key (`.claude-tweaks/policy.yml`, default `3` — `_shared/subagent-dispatch-core.md`'s Model Selection section), enforced per dispatch by `bin/resolve-profile.js`.

**Mid-run degradation is normal, not an error.** A build can outlive its cap: with `frontier-run-cap: 3` and 6 tasks in the plan, tasks 1-3 dispatch at Frontier and tasks 4-6 resolve to Capable — each degradation is logged `AUTO` in the run's `decisions.md` via the resolver's `source`, and the build continues without stopping.

### Resolve the input

1. **Record reference** (e.g., `#42`; under `work-backend: local-files`, drop the `#`) → **Record mode** — primary input. Checked first, since a leading `#` (or, under `work-backend: local-files`, a bare id that resolves to an existing record) unambiguously means record mode. Resolved, shape-gated, and materialized via `skills/flow/materialize.md` into `{run-dir}/work/{n}-spec.md`; an unshaped record hard-stops with a pointer to `/claude-tweaks:specify #{n}`. Once materialized, that file is the spec for the rest of build — full lifecycle with spec compliance.
2. **Design doc path** (e.g., `docs/superpowers/specs/2026-02-21-meal-planning-design.md`) → **Design mode** — build directly from the design doc, skipping spec machinery
3. **Topic name** (e.g., `meal planning`) → search for a matching design doc in `docs/superpowers/specs/*-design.md` AND a matching record via the configured `work-backend`. If both exist, call `AskUserQuestion` with:

- `question`: `"Found both a work record and a design doc for '{topic}'. Which did you mean?"`, `header`: `"Build mode"`, `multiSelect`: `false`
- Option 1 — `label`: `"Record mode"`, `description`: `"#{N}: {title} — Full lifecycle with shape gate and tracking"`
- Option 2 — `label`: `"Design mode"`, `description`: `"{design doc filename} — Build directly, skip spec machinery"`

If only one exists, use it.
4. **No arguments** → check conversation context or recent git activity for clues. Ask if unclear.

### Prompt for build options

Before checking `$ARGUMENTS`, resolve any axis locked by policy: a `-only` `execution-strategy` value fixes Execution to its base strategy (`subagent-only` → `subagent`, `batched-only` → `batched`); `worktree-always: true` fixes Git to `worktree`. A policy-locked axis is never asked about, in any mode — auto or interactive — and counts as already resolved for the rest of this section.

When execution strategy AND git strategy are both still unresolved after policy and arguments, ask once — the two choices are correlated (the 2x2 above already enumerates the combinations), so they are one decision. Call `AskUserQuestion` with:

- `question`: `"How should this build run?"`, `header`: `"Build strategy"`, `multiSelect`: `false`
- Option 1 — `label`: `"Subagent + worktree (Recommended)"`, `description`: `"Automated review chain, isolated workspace"`
- Option 2 — `label`: `"Subagent + current-branch"`, `description`: `"Automated review chain, no isolation"`
- Option 3 — `label`: `"Batched + worktree"`, `description`: `"Human reviews every 3 tasks, isolated workspace"`
- Option 4 — `label`: `"Batched + current-branch"`, `description`: `"Human reviews every 3 tasks, no isolation"`

When only ONE axis is still unresolved (whether because an argument supplied the other, or policy locked it), call `AskUserQuestion` for just that one with a simple 2-option question instead. Skip the call entirely if both are resolved.

**In `auto` mode**, skip this prompt and use the `.claude-tweaks/policy.yml` / fallback values for any axis not already resolved by policy or an explicit argument (per the Pipeline Config Manifesto contract — see `_shared/auto-mode-contract.md`).

## Record vs Design mode

| Mode | Source | Skips | Best for |
|------|--------|-------|----------|
| **Record mode** | `#N` — materialized via `skills/flow/materialize.md` into `{run-dir}/work/{n}-spec.md` | Nothing | Primary input — a GitHub issue (or local record) shaped `ready` by `/claude-tweaks:specify` |
| **Design mode** | `docs/superpowers/specs/*-design.md` | `/claude-tweaks:specify`, prerequisite checks | Quick builds where the design doc is clear enough to execute directly |
