---
name: wrap-up
description: Use when /claude-tweaks:review passes and you need to capture learnings, clean up specs/plans, update skills, and decide next steps. The lifecycle closure step.
argument-hint: "[#N|<spec>|<context>|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only]"
---
> **Interaction style:** Single decisions → one `AskUserQuestion` call, one option marked Recommended. Multi-item → batch table with recommendations pre-filled, then one `AskUserQuestion` for apply-all/override. Never more than one call per decision; resolve each before the next. Terminal `## Next Actions` → plain markdown: paste-ready fully-qualified commands, recommended first and bold, one per line — `AskUserQuestion` there only for a documented machine-consumed decision, named inline.


# Wrap-Up — Capture learnings, clean up, and close the lifecycle

Post-review reflection, knowledge capture, and lifecycle cleanup. Part of the workflow lifecycle:

Lifecycle: `/claude-tweaks:review` → **`/claude-tweaks:wrap-up`** — last step of the chain; the full chain is in `/claude-tweaks:help`.

## When to Use

- `/claude-tweaks:review` just passed and the work needs reflection and cleanup
- A record or spec is complete and needs its artifacts (plans, design docs) cleaned up
- You finished conversation-based work and want to capture learnings
- `/claude-tweaks:help` flags specs awaiting wrap-up

## Input

`$ARGUMENTS` is parsed as `[#N|<spec>|<context>|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only]` — see Overview, the Flags subsection below, and the Phase sections for what each token resolves to.

## Overview

`/claude-tweaks:review` verified the code is good. `/claude-tweaks:wrap-up` asks: what did we learn, and what needs cleaning up?

This skill handles reflection (capturing learnings), spec lifecycle (completion/cleanup), and knowledge routing (updating skills, CLAUDE.md, memory). It does NOT re-review code quality — that's `/claude-tweaks:review`'s job.

Four phases, run in order:

```
Phase 1: ESTABLISH — what happened here?
Phase 2: ROUTE     — where does each learning belong?  (engine + registry)
Phase 3: SETTLE    — is anything left dangling?
Phase 4: CLOSE     — decide, execute, hand off
```

---

## Phase 1: ESTABLISH — what happened here?

Establishes work identity, the run directory, and the reflection insight set that Phase 2 routes.

### Identify the work context (formerly Step 1)

Determine what type of work was completed:

#### If `$ARGUMENTS` is provided:

- If it's exactly `resume` (case-insensitive), this is not conversation-based work — see "Resuming a halted Review Console" below instead of falling through to the branches below.
- If it's a `#`-prefixed record reference (e.g., `#42` — the primary form) or a bare record id under `work-backend: local-files` (e.g., "42", "73"), strip the leading `#` if present, then proceed as **record-based work**.
- Otherwise, use it as context for **conversation-based work**.

Flags (`--dry-run`, `--skill-budget <n>`, `--doc-budget <n>`) may appear anywhere in `$ARGUMENTS` alongside any of the above forms — strip them before applying the branches above. See "Flags" below.

#### Resuming a halted Review Console

See `resume-halted-run.md`, this skill's directory, for the full `resume` recovery procedure — locating the halted run, the freshness probe, and the headless-dispatch exception.

#### Flags

See `flags.md`, this skill's directory, for `--dry-run`, `cleanup-only`, `--skill-budget <n>`, and `--doc-budget <n>`.

#### If no arguments, detect from context:

1. Check recent git commits and the current branch name for record references
2. Review conversation for references to records or features
3. Check whether a materialized header exists for this run (`${RUN_DIR}/work/*-spec.md`) — record mode

| Type | Characteristics | Primary Focus |
|------|----------------|---------------|
| **Record-based** | A record is identified for this run — a `#`-prefixed argument, a git commit/branch reference, or (fallback) a materialized header | Full lifecycle: record completion + plans + all assessments |
| **Conversation-based** | No record, just work discussed | Assessments only (skip record/plan cleanup steps) |

### Summarize completed work (formerly Step 2)

