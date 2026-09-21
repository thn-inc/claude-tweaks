---
name: flow
description: Use when you want to run an automated build → test → review → polish → wrap-up pipeline on a work record without stopping between steps. Accepts record references (#N) only — design docs must be decomposed via /claude-tweaks:specify first.
argument-hint: "#N[,#M...] [worktree|current-branch] [no-stories] [no-polish] [no-deepen] [no-creative] [auto|interactive|hybrid|confirm] [keep-going] [cleanup-only] [step1,step2,step3]"
---

# Flow — Automated Pipeline

Run multiple lifecycle steps in sequence without stopping between them. Each step has a gate — if a gate fails, the pipeline stops and presents the failure.

```
/claude-tweaks:capture → /superpowers:brainstorming → /claude-tweaks:specify → /claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:design-wrapper polish → /claude-tweaks:wrap-up
                                                                                     ╰────────────────────────────────────── [ /claude-tweaks:flow ] automates this stretch ──────────────────────────────╯
                                                                                     ^^^^ YOU ARE HERE ^^^^   (polish + re-verify: frontend and not fast-lane)
```

## When to Use

- A spec is ready to build and you want to go from code to clean-slate in one command
- A brainstorming session produced a design doc, `/specify` decomposed it into specs, and you want to run those specs through the pipeline
- You trust the pipeline to catch issues at gates rather than stopping for manual checkpoints
- You want to batch a build + test + review + wrap-up session

### When NOT to Use

- The input is a design doc, not a spec — run `/claude-tweaks:specify {doc}` first
- The plan has tangled cross-task dependencies — tighten via `/claude-tweaks:specify` first. Don't rely on flow's shape gate (Step 2.6) to stop you: under flow's own default `auto` mode, a Step 2.6 hard-fail auto-resolves to "proceed anyway" with an `ops` ledger note rather than actually stopping the pipeline (it only stops in `interactive`/`hybrid` mode)
- When you expect significant review findings that need discussion

## Input

`$ARGUMENTS` is parsed as `#N[,#M...] [worktree|current-branch] [no-stories] [no-polish] [no-deepen] [no-creative] [auto|interactive|hybrid|confirm] [keep-going] [cleanup-only] [step1,step2,step3]` — see Syntax and Arguments below for what each token resolves to.

## Syntax

```
/claude-tweaks:flow #N[,#M...] [worktree | current-branch] [no-stories] [no-polish] [no-deepen] [no-creative] [auto | interactive | hybrid | confirm] [keep-going] [cleanup-only] [step1,step2,step3]
```

All bracketed tokens are optional and order-independent. `worktree` is the default git strategy when neither `worktree` nor `current-branch` is set. `keep-going` applies to multi-record runs only. Design doc paths are rejected at Step 2.7 — run `/claude-tweaks:specify` first.

**Flow defaults to `auto` mode** (its purpose is hands-off automation). In `auto` the Pipeline Config Manifesto runs as a **read-only FYI** — it computes and displays the policy levers, then proceeds without an approval stop. Pass `confirm` to re-enable the Manifesto approval gate, `interactive` for per-skill in-flow prompts, or `hybrid` for floor-gated prompts. See the mode arguments below.

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `#N[,#M...]` | Yes* | **Primary input.** One or more work record references (e.g. `#123` or `#123,#456`; grammar — notation, tokenization, classification — is `_shared/record-batch-input.md`'s contract) — a GitHub issue number under `work-backend: github-issues`, or (drop the `#`) a local record id under `work-backend: local-files`. Resolved, shape-gated, and materialized into `{run-dir}/work/{n}-spec.md` per `materialize.md` in this skill's directory — an unshaped record hard-stops the run with a pointer to `/claude-tweaks:specify #{n}`. `/flow` never selects or filters records — `/claude-tweaks:dispatch` does that and mints the run directory (`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{n}[,#{m}...]`); `/flow` claims its named targets itself at Step 2.8 (`claim-targets.md`), whether the invocation came from dispatch's hand-off or a human running `/flow #{n}` directly against any record carrying no live claim. `/wrap-up`'s Section E / `multispec-review-console.md` release step derives the claim's identity as `basename($PIPELINE_RUN_DIR)` — the same directory dispatch minted and flow adopted, not a separately threaded value. *Not required when a topic name is passed instead. **Design docs are not accepted** — run `/claude-tweaks:specify {design-doc}` first to decompose into records. See Step 2.7. |
| `worktree` | No | Use worktree git strategy — isolated workspace on a feature branch (this is the default for flow). See "Parallel Development with Worktrees" below. |
| `current-branch` | No | Override the default and commit directly on the current branch instead of creating a worktree. |
| `no-stories` | No | Skip automatic story generation even if UI files changed. By default, flow auto-generates stories when the build produces UI file changes. |
| `no-polish` | No | Skip the polish phase (and its re-verify gate) entirely. Overrides any explicit `polish` in the step list. Use when iterating fast on backend specs, when polish is not desired (one-off scripts, infrastructure-only changes), or when the user has already manually invoked Impeccable polish. The wrapper would skip polish anyway on non-frontend specs (detection layer 2); `no-polish` is the explicit user-facing escape hatch. |
| `no-deepen` | No | Skip the end-of-run **Depth Opportunities** survey. By default flow runs `/claude-tweaks:deepen`'s read-only analysis at the Pipeline Summary and surfaces shallow-module candidates as recommendations (it never refactors automatically — see Step 5). `no-deepen` skips the analysis entirely. Can also be defaulted off project-wide with `depth-survey: off` in `.claude-tweaks/policy.yml`. |
| `no-creative` | No | Skip the end-of-run **Creative Opportunities** survey. By default flow runs decline detection then `/claude-tweaks:design-wrapper survey <changed-files>` at the Pipeline Summary and surfaces ranked creative-command recommendations (it never runs the commands automatically — see Step 5). `no-creative` skips the survey call entirely. Can also be defaulted off project-wide with `creative-survey: off` in `.claude-tweaks/policy.yml`, mirroring `no-deepen`'s `depth-survey: off`. |
| `auto` | No | **Flow's default mode** — pipeline runs hands-off; Manifesto (Step 3) renders as a read-only FYI, no approval stop; silences branch-divergence-check, shape-check, and path-selection prompts. Full contract: `_shared/auto-mode-contract.md`. |
| `confirm` | No | Stay in `auto` but re-enable the Manifesto approval gate at Step 3; everything after approval still runs as `auto`. |
| `interactive` | No | Opt out of auto entirely — skills prompt in-flow as standalone; the Manifesto is skipped. Highest friction. |
| `hybrid` | No | Manifesto approval gate runs; downstream skills still prompt on reversibility/confidence-floor or severity-ceiling failures. Between `auto` and `interactive`. |
| `keep-going` | No | **Multi-spec only.** Continue the run after a HARD-GATE failure in one spec — remaining specs still run, committing into the same shared worktree. Failed specs surface in the consolidated Review Console's "Not run / Failed" footer. Use when specs are genuinely independent (no `blocked-by:` edges). The default is to stop on first failure because spec N+1 may build on spec N's correctness — `keep-going` inverts that safety, so it's opt-in. See `multi-spec.md`. On a single-spec/single-record run, `keep-going` has nothing to continue past — treat it as a no-op and note: "`keep-going` has no effect on a single-target run — it only applies when multiple specs/records are given." |
| `cleanup-only` | No | Valid only when the resolved step list includes `wrap-up` (e.g. `/claude-tweaks:flow {target} wrap-up cleanup-only`) — a dedicated teardown-only entry point (#298): the caller's teardown-only follow-up call needs `wrap-up`'s cleanup route (`[IL-116]`) but not its full review/reflection semantics. Under `cleanup-only`, `/claude-tweaks:wrap-up` skips Phases 1-4 (reflection, routing, settle, close) and runs only `cleanup-procedures.md`'s cleanup items; `/flow`'s own Step 5 treats the run the same way it already treats a step list where `wrap-up` is *absent* — skip the nothing-left-behind ledger gate and the Creative/Depth surveys, render the "Flow: Steps Complete" note (see `steps-and-gates.md`'s "Partial step lists" section). On a step list that does not include `wrap-up`, the flag is a no-op — note it in the pipeline output, the same convention `keep-going` uses for its own no-op case: "`cleanup-only` has no effect — `wrap-up` is not in the step list." **Does not exempt Step 1.5** — this flag is read only after Step 1's materialize hard gate has already run, so routing a teardown call through `/flow {target} wrap-up cleanup-only` for a record whose triggering failure *was* that gate reproduces the identical STOP rather than reaching cleanup (`#1766`). `/claude-tweaks:dispatch`'s own teardown call sidesteps this by invoking `/claude-tweaks:wrap-up {target} cleanup-only` directly, never through `/flow` — see `dispatch/two-call-gate.md` §5. |
| `[steps]` | No | Step argument(s). Single step = resume from that step onward. Comma-separated steps = run exactly those steps. Default (no steps): `build,test,review,polish,wrap-up` (re-verify is bundled with polish). |

**Full mode prose** — every fact behind the `auto`/`confirm`/`interactive`/`hybrid` rows above, and the per-mode Manifesto-behavior table (Step 3) — lives in `mode-table.md` in this skill's directory; read it before choosing a mode for anything beyond the common case.

Flow always uses **subagent** execution strategy — its purpose is hands-off automation. The `batched` option (which pauses for human review) is not available in flow; use `/claude-tweaks:build batched` directly instead.

### Input resolution

1. **Record reference(s)** (e.g., `#123` or `#123,#456`; under `work-backend: local-files`, drop the `#`) → **Record mode** — resolved, shape-gated, and materialized via `materialize.md` in this skill's directory before the pipeline proper starts; an unshaped record stops the run with a pointer to `/claude-tweaks:specify #{n}`. Checked first, since a leading `#` (or, under `work-backend: local-files`, a bare id that resolves to an existing record) unambiguously means record mode. `/claude-tweaks:dispatch` is the primary caller of this form (`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{n}[,#{m}...]`) — a human can also run it directly against any record carrying no live claim. A single record runs the standard single-spec pipeline below, built from the materialized file. Multiple records (`#A,#B`) run **Multi-spec mode** (below), each materializing to its own file under the shared run's `spec-{id}/work/` subdirectory (see `materialize.md`'s Multi-record layout and `multi-spec.md`) — they run sequentially in one terminal (see Multi-Spec Sequential Flow below); for true parallel execution, use separate terminals with `worktree` mode. When `/claude-tweaks:dispatch` is the caller (a bundle group — see `dispatch/SKILL.md` Step 5), the run identity it minted and threaded in as `PIPELINE_RUN_DIR` is what every record's `/wrap-up` release step reads (`basename($PIPELINE_RUN_DIR)`) — no separate value to thread.
2. **Topic name** (e.g., `meal planning`) → search the configured `work-backend` for a matching record. If found, use record mode. If only a design doc exists at `docs/superpowers/specs/*-design.md`, **stop and route to `/claude-tweaks:specify`** (see Step 2.7) — design docs are no longer executable directly by `/flow`.
3. **Design doc path** → **rejected** at Step 2.7 with a routing message to `/claude-tweaks:specify`. Design-mode flow was removed because it bypassed the granularity contract — design docs describe multi-phase programs, not agent-sized work units.

### Automatic story generation

After build completes, flow checks the build output for UI file changes — the same trigger-extension/trigger-path rules as `/claude-tweaks:design-wrapper`'s Layer 3 sniff (for the canonical list, read `frontend-detection.md` in that skill's directory). If UI files changed and `no-stories` was not specified:

1. Auto-detect the dev server URL using `dev-url-detection.md` in `skills/_shared/`
2. Run `/claude-tweaks:stories` with the detected URL. When journey files exist in `docs/journeys/` (created by `/build` Common Step 6), the stories step ingests them before browsing — the `journey:` field is set on derived stories, source files are inherited from the journey's `files:` frontmatter, and browsing is enrichment rather than fresh discovery for journey-documented pages.
3. Generated stories feed into `/claude-tweaks:test` (which validates them as part of the test step)

If no UI files changed, or `no-stories` is set, the stories step is skipped.

### Examples

```
/claude-tweaks:flow 42                                              → full pipeline in worktree (default = auto): build, test, review, polish, wrap-up; Manifesto shown as FYI, no approval stop
/claude-tweaks:flow 42 confirm                                      → same, but stop at the Manifesto approval gate first (inspect/override levers), then run auto
/claude-tweaks:flow 42 interactive                                  → opt out of auto — per-skill in-flow prompts, no Manifesto
/claude-tweaks:flow 42 current-branch                               → full pipeline on current branch (no isolation)
/claude-tweaks:flow 42 no-stories                                   → full pipeline in worktree (skip stories even if UI changed)
/claude-tweaks:flow 42 no-polish                                    → full pipeline without polish phase
/claude-tweaks:flow 42 no-deepen                                    → full pipeline, skip the end-of-run depth-opportunities survey
/claude-tweaks:flow 42 no-creative                                  → full pipeline, skip the end-of-run creative-opportunities survey
/claude-tweaks:flow 42,45,48                                        → multi-spec sequential, all specs in one shared worktree
/claude-tweaks:flow 42,45,48 keep-going                             → multi-spec, continue past HARD-GATE failures (independent specs only)
/claude-tweaks:flow meal planning                                   → resolve to spec by name (rejected if only design doc exists)
/claude-tweaks:flow docs/superpowers/specs/migration-design.md      → REJECTED — run /specify first; flow only accepts record references and specs (auto does not silence this)
```

For resume-from-step and explicit-subset variants (`/flow 42 review`, `/flow 42 review,wrap-up`, etc.), see `steps-and-gates.md` ("Step Arguments" section) for the full enumeration.

## Allowed Steps, Step Arguments, and Gate Behavior

For the full Allowed Steps reference (which skills are pipeline-eligible), Step Arguments rules (resume vs explicit subset, auto-inserts, `no-polish` semantics), Gate Behavior table, and the canonical polish-phase decision tree, read `steps-and-gates.md` in this skill's directory.

### On Gate Failure

When a gate fails, the pipeline stops immediately and renders a failure card. Two card shapes exist (generic vs. "polish broke verification"); both templates and the picker live in `failure-cards.md` in this skill's directory. Load `failure-cards.md` only when a gate has actually failed — the success path uses Step 5's Pipeline Summary instead.

## Execution

### Step 1: Validate Input

1. Parse `$ARGUMENTS` — extract record reference(s) (`#N` / `#A,#B`) or topic name, detect `worktree`, `current-branch`, `no-stories`, `no-polish`, `no-deepen`, `no-creative`, the mode keywords (`auto` / `interactive` / `hybrid` / `confirm`), plus optional step list. **Resolve the mode** in this order (first match wins):
   1. Explicit mode keyword in `$ARGUMENTS` — `interactive` / `hybrid` / `confirm` / `auto`. (`confirm` means "auto mode, but gate the Manifesto"; see Step 3.)
   2. `auto-mode` policy — `AUTO_MODE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values auto-mode)`: `default-off` → `interactive`; `default-on` → `auto`; empty (unset) → fall through.
   3. **Intrinsic default → `auto`.** Flow is hands-off by purpose — auto unless a param or `auto-mode: default-off` lowers it.
2. Determine record mode (`#N` / `#A,#B`, or a bare id under `work-backend: local-files`) or topic-resolution mode (name) — per Input resolution above. A path argument is held until Step 2.7 (pre-flight) where it's checked against the design-doc rejection rule.
3. **Git strategy defaults to `worktree`** — same default as `/build`; flow never prompts. Resolution order:
   1. Explicit argument: `worktree` or `current-branch` in `$ARGUMENTS` — always wins
   2. Otherwise `GIT_STRATEGY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values git-strategy)` — the policy setting, else the resolver's schema default `worktree` (see `/claude-tweaks:build` default resolution)

   Do NOT prompt for git strategy — resolve it silently from the above. This is passed through to `/claude-tweaks:build` and controls isolation. Flow always uses `subagent` execution — never prompted. Pass `subagent` as an explicit argument in the `/claude-tweaks:build` invocation (Step 4) rather than relying on `/build`'s own default-resolution chain — keeping flow's execution-strategy guarantee independent of `/build`'s own policy resolution.

   **Already inside an isolated worktree session.** This resolution order has no automatic check for the case where the invoking session is itself already running inside a linked worktree (e.g. a longer-running sweep/tidy session that later invokes `/flow` on a record it decided to build). The `worktree` default would create a second, sibling worktree for that build — technically correct, but often unnecessary ceremony when the outer session is already isolated. An explicit `current-branch` argument is the documented escape hatch for that case; nothing here resolves it automatically, so weigh it as a judgment call rather than assuming the default is always right.
4. Validate step list is in lifecycle order and apply the auto-inserts and override rules from `steps-and-gates.md` ("Step Arguments" section): auto-insert `test` before `review`, treat literal `re-verify` as a no-op, and drop `polish` when `no-polish` is set.
5. Resolve and shape-gate every target record now, via `materialize.md`'s Resolution + Materialization hard gate in this skill's directory — this subsumes the design-doc rejection (2.7); an unshaped record stops the run here with a pointer to `/claude-tweaks:specify #{n}`, before Step 2's other checks or the Config Manifesto run.
6. If a path was given in the argument: it is rejected as a design doc (Step 2.7 enforces). If a topic name was given: resolve to a record; if only a design doc exists for that topic, stop and present the routing message.
7. If validation fails → **stop before starting**
8. **Create the open items ledger** using `/claude-tweaks:ledger`'s create operation. The `{feature}` name matches the execution plan that build will create. This file tracks findings and operational tasks across all pipeline phases. See `/claude-tweaks:ledger` for status lifecycle and phase taxonomy.

### Step 2: Pre-flight Checks

Four checks before pipeline starts. Each can return OK / WARNING / BLOCKED.
- 2.5 — Branch-divergence check (branch ahead/behind)
- 2.6 — Shape check (structural coupling, hard-fail on cross-task deps)
- 2.7 — Design-doc rejection (granularity contract — records only, not design docs). **Path / topic input only** — a record reference is never a file path, so this ambiguity doesn't arise for `#N` input; `materialize.md`'s Step 1 hard gate is the equivalent granularity check there.
- 2.8 — Claim the targets. Read `claim-targets.md` in this skill's directory and follow it: a
  skip-guard (local-files backend, topic-name mode, every target already owned by this run's
  identity, or a resolved step list with neither `build` nor `test`), a mint-if-unset resolution
  of this run's claim identity, a file-overlap warning (never a gate), then a
  group-claim-all-or-abort procedure over `_shared/issue-claims.md`'s lock.
  A contested target stops the pipeline before the Config Manifesto — no worktree, nothing to
  tear down. `keep-going` (multi-target runs) downgrades a contested target to a skip instead of
  aborting the whole run.

Any hard fail, rejection, or claim contest stops the pipeline before the Config Manifesto runs. Read `validation.md` in this skill's directory for 2.5-2.7's detailed procedure; `claim-targets.md` for 2.8's.

### Step 3: Pipeline Config Manifesto (front-loaded policy)

**Adopt-if-set, before creating:** a `PIPELINE_RUN_DIR` set on entry, naming an existing anchored directory that already carries `config.yml`, is adopted as-is (nothing created or re-initialized, levers read from `flow-preflight.js`'s pack). A set, existing, anchored directory that is **empty** (no `config.yml` — a run dir `/claude-tweaks:dispatch` Step 4 minted before claiming) is adopted by identity and initialized in place, as a from-scratch run does. Set-but-missing, unanchored, or unset creates fresh as below. Branch: `steps-and-gates.md`'s **Adopting an inherited run directory**.

This is the bookend "begin stop" that locks in policy for the rest of the pipeline. Runs after pre-flight passes so policy levers are not collected if the pipeline would not have started. In every mode except `interactive`, it computes the levers (scope-creep, overlap, design-intent, leftover-default, auto-fix-threshold, review-auto-apply-ceiling, tidy-aggressiveness, ceremony-profile, model-stance, merge-verification, design-critique, merge-authorization) from the precedence chain and writes `config.yml` + initializes `decisions.md` in `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/`. What differs by mode is whether it **stops** — `auto` (default) is a read-only FYI, `confirm`/`hybrid` gate on approval, `interactive` skips the Manifesto entirely; the full per-mode Manifesto-behavior table lives in `mode-table.md` in this skill's directory.

**This is the first bookend** of the pipeline (see `_shared/auto-mode-contract.md`). In default `auto` the begin-stop is informational only; the single user-facing stop is the Wrap-Up Review Console at the end. Regardless of mode, after this step no downstream skill re-asks the user about these levers — they read `config.yml` and apply.

Export that directory — created or adopted — as `PIPELINE_RUN_DIR` so every downstream skill resolves this same run per `_shared/pipeline-run-dir.md`; a multi-spec run exports the per-spec `spec-{N}/` subdirectory instead of the parent (see `multi-spec.md`).

For the complete Manifesto content (presentation template, recommendation defaults, source values, FYI vs approval-gate flow, path conventions), read `manifesto.md` in this skill's directory. Read `manifesto.md` only after Step 2.8 passes — a run stopped at pre-flight never consumes it (#724). Whenever the run dir already carries `config.yml` (an adopted run, or any re-read after the Manifesto's one-call batch write), read it as one composed bundle rather than opening the file directly: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step manifesto "${CLAUDE_PLUGIN_ROOT}/skills/flow/manifesto.md"`, then read `$PIPELINE_RUN_DIR/context/manifesto.md`; on a fresh run `config.yml` does not exist yet — the Manifesto's batch write is the one call that creates it — so read `manifesto.md` directly and never pre-write `mode` alone; if the compose command is unavailable or exits non-zero, read the named source files directly. `manifesto.md` is everything an `auto`-mode run needs; only under `confirm`/`hybrid` does it also point at `manifesto-confirm.md` (the `AskUserQuestion` call, Rendering rules, and On-override/On-cancel branches) — never open that companion file for an `auto` run (#657).

### Step 4: Run Pipeline

For each step in order:

1. **Announce** the step. **Single-spec runs (no multi-spec manifest):** narrate `## Flow: Running {step} ({N}/{total})` as free text ({N}/{total} = this step's position among the resolved step list) — a deliberate exception to the mechanical-coupling rule below, since there is no `manifest.yml` for a single-spec run to write, and therefore nothing to couple the banner to (#690). **Multi-spec runs:** do NOT narrate the banner — call `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run "$MULTISPEC_PARENT_DIR" --spec {n} --status running --phase {step}`, which writes this spec's `manifest.yml` status transition and prints the banner in the same call, so the banner can't silently stop firing independently of the mechanical state it's supposed to reflect. See `multi-spec.md`'s "Phase-progress banner and per-spec completion summary" section for the full command contract, including the wrap-up-exit completion line.
2. **Execute** the full skill as documented in its own SKILL.md. For the `build` step in record mode: compose, write, and commit the materialized file now (`materialize.md`'s Composing the file + When this runs) — `{run-dir}/work/{n}-spec.md` per record, committed **inside the run's worktree**, which is created first (`materialize.md`'s worktree-first ordering; the reverse order is denied under `worktree-always`) — then invoke `/claude-tweaks:build #{n}[,#{m}...]`, which reads that file as its spec (and, when `/build` is invoked standalone with no `/flow` parent, performs this same materialize step itself instead of relying on it being pre-done).
3. **Check the gate** — if the step fails its gate, stop the pipeline
4. **Pass context forward** — each step's output feeds into the next:
   - Step 2.5 → `build` receives `MERGE_CHECK_PASSED=true UPSTREAM_SHA={sha}` when Step 2.5 ran (worktree strategy + `branch-divergence-check: true` — see `validation.md`'s "Memo stamp" note). `build/worktree-setup.md`'s own pre-flight check consults this and skips its otherwise-duplicate fetch-and-compare when the stamped upstream sha still matches. Absent (standalone `/build`, `current-branch` mode, or `branch-divergence-check: false`) → `/build` runs its own check, fail-open.
   - `build` → check output for UI file changes and, if applicable, run `stories` — see "Automatic story generation" above for the full detection/dev-URL/invocation rule (not restated here).
   - `stories` → `test` receives the stories directory
   - `build` → `test` receives `VERIFICATION_PASSED=true` and `VERIFICATION_SHA={sha}` (so test skips redundant types/lint/tests when the tree hasn't changed since — see `verification.md` in the `/claude-tweaks:test` skill). Test still runs QA if stories exist.
   - `test` → `review` receives `TEST_PASSED=true` and QA results. Flow invokes `/claude-tweaks:review` with no explicit mode token — `review/SKILL.md`'s own Input resolution "Flow-context default" note detects `$PIPELINE_RUN_DIR` being set and resolves to **full** mode (code + visual review) on its own; flow need not pass `full` — passing it explicitly is harmless and resolves identically. The review skill delegates visual review to `/claude-tweaks:visual-review`, which handles its own browser **and** dev-server resolution:
     - **Browser + reachable app:** `/visual-review` runs the full visual review. Dev URL resolution (`dev-url-detection.md`) applies worktree awareness (a port serving the *main* checkout is rejected) and, in auto + worktree (flow's default), **auto-starts an ephemeral dev server on a free port** so the browser reviews *this* worktree's code. QA data is consumed when available.
     - **No browser backend (`playwright-cli` not installed):** `/visual-review` reports the detection failure with install instructions. Review falls back to code mode. Flow notes: "Visual review skipped — no browser backend available."
     - **No reachable app and no dev command to start one:** `/visual-review` logs the gap and falls back to code mode. Flow notes: "Visual review skipped — no dev server and no start command."
     - The ephemeral server (if started) stays up for the rest of the run and is torn down by `/wrap-up` cleanup (Section D) — or, in multi-spec runs, once at the end by `/flow`.
   - `review` → `polish` (when `no-polish` not set and `ceremony-profile` is not `fast-lane` — roster tag `polish`, `_shared/ceremony-profile.md`) — invoke `/claude-tweaks:design-wrapper polish <spec>` via the Skill tool. See "Polish phase execution" below for the dispatch logic.
   - `polish` → `re-verify` (only when polish modified code) — invoke `/claude-tweaks:test skip-qa`. See "Re-verify execution" below.
   - `polish` (or `re-verify`) → `wrap-up` receives the review summary, polish results, and verdict. Skill observations (`build/skill` and `review/skill` ledger entries) carry forward via the ledger file for wrap-up's Skills curation row.
5. **Ledger carries forward** — each step reads and appends to the open items ledger (see `/claude-tweaks:ledger` for all operations). Unlike conversation context (which may be compressed), the ledger is a file — it survives context window limits.

#### Polish + re-verify execution

Runs only when the polish phase actually dispatches. Read `polish-execution.md` in this skill's directory then — it carries the `/claude-tweaks:design-wrapper polish` invocation and its stop-the-pipeline error posture, the per-invocation ledger entry, the `AUTO`/`STAGED` `decisions.md` writes for `commands_invoked` and `staged_suggestions`, and the `/claude-tweaks:test skip-qa` re-verify plus its one-cycle cap. Skip the read when polish is skipped.

### Step 5: Present Pipeline Summary

**This whole step is conditional on `wrap-up` being in the resolved step list** — general, not caller-specific. A subset ending short of `wrap-up` (`build,test`, `build,test,review`, …) skips all of it — gate, both surveys, summary template — and renders the lightweight completion note in `steps-and-gates.md`'s **Partial step lists** section instead, which owns the rule and its rationale (an unfinished run must not assert completion; the ledger gate, never silenced by `auto`, cannot be answered headlessly mid-pipeline). Read it before rendering anything here.

**Nothing-left-behind gate** (`wrap-up` in the step list only)**:** Run the resolve gate from `/claude-tweaks:ledger`. If any item has status `open`, present it for resolution -- no item may remain `open`. The pipeline cannot complete with unresolved items.

**Creative Opportunities survey (v4.5.0).** Before rendering the summary, and when `no-creative` was not set (nor `creative-survey: off` in `.claude-tweaks/policy.yml`), run decline detection (compares prior recommendations cache against the new diff to suppress repeatedly-declined items), then invoke `/claude-tweaks:design-wrapper survey <changed-files>`. Returned recommendations render as a Creative Opportunities block (template below) before Next Actions; empty or `{skipped}` returns omit the block. When `no-creative` is set, skip decline detection and the survey call entirely and omit the block — mirrors `no-deepen`'s handling of the Depth Opportunities survey below.

**Depth Opportunities survey.** Also before rendering the summary, run the depth survey — the responsible way a hands-off `/flow` captures `/claude-tweaks:deepen`'s value. After the pre-check passes (source modules changed, `no-deepen` not set), invoke `/claude-tweaks:deepen <changed-source-files>` with `$PIPELINE_RUN_DIR` set, which runs `/deepen`'s **analysis-only** path (module mapping + deletion test + leverage ranking — read-only). It returns ranked candidates **without applying any refactor** — at most, narrow collapse candidates stage validated `deepen-collapse-{n}.patch` proposals for the Review Console (`/deepen` Step 3's Auto mode, per `_shared/staged-patch.md`): staged, never applied in-run. Render the top candidates as a Depth Opportunities block (template below) before Next Actions; no candidates or a skipped pre-check omit the block. **`/flow` never runs the interactive interface-design step or modifies code for a depth candidate** — the block is a recommendation to run `/claude-tweaks:deepen` manually.

For both surveys' full procedures (wrapper/skill return handling, the depth pre-check and responsibility boundary) and the Creative Opportunities decline-detection algorithm, read `survey.md` in this skill's directory.

On successful completion of all steps (`wrap-up` in the step list), read `summary-template.md` in this skill's directory and render it — never on the failure path (see `failure-cards.md`).

---

## Multi-Spec Sequential Flow

When multiple record references are provided (e.g., `#42,#45,#48`), flow runs each record's pipeline **sequentially** in one terminal. Each completes its full pipeline (build → test → review → polish → wrap-up) before the next begins.

**Pre-flight enrichments (v4.6.4+):**
- **Dependency-aware ordering** — reads each target's `blocked-by:` dependency declaration (see `materialize.md`'s Populating the header), builds a DAG, hard-fails on cycles, and offers (or auto-applies in `auto` mode) topological re-ordering when the user's order violates the graph.
- **Cross-spec conflict detection** — pre-flight scans each spec's `Files:` declarations; surfaces overlapping pairs as a footer line in the Pipeline Preview. Warning, not hard-fail.

**Failure handling:**
- **Default:** a HARD-GATE failure in one spec stops the remaining specs (compounding-risk safety).
- **`keep-going`:** opt-in flag that continues the run past HARD-GATE failures. Failed specs surface in the consolidated Review Console's "Not run / Failed" footer.
- **Shared worktree:** in `worktree` mode a sequential multi-spec run uses **one shared worktree for the whole run**, not one per spec. `/flow` creates it once up front (from the current local HEAD), runs every spec inside it (per-spec builds skip creation via `MULTISPEC_SHARED_WORKTREE=1`), and finishes the single branch once at the end. Per-spec worktrees apply only to separate-terminal parallel runs.

**Bookend architecture for multi-spec (v4.6.3+):** in `auto` or `hybrid` mode, per-spec Wrap-Up Review Consoles are **deferred** — `/flow` sets `MULTISPEC_REVIEW_DEFER=1` when invoking each spec's `/wrap-up`. After all specs complete (or `keep-going` finishes the run), `/flow` runs **one consolidated Review Console** that reads every per-spec `decisions.md` + `staged/` and surfaces all approvals in one batch. This preserves the bookend promise (Manifesto at start, one Review Console at end) regardless of N. See `multispec-review-console.md`.

For the full validation rules, dependency-ordering procedure, conflict-detection logic, run directory layout (per-spec sub-namespacing under one parent dir), environment variables passed to each per-spec invocation, and `keep-going` semantics, read `multi-spec.md`; the consolidated Multi-Spec Summary template lives in `multispec-summary.md`.

---

## Parallel Development with Worktrees

For the terminal-example syntax for true parallel execution, mode-selection guidance (worktree vs current-branch), the merge reconciliation procedure (merge order, conflict handling, conflict resolution prompt), and the post-merge summary template, read `worktree-merge.md` in this skill's directory.

---

## Next Actions

Next Actions in `/claude-tweaks:flow` are outcome-conditional and rendered as part of the Pipeline Summary (Step 5 success template) or Failure Card (see `failure-cards.md`). See `## Pipeline Summary template` above for the canonical markdown close-out block on success; see `failure-cards.md` for the per-failure-shape Next Actions blocks. There is no standalone Next Actions block here — the rendered block fires inside the success or failure template that matches the pipeline outcome.

## Component-Skill Contract

`/claude-tweaks:dispatch` is the only skill that invokes `/claude-tweaks:flow` as a caller (`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{n}[,#{m}...]` — see `dispatch/SKILL.md` Step 5, and the `/dispatch` section of `docs/skill-graph.md`). Unlike a nested component skill (`/simplify`, `/reflect`, `/deepen`, and the others this convention targets), `/flow` is never folded into a larger pipeline's own handoff — it creates and owns its own `PIPELINE_RUN_DIR` (Step 3) unless invoked with one already set to an existing (or minted-but-empty) run directory — both of dispatch's per-group Task calls do, and `/flow` adopts it either way (Step 3's cases 1 and 2) — and dispatch renders no console of its own that would supersede it (`dispatch/SKILL.md`'s Reporting section: a headless firing's durable trace is label state + `decisions.md`, not a rendered console). `/flow` therefore always renders its own outcome-conditional Next Actions (embedded in the success or failure template — see above), regardless of caller; there is no parent-vs-direct branch to detect.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Stopping the pipeline because the spec is "big" | Size isn't coupling — the Step 2.6 shape gate blocks on **structural** signals (cross-task deps, scope leak); under `auto`, further size-driven checks are forbidden (`_shared/auto-mode-contract.md`) |
| Inserting model-side reality-checks under `auto` | Concerns belong in the ledger or failure card, not blocking prompts — `_shared/auto-mode-contract.md` |
| Ignoring gate failures and restarting | Gates catch real problems — investigate before retrying |
| Running flow on specs with unmet prerequisites | Fails at build — check dependencies first |
| Using flow for interactive skills | Capture and specify need human decisions |
| Using `batched` execution in flow | Batched pauses for human review, contradicting flow's hands-off design — use `/claude-tweaks:build batched` |
| Ignoring open ledger items at pipeline end | The nothing-left-behind gate requires every item explicitly resolved |
| Treating `auto` as authorization to bulk-resolve the ledger | The resolve gate's Phase 2 is on `_shared/auto-mode-contract.md`'s "does NOT silence" list — every item needs explicit per-item user input |
| Creating a work record bypassing the Review Console's gate | Follows `_shared/auto-mode-contract.md`'s tiered stance (Approve-all / `consoleAutoResolve`) — pipeline phases never file directly outside it |
| Skipping test in the pipeline | Review depends on `TEST_PASSED` — skipping it reviews potentially broken code |
| Retrying polish after re-verify failure within the same flow run | The one-cycle cap prevents oscillation — surface the failure and require a fresh `/flow {spec} polish` to retry |
| Treating polish skip as a flow failure | Skips are normal (non-frontend spec, no Impeccable, `no-polish` flag, `ceremony-profile: fast-lane`, no audit findings + no refinement-set changes); the pipeline continues to wrap-up |
| Running re-verify without `skip-qa` | Browser QA is irrelevant after stylistic-only polish — `/test skip-qa` keeps the cycle fast; the Design CLI gate still runs |
| Using `no-polish` on a frontend spec by reflex | Polish is the value-add for frontend specs — set `no-polish` only when iterating fast or after a manual Impeccable polish |
| Auto-running creative commands surfaced in the Creative Opportunities block | Recommendations only — flow never executes Impeccable creative commands from survey output; the user invokes them |
| Applying a depth refactor inside flow | The depth survey never applies — at most it stages a validated collapse patch for the Review Console; architecture is low-reversibility, and the user (or an attended console) acts deliberately |
| Running the depth survey on a config-only or docs-only diff | Disproportionate cost — skip the survey when no source modules changed |
| Rendering the Depth Opportunities block when the survey found nothing | Empty means the abstractions are earning their keep, not that analysis was skipped — omit the block |
| Rendering the Creative Opportunities block when survey returned empty or skipped | Survey is heuristic — empty means "nothing matched the criteria," not "design is complete." Omit the block entirely |
| Skipping decline detection on re-runs of the same spec | The Creative Opportunities block becomes noise across iterations. Before survey: read the prior recommendations cache, compare to the new diff, increment declines for un-invoked recommendations |
