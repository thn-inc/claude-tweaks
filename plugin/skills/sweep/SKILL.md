---
name: sweep
description: Hands-off hygiene sweep: tidy, specify drain, backlog refine headless, then attention. Keywords - sweep, hygiene, orchestrator
argument-hint: "[--budget <n|all>] [--scope <name>[,<name>...]]"
---

# Sweep — Hands-Off Queue Hygiene Orchestrator

Run everything cheap and frequent that doesn't need a human, in one command: `/claude-tweaks:tidy` (auto mode), `/claude-tweaks:specify` (bare drain), and `/claude-tweaks:backlog refine` (headless posture), in that order, under one shared run directory and one `decisions.md` — closing with `/claude-tweaks:backlog attention`'s render and a recommended `/claude-tweaks:dispatch` line. Sweep never claims, builds, or merges — that boundary is what makes it a legal parent of a grant-writing unit (refine's headless posture) under this codebase's self-authorization rule, and `evals/scenarios/sweep-never-invokes-build-machinery.yaml` pins it.

Lifecycle: utility — the on-demand, single-session sibling of the cloud fleet's independently scheduled hygiene rows (`routine/fleet.md`); it replaces none of them.

## When to Use

- The queue has accumulated hygiene debt — stale records, unshaped-but-eligible records, shaped-but-ungranted records — and you want one command to work through all of it without answering questions
- Before a dispatch session: run sweep first so `/claude-tweaks:dispatch` sees a tidied, shaped, granted queue
- NOT for audits — the four health sweeps (code/docs/journey/harness) are deliberate human-triggered audits, not hygiene, and sweep never runs them
- NOT for building — sweep never invokes `/claude-tweaks:flow`, `/claude-tweaks:build`, or `/claude-tweaks:dispatch`; its close-out only recommends the dispatch command

## Input

`$ARGUMENTS` is parsed as `[--budget <n|all>] [--scope <name>[,<name>...]]`, both optional, order-independent:

- `--budget <n|all>` → forwarded verbatim to the specify step (Step 2) — `_shared/record-batch-input.md`'s canonical `--budget` grammar; omitted, specify applies its own `specify-budget` policy default.
- `--scope <name>[,<name>...]` or `--scope=<name>[,<name>...]` — both spellings accepted for sweep's own argument; sweep normalizes to tidy's own `=` grammar when calling Step 1 (`--scope=<name>[,<name>...]`), rather than forwarding whichever spelling the caller typed. Omitted, tidy runs its full scan roster.

Anything else in `$ARGUMENTS` is an error — report it and stop; sweep deliberately accepts no mode keyword (it is always hands-off) and no record refs (it drains queues, it doesn't target records).

## Step 0: Resolve the run directory

Resolve one standalone run directory per `_shared/run-dir-resolution.md`'s standalone-auto fallback (sweep is on that file's allowlist):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --mode auto --standalone sweep --create
```

Adopt the printed path as `$PIPELINE_RUN_DIR` for the whole run — `{ISO}-sweep-standalone/` under the main checkout's `.claude-tweaks/pipelines/`, pre-populated with `decisions.md` and `staged/`. Every component step logs to this one `decisions.md`; none mints its own.

## Step 0.5: Invalidate the record snapshot

Other actors (a human, a concurrent session) may have written records earlier in this session, before sweep started — `record-snapshot-ttl-seconds` defaults to 300s, long enough for a stale snapshot to survive into Step 1's own mutating scan. Invalidate before tidy ever reads the queue, the same way Step 1.5 and 2.5 invalidate between the later steps:

```bash
node -e "require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)"
```

## Step 1: Tidy

Invoke `/claude-tweaks:tidy --source sweep` (appending `--scope=<...>` when given) in auto mode, under `$PIPELINE_RUN_DIR`. Per tidy's Component-Skill Contract, `--source sweep` forces the auto-mode path regardless of the project's `auto-mode` policy, logs to the shared `decisions.md`, stages findings to the shared `staged/`, and suppresses both tidy's `## Next Actions` block and its terminal `AskUserQuestion` approval — tidy reports its counts (applied / staged / yours / clean) back to this step instead. Findings route per the resolved `tidy-aggressiveness` tier (`tidy/step-6-auto.md`); `moderate` — the documented default, and unset (so the default applies) in this repo's own `.claude-tweaks/policy.yml` — auto-applies most Delete rows plus Mark-as-specified and Arm-ready-PR, stages a few Delete/Arm-ready-PR variants the table marks never-auto (`tidy/step-6-auto.md`'s routing table has the exact split), and stages everything else. Only the staged remainder waits for `/claude-tweaks:tidy --approve` after the run.

## Step 1.5: Invalidate the record snapshot

Tidy may have mutated records (closes, defers, `needs:decision` markers). Before Step 2, delete the session-scoped record snapshot so specify's drain reads tidy's mutations rather than a stale pre-tidy snapshot — `_shared/record-queue-fetch.md`'s invalidation rule, enforced at its own named point:

```bash
node -e "require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)"
```

## Step 2: Specify

Invoke `/claude-tweaks:specify --source sweep` bare (appending `--budget <n|all>` when given), under the same `$PIPELINE_RUN_DIR`. Per specify's Component-Skill Contract, `--source sweep` runs the bare-drain form headlessly: no `AskUserQuestion`, no suggestion menu, shared `decisions.md`; the drain's `{shaped: N, routed: M, failed: K}` close-out counts report back to this step. **Driver dependency:** under `work-backend: local-files`, this step's bare drain Preflight-stops completely (headless shaping is `github-issues` only), and so does Step 3's grant sub-stage — both steps effectively no-op on that backend; sweep still runs Step 1 (tidy) and the close-out normally.

## Step 2.5: Invalidate the record snapshot again

Specify's shaping and routing also mutate records. Repeat Step 1.5's invalidation command verbatim before Step 3.

## Step 3: Backlog refine (headless posture)

Invoke `/claude-tweaks:backlog refine --source sweep` under the same `$PIPELINE_RUN_DIR` — the headless posture (`backlog/refine-headless.md`): labeling lanes plus the grant chain, zero clicks. This is the call that only this skill's existence makes legal to run with nobody present outside a scheduled Routine — sweep itself never claims, builds, or merges, so parenting a grant-writing unit does not self-authorize anything. Refine reports its counts (granted / re-authorized / needs-decision / skipped) back to this step; its `## Next Actions` stays suppressed per `backlog/SKILL.md`'s presence rule.

## Failure propagation

An unhandled error in a step halts the sequence before the next step — sweep never runs specify against a possibly-incomplete tidy pass, or refine against a possibly-incomplete specify pass. On a halt, skip Step 4's normal render and report the partial run instead: which step failed, what it had completed before failing (from its counts and `decisions.md` entries), and which steps never ran. The partial-run report still ends with a short `## Next Actions` of its own, satisfying the Component-Skill Contract's "always renders when a human is present" rule even on a halt: re-run `/claude-tweaks:sweep`, and — if tidy's step completed before the halt — `/claude-tweaks:tidy --approve` for anything it staged. A step's own internal per-record error handling (specify's `failed` bucket, refine's per-record `failedKey` skips, tidy's staged fallbacks) is NOT a sweep-level failure — only an exception the step's own contract doesn't already catch halts the run.

## Step 4: Close-out

1. Repeat Step 1.5's invalidation command once more, so the close-out reads the run's final record state.
2. Invoke `/claude-tweaks:backlog attention`'s render — execute `backlog/attention-mode.md`'s existing Steps 1-4 directly as the first block of sweep's own output. Do not restate its fetch/merge/rank/render logic here: any future change to attention's row types or ranking must need no edit in this file. This includes its `### Batch launchers` block (`attention-mode.md` Step 4): `## Next Actions` below takes those lines verbatim from this render, never re-derives them.
3. **Staged for approval.** When `{run-dir}/staged/` is non-empty, render a `## Staged for approval` block: `{run-dir}/report-condensed.md`'s Approve section, verbatim (tidy's three-line-per-item shape with its command) — falling back to `report.md`'s Approve section when the condensed file is absent. Before sending, run `node "${CLAUDE_PLUGIN_ROOT}/bin/tidy-report-lint.js" --surface=condensed` over the block and fix any findings, the same pre-send scan `tidy/step-6-auto.md` mandates for its own chat render. When `staged/` is empty, render nothing — this block is display only; `/claude-tweaks:tidy --approve` remains the single write path. Attention's own Tidy row (Step 2 above) stays the one-line cross-run count; this block is the run's own click surface, so the items render once, not twice.
4. Render sweep's `## Next Actions` (below), then log one summary line to `decisions.md` with the three steps' counts.

## Next Actions

When Step 1's tidy pass staged anything this run (a non-zero `staged` count in the counts it
reported back), `/claude-tweaks:tidy --approve` leads the block, bolded and recommended —
clearing an already-vetted, zero-judgment batch is cheaper than either heavier pick below it,
so it takes the top slot ahead of both `/claude-tweaks:dispatch` and the needs-you slot that
would otherwise fill it. The dispatch/needs-you lines still render, one slot down, unbolded.
When nothing was staged this run, the original order applies unchanged, needs-you precedence
rule included.

