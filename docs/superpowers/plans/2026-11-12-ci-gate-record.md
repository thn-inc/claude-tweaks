# CI Gate Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one `ci-gate` event in the run's `events.jsonl` whenever `_shared/pr-first-merge.md` Step 2.5 reaches a green or Red-path verdict, derive `totals.ciWallMinutes` and `ciGate[]` from it, and render one `CI gate:` line per PR in `phase-timing.js`.

**Architecture:** A new sanctioned-writer CLI, `plugin/bin/ci-gate-record.js`, re-reads the head runs through an injected `gh run list --commit` runner, computes `ciWallMs`, and appends the event through `context.js`'s `appendEvent`, then confirms the line landed by re-reading `events.jsonl`. `derive.js` gains one additive derivation over `ci-gate` events (keys added only when an event exists); `phase-timing.js` copies `ciGate` into `timing.json` and renders the line under `--markdown`. Step 2.5's prose captures a start epoch and calls the writer at two sites; a writer failure logs `SKIP` and never gates the merge.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI (via `repo-resolve.js`'s `ghOptions` seam), markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T102742-spec-5160-5161-5162/spec-5160/work/5160-spec.md` (record #5160)

**Scope and edit discipline (quoted for every implementer):** "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

**Task dependencies:** Tasks 1, 2 and 5 are independent. Task 3 needs Task 2's refused-case list. Task 4 needs Task 1 (the golden is committed before any `derive.js` edit). Task 6 needs Task 3 (`parseArgs`, `VERDICTS`) and Task 5 (the byte headroom). Task 7 needs Tasks 3 and 4. Longest chain: 3.

**Byte budget (composed `merge` bundle).** Plan-audit measures the composed `merge` bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`, composed at `dispatch/task-prompt.md:109`, `wrap-up/auto-merge-short-circuit.md:245`, `wrap-up/merge-mode.md:25`, `wrap-up/review-console.md:124`) at 51,695 B of `RAIL_BYTES` 52,500 B: 805 B of headroom at authoring. Task 5 removes 867 B of restated rationale from `pr-first-merge.md`; Task 6 adds 848 B of Step 2.5 prose (both measured with `Buffer.byteLength` over the verbatim before/after text against the live file at `2771d7929`). After both: `pr-first-merge.md` 37,030 B, bundle ≈ 51,676 B, headroom ≈ 824 B — above the orchestrator's 380 B floor, which leaves room for #5161's ≈100 B sentence on this branch.

## Spec claims corrected (fact-checked against the tree at `2771d7929`)

- `pr-first-merge.md`'s Step 2.5 `gh run list … --json name,workflowName,status,conclusion,url` is line 143, not 160; `DEADLINE=$(( $(date +%s) + 900 ))` is line 209, not 220; the `RC=124` → `checks-pending-timeout` bullet is line 246, not 251 (251 is the `**Red path — never merge; park.**` heading).
- `pr-first-merge.md` is 37,049 B, not 37,852 B.
- `plugin/bin/pr-checks.js`'s `gh run list failed` handling is line 221, not ~203.
- `derive.js` builds `totals` at line 282 (not 271), `verifyMinutes` at 292 (not 279), returns `{ phases, totals }` at 295 (not 282).
- `context.js`'s `appendEvent` is declared at line 1064 (not 1066). It is **best-effort**: it swallows every error and returns `undefined`, and stamps `ts` from the real clock. A write failure is therefore invisible to the caller; the writer must confirm by re-reading (Task 3).
- The exit-code scan is `tests/bin-lib/exit-code-conformance.test.js`, not `tests/exit-code-conformance.test.js`.
- Key Files says the conformance test pins "Step 2.5's three writer call sites"; Deliverables, AC8 and Gotchas say two call sites, three verdict values ("do not add a third call site"). This plan builds two.
- `resolveTarget` (`plugin/bin/lib/stage-item/write.js:48`) checks only that the run dir exists and that its nearest `.git` ancestor is the main checkout (a `.git` *directory*); it never checks for `.claude-tweaks/pipelines`. Two of AC4's listed cases are therefore expected *not* to be refused (a `..` path resolving inside the checkout but outside `pipelines/`, and `x.claude-tweaks/pipelines-copy`). Task 2 probes this; per the spec, unrefused cases are reported to the orchestrator (who files them through `/claude-tweaks:capture`) and dropped from AC4's test list.

## Global Constraints

- Event kind is exactly `ci-gate`; fields exactly `pr`, `headSha`, `verdict`, `gateWaitMs`, `runsReadAt`, `runs[]` (each `{workflow, event, status, createdAt, startedAt, updatedAt, attempt, conclusion, databaseId}`, `workflow` = `workflowName`), `ciWallMs`, and `pendingAtBound` (present and `true` only for `timeout-park`).
- The one read: `gh run list --commit {sha} --limit 100 --json createdAt,startedAt,updatedAt,attempt,event,conclusion,status,workflowName,databaseId` (plus `--repo {owner}/{repo}` when given). Verified live once, read-only, on `581984e2269cf20b48ae17afcacf1e9e9416ed29`: returned 5 runs, every field present (e.g. `{"attempt":1,"conclusion":"success","createdAt":"2026-11-12T09:12:45Z","databaseId":43189450628,"event":"push","startedAt":"2026-11-12T09:12:45Z","status":"completed","updatedAt":"2026-11-12T09:17:34Z","workflowName":"test"}`).
- `ciWallMs` = latest `updatedAt` minus earliest `createdAt` over runs whose `status` is `completed`, any `conclusion`, any `event`; `null` when none. Do not filter at write time.
- Minutes rounding everywhere (derive and render): `Math.round(ms / 6000) / 10`, as `verifyMinutes` does.
- Exit vocabulary (Sanctioned-writer): 0 event written (echo the `events.jsonl` path), 2 usage or unreadable input (including a failed `gh run list`), 3 anchoring or write refused. No exit 1.
- `gh` timeout: an explicit 15,000 ms, a deliberate own value stated beside the constant (the spec: a hung `gh` must not hold the merge path), never `GH_TIMEOUT_MS`.
- `verdict` and `pendingAtBound` come from the flags only, never reconciled with the writer's own read.
- Never write `timing.json` directly; never touch the 900 s watch literal.
- Commit messages: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix, body line `Refs #5160` (never `Closes`/`Fixes`), ending with the session's attribution line.
- Test commands in tasks run only the affected files (`node --test path`). The orchestrator runs the full suite centrally; that run selects the repo-wide `plugin/bin` source scans (`tests/gh-host-seam-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`) and `tests/skill-fence-guard-shapes.test.js` for the new CLI and fences.
- Shell: one plain command per Bash call; `git -C "<worktree>" …`; file content only through Write/Edit.

**Governing-skill rules, quoted verbatim** (`.claude/skills/gh-api-module-pattern/SKILL.md` and its `cli-wrapper-contract.md`; they govern `plugin/bin/ci-gate-record.js`):

- "Export `defaultRunner` = `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — always an argv array, never a shell string (no injection surface, no quoting bugs)."
- "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** … A spread — `{ ...QUIET, timeout }` with the flag inside `QUIET` — satisfies neither and fails the full suite"
- "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
- "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled … Record values inside the runner, assert after it returns"
- "**A fake `gh` that returns a fixed full row ignores the `--json` field list, so a test using it cannot see the list shrink.** When a module's correctness depends on a field it requests, assert the recorded argv's field list"
- "Omitting the bound is defensible only with a stated reason" / "Three `gh` bounds deliberately stay their own values and say why beside themselves — `hooks/teardown-run.js`'s 15000, …"
- "**An argv array stops shell injection, not flag injection.** A caller-supplied value that begins with `-` is still read as an *option* by the command itself"
- "**The quiet posture is owed by any call the module catches and recovers from** … It now passes `stdio: ['ignore', 'pipe', 'pipe']`"
- "Logic lives in an exported `run(argv, deps)`; every side effect … goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract"
- "**A fail-closed branch around an injected dependency needs one test of the real dependency's failure shape, not only a stub that throws.**"
- "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
- "*Sanctioned-writer* (…): 0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**."
- "Import the copy that sits beside the writer you call when you add another writer instead of re-deriving the predicate … and pin the refusal with a fixture carrying both a real main-checkout run dir and a worktree-local shadow of it, asserting the shadow's file is byte-unchanged after the exit 3."
- "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.**"
- "**Filesystem reads in a new `plugin/bin/` CLI follow two rules no review is guaranteed to catch.** An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` … A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first"
- "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
- "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.** … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."
- "It looks its flags up with `Object.hasOwn(FLAGS, a)`, which rejects an inherited key such as a bare `constructor` token … Pin the guard with a value after the key (`'constructor', 'x'`)"

`.claude/skills/parse-signal-discipline/SKILL.md` (governs the writer's input parsing and confirm step): "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from "this input legitimately does not need this check"". Applied: an unparseable `gh` stdout, a non-array, a non-object entry, or an unparseable timestamp on a completed run is exit 2, never `ciWallMs: null`; an unreadable `events.jsonl` at confirm time is exit 3, never success.

`.claude/skills/skill-prose-conformance-tests/SKILL.md` (governs Task 6's suite): "**New prose has no pre-change bytes — mutate the live text in memory, and match the failure to its own assertion** … assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)`" and "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both".

`.claude/skills/bin-source-scan-conformance/SKILL.md`: no task reads `plugin/bin` source as text — Task 3 proves "imported, not re-derived" by function identity (`realDeps.resolveTarget === write.resolveTarget`), so the stripper/verdict/floor rules do not apply. If an implementer adds any source-text read, that skill's rules bind it.

## Review Focus

1. A missing or empty gate-start file: `"$(cat "{gate-start-path}")"` expands to `""`, so `--gate-start-epoch ""` must exit 2 (and Step 2.5 logs `SKIP`), never write `gateWaitMs: NaN`. Test: Task 3 `empty --gate-start-epoch exits 2`.
2. `gh run list` returns `[]` (no run registered yet for the head): the event is still written with `runs: []` and `ciWallMs: null`, exit 0. Test: Task 3 `AC2.4`.
3. A gate-start epoch later than the writer's `now` (clock skew, stale file): `gateWaitMs` is recorded as computed (negative), no clamp, no crash. Test: Task 3 `future epoch`.
4. A `ci-gate` event whose `gateWaitMs` or `ciWallMs` is missing or non-numeric renders `n/a` in that slot, never `NaN`. Test: Task 4 `render n/a`.
5. The same PR recorded twice where the later event's `ciWallMs` is `null`: the PR contributes 0 (latest wins), not the earlier non-null value. Test: Task 4 `latest null wins`.

---

### Task 1: Characterize timing output and commit the pre-change golden

**Role:** integration

**Files:**
- Create: `tests/bin-lib/timing/golden.test.js`
- Create: `tests/fixtures/timing/record-1535-golden-timing.json`
- Read (unchanged): `plugin/bin/lib/timing/derive.js`, `plugin/bin/phase-timing.js`, `plugin/bin/lib/timing/budget.js`

**Interfaces:**
- Consumes: `derivePhases({ events, manifest?, runState?, now? }) -> { phases, totals }` (derive.js); `renderMarkdown(out, tokens?, guard?, notes?)` (phase-timing.js export); `evaluateBudgets({ totals, ceilings })`, `budgetProposal({ runId, profile, checks, totals, unattributed })` (budget.js).
- Produces: `tests/fixtures/timing/record-1535-golden-timing.json` and the exported-free test helper `normalizeTiming(obj) -> string` (inside the test file) that Task 4 re-runs unchanged.

Readers of `totals` (sole-site grep, `git grep -n "totals\." plugin/bin`, run at authoring): `plugin/bin/lib/timing/budget.js:94,102` (`budgetProposal`) plus its `METRICS` readers (`t.toolRoundTrips`, `t.procedureBytes`, `t.verifyMinutes`), and `plugin/bin/phase-timing.js:132-192,345-365` (`renderMarkdown`, `checkBudgets` input). The other hits (`code-health/scope.js`, `skill-audit/transcript-load.js`, `wrap-up/pack.js`) are unrelated local `totals` variables. Return-shape grep `git grep -n -E "derivePhases\(" -- tests plugin/bin`: no test deep-equals the whole `derivePhases` result, so the conditional `ciGate` key in Task 4 defangs no assertion.

- [ ] **Step 1: Capture the golden, then write the characterization suite**

Capture with a scratch script (scratchpad, never committed): copy `tests/fixtures/timing/record-1535/{events.jsonl,manifest.yml}` into a `fs.mkdtempSync` dir, spawn `node plugin/bin/phase-timing.js --run <dir> --markdown`, read `<dir>/timing.json`, set `runDir` to `"<RUN_DIR>"` and `generatedAt` to `"<GENERATED_AT>"`, and write `JSON.stringify(obj, null, 2) + '\n'` to `tests/fixtures/timing/record-1535-golden-timing.json`. Never hand-type the golden. Confirm it has no `budget` and no `ciGate` key.

Suite `tests/bin-lib/timing/golden.test.js` (`spawnSync(process.execPath, [CLI, '--run', dir, '--markdown'])` on a `fs.mkdtempSync` copy of the fixture, as the neighbouring timing CLI suite does; read text via the shared `readText` helper):

```js
// normalizeTiming(obj): runDir/generatedAt replaced by the two placeholders, then JSON.stringify(…, null, 2) + '\n'
test('AC6.1 golden: phase-timing.js over record-1535 writes timing.json byte-identical to the pre-#5160 golden (runDir, generatedAt normalized)', ...)
  // assert.equal(normalizeTiming(written), readText(GOLDEN))
test('AC6.1 golden go-red: an extra totals.ciWallMinutes or a ciGate key breaks the golden comparison', ...)
  // assert.notEqual(normalizeTiming({ ...w, totals: { ...w.totals, ciWallMinutes: 0 } }), golden)
  // assert.notEqual(normalizeTiming({ ...w, ciGate: [] }), golden)
test('characterization: derivePhases returns exactly { phases, totals } with totals keys minutes, verifyRuns, verifyMinutes, verifyModes', ...)
  // for each of: record-1535 events + manifest (now 2026-09-05T14:13:00.000Z); []; [{ ts:'2026-09-05T14:13:00.000Z', type:'session-end' }];
  //   null; [null, 'x', { type:'verify' } /* no ts */, { ts:'not-a-date', type:'verify' }]
  // assert.deepEqual(Object.keys(out), ['phases','totals'])
  // assert.deepEqual(Object.keys(out.totals), ['minutes','verifyRuns','verifyMinutes','verifyModes'])
test('Deliverable reader invariance: evaluateBudgets, budgetProposal and renderMarkdown give identical output with and without totals.ciWallMinutes', ...)
  // T = derivePhases(record-1535).totals; T2 = { ...T, ciWallMinutes: 20 }
  // evaluateBudgets({ totals: T, ceilings: { roundTrips: 5, procedureKb: 100, verifyMinutes: 1 } }) deepEqual the T2 call
  // budgetProposal({ runId:'r', profile:'standard', checks, totals: T, unattributed: null }) === the T2 call
  // renderMarkdown({ phases, totals: T }) === renderMarkdown({ phases, totals: T2 })
```

- [ ] **Step 2: Run the suite on today's tree**

Run: `node --test tests/bin-lib/timing/golden.test.js`
Expected: FAIL on today's tree (the suite file does not exist yet). After Step 1 it passes: a characterization suite pins today's behavior, so its discrimination is shown by the go-red test, not by a red phase.

- [ ] **Step 3: Prove the go-red test discriminates**

Confirm the two `assert.notEqual` controls compare against the same `normalizeTiming` + golden the positive test uses (one helper, both tests). Temporarily change one golden byte in a scratch copy read by a one-off `node -e` and confirm `assert.equal` throws; leave the committed golden untouched.

- [ ] **Step 4: Run the suite and its neighbours**

Run: `node --test tests/bin-lib/timing/golden.test.js`
Expected: PASS, 0 failures (the neighbouring timing suites are untouched and run in the central full suite).

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add tests/bin-lib/timing/golden.test.js tests/fixtures/timing/record-1535-golden-timing.json
git -C "<worktree>" commit -m "Pin today's timing.json and totals shape — golden before the ci-gate derivation" -m "Refs #5160"
```

---

### Task 2: Probe `resolveTarget` against AC4's refusal cases

**Role:** integration

**Files:**
- Create: `tests/bin-lib/stage-item/resolve-target-refusals.test.js`
- Test: `tests/bin-lib/stage-item/write.test.js` (unchanged — must stay green)
- Read (unchanged): `plugin/bin/lib/stage-item/write.js`, `tests/bin-lib/run-artifact/cli.test.js` (fixture shape to copy)

**Interfaces:**
- Consumes: `resolveTarget({ runDir, cwd, mainRoot }) -> { ok: true, dir } | { ok: false, reason: 'missing' | 'not-anchored' }`.
- Produces: the list of confirmed-refused cases (case ids C1–C6 below), reported to the orchestrator and passed in Task 3's brief; the list of cases **not** refused, reported to the orchestrator for filing via `/claude-tweaks:capture` (not fixed here).

Fixture (copy the run-artifact CLI suite's `fixture(t)` shape): `root = mkdtemp`, `main = root/main` with a `.git` **directory**, `singleDir = main/.claude-tweaks/pipelines/2026-11-12T102742-record-5160`, `worktree = main/.claude/worktrees/flow-5160` holding a `.git` **file** (`gitdir: ../../../.git/worktrees/flow-5160\n`), `shadow = worktree/.claude-tweaks/pipelines/<same id>`; also create `root/outside`, `main/docs`, `main/x.claude-tweaks/pipelines-copy/<same id>`. `cwd` is `worktree` for every call, `mainRoot` omitted (computed), as a worktree-isolated session sees it. Build `..` spellings by string concatenation with `path.sep`, never `path.join` (which normalizes).

| Case | `runDir` value | Predicted |
|---|---|---|
| C1 | `shadow` | refused `not-anchored` |
| C2a | `singleDir + sep + '..' ×4 + sep + 'outside'` (un-normalized, resolves to `root/outside`) | refused |
| C2b | `path.normalize(C2a)` | refused |
| C3a | `singleDir + sep + '..' ×3 + sep + 'docs'` (un-normalized, resolves to `main/docs`, inside the checkout, outside `pipelines/`) | **accepted** |
| C3b | `path.normalize(C3a)` | **accepted** |
| C4 | `main/x.claude-tweaks/pipelines-copy/<id>` | **accepted** |
| C5a | `root/outside` + `sep` (trailing slash, unanchored) | refused |
| C5b | `shadow + sep` | refused |
| C6 | `'https://example.com/.claude-tweaks/pipelines/<id>'` | refused `missing` |

- [ ] **Step 1: Write the probe suite asserting refusal for every case**

One `test('AC4 probe {case}: resolveTarget refuses …')` per row, each asserting `r.ok === false`. Plus a positive control `test('AC4 probe control: the real main-checkout run dir resolves ok')` asserting `resolveTarget({ runDir: singleDir, cwd: worktree }).ok === true`, so a fixture that refuses everything cannot pass.

- [ ] **Step 2: Run the probe suite**

Run: `node --test tests/bin-lib/stage-item/resolve-target-refusals.test.js`
Expected: FAIL on today's tree (the file does not exist). After Step 1, FAIL on exactly the cases `resolveTarget` accepts (predicted C3a, C3b, C4).

- [ ] **Step 3: Record and drop the unrefused cases**

Write the raw `node --test` failure lines for the unrefused cases into the task report (verbatim, not summarized). Delete those cases from the suite (do not change `write.js`). Rename the file's header comment to state: characterization of `resolveTarget`'s refusals that `ci-gate-record.js` relies on, and which AC4 cases were found not refused (by id) and reported for filing.

- [ ] **Step 4: Run the trimmed suite**

Run: `node --test tests/bin-lib/stage-item/resolve-target-refusals.test.js tests/bin-lib/stage-item/write.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add tests/bin-lib/stage-item/resolve-target-refusals.test.js
git -C "<worktree>" commit -m "Pin which run-dir spellings resolveTarget refuses — the AC4 probe for the ci-gate writer" -m "Refs #5160"
```

Report to the orchestrator: `CONFIRMED-REFUSED: <case ids>` and `NOT-REFUSED: <case ids + raw failure lines>`.

---

### Task 3: The `ci-gate-record.js` sanctioned writer

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/ci-gate-record.js`
- Create: `tests/bin-lib/ci-gate-record/cli.test.js`
- Read (unchanged): `plugin/bin/lib/hooks/context.js` (`appendEvent`), `plugin/bin/lib/stage-item/write.js` (`resolveTarget`), `plugin/bin/lib/repo-resolve.js` (`ghOptions`)

**Interfaces:**
- Consumes: `appendEvent(runDir, type, data, attribution)` (context.js:1064, best-effort, returns `undefined`, stamps its own `ts`); `resolveTarget` (Task 2's interface); `ghOptions(args, opts)`.
- Produces (exports of `plugin/bin/ci-gate-record.js`):
  - `run(argv: string[], deps) -> 0 | 2 | 3`
  - `parseArgs(argv: string[]) -> { pr: number, headSha: string, verdict: string, gateStartEpoch: number, run: string, repo: string|null, help: boolean } | { error: string }` — missing required flags are reported by `run`, not `parseArgs`.
  - `realDeps = { cwd, mainRoot: undefined, now: () => Date.now(), gh(args) -> string, appendEvent, resolveTarget, readFile(p) -> string, stdout(s), stderr(s) }`
  - `computeCiWallMs(runs: object[]) -> number|null` (throws `TypeError` on a completed run with an unparseable `createdAt`/`updatedAt`)
  - `VERDICTS = Object.freeze(['green', 'red', 'timeout-park'])`
  - `RUN_LIST_FIELDS = 'createdAt,startedAt,updatedAt,attempt,event,conclusion,status,workflowName,databaseId'`

Behavior of `run`, in order: `--help`/`-h` → print `USAGE`, 0. Parse error, or any of `--pr`, `--head-sha`, `--verdict`, `--gate-start-epoch`, `--run` absent → 2. `deps.resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot })` in try/catch; throw or `ok: false` → 3 (stderr names `missing` vs not anchored, as `write-run-artifact.js` does). `deps.gh(['run','list','--commit', headSha, '--limit','100','--json', RUN_LIST_FIELDS, ...(repo ? ['--repo', repo] : [])])` in try/catch → 2 with `ci-gate-record.js: gh run list failed: <first stderr line>`; stdout not JSON, not an array, or an entry not a plain object → 2; `computeCiWallMs` throw → 2. `nowMs = deps.now()`; `runsReadAt = new Date(nowMs).toISOString()`; `gateWaitMs = nowMs - gateStartEpoch * 1000` (no clamp). Build `data` in the Global Constraints field order, adding `pendingAtBound: true` only for `timeout-park`. `deps.appendEvent(dir, 'ci-gate', data)`. Confirm: `deps.readFile(path.join(dir, 'events.jsonl'))` (throw → 3); confirmed when some line `JSON.parse`s (skip unparseable lines) to an object with `type === 'ci-gate'` and equal `pr`, `headSha`, `verdict`, `runsReadAt`; else 3 with `ci-gate-record.js: ci-gate event not confirmed in <path>`. Success: stdout `<path to events.jsonl>\n`, 0.

`parseArgs` validation (all → `{ error }`): flags looked up with `Object.hasOwn`; a value-taking flag with no next token, an empty value, or a value starting with `--`; `--pr` not `/^\d+$/` or `0`; `--head-sha` not `/^[0-9a-f]{40}$/`; `--verdict` not in `VERDICTS`; `--gate-start-epoch` not `/^\d+$/`; `--repo` starting with `-`; any unknown token.

`realDeps.gh`: `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true, timeout: CI_GATE_GH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }))` with `const CI_GATE_GH_TIMEOUT_MS = 15000;` and a comment beside it stating why it is not `GH_TIMEOUT_MS` (a hung `gh` must not hold Step 2.5's merge path; `gh-timeout-ms` may raise `GH_TIMEOUT_MS` to 60 s). No `--repo` → gh resolves the repo from the cwd's `origin` through the same seam (no origin parsing in this file, so no `ORIGIN_GATED`/`PIN_WIRED` roster entry). Header comment: purpose, the `ci-gate` field list (single source; prose cites this file), the 0/2/3 vocabulary with "a failed `gh run list` is 2 (unreadable input)", the confirm-by-re-read rationale (appendEvent swallows failures), "post-hoc recorder: never changes a verdict". Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

Test fixture: Task 2's `fixture(t)` shape (main `.git` dir, worktree `.git` file, `singleDir`, `shadow`); deps = `{ ...realDeps, cwd: () => worktree, now: () => 1125000, gh: fakeGh, stdout, stderr }` where `fakeGh` records `args` and returns `JSON.stringify(RUNS)` only for `args[0]==='run' && args[1]==='list'`, else throws `unexpected …`. `RUNS_AC2 = [A: completed/success created 10:00:00 updated 10:12:00, B: completed/failure created 10:02:00 updated 10:20:00, C: in_progress created 09:00:00 updated 11:00:00]` on `2026-11-12T…Z`. Valid sha: `'a'.repeat(40)`.

- [ ] **Step 1: Write the failing CLI suite**

```js
test('AC1.1 AC1.3: --verdict green appends exactly one ci-gate line with pr, headSha, verdict, gateWaitMs, runsReadAt, runs[], ciWallMs')
  // line count of singleDir/events.jsonl +1; parsed: type 'ci-gate', pr 123, headSha 'a'*40, verdict 'green',
  // runsReadAt '1970-01-01T00:18:45.000Z', runs.length 3, runs[0] deepEqual { workflow, event, status, createdAt, startedAt, updatedAt, attempt, conclusion, databaseId } from A
test('AC1.1 AC1.3: --verdict red appends exactly one ci-gate line …')          // same assertions, verdict 'red'
test('AC1.1 AC1.3: --verdict timeout-park appends exactly one ci-gate line …') // same, verdict 'timeout-park'
test('AC1.2: --gate-start-epoch 1000 with now 1125 s gives gateWaitMs 125000')
test('AC2.1: completed runs created 10:00:00/10:02:00 and updated 10:12:00/10:20:00 give ciWallMs 1200000')
test('AC2.2: a still-in_progress run is excluded from both the updatedAt max and the createdAt min')  // RUNS_AC2 with C → still 1200000
test('AC2.3: a cancelled completed run is included') // A + D(completed/cancelled, created 10:01:00, updated 10:25:00) → 1500000 (720000 if excluded)
test('AC2.4: with no completed run (or gh returns []) ciWallMs is null and the event is still written, exit 0')
test('AC3.1: --verdict timeout-park writes pendingAtBound: true')
test('AC3.2: --verdict green and --verdict red write no pendingAtBound key')  // 'pendingAtBound' in ev === false
test('verdict comes from the flag only: green is written even when the snapshot holds a failed run')
test('AC4.1: realDeps.resolveTarget is stage-item/write.js resolveTarget (imported, not re-derived)')
  // assert.equal(realDeps.resolveTarget, require('…/plugin/bin/lib/stage-item/write').resolveTarget)
test('AC4.2: the worktree-local shadow exits 3 and its pre-seeded events.jsonl is byte-unchanged')
  // write 'sentinel\n' to shadow/events.jsonl first; also assert singleDir/events.jsonl absent
test('AC4.3–AC4.5 and AC4.7: each probe-confirmed case exits 3 with nothing written')
  // one sub-assertion per case id from Task 2's CONFIRMED-REFUSED list (excluding C1, covered by AC4.2);
  // C6 is AC4.7's URL-looking value. Drop any case Task 2 reported NOT-REFUSED.
test('AC4.8: each missing required flag exits 2 and calls no gh')  // five argvs, each lacking one of the five
test('AC9.1: a failing gh run list exits 2 and appends no event')    // fakeGh throws; events.jsonl absent
test('gh argv: exact field list and --repo forwarding')
  // recorded args deepEqual ['run','list','--commit','a'*40,'--limit','100','--json',RUN_LIST_FIELDS]
  // and with --repo o/r the same plus ['--repo','o/r']
test('malformed invocations exit 2 with nothing written')
  // trailing bare --run; --gate-start-epoch '' (Review Focus 1); --head-sha 'abc'; --verdict 'amber'; --pr '0'; --pr '1.5';
  // --repo '-x'; ['constructor','x']; an unknown flag
test('unreadable gh output exits 2: not JSON, not an array, a non-object entry, a completed run with createdAt "nope"')
test('future epoch: --gate-start-epoch 2000 with now 1125 s records gateWaitMs -875000, exit 0') // Review Focus 3
test('a write that does not land exits 3: an appendEvent that writes nothing')   // deps.appendEvent = () => {}
test('a write that does not land exits 3: the real appendEvent with events.jsonl as a directory') // real dependency failure shape
test('success echoes the events.jsonl path on stdout and --help prints usage with exit 0')
```

- [ ] **Step 2: Run the suite on today's tree**

Run: `node --test tests/bin-lib/ci-gate-record/cli.test.js`
Expected: FAIL (`Cannot find module '…/plugin/bin/ci-gate-record'`).

- [ ] **Step 3: Implement `plugin/bin/ci-gate-record.js`**

Per the Interfaces and Behavior above, in the sanctioned-writer layout (header comment, `USAGE`, `parseArgs`, `realDeps`, `run`, entry guard; the resolve-target refusal messages say `run dir does not exist` vs `not anchored under the main checkout (a worktree-local shadow)`). Use `fs.readFileSync(p, 'utf8')` for `readFile`; no `fs.existsSync`/`fs.realpathSync`.

- [ ] **Step 4: Run the suite and the probe suite**

Run: `node --test tests/bin-lib/ci-gate-record/cli.test.js`
Expected: PASS, 0 failures. Then prove three guards red by in-memory reasoning on the test inputs: deleting the confirm re-read must turn the `appendEvent that writes nothing` test red; filtering `status === 'completed'` out must turn AC2.2 red; dropping `pendingAtBound`'s verdict condition must turn AC3.2 red. Do each by a temporary edit, run, observe red, revert, in one sitting, and `git -C "<worktree>" status --porcelain` clean of `ci-gate-record.js` changes before Step 5's add.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/bin/ci-gate-record.js tests/bin-lib/ci-gate-record/cli.test.js
git -C "<worktree>" commit -m "Add the ci-gate-record.js writer — one ci-gate event per merge-gate verdict" -m "Refs #5160"
```

---

### Task 4: Derive `ciWallMinutes`/`ciGate` and render the CI gate line

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/timing/derive.js:281-295` (the `totals` object and the return)
- Modify: `plugin/bin/phase-timing.js:348-392` (timing object at 348, markdown write at 378, exports at 392)
- Create: `tests/bin-lib/timing/ci-gate.test.js`
- Test: `tests/bin-lib/timing/golden.test.js` (Task 1, unchanged — must stay green)
- Test: `tests/bin-lib/timing/derive.test.js` (unchanged — must stay green)

**Interfaces:**
- Consumes: Task 1's golden; the `ci-gate` event shape (Global Constraints).
- Produces: `derivePhases(...) -> { phases, totals, ciGate? }` where `ciGate` (every `ci-gate` event as written, in file order, each `{ ...event }`) and `totals.ciWallMinutes: number` are present only when at least one event exists; `renderCiGate(ciGate: object[]|undefined) -> string` exported from `phase-timing.js`.

Derivation (append after the existing `totals` literal, before `return`): iterate the raw `events` argument (file order, not the ts-sorted `evs`), keep `e && typeof e === 'object' && e.type === 'ci-gate'`. If none, return exactly as today. Else `latest = new Map()` keyed by `e.pr` (later overwrites); `ms = Σ latest values' ciWallMs where Number.isFinite`; `totals.ciWallMinutes = Math.round(ms / 6000) / 10`; return `{ phases, totals, ciGate }`. Comment beside it: "An absent ci-gate event means CI time was not recorded, never that CI was fast (#5160)."

Render: `renderCiGate` returns `''` for a missing or empty list; else one line per distinct `pr` in first-appearance order, using that PR's latest event: `` `CI gate: ${verdict}, ${wall} min wall${pendingAtBound === true ? ' (lower bound)' : ''}, gate waited ${wait} min (PR #${pr})` `` with `wall`/`wait` = `Math.round(x / 6000) / 10` when `Number.isFinite(x)`, else `'n/a'`; lines joined by `\n` plus a trailing `\n`. In `main`: after `timing` is built, `if (out.ciGate) timing.ciGate = out.ciGate;`; the `--markdown` write becomes `renderMarkdown(...) + renderCiGate(timing.ciGate) + renderDispatches(timing.dispatches)`. `renderMarkdown` itself is unchanged. Add `renderCiGate` to `module.exports`.

`CIG(over)` = `{ ts: '2026-11-12T10:30:00.000Z', type: 'ci-gate', pr: 123, headSha: 'a'.repeat(40), verdict: 'green', gateWaitMs: 120000, runsReadAt: '2026-11-12T10:30:00.000Z', runs: [], ciWallMs: 1200000, ...over }`.

- [ ] **Step 1: Write the failing suite**

```js
test('AC5.1: one ci-gate event with ciWallMs 1200000 gives totals.ciWallMinutes 20 and ciGate with that one entry')
  // derivePhases({ events: [CIG()] }) → totals.ciWallMinutes 20; ciGate deepEqual [CIG()]
test('AC5.2: two events for the same pr (600000 then 1200000) give 20 and ciGate with two entries')
test('AC5.3: events for two distinct PRs (1200000 and 300000) give 25')
test('AC5.4: an event whose ciWallMs is null contributes 0 and still appears in ciGate') // [CIG({ ciWallMs: null })] → 0, ciGate length 1
test('latest null wins: same pr 1200000 then null contributes 0')                       // Review Focus 5 → ciWallMinutes 0
test('AC6.1: with no ci-gate event derivePhases has no ciGate key and totals has no ciWallMinutes')
  // record-1535 events and [] — 'ciGate' in out === false; 'ciWallMinutes' in out.totals === false
test('AC7.1: phase-timing --markdown prints exactly "CI gate: green, 20 min wall, gate waited 2 min (PR #123)"')
  // tmp run dir, events.jsonl = JSON.stringify(CIG()) + '\n'; spawn; stdout.split('\n') includes the line exactly once
test('AC7.2: pendingAtBound prints "CI gate: timeout-park, 20 min wall (lower bound), gate waited 2 min (PR #123)"')
test('AC7.3: ciWallMs null prints "CI gate: green, n/a min wall, gate waited 2 min (PR #123)"')
test('AC7.4: with no ci-gate event no line starts with "CI gate:"')                    // record-1535 copy
test('the CI line also renders under the phase table: record-1535 plus one ci-gate event')
test('timing.json carries ciGate and totals.ciWallMinutes when an event exists')
test('render n/a: a missing or non-numeric gateWaitMs renders "gate waited n/a min"')  // Review Focus 4, via renderCiGate
test('one line per PR, latest event per PR, first-appearance order')                   // renderCiGate over [pr 1, pr 2, pr 1 later]
```

- [ ] **Step 2: Run the suite on today's tree**

Run: `node --test tests/bin-lib/timing/ci-gate.test.js`
Expected: FAIL (the suite file does not exist; after Step 1, AC5.x fail on `ciWallMinutes` undefined and AC7.x on the missing line).

- [ ] **Step 3: Implement the derivation in `derive.js` and the render in `phase-timing.js`**

Per the Interfaces above. Keep the `derive.js` change to the `totals`/return region (rebase-coordination with #5093, #5092, #5013, #4321, #4259).

- [ ] **Step 4: Run the new suite and the regressions**

Run: `node --test tests/bin-lib/timing/ci-gate.test.js tests/bin-lib/timing/golden.test.js tests/bin-lib/timing/derive.test.js`
Expected: PASS, 0 failures (the golden proves AC6.1's byte-identical absent-event `timing.json`).

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/bin/lib/timing/derive.js plugin/bin/phase-timing.js tests/bin-lib/timing/ci-gate.test.js
git -C "<worktree>" commit -m "Derive and render CI wall time from ci-gate events — totals.ciWallMinutes, ciGate[] and a CI gate line" -m "Refs #5160"
```

---

### Task 5: Trim restated rationale from the composed merge bundle

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (lines 10-16, 32-36, 42-45, 448-450, 459-461)
- Test: `tests/pr-first-merge.test.js` (unchanged — its `/Replaces \`ready-to-merge\`/` and `` /`pr-opened` \(retired/ `` pins must still match after cut T5)
- Read (unchanged): `plugin/skills/_shared/pr-first-merge-appendix.md` (its "Local-merge fallback" section already states what cut T1's removed sentence restated)

**Interfaces:**
- Consumes: nothing.
- Produces: `pr-first-merge.md` at exactly 36,182 B (37,049 − 867), giving Task 6 its headroom.

Rules applied (orchestrator): cut restatement and duplicated rationale only; keep every clause that tells the reader what to do or what a wrong reading costs; the 900 s watch literal and its sentence are untouched (all five cuts sit outside Step 2.5). Pin sweep at authoring: `git grep -n -E "two-thread split|branch-switch guard|close-run.?-before-merge|push-from-worktree|converted file|pre-#410|never re-dropped|Ordering is not advisory|mechanically enforce|cwd-pinned Task call|needs no local checkout|merges before labeling|silently drops acceptance|defensive assertion against|Order is load-bearing|surfaced inside the run|no scratch-worktree|PR opened just now|scratch-worktree ceremony|throwaway one" -- tests` hits only `tests/pr-first-merge.test.js:89-90` (`Replaces \`ready-to-merge\``, `` `pr-opened` (retired ``), which T5 keeps verbatim, and a comment at line 28. Prose-held sweep (`git grep … -- plugin docs .claude/skills`) hits only `pr-first-merge.md` itself, `pr-first-merge-appendix.md:53` (the duplicate T1 relies on) and `flow/worktree-merge.md:112` (independent wording, untouched). No pin changes, so no go-red proof is owed.

Exact cuts (each `before` occurs exactly once in the file; transcribe, do not choose):

**T1 — saves 275 B** (the Overview's history of the retired two-thread split; the "no X, no Y" instruction list is kept, the local-merge pointer is the file's own closing section):

Before:
```text
degrade to ready+comment. `gh pr merge` needs no local checkout, which is what deletes the two-thread split
every pr-first caller used to need: the same cwd-pinned Task call that already holds
authorization, `merge-check`, and acceptance labeling can run the merge itself. No
`close-run`-before-merge relief, no branch-switch guard, no push-from-worktree rule, no
scratch-worktree conflict procedure — all four existed only because a *local* `git merge` +
`git push` needed the main checkout. `local-merge` projects keep all four; see each converted
file's own local-merge fallback section.
```
After:
```text
degrade to ready+comment. `gh pr merge` needs no local checkout, so the same cwd-pinned Task call that
already holds authorization, `merge-check`, and acceptance labeling runs the merge itself — no
`close-run`-before-merge relief, branch-switch guard, push-from-worktree rule or scratch-worktree
conflict procedure.
```

**T2 — saves 230 B** (Step 1's incident history; the cost clause "silently drops acceptance sign-off" is kept):

Before:
```text
before labeling silently drops acceptance sign-off the same way the pre-#410 fast-lane path once
did for a different reason (`wrap-up/review-console.md`'s own "console content is not all of
Phase 4" note) — this procedure states the ordering explicitly so it is never re-dropped.
```
After:
```text
before labeling silently drops acceptance sign-off.
```

**T3 — saves 128 B** (Step 1.5's justification restating `curation-engine.md`'s note):

Before:
```text
Before marking the PR ready, confirm Phase 2's curation-engine apply work has actually landed —
a defensive assertion against an ordering `wrap-up/curation-engine.md`'s own "Ordering is not
advisory" note (section 2) states as prose but does not itself mechanically enforce at the merge
boundary.
```
After:
```text
Before marking the PR ready, confirm Phase 2's curation-engine apply work has actually landed
(the ordering `wrap-up/curation-engine.md` section 2 states, enforced here).
```

**T4 — saves 102 B** (Conflict path's rationale for not needing a scratch worktree; the "no scratch-worktree ceremony" instruction is kept):

Before:
```text
  way — check out the branch, resolve, push — no scratch-worktree ceremony needed, since the
  conflict already surfaced inside the run's own real worktree, not a throwaway one.
```
After:
```text
  way — check out the branch, resolve, push — no scratch-worktree ceremony.
```

**T5 — saves 132 B** (Outcome vocabulary's retirement history; both pinned tokens kept, and a dangling "see Step 3.6" — no such step exists — goes with it):

Before:
```text
Replaces `ready-to-merge` (folded into `merged`/`armed` — see Step 3.6) and `pr-opened` (retired
— under pr-first the PR already exists from run start, so there is no longer a distinct
"finish reached, PR opened just now" transition to report).
```
After:
```text
Replaces `ready-to-merge` (folded into `merged`/`armed`) and `pr-opened` (retired — the PR
exists from run start).
```

Total: 275 + 230 + 128 + 102 + 132 = 867 B.

- [ ] **Step 1: Record the absence-grep controls**

Run: `git grep -n -F "the pre-#410 fast-lane path" -- plugin/skills/_shared/pr-first-merge.md`
Expected: one match (line 34) — proves the Step 4 absence grep form can match its target.

- [ ] **Step 2: Run the after-text check on today's tree**

Run: `git grep -n -F "before labeling silently drops acceptance sign-off." -- plugin/skills/_shared/pr-first-merge.md`
Expected: FAIL (exit 1 — today the sentence continues "sign-off the same way…", so the period-terminated after-text is absent).

- [ ] **Step 3: Apply cuts T1–T5 with Edit, each `before` → `after` verbatim**

- [ ] **Step 4: Verify bytes, absence, pins and headroom**

Run: `wc -c plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-checklist-refresh.md`
Expected: `pr-first-merge.md` exactly 36,182 (37,049 − 867 if no sibling change landed; the delta must be exactly −867); record `pr-checklist-refresh.md`'s size in the report.

Run: `git grep -n -F "the pre-#410 fast-lane path" -- plugin/skills/_shared/pr-first-merge.md`
Expected: FAIL (exit 1). Repeat with `two-thread split`, `mechanically enforce at the merge`, `not a throwaway one`, `PR opened just now` — each exit 1.

Run: `node --test tests/pr-first-merge.test.js`
Expected: PASS, 0 failures.

Run: `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" docs/superpowers/plans/2026-11-12-ci-gate-record.md --repo-root "<worktree>"`
Expected: in the first stdout line's JSON, every `headroom.composed[*].max` is 50,828 (51,695 − 867, or lower by the same 867 B against a moved baseline) and `over` is 0. Read only `headroom`.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/skills/_shared/pr-first-merge.md
git -C "<worktree>" commit -m "Trim restated rationale from pr-first-merge.md — 867 B of history the appendix and cited files already hold" -m "Refs #5160"
```

---

### Task 6: Step 2.5 calls the writer at both verdicts

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 2.5: lines 127, 131, 137, after the table at 200, Red path item 2 after 268 — line numbers as of `2771d7929`; Task 5's cuts T1–T3 at lines 10-45 shift them up by 7 lines; locate each by its quoted text)
- Create: `tests/ci-gate-record-prose-conformance.test.js`
- Test: `tests/merge-verification-gate-conformance.test.js` (unchanged — must stay green)
- Test: `tests/session-tmp-root-migration.test.js` (unchanged — its `COMBINED_RESOLVE` is an `includes` substring pin, so appending `GATE_START=…` to the end of that line keeps it green)
- Read (unchanged): `plugin/bin/ci-gate-record.js` (`parseArgs`, `VERDICTS`)

**Interfaces:**
- Consumes: `parseArgs`, `VERDICTS` from Task 3; the byte headroom from Task 5.
- Produces: the Step 2.5 prose below.

**Size — the binding limit is the composed `merge` bundle, not the file** (see the header's Byte budget). After Task 5, `pr-first-merge.md` is 36,182 B and the bundle 50,828 B. The five edits below add exactly **848 B** (measured with `Buffer.byteLength` over the verbatim text at authoring), so the file becomes 37,030 B and the bundle ≈ 51,676 B, leaving ≈ 824 B — the orchestrator's floor is 380 B, i.e. bundle `max` ≤ 52,120 B. The text stays compact anyway (no `(#5160)` tag, no `{run-dir}` gloss — the existing per-merged-run rule at lines 109-112 governs `$PIPELINE_RUN_DIR` — and no `auto-decision-log.md` citation) because #5161 adds a sentence to this file next. Do not add bytes beyond the verbatim text. If a sibling record has grown either source so the Step 4 rail check reads `max` > 52,120, revert the edits and report BLOCKED — never trim other prose to fit. No per-file byte pin exists (decision 0024). Guard-shape probe at authoring: `tools/guard-refusals/shapes.js`'s `detectShapes` returns `[]` for the extended resolve line, the state-read fence with the epoch line, and the writer fence.

Ordering trace (Ordering-fix location check): the green call sits in Step 2.5 before Step 3's `gh pr merge`; the Red path never merges; Step 4.2's archive (`pr-first-merge-post-merge.md`) runs only after outcome `merged`. Between the call and the archive the only writers of `events.jsonl` are hooks via `appendEvent` (append-only, no conflict). The epoch line runs in the state-read fence, so every entry into Step 2.5 from the top (a re-entry, a Red-path resume) overwrites it; both call sites run later in the same pass. Step position: the run dir and worktree still exist at both sites (nothing in Step 2.5 removes them). Deictic: edit 5's "that CI-gate record call" refers to edit 4's paragraph, which sits above the Red path (after line 200 vs. 251). Degrade-clause convention: the `SKIP` line follows `_shared/auto-decision-log.md`'s SKIP status (not cited inline, for bytes).

Exact edits (copy verbatim):

1. Line 127: `` `PR_CHECKS`/`PR_RUNS`/`PARK_COMMENT`/`PR_READY` literals for `{pr-checks-path}`/`{pr-runs-path}`/`{park-comment-path}`/`{pr-ready-path}` `` → `` `PR_CHECKS`/`PR_RUNS`/`PARK_COMMENT`/`PR_READY`/`GATE_START` literals for `{pr-checks-path}`/`{pr-runs-path}`/`{park-comment-path}`/`{pr-ready-path}`/`{gate-start-path}` ``.
2. Line 131: append ` GATE_START=gate-start-{n}.txt` to the end of the `session-tmp-resolve.js` line.
3. Line 137 (the state-read fence's `gh pr view … statusCheckRollup` line): add a second line inside the same fence, directly after it: `date +%s > "{gate-start-path}"`. The fence must still open with `` ```bash\ngh pr view `` (`tests/session-tmp-root-migration.test.js` anchors on it).
4. After the per-value table (after line 200, before `**Bounded watch`), insert:

````markdown
**CI-gate record.** Once per gate pass, on **green** before Step 3:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ci-gate-record.js" --pr {pr-number} --head-sha {headRefOid} --verdict green --gate-start-epoch "$(cat "{gate-start-path}")" --run "$PIPELINE_RUN_DIR" --repo {owner}/{repo}
```

A non-zero exit logs `SKIP {HH:MM:SS} — Step 2.5 (merge-verification gate): ci-gate not recorded ({error})` and the merge path continues unchanged — the writer never gates a merge. A Red-path resume is a new gate pass with its own call. Dispatch close-out skips this step, so records nothing; so do armed, explicit-`off` and read-failure outcomes.
````

5. In Red path item 2, after the parenthetical paragraph ending `` the comment's `{value}`/`$VALUE` is `derived off`.) `` (line 268), insert a line indented three spaces: ``   Then that CI-gate record call with `--verdict timeout-park` for `checks-pending-timeout`, else `--verdict red`.``

- [ ] **Step 1: Write the failing conformance suite**

`tests/ci-gate-record-prose-conformance.test.js`, reading `pr-first-merge.md` via `readText`, slicing Step 2.5 between `## Step 2.5: Merge-verification gate` and `## Step 3:` (assert both indexes `!== -1` before slicing), and the Red path region between `**Red path — never merge; park.**` and `**Log the armed outcome too**` (same assertion). One helper `ciGateFacts(text) -> string[]` built with `missingFactsOf` from `tests/helpers/conformance-asserts.js`, each pattern matching exactly once in its region:

| Fact | Pattern (region) |
|---|---|
| `resolve` | `/session-tmp-resolve\.js" [^\n]*GATE_START=gate-start-\{n\}\.txt/` (Step 2.5) |
| `epoch` | `` /statusCheckRollup\r?\ndate \+%s > "\{gate-start-path\}"\r?\n```/ `` (Step 2.5 — pins the line inside the state-read fence) |
| `green-site` | `/Once per gate pass, on \*\*green\*\* before Step 3:/` (Step 2.5) |
| `green-call` | `/```bash\r?\nnode "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ci-gate-record\.js" [^\n]*--verdict green[^\n]*\r?\n```/` (Step 2.5) |
| `red-mapping` | ``/`--verdict timeout-park` for `checks-pending-timeout`, else `--verdict red`/`` (Red path) |
| `skip` | ``/A non-zero exit logs `SKIP \{HH:MM:SS\} — Step 2\.5 \(merge-verification gate\): ci-gate not recorded \(\{error\}\)` and the merge path continues unchanged — the writer never gates a merge/`` (Step 2.5) |
| `resume` | `/A Red-path resume is a new gate pass with its own call\./` (Step 2.5) |
| `close-out` | `/Dispatch close-out skips this step, so records nothing;/` (Step 2.5) |
| `no-verdict` | ``/so do armed, explicit-`off` and read-failure outcomes\./`` (Step 2.5) |

```js
test('AC8.1: Step 2.5 carries the epoch capture, the green call and the Red-path verdict-by-reason mapping')  // ciGateFacts(live) deepEqual []
test('AC8.1: both call sites follow the epoch capture and precede Step 4')
  // epochAt < greenAt, epochAt < redMappingAt, both < text.indexOf('## Step 4 and Step 5') (assert each !== -1)
test('AC8.1: the green fence parses through ci-gate-record.js parseArgs as verdict green')
  // replace "$(cat "{gate-start-path}")" → 1000, {pr-number} → 123, {headRefOid} → 'a'*40, "$PIPELINE_RUN_DIR" → /tmp/r, {owner}/{repo} → o/r;
  // split on spaces; parseArgs(argv.slice(2)) has no error, verdict 'green', gateStartEpoch 1000
test('AC8.1: every verdict the Red path names is one ci-gate-record.js accepts')       // timeout-park, red ∈ VERDICTS
test('AC9.2: the SKIP sentence states the writer never gates a merge')                  // 'skip' fact present
test('AC8.2 AC9.2 go-red: removing each fact returns exactly that fact')               // assertEachPatternGoesRed(live, patterns, ciGateFacts)
test('AC8.2 go-red: the epoch capture moved after the Red path fails the ordering pin')
  // mutated = live minus the epoch span, re-inserted after the Red path region; notEqual; throws /epoch.*precede/
test('AC8.2 go-red: a renamed flag in the green fence fails the parseArgs pin')         // --head-sha → --sha; throws /parseArgs/
test('AC8.2 go-red: swapping the mapping (red for checks-pending-timeout) returns exactly red-mapping')
```

- [ ] **Step 2: Run the suite on today's tree**

Run: `node --test tests/ci-gate-record-prose-conformance.test.js`
Expected: FAIL (the suite file does not exist; after Step 1, every fact is missing from today's prose).

- [ ] **Step 3: Apply the five prose edits above**

Then `wc -c plugin/skills/_shared/pr-first-merge.md` and record the number in the task report (expected exactly 37,030 after Task 5 if no sibling change landed; this task's delta must be exactly +848).

- [ ] **Step 4: Run the suite, the neighbouring pins, and the composed-bundle rail check**

Run: `node --test tests/ci-gate-record-prose-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/session-tmp-root-migration.test.js`
Expected: PASS, 0 failures.

Run: `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" docs/superpowers/plans/2026-11-12-ci-gate-record.md --repo-root "<worktree>"`
Expected: in the first stdout line's JSON, every `headroom.composed[*].max` is ≤ 52,120 (≥ 380 B headroom; ≈ 51,676 expected) and `headroom.breaches` is `[]` (read only `headroom`; `checkC` findings are expected now that earlier tasks are built). Any `max` > 52,120 → revert the prose edits, report BLOCKED with the measured `max`.

- [ ] **Step 5: Commit**

```bash
git -C "<worktree>" add plugin/skills/_shared/pr-first-merge.md tests/ci-gate-record-prose-conformance.test.js
git -C "<worktree>" commit -m "Record CI wall time at Step 2.5's verdicts — epoch capture, green and Red-path writer calls" -m "Refs #5160"
```

---

### Task 7: Document the writer and the CI gate line, and probe a real run

**Role:** integration

**Files:**
- Modify: `docs/plugin-structure.md:214` (insert one command line after the `write-run-artifact.js` line)
- Modify: `plugin/skills/_shared/timing-render.md:21` (one sentence after the run-wide lines paragraph)
- Test: `tests/timing-prose-conformance.test.js` (unchanged — must stay green)
- Run (unchanged): `plugin/bin/ci-gate-record.js`, `plugin/bin/phase-timing.js`

**Interfaces:**
- Consumes: Task 3's CLI and Task 4's render.
- Produces: docs only.

Exact text. `docs/plugin-structure.md`, new line after line 214:
`` node plugin/bin/ci-gate-record.js --pr <n> --head-sha <sha> --verdict green|red|timeout-park --gate-start-epoch <seconds> --run <run-dir> [--repo <owner/repo>]   # CI-gate writer (#5160) — _shared/pr-first-merge.md Step 2.5 calls it at the green verdict and in the Red path; re-reads the head runs (`gh run list --commit`, 15 s bound) and appends one `ci-gate` event to {run-dir}/events.jsonl (ciWallMs = latest updatedAt minus earliest createdAt over completed runs, pendingAtBound for timeout-park), confirmed by re-read; derive.js turns it into totals.ciWallMinutes and ciGate[]; exit 0 written (prints the events.jsonl path), 2 malformed invocation or unreadable gh output, 3 run dir missing or not anchored under the main checkout, or the event not confirmed ``

`timing-render.md`, after line 21's paragraph, a new paragraph:
`` When the run recorded a merge-gate event (`ci-gate-record.js`, #5160), one `CI gate: {verdict}, {minutes} min wall[ (lower bound)], gate waited {minutes} min (PR #{n})` line per PR renders verbatim after the table and its run-wide lines; `n/a` is a value the gate could not record, never a zero. A summary rendered before the merge has no such line. ``

- [ ] **Step 1: Record the absence-grep control**

Run: `git grep -n -F "write-run-artifact.js" -- docs/plugin-structure.md`
Expected: matches (line 214 and others) — proves the Step 2 grep form can match its target.

- [ ] **Step 2: Run the docs check on today's tree**

Run: `git grep -n -F "ci-gate-record.js" -- docs/plugin-structure.md plugin/skills/_shared/timing-render.md`
Expected: FAIL (exit 1, no match today).

- [ ] **Step 3: Apply both doc edits**

- [ ] **Step 4: Verify the docs and the timing contract pins**

Run: `git grep -n -F "ci-gate-record.js" -- docs/plugin-structure.md` then `git grep -n -F "ci-gate-record.js" -- plugin/skills/_shared/timing-render.md` (each must match), then `node --test tests/timing-prose-conformance.test.js`
Expected: one match each; PASS, 0 failures.

- [ ] **Step 5: Real-input probe with an independent count**

Resolve the slug as the prose's caller holds it: `gh repo view --json nameWithOwner -q .nameWithOwner`. Write a scratch script (scratchpad only) that builds a tmp fixture main checkout (`main/.git` directory, `main/.claude-tweaks/pipelines/2026-11-12T120000-probe-5160`), calls `require('<worktree>/plugin/bin/ci-gate-record.js').run(['--pr','5240','--head-sha','581984e2269cf20b48ae17afcacf1e9e9416ed29','--verdict','green','--gate-start-epoch', String(Math.floor(Date.now()/1000) - 300),'--run', runDir,'--repo', slug], { ...realDeps, cwd: () => main, mainRoot: main })` with the **real** `gh`, then spawns `phase-timing.js --run <runDir> --markdown`. Independent count: run `gh run list --commit 581984e2269cf20b48ae17afcacf1e9e9416ed29 --limit 100 --json createdAt,updatedAt,status` and compute max `updatedAt` minus min `createdAt` by hand. At authoring that was `09:33:04Z − 09:12:45Z = 1,219,000 ms → 20.3 min`. Pin: exit 0, `ciWallMs === 1219000` (or the reconciled hand count if a run was re-attempted since), the stdout line `CI gate: green, 20.3 min wall, gate waited 5 min (PR #5240)`. Write the full output to `$PIPELINE_RUN_DIR/evidence/ci-gate-real-input.txt` (after `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, plain redirect, absolute path) and log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, `{text-file}` holding one line naming AC2.1/AC7.1 (real-input), the command shape, the hand count vs the writer's `ciWallMs`, and the evidence path.

- [ ] **Step 6: Commit**

```bash
git -C "<worktree>" add docs/plugin-structure.md plugin/skills/_shared/timing-render.md
git -C "<worktree>" commit -m "Document ci-gate-record.js and the CI gate timing line — command reference and render contract" -m "Refs #5160"
```

---

## Coverage map

| Spec item | Task / test |
|---|---|
| AC1.1, AC1.2, AC1.3 | Task 3 (per-verdict tests, gateWaitMs test) |
| AC2.1, AC2.2, AC2.3, AC2.4 | Task 3; AC2.1 real-input in Task 7 Step 5 |
| AC3.1, AC3.2 | Task 3 |
| AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.7, AC4.8 | Task 2 (probe) → Task 3 (CLI refusals) |
| AC5.1, AC5.2, AC5.3, AC5.4 | Task 4 |
| AC6.1 | Task 1 (golden, committed first) + Task 4 (derive half, golden re-run) |
| AC7.1, AC7.2, AC7.3, AC7.4 | Task 4 |
| AC8.1, AC8.2 | Task 6 |
| AC9.1 | Task 3 |
| AC9.2 | Task 6 |
| Deliverable: writer CLI, event shape, `ciWallMs` rule | Task 3 |
| Deliverable: derive.js keys | Task 4 |
| Deliverable: phase-timing render line | Task 4 |
| Deliverable: Step 2.5 epoch + two call sites + SKIP + close-out gap + re-entry | Task 6 (headroom from Task 5's trim) |
| Deliverable: probe `resolveTarget` first | Task 2 |
| Deliverable: reader invariance with/without `ciWallMinutes` | Task 1 |
| Deliverable: tests (CLI, derive, render, conformance) | Tasks 3, 4, 5 |

Waived AC4.6: a statement of scope (mount/scheme prefixes, uppercase schemes and percent-encoding do not apply to a filesystem path), not a behavior; AC4.7's URL-looking case (C6) is its testable half.

Waived plugin/bin/lib/hooks/context.js: read-only — Task 3 imports `appendEvent` unchanged (listed there as Read).
Waived plugin/bin/pr-checks.js: named only for rebase coordination with #5153/#5106; this record never edits or reads it (the writer makes its own `gh run list` read).
Waived tests/exit-code-conformance.test.js: the spec's path is wrong; the scan is `tests/bin-lib/exit-code-conformance.test.js`, run in the orchestrator's central full suite (Global Constraints).
Waived tests/gh-host-seam-conformance.test.js: repo-wide scan, unchanged, run in the orchestrator's central full suite; Task 3 follows its `ghOptions` rule (quoted).
Waived tests/bin-lib/timing/cli.test.js: unchanged; AC6's byte-identical half lives in Task 1's `golden.test.js` (re-run in Task 4), and the central full suite re-runs this suite after Task 4.