Summarize what was done — do not re-verify. Spec compliance (deliverables + acceptance criteria) was already verified in `/claude-tweaks:review` Step 1. For record-based work, list what was delivered at a high level and state the completion verdict: **100% complete** (confirmed by `/claude-tweaks:review`) → `github-issues`: the record closes via merge (`cleanup-procedures-execution.md` Section C's carrier commit); `local-files`: the record file is marked `closed: true` in place (`cleanup-procedures.md` item 5); **partial** (review passed with minor gaps flagged) → identify what remains, which Phase 3's leftover routing consumes. For conversation-based work, review the conversation and recent commits to identify what was implemented and which key files changed.

### Establish the run directory (unconditional)

**Every wrap-up run has a run directory from Phase 1 on.** This is a rule, not a branch: standalone or pipeline, record or conversation mode, one code path for staging, the audit log, and the Review Console in every mode.

Resolve it per `_shared/run-dir-resolution.md` steps 1-2 (the `PIPELINE_RUN_DIR` env var, then the most-recent matching directory), anchored to `$RUN_ROOT` per `_shared/pipeline-run-dir.md`'s Anchoring section, via `resolve-run-dir`. When neither resolves, create one — the standalone-fallback shape (`--standalone`, never gated on `--mode`, since wrap-up creates in every mode), plus the `run-state.json` stamp:

```bash
RUN_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "$SPEC_SLUG" 2>/dev/null)
if [ -z "$RUN_DIR" ]; then
  # Steps 1-2 found nothing (or step 1's adoption-time anchoring check rejected a
  # worktree-trapped PIPELINE_RUN_DIR, [IL-127]) — clear it for this second call so a
  # rejected value is never re-consulted, then mint the standalone fallback.
  RUN_DIR=$(PIPELINE_RUN_DIR= node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "$SPEC_SLUG" --standalone "$SPEC_SLUG" --create)
  printf '{"status":"active","createdBy":"wrap-up-standalone"}\n' > "$RUN_DIR/run-state.json"
fi
echo "$RUN_DIR"
```

`$SPEC_SLUG` follows `_shared/run-dir-resolution.md`'s SPEC_SLUG conventions — `record-{n}` in record mode, a short topic slug in conversation mode. The run is created `status: active` and closes through the normal archival path (Phase 4's cleanup item 8), so E1 enforcement and the interrupted-run reaper see nothing unusual. An `export` inside this snippet does **not** survive into the next Bash call — each later phase that needs the path re-resolves it with the same `_shared/run-dir-resolution.md` snippet, which is why the run dir must be recorded as a fact of this run rather than relied on as environment state.

**Determine inherited-vs-created here, once.** At this point — and only here — record which of the two branches above ran:

- `$PIPELINE_RUN_DIR` was already set at invocation, or an existing directory resolved at step 2 whose `run-state.json` does not carry `createdBy: wrap-up-standalone` → **inherited**.
- This run created the directory (the `createdBy: wrap-up-standalone` stamp is written above) → **created**.

Carry that verdict as a run-scoped fact for the rest of the run, alongside the run dir path itself, and state it in the Phase 1 report table. **Never re-read it from disk later.** Phase 4's cleanup item 8 archives the run directory, so by the time the Component-Skill Contract is consulted the `run-state.json` this determination came from has usually moved to `.claude-tweaks/pipelines/archive/{run-id}/` — a re-read at that point fails on exactly the standalone runs that must render Next Actions.

### Diff-derived ceremony default (auto-mode firings, #1545)

Read `ceremony-derivation.md` in this skill's directory and follow it, before the Reflect step below reads `config.yml`'s `ceremony-profile` — it can narrow an auto-mode run's `standard` default down to `fast-lane` when the diff itself is low-surface, so Reflect's own mode selection just below sees the derived value.

### Reflect (formerly Step 3)

Read `config.yml`'s `ceremony-profile` from the run directory. Run `/claude-tweaks:reflect` in **light** mode when it is `fast-lane`; **full** mode otherwise (including standalone wrap-up, where no `config.yml` exists to read). Pass:
- **Scope** — files changed during this work
- **Ledger phase** — `wrap-up`
- **Seed context** — review summary (Key Learnings section), tradeoffs accepted
- **`--source wrap-up`** — always: reflect's `$PIPELINE_RUN_DIR` signal now resolves the same way on every wrap-up run, so the explicit flag is the stable statement of the same fact — see `/claude-tweaks:reflect`'s Component-Skill Contract

