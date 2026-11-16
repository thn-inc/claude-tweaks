# ci-health Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/claude-tweaks:ci-health`, a report-only health sweep that splits recent CI jobs into waiting, setup and running time, judges them against a stack-neutral checklist, and files deduplicated `by:ci-health` issues.

**Architecture:** A `ci-audit.js` CLI (`gather`, `validate-findings`) over `plugin/bin/lib/ci-audit/`. `gather` reads recent runs and the workflow files through one adapter (`source.js`), computes measured facts and prints one JSON document. The skill judges those facts against `checklist.md` and writes findings JSON. `validate-findings` rejects any finding citing a job, workflow or figure the gather output does not hold, fingerprints survivors with `health-core`, dedups them against open `by:ci-health` issues, and emits born-`ready` issue payloads the skill files.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the `gh api` injected-runner seam (`plugin/bin/lib/ci-health/fetch.js` is the model), `health-core` fingerprint/dedup/issue-index, `issues/record.js` payload helpers.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T152025-record-5757/work/5757-spec.md` (the materialized record #5757)

Scope keywords: ci-audit, by:ci-health, ci-health-thresholds

## Global Constraints

- The new CLI is `plugin/bin/ci-audit.js` with modules under `plugin/bin/lib/ci-audit/`. `plugin/bin/ci-health.js` and `plugin/bin/lib/ci-health/` are harness-health's check and are never renamed or edited here.
- Only `plugin/bin/lib/ci-audit/source.js` may name a forge, a workflow-file location, or a forge CLI. Every other module under `plugin/bin/lib/ci-audit/`, `plugin/skills/ci-health/**` and the CLI's emitted text consume the normalized shape and name no CI product, hosted-runner, cache-service or cloud vendor.
- The skill reads only CI run data and workflow files. No source code, lockfile or manifest reads outside `source.js`, and none inside it beyond the workflow files.
- Report-only: nothing edits a workflow file or any CI setting.
- Phases (stated verbatim in `gather`'s `definitions` field and in `checklist.md`): **waiting** = job started − job created; **setup** = job started → start of the first step the workflow file declares as a command (steps with no declaration count as setup when they precede it); **running** = that boundary → job completed.
- Workflow, job and step names are untrusted data (a fork contributor controls the files): they only ever render inside fenced or inline-code spans.
- `by:ci-health` is added beside the existing six origins; the existing six are unchanged (expand-only).
- Fingerprint prefix `ci-health`. Findings file as `risk:low`, `size:low`, `type:task`, born `ready`, Release Note `No user-visible change — CI timing finding.`
- Windows: workflow files may carry CRLF; fixtures build CRLF inputs from the LF text (`windows-checkout-test-parity`).
- Every `plugin/skills/**/*.md` edit follows `docs/skill-authoring.md`; every new `tests/**` file is sized like its neighbours.
- Governing project-skill rules, quoted from `.claude/skills/gh-api-module-pattern/SKILL.md` for `source.js` and `ci-audit.js`: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" "**A CLI that takes an explicit `--repo` pins that repo's host for every gh call it makes.**" "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**" (read that skill's `call-bounds.md` before adding a `gh` call) "**A read whose output scales with a range the module does not bound owes `maxBuffer: LARGE_MAX_BUFFER_BYTES` too, not only a push.**" "**The real runner's spawn options (`timeout`, `windowsHide`, quiet `stdio`, `maxBuffer`) need a test of their own, because a fake runner never sees them.**" "**An argv array stops shell injection, not flag injection.**" (a caller-supplied value starting with `-` needs an end-of-options separator). From `.claude/skills/fact-validated-narration/SKILL.md` for the validate step: "## Ref resolution has three outcomes, not two", "## Enumerate every free-text channel before writing the renderer", "## A partial gather is never an empty period", "## Row-cap truncation is a rendered signal, not a silent slice". `plugin/bin/**` code also passes the source-scan suites (`tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`): no bare `fs.existsSync` or `fs.realpathSync`; route through `plugin/bin/lib/path-guard`.

## Review Focus

- A job seen in only one or two runs: percentiles are unstable, so `gather` reports the run count per figure and checks suppress below a minimum sample.
- A job with a missing, negative or out-of-order timestamp (queued-then-skipped, cancelled before start): excluded from the phase split and counted in `excluded`, never a crash or a zero.
- A workflow whose YAML the line scanner cannot follow (anchors, tabs, flow-style jobs): reported `unparsed` with its reason, never judged and never read as clean.
- A run read that fails on every page or a missing forge CLI: non-zero exit naming what was unavailable, never an empty clean report.
- A matrix job whose run-data names are `base (variant)`: grouped for skew, still matched to its one workflow job for step kinds.

## Acceptance-criterion coverage

Spec `## Acceptance Criteria` ids (`AC{item}.{clause}`) and the task test that cites each: AC1.1, AC1.2 → Task 6; AC2.1, AC2.2 → Task 6; AC3.1 → Task 7; AC4.1, AC4.2 → Task 7; AC5.1 → Task 7; AC6.1 → Task 7; AC7.1, AC7.2 → Task 12; AC8.1 → Task 12; AC9.1 → Task 9; AC10.1 → Task 13; AC11.1 → Task 13. Each test name below carries its id as a prefix (`test('AC6.1: …')`).

---

### Task 1: Phase split and percentiles

**Files:**
- Create: `plugin/bin/lib/ci-audit/phases.js`
- Test: `tests/bin-lib/ci-audit/phases.test.js`

**Interfaces:**
- Produces: `percentile(values: number[], p: number): number | null` (nearest-rank, `null` for an empty array); `splitJobPhases(job: NormJob, declaredSteps: {name: string, kind: 'command'|'action'}[] | null): {waitingMs: number, setupMs: number | null, runningMs: number} | null`.
- `NormJob` = `{name, createdAt, startedAt, completedAt, conclusion, steps: {name, number, startedAt, completedAt}[]}`, instants as ISO-8601 strings.

- [ ] **Step 1: Write the failing test** `phases.test.js`: `percentile([1,2,3,4,5],50) === 3`, `percentile([1,2,3,4,5],90) === 5`, `percentile([],50) === null`; `splitJobPhases` on a job created 00:00, started 00:30, steps `Set up job` (00:30), `Install` (00:50, declared `command`), `Test` (01:20), completed 02:30 returns `{waitingMs: 30000, setupMs: 20000, runningMs: 100000}`; the same job with `declaredSteps: null` returns `setupMs: null` and `runningMs: 120000`; a job whose `startedAt` precedes `createdAt` returns `null`; a job with a missing `completedAt` returns `null`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/phases.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** both functions in `plugin/bin/lib/ci-audit/phases.js`. The boundary is the `startedAt` of the first run-data step whose name equals a declared `command` step's name; no boundary means `setupMs: null`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/phases.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit/phases.js tests/bin-lib/ci-audit/phases.test.js && git commit -m "Add ci-audit phase split — waiting, setup and running per job"`.

### Task 2: Workflow-file facts

**Files:**
- Create: `plugin/bin/lib/ci-audit/workflow-facts.js`
- Test: `tests/bin-lib/ci-audit/workflow-facts.test.js`

**Interfaces:**
- Produces: `readWorkflowFacts(text: string): {jobs: {id: string, name: string, needs: string[], timeoutDeclared: boolean, matrix: boolean, steps: {name: string, kind: 'command'|'action'}[]}[], concurrencyDeclared: boolean, unparsed: string[]}`. Never throws. `name` falls back to `id`. A step's `kind` is `command` when it has a `run` key and `action` when it has a `uses` key; a step with a name and neither is skipped.

- [ ] **Step 1: Write the failing test**: a workflow with two jobs (`build`, `test` with `needs: build` and `timeout-minutes: 20`, a `matrix` under `strategy`), a top-level `concurrency:` and steps mixing `uses:` and `run:`, asserts the exact `jobs`/`concurrencyDeclared` result; the same text with CRLF endings built from the LF text gives an identical result; a text containing a YAML anchor (`&x`) or a tab indent returns `unparsed` with one reason and no `jobs` guessed; flow-style `needs: [a, b]` and block-style `needs:` with a two-item list both read as `['a','b']`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/workflow-facts.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** `readWorkflowFacts` as a conservative line scanner. Reuse `plugin/bin/lib/merge-verification.js`'s `readWorkflowShape` only for `concurrencyDeclared` and its `unparsed` reasons; the jobs, `needs`, timeout, matrix and steps come from this module's own scanner, which reports `unparsed` for anything it cannot follow and never infers. Read `.claude/skills/regex-scan-linearity/SKILL.md` before writing any regex over file text.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/workflow-facts.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit/workflow-facts.js tests/bin-lib/ci-audit/workflow-facts.test.js && git commit -m "Add ci-audit workflow facts — dependencies, timeouts, matrix and step kinds"`.

### Task 3: Aggregation across runs

**Files:**
- Create: `plugin/bin/lib/ci-audit/aggregate.js`
- Test: `tests/bin-lib/ci-audit/aggregate.test.js`

**Interfaces:**
- Consumes: `percentile`, `splitJobPhases` (Task 1); `readWorkflowFacts` result (Task 2).
- Produces: `aggregate(runs: NormRun[], factsByWorkflow: Record<string, FactsResult>): {jobs: AggJob[], excluded: number, criticalPaths: {workflow: string, pathMs: number, sumMs: number, chain: string[]}[], shardSkews: {workflow: string, family: string, ratio: number, slowest: string, shards: number}[], repeatedSteps: {name: string, jobs: string[]}[], overlaps: {workflow: string, a: string, b: string, everOverlapped: boolean}[]}`. `overlaps` has one entry per pair of jobs in a workflow, `everOverlapped` true when any one run shows the two jobs' started-to-completed intervals intersecting; Task 4's `serial-independent-jobs` reads it.
- `NormRun` = `{id, workflow, conclusion, createdAt, jobs: NormJob[]}`. `workflow` is the workflow-file path that `source.js` normalizes (forward slashes, e.g. a path relative to the checkout), and every consumer — `factsByWorkflow` keys, Task 6's `workflows[].file`, Task 7's validity check, the `--workflow` filter — keys on that one string. `AggJob` = `{workflow, job, runs, waiting: Stat, setup: Stat, running: Stat, slowestSteps: {name, p50Ms, n}[]}` with `Stat = {p50Ms: number|null, p90Ms: number|null, n: number}`.

- [ ] **Step 1: Write the failing test** with three fixture runs of one two-job workflow (`test` needs `build`): asserts exact `p50Ms`/`p90Ms`/`n` for each phase, `criticalPath.chain === ['build','test']` with `pathMs` equal to the hand-summed p50 totals, and `sumMs` greater than or equal to `pathMs` when a third independent job exists; four matrix jobs `unit (a)`…`unit (d)` with p50 totals 10,10,10,40 seconds give `shardSkews[0].ratio === 4` and `slowest === 'unit (d)'`; two jobs whose intervals never intersect in any run give `everOverlapped: false` and a pair that intersects in one run gives `true`; a step name `Install` declared in three jobs appears in `repeatedSteps`; a run whose job has `startedAt` before `createdAt` increments `excluded` and contributes no figures.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/aggregate.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** `aggregate`. A run-data job maps to a workflow job by exact `name`, or by the part before ` (` for a matrix job. Critical path is the longest chain over `needs` using each job's p50 of waiting+setup+running; a cycle in `needs` leaves the workflow out of `criticalPaths`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/aggregate.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit/aggregate.js tests/bin-lib/ci-audit/aggregate.test.js && git commit -m "Add ci-audit aggregation — per-job phases, critical path and shard skew"`.

### Task 4: Checklist table, thresholds and mechanical breaches

**Files:**
- Create: `plugin/bin/lib/ci-audit/checks.js`
- Test: `tests/bin-lib/ci-audit/checks.test.js`

**Interfaces:**
- Consumes: the `aggregate` result (Task 3) and each workflow's facts.
- Produces: `CHECK_IDS: string[]` (exactly `queue-wait`, `setup-dominance`, `critical-path-pole`, `serial-independent-jobs`, `shard-skew`, `repeated-work`, `missing-timeout`, `missing-concurrency`); `DEFAULTS: Record<string, number>`; `parseThresholds(text: string): {ok: true, values: Record<string, number>} | {ok: false, error: string}` (the `id=value,id=value` form; an unknown id or non-number is `ok: false`); `evaluate(agg, factsByWorkflow, thresholds, minSample): Breach[]` with `Breach = {check, workflow, job: string|null, metric: string, value: number, threshold: number}`.
- The default thresholds: `queue-wait` 0.4 (waiting share of the job's total p50), `setup-dominance` 0.4, `critical-path-pole` 0.5, `shard-skew` 2, `repeated-work` 3 (jobs), `missing-timeout` 3 (p90 ÷ p50). A job below `minSample` runs (default 5) produces no breach.

- [ ] **Step 1: Write the failing test**: one fixture per check proving its breach has the exact `check`, `metric` and `value`; a sibling fixture just under each threshold produces none, and each guard (the `minSample` floor, the unparsed-workflow skip) has a fixture on which only that guard decides the outcome; `parseThresholds('shard-skew=3')` is `{ok: true, values: {'shard-skew': 3}}` and `parseThresholds('bogus=1')` is `{ok: false}`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/checks.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** `checks.js`. Breaches are leads for the judge, not findings; the checks that read workflow facts (`missing-timeout`, `missing-concurrency`, `serial-independent-jobs`) take them from `factsByWorkflow`, and `serial-independent-jobs` fires for two jobs with no `needs` path between them whose `overlaps` entry (Task 3) has `everOverlapped: false`. Add a Step 1 fixture for it built from an `aggregate` result that carries `overlaps`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/checks.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit/checks.js tests/bin-lib/ci-audit/checks.test.js && git commit -m "Add ci-audit checklist table — thresholds and mechanical breaches"`.

### Task 5: Source adapter

**Files:**
- Create: `plugin/bin/lib/ci-audit/source.js`
- Test: `tests/bin-lib/ci-audit/source.test.js`
- Waived `plugin/bin/lib/ci-health/fetch.js`: read-only reuse (`fetchRuns`, `readRepo`, `errorText`, `isGhAbsent`, `parseBody` are required, never edited)

**Interfaces:**
- Consumes: `fetchRuns`, `readRepo`, `errorText`, `isGhAbsent`, `parseBody` from `plugin/bin/lib/ci-health/fetch.js` (read its exact signatures first); `readWorkflowSet` from `plugin/bin/lib/init/ci-workflow-review.js`.
- Produces: `readRunData({runner, repo, days, maxRuns, workflow, now, clock}): {ok: boolean, cliAbsent: boolean, runs: NormRun[], truncated: string[], failures: string[]}` (per-run jobs are read through the runner, sampled to the most recent `maxRuns` completed runs, each call bounded by the shared timeout). `cliAbsent` is true when the forge CLI is missing (`fetch.js`'s `ghAbsent`). `ok` is false when no runs page was readable, and also when runs were listed but every per-run jobs read failed; a read that succeeds and yields zero completed runs is `ok: true` with `runs: []`; `readWorkflowFiles(root: string): {ok: boolean, workflows: {file: string, text?: string, unreadable?: string}[], error?: string}`.
- This is the only ci-audit module allowed to name a forge, a forge CLI or a workflow-file location.

- [ ] **Step 1: Write the failing test** with a fake runner: two runs with jobs and steps map to the exact `NormRun`/`NormJob` shape; a runner whose every call throws `{code: 'ENOENT'}` gives `ok: false`, `cliAbsent: true` and a failure naming the forge CLI as absent; one failing jobs read excludes that run, records one failure, and keeps the rest (`ok: true`); every per-run jobs read failing gives `ok: false` with every failure recorded; a runs read that succeeds with zero completed runs gives `ok: true`, `runs: []`; a `workflow` filter keeps one file's runs; `readWorkflowFiles` on a temp checkout with two workflow files returns both texts and a CRLF file reads identically; the recorded argv of every call carries the host pin and an explicit timeout, and the real runner factory passes `windowsHide: true`, `timeout` and `maxBuffer` (assert them through the spawn function the factory takes).
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/source.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** the two functions plus a `makeRunner(spawn)` factory. Map the forge's job fields to `NormJob` here and nowhere else; drop every field the shape does not name.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/source.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit/source.js tests/bin-lib/ci-audit/source.test.js && git commit -m "Add ci-audit source adapter — the one module that reads the forge"`.

### Task 6: The `gather` verb

**Files:**
- Create: `plugin/bin/ci-audit.js`
- Test: `tests/bin-lib/ci-audit/gather-cli.test.js`
- Waived `plugin/bin/ci-health.js`: read-only model for the `run(argv, deps)` seam, header comment style and `pinExplicitRepoHost` use
- Waived `plugin/skills/harness-health/ci-health-check.md`: read-only model for the report-and-exit-code wording the skill's Step 1 cites

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `run(argv: string[], deps): number` (the `run(argv, deps)` seam of `plugin/bin/ci-health.js`; `deps` injects `runner`, `readWorkflowFiles`, `now`, `stdout`, `stderr`). `gather [--days N] [--runs N] [--workflow <file>] [--root <dir>] [--repo owner/name] [--min-sample N] [--thresholds <text>]` prints one JSON line `{definitions, window, workflows: [{file, unparsed}], jobs: AggJob[], criticalPaths, shardSkews, repeatedSteps, breaches, excluded, truncated, failures}`.
- Exit codes: 0 report printed (partial allowed); 2 usage error, or `readRunData` returned `ok: false` (no runs page readable, or every per-run jobs read failed; stdout still carries the report so nothing read is lost; a bare usage error prints nothing to stdout); 3 `readRunData` returned `cliAbsent: true`. A read that succeeds but yields zero completed runs, or whose every job is `excluded`, exits 0 with `noData: {reason: string}` in the JSON (decided by the user at plan review); `noData` is `null` otherwise.

- [ ] **Step 1: Write the failing test**: `test('AC1.1: …')` fake deps over two fixture runs print JSON whose `jobs[0].waiting.p50Ms`, `setup.p50Ms` and `running.p50Ms` equal the hand-computed values; `test('AC1.2: …')` `definitions` holds all three phase definitions verbatim; `test('AC2.1: …')` a runner that always throws `ENOENT` returns 3 with `failures` naming it, and every runs read failing returns 2 with the failure in the report; `test('AC2.2: …')` neither case prints an empty or clean report, and a succeeded read with zero completed runs exits 0 with `noData.reason` set and `jobs: []`, while every jobs read failing exits 2; a bad flag returns 2 with an empty stdout; `--thresholds 'shard-skew=9'` changes `breaches`; an unparsed workflow appears in `workflows[].unparsed` and never in `breaches`; a truncated window names its truncated ranges in `truncated` (never read as a complete period).
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/gather-cli.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** `plugin/bin/ci-audit.js` with a shebang, `'use strict'`, `run`, and a `main` guarded by `require.main === module`, mirroring `plugin/bin/ci-health.js`'s header comment style (usage, exit codes, what it never does). Every `gh` spawn goes through `ghOptions`; an explicit `--repo` pins its host (`pinExplicitRepoHost`, as `ci-health.js` does).
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/gather-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/ci-audit.js tests/bin-lib/ci-audit/gather-cli.test.js && git commit -m "Add ci-audit gather verb — measured CI time facts as one JSON document"`.

### Task 7: Finding validation, fingerprint, payload and `validate-findings`

**Files:**
- Create: `plugin/bin/lib/ci-audit/validate-finding.js`
- Create: `plugin/bin/lib/ci-audit/fingerprint.js`
- Create: `plugin/bin/lib/ci-audit/issue-payload.js`
- Modify: `plugin/bin/ci-audit.js`
- Test: `tests/bin-lib/ci-audit/validate-findings.test.js`
- Waived `health-core/finding-validation.js`: read-only; its `requireNonEmptyStrings` is required for the claim/remedy checks, never edited

**Interfaces:**
- Consumes: the gather output (Task 6); `createFingerprint` (`health-core/fingerprint.js`), `loadIssueIndex` (`health-core/issue-index.js`), `decide` (`health-core/dedup.js`), `recordPayload`/`specShapedBody`/`fencedBlock` (`issues/record.js`). Read `docs-health`'s three equivalents (`plugin/bin/lib/docs-health/validate-finding.js`, `fingerprint.js`, `issue-payload.js`) first and mirror their shapes.
- Produces: `validateFinding(finding, gather): {ok: true} | {ok: false, error: string}`; `fingerprint(finding): string` over `['check', 'workflow', 'job']` with prefix `ci-health`; `toIssuePayload(finding, verifiedAsOf): Payload`; the verb `validate-findings --gather <file> --findings <file> --issues <file> [--dry-run]` printing the payload array on stdout.
- Finding shape: `{check, workflow, job: string|null, claim: string, remedy: string, evidence: {job: string|null, metric: string, value: number}[]}`. A finding is valid when `check` is in `CHECK_IDS`, `workflow` is in the gather's `workflows`, `job` (when set) is a gathered job of that workflow, and every evidence entry equals the gather's figure for that job and metric exactly (metrics: `waiting.p50Ms`, `waiting.p90Ms`, `setup.p50Ms`, `setup.p90Ms`, `running.p50Ms`, `running.p90Ms`, `runs`, plus the breach metrics for that check). Three outcomes, not two: resolved, unresolved (rejected), and resolved-but-contradicting (a cited figure that differs; rejected with both values named).
- Exit codes: 0 payloads printed (possibly none); 1 at least one finding rejected (each named on stderr, the valid ones still printed); 2 usage.

- [ ] **Step 1: Write the failing test**: `test('AC3.1: …')` a finding citing a job absent from the gather is rejected and named, and the same finding with the job corrected is accepted, and an evidence value off by one is rejected naming both values; `test('AC4.1: …')` a finding whose fingerprint matches an open `by:ci-health` issue in `--issues` produces no payload, `test('AC4.2: …')` a finding with a different fingerprint stays separate and files, and a match on a closed `wontfix` issue produces none; two findings with the same `check`/`workflow`/`job` collapse to one payload; `test('AC5.1: …')` each payload's body passes `compose-record.js`'s `--check` (written to a temp file by the test) and carries `by:ci-health`, `ready`, `risk:low`, `size:low`, the fingerprint marker and a Release Note of exactly `No user-visible change — CI timing finding.`; a job name containing backticks and a fence renders inside a safe fenced span; claim or remedy text over 500 characters is rejected; `test('AC6.1: …')` `--dry-run` makes no forge CLI call and writes no state file.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/ci-audit/validate-findings.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** the three modules and the verb.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/validate-findings.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/ci-audit plugin/bin/ci-audit.js tests/bin-lib/ci-audit/validate-findings.test.js && git commit -m "Add ci-audit validate-findings — fact-checked, fingerprinted, deduplicated findings"`.

### Task 8: Threshold policy key

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Test: `tests/ci-health-thresholds-policy.test.js`

**Interfaces:**
- Produces: policy key `ci-health-thresholds` (string, default empty) holding the `id=value,id=value` text `parseThresholds` reads; `resolve-policy.js --values ci-health-thresholds` prints it.

- [ ] **Step 1: Write the failing test** `tests/ci-health-thresholds-policy.test.js`: `resolve-policy.js --values ci-health-thresholds` prints empty by default and prints the value a fixture `policy.yml` sets; a malformed value is still printed verbatim (`parseThresholds` owns rejection). Before writing it, load the `policy-key-addition` skill and list every site it names; add each further site it requires (docs table, coverage tests) to this task's `Modify:` list. `plugin/skills/_shared/policy-schema.md` has about 3.3 KB of headroom under the rail: keep the new row within it.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ci-health-thresholds-policy.test.js`
Expected: FAIL with "unknown key"

- [ ] **Step 3: Implement** the key per the skill.
- [ ] **Step 4: Run test to verify it passes**, then run the conformance suites the skill names.

Run: `node --test tests/ci-health-thresholds-policy.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md tests/ci-health-thresholds-policy.test.js && git commit -m "Add ci-health-thresholds policy key — project overrides for the CI checklist"` (plus each further site from Step 1).

### Task 9: The `by:ci-health` origin — code and shared contracts

**Files:**
- Modify: `plugin/bin/lib/issues/record-vocabulary.js`
- Modify: `plugin/skills/_shared/work-record.md`
- Modify: `plugin/skills/_shared/label-bootstrap.md`
- Test: `tests/bin-lib/issues/record.test.js`

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/issues/record.test.js`: `test('AC9.1: …')` `ORIGINS` contains `ci-health`, `parseRecordFacets` over a `by:ci-health` label reports origin `ci-health`, and a `recordPayload` with that origin yields the `by:ci-health` label. First run `git grep -n -e 'by:harness-health' -e 'by:docs-health' -e "'harness-health'" -- plugin docs tests`, save the full site list to the ledger as an `ops` row, and classify each site as this task (code and shared contracts), Task 10 (prose), or no-change with a reason.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: FAIL on the origin assertions

- [ ] **Step 3: Implement**: add `ci-health` to `ORIGINS`; change `work-record.md`'s Origin row (count and list, 6 to 7) and the health-record rules; add the `by:ci-health` entry to `label-bootstrap.md` with description `Origin: filed by the ci-health skill` and the sibling origins' color. Run the whole `tests/bin-lib/issues/` directory and every suite the Step 1 grep found enumerating origins. Retirement-style sweep for the count: grep for the three forms `six origins`, `Origin (6)` and `(6)` near `by:capture`, and fix each hit.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/issues/record-vocabulary.js plugin/skills/_shared/work-record.md plugin/skills/_shared/label-bootstrap.md tests/bin-lib/issues/record.test.js && git commit -m "Add the by:ci-health origin — expand-only beside the existing six"`.

### Task 10: The `by:ci-health` origin — prose sites

**Files:**
- Modify: `plugin/skills/tidy/SKILL.md`
- Modify: `plugin/skills/tidy/scan-procedures.md`
- Modify: `plugin/skills/dispatch/queue-pull-notes.md`
- Modify: `plugin/skills/wrap-up/summary-template.md`

(The list is the expected shape; the Task 9 Step 1 grep's output is authoritative — add or drop files to match it, and record each skipped site's reason in the ledger.)

- [ ] **Step 1: Write the failing check**: a scratch grep (not committed) asserting each kept site names `by:ci-health` beside `by:harness-health`. `plugin/skills/tidy/scan-procedures.md` has 46 bytes of headroom under the rail (`wc -c` on the merge base): its edit adds at most 46 bytes, or cuts the same number elsewhere in that file, or that site is recorded as no-change in the ledger.
- [ ] **Step 2: Run test to verify it fails**

Run: `git grep -q 'by:ci-health' -- plugin/skills/tidy plugin/skills/dispatch plugin/skills/wrap-up`
Expected: FAIL with exit 1 (no hits yet)

- [ ] **Step 3: Implement** the edits, one site per bullet, matching each file's surrounding style. Before moving or rewording any block, grep `tests/` and `plugin/` for two or three distinctive phrases from it (moved-prose pin check) and re-point each pin.
- [ ] **Step 4: Run test to verify it passes**

Run: `git grep -c 'by:ci-health' -- plugin/skills/tidy plugin/skills/dispatch plugin/skills/wrap-up`
Expected: PASS with a hit in every kept file; then run the impact-selected `npm test` redirected to a `.txt` file and read it for any suite pinning the touched prose.
- [ ] **Step 5: Commit** `git add plugin/skills/tidy plugin/skills/dispatch plugin/skills/wrap-up && git commit -m "List by:ci-health wherever the health origins are enumerated"`.

### Task 11: Skill definition and checklist

**Files:**
- Create: `plugin/skills/ci-health/SKILL.md`
- Create: `plugin/skills/ci-health/checklist.md`
- Test: `tests/bin-lib/ci-audit/skill-md.test.js`
- Waived `_shared/subagent-output-contract.md`: read-only; the skill's dispatch prompt follows it, and Step 1's reading is the step that reads it
- Waived `_shared/untrusted-record-content.md`: read-only; the skill wraps workflow, job and step names per it
- Waived `_shared/health-filing-mechanics.md`: read-only; Step 1 reads it to decide which canonical paragraphs a stateless sweep omits

**Interfaces:**
- Consumes: the CLI verbs (Tasks 6–7), `CHECK_IDS` (Task 4).

- [ ] **Step 1:** Read `docs/skill-authoring.md`, `plugin/skills/docs-health/SKILL.md` (structure model), `tests/bin-lib/docs-health/skill-md.test.js` and `tests/bin-lib/health-core/skill-md-house-checks.js` (the house checks every health SKILL.md passes). A new skill trips a fixed suite set: `skill-catalog-completeness`, `argument-hint-mirrors`, `skill-conventions`, and `tests/bin-lib/skill-audit/{house-structure,anti-patterns,context-cost,csc-registry}`. Budget for the mechanical pins inside them: `context-cost`'s per-skill `description` character ceiling and its corpus-wide description budget (the new skill consumes both), and the standalone-skill `PIPELINE_RUN_DIR_EXEMPT` entry `csc-registry` requires.
- [ ] **Step 2: Write the failing test** `skill-md.test.js`: frontmatter has `name: ci-health`, a `description` starting `Use for` with a `Keywords -` list, an `argument-hint`, and `allowed-tools`; the body has `When to Use`, `Input`, `Workflow` with GATHER → JUDGE → VERIFY → FILE steps and a `Not for` paragraph naming `/claude-tweaks:harness-health` and `/claude-tweaks:init`; the house checks pass; `checklist.md` names every id in `CHECK_IDS` and states all three phase definitions verbatim.

Run: `node --test tests/bin-lib/ci-audit/skill-md.test.js`
Expected: FAIL with "ENOENT"

- [ ] **Step 3: Implement** both files. The workflow runs `ci-audit.js gather`, judges against `checklist.md` (inlined verbatim into each dispatched prompt under `--budget > 1`, per `_shared/subagent-output-contract.md`; agents only see their prompt), runs `validate-findings`, then files each payload through the health filing contracts. Inline the three canonical blocks `tests/health-filing-parity.test.js` pins (`**Subject check before filing.**`, `**Exception — a headless D5 finding.**`, `## Component-Skill Contract`) with `ci-health` substituted for the skill name, and apply `_shared/materiality-floor.md` as `tests/materiality-floor-conformance.test.js` requires of every health sweep. State plainly that this sweep keeps no cursor, cache or retry queue and so omits those paragraphs. An unavailable forge read is reported as unavailable, never clean, and a `noData` gather is reported as "no runs sampled", never as "no findings". Resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values ci-health-thresholds` and pass a non-empty value to `gather` as `--thresholds`, so a project override takes effect (Task 8's key has no other reader). The `argument-hint` carries `--dry-run`, and the FILE step under `--dry-run` prints each payload it would file and calls no forge CLI write, writes no cursor or cache, and files nothing, as `plugin/skills/docs-health/SKILL.md` does for its own `--dry-run`. `skill-md.test.js` pins the thresholds pass-through, the `--dry-run` filing behaviour and the `noData` wording. No vendor, product or forge name appears anywhere in either file. Cite the unavailability convention from `_shared/github-write-transport.md` instead of restating a degrade rule.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/ci-audit/skill-md.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/skills/ci-health tests/bin-lib/ci-audit/skill-md.test.js && git commit -m "Add the ci-health skill and its stack-neutral checklist"` (any further file the suite set needs, such as the `csc-registry` exemption, goes in this commit and is listed in the ledger).

### Task 12: Health-roster extension and the project-agnostic conformance test

**Files:**
- Modify: `tests/health-filing-parity.test.js`
- Modify: `tests/materiality-floor-conformance.test.js`
- Create: `tests/ci-health-skill-agnostic.test.js`

- [ ] **Step 1: Write the failing tests**: add `ci-health` to `health-filing-parity.test.js`'s `SOURCES` (its test names that say "four" become "five") and to each of `materiality-floor-conformance.test.js`'s three skill-file rosters; `ci-health-skill-agnostic.test.js` holds `test('AC7.1: …')` failing on any denylisted CI-product, hosted-runner, cache-service or cloud-vendor name (the list lives in the test), any path or workflow name specific to this repository, and any hard-coded workflow-file location outside `source.js`, over every file under `plugin/skills/ci-health/` and every module under `plugin/bin/lib/ci-audit/` except `source.js`; `test('AC7.2: …')` a go-red self-test copying a fixture module, planting a denylisted name, and asserting the scanner reports it (one assertion function shared by the positive scan and the control); `test('AC8.1: …')` failing on any read of a source-code, lockfile or manifest file, or a direct network or forge call, outside `source.js`; a floor assertion that the scan matched at least the expected file count. Use `tests/helpers/read-skill` and the shared comment stripper per the `bin-source-scan-conformance` skill.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ci-health-skill-agnostic.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** the new test file and the two roster edits; any missing inlined block or scan detail the run names goes back to Task 11's files. Prove the roster edits can go red: delete one canonical marker from `plugin/skills/ci-health/SKILL.md` in the working tree, run `node --test tests/health-filing-parity.test.js` (Expected: FAIL naming `ci-health`), then restore it. Plant a denylisted name in `plugin/skills/ci-health/checklist.md`, run `node --test tests/ci-health-skill-agnostic.test.js` again — Expected: FAIL naming it — then remove it.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/health-filing-parity.test.js tests/materiality-floor-conformance.test.js tests/ci-health-skill-agnostic.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add tests/health-filing-parity.test.js tests/materiality-floor-conformance.test.js tests/ci-health-skill-agnostic.test.js && git commit -m "Pin ci-health to the health roster and to staying project-agnostic"`.

### Task 13: Registration in docs, help and README

**Files:**
- Modify: `docs/plugin-structure.md`
- Modify: `docs/skill-graph.md`
- Modify: `plugin/skills/help/reference-card.md`
- Modify: `plugin/skills/help/context-flow.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing check**: run `git grep -n 'docs-health' -- plugin/skills/help docs/skill-graph.md docs/plugin-structure.md README.md` to list the rows to mirror, then the suites that enumerate skills and docs (`git grep -l 'journey-health' -- tests`). For the `help` surfaces, also grep an existing sibling's flags (`--min-confidence`) to find prose no table lists, per the mirror-surface check; a new skill's `argument-hint` mirrors are walked by `tests/argument-hint-mirrors.test.js` from `docs/skill-authoring.md`'s surfaces table.

- [ ] **Step 2: Run test to verify it fails**

Run: `git grep -q 'ci-audit' -- docs/plugin-structure.md docs/skill-graph.md plugin/skills/help/reference-card.md plugin/skills/help/context-flow.md README.md`
Expected: FAIL with exit 1 (no surface names the new CLI yet); the roster suites (`tests/argument-hint-mirrors.test.js`, `tests/skill-catalog-completeness.test.js`) go red only once Task 11's skill exists, and Step 4's full run covers them

- [ ] **Step 3: Implement**: add the skill to `docs/plugin-structure.md`'s tree, sub-file table and utility list; add its edges once to `docs/skill-graph.md` (a sibling health skill to `/harness-health` and `/docs-health`, reads `ci-audit.js`, files `by:ci-health` records `/tidy` sweeps and `/specify` consumes, the disambiguation from harness-health's CI check); add `/help`'s reference-card row and context-flow row; add the README skill-list line and keep its lifecycle diagram in sync with `/help`'s. Add the `by:ci-health` row wherever `docs/skill-graph.md` lists a health origin.
- [ ] **Step 4: Run test to verify it passes** (AC10.1: the roster suites plus a grep that each of the four surfaces names `ci-health`; AC11.1: the full-suite run, quoted from its output file)

Run: `npm test -- --full > skill-roster.txt 2>&1`
Expected: PASS (read the file; fix any failing roster before committing)

- [ ] **Step 5: Commit** `git add docs/plugin-structure.md docs/skill-graph.md plugin/skills/help/reference-card.md plugin/skills/help/context-flow.md README.md && git commit -m "Register ci-health in the structure doc, skill graph, help and README"`.

---

Self-review notes: every deliverable maps to a task (1 → Tasks 11 and 13; 2 → 6; 3 → 5; 4 → 4 and 11; 5 → 7 and 11; 6 → 9 and 10; 7 → 13; 8 → each task's test). Names are consistent: `CHECK_IDS`, `readRunData`, `readWorkflowFiles`, `aggregate`, `evaluate`, `validateFinding`. No risk flags are kept for this record, so there is no `Proof(<slug>):` line. The sweep deliberately keeps no cursor, cache or retry queue (stateless, like harness-health's CI check); the health-roster parity pins only the three shared blocks.
