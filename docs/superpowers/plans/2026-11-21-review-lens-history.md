# Review Lens History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute each review lens's confirmed-finding rate over the most recent 20 closed runs in which that lens ran, from a new per-run `lens-dispatch.json` record plus each run's `step-yield.json`.

**Architecture:** A new `plugin/bin/lib/review-lens/` module pair: `dispatch-record.js` owns `lens-dispatch.json` (validated read, locked append) and is written only through a new `review-coordination.js record-lens-dispatch` verb; `history.js` walks pipelines roots, joins each run's dispatch record (the denominator) with its `step-yield.json` (the numerator), and returns per-lens counts. `tools/step-yield-report.js` imports the shipped `confirmedCount` and `startedAtOf` instead of keeping its own copies. Review Step 3 prose calls the verb on both dispatch paths.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T185319-record-5998/work/5998-spec.md` (record #5998, including its three `**Decision (plan review Q1/Q2/Q3)**` lines)

`{run-dir}` below is the pipeline run directory the dispatch brief names (`$PIPELINE_RUN_DIR`), and `{main-checkout}` the repository's main checkout (`git worktree list`'s first line); substitute both literally.

## Global Constraints

- N default 20; qualifying runs are filtered first, then the newest N are taken (spec Deliverable 1).
- **Closed vs not closed (spec AC3 as written, Decision Q1; plan-review settlement in the spec's `## Plan Review Clarifications`).** A run is **not closed** when (a) it has no `step-yield.json` file and no `run-state.json` with `status: 'clean'`, or (b) `runLiveness(dir).verdict` (`plugin/bin/lib/run-liveness`) is `live` — a live owner makes even a `clean` run not closed. Every other run is closed, `unknown` and `dead` verdicts included. The liveness probe runs only when (a) does not already decide. A not-closed run → `skipped` with reason exactly `run not closed`, never `errors`, never counted. A closed run whose `step-yield.json` is missing or malformed → `errors`, never counted. An unreadable or non-object `run-state.json` is not `clean`.
- **Malformed yield without dispatch evidence (spec AC6 as written; plan-review settlement).** A run with no dispatch file at all is never counted and never probed, except that its `step-yield.json`, when present, is still read: a malformed one in a closed run → `errors` (`step-yield.json unparseable` / `unreadable ({code})` / `step-yield.json is not a schemaVersion {N} yield`); a malformed one in a not-closed run → `skipped` `run not closed`. A missing or well-formed yield there adds no list entry, so legacy runs without a yield do not flood `errors`.
- **Multi-member dispatch (spec AC4, Decision Q2).** A run's dispatch sources are its own `{dir}/lens-dispatch.json` and each `{dir}/spec-{N}/lens-dispatch.json`. For a lens, when two or more sources hold any entry for it (any status), the run is excluded for that lens and listed in `skipped` with reason `multi-member dispatch (lens {lens}: {source names, comma-joined})`, the reason starting with the literal `multi-member dispatch`; when exactly one source holds entries for it, the run counts once with the parent's `byLens` yield.
- **Archive twin (same run id under a root and under `{root}/archive`, or under two roots).** Keep exactly one copy: the copy with a `clean` `run-state.json` or a present `step-yield.json` (judged without a liveness probe) wins; when both or neither are, the `archive/` copy wins, then the first root given. The other copy → `skipped` with reason `duplicate run id (kept {kept path})`.
- Confirmed findings = `both` plus tiebreak `confirmed` (`byVerdict.confirmed`), per `docs/reference/step-yield.md`. `relabeled` adds to no finding count (step-yield.md: "Findings already counted that changed label (adds to no finding count)").
- "Most recent" = the run id's leading `YYYY-MM-DDTHHMMSS` read as UTC (`tools/step-yield-report.js`'s `recent` rule); never lexical directory order (Gotcha: `…record-590` vs `…record-5770`).
- Result shape exactly `{ lenses: { "<lens>": { runs, confirmed, perRun, shareWithFinding, insufficient } }, skipped: [{path, reason}], errors: [{path, reason}] }`.
- Lens ids are the Step 3 ids `3a`..`3h` — `LENS_IDS = ['3a','3b','3c','3d','3e','3f','3g','3h']`.
- `lens-dispatch.json` entry: `{lens, reviewers: 1|2, path: 'task'|'workflow', round, status: 'completed'|'failed'|'blocked'}`; file shape `{ "v": 1, "entries": [...] }`.
- A run qualifies for a lens only when an entry for it has `status: 'completed'` and `reviewers: 2`. Failed/blocked and `reviewers: 1` never qualify. Runs without `lens-dispatch.json` count for no lens (no legacy derivation, Decision Q3).
- `step3-lens-dispatch.md` gets exactly one pointer line (it is 48,911 B; rail `RAIL_BYTES` = 52,500 B; a ~250 B line leaves ~3,300 B headroom). All new prose goes in a new sub-file. plan-audit also reports the composed `review-lens-procedure` bundle (`review/code-mode-steps.md:228`) at max 49,050 B of 52,500 B; the pointer line adds ~250 B to it at most.
- `tools/step-yield-report.js`'s per-lens table stays byte-identical (pinned by a test).
- **Ruling (spec ambiguity, "both files carry a `v: 1` schema field"):** `lens-dispatch.json` carries `v: 1`; `step-yield.json` already carries `schemaVersion: 1` (`SCHEMA_VERSION` in `plugin/bin/lib/timing/step-yield.js`). History accepts only `v === 1` and `schemaVersion === SCHEMA_VERSION`; anything else is an `errors` entry, never absence.
- **Ruling (round):** `round` never changes the rate (a run counts once per lens), so the verb defaults `--round` to 1 and the prose derives later rounds from the file; a doubtful round is harmless.

Governing project-skill rules (quoted verbatim):