Full mode handles all five reflection lenses (Surprises, Approach, Near-misses, Fresh start, Friction), the tradeoff review, insight routing, and ledger writes. Light mode (`skills/reflect/light-mode.md`; roster tag `reflect-light-mode`, `_shared/ceremony-profile.md`) runs only the Near-misses, Fresh-start, and Friction lenses and skips the tradeoff review — Near-misses and Fresh-start are the lenses that can still produce a Safety regression finding, which is what the ceremony escape hatch below keys on; Friction survives for a different reason — it's orthogonal to code-narrative depth, judging the pipeline's own behavior toward the operator rather than the size of the change. Surprises, Approach, and the tradeoff review are narrative, and pure fixed cost on the small changes `fast-lane` is for. See `/claude-tweaks:reflect` for details on both.

If any insight is "Implement now", the reflect skill handles it before returning control. Proceed after all insights are resolved. The surviving insight set is Phase 2's input.

**Multi-spec defer:** when `MULTISPEC_CURATION_DEFER=1` is set by `/flow` multi-spec orchestration, skip this per-spec Reflect step entirely — do not invoke `/claude-tweaks:reflect`, write no per-spec reflect insight set or ledger entry for this step. The batch-scope reflect pass at end-of-run (`skills/flow/multispec-batch-curation.md`) covers the full multi-spec diff once, after the final spec's pipeline reaches Phase 4 or the run aborts. Proceed directly to the Ceremony escape hatch below (its own trigger conditions still read this spec's own `/claude-tweaks:review` summary, independent of whether reflect ran).

### Ceremony escape hatch (formerly Step 3.5, fast-lane runs only)

Skip entirely when `config.yml`'s `ceremony-profile` is not `fast-lane` (including standalone wrap-up, where no `config.yml` exists). Otherwise, check both trigger conditions:

