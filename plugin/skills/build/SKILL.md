---
name: build
description: Use when implementing a work record or design doc end-to-end. Accepts a record reference (#N) for full lifecycle tracking, or a design doc path to skip /claude-tweaks:specify and build directly from brainstorming output.
argument-hint: "[#<n>|<design-doc-path>|<topic>] [subagent|batched] [auto] [worktree|current-branch] [profile=<fast|standard|capable|frontier>] [ops=confirm]"
---

# Build — Implement a spec end-to-end with worktree, plan audit, and lifecycle tracking

Implement a spec or design doc end-to-end: plan it, build it, simplify it, verify it, and capture the journeys it enables. Part of the workflow lifecycle:

```
/claude-tweaks:init → /claude-tweaks:capture → /superpowers:brainstorming → /claude-tweaks:specify → [ /claude-tweaks:build ] → /claude-tweaks:stories → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
                                                            ↑                                          ^^^^ YOU ARE HERE ^^^^   ↑
                                                            └── or skip directly ──────────────────────────────────────────────┘
```

## When to Use

- A spec is ready to build (prerequisites met, plan exists or will be created)
- A design doc is ready for direct implementation (skipping /claude-tweaks:specify)
- /claude-tweaks:help recommends building a specific spec
- Resuming a partially-completed build

## Input

`$ARGUMENTS` is parsed as `[#<n>|<design-doc-path>|<topic>] [subagent|batched] [auto] [worktree|current-branch] [profile=<fast|standard|capable|frontier>] [ops=confirm]` — see Build Options and Git Strategy below for what each token resolves to.

## Build Options (summary)

The axes below are orthogonal and combine freely. Default is `subagent` + `worktree`.

| Axis | Options | Default |
|------|---------|---------|
| **Execution** | `subagent` (automated review chain) / `batched` (3-task human-reviewed batches) | `subagent` |
| **Git** | `worktree` (isolated branch) / `current-branch` (direct commits) | `worktree` |
| **Auto** | `auto` keyword — applies `.claude-tweaks/policy.yml` / fallback defaults, skips confirmation prompts, routes deviations per `_shared/auto-mode-contract.md` | off |

When `.claude-tweaks/policy.yml` sets `worktree-always: true`, the Git axis has only one value: `current-branch` is not offered and is rejected if passed explicitly — the mechanical PreToolUse gate would deny any edit outside a worktree regardless (see `_shared/git-discipline.md`).

When `.claude-tweaks/policy.yml` sets `execution-strategy: subagent-only` (or `batched-only`), the Execution axis has only one value — the `-only` suffix is the lock: the other strategy is not offered and is rejected if passed explicitly. Plain `subagent`/`batched` set an overridable default, not a lock. Unlike the Git axis, there is no mechanical backstop for the lock (see `_shared/git-discipline.md`).

("Rejected" means: substitute the locked value and surface a one-line inline notice, never a hard error or an `AskUserQuestion` prompt — see `build-options.md`'s "Default resolution" step 0 for the exact wording.)

Read `build-options.md` in this skill's directory for the full options matrix, invocation grammar (six combinations), default-resolution order, the build-options prompt template, the record-vs-design mode table, and the input-resolution rules. `$ARGUMENTS` = record reference (`#N`, primary) / design doc path / topic name, optionally followed by execution strategy, git strategy, `auto`, and/or the standalone tokens `profile=<fast|standard|capable|frontier>` (Common Step 2 model-profile override, see that step; `tier=<...>` is still accepted as a backward-compatible alias — see `build-options.md`'s Model profile override section) and `ops=confirm` (Step 2.5 auto-executable-command confirmation, see that step). Tokens are matched by keyword, not position — any order is accepted.

## Workflow

```
Resolve input
    ↓
Spec/record mode? ──yes──→ [Spec Steps 1, 2, 2.5 (Manual Steps classification), 3]
    │                       ↓
    no (design mode)        │
    ↓                       │
[Design Steps 1-3]         │
    ↓                       │
    └───────────────────────┘
                ↓
        [Common Steps 1-7]
```

---

## Spec Mode

### Spec Step 1: Resolve, Materialize, and Assess

Materialize the record into a spec-shaped build file via `skills/flow/materialize.md`: resolve the record, run the materialization hard gate (an unshaped body stops the build with "run `/claude-tweaks:specify #{n}` first"), compose the pinned header, and write + commit `{run-dir}/work/{n}-spec.md`. **Ordering — worktree first:** in `worktree` mode, run Common Step 1 to create the worktree from current HEAD, then perform this resolve/materialize/commit as the branch's first commit inside it, before proceeding to Spec Step 2. In `current-branch` mode there is no worktree, so write and commit on the current branch directly. Do not materialize on the pre-worktree branch and then branch from it — that order is denied outright under `worktree-always: true` and buys nothing under any other policy. See materialize.md's "When this runs" for the rationale; this step does not restate it. When a parent `/claude-tweaks:flow` already materialized the file for this run (`$PIPELINE_RUN_DIR` set and `{run-dir}/work/{n}-spec.md` already exists), read it in place instead of re-fetching or re-composing — see materialize.md's "When this runs." **Immediately after the materialize commit, in `worktree` mode only:** run `build/worktree-setup.md` Step 6 — opens the run's draft PR under `integration-model: pr-first` (`_shared/integration-model.md`, procedure in `_shared/pr-early-run-lifecycle.md`); a no-op under `local-merge`. **On skip** (local-merge), write a `SKIP` entry — see `_shared/pr-early-run-lifecycle.md`'s Skip / degrade behavior section for the exact command. **Non-skippable, regardless of what Spec Step 2's implementation assessment turns out to find:** Common Step 1's worktree-assignment stamping (`worktree-setup.md` Step 4.5, `record-worktree`) and this Step 6 draft-PR call both run before any judgment about whether further code changes are needed — never treat "the acceptance criteria already look satisfied" as license to jump past either. A record found already-satisfied still needs its own PR and its own worktree stamp: the reconciler's automatic worktree-reap and run-dir archival (`bin/hooks.js reconcile`) key off that stamp, and skipping it silently strands the run's cleanup on whoever dispatched it (`docs/incident-log.md`'s `[IL-131]`). This is now also caught mechanically, not just by this prose: `docs/hooks.md`'s bookkeeping-stamps gate denies the next covered write once a materialize commit has landed without both stamps present. Once materialized (and the draft PR opened, when applicable), read the file in full and proceed to Spec Step 2; the shape gate already replaces the prerequisite check this step used to run.