- `gh-api-module-pattern/cli-wrapper-contract.md`: "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.** Those lists live outside the file you edit." Sites found by `git grep -n -F 'settle-lens-replies' -- plugin docs .claude/skills`: `plugin/bin/review-coordination.js` header + `USAGE`, `docs/plugin-structure.md:405`, `docs/skill-graph.md:592`.
- `gh-api-module-pattern/cli-wrapper-contract.md` (Sanctioned-writer): "0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**."
- `gh-api-module-pattern/cli-wrapper-contract.md`: "**A sanctioned writer that read-modify-writes a shared file guards it; a create-only writer doesn't.** … runs the whole read-modify-write-rename under `plugin/bin/lib/file-lock.js`'s `withLock` … Decide the shape before writing the file, and reuse `withLock` rather than hand-rolling a second mutex."
- `parse-signal-discipline`: "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from 'this input legitimately does not need this check'."
- `skill-prose-conformance-tests`: "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
- `bin-source-scan-conformance` / build's Source-scan lint check: no bare `fs.existsSync`/`fs.realpathSync` under `plugin/bin/` (use `plugin/bin/lib/path-guard`); entry points set `process.exitCode`, never `process.exit(`.

## Review Focus

1. The same run id under a root and under its `archive/` (an archived twin) must count once, from the copy the twin rule keeps — test in Task 2.
2. A `lens-dispatch.json` with `v` other than 1, a non-array `entries`, or one invalid entry must be an `errors` entry, not "no dispatch" — test in Tasks 1 and 2.
3. A `step-yield.json` of another `schemaVersion` must be an `errors` entry, never read with keys it may not have — test in Task 2.
4. A resumed review re-running the record call must not double-append an identical entry — test in Task 1.
5. A lens text outside `3a`..`3h` (`__proto__`, `unknown`, `constructor`) must be refused by the verb and ignored by history even if present as a `byLens` key — tests in Tasks 1 and 2.

---

### Task 1: `lens-dispatch.json` record module and `record-lens-dispatch` verb