- Did `/claude-tweaks:review`'s summary (passed into this run) contain a finding at any severity?
- Did the reflect pass above produce a Safety regression finding (`reflect/SKILL.md` Step 3's routing table)?

If either is true, downgrade `config.yml`'s `ceremony-profile` via the sanctioned writer (worktree sessions cannot Edit/Write the run dir — same family as `log-decision.js`/`stage-item.js`, refs #1376):

`node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js" --run "$PIPELINE_RUN_DIR" --key ceremony-profile --value standard`

Then log:

```
AUTO {time} — Ceremony profile downgraded fast-lane → standard: {trigger}. Remaining wrap-up steps run at standard depth.
```

Phase 2 passes the (possibly just-downgraded) value to the engine as `--ceremony`, which is the only remaining consumer — no other propagation needed. This never re-runs a step already skipped (the roster in `_shared/ceremony-profile.md`, the SDD whole-branch review and polish skips included): the downgrade covers only this run's remaining wrap-up steps and never rewrites the record's `ceremony:*` label — a re-run is fast-lane again.

---

## Phase 2: ROUTE — where does each learning belong?

One mechanism, one registry, one engine. Every knowledge asset wrap-up curates is a row below; every row is evaluated on every run, open or closed, and every row's outcome is reported.

### The registry

| Target | Gate | Scope | Judge | Disposition |
|--------|------|-------|-------|-------------|
| Skills | `.claude/skills/` exists, or the diff changed 2+ files | Domain-overlap ranking, top 5 (fast-lane 2; `--skill-budget` overrides) | `skill-curation.md` | `apply-or-stage` |
| Docs | `docs/` exists and is non-empty | Domain-overlap ranking, top 3 (fast-lane 1; `--doc-budget` overrides) | `docs-health-integration.md` | `apply-or-stage` |
| Journeys | At least one `docs/journeys/*.md` exists | Journeys whose `files:` frontmatter overlaps the diff (deterministic, no cap) | `journey-curation.md` | `apply-or-stage` |
| CLAUDE.md & rules | A `## Commands` line was renamed or removed since the base, `CLAUDE.md`/`.claude/rules/*.md` exceeds its tier's line budget, or a don't-repeat candidate, a contradicted convention, or a recorded incident was signalled | `CLAUDE.md` plus `.claude/rules/` | `claude-md-curation.md` | `stage-only` |
| Decision records | One or more decision candidates were signalled for the ADR gate | The decisions this run surfaced | `adr-curation.md` | `stage` |
| Broken references | Renames/deletions in diff, or a renamed heading | Repo-wide references surviving a renamed or deleted target | `reference-sweep.md` | `apply-or-stage` |
| Memory | One or more learnings were signalled as memory-bound | Learnings no earlier row claimed | `memory-curation.md` | `stage` |
| Upstream feedback | One or more learnings were signalled as upstream-bound | Those learnings, after the self-reference check | `upstream-feedback.md` | `stage` |

This table is the human-readable half of `bin/lib/wrap-up/registry.js`; `tests/wrap-up-registry-pin.test.js` fails when the two drift. Adding a curation target means adding a row in both places and a judge file beside this one.

**Ordering is load-bearing** — see `curation-engine.md`'s invocation sequence for the rule and why.

**CLAUDE.md & rules never auto-applies.** Its disposition is `stage-only` — every finding on that row stages for the Review Console regardless of confidence or reversibility, per the standing CLAUDE.md exception in `_shared/harness-health-analysis.md`. Decision records are `stage` for the same reason at lower force: they propose, the actual ADR write happens only at Phase 4 execution once approved (`adr-curation.md`: routed through the Review Console, never written silently, at any tier). Memory and Upstream feedback are also `stage`, but follow `_shared/auto-mode-contract.md`'s tiered stance rather than a flat never-write rule: the write is covered by the Review Console's batch "Approve all" at `supervised`/`trusted`, and auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` at `unattended` — see `memory-curation.md` and `upstream-feedback.md` in this skill's directory.

### Run the engine

**Multi-spec defer:** when `MULTISPEC_CURATION_DEFER=1` is set, skip this per-spec `plan`/`record`/`render` sequence entirely — no `spec-{N}/engine-state.json` is created for this spec. The batch-scope registry pass at end-of-run (`skills/flow/multispec-batch-curation.md`) evaluates the full registry once, against the parent run dir, after the final spec's pipeline reaches Phase 4 or the run aborts. Proceed to Phase 3.

Otherwise: read `curation-engine.md` in this skill's directory and execute its invocation sequence — it owns the plan/record/render commands, the payload contract, the parallel-dispatch rule, and the prose fallback. This read is unconditional whenever this step actually runs.

**Constructing `--signals`.** The engine computes every fact-based gate itself from git and the filesystem. It cannot compute the six judgment-derived signals, so Phase 1's outputs supply them at `plan` time:

| Signal | Phase 1 source |
|--------|----------------|
| `dontCandidate` | A reflect insight, or a `[claude-md: …]`-tagged ledger entry, naming a pattern that should not be repeated |
| `contradictedConvention` | This work's diff contradicts a convention CLAUDE.md's `## Conventions` section asserts |
| `incidentRecorded` | An incident account was recorded for this work |
| `adrCandidateCount` | Decisions surfaced by the reflect tradeoff review and the ledger, counted as candidates for the three-factor ADR gate |
| `d4Count` | Reflect insights and ledger learnings that `_shared/learning-routing.md` classifies as memory-bound |
| `d5Count` | Those it classifies as upstream-bound |

Classify once, before `plan`, over Phase 1's whole insight set. The counts open the gate; the Memory and Upstream judges then narrow to whatever earlier rows left unclaimed, which is why they run last.

Every reflect insight in this whole-insight-set carries its own `Evidence:` and `Cost this session:` lines (`reflect/full-mode.md` etc., #858) — no signal here strips them. Reflect's own `staged/reflect-{n}.md` template (`reflect/SKILL.md`'s `## Finding` body) carries both lines as part of that prose, with no new field added; Phase 2's judges (Skills, Memory, Upstream feedback rows) read that same insight text as their input, so whatever each stages downstream still traces back to a source naming what it's anchored to and what it cost, not a compressed recommendation with the anchor stripped.

**Engine failure is never permission to skip a row.** The prose fallback in `curation-engine.md` section 6 is unconditional and takes no diagnosis, and the report states which path ran.

---

## Phase 3: SETTLE — is anything left dangling?

### Leftover work (formerly Step 4, record-based only)

Identify unfinished spec sections that cannot be completed in the current work context. If at least one such section exists, or the run's latest `report.json` carries `flakyEscalation`, read `leftover-routing.md` in this skill's directory and route them per that file (fix-exhaust criteria, stage entry format, the routing table, per-item semantics). If neither holds, report "No leftover work to route" and skip this step entirely — do not read the file.

### Nothing left behind (formerly Step 8.5, gate)

**Fact pack first.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR"` (#1930) once — it writes `{run-dir}/wrap-up-pack.json`: eight probes (`residue`, `state`, `blastRadius`, `pr`, `recordLabels`, `claim`, `ledger`, `unblocked`), each `{ok, value | error}`. Each sub-step below reads its field: `ok: false` or a missing key takes that sub-step's own failure path, never a silent clean result; only an absent file lets it run its probe itself. Then run `residue-sweep.md` in this skill's directory (`pack.residue`) so this gate has ledger items to enforce on a standalone run.

Run the resolve gate from `/claude-tweaks:ledger` (see ledger skill for the three-phase procedure: Phase 1 fix-exhaust silently → Phase 2 present remainder for per-item user decision → Phase 3 apply).

**Gate the read.** Read `_shared/ledger-format.md`'s Resolve Gate when the ledger **holds at least one item** of any status, not just `open` (`pack.ledger` `total > 0` opens it; a pre-sweep `0` or `ok: false` → re-count after the sweep). If, after the sweep above has run, the ledger still doesn't exist or holds zero items, report "No ledger items to resolve" and skip this gate entirely without reading the file.

**Unrecognized-status warning (#2080).** Before rendering the Resolve Gate table, when `pack.ledger.unrecognized > 0`, render one additive, non-blocking warning line naming the count and the distinct unrecognized values: `⚠ {n} ledger row(s) carry a status outside the recognized enum: {unrecognizedValues.join(', ')} — see _shared/ledger-format.md's status enum.` This never changes the gate's own `total > 0` open condition and never blocks completion — an unrecognized-status row was never `open`, so it was never blocking before this warning existed either; it only makes the previously-invisible drift visible to a human. Omit the line when `pack.ledger.unrecognized` is `0` or absent.

The same condition gates `nothing-left-behind.md` in this skill's directory — wrap-up's own wrapper around that gate: the item-existence rationale, the hard requirements (Phase 1 fix-exhaust before any user-facing output, Phase 2's mandatory per-item input, and what `auto` never silences), the terminal-status bulk-resolve fast path, and the ops-acknowledgment sub-step with its `autonomy`-ceiling-gated batched multiSelect branch. When the gate is closed, read neither file.

The ledger resolve gate's own Phase 2 per-item input stays **outside** the Review Console, per `_shared/auto-mode-card.md`'s never-silenced list.

### Newly unblocked records (formerly Step 8, record mode only)

Informational only — feeds Phase 4's Next Actions, never gates or delays the wrap-up; on any error, log and continue. The closed record is Phase 1's `record: {n}`; the question is whether closing it unblocked anything (`pack.unblocked`). **Gate the read.** If this run is record-based work (Phase 1's determination — record identity does not require a materialized header), read `unblocked-records.md` in this skill's directory, which holds the `work-backend: github-issues` (`work-links: body-text` or `native`) and `work-backend: local-files` procedures, the failure-mode handling, and the `decisions.md` log line. Otherwise — conversation-based work, which has no record whose closure could unblock a dependent — skip this entirely and do not read the file. Parallel opportunities and the recommended next record fall out of the same lookup; `/claude-tweaks:help` shows the full workflow status.

---

## Phase 4: CLOSE — decide, execute, hand off

### Plan cleanup actions (formerly Step 5)

This step **plans** the cleanup — it does not execute. Actual deletions and archival run at execution time *after* the nothing-left-behind gate and the Review Console approve them.

Cleanup enumerates the items below, in canonical order: execution plans, ledger, design caches, worktree, record/spec lifecycle, ephemeral dev server, issue claim release, pipeline run dir (always last — see the canonical list's ordering rule).

First check whether **any** of the following conditions holds for this run — record-based work (items 1, 5, 7), a ledger exists (2), the design wrapper was active (3), a worktree strategy was used (4), `${RUN_DIR}/ephemeral-server.txt` exists (6), or a pipeline run directory exists (8):

- **At least one holds** → read `cleanup-procedures.md` in this skill's directory for the canonical cleanup list, filter it to rows whose Condition holds for this run (e.g., skip the worktree row when no worktree strategy was used), and carry the filtered list forward into the report and the execution step. That file's own text names a fast-path fragment for the common no-record/no-worktree/non-multi-spec case (#797) — read it there, not restated here.
- **None holds** → report "No cleanup actions apply" and skip this step entirely; do not read the file.

Item 8 now holds on **every** run — Phase 1 creates a run directory unconditionally — so this gate is always open in practice, and items 4 and 8 both hold by construction on a pipeline run. The "none holds" branch survives only as a degenerate guard for a run whose Phase 1 run-dir creation failed.

### Wrap-Up Review Console (formerly Step 8.6)

The Review Console is the **second bookend** of the pipeline (see `_shared/auto-mode-contract.md`). **It runs in every mode**, reading the run directory Phase 1 guaranteed. It reads `decisions.md`, `staged/`, and `config.yml` from that directory, then presents one consolidated batch table with the named sections `review-console.md` heads (Auto-applied / Pending review / Low-confidence findings / Contested findings / Skill updates / Documentation updates / Journey updates / Configuration updates / Reference repairs / Cleanup actions) and three actions (Approve all / Override / Stop). The two coordination-derived sections (Low-confidence findings, Contested findings) render only when non-empty, as does Reference repairs. In interactive and standalone runs the console is what presents the cleanup, configuration, queue-write, memory and upstream proposals for approval — there is no separate batch decision. Approve all resolves the queue-write/memory/upstream proposals to their own stated defaults directly; Override is the one path that still drills them per item (`review-console-interactive.md`'s Hard requirements).

**Multi-spec defer:** when `MULTISPEC_REVIEW_DEFER=1` is set by `/flow` multi-spec orchestration, skip the per-spec console — the consolidated end-of-run console at `/flow` handles all approvals across every spec in the run. Leave `staged/` and `decisions.md` untouched, append a "deferred" log entry, and proceed to the report.

Empty-console fast path: skip the console entirely and proceed to the report when all of `review-console.md`'s Empty-console fast path conditions hold (`decisions.md` holds no decision-bearing entries — `SCANNED` and `SKIP` audit lines are excluded — `staged/` is empty, no skill/config updates exist, no cleanup actions apply, no queue writes, memory updates, or upstream feedback proposals are pending). Unconditional bookkeeping rows — run-dir archival — do not count as cleanup actions for that test; archival executes regardless.

**Gate the read.** Read `review-console.md` in this skill's directory — for the run-directory resolution sequence, the multi-spec defer protocol, and the Auto-merge short-circuit's applicability check — when **either** holds. Once a real stop will actually render (i.e. neither the Auto-resolution short-circuit nor the Empty-console fast path resolved and returned), also read `review-console-interactive.md` for the full console template with every section table (including the conditionally-rendered Low-confidence, Contested findings, and Reference repairs sections), override/stop semantics, and the sort-order requirement:

- The console runs: a run directory exists (always, after Phase 1), `MULTISPEC_REVIEW_DEFER` is unset, and the empty-console fast path above does not apply; **or**
- This run has a materialized header (`${RUN_DIR}/work/*-spec.md`) whose issue carries a live `auto:merge` or `auto:merge-pending` label (re-fetch via `gh issue view --json labels`) — the pending case exists so a still-maturing grant reaches the short-circuit's own maturation check instead of being silently skipped (#309).

The second condition exists because the **Auto-merge short-circuit**'s applicability check lives in `review-console.md`, not in this file — it is not part of the console rendering it precedes. Without it, a run that qualified for the empty-console fast path would silently skip its authorized auto-merge. In practice the fast path cannot fire on such a run — it requires "no cleanup actions apply," and a run with a materialized header is a pipeline run whose worktree row always applies — so this is a belt-and-braces guard against a latent ordering hazard, not a live bug. The full procedure itself is a further lazy-load, one level deeper: `review-console.md`'s Auto-merge short-circuit heading only points at `auto-merge-short-circuit.md` — that file loads only for the run that actually clears the condition above, not for every run that clears the fast path.

### The phase-trace report (formerly Step 9)

Render the report as the engine's own trace of this run, never as prose composed by hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict
```

(Substitute the re-resolved run-dir path — env assignments do not survive between calls.)

Insert that output verbatim as the Phase 2 table. `--strict` prints the table first and then exits 2 if any worklist row has no recorded result, so a hole is visible *and* fatal. **Re-read cut:** when every row scanned clean or gate-closed (nothing to update anywhere), the render collapses to one line — `{N} rows scanned, 0 findings — nothing to update.` — instead of an N-row table that would otherwise be all `n/a`/`Clean` (`engine-render.js`'s `renderTrace`). A single row carrying findings, or a row with no recorded result at all, always forces the full table — the collapse never hides a real outcome. Under the prose fallback, compose the table by hand per `curation-engine.md` section 6 and caption it `(engine unavailable — prose fallback ran)`.

**Read the template.** Read `summary-template.md` in this skill's directory for the report's full shape and its conversation-mode variant. This read is unconditional — the report renders on every run.

Next Actions are rendered as a top-level `## Next Actions` section after execution — see the section near the end of this file.

### Execute approved actions (formerly Step 10)

Execute the cleanup planned above (canonical list in `cleanup-procedures.md`, filtered by Condition) plus the configuration, documentation, skill, and acceptance-labeling actions approved at the Review Console — then verify each one landed before the closure line is emitted.

**Gate the read.** Read `execution-and-verification.md` in this skill's directory — the `--dry-run` preview branch, the `MULTISPEC_REVIEW_DEFER` skip list, the full apply list (documentation, CLAUDE.md/rules, new docs, docs-health restructural filings, ADRs, skill updates, and acceptance labeling with its own gated read of `verification-brief.md`), the closing-keyword carrier commit, and the Verify-execution checklist — when at least one approved action exists: a cleanup row surviving the Condition filter, an approved configuration / documentation / skill update, an approved memory write or upstream filing, or record-mode acceptance labeling. When cleanup planning reported "No cleanup actions apply" and nothing else was approved, report "No actions to execute" and skip the read — there is nothing to commit or verify.

## Important Notes

- `/claude-tweaks:review` should have been run before `/claude-tweaks:wrap-up` — this skill assumes code quality is verified
- Skills document reusable patterns, not one-off implementations
- CLAUDE.md stays concise — use skills, rules, or reference docs for details
- Reflection insights with no clear destination must still be explicitly resolved — the user confirms "don't capture" with a reason, rather than the skill silently dropping them
- **Merge conflicts during wrap-up** (e.g., when merging a worktree feature branch back to main): resolve conflicts by understanding both sides' intent — read both versions, pick the correct merge. Never use `git reset` or `git checkout .` to discard changes.

## Next Actions

When this run **inherited** its run directory (see the Component-Skill Contract below), omit this block — the parent `/claude-tweaks:flow` renders its own Pipeline Summary + Next Actions after the report.

When invoked directly by a user (standalone wrap-up), resolve 2-4 lines based on context signals; always include the "next unblocked spec" line when one exists so the user doesn't have to run `/claude-tweaks:help` to find it. The signal-to-option lookup table below stays as-is — the assistant's own logic for picking which lines apply, never itself shown to the user:

| Signal | Option |
|--------|--------|
| Next spec exists (Phase 3's unblocked-records lookup) | `/claude-tweaks:flow {N}` — full pipeline on spec {N}: "{title}" **(Recommended)** |
| Newly unblocked records (Phase 3's dependent check — this run's session-scoped `wrapup-unblocked.json`, `_shared/session-tmp-root.md`, one option per entry) | `/claude-tweaks:flow #{N}` — record #{N} "{title}" now unblocked by this closure (bare `{N}` under `work-backend: local-files`) |
| Always | `/claude-tweaks:help` — full pipeline status |

Once the signals are resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention) — when a next spec exists, its line renders first, bolded, suffixed `(recommended)`; otherwise the lines render in the table's order with no line marked recommended:

**`/claude-tweaks:flow {N}`** — full pipeline on spec {N}: "{title}" (recommended, when a next spec exists)
`/claude-tweaks:flow #{N}` — record #{N} "{title}" now unblocked by this closure (one line per entry in this run's session-scoped `wrapup-unblocked.json`, up to the tool's option cap; bare `{N}` under `work-backend: local-files`)
`/claude-tweaks:help` — full pipeline status

## Component-Skill Contract

The signal is **who created the run directory**, not whether one exists — Phase 1 guarantees one either way, so `$PIPELINE_RUN_DIR` being set is no longer evidence of a parent.

**Consult Phase 1's determination, do not re-derive it.** Phase 1 decided inherited-vs-created once, at run-dir resolution time, and carried it forward as a run-scoped fact. By the time this contract is consulted, cleanup item 8 has usually archived the directory, so `run-state.json` is no longer where Phase 1 read it.

When the run directory was **inherited**, `/claude-tweaks:wrap-up` is running inside a `/claude-tweaks:flow` pipeline. In that case:
- Omit the `## Next Actions` block — the parent `/claude-tweaks:flow` renders its own pipeline summary.
- The Review Console honors `$MULTISPEC_REVIEW_DEFER` — if set, skip the per-spec console and let `/claude-tweaks:flow`'s consolidated console handle approvals.

When **this run created** its own run directory, `/claude-tweaks:wrap-up` runs standalone — render Next Actions as usual.

**A missing determination resolves to created.** If Phase 1's verdict is somehow unavailable and a `run-state.json` read is attempted as a last resort, an absent or unreadable file resolves to **created** — render Next Actions. The failure must fall toward showing the user their handoff: a suppressed handoff on a standalone run is silent and looks like the skill simply ended, while a redundant one inside `/claude-tweaks:flow` is visible and harmless.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Running wrap-up before review | Captures learnings from unvalidated work |
| Deleting specs that aren't 100% complete | Leftover work needs routing first — use Phase 3's leftover routing |
| Adding every insight to CLAUDE.md | Size budget — route detail to skills, rules, or memory files |
| Skipping reflection for "simple" work | It still surfaces surprises and near-misses |
| Keeping design docs and plans after wrap-up | Consumed artifacts go stale — spec and code are the durable records |
| Silently dropping insights with no obvious destination | Every insight needs an explicit decision — "don't capture" needs a user-stated reason |
| Completing wrap-up with open ledger items | The nothing-left-behind gate: resolve every item before the summary |
| Skipping a registry row because its gate looks obviously closed | The engine evaluates gates — a hand-skipped row is the silent skip render --strict exists to catch |
| Composing the Phase 2 trace or SCANNED lines by hand when the engine is available | Seven hand-maintained formats drifting was this architecture's motivating failure — render owns the format |
| Treating engine failure as permission to skip curation | The prose fallback in curation-engine.md is unconditional — the report states which path ran |
| Proposing generic skill updates with no concrete anchor | Every update must trace to a ledger entry, a reflection insight, or a changed-file observation — unanchored ones read as hallucinated; a reflect insight's own `Evidence:` line (#858) is the mechanical carrier of that anchor |
| Writing an ADR for every decision | ADRs are valuable because rare — the Decision records row's three-factor gate (hard-to-reverse AND surprising AND a real trade-off) keeps them so; zero per wrap-up is normal |
| Treating `demo:pending` as optional for "trivial" record-mode work | Triviality is not an exemption — it gets a fast path at `/demo`'s verdict step, not wrap-up's labeling step. The one record class that *does* skip its own label is a sub-issue with a resolvable parent, and that is the gate moving to the parent, not going away |
