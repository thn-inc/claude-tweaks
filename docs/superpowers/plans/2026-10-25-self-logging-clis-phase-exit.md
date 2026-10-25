# Self-Logging CLIs and a Single Phase-Exit Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut pipeline bookkeeping turns: deterministic CLIs write the `decisions.md` entries for decisions they make, `log-decision.js` takes many entries in one call, and every phase exit is one `phase-exit.js` call.

**Architecture:** `plugin/bin/lib/log-decision/append.js` gains `appendEntries` (one lock, many entries); `log-decision.js` gains `--entries <file>`. The bin CLIs whose callers hand-log an outcome the CLI computed (`pr-merge-state.js`, `pr-checklist.js`, `set-config.js`, `pr-checks.js`, `closing-links.js`, `verify-run-bookends.js`, `console-filings.js`, `review-coordination.js resolve-tiebreak`, `hooks.js delete-ledger` — from a survey of all 122 `log-decision.js` mentions in `plugin/skills/**`, 38 of which narrate a CLI) append those entries themselves when given `--run`, and each task drops the matching prose instruction; the remainder stay with the caller by a stated rule (end of Task 8). A new `plugin/bin/phase-exit.js` (thin wrapper) over `plugin/bin/lib/phase-exit/phase-exit.js` (orchestration through injected deps) runs the whole phase exit — route check, commit check, bookkeeping backfill, push, checklist flip (in-process `pr-checklist.js` `run`), post-push merge-state read (in-process `pr-merge-state.js` `run`) — and prints one JSON line. Skill prose migrates to the new call shapes; the old CLIs and the single-entry `log-decision.js` form stay (expand-contract: the pre-merge refresh still calls `pr-checklist.js`, the installed plugin build still runs the old prose).

