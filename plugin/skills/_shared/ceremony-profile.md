# Ceremony profile — the skip roster

`ceremony-profile` (`fast-lane` | `standard`) is stamped as a `ceremony:*` label by `/claude-tweaks:specify` (`docs/decisions/0006-ceremony-tiering-owned-by-specify.md`), folded into a run's `config.yml` by `flow/manifesto.md`, narrowed `standard` → `fast-lane` from diff facts for headless firings by `wrap-up/ceremony-derivation.md`, and raised back to `standard` only by `wrap-up/SKILL.md`'s Ceremony escape hatch. This file is the **single roster** of what each profile skips and what no profile may skip (#1926). Consumers cite it by name next to their own skip; none restates a row. `tests/ceremony-profile-roster.test.js` pins it: every `plugin/skills/**/*.md` line that mentions `fast-lane` together with `skip` must carry a tag from the Skips table's Step column, or match a row of the Mentions table.

## Skips by profile

| Step (tag) | Skipping profile | Condition | Citing file | Why the guarantee holds |
|---|---|---|---|---|
| `review-step-1` | `fast-lane` | Always under the profile | `review/code-mode-steps.md` Step 1 (Spec Compliance) | Spec compliance is exact per-record overhead independent of diff size; `[IL-145]` is the one recorded defect it let through, and the escape hatch exists because of it |
| `review-step-1.6` | `fast-lane` | Always under the profile | `review/code-mode-steps.md` Step 1.6, `review/cross-spec-promise-check.md` | Promise tables belong to multi-record parents; a fast-lane record's promise check re-runs at the parent's own gate |
| `review-step-4` | `fast-lane` | Always under the profile | `review/code-mode-steps.md` Step 4 (Implementation Hindsight) | Hindsight is narrative fixed cost; Steps 2, 3, and 5 — the judgment of the diff itself — never skip |
| `plan-audit` | `fast-lane` | Always under the profile (also: fewer than 3 file references and no `Scope keywords:`, any profile) | `build/SKILL.md` Common Step 1.5, `build/plan-audit.md` | A `ceremony-check` verdict of `fast-lane` is itself the judgment that the plan needs no scope-creep audit |
| `architecture-alignment` | `fast-lane` | Always under the profile (also: design mode with no spec; a trivial plan) | `build/SKILL.md` Common Step 4.5, `build/architecture-alignment.md` | Alignment compares built-vs-spec prose; a fast-lane diff is small enough for the lens review to see the whole of it |
| `reflect-light-mode` | `fast-lane` | Always under the profile | `wrap-up/SKILL.md` Reflect, `reflect/light-mode.md` | Surprises, Approach, and the tradeoff review are narrative; Near-misses, Fresh-start, and Friction still run and can still fire the escape hatch |
| `red-team-persona` | `fast-lane` | Always under the profile (one persona instead of three) | `specify/red-team.md` | The Skeptical Reviewer persona alone covers the framing check; the other two add breadth a fast-lane record's scope does not need |
| `sdd-whole-branch-review` | `fast-lane` | `--count-tasks` prints `tasks: 1` **and** `batched: false` (`batched: false` means no marker present — the batched-plan marker convention lives in `build/plan-authoring-checks.md`) (the SKIP literal is the record's own, pinned by `tests/ceremony-profile-roster.test.js`; it is written through `log-decision.js` like every other SKIP entry) | `build/dispatch.md` "Whole-branch review model" | With one task the task review's diff *is* the whole branch; every cross-task incident in `[IL-02]`/`[IL-04]`/`[IL-10]`/`[IL-97]`/`[IL-101]` needed two or more tasks (an empirical observation from this codebase's incident history, not a structural proof). Multi-task and batched plans keep the review |
| `polish` | `fast-lane` | Always under the profile (also, any profile: non-frontend spec, `no-polish`, Impeccable absent, design integration disabled, no audit findings and no refinement-set changes) (the SKIP literal is the record's own, pinned by `tests/ceremony-profile-roster.test.js`; it is written through `log-decision.js` like every other SKIP entry) | `flow/steps-and-gates.md` polish row, `flow/SKILL.md` | Polish is Impeccable refinement, not correctness; `/claude-tweaks:test`'s Design CLI gate and `/claude-tweaks:review` Step 6.5's read-only design judgment still run, so a design finding still reaches the escape hatch |

**Escape hatch and the build-side skips.** Every row above has already happened by the time `wrap-up/SKILL.md`'s Ceremony escape hatch fires (light mode included — `reflect/light-mode.md` says a pass is never retroactively widened); the downgrade to `standard` covers only that run's remaining wrap-up steps, never re-runs a skipped step, and never rewrites the record's `ceremony:*` label — a re-run of the same record is fast-lane again unless `/claude-tweaks:specify` re-stamps it.

**The two-call split is kept.** A fast-lane record still runs `/claude-tweaks:build` + `/claude-tweaks:test` and `/claude-tweaks:review` + `/claude-tweaks:wrap-up` as two calls (`dispatch/two-call-gate.md`): collapsing them saves only the second call's preflight and loses the clean-room review (`[IL-07]`, `[IL-130]`) — the last independent judgment a fast-lane record gets.

## Never skipped

| Step | Where | Why no profile may skip it |
|---|---|---|
| review Step 2 (Identify What Changed) | `review/code-mode-steps.md` | The diff shape is what every later step reasons from |
| review Step 3 (Code Review lenses) | `review/code-mode-steps.md` | The safety-relevant judgment the whole scheme protects |
| review Step 5 (Simplify) | `review/code-mode-steps.md` | Scoped to the diff already; nothing to cap |
| review Step 6 rendered-UI check | `review/code-mode-steps.md`, CLAUDE.md's merge precondition (#808) | A UI-dependent record must not reach a merge decision without a real rendered check or an explicit decline |
| build Common Step 5 (Final Verification) | `build/SKILL.md` | The producer of `VERIFICATION_PASSED`/the runner pass stamp |
| reflect Near-misses, Fresh-start, Friction | `reflect/light-mode.md` | The lenses that can still produce the Safety regression finding the escape hatch keys on |
| Ceremony escape hatch | `wrap-up/SKILL.md` | The control for `[IL-145]`'s failure class |
| `[IL-116]` cleanup floor | `wrap-up/cleanup-procedures.md` Section C, step 3.5 | Teardown ordering is a floor `cleanup-only` may never relax |
| HARD-GATEs | `_shared/auto-mode-contract.md` | Test failures, spec compliance blocks, structural coupling, plan validation stop every mode |
| `/claude-tweaks:test` Step 1.5 Design CLI gate | `test/design-gate.md` | The polish skip's safety argument leans on it |
| `/claude-tweaks:review` Step 6.5 Design Quality Pass | `review/code-mode-steps.md` | The polish skip's safety argument leans on it |

## Mentions that are not skips

Lines that pair `fast-lane` with `skip` without skipping a step. The conformance test exempts a line only when its file matches and the line contains the `Line contains` text.

| File | Line contains | Why it is not a skip |
|---|---|---|
| `review/SKILL.md` | `the \`fast-lane\` skips for Steps 1, 1.6, and 4` | A pointer to the three rows above |
| `review/review-summary-template.md` | `skipped — fast-lane` | Summary rendering of a row above |
| `review/review-summary-template.md` | `Skipped — ceremony-profile: fast-lane.` | Summary rendering of a row above |
| `review/review-effort-derivation.md` | `Step 1 is skipped under \`ceremony-profile: fast-lane\`` | An aside explaining why the label read is independent of Step 1 |
| `wrap-up/SKILL.md` | `Skip entirely when \`config.yml\`'s \`ceremony-profile\` is not \`fast-lane\`` | The escape hatch's own gate |
| `wrap-up/SKILL.md` | `the downgrade covers only this run's remaining wrap-up steps` | The escape hatch's re-run-is-fast-lane-again truth statement (#1926 I1) |
| `wrap-up/review-console.md` | `tag: fast-lane` | A merge-tag literal, not a ceremony skip |
| `wrap-up/ceremony-derivation.md` | `Skip this file.` | Derivation has nothing to do when the profile is already set |
| `_shared/ceremony-check-invocation.md` | `Skip the call entirely when \`facets.ceremony\`` | The ceremony-check CLI is skipped when a label already exists, at any profile |
| `_shared/fast-lane-digest.md` | `skips or narrows` | A restatement file that defers to this roster |
| `flow/steps-and-gates.md` | `a fast-lane run logs the polish SKIP` | The polish decision tree's entry line — the skip itself is the tagged `polish` row |
| `flow/steps-and-gates.md` | `removes it at polish's would-be exit` | The phase-exit paragraph's PR-checklist row handling — the skip itself is the tagged `polish` row |
| `flow/polish-execution.md` | `A skipped polish phase` | This file's own load-condition list — the skip itself is the tagged `polish` row |
| `flow/SKILL.md` | `Treating polish skip as a flow failure` | The anti-pattern table's skip-reason enumeration — the skip itself is the tagged `polish` row |
| `flow/summary-template.md` | `Skipped — fast-lane` | The Pipeline Summary's rendering of the tagged `polish` row |
| `build/SKILL.md` | `check the applicability gate in \`micro-plan.md\`` | Points at build's own #1911 micro-plan skip of `/superpowers:writing-plans` — a build-time plan-authoring choice, not one of this roster's ceremony-gate skips |
| `build/micro-plan.md` | `single-file fast-lane records skip` | Title heading naming the #1911 build-time skip, not a roster tag |
| `build/micro-plan.md` | `a hand-authored record, or one that skipped` | Describes a record that skipped `/specify` — unrelated to ceremony-gate skips |
| `build/micro-plan.md` | `fast-lane skip already uses` | Cites the roster's `architecture-alignment` row's own mechanism as precedent, not a new skip |
| `flow/materialize.md` | `decides whether to skip \`/superpowers:writing-plans\`` | Documents the #1911 build-time skip's header reader, not a roster ceremony-skip |