**Role:** integration
**Review risk:** high (a locked read-modify-write of a shared run file; a lost entry silently shrinks the rate's denominator)

**Files:**
- Create: `plugin/bin/lib/review-lens/dispatch-record.js`
- Modify: `plugin/bin/review-coordination.js` (header comment lines 2-98, `USAGE` lines 123-134, `run()` dispatch)
- Test: `tests/bin-lib/review-lens/dispatch-record.test.js` (create)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (append)
- Waived `plugin/bin/write-run-artifact.js`: read and rejected as the writer — it writes a whole caller-supplied file (`--file`), create-only with no lock, so a lens record through it would be a hand-typed JSON file (AC8 forbids that) and racing appends would drop entries; the spec allows "a sibling sanctioned writer", which is this verb.

**Interfaces:**
- Produces (`dispatch-record.js`):
  - `LENS_DISPATCH_FILE = 'lens-dispatch.json'`, `DISPATCH_SCHEMA_VERSION = 1`, `LENS_IDS` (frozen array `3a`..`3h`), `STATUSES = ['completed','failed','blocked']`, `PATHS = ['task','workflow']`
  - `entryProblem(entry) -> string|null` — refusal text, or null for a valid entry (`lens` in `LENS_IDS`, `reviewers` 1|2, `path` in `PATHS`, `round` integer ≥1, `status` in `STATUSES`, no other keys)
  - `readLensDispatch(dir) -> {state:'absent'} | {state:'ok', entries} | {state:'error', reason}` — reads `{dir}/lens-dispatch.json`; ENOENT → absent; other read error → `unreadable ({code})`; bad JSON → `unparseable`; not an object, `v !== 1`, `entries` not an array → error naming which; any entry with `entryProblem` → `entry {i}: {problem}`.
  - `appendLensDispatch({ runDir, entry, env }) -> { file, duplicate }` — throws `TypeError` on `entryProblem`; under `withLock(path.join(runDir, '.lens-dispatch.lock'), …, { env, failClosed: true })` re-reads (`failClosed`, because `withLock`'s default proceeds unlocked on timeout and two racing appends would drop an entry; a timeout throws the lock module's `LOCK_TIMEOUT` error, never writes); an `error` state throws (never overwrites a malformed file); an identical entry already present → `duplicate: true`, no write; else writes `{v:1, entries:[...old, entry]}` via `writeFileAtomic` with `JSON.stringify(…, null, 2) + '\n'`. Before taking the lock, refuse a vanished `runDir` (throw) so `withLock`'s parent creation never resurrects an archived run dir (path-guard `lstatType`, not `existsSync`).
  - The module header names `review-coordination.js record-lens-dispatch` as the one sanctioned writer and documents the file shape and status meanings.
- Produces (verb): `review-coordination.js record-lens-dispatch --run <dir> --lens <3a..3h> --reviewers 1|2 --path task|workflow --status completed|failed|blocked [--round <n>]` → one JSON line `{path, entry, duplicate}`; exit 0 written or duplicate, 2 any malformed flag/value (via `parseValueFlags` with `brief: true`; every refusal before anchoring), 3 run dir unanchored/missing (`anchorRunDir(flags.run, deps, 3)`) or the append threw (stderr `review-coordination.js: could not record lens-dispatch.json ({message})`). Passes `env: deps.env` to `appendLensDispatch`.

- [ ] **Step 1: Write the failing module tests** in `tests/bin-lib/review-lens/dispatch-record.test.js` (use `tests/helpers/tmp-dir.js`'s `scratchDir`):
  - `appends entries in order and reads them back` — two `appendLensDispatch` calls → `readLensDispatch(dir)` deep-equals `{state:'ok', entries:[e1, e2]}`; file JSON has `v: 1`.
  - `an identical entry is not appended twice` (Review Focus 4) — second identical call returns `duplicate: true`; entries length 1.
  - `absent file reads absent` → `{state:'absent'}`.
  - `malformed files are errors, never absence` (Review Focus 2) — cases: `not json`, `{"v":2,"entries":[]}`, `{"v":1,"entries":{}}`, `{"v":1,"entries":[{"lens":"3z","reviewers":2,"path":"task","round":1,"status":"completed"}]}` each → `state: 'error'` with a reason matching `/unparseable|v|entries|entry 0/`.
  - `append refuses to overwrite a malformed file` — write `not json`, `assert.throws(() => appendLensDispatch(...))`, file bytes unchanged.
  - `entryProblem refuses bad fields` — each of `{lens:'__proto__'}`, `{lens:'unknown'}`, `{reviewers:3}`, `{path:'agent'}`, `{round:0}`, `{status:'done'}`, an extra key `{at:'x'}` (each applied over a valid base) returns a string; the valid base returns null (Review Focus 5).
  - `append refuses a vanished run dir and does not create it` — `runDir` path that does not exist → throws; `fs.existsSync(runDir)` false afterwards.
  - `append fails closed when the lock is held` — create `{runDir}/.lens-dispatch.lock/` with an `.owner` file holding `process.pid` (a live holder), call with `env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' }` → throws with `code === 'LOCK_TIMEOUT'`; no `lens-dispatch.json` written.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/review-lens/dispatch-record.test.js`
Expected: FAIL with "Cannot find module" for `dispatch-record`

- [ ] **Step 3: Implement `dispatch-record.js`** per the Interfaces block (requires `../file-lock` `withLock`, `../atomic-write` `writeFileAtomic`, `../path-guard` for the run-dir existence check).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/review-lens/dispatch-record.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing verb tests** appended to `tests/bin-lib/review-coordination/cli.test.js`, reusing that file's `run`, `fakeDeps`, `anchoredRunDir`:
  - `record-lens-dispatch writes an entry into an anchored run dir and prints {path, entry, duplicate}` — args `--run runDir --lens 3d --reviewers 2 --path workflow --status completed --round 2` → exit 0; printed `path` = `path.join(fs.realpathSync(runDir), 'lens-dispatch.json')`; `entry` deep-equals `{lens:'3d', reviewers:2, path:'workflow', round:2, status:'completed'}`; `duplicate: false`; the same call again prints `duplicate: true`.
  - `record-lens-dispatch defaults --round to 1`.
  - `record-lens-dispatch refuses malformed flags with exit 2 and writes nothing` — each of: missing `--lens`; `--lens 3z`; `--lens __proto__`; `--reviewers 3`; `--path agent`; `--status done`; `--round 0`; `--round x`; `--lens 3a --lens 3b` → exit 2, no `lens-dispatch.json`.
  - `record-lens-dispatch exits 3 for an unanchored or missing run dir` (same shape as the `write-findings` exit-3 test).
  - `record-lens-dispatch exits 3 when the existing file is malformed` — write `not json` into the anchored run dir → exit 3, stderr matches `/could not record lens-dispatch\.json/`, file unchanged.
  - `record-lens-dispatch exits 3 when the lock is held` — a live-holder lock dir as in the module test, `deps.env` carrying `CLAUDE_TWEAKS_LOCK_WAIT_MS: '0'` → exit 3, stderr matches `/could not record lens-dispatch\.json/`, nothing written.
  - Extend the `--help` assertion list (or add one) so `record-lens-dispatch` is in `USAGE`.

- [ ] **Step 6: Run to verify they fail**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: FAIL — `unknown command: record-lens-dispatch`

- [ ] **Step 7: Implement the verb** in `review-coordination.js`: a `recordLensDispatch(rest, deps)` function beside `settleLensReplies`, wired in `run()`; add the usage line to `USAGE` and the header comment (one paragraph: what it writes, exit codes, idempotent on an identical entry, no `decisions.md` line).

- [ ] **Step 8: Run to verify they pass**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/bin-lib/review-lens/dispatch-record.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add plugin/bin/lib/review-lens/dispatch-record.js plugin/bin/review-coordination.js tests/bin-lib/review-lens/dispatch-record.test.js tests/bin-lib/review-coordination/cli.test.js
git commit -m "Add the lens-dispatch.json record and its review-coordination verb — refs #5998"
```

### Task 2: `history.js` — per-lens confirmed-finding rate

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/review-lens/history.js`
- Test: `tests/bin-lib/review-lens/history.test.js` (create)
- Waived `plugin/bin/lib/timing/step-yield.js`: read-only consumer (`SCHEMA_VERSION`, and `deriveStepYield`/`writeStepYield` in one real-writer test); not modified.

**Interfaces:**
- Consumes: Task 1's `readLensDispatch`, `LENS_IDS`, `appendLensDispatch` (tests); `SCHEMA_VERSION`, `STEP_YIELD_FILE`, `ownGet` from `../timing/step-yield`; `runLiveness(runDir) -> {verdict: 'live'|'dead'|'unknown', evidence}` from `../run-liveness` (never throws).
- Produces:
  - `DEFAULT_N = 20`
  - `confirmedCount(findings) -> number` — `num(f.both) + num(f.tiebreak && f.tiebreak.byVerdict && f.tiebreak.byVerdict.confirmed)` where `num = (v) => Number.isFinite(v) ? v : 0`; a null/non-object `findings` → 0. Must equal `tools/step-yield-report.js` `stepRow`'s current `confirmed` expression for every input.
  - `startedAtOf(runId) -> string|null` — moved verbatim (behavior) from `tools/step-yield-report.js:207-214`.
  - `readLensHistory({ roots, n = DEFAULT_N, liveness }) -> { lenses, skipped, errors }` — throws `TypeError` when `roots` is not a non-empty array of strings, `n` is not a positive integer, or `liveness` is given and is not a function. `liveness(dir) -> 'live'|'dead'|'unknown'` defaults to `(dir) => runLiveness(dir).verdict`; tests inject it.

Algorithm (the parts the tests do not pin):
1. Run dirs: each root's child directories, then `{root}/archive`'s child directories, skipping a child named `archive`. A root that cannot be read → `errors.push({path: root, reason: 'unreadable root ({code})'})`. A missing `archive/` is normal. Group by basename; a group of two or more applies the Global Constraints twin rule (closed copy, then `archive/` copy, then first root) and lists each dropped copy as `skipped {reason: 'duplicate run id (kept {kept path})'}`.
2. Per run dir: read dispatch evidence from `{dir}` and every `{dir}/spec-{N}/` child (`/^spec-\d+$/`). All absent → the no-dispatch path (Global Constraints "Malformed yield without dispatch evidence"): read the yield only to report a malformed one; no further step runs for the run.
3. `startedAtOf(basename)` null → `skipped.push({path: dir, reason: 'run id has no parseable start time'})`, run excluded.
4. Closed check (Global Constraints "Closed vs not closed"). Not closed → `skipped.push({path: dir, reason: 'run not closed'})`, run excluded — before any dispatch-file error is looked at, so a not-closed run with a malformed dispatch file is never an `errors` entry.
5. Any dispatch source in an `error` state → `errors.push({path: file, reason})`, run excluded.
6. Closed run: `{dir}/step-yield.json`: ENOENT → `errors {reason: 'step-yield.json missing'}`; other read error → `unreadable ({code})`; bad JSON → `step-yield.json unparseable`; not an object, `schemaVersion !== SCHEMA_VERSION`, or `steps` not an array → `step-yield.json is not a schemaVersion {SCHEMA_VERSION} yield`. Run excluded.
7. Qualifying lenses for the run: per lens, the sources (parent file, each `spec-N` file) holding any entry for it; two or more → `skipped {path: dir, reason: 'multi-member dispatch (lens {lens}: {sources})'}` (source names `lens-dispatch.json` and `spec-{N}`), excluded for that lens only; exactly one → the lens qualifies when that source has an entry `status === 'completed' && reviewers === 2`. Per qualifying lens: confirmed = sum of `confirmedCount(ownGet(bucket.findings.byLens, lens))` over `[...steps, unattributed]` (missing `findings`/`byLens`/lens → 0; read lens keys as own properties only).
8. For every id in `LENS_IDS` (always all eight): sort its qualifying runs newest first (startedAt desc, ties run id desc — `tools/step-yield-report.js`'s `newestFirst`), take `n`; `runs` = count, `confirmed` = sum, `perRun` = `runs ? confirmed / runs : null`, `shareWithFinding` = `runs ? (runs with confirmed > 0) / runs : null`, `insufficient` = `runs < n`.

Test fixture helper (in the test file): `makeRun(root, runId, { dispatch: [entries] | null, yieldObj | 'missing' | 'malformed', specDispatch: {N: [entries]}, state: 'clean' | 'active' | null })` — `state` defaults to `'clean'` and writes `run-state.json` `{status}` (`null` writes none); writes dispatch via Task 1's `appendLensDispatch` (real writer) and a hand-built yield `{schemaVersion: SCHEMA_VERSION, steps:[{phase:'review', findings:{byLens:{...}}}], unattributed:{findings:null}, unparsed:{count:0,samples:[]}}`. Run ids `2026-0M-DDTHHMMSS-record-N` with distinct times.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/review-lens/history.test.js`); each test name carries its AC clause id:
  - `AC1.1: 25 qualifying runs for 3d report the newest 20` — 25 runs, each with a `3d` completed/2 entry; exactly 5 have `byLens['3d'] = {both:1}` — runs 4 and 5 (by start time, oldest = 1, so outside the newest 20) and runs 21, 22, 23; others none. Expect `lenses['3d']` = `{runs:20, confirmed:3, perRun:0.15, shareWithFinding:0.15, insufficient:false}`. Name the runs so lexical order differs from time order (e.g. ids `…-record-590` dated later than `…-record-5770`) and assert the newest-20 selection follows time.
  - `AC2.1/AC2.2: a dispatched lens with no finding line counts 0; no evidence does not count` — run A: `3b` completed/2, yield has no `3b` key → `lenses['3b'].runs === 1`, `confirmed === 0`; run B has no `lens-dispatch.json` but its yield has `byLens['3b'] = {both: 4}` → still `runs === 1`, `confirmed === 0`.
  - `AC2.3/AC2.4/AC2.5: failed, blocked and single-reviewer dispatches do not qualify` — three runs with `3c` entries `{status:'failed', reviewers:2}`, `{status:'blocked', reviewers:2}`, `{status:'completed', reviewers:1}`, each yield `byLens['3c']={both:1}` → `lenses['3c'].runs === 0`, `perRun === null`, `insufficient === true`.
  - `a lens dispatched in several rounds counts as one run` — entries round 1 and round 2 completed/2 for `3a` → `runs === 1`, confirmed counted once.
  - `AC3.1: an unclosed run is skipped as run not closed, never an error` — four runs, each with a `3e` completed/2 dispatch and the injected `liveness` recording its calls: (a) `state: 'active'`, yield `'missing'` → skipped, `liveness` not called for it; (b) `state: 'active'`, valid yield `{3e:{both:1}}`, `liveness` → `'live'`; (c) `state: 'clean'`, valid yield, `liveness` → `'live'` (a live owner makes a clean run not closed); (d) `state: 'active'`, yield `'missing'`, dispatch file `{"v":2,"entries":[]}` (malformed; review row: the closed check precedes dispatch-file errors). Each → `skipped` entry `{path: dir, reason: 'run not closed'}`; `errors` empty; `lenses['3e'].runs === 0`.
  - `AC3.2/AC3.4: a closed run with a missing or malformed step-yield.json is an error, never counted as 0` (AC3.4 for both kinds: AC3.1's runs also assert `lenses['3e'].runs === 0`) — `state: 'clean'` runs with `'missing'` and `'malformed'` (`not json`), both with `3e` completed/2 → `lenses['3e'].runs === 0`; `errors` holds both run paths with reasons `/missing/` and `/unparseable/`; neither path in `skipped`.
  - `AC3.3: a run with no live owner and a yield or clean state is closed` — a `state: 'clean'` run with a valid yield and `liveness` → `'dead'` qualifies; a `state: 'active'` run with a valid yield and `liveness` → `'unknown'` qualifies (only `live` makes a run not closed); a `state: null` run with a valid yield and `liveness` → `'dead'` qualifies.
  - `AC6.3: a malformed yield in a closed run with no dispatch file is reported` — a `state: 'clean'` run with no dispatch file and a `not json` yield → `errors` holds it with reason `/unparseable/`, `liveness` → `'dead'`; a `state: 'clean'` run with no dispatch file and no yield, and one with a valid yield, add no `errors`/`skipped` entry; every lens `runs: 0`.
  - `AC4.1: two members dispatching the same lens exclude the parent for that lens` — parent run with valid parent yield `{3d:{both:2}, 3a:{both:1}}`; `spec-1` file has `3d` completed/2 and `3a` completed/2, `spec-2` file has `3d` completed/2 → `lenses['3d'].runs === 0`; `skipped` holds `{path: dir}` with reason starting `multi-member dispatch` and naming `3d`, `spec-1`, `spec-2`; `lenses['3a']` `{runs:1, confirmed:1}` (one member dispatched it).
  - `AC4.2: a lens dispatched by exactly one member counts once with the parent yield` — `spec-12` file only, `3b` completed/2 in rounds 1 and 2, parent yield `{3b:{both:3}}` → `lenses['3b']` `{runs:1, confirmed:3}`.
  - `AC5.1: 7 qualifying runs read insufficient` → `lenses['3f']` `{runs:7, insufficient:true}`.
  - `AC6.1: an unreadable root is reported, not read as empty` — a root path that does not exist → `errors[0].path === root`, reason `/unreadable root/`; every lens `runs: 0`.
  - `AC6.2: a malformed step-yield.json is reported` — covered by AC3.2's `'malformed'` case; plus a clean run's yield with `schemaVersion: 99` → `errors` reason `/not a schemaVersion 1 yield/` (Review Focus 3).
  - `AC7.1/AC7.2: relabeled adds to no confirmed count` — `3f` byLens `{both:2, relabeled:1, tiebreak:{byVerdict:{confirmed:1}}}` → confirmed 3; `3b` byLens `{one:1, relabeled:1}` → confirmed 0 (each completed/2).
  - `a run id with no parseable start time is skipped and listed` — dir `unresolved-provenance` with a `3a` dispatch → `skipped` holds it, reason `/start time/`.
  - `an archived twin counts once, from the kept copy` (Review Focus 1) — (a) same run id under root (`state: 'active'`, no yield) and `root/archive` (`state: 'clean'`, yield `{3a:{both:1}}`), both with a `3a` completed/2 dispatch → `lenses['3a']` `{runs:1, confirmed:1}`, `skipped` holds the root copy with reason `/duplicate run id \(kept .*archive/`, and no `run not closed` entry for it; (b) both copies clean → the `archive/` copy is kept.
  - `a malformed dispatch file is an error, not absence` (Review Focus 2) — `{"v":2,"entries":[]}` → `errors` names the file; run excluded.
  - `lens keys outside 3a-3h are ignored` (Review Focus 5) — yield byLens has `__proto__`, `unknown`, `constructor` keys; result `Object.keys(lenses)` deep-equals `LENS_IDS`.
  - `confirmedCount matches the report's formula` — table of inputs (`null`, `{}`, `{both:2}`, `{both:'x', tiebreak:{byVerdict:{confirmed:NaN}}}`, `{both:1, tiebreak:{byVerdict:{confirmed:2}}}`) → `0,0,2,0,3`.
  - `real writers: a derived step-yield.json and a recorded dispatch` — build a run dir whose `decisions.md` carries one `formatEntry({status:'AUTO', step:'Reproduction', text:'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.', …})` line plus the events `tests/step-yield-report.test.js`'s `buildDerivedRun` writes (copy that helper's shape), then `writeStepYield(dir, deriveStepYield(dir))`, a `run-state.json` `{status:'clean'}`, and `appendLensDispatch` a `3a` completed/2 entry → `lenses['3a']` `{runs:1, confirmed:1}`.
  - Every other test passes a `liveness` stub returning `'dead'`, unless the test says otherwise, so no test spawns a real probe.
  - `the default liveness is runLiveness` — `readLensHistory` called without `liveness` on a root holding one `state: 'clean'` run whose `run-state.json` carries no owner block, a valid yield and a `3a` completed/2 dispatch, run id dated within the last hour (the legacy route reads `unknown` or `dead`, never `live`, for an owner-less run with no worktree) → `lenses['3a'].runs === 1`.
  - `n must be a positive integer` — `n: 0` and `n: 1.5` throw `TypeError`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/review-lens/history.test.js`
Expected: FAIL with "Cannot find module" for `history`

- [ ] **Step 3: Implement `history.js`** per the Interfaces block and algorithm. Use `fs.readdirSync(…, {withFileTypes:true})` and catch-by-code (no `existsSync`). Header comment: what it reads, the qualifying rule, the closed rule, the multi-member and twin rules, the result shape, that nothing is dropped silently (skipped vs errors), and that `review-coordination.js record-lens-dispatch` is the writer of its denominator.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/review-lens/history.test.js`
Expected: PASS

- [ ] **Step 5: Mutation proof.** In a scratch copy (never the worktree's committed file), delete in turn (a) the `reviewers === 2` condition, (b) the archive-twin rule (keep the first copy found instead), (c) the `schemaVersion` check, (d) the newest-first sort, (e) the multi-member check, (f) the closed check (treat every run as closed); each must turn at least one named test red. Record which test went red for each in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/review-lens/history.js tests/bin-lib/review-lens/history.test.js
git commit -m "Add review-lens history: per-lens confirmed-finding rate over the last N runs — refs #5998"
```

### Task 3: `tools/step-yield-report.js` reuses the shipped count

**Role:** integration

**Files:**
- Modify: `tools/step-yield-report.js:207-214` (`startedAtOf`), `:261` (`stepRow`'s `confirmed`)
- Test: `tests/step-yield-report.test.js` (append two regression pins)
- Test: `tests/step-yield-report-shared-count.test.js` (create — the failing test)

**Interfaces:**
- Consumes: Task 2's `confirmedCount`, `startedAtOf` from `../plugin/bin/lib/review-lens/history`.
- Produces: unchanged exports of `tools/step-yield-report.js` (`startedAtOf` re-exported, now the shipped function).

- [ ] **Step 1: Capture the real-archive baseline before editing.** Run (foreground, output to the run dir evidence folder):

```bash
mkdir -p "{run-dir}/evidence"
node tools/step-yield-report.js "{main-checkout}/.claude-tweaks/pipelines/archive" --window 20 --json > "{run-dir}/evidence/step-yield-report-before.json"
```

- [ ] **Step 2: Write the pin tests** (append to `tests/step-yield-report.test.js`, using its `setup`/`runCli`). These pass before and after the change — they are regression pins, so run them now and expect PASS:
  - `AC: the per-lens table is byte-identical` — `runCli([root])`; the out text contains exactly this block (captured from the pre-change code over `setup()`):

```
lens                   raised         both          one tb-confirmed   tb-refuted
3f                         10            4            6            5            2
3b                          2            0            2            1            1
3a                          1            1            0            0            0
```

  - `stepRow confirmed is both plus tiebreak confirmed` — `runCli([root, '--runs', '--json'])`; the run `2026-11-10T090000-record-2`'s review step has `confirmed === 9`, run `2026-11-12T090000-record-1`'s review step `confirmed === 2`.

Run: `node --test tests/step-yield-report.test.js` — expected PASS (pins hold on the pre-change code).

- [ ] **Step 3: Write the failing test** `tests/step-yield-report-shared-count.test.js`:
  - `the report uses the shipped confirmedCount and startedAtOf` — `require('../tools/step-yield-report.js').startedAtOf === require('../plugin/bin/lib/review-lens/history').startedAtOf`; and the report's comment-stripped source (the shared comment stripper `bin-source-scan-conformance` names, or a plain read if none fits) contains `confirmedCount(` and does not contain `num(f.both) + num(`.

- [ ] **Step 4: Run to verify it fails**

Run: `node --test tests/step-yield-report-shared-count.test.js`
Expected: FAIL — `startedAtOf` is not the shipped function

- [ ] **Step 5: Edit the report** — import `{ confirmedCount, startedAtOf }` from the shipped module; delete the local `startedAtOf` body; `confirmed: confirmedCount(f)`; keep the `module.exports` names unchanged.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test tests/step-yield-report.test.js tests/step-yield-report-shared-count.test.js`
Expected: PASS

- [ ] **Step 7: Real-archive after-run and diff** (AC evidence for Deliverable 4):

```bash
node tools/step-yield-report.js "{main-checkout}/.claude-tweaks/pipelines/archive" --window 20 --json > "{run-dir}/evidence/step-yield-report-after.json"
```

Then `diff` the before/after files: expected no output except `generatedAt`-style volatile fields if any (name any differing key in the report; a differing count is a defect). Log one `AC evidence` entry via `log-decision.js --run … --section "/build" --status AUTO --step "AC evidence" --text-file {file}` naming Deliverable 4, the command shape, and the diff result, citing both evidence paths.

- [ ] **Step 8: Commit**

```bash
git add tools/step-yield-report.js tests/step-yield-report.test.js tests/step-yield-report-shared-count.test.js
git commit -m "Reuse the shipped confirmed count and start-time rule in step-yield-report — refs #5998"
```

### Task 4: Review Step 3 records every lens dispatch; docs

**Role:** integration
**Review risk:** high (decision logic: the outcome → `--status`/`--path`/`--reviewers` mapping decides which runs qualify for the rate; a wrong mapping silently changes it)

**Files:**
- Create: `plugin/skills/review/step3-lens-dispatch-record.md`
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (one pointer line, directly after line 95's `> **Parallel execution (conditional):**` note — the one paragraph every Task-path dispatch shape passes through: reproduction pairs, the low-tier single agents, and lens 3h's single agent)
- Modify: `plugin/skills/review/step3-workflow-dispatch.md` (Settle section, after the first-call paragraph ending "…as the Task path handles it.")
- Modify: `docs/plugin-structure.md` (add a `plugin/bin/lib/review-lens/` line in the lib listing near line 72; add `step3-lens-dispatch-record.md` to the review row's sub-file list, line 195, and a clause to line 196; add `record-lens-dispatch` to the line-405 verb list)
- Modify: `docs/skill-graph.md:592` (the `bin/review-coordination.js` row gains: Step 3 records each lens dispatch through `record-lens-dispatch`, read by `bin/lib/review-lens/history.js`)
- Test: `tests/review-lens-dispatch-record-conformance.test.js` (create)

**Interfaces:**
- Consumes: Task 1's verb exactly as specified there.

Sub-file content (decisions; wording is the implementer's, in the neighbouring files' dispatcher voice):
- When: once per lens per Step 3 round, with a run directory; standalone (no run directory) records nothing. On every dispatch path, whatever any lens-selection policy says, so history builds before anyone opts in.
- Command: `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" record-lens-dispatch --run "$PIPELINE_RUN_DIR" --lens {lens} --reviewers {1|2} --path {task|workflow} --status {completed|failed|blocked} --round {n}`.
- `--status completed`: the lens reached its pair verdict from two usable replies (its `categorise-reproduction --only confirmed` call ran, or `settle-lens-replies` listed it under `settled`), or a single-reviewer lens (low tier, lens 3h) returned a usable reply. `blocked`: a reviewer replied `BLOCKED`/`NEEDS_CONTEXT` and the lens reached no pair verdict. `failed`: the lens's replies never came — session limit twice, unavailable, timed out, or the partner-died single-read degrade (`step3-tier-variants.md`).
- `--reviewers`: the reviewers dispatched for the lens — 2 for a reproduction pair, 1 for a low-tier single-read agent (`step3-tier-variants.md`) and for 3h.
- Lens 3h is always `--path task --reviewers 1`, including when it is dispatched as a Task agent alongside a workflow fan-out; `completed` on a usable reply, else `blocked`/`failed` as above.
- `--path`: the path whose replies settled the lens — `workflow` for a lens `settle-lens-replies` settled, and for a `needsSession` lens with reason `single-reviewer` whose one workflow reviewer was usable (settled by the low-tier single-read rule, nothing re-dispatched: `--reviewers 1 --status completed`); `task` for every Task-path lens, including a workflow lens whose reviewers were re-dispatched as Task agents (`reviewer-unusable`, or a `single-reviewer` lens whose one reviewer was unusable) and every lens after the workflow fallback.
- When to call: right after the lens's verdict is known (after its first `categorise-reproduction`/`settle-lens-replies` call, or once its failure is final after the one retry).
- `--round`: 1 on the run's first Step 3; a later Step 3 in the same run directory reads `{run}/lens-dispatch.json` once first and passes one more than its highest `round`. The round never changes the rate, so a doubtful round is harmless; an identical repeat call is a no-op (`duplicate: true`).
- Exits: 2 → fix the call (never retry unchanged); 3 → re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and retry once, then name the unrecorded lens in the review summary. A failed record never blocks the review.
- Why: the yield file has no entry for a lens that ran and found nothing; this record is the rate's denominator (`bin/lib/review-lens/history.js`).

Pointer line text in `step3-lens-dispatch.md` (exact):
`> **Dispatch record (#5998).** With a run directory, record every agent lens's dispatch (pairs, low-tier single agents and 3h) once its verdict or failure is known, on this Task path and the workflow path alike: read \`step3-lens-dispatch-record.md\` in this skill's directory for the call and its field values.`

- [ ] **Step 1: Write the failing conformance test** `tests/review-lens-dispatch-record-conformance.test.js`, per `skill-prose-conformance-tests` (assert live, and assert the same helper throws on a frozen pre-change excerpt):
  - `AC8.1: step3-lens-dispatch.md points at the record sub-file` — live file contains `step3-lens-dispatch-record.md` exactly once, in the paragraph immediately after the `> **Parallel execution (conditional):**` note; frozen pre-change excerpt (line 95's note and the line after it in the pre-change file, as a constant) does not.
  - `AC8.1: the sub-file covers the single-agent shapes` — `step3-lens-dispatch-record.md` names `3h` with `--path task` and `--reviewers 1`, and names `step3-tier-variants.md` (the low-tier single-read agents).
  - `AC8.1: step3-workflow-dispatch.md records settled lenses through the CLI` — helper `assertRecordsThroughCli(text)` asserts `record-lens-dispatch` and `--path workflow` appear in the Settle section (text between `## Settle` and the next `## `), and that the `**\`single-reviewer\`.**` paragraph contains `--reviewers 1`; live passes; frozen pre-change Settle section constant (the section's first bash block and paragraph, plus the pre-change `single-reviewer` paragraph) throws.
  - `AC8.1: the sub-file names every status, path and reviewers value and the verb` — `step3-lens-dispatch-record.md` contains `record-lens-dispatch`, `--status`, each of `completed`, `failed`, `blocked`, `task`, `workflow`, `--reviewers`, `--round`, `$PIPELINE_RUN_DIR`.
  - `the sub-file's flag values are the verb's` — each value the sub-file lists for `--status`/`--path` is in `STATUSES`/`PATHS` from `plugin/bin/lib/review-lens/dispatch-record.js`, and vice versa.
  - `step3-lens-dispatch.md stays under the read rail` — `fs.statSync(...).size <= RAIL_BYTES` from `plugin/bin/lib/skill-audit/budgets.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/review-lens-dispatch-record-conformance.test.js`
Expected: FAIL — `step3-lens-dispatch-record.md` not found / pointer absent

- [ ] **Step 3: Write the sub-file, the pointer line, the workflow Settle insertion, and the four docs edits** per the Files block. In `step3-workflow-dispatch.md`, the insertion says: after the first `settle-lens-replies` call, record each `settled` lens (`--path workflow --status completed`, `--reviewers` from the call's `lenses`); in the `single-reviewer` paragraph, a lens whose one reviewer was usable is recorded `--path workflow --reviewers 1 --status completed` once the single-read rule has run; a `reviewer-unusable` lens (and a `single-reviewer` lens re-dispatched) is recorded by the Task path's steps it goes through; lens 3h, dispatched alongside the workflow, is recorded as the Task path records it; under a fallback condition every lens is recorded on the Task path; cite `step3-lens-dispatch-record.md`.

- [ ] **Step 4: Run to verify it passes, plus the suites that pin these files**

Run: `node --test tests/review-lens-dispatch-record-conformance.test.js tests/review-lens-workflow-dispatch-conformance.test.js tests/review-lens-shell-discipline-conformance.test.js tests/review-lens-no-suites-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS. Then `git grep -n -F 'settle-lens-replies' -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans'` — every hit that lists the verbs also lists `record-lens-dispatch`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch-record.md plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-workflow-dispatch.md docs/plugin-structure.md docs/skill-graph.md tests/review-lens-dispatch-record-conformance.test.js
git commit -m "Record every review lens dispatch on both Step 3 paths — refs #5998"
```

### Task 5: Real-input probe of the history reader

**Role:** integration (the probe's expected output must be reconciled against an independent count, not copied)

**Files:**
- Waived `plugin/bin/lib/review-lens/history.js`: read-only probe of Task 2's module.

- [ ] **Step 1: Run the reader against the real pipelines root** (scratch script under the session scratchpad, never committed), printing `JSON.stringify(readLensHistory({roots:['{main-checkout}/.claude-tweaks/pipelines']}))`, output redirected to `{run-dir}/evidence/lens-history-probe.txt`.
Expected: every lens `runs: 0, insufficient: true` (no `lens-dispatch.json` exists yet — the intended warm-up, Decision Q3), `errors` empty, and `skipped` holding only `duplicate run id` entries for archive twins, if any (a run with no dispatch file is ignored before the closed check, so no `run not closed` entry appears).

- [ ] **Step 2: Independent count.** `find "{main-checkout}/.claude-tweaks/pipelines" -name lens-dispatch.json` — expected 0 lines. Reconcile: zero files ⇔ zero runs for every lens; any `skipped`/`errors` entry beyond the expected is named in the task report.

- [ ] **Step 3: Log** one `AC evidence` entry (as in Task 3 Step 7) citing both outputs. No commit.

### Task 6: Register `history.js` as a run-liveness consumer

**Role:** integration

Governing rule (`shared-contract-extraction`, "Variant: one more consumer of a shared `bin/lib/` verdict module"): "**Every consumer list, and the count word it carries.** For run-liveness: the `Consumers:` header comment in `index.js`, `docs/hooks.md`'s owner-block paragraph, and `docs/plugin-structure.md`'s `run-liveness/` line." Also: "**Every recorded removal condition that argues from who the consumers are.**" and "**Whether the new consumer joins the module's callers scan.**"

**Files:**
- Modify: `plugin/bin/lib/run-liveness/index.js` (header comment's consumer list, lines 4-8: add `review-lens/history.js`'s closed check (#5998), which reads only `verdict === 'live'` as not closed, for a run its file test has not already ruled not closed)
- Modify: `docs/hooks.md:72` (owner-block paragraph: "Four routes consume it" → "Five routes consume it", add the history.js route in the same voice; the 72-hour legacy-route removal condition gains a clause: history reads `unknown` and `dead` alike as closed, so removing the route changes no history outcome)
- Modify: `docs/plugin-structure.md:74` (`run-liveness/` line: same count word and route)
- Modify: `docs/reconcile-checks.md:386` (the same removal-condition clause)
- Modify: `tests/run-liveness-callers-conformance.test.js` (`SCANNED` gains `plugin/bin/lib/review-lens/history.js`, so the new consumer cannot grow a private probe; one new test)

**Interfaces:**
- Consumes: Task 2's `history.js` (exists, imports `runLiveness`).

- [ ] **Step 1: Write the failing test** appended to `tests/run-liveness-callers-conformance.test.js`: `every consumer list names review-lens/history.js` — `docs/hooks.md` and `docs/plugin-structure.md` each contain `Five routes consume it` and `review-lens/history.js`; `plugin/bin/lib/run-liveness/index.js`'s leading comment block contains `review-lens/history.js`; frozen pre-change constant `'Four routes consume it'` fails the same helper. Add `history.js` to `SCANNED`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/run-liveness-callers-conformance.test.js`
Expected: FAIL — the new test (docs still say "Four routes"); the existing scan tests PASS with `history.js` in `SCANNED`.

- [ ] **Step 3: Edit the four files** per the Files block. Grep `git grep -n -F 'routes consume it' -- docs plugin` and `git grep -n -F 'run-liveness' -- docs plugin/bin` first; every consumer list found gains the entry.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/run-liveness-callers-conformance.test.js tests/bin-lib/run-liveness/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/index.js docs/hooks.md docs/plugin-structure.md docs/reconcile-checks.md tests/run-liveness-callers-conformance.test.js
git commit -m "Register review-lens history as a run-liveness consumer — refs #5998"
```

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (history module, result shape, ordering, skipped) | 2 |
| Deliverable 2 (per-run dispatch record, sanctioned writer, no legacy derivation, written on every path) | 1, 4 |
| Deliverable 3 (`insufficient`) | 2 (AC5.1) |
| Deliverable 4 (report reuse, table byte-identical) | 3 |
| AC1-AC7 (AC3 = Decision Q1, AC4 = Decision Q2) | 2 (test names carry clause ids) |
| AC8 (both dispatch paths, through a CLI) | 1, 4 |
| Decision Q3 (no legacy derivation) | 2 (AC2.2: a yield without a dispatch file counts for no lens), 5 |
| Prior plan-review rows: archive-twin rule, lock fail-closed + review risk, workflow single-reviewer recording, Task 5 role | 2, 1, 4, 5 |
| New run-liveness consumer (AC3's live-owner clause) registered in every consumer list | 6 |
| Gotcha: lens-dispatch.md headroom | 4 (pointer line only + rail test) |
| Gotcha: expand-contract mixed archive | 2 (runs without the file count for no lens) |
| Gotcha: lexical vs time order | 2 (AC1.1 fixture) |