**Tech Stack:** Node 18+ CommonJS, `node --test`, no npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T132807-record-4026/work/4026-spec.md`

**Scope keywords:** log-decision.js, pr-merge-state.js, pr-checklist.js, Phase-exit push

## Global Constraints

- CLI wrapper contract (`.claude/skills/gh-api-module-pattern/SKILL.md` + its `cli-wrapper-contract.md`): `run(argv, deps)` seam, `if (require.main === module) process.exitCode = run(...)` (never `process.exit`), exit vocabulary 0 done/status-as-data, 2 malformed invocation, 3 run dir missing or not anchored (`resolveTarget` from `lib/log-decision/append.js`).
- Every `execFileSync` passes `windowsHide: true`; `git` calls pass `-C <dir>`; `gh` calls use `GH_TIMEOUT_MS` from `lib/shared-primitives` (the `bin-source-scan-conformance` suites enforce these — run `tests/bin-lib/*conformance*.test.js` after adding any spawn).
- An audit-line write never changes a CLI's exit code or its primary outcome; a failed append is reported in the envelope (`logFailures` / `logged: false`) plus one stderr line.
- run-state.json is written only through `hooks.js` verbs (`record-worktree`, `record-pr`) — `phase-exit` shells out to them, never writes the file.
- Skill-prose edits: a skill reference in actionable text uses `/claude-tweaks:{skill}`; no file under `plugin/skills/**` may exceed `RAIL_BYTES` (52,500 B; `plugin/bin/lib/skill-audit/budgets.js`). Headroom today: `build/SKILL.md` 49,812 B (2,688 B left), `review/code-mode-steps.md` 49,560 B (2,940 B), `flow/steps-and-gates.md` 39,391 B — call-site edits must be net-neutral or shrinking in the first two. The composed `merge` bundle (composed at `wrap-up/auto-merge-short-circuit.md`, `wrap-up/merge-mode.md`, `wrap-up/review-console.md`; it includes `_shared/pr-checklist-refresh.md`) already measures 50,932 B of its 52,500 B rail (`plan-audit.js` headroom, 2026-10-25) — edits to `pr-checklist-refresh.md`, `review-console.md` and `auto-merge-short-circuit.md` (Tasks 7, 8, 10) must shrink or stay net-neutral; re-run `node plugin/bin/plan-audit.js {this plan}` after Task 10 and confirm `composed[].over` is 0.
- Commit style: `{Verb} {what} — {detail}`, body `refs #4026` (never `closes`/`fixes`), ending with the `Claude-Session:` trailer the dispatching session supplies.
- Never `git stash`; never `run_in_background`; run tests in the foreground.

## Review Focus

1. A batch entries file with one bad entry among good ones — nothing may be written (validate all, then write once); the stderr names the bad entry's index.
2. `phase-exit` on a `local-merge` run or from the main checkout (`current-branch`) — no push, no `gh` call; only `build` logs the SKIP (parity with today's prose).
3. A failed push — the merge-state read must not run (it reads a stale tree), the checklist flip still runs, and the next phase exit retries (nothing persisted to run-state.json).
4. A branch equal to the integration branch, or a detached HEAD — `phase-exit` must refuse to push rather than push `main`.
5. A self-logging CLI whose `decisions.md` append fails — exit code and envelope outcome unchanged, failure surfaced as `logged: false` / `logFailures`.

Each line has its pinning test in the owning task (Task 1 test `rejects a batch with one invalid entry and writes nothing`; Task 9 tests for 2-4; Tasks 2-8 `append failure` tests for 5).

## Acceptance-criteria coverage

Waived AC1.1: `log-decision.js` invocations per pipeline ≤ 10 over 10 runs needs 10 real post-merge pipeline runs; the plan delivers the mechanism (Tasks 1-10) and the build seeds a `live-verification` ops ledger row for the measurement.

Waived AC4.1: median tool round trips falling ≥ 25 % over 10 runs (baseline 407) — same reason and the same ops ledger row as AC1.1.

- AC2.1 (each phase exit is one tool call) — Task 10 test `AC2.1: every phase-exit call site names one phase-exit.js invocation`.
- AC2.2 (phase-exit has a test for each sub-step's failure branch) — Task 9 tests prefixed `AC2.2:`.
- AC3.1 (decisions.md parity on a fixture pipeline) — Task 9 test `AC3.1: phase-exit writes the same entries the prose sequence wrote`, plus Tasks 2-8 `AC3.1:` tests (each self-logged entry equals the text the prose told the agent to log).

---

### Task 1: Batch entries in `log-decision.js`

**Files:**
- Modify: `plugin/bin/lib/log-decision/append.js`
- Modify: `plugin/bin/log-decision.js`
- Test: `tests/bin-lib/log-decision/append.test.js`, `tests/bin-lib/log-decision/cli.test.js`

**Interfaces:**
- Produces: `appendEntries({ runDir, items: Array<{ section?: string, entry: string }> }) -> { file, created }` — one `withLock` + one `writeFileAtomic` for the whole batch, entries placed in array order, each under its own `## {section}` heading (same placement rule as today's `appendEntry`). `appendEntry({ runDir, section, entry })` becomes `appendEntries({ runDir, items: [{ section, entry }] })` — byte-identical output.
- Produces: `log-decision.js --run <dir> --entries <file> [--section "/<skill>"]`. `<file>` holds a JSON array; each element `{ status, text, step?, spec?, reversibility?, lever?, section? }` (same validation as the single-entry flags: status in `STATUSES`, non-empty single-line `text`, `REVERSIBILITY_RE`, `spec` digits). An element's `section` wins over `--section`. `--entries` is mutually exclusive with `--status`/`--text`/`--text-file`/`--step`/`--spec`/`--reversibility`/`--lever` (exit 2). An empty array, a non-array, unparseable JSON, or any invalid element → exit 2, nothing written, stderr names `entries[{i}]`. On success stdout echoes every entry line in order. USAGE and the header comment name the new form.

- [ ] **Step 1: Write the failing tests** — in `append.test.js`: `appendEntries places a batch under mixed sections in order and matches sequential appendEntry output` (build the expected file by calling `appendEntry` three times on a second fixture; assert equal text). In `cli.test.js`: `--entries appends every entry in one call and echoes them`; `rejects a batch with one invalid entry and writes nothing` (entries `[valid, {status:'NOPE',text:'x'}]` → exit 2, stderr matches `/entries\[1\]/`, decisions.md absent); `--entries with --text is a usage error`; `an element section overrides --section`; `empty array is a usage error`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/log-decision/append.test.js tests/bin-lib/log-decision/cli.test.js` — Expected: FAIL (`appendEntries is not a function`, unknown argument `--entries`).
- [ ] **Step 3: Implement** `appendEntries` and `--entries` (parse with `JSON.parse(fs.readFileSync(path))`; validate every element with the existing checks before formatting any).
- [ ] **Step 4: Run** the same command — Expected: PASS, and the existing tests in both files still pass.
- [ ] **Step 5: Commit** — `Add batch entries to log-decision.js — one call, one lock for many decisions`.

### Task 2: `pr-merge-state.js` logs its own degrade trace

**Files:**
- Modify: `plugin/bin/pr-merge-state.js`
- Test: `tests/bin-lib/pr-merge-state/cli.test.js`

**Interfaces:**
- Produces: on states `unknown`, `read-failed`, `gh-absent` the CLI appends one SKIP entry under `PHASE_SECTIONS[phase]`: step `Post-push merge-state check (degraded)`, text `condition: pr-merge-state.js {state}{ (reason) when reason present} → fallback: no merge-state signal this phase`, reversibility `n/a`; envelope `logged: true` (false + stderr when the append throws). `conflicting` unchanged; `no-conflict`, `not-open`, `no-pr` stay silent. Header comment and USAGE updated.

- [ ] **Step 1: Write the failing tests** — `AC3.1: unknown, read-failed (with reason) and gh-absent each append the SKIP line the prose used to dictate` (assert the exact line text after the timestamp, section heading, `logged: true`); `append failure on a degrade state keeps exit 0 and reports logged:false`; extend the silent-state test to assert no decisions.md for `no-conflict`/`not-open`/`no-pr`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/pr-merge-state/cli.test.js` — Expected: FAIL (no decisions.md written for `unknown`).
- [ ] **Step 3: Implement** — reuse the `conflicting` branch's try/append shape for the three degrade states.
- [ ] **Step 4: Run** the same command — Expected: PASS (update any existing assertion that pinned `logged: false` for those three states).
- [ ] **Step 5: Commit** — `Log pr-merge-state degrade traces from the CLI — callers stop hand-logging SKIP`.

### Task 3: `pr-checklist.js` logs its refusal and gh-failure lines

**Files:**
- Modify: `plugin/bin/pr-checklist.js`
- Test: `tests/bin-lib/flow/pr-checklist-cli.test.js`

**Interfaces:**
- Produces: exit 4 (run-marker mismatch) appends `AUTO` step `PR checklist refresh`, text `refused on PR #{n} — run marker mismatch (body names run {found|none}, expected {runId})`, reversibility `n/a`. Exit 5 (`gh pr view`/`gh pr edit` failed) appends `AUTO` step `PR checklist refresh`, text `gh pr {view|edit} failed on PR #{n} at {phase} exit — row left for the pre-merge refresh`, reversibility `n/a`. Exit codes unchanged; an append failure adds one stderr line only (the exit code already carries the outcome). The `written` branch's existing restore line and `logFailed` stay.

- [ ] **Step 1: Write the failing tests** — `AC3.1: a marker mismatch exits 4 and logs the refusal line`; `a gh pr edit failure exits 5 and logs the warning line`; `a gh pr view failure exits 5 and logs the view warning`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/pr-checklist-cli.test.js` — Expected: FAIL (no decisions.md).
- [ ] **Step 3: Implement** — one local `logLine(text)` helper wrapping `deps.appendDecision` in try/catch.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Log pr-checklist refusals and gh failures from the CLI`.

### Task 4: `set-config.js --set` logs the Manifesto write line

**Files:**
- Modify: `plugin/bin/set-config.js` (and `plugin/bin/lib/set-config/write.js` only if the path is computed there)
- Test: `tests/bin-lib/set-config/cli.test.js`

**Interfaces:**
- Produces: after a successful `--set` batch write, append `AUTO` under section `/flow`, step `Manifesto`, text `levers written to {absolute config.yml path}`, reversibility `n/a` — the line `flow/manifesto.md`'s Write mechanism and `_shared/auto-decision-log.md`'s worked example (#1826/#1810) told the agent to log. The single-key `--key/--value` form logs nothing new. A failed append never changes the exit code (stderr line).

- [ ] **Step 1: Write the failing test** — `AC3.1: --set batch logs "levers written to {path}" under /flow`; `--key/--value logs nothing`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/set-config/cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Log the Manifesto config write from set-config.js`.

### Task 5: `pr-checks.js` logs the PR-check gate's caveat and degrade lines

**Files:**
- Modify: `plugin/bin/pr-checks.js`
- Modify: `plugin/skills/_shared/pr-check-gate.md` (the `inherited-red`, `pending`/`stale`, and `no-pr`/`gh-absent`/`no-ci`/`read-failed` bullets: replace each `log-decision.js` command with "the CLI already wrote the entry; on `logged: false` write it yourself with the same text"; the invocation gains `--section "{/test|/review}"`; exit 2/3 keep the hand-written SKIP — an unanchored run dir cannot be written)
- Test: `tests/bin-lib/pr-checks/cli.test.js` (and any suite the Moved-prose pin grep finds for `--step "PR-check gate"`)

**Interfaces:**
- Produces: new flag `--section <"/<skill>">` (valid only with `--run`; exit 2 otherwise). When `--run` is given, the CLI appends under `--section` (no heading when absent), step `PR-check gate`: `inherited-red` → AUTO, text `PR #{pr} checks red at {headRefOid short}, but every failing check ({names}) is also failing on {baseBranch} at {baseSha short} — inherited, passed with caveat`, reversibility `high`; `pending`/`stale` → AUTO, text `PR #{pr} checks {state} at {headRefOid short} ({pending names, or 'HEAD not yet pushed'}) — passed with caveat`, reversibility `high`; `no-pr`/`gh-absent`/`no-ci`/`read-failed` → SKIP, text `condition: pr-checks.js {state}{: reason} → fallback: local verification only`, reversibility `n/a`. `green`/`red` log nothing. The envelope gains `logged: true|false` only when `--run` was passed (byte-identical envelope for the `--pr` callers in `github-pr-scan.md` and `settle-parked.md`).

- [ ] **Step 1: Write the failing tests** — `AC3.1: inherited-red under --run logs the caveat line the gate prose dictated`; `pending and stale log their caveat lines`; `each degrade state logs the SKIP line`; `green and red log nothing`; `--pr without --run keeps the envelope byte-identical (no logged key)`; `--section without --run is a usage error`; `append failure reports logged:false and keeps exit 0`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/pr-checks/cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement**, then edit `pr-check-gate.md` per Files.
- [ ] **Step 4: Run** `node --test tests/bin-lib/pr-checks/cli.test.js` plus every suite `git grep -l -F 'PR-check gate' -- tests` lists — Expected: PASS.
- [ ] **Step 5: Commit** — `Log PR-check gate caveats and degrade traces from pr-checks.js`.

### Task 6: `closing-links.js` and `verify-run-bookends.js` log their degrade lines

**Files:**
- Modify: `plugin/bin/closing-links.js`, `plugin/bin/verify-run-bookends.js`
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (Step 4.0: exits 4-5 and `gh-absent` are now the CLI's SKIP; exit 3 keeps the hand-written line), `plugin/skills/dispatch/task-prompt.md` and `plugin/skills/flow/claim-targets.md` (the `verify-run-bookends: degraded —` paragraphs: the CLI writes the SKIP; the hand log runs only when its envelope says `logged: false`)
- Test: `tests/bin-lib/closing-links/` CLI suite, `tests/bin-lib/verify-run-bookends/` suite (locate with `git ls-files tests | grep -e closing-links -e verify-run-bookends`)

**Interfaces:**
- Produces (`closing-links.js`, both modes): on `gh-absent`, exit 4 and exit 5, append SKIP step `Closing links ({pre-merge|post-merge}) (degraded)`, text `condition: closing-links.js {gh-absent|exit 4 run marker mismatch|exit 5 gh failure: {first stderr line}} → fallback: closing links not checked this merge`, reversibility `n/a`, section `/wrap-up`. Exit codes unchanged.
- Produces (`verify-run-bookends.js`): when it prints its `verify-run-bookends: degraded —` stderr line, also append SKIP (no section), text `condition: {that stderr line, without its "verify-run-bookends: " prefix} → fallback: PR-bookend check not run`, reversibility `n/a`; JSON envelope gains `logged`. Exit codes unchanged.

- [ ] **Step 1: Write the failing tests** — `AC3.1: closing-links gh-absent / exit 4 / exit 5 each log one SKIP` (both modes for gh-absent); `AC3.1: verify-run-bookends degraded pin logs the SKIP line`; append-failure tests for both.
- [ ] **Step 2: Run** both suites — Expected: FAIL.
- [ ] **Step 3: Implement**, then edit the three prose files per Files.
- [ ] **Step 4: Run** both suites plus `git grep -l -e 'PR-bookend check not run' -e 'Exit\s*3-5' -- tests` hits — Expected: PASS.
- [ ] **Step 5: Commit** — `Log closing-links and bookend degrade traces from the CLIs`.

### Task 7: `console-filings.js` and `review-coordination.js resolve-tiebreak` log their outcomes

**Files:**
- Modify: `plugin/bin/console-filings.js`, `plugin/bin/review-coordination.js`
- Modify: `plugin/skills/wrap-up/review-console.md` (Can't-tell filings: drop the per-`deduped` `log-decision.js` command — the CLI wrote it), `plugin/skills/review/step3-tiebreak.md` (step 3: pass `--run "$PIPELINE_RUN_DIR"` to `resolve-tiebreak` in a pipeline run; the separate `log-decision.js` call runs only when the envelope says `logged: false`, keeping the retry-once and "no verdict line" rule)
- Test: the two CLIs' suites (`git ls-files tests | grep -e console-filings -e review-coordination`)

**Interfaces:**
- Produces (`console-filings.js`): for each `deduped` entry, append AUTO section `/wrap-up`, step `Queue write`, text `{item} already filed as #{number} (work-fingerprint {fingerprint})`, reversibility `n/a`; envelope gains `logFailures: [{item, error}]` (always present, empty when none). `--list` logs nothing.
- Produces (`review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>]`): with `--run`, append `{logStatus}` section `/review`, step `{logStep}`, text `{logText}`, reversibility `high`; envelope gains `logged`. `--run` is anchored with `resolveTarget` (exit 3 refusal, same as every run-dir CLI). Without `--run`, output byte-identical.

- [ ] **Step 1: Write the failing tests** — `AC3.1: console-filings logs one Queue write line per deduped entry`; `AC3.1: resolve-tiebreak --run appends the line it prints`; `resolve-tiebreak without --run is byte-identical`; append-failure tests.
- [ ] **Step 2: Run** both suites — Expected: FAIL.
- [ ] **Step 3: Implement**, then edit the two prose files per Files.
- [ ] **Step 4: Run** both suites plus `git grep -l -e 'already filed as' -e 'logStatus' -- tests` hits — Expected: PASS.
- [ ] **Step 5: Commit** — `Log Queue-write dedups and tiebreak verdicts from their CLIs`.

### Task 8: `hooks.js delete-ledger` logs a report that leaves the ledger

**Files:**
- Modify: `plugin/bin/hooks.js` (the `delete-ledger` verb only — read `.claude/skills/hooks-js-verb-registration/SKILL.md` first; no new verb, no new flag)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (Item 2 report handling) and `plugin/skills/wrap-up/auto-merge-short-circuit.md` ("Every other report except `not found`"): the verb writes the SKIP when it resolved an anchored run dir; the hand log stays for a refused `--run` / no run dir found / candidate refusal
- Test: the existing `delete-ledger` suite (`git grep -l "delete-ledger" -- tests`)

**Interfaces:**
- Produces: when `delete-ledger` resolved an anchored run dir and its report is anything other than `deleted` or `not found`, append SKIP section `/wrap-up`, step `Cleanup item 2 delete-ledger (skipped)`, text `condition: delete-ledger reported {report} → fallback: ledger left on disk, nothing committed for item 2`, reversibility `n/a`. Never throws out of the verb (hooks.js's never-break invariant, `docs/hooks.md`); exit code and printed report unchanged.

- [ ] **Step 1: Write the failing test** — `AC3.1: a failed delete logs the SKIP line; deleted and not found log nothing`.
- [ ] **Step 2: Run** the delete-ledger suite — Expected: FAIL.
- [ ] **Step 3: Implement**, then edit the two prose files.
- [ ] **Step 4: Run** the suite plus `tests/hooks*.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Log delete-ledger's non-delete reports from the verb`.

**Not migrated, by rule (recorded in `_shared/auto-decision-log.md` by Task 10 so the next author applies the same line):** a CLI self-logs a decision it reports as data. These stay with the caller: (a) entries reporting a CLI's own failed invocation (`compose-subject.js` failure, `diff-facts.js`/`shadow-dup-proposal.js`/`phase-timing.js --check-budgets` non-zero exits, `record-worktree` not printing `worktree recorded`, `review-coordination.js write-findings` exit 3, `release-local.js`'s per-subprocess log) — a failing process cannot be trusted to have logged; (b) a CLI that runs before the run directory exists (`preflight-records.js` — `multispec-merge-gate.md`/`multispec-preflight-failure.md` log "once the parent run directory exists"); (c) read-only fact packs (`flow-preflight.js`, `wrap-up-pack.js` — their contract is no writes beyond the pack); (d) resolvers called from many sites where no entry is owed (`resolve-policy.js`, `resolve-profile.js`); (e) entries whose text depends on the caller's own retry state (`release-note-repair.js`'s second-exit-4 branch); (f) lib modules run through `node -e`, which are not bin CLIs (`merge-verdict.js`, `exclusions.js`, `first-call-artifact-check.js`).

### Task 9: `phase-exit.js` — the whole phase exit in one call

**Files:**
- Create: `plugin/bin/lib/phase-exit/phase-exit.js`
- Create: `plugin/bin/phase-exit.js`
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js`
- Modify: `docs/plugin-structure.md` (one CLI line beside `pr-checklist.js`'s; one `plugin/bin/lib/phase-exit/` directory line)

**Interfaces:**
- Consumes: `prChecklist.run(argv, deps)` (`plugin/bin/pr-checklist.js`), `prMergeState.run(argv, deps)` and `PHASE_SECTIONS` (`plugin/bin/pr-merge-state.js`), `resolveTarget`/`formatEntry`/`appendEntry` (`lib/log-decision/append.js`), `readRunStateWithParent` (`lib/hooks/context`).
- Produces: `node plugin/bin/phase-exit.js --run <run-dir> --phase <build|test|review|polish|wrap-up> --worktree <path> [--fixes <n>[,<m>...]] [--remove] [--summary-file <file>] [--help]`. `--remove`/`--summary-file`/`--fixes` are forwarded to `pr-checklist.js` unchanged. Prints one JSON line:
  `{ phase, route, branch, head, commit: { clean, dirty: [paths] }, bookkeeping: { worktree: 'present'|'backfilled'|'failed', pr: 'present'|'backfilled'|'missing'|'n/a' }, push: { state: 'pushed'|'failed'|'refused'|'skipped', reason? }, checklist: { exit, ...pr-checklist envelope } | null, mergeState: { ...pr-merge-state envelope } | null, logFailures: [] }`.
  `route`: `pr-first` | `local-merge` | `current-branch`. Exit 0 in every route/state; 2 malformed; 3 run dir missing or not anchored.
- `lib/phase-exit/phase-exit.js` exports `runPhaseExit(opts, deps) -> envelope` and `realDeps` with seams: `git(args) -> stdout` (throws on non-zero), `gh(args) -> stdout`, `resolvePolicy(runDir, key) -> string` (shells `node <bin>/resolve-policy.js --run <runDir> --values <key>`), `hooks(args) -> stdout` (shells `node <bin>/hooks.js ...`), `prChecklistRun(argv, deps)`, `prMergeStateRun(argv, deps)`, `appendDecision`, `now`, `readRunState`.

Sub-steps, in this order (each a guard the replaced prose left to the reader — `cli-wrapper-contract.md`'s "A CLI that replaces a prose procedure" bullet):
1. **Route.** `resolvePolicy(run, 'integration-model')`; `git -C wt rev-parse --git-dir` equal to `--git-common-dir` → `current-branch` (compare after `path.resolve(wt, out)` — in a main checkout both print the relative `.git`; probed 2026-10-25 in this worktree: `…/claude-tweaks/.git/worktrees/dispatch-record-4026` vs `…/claude-tweaks/.git`). Probes run 2026-10-25: `gh pr list --head worktree-dispatch-record-4026 --state open --json number,url` → `[{"number":4277,…}]`; `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` → `origin/main`. Not `pr-first`, or `current-branch` → no push/`gh`; when `phase === 'build'` append SKIP section `/build`, step `Common Step 7 phase-exit push (skipped)`, text `condition: integration-model=local-merge or current-branch mode → fallback: no phase-exit push, one push at finish` (today's `_shared/git-discipline.md` text, verbatim); other phases silent. Return.
2. **Branch guard.** `git -C wt branch --show-current`; empty (detached) or equal to the integration branch — `resolvePolicy(run, 'integration-branch')`, else (it prints empty on this repo today — probed 2026-10-25) `git -C wt symbolic-ref --quiet --short refs/remotes/origin/HEAD` minus its `origin/` prefix, else `main` → `push.state: 'refused'`, AUTO line step `Phase-exit push`, text `refused to push {branch|detached HEAD} at {phase} exit — not a run branch`; skip push and merge-state, still flip the checklist.
3. **Commit check.** `git -C wt status --porcelain`; non-empty → `commit.clean: false`, AUTO line step `Phase-exit push`, text `{N} uncommitted path(s) at {phase} exit not included in the push`. Continue.
4. **Bookkeeping.** run-state `worktree` absent → `hooks(['record-worktree','--run',run,wt])`, success line must contain `worktree recorded`; `pr` absent → `gh pr list --head {branch} --state open --json number,url` → exactly one → `hooks(['record-pr','--run',run,n,url])`; none → `pr: 'missing'`. Each backfill appends AUTO step `Common Step 7 bookkeeping assertion` (build) / `Phase-exit bookkeeping assertion` (other phases), text `backfilled {worktree registration|PR-early lifecycle (recorded open PR #n)} before phase-exit push`, reversibility `high` — build's text matches today's `build/SKILL.md` Common Step 7 line.
5. **Push.** `git -C wt push origin {branch}`. Throw → `push.state: 'failed'`, AUTO step `Phase-exit push`, text `push of {branch} to origin FAILED at {phase} exit ({first stderr line}); the next phase exit's push retries`, reversibility `n/a`. Nothing written to run-state.json.
6. **Checklist.** Always (unless route returned): `prChecklistRun(['--run',run,'--phase',phase,...forwarded])` with captured stdout/stderr; record `{ exit, ...parsed JSON }` (`pr-checklist.js` self-logs exits 4/5 after Task 3).
7. **Merge state.** Only when `push.state === 'pushed'`: `prMergeStateRun(['--run',run,'--phase',phase])`; record its JSON (it self-logs after Task 2).

- [ ] **Step 1: Write the failing tests** (fake deps, fake-`.git` anchored fixture like `tests/bin-lib/pr-merge-state/cli.test.js`; `prChecklistRun`/`prMergeStateRun` faked to print fixed JSON):
  - `AC2.2: route — local-merge at build logs the SKIP line and calls no git push or gh`; `local-merge at test is silent`; `current-branch (git-dir == common-dir) skips like local-merge`.
  - `AC2.2: branch guard — detached HEAD and the integration branch are refused, checklist still runs, merge-state does not`.
  - `AC2.2: commit check — a dirty tree logs the uncommitted-paths line and still pushes`.
  - `AC2.2: bookkeeping — missing worktree calls record-worktree and logs the backfill line`; `missing pr with one open PR records it`; `missing pr with no open PR reports missing and logs nothing`; `record-worktree failing output reports failed`.
  - `AC2.2: push failure logs the FAILED line, skips merge-state, still flips the checklist`.
  - `AC2.2: checklist exit 4/5 is reported in the envelope with exit 0 overall`.
  - `AC2.2: merge-state envelope is carried through after a successful push`.
  - `AC2.2: an append failure lands in logFailures and changes nothing else`.
  - `AC3.1: phase-exit writes the same entries the prose sequence wrote` — for the clean pr-first build exit (expected: zero entries), push failure, local-merge build, and missing-worktree backfill, compare the decisions.md entry lines with timestamps stripped (`/^- (\w[\w-]*) \d{2}:\d{2}:\d{2} — /` → `- $1 — `) against literal expected lines copied from the current prose (`_shared/git-discipline.md` SKIP text, `build/SKILL.md` Common Step 7 backfill text).
  - CLI wrapper: `--help` exit 0; missing `--worktree`/`--phase` exit 2; unanchored `--run` exit 3.
- [ ] **Step 2: Run** `node --test tests/bin-lib/phase-exit/phase-exit.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `lib/phase-exit/phase-exit.js` and the wrapper; add the two `docs/plugin-structure.md` lines.
- [ ] **Step 4: Run** `node --test tests/bin-lib/phase-exit/phase-exit.test.js tests/bin-lib/exit-code-conformance.test.js` and every `tests/bin-lib/*conformance*.test.js` / `tests/*windows*hide*` spawn-scan suite (`git grep -l windowsHide -- tests`) — Expected: PASS.
- [ ] **Step 5: Real-input probe** — run the built CLI once against a fake run dir with `--help` only (never against this run's live PR — a real push/edit is the next phase's job); record the printed usage in the commit body.
- [ ] **Step 6: Commit** — `Add phase-exit.js — commit check, push, checklist, merge state in one call`.

### Task 10: Migrate the phase-exit and shared-contract prose

**Files:**
- Modify: `plugin/skills/_shared/git-discipline.md` (Phase exit section: the one call; Post-push merge-state check: `phase-exit.js` runs the read, the degrade SKIP is the CLI's, `logged: false` hand-log stays; the catch-up stays the agent's)
- Modify: `plugin/skills/_shared/pr-checklist-refresh.md` (Phase-checklist update: reached through `phase-exit.js` at a phase exit; exit 4/5 lines are now the CLI's; the pre-merge refresh keeps calling `pr-checklist.js` directly)
- Modify: `plugin/skills/_shared/auto-decision-log.md` (Entry schema: the `--entries` batch form; "Regardless of worktree state" paragraph: CLIs given `--run` append their own entries through `lib/log-decision/append.js` — a skill never re-logs an entry a CLI already wrote, and hand-logs only on the CLI's `logged: false`/`logFailures`; the six "stay with the caller" classes from the end of Task 8, as one short list; batch the model-judged entries a phase accumulates into one `--entries` call at phase end — the file written with the Write tool to a `bin/session-tmp-resolve.js` path, never through the shell)
- Modify: `plugin/skills/flow/manifesto.md` and `plugin/skills/flow/steps-and-gates.md` case 3 (drop the hand-logged "levers written to {path}" instruction — `set-config.js --set` writes it since Task 4)
- Modify call sites to one `phase-exit.js` invocation each, still citing both `_shared/git-discipline.md` and `_shared/pr-checklist-refresh.md`: `plugin/skills/build/SKILL.md` Common Step 7 (the Bookkeeping assertion paragraph collapses into the CLI's sub-step 4 — keep the `#2311` heading sentence and its "before the phase-exit push" ordering), `plugin/skills/test/SKILL.md`, `plugin/skills/review/code-mode-steps.md`, `plugin/skills/flow/steps-and-gates.md` (polish), `plugin/skills/wrap-up/execution-and-verification.md` (archive-path `--run` rule unchanged), `plugin/skills/flow/multispec-parallel-waves.md`
- Test: create `tests/phase-exit-call-sites-conformance.test.js`; update pins in `tests/git-discipline-merge-state-conformance.test.js`, `tests/build-common-step7-bookkeeping-assertion.test.js`, `tests/build-skip-degrade-trace-adoption.test.js`, `tests/pr-early-run-lifecycle.test.js`, `tests/wrap-up-leave-open-mergeability-conformance.test.js`, and any other suite the moved-phrase greps below hit.

**Interfaces:**
- Consumes: Task 9's invocation shape, verbatim: `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-exit.js" --run "$PIPELINE_RUN_DIR" --phase {phase} --worktree "{worktree-path}" --fixes {n}[,{m}...]`.

- [ ] **Step 1: Moved-prose pin discovery** — before editing, for each paragraph being rewritten grep two or three distinctive phrases over `tests` and `plugin` (`git grep -n -F '{phrase}' -- tests plugin`), and for each `plugin/` hit grep `tests/` for that file's basename; list every pinning suite and update it in this task. Phrases to start from: `push the branch and flip this phase's PR checklist row`, `if it carries no \`worktree\` field, run \`record-worktree\` now`, `--step "Post-push merge-state check" --reversibility n/a`, `log \`AUTO {time} — PR checklist refresh: refused`, `levers written to`.
- [ ] **Step 2: Write the failing conformance test** `tests/phase-exit-call-sites-conformance.test.js`: `AC2.1: every phase-exit call site names one phase-exit.js invocation` — for each of the six call-site files, the phase-exit paragraph contains `bin/phase-exit.js" --run` with the right `--phase` value and no separate `git -C "{worktree-path}" push origin`, `bin/pr-checklist.js`, or `bin/pr-merge-state.js` invocation in that paragraph; plus a go-red control that deletes the invocation from one file and expects the shared assertion function to throw (`plan-authoring-checks.md`'s Go-red control check). Also `auto-decision-log.md documents --entries and the self-logging rule`.
- [ ] **Step 3: Run** `node --test tests/phase-exit-call-sites-conformance.test.js` — Expected: FAIL.
- [ ] **Step 4: Edit the prose** per Files above; measure `wc -c` on `build/SKILL.md` and `review/code-mode-steps.md` after editing (must stay ≤ their current size).
- [ ] **Step 5: Run** `node --test tests/phase-exit-call-sites-conformance.test.js` plus every suite Step 1 listed — Expected: PASS.
- [ ] **Step 6: Commit** — `Migrate phase-exit and self-logged decisions to the new CLIs in skill prose`.