**Tidy staged something this run:**
**`/claude-tweaks:tidy --approve`** — apply this run's staged tidy items (recommended)
`/claude-tweaks:dispatch` — drain the authorized queue this sweep just prepared
`/claude-tweaks:backlog attention` — re-check after acting

**Nothing staged this run (unchanged):**
**`/claude-tweaks:dispatch`** — drain the authorized queue this sweep just prepared (recommended)
`/claude-tweaks:tidy --approve` — apply this run's staged tidy items, if any
`/claude-tweaks:backlog attention` — re-check after acting

Precedence (nothing-staged case only — the staged case's top slot is always `tidy --approve`):
when attention's render above renders a non-empty `### Batch launchers` block, its lines — one
per group, in that block's own order — replace `/claude-tweaks:dispatch` in this slot entirely,
not just its top pick: every group's closing batch/ref-less/paste-block line renders, one per
line, with the same bold/`(recommended)` treatment applied to the first line only (mirroring
`backlog/SKILL.md`'s own needs-you-first precedence) and every line after it unbolded. This
applies under both orderings above — the nothing-staged case's top slot, and the tidy-staged
case's second slot — since either way it is `/claude-tweaks:dispatch`'s slot the batch launchers
occupy, never a slot of their own. When attention's Batch launchers block is empty (the ranked
table itself is empty), `/claude-tweaks:dispatch` renders in that slot as shown above, unchanged.

## Component-Skill Contract

`/claude-tweaks:sweep` is a **parent, never a child** — no skill invokes it, and it is not on any pipeline's step list. It sets `$PIPELINE_RUN_DIR` for its three component steps (Step 0) and passes `--source sweep` explicitly on every call; the flag, never a bare `$PIPELINE_RUN_DIR`, is the parent signal each child detects (a human or Routine can also set `$PIPELINE_RUN_DIR` via the standalone-auto path, so the variable alone proves nothing). Its own `## Next Actions` always renders when a human is present; a scheduled firing would omit it, but sweep ships no `routine-template.yml` — the cloud fleet keeps its own composition (`routine/fleet.md`).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Invoking `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or `/claude-tweaks:build` from sweep | Sweep's legality as a headless parent of the grant chain rests on never claiming, building, or merging — the eval scenario fails CI on this, not just doc review |
| Inferring parent invocation from `$PIPELINE_RUN_DIR` in a child | The variable is set by standalone-auto paths too — `--source sweep` is the only parent signal |
| Restating attention's fetch/merge/rank logic in the close-out | The two surfaces drift apart; call the existing render |
| Skipping the between-step snapshot invalidations | The next step reads a stale pre-mutation snapshot and re-processes records the previous step already disposed of |
| Continuing past a failed step | Specify against a half-finished tidy pass (or refine against a half-finished specify pass) acts on inconsistent queue state |
| Adding a mode keyword or per-record targeting | Sweep is always hands-off and always whole-queue; targeted work belongs to the children invoked directly |