### Spec Step 2: Check for Existing Plan

**Premise-check routing first (#1829).** Read `premise.satisfiedAtBase` from the materialize envelope (`skills/flow/materialize.md`'s "Premise check" paragraph) before searching for a plan. When `true` — the record's own `Premise-check:` command exited non-zero at this checkout's base, meaning the Current State claim it named no longer holds — do not search for a plan or proceed to Spec Step 3: route directly to the Wrap-Up Review Console's staged-close surface (the `staged/premise-satisfied-{n}.md` proposal materialize.js already wrote) rather than planning a build against a premise that is already gone. When `premise` is `null` (no `Premise-check:` line, or the check itself couldn't run), this paragraph is a no-op — proceed below exactly as before.

Search `docs/superpowers/plans/` for a plan matching this spec (by number, topic, or date) — this is where `/superpowers:writing-plans` actually writes execution plans (see Spec Step 3 below); `docs/plans/` holds claude-tweaks pipeline state (ledger, audit caches), not plans.

#### If a plan exists:

- Read it and compare against the spec — has the spec evolved since the plan was written?
- Check what's already implemented (search codebase for files, routes, tests referenced in the plan)
- If the plan is still valid and work remains, skip to Common Step 2
- If the plan is stale (spec changed, codebase diverged), proceed to Spec Step 3

#### If no plan exists:

Proceed to Spec Step 3.

### Spec Step 2.5: Classify and Seed Manual Steps

If the spec has a "Manual Steps" section, classify each item before deciding what to do with it. "Outside the codebase" is not the same as "human-only" — many such tasks have CLIs and should be executed inline rather than dumped to the ledger.

> **Parallel execution:** Use parallel tool calls — the CLI/credential probes for each Manual Steps item are independent Bash operations and should run concurrently, the same shape `operational-checklist.md`'s Common Step 5.5 already parallelizes for its own probes.

For each item, probe in this order:

1. **CLI/API check** — infer the relevant tool from the item text, then probe: `which terraform`, `which vercel`, `which gh`, `which fly`, `which wrangler`, `which stripe`, `which ldcli`, `which aws`, `which gcloud`, etc.
2. **Credential check** — if a tool exists, are creds present? Use `{tool} auth status` (or equivalent: `gh auth status`, `vercel whoami`, `fly auth whoami`, expected env var, config file at the documented path).
3. **Triage:**
   - **Auto-executable** (tool + creds present) — execute now via Bash. In `auto` mode, log command, exit code, and one-line outcome to `decisions.md`. In interactive mode, surface the command and result inline. Do NOT seed the ledger. **`ops=confirm` token:** when present in `$ARGUMENTS`, do not execute automatically even here — call `AskUserQuestion` with the exact command and a one-line description of its effect, options "Run it (Recommended)" and "Skip — seed to ledger instead," before running (or, if skipped, seed as `ops` with `(reason-not-auto: user-declined)`). This applies in both interactive and `auto` mode — `ops=confirm` is a stronger, explicit opt-in for operational/secret-mutating commands specifically, so it is not silenced by `auto`.
   - **Auth-gap** (tool present, creds missing) — in interactive mode, surface the one-time `{tool} login` command and wait; on success, fall through to auto-execute. In `auto` mode, seed as `ops` with `(reason-not-auto: auth-not-configured)` so the user can resolve at the wrap-up Review Console.
   - **Truly manual** (no CLI, requires human judgment, requires signoff) — seed as `ops` with the matching `(reason-not-auto: …)` qualifier from `_shared/ledger-format.md`'s Required-for-ops section.

If the ledger doesn't exist, create it using the ledger skill's create operation.

**Anti-pattern:** Seeding the entire Manual Steps section verbatim into `ops` without probing. The spec writer cannot know which CLIs are installed on the executing machine — that classification must happen here, at execution time, where probes can actually run.

**No Manual Steps section (skip):** write one `SKIP` entry per the degrade-trace rule (`_shared/auto-decision-log.md`) — condition: no Manual Steps section → fallback: nothing probed. Standalone: list in the handoff instead.

### Spec Step 3: Create the Plan

**Micro-plan check first (#1911):** before invoking `/superpowers:writing-plans`, check the applicability gate in `micro-plan.md` in this skill's directory — a `ceremony: fast-lane` + `size: low` header whose `### Key Files` names at most one implementation file composes a one-task plan directly, skipping this skill and `plan-audit.md` entirely. Read that file for the full gate, the composed plan's exact shape, the skip-logging call, and the NEEDS_CONTEXT escape hatch. Any other header shape falls through to the normal path below unchanged.

**Assumption verification (#1769).** Before invoking `/superpowers:writing-plans`, scan the spec's `## Gotchas` for every `ASSUMPTION — verify at build:` bullet (`_shared/premise-verification.md`'s marker) and re-verify each against this worktree with that file's probe forms (`git ls-files`/`git grep -n -F`). Log the outcome — confirmed, or reversed naming the probe that reversed it — as one `decisions.md` line per `_shared/auto-decision-log.md`. A reversed assumption is not silently dropped: fold the corrected fact into the context handed to `/superpowers:writing-plans` below in place of the original claim.

Invoke the `/superpowers:writing-plans` skill. After it saves the plan file, **stop the skill and return here** — do not let it present an execution choice or invoke an execution skill. `/build` controls execution strategy.

Context to provide to `/superpowers:writing-plans`:
- The full spec content (including Current State, Gotchas, and acceptance criteria) — with any reversed `ASSUMPTION — verify at build:` claim (above) replaced by its corrected fact
- Any existing progress identified in Spec Step 2

The plan will be written to `docs/superpowers/plans/YYYY-MM-DD-{feature}.md`.

**Plan header artifact:** Every plan written by `/superpowers:writing-plans` starts with a "For agentic workers" block that advertises `subagent-driven-development` (recommended) or `executing-plans` as the next step. **Ignore it.** `/build` controls execution strategy — the header is boilerplate from writing-plans's general-purpose handoff. Do not treat it as guidance for this build. (Same rule applies in Design Step 3 below.)

**Plan-authoring checks:** before finalizing the plan, run every check in `plan-authoring-checks.md` in this skill's directory — one bold paragraph per check; the file, not this sentence, is the list (the enumeration that used to sit here had already fallen two checks behind it). (Same checks apply in Design Step 3 below.)

**Size-headroom check:** when a plan task appends to a `skills/_shared/*.md` or `SKILL.md` file already within ~10% of the 45 KB ceiling, measure `wc -c` against the ceiling on the merge base and name the split up front in the plan — since #1990 the per-file test only warns, and it's the composed-bytes gate (`context-cost.js`'s `overComposedCeiling`) at that file's compose call site(s) that actually fails. (Same check applies in Design Step 3 below.)

Proceed to **Common Step 2**.

---

## Design Mode

### Design Step 1: Read the Design Doc

- Read the full design doc
- Scan the codebase for existing files, schemas, APIs, and patterns relevant to the design

### Design Step 2: Check for Existing Plan

Search `docs/superpowers/plans/` for an execution plan matching this design doc (by topic or date). Follow the same evaluation procedure as Spec Step 2 above, substituting the design doc for the spec as the comparison artifact: read the plan and compare it against the design doc (has the design evolved since?), check what's already implemented, and decide stale vs. valid.

- If a plan exists and is still valid → skip to Common Step 2
- If no plan or plan is stale → proceed to Design Step 3

### Design Step 3: Create the Plan

Invoke the `/superpowers:writing-plans` skill. After it saves the plan file, **stop the skill and return here** — do not let it present an execution choice or invoke an execution skill. `/build` controls execution strategy.

Context to provide to `/superpowers:writing-plans`:
- The full design doc content
- Relevant codebase context (existing files, patterns, schemas)

<IMPORTANT>
Design mode has no spec with structured acceptance criteria. When providing context to `/superpowers:writing-plans`, extract testable outcomes from the design doc's decisions and recommendations. If the design doc lacks clear success criteria, ask the user to confirm what "done" looks like before proceeding.
</IMPORTANT>

The plan will be written to `docs/superpowers/plans/YYYY-MM-DD-{feature}.md`. Same plan-header artifact rule and plan-authoring check as Spec Step 3 apply (ignore the "For agentic workers" boilerplate).

Proceed to **Common Step 2**.

---

## Common Steps (both modes)

### Common Step 1: Set Up Worktree (worktree strategy only)

If the user specified `worktree`, set up the isolated workspace via `/superpowers:using-git-worktrees` after a pre-flight branch-divergence check and (when in auto mode) pre-authorizing the consent prompt.

For the full procedure (pre-flight branch-divergence check with auto-mode behavior, consent prompt handling, and worktree-creation failure recovery table), read the composed `worktree-setup` bundle rather than the two source files separately whenever `$PIPELINE_RUN_DIR` is already set (a `/claude-tweaks:flow`-parented build exports it before this step): `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step worktree-setup "${CLAUDE_PLUGIN_ROOT}/skills/_shared/worktree-setup.md" "${CLAUDE_PLUGIN_ROOT}/skills/build/worktree-setup.md"`, then read `$PIPELINE_RUN_DIR/context/worktree-setup.md` — the shared staleness-protection procedures (`_shared/worktree-setup.md`) followed by this skill's own entry path (`worktree-setup.md` in this skill's directory). A standalone `/build` (record or design mode) normally reaches this step with no `$PIPELINE_RUN_DIR` — record mode mints its directory later, at Spec Step 1's materialize, and design mode never mints one — so unless one already resolves (`_shared/run-dir-resolution.md`'s step 2 most-recent-matching-directory step, or the inline-export resume form) it reads the two files directly; if the compose command is unavailable or exits non-zero, read the named source files directly.

If the user did not specify `worktree`, skip this step.

### Common Step 1.5: Plan Audit

Audit the plan against the actual repo before dispatching execution, via `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" {plan-file} [--repo-root {dir}] [--count-tasks] [--bytes]` — a mechanized CLI (#903), not hand-run greps. Five checks:
- **Check A (always):** verify every path in the plan's Files: sections exists (or its parent directory exists for Create/Test, or is created by another Create/Test entry in the same plan).
- **Check B (conditional):** when the plan declares `Scope keywords:`, an fs-walk sweeps the repo for each keyword and lists any matched files not in the plan.
- **Check C (always):** pre-run each task's own declared Step 2 `Run:`/`Expected: FAIL` verification command once, read-only, against current repo state before dispatch; stop unconditionally if a command already exhibits a passing signature despite declaring `Expected: FAIL`. An append-shaped task (Step 1 appends to an existing, already-passing file) is not a finding — reported under `appendShaped` instead. A `warnings` entry (Step 2 present but unparseable) is informational only — never a stop, even though the summary line names Check C.
- **Check D (always):** scan the raw plan text for a control byte other than tab/LF/CR (e.g. a raw NUL) — an unconditional stop, the one check the skip gate below does not cover.
- **Headroom (always):** for each existing governed-corpus `.md` file (`plugin/skills/**/*.md`) the plan modifies, current bytes + headroom against the shared ceiling constant — a soft `nearCeiling` flag never fails the check; a `breach` (already at/over the ceiling) does.

**Auto mode** (including a standalone `auto` invocation with no pipeline run dir): apply the `scope-creep` policy, resolved per the standard precedence (default `add-to-plan`). **Interactive mode:** call `AskUserQuestion` with three options: "Add to plan and continue" (Recommended), "Continue without", "Stop".

**Skip this step entirely when** the plan has fewer than 3 file references (trivial plans don't benefit from audit) AND no `Scope keywords:` field is present, **or** when `config.yml`'s `ceremony-profile` is `fast-lane` (read fresh from the run directory) — roster tag `plan-audit`, `_shared/ceremony-profile.md`, which holds the rationale. Standalone `/build` (no `config.yml`) always falls back to the size-based condition alone. **Even on this skip path, still run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" {plan-file} --bytes`** and treat `checkD.ok === false` as the same unconditional stop — Check D is the one check this gate does not cover (a byte scan on text already in memory costs nothing, and a raw NUL is exactly as fatal in a small plan as a large one). This is the full gate — deciding skip-vs-run never requires loading `plan-audit.md` itself.

> **Project setting:** When `.claude-tweaks/policy.yml` declares `scope-keywords-required: true`, plans without a `Scope keywords:` field are treated as failed audits (require the field, not just optional). See `plan-audit.md` for the policy table.

For the full procedure (CLI invocation and JSON envelope, Check A/headroom failure handling, Check B scope-keyword sweep, Check C verification-command pre-check, `scope-keywords-required` setting, auto-mode policy table, interactive prompt), read `plan-audit.md` in this skill's directory.

### Common Step 1.7: Design Pre-Build (frontend specs + terminal)

For a surface routed to pre-build — `surface` ∈ `web | mobile | desktop | terminal`, read from the materialized header's `surface:` field (lifted from the record body's `Surface:` metadata line per `skills/flow/materialize.md`) — invoke `/claude-tweaks:design-wrapper pre-build <spec>` to lazy-load relevant design references into the implementer subagent's context. For the full skip conditions, invocation rules, result handling, the terminal-track always-load set, and where loaded references go, see `design-prebuild.md` in this skill's directory. **On skip**, write a `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule; standalone: list in the Step 7 handoff.

### Common Step 2: Execute the Plan

Execution depends on the chosen execution strategy (see Build Options). **These two are the only licensed strategies** — read `execution-mode-policy.md` in this skill's directory (record #491) for why an interactive session executing the plan directly, bypassing Task dispatch entirely, is never a third option — applies identically to standalone `/build` and `/flow`-orchestrated `/build`.

> **Working Directory Discipline:** Before any commit (and before dispatching subagents that run `git` or `node --test`), anchor the working directory explicitly — `pwd` + `git rev-parse --show-toplevel` must match the worktree path (or the project root in `current-branch` strategy). When dispatching subagents, require them to use `cd "$WORKTREE" && …` or `git -C "$WORKTREE" …`. See the Working Directory Discipline section of `_shared/subagent-dispatch-core.md` for the full pattern.

> **Cherry-pick source-branch PR check (#1957):** worktree strategy only. After each commit lands in this worktree, before moving to the next task, run `worktree-setup.md`'s "Cherry-pick source-branch PR check" section — a git-native `(cherry picked from commit {sha})` trailer scan that stops the build (not a silenceable auto-mode lever) when the cherry-picked source is also reachable from another record's branch that backs a still-open PR (#1821's incident). No trailer on the commit means no added work — the check is a no-op for the common case of an ordinary authored commit.

**subagent** (default): read `dispatch.md` in this skill's directory and follow its full dispatch procedure — profile resolution, `tier=` alias handling, AC-forwarding, and review-model pinning. After the final code review completes, **stop the skill and return here** — do not let it invoke `/superpowers:finishing-a-development-branch`.

**batched**: Invoke `/superpowers:executing-plans`. After the last batch completes, **stop the skill and return here** — do not let it invoke `/superpowers:finishing-a-development-branch`. `/build` handles post-execution steps before any branch finishing.

**Maturity-scaled test discipline (both strategies, all modes):** resolve `project-maturity` once per build — `MATURITY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values project-maturity)`. The resolver's schema default is `greenfield`, and a value outside the four-item enum also resolves to `greenfield` — either way, add nothing. Fold one additional instruction into whichever execution skill was invoked above:

| Maturity | Added instruction |
|---|---|
| `greenfield` / `pre-launch` (or missing) | None |
| `early-production` | "For any task modifying pre-existing behavior, write a quick smoke test capturing current behavior before changing it." |
| `established` | "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them." |

"Pre-existing behavior" is judged by the implementer subagent itself, per task, using the same judgment it already applies deciding what to test under normal TDD — this does not introduce new mechanical file-existence or lexical-verb detection to make that call for it.

**Scope and edit discipline (both strategies, every maturity):** fold this instruction into whichever execution skill was invoked above, unconditionally and in exactly these words — they are the project CLAUDE.md Working Approach block's own sentences, quoted so an implementer receives them whether or not the project's CLAUDE.md carries that block: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same." Two rules govern how it composes. A maturity row above, when present, names a test the repo's convention calls for — the implementer writes it; the quoted instruction limits extras, never a mandated test. A follow-up an implementer reports is this skill's to route, never left in the reply: a blocking one goes to the open-items ledger and a non-blocking one is filed via `/claude-tweaks:capture`, both per Common Step 4 below.

#### Superpowers Failure Handling

If the execution skill (or `/superpowers:writing-plans` in Step 3) fails, read `failure-recovery.md` in this skill's directory for the full recovery table (not-installed, timeout/partial output, malformed plan, subagent failures, batch rejection) and the project-specific context CLAUDE.md should document for implementer subagents.

### Common Steps 3 + 4.5: Simplification and Alignment

Common Step 3 (Code Simplification) and Common Step 4.5 (Architecture Alignment Check) operate on independent concerns, but both can independently commit (Step 3's simplifier changes; Step 4.5's Beneficial-classification spec updates) — running them concurrently risks the same shared-worktree git-index race CLAUDE.md's own Don'ts section warns against (a `git add`/`git commit` from one step sweeping in the other's concurrently-staged files). Run them sequentially instead: complete Common Step 3 (including its own commit, if any) before starting Common Step 4.5. Common Step 5 (Final Verification) gates after both are done.

### Common Step 3: Code Simplification

After all implementation tasks are complete, run `/claude-tweaks:simplify` on the recently modified code (files changed during this build session).

The simplify skill handles scope resolution, running the code-simplifier subagent, and re-verification after changes. See `/claude-tweaks:simplify` for details.

If the simplifier makes changes, commit them separately.

**If the `/claude-tweaks:simplify` dispatch itself fails transiently** (not a simplification finding — the dispatch call erroring out), see `failure-recovery.md`'s **Anything else** row: verify actual state (`git diff`, `git log`) before redoing, then retry rather than improvising.

### Common Step 4: Handle Blocked Work

If any part of the plan is blocked (missing infrastructure, unresolved dependencies, pending external work):

1. Document blocked items:
   - **Record mode:** add to the materialized spec file under a "Blocked / Future Work" section
   - **Design mode:** file a backlog work record via `/claude-tweaks:capture`
2. Note what unblocks them
3. Append blocked items to the open items ledger (see `/claude-tweaks:ledger`) with phase `build/*` and status `open`
4. These are resolved by the ledger resolve gate (`/claude-tweaks:ledger resolve`), run by `/claude-tweaks:wrap-up`'s Phase 3 ledger gate or `/claude-tweaks:flow` Step 5 — not by `/claude-tweaks:help`, which does not scan ledger files

**Follow-up ideas (independent of blocking).** If, while implementing, you notice an opportunistic improvement or idea outside the current spec/design's scope — not blocking the current work, just observed in passing — file it via `/claude-tweaks:capture` as a fresh backlog work record before it's lost, rather than inflating this build's scope. This applies in both spec and design mode, and runs regardless of whether any part of the plan is actually blocked.

### Common Step 4.5: Architecture Alignment Check

Compare what was actually built to what the spec or design doc said. For the full diff procedure, mismatch categorization (Beneficial / Fix now / Update the spec), the batch decision table format (interactive vs. auto-mode handling), and the Skill Observation sub-step, read `architecture-alignment.md` in this skill's directory.

Architecture-alignment learnings that outlive this project route via `skills/_shared/learning-routing.md` rather than defaulting to a ledger entry.

**Skip this step if:** design mode with no formal spec, the plan was trivial (< 3 tasks, single-file changes), or `config.yml`'s `ceremony-profile` is `fast-lane` — roster tag `architecture-alignment`, `_shared/ceremony-profile.md` (the rationale and the safety net live there; `architecture-alignment.md`'s own Skip section keeps only the three conditions). **On skip** (one of the three conditions fires — never for a normal run finding zero deviations), write a `SKIP` entry per the degrade-trace rule; standalone: list in the handoff.

When a mismatch is an architectural deviation at module level — a boundary in the wrong place, an interface nearly as complex as what it wraps — route it to `/claude-tweaks:deepen` for a dedicated module-depth pass rather than to Common Step 3's `/claude-tweaks:simplify`, whose scope is line-level cleanup.

### Common Step 5: Final Verification

After code simplification, run the shared verification procedure (`skills/test/verification.md`). This runs type checking, linting, and tests using the project's commands from CLAUDE.md.

**Note:** `/build` always runs verification (it is the *producer* of `VERIFICATION_PASSED` and of the runner-written pass stamp, #1921). The skip-if-recent rule in `test/verification.md` applies only to `/test` callers — never to this step. On a pass, read `VERIFICATION_SHA` from `report.json`'s `sha` and pass it forward with `VERIFICATION_PASSED=true`, so `/test`'s skip-if-recent check can detect a tree change between this step and its own invocation instead of trusting a bare boolean.

If anything fails, fix it and commit the fix. **When a failure is a behavioral bug — not a mechanical type/lint error — follow the reproduce-first discipline in `_shared/reproduce-first-discipline.md` before changing code** (reproduce on command, fix the confirmed cause, escalate rather than guess if it can't be reproduced; once green, walk the causal-depth chain per the discipline's step 3) — see `failure-recovery.md` for the fuller recovery table this step falls back to.

### Common Step 5.5: Operational Checklist

After verification passes, check for operational tasks that are easy to forget — deployment and environment concerns that slip through code review (schema/migration files, env access patterns, IaC, CI/CD, container configs).

If your build's diff matches schema/env/IaC/CI/platform-config files, read `operational-checklist.md` in this skill's directory for the full Category A/B trigger lists, check tables, probe-then-classify procedure, and ledger format. Otherwise skip this step entirely. **On skip**, write a `SKIP` entry per the degrade-trace rule (condition: no schema/env/IaC/CI/platform-config files in diff); standalone: list in the handoff.

> **Parallel execution:** Use parallel tool calls — all checks are independent Grep/Glob operations.

### Common Step 6: User Journey Capture

After verification passes, run `/claude-tweaks:journeys`. Pass:
- **Changed files** — files modified during this build session
- **Spec or design doc context** — what was built and why

The journeys skill handles scanning existing journeys, creating new journey files, updating existing ones, and committing. See `/claude-tweaks:journeys` for details.

This is not optional and does not require user input — if you built a feature that any persona interacts with (end user, admin, developer, internal tooling user), the journeys skill documents it.

### Common Step 6.5: Documentation Sync

If `docs/REGISTRY.md` exists, read `docs-sync.md` in this skill's directory for the full procedure (read registry, match changed files against registered patterns, update inline or defer to wrap-up per doc type). If `docs/REGISTRY.md` does not exist, skip this step entirely. **On skip**, write a `SKIP` entry per the degrade-trace rule (condition: no `docs/REGISTRY.md`); standalone: list in the handoff.

### Common Step 7: Handoff

After successful build, read `handoff-template.md` in this skill's directory and render the handoff using that template. The template covers verification status, what was built, simplification summary, journeys, documentation changes, blocked items, manual steps, and the Actions Performed table.

**Bookkeeping assertion (`worktree` mode, before the phase-exit push below — #2311).** Read this run's `run-state.json`: if it carries no `worktree` field, run `record-worktree` now (`build/worktree-setup.md` Step 4.5) rather than assuming an earlier attempt already succeeded — a denied bookkeeping-stamp write earlier in this same phase can leave this field missing with no downstream signal until the next push is rejected (`[IL-131]`). Under `integration-model: pr-first`, also check for a `pr` field; if absent, run `_shared/pr-early-run-lifecycle.md`'s push-and-open-draft-PR procedure now. This mirrors `flow/steps-and-gates.md`'s case-3 adoption-recovery backfill exactly (cite it, never restate its mechanics) — the difference is this check runs unconditionally at the end of every build phase, not only when a later call adopts this run directory from an earlier one, so a single continuous `/flow` session (build through wrap-up, never re-adopting its own run dir) gets the same protection a two-call `dispatch build,test` → `review,polish,wrap-up` handoff already had. Log a decision entry only when a backfill actually ran (`AUTO {time} — Common Step 7 bookkeeping assertion: backfilled {worktree registration | PR-early lifecycle} before phase-exit push. Reversibility: high.`) — a clean pass (both fields already present) writes nothing.

**Phase exit (`worktree` mode, `integration-model: pr-first` — `_shared/integration-model.md`):** push the branch and flip this phase's PR checklist row — `_shared/git-discipline.md`'s Phase-exit push section and `_shared/pr-checklist-refresh.md`'s Phase-checklist update section. A no-op under `local-merge` or `current-branch` mode. **On skip**, write a `SKIP` entry — see `_shared/git-discipline.md`'s Phase-exit push section for the exact command.

## Git Strategy

**worktree** (default): Before any work begins, `/superpowers:using-git-worktrees` creates an isolated workspace on a feature branch. All commits land in the worktree. At handoff, `/superpowers:finishing-a-development-branch` handles merge, PR, or discard — do NOT auto-merge or auto-PR.

**current-branch**: Commit directly on the current branch. No isolation. Unavailable when `.claude-tweaks/policy.yml` sets `worktree-always: true` — the mechanical PreToolUse gate denies edits outside a worktree regardless of what this lever says.

## Git Rules

These rules apply in ALL modes. See `_shared/git-discipline.md` for the canonical Git Rules table (never reset, never force push, stage specific files only, verify commits landed, etc.) and the merge conflict resolution procedure. After resolving a merge conflict, run verification (Common Step 5) to confirm the resolution didn't break anything.

## Autonomy Rules

These apply in **subagent** execution strategy. In **batched** strategy, autonomy rules apply within each batch but execution pauses between batches for human review.

- **Do not ask for feedback** during execution. Make reasonable decisions and keep moving.
- **Do not ask "should I proceed?"** — yes, you should. Always.
- **Do not present options** — pick the best one and implement it.
- **If ambiguous**, choose the simpler approach and note the alternative in a code comment.

## Next Actions

Generate 2-4 lines based on context. The signal-to-option lookup table below stays as-is — it's the assistant's own logic for picking which lines apply to the current build's signals, never itself shown to the user:

| Signal | Option |
|--------|--------|
| UI changed + browser available | `/claude-tweaks:review {N} full` — code + visual review **(Recommended)** |
| No browser or no UI | `/claude-tweaks:review {N}` — code review **(Recommended)** |
| QA stories exist (`stories/*.yaml` or `stories/*.yml`) | `/claude-tweaks:test qa` — validate {X} QA stories before review |
| Worktree mode | `/superpowers:finishing-a-development-branch` — merge, PR, or discard the feature branch (never the recommended slot — see below) |

Once the signals are resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention), one line per applicable signal, bolding whichever line is recommended and suffixing it `(recommended)`. **The recommended slot is always the review line** — chosen per the browser-availability signal above (do not collapse the two branches into always-`full`: UI changed AND a browser is available → the full-review line; otherwise → the plain-review line). **The finish-branch line is never the recommended slot, in worktree mode or otherwise** (#808): `/build`'s own lifecycle diagram runs review before finishing the branch (`/build → /stories → /test → /review → /wrap-up`), and recommending the finish-branch line over review let a UI-dependent build reach `finishing-a-development-branch`'s merge decision — "Implementation complete. What would you like to do?" — before any browser-based visual check had run. The UI-changed signal driving the top row is the same `Surface:`/frontend-detection signal `frontend-detection.md`'s Layer 2/3 (in the `/claude-tweaks:design-wrapper` skill's directory) defines and `/claude-tweaks:specify`'s Step 2.5a already uses, so a backend-only build (no UI changed) is unaffected — it still gets the plain-review line recommended, exactly as before:

`/claude-tweaks:review {N} full` — code + visual review (when UI changed and a browser is available)
`/claude-tweaks:review {N}` — code review (when no UI change or no browser)
`/claude-tweaks:test qa` — validate {X} QA stories before review (when QA stories exist)
`/superpowers:finishing-a-development-branch` — merge, PR, or discard the feature branch (when in worktree mode; never bolded/recommended here)

## Component-Skill Contract

`/claude-tweaks:build` is invoked by `/claude-tweaks:flow` as the implementation stage of the pipeline. Parent invocation is signaled by the `$PIPELINE_RUN_DIR` env var (set by `/flow` when it spawns this skill — also resolvable via the most-recent matching run under `.claude-tweaks/pipelines/`). When `$PIPELINE_RUN_DIR` is set, omit the `## Next Actions` block at the end of Step 7 — the parent `/flow` owns the handoff and renders its own Pipeline Summary + Next Actions. When invoked directly by a user (no `PIPELINE_RUN_DIR`), render Next Actions as documented in Step 7. The Manual Steps section likewise defers its rendering to the parent's summary when invoked under `/flow` (see Step 7's `handoff-template.md`).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Building without a spec or design doc | No clear scope — scope creep and unverifiable results |
| Asking for feedback during subagent execution | Subagent strategy is fully automated — make reasonable decisions and keep moving |
| Using `git reset` or `git checkout .` | Other processes may be committing concurrently — destroys their work |
| Skipping code simplification | Iterative implementation accumulates complexity across tasks |
| Building a spec with unmet prerequisites | Downstream specs depend on upstream work — check the dependency graph first |
| Skipping journey capture for features with an interaction surface | Journeys give visual review a path to walk and feed `/stories` for QA generation — every persona: end users, admins, developers, internal tooling. |
| Writing journeys with vague "should feel" | "Good" and "intuitive" are not testable. "Low commitment" and "like an accomplishment" are. |
| Asking the user whether to create a journey | Journey capture is automatic — the user didn't know they needed the spec either. |
| Ignoring architectural deviations from the spec | Drift becomes tech debt — catch it in Step 4.5 and explicitly classify every deviation. |
| Guessing at fixes for behavioral bugs without reproducing them | Edit-and-pray turns a 30-minute bug into a 3-hour one — reproduce on command via `/superpowers:systematic-debugging`, then fix the confirmed cause (Common Step 5). |
| Using `batched` execution within `/flow` | `batched` pauses for review every 3 tasks, contradicting flow's hands-off design — use `subagent` with `/flow`. |
| Rewriting docs from scratch during build | Build doc updates are incremental — change what the build touched; full rewrites belong in /wrap-up or /init. |
