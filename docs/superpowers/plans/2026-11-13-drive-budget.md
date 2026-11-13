# drive.js --budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `drive.js --budget <n|all>` selects records with the queue-pull module and ranking, keeps those the driver's per-record path admits, drives up to `n` of them one at a time in dispatch-drain order, and ends with one run-level summary event line.

**Architecture:** `run.js` parses `--budget` and, after the gh/git probes and the signal subscription, hands control to a new `plugin/bin/lib/driver/budget.js` (`runBudget`). `runBudget` reads policy through the table's own policy step, refuses on `express-driver: off` before any pull, then loops: pull (`deps.queuePull`), pre-screen every pulled record with the same eligibility call the eligibility step makes, rank (`deps.rankNext`) against the pull's exclusions plus in-memory `firing` entries, drive the top group's members one at a time through `driveRecordFacts` (a new export of `run.js` that returns `{ final, outcome, claimed, claimExit }` and leaves `driveRecord`'s return unchanged), count each handled record into exactly one counter, and stop on budget, `null` ranking, a claim stop (`claim-targets.js` exit 7, or exit 2 or 6 per Plan Review Clarification 1), or a failed pull. One summary line (step `budget`, a constant beside `FINAL_STEP`) closes the run.

**Tech Stack:** Node 18+ CommonJS, `node --test` (CI runs Node 20), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T061542-spec-5229/work/5229-spec.md` (record #5229). Design: `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, "Phase 5 — Queue selection in the driver".

**Scope keywords:** driveRecord, driveRecordFacts, parseArgs, STEP_NAMES, BUDGET_STEP, queuePull, rankNext, runBudget, evaluateRecordEligibility

## Global Constraints

Spec values, verbatim:

- `drive.js #N [#M…]` | `drive.js --budget <n|all>`; the two forms are exclusive.
- Run-level summary event: `{ ts, run: null, record: null, step: 'budget', status, ms, detail?, budget, driven, refused, skipped, contested, claimFailed, permissionStopped, ended }`; the step-name constant is added next to the others in `events.js` (added by #5218), with the pinning test updated in the same change.
- `ended` is one of `budget`, `exhausted`, `permission-stop`, `pull-failed`, `policy-refused`; `status` is `ok` for `budget`, `exhausted` and `policy-refused`; `stop` for `permission-stop`; `fail` for `pull-failed`. Plan Review Clarification 1 (user decision, Reading B) adds one value: `claim-stop`, status `stop`, for a claim that exits 2 or 6. The set is otherwise closed.
- Plan Review Clarification 1: `claim-targets.js` exit 6 (claims-registry branch missing, creation refused) and exit 2 (malformed invocation or missing dependency) end the run as exit 7 does. The record that hit it gets the Phase 1 settle for a failed claim (one comment and `bot:blocked`, no release call), and the rest of the budget is left unused. It is counted in `claimFailed`, never `permissionStopped`, and the summary carries `ended: claim-stop`. Exits 4 and 5, a killed claim, an exit 0 that claimed nothing, and a failed mint stay per-record `claimFailed`, and the loop continues.
- Plan Review Clarification 2 (user decision, Reading A): the queue-pull module's durable side effects are accepted as dispatch has them, with no module change. The target-missing and shipped passes log decisions and stage Close proposals into the newest `dispatch-standalone` run dir or an inherited `PIPELINE_RUN_DIR`, and the write-back pass rewrites the queue-order cache. `docs/driver.md`'s `--budget` section names them.
- Plan Review Clarification 3 (user decision, Reading A): there is no summary line on the exit-1 policy paths (an unreadable policy or a refused origin) or on an interrupt. There the hub reads the exit code, or the death by signal.
- Per-record return: `{ outcome, claimed, claimExit }` from the per-record path in `run.js`; `claimed` is true only when the claim was obtained and the run directory was minted, and `claimExit` is `claim-targets.js`'s exit code when the claim step ran.
- `claim-targets.js` exit codes (header of `plugin/bin/claim-targets.js`): 0 ok; 2 malformed or missing dependency; 3 contested or in flight; 4 transient; 5 unverified write; 6 claims branch missing; 7 permission denied.
- Exit codes (Combined-2, unchanged vocabulary): 0 the loop ended normally whatever each record's outcome (`budget`, `exhausted`, `permission-stop`, `claim-stop`, `policy-refused`); 1 unreadable policy or a failed pull; 2 usage error, `gh` or `git` absent, or an internal error.
- No change to `STEPS` and no new `STEP_NAMES` entry: `STEP_NAMES.length === 17` stays pinned in `tests/bin-lib/driver/run.test.js` (constants test) and `tests/bin-lib/driver/settle.test.js:218`.
- The loop calls `queuePull` and `rankNext` and never reorders, filters or re-derives selection beyond the pre-screen and the in-memory `firing` set. A selection defect found while testing is filed as its own record, never patched in the loop.
- No default budget, no new policy key, no change to the queue-pull module, no change to settle.
- The driver's stdout carries JSON event lines only: the module's own stdout output (Warnings, AUTO lines) is routed to `deps.stderr`.
- Consumer portability: budget.js holds no repository literal (branch, remote, owner/repo, label). The repo, main root and integration ref come from the policy step's `shared` values; the queue pull resolves its own integration branch.

Governing project skills, applicable rules quoted verbatim:

- `driver-step-addition`, Sites table:
  - "| `plugin/bin/lib/driver/events.js` `STEP_NAMES` | The step's name, at its table position. This list is the event vocabulary. Event fields may be added but never renamed, because the settle unit reads the final line's `stop` |" — applied by analogy: `BUDGET_STEP` is a run-level step name kept apart from `STEP_NAMES`, as `SETTLE_STEP_NAMES` is, and no existing field is renamed.
  - "| `plugin/bin/lib/driver/run.js` `newCtx` and `interruptClass` | Needed only for a new durable side effect. Initialize its flag in `newCtx`, and set it in the step once the effect exists. Then add a rung to `interruptClass` where its class falls in the ladder (`configWritten`, then `pushed`, then `runDir`, then `claimed`, else refused). Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one |" — `claimExit` is a recorded fact, not a durable side effect, so it is initialized in `newCtx` and gets no `interruptClass` rung.
  - "| `realDeps` in `run.js` | Each new external call, as a `deps` member with its own bound (see `gh-api-module-pattern`). A new gh-shaped kind states its reason beside it, as `ghBatch` and `ghCreate` do |" — `queuePull` and `rankNext` are lazy `deps` members; the module bounds its own gh calls (`isBatchGhCall`), which the comment beside them says.
  - "| `tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else." — the harness gains a `queuePull` kind with a default empty-queue reply.
  - "| `docs/driver.md` | Copied by hand, and no test reads it."
  - Anti-pattern: "| A step-name literal in `run.js` | It breaks the table-only contract, and `AC13.1` fails on it |" — budget.js obtains the policy step as `steps.find((s) => s.name === STEP.policy)`, never a quoted name.
- `gh-api-module-pattern` (SKILL.md):
  - "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)."
  - "Gate the origin before resolving policy: `integration-model`'s unset default probes `gh repo view`, so a gate that runs after a policy read is no gate (#5218)." — under `--budget` the policy step (which gates the origin) runs before the first pull.
- `gh-api-module-pattern/cli-wrapper-contract.md`:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract — an un-wrapped deps call is where #610's one post-review high landed." — `deps.queuePull` and `deps.rankNext` throws map to `pull-failed`, exit 1.
  - "`--help` short-circuits before any availability probe."
  - "*Combined-2* (`plugin/bin/link-records.js`): 0 success or partial-with-`failed`, 1 upstream resolution failure, 2 malformed invocation **or** missing dependency." / "Never mix them inside one family: a caller that branches on a sibling's codes reads the wrong branch silently."
  - "**Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done.**" — exit 1 gains "a failed pull" under `--budget`; Task 5 sweeps every statement.
  - "**Adding a flag that a CLI forwards into a library function needs one CLI-level test of the forwarding, and the same sweep of every restated command line.**" — Task 4 drives `--budget` (and `--no-settle --budget`) through `run(argv)`; Task 5 sweeps the restated command lines.
  - "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
  - "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.**"
- `bin-source-scan-conformance`:
  - Anti-pattern: "| An array literal of strings that starts with `'status'` or holds `'ls-files'`/`'ls-tree'`, whatever it means: a classifier `new Set([...])` of git subcommand names, a JSON-schema `required` list, a list of result-field names | The git scans read a bare list of literals as an argv, and they cannot tell a field name from a subcommand." — budget.js's `COUNTERS` list starts with `'driven'`; no array of event-field names is written out.
  - "| A scan with no floor on matched sites | A pattern that stops matching reports zero offenders, and that looks like a clean tree |" — the AC13.1 extension over budget.js keeps `codeOf` (shared stripper plus `stripperVerdict`) and a length floor.
  - Overview: "`tests/path-guard-conformance.test.js`: no bare `realpathSync`/`existsSync` outside the per-file allowlist." and "`tests/windows-hide-spawn-conformance.test.js`: every `child_process` call passes `windowsHide`." — budget.js makes no fs call and no spawn; every effect goes through `deps`. `realDeps.queuePull`/`rankNext` only `require` the module (no spawn at the call site).
- `headless-worker-launch`, Anti-pattern: "| Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list; derive the list instead (see `bin-source-scan-conformance`) |" — same constraint as above. The rest of the skill (worker rights, probes) does not apply: this unit launches no worker of its own.
- `claim-targets-stop-addition`:
  - "5. **Does the firing continue?** A cause specific to the record excludes it and moves on (`firing-exclusion.md`). A cause shared by every group, such as a token, ends the firing in every selection form, which brings in row 13." — exit 3 moves on (`contested`); exit 7 ends the run (`permission-stop`); exits 2 and 6 are causes every later record would meet too, so they end the run (`claim-stop`, Plan Review Clarification 1); exits 4 and 5 move on (`claimFailed`).
  - "A code exists because a consumer branches on it (`cli-wrapper-contract.md`'s bullets on domain exit codes)." — budget.js branches on 3, 7, and 2/6 only; every other claim failure is `claimFailed` and the loop continues. No `claim-targets.js` exit is added or re-routed, so the registration set (rows 1-13) does not apply.
- `parse-signal-discipline`:
  - "A function returns the same falsy value (`null`, `undefined`, `[]`, `false`) for two genuinely different situations: 1. **Doesn't apply.** … 2. **Couldn't parse.**"
  - "1. **Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't apply" — e.g. a tagged result (`{status: 'not-applicable'} | {status: 'unparseable', reason} | {status: 'ok', value}`), a sentinel distinct from your "doesn't apply" value, or a thrown/ caught error the caller handles separately."
  - "2. **Surface the unparseable case as a warning**, not a silent skip"
  - Applied twice: the pre-screen returns `'skip' | 'pass' | 'unparseable'` (unparseable passes through to the full path, never skips), and a failed or malformed pull is `pull-failed`, never an empty queue (`exhausted`).
- `dispatch-queue-exclusion-addition`: not applicable. This unit adds no exclusion reason and no pass; the `firing` entries are built in memory and handed to `rankNext`, never written to `dispatch-exclusions.json` (so the `appendExclusion` rule has no write to govern).

Source-scan sanctioned forms for code under `plugin/bin/`: no `fs.existsSync`/`fs.realpathSync` (route through `plugin/bin/lib/path-guard` if ever needed — this plan needs none); any spawn passes `windowsHide: true` literally (this plan adds none); no `process.exit` (drive.js already sets `proc.exitCode`).

## Review Focus

1. A signal (SIGINT/SIGTERM) that lands during a synchronous queue pull, or between two records, must end the run with no further pull, no further record and no summary line (the named-record rule "Nothing further is driven or emitted after an interrupt"). Owner: Task 4.
2. An unknown or SSH-alias origin under `--budget` must exit 1 at the policy step with no `queuePull` call and no `gh` call (the origin gate precedes the pull). Owner: Task 4.
3. A pull that returns a malformed shape (`groups` not an array of arrays) must end `pull-failed`, exit 1, never read as `exhausted`. Owner: Task 3.
4. `--no-settle --budget 1` must apply `--no-settle` to the driven record (final line `settle: left-to-caller` on a stop) and still emit the summary. Owner: Task 4.
5. The pre-screen must call `evaluateRecordEligibility` with exactly the options the live eligibility step passes, so the two never drift; and the module's stdout writes must never reach the driver's stdout. Owner: Task 2 (options helper) and Task 4 (stdout routing).

---

### Task 1: `--budget` argument parsing and usage text

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (parseArgs, USAGE)
- Modify: `plugin/bin/drive.js` (header comment)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: `parseArgs(argv)` → `{ help: true } | { error: string } | { records: number[], settle: boolean } | { budget: number | 'all', settle: boolean }`. The named-record shape is unchanged (no `budget` key), so the existing `deepEqual` pins in `parseArgs: #N or N…` and `AC4.4: parseArgs accepts --no-settle…` stay exact.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js`, after `AC4.4: parseArgs accepts --no-settle…`:

```js
test('budget AC2.1: a bad --budget value is a usage error with no call at all', async () => {
  for (const argv of [['--budget', '0'], ['--budget', '-1'], ['--budget', '1.5'], ['--budget', ''], ['--budget', 'abc'], ['--budget', 'ALL'], ['--budget', '01'], ['--budget']]) {
    const h = harness();
    assert.equal(await run(argv, h.deps), 2, JSON.stringify(argv));
    assert.match(h.err.join(''), /Usage: drive\.js #N/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.probes, 0);
    assert.deepEqual(h.out, []);
  }
});

test('budget AC3.1, AC3.2, AC3.3: --budget with a record, --budget twice, and neither form are usage errors', async () => {
  for (const argv of [['--budget', '2', '#12'], ['#12', '--budget', '2'], ['--budget', '2', '--budget', '3'], ['--budget', 'all', '--budget', 'all'], [], ['--no-settle']]) {
    const h = harness();
    assert.equal(await run(argv, h.deps), 2, JSON.stringify(argv));
    assert.equal(h.calls.length, 0);
    assert.equal(h.probes, 0);
  }
});

test('budget parseArgs: the accepted forms', () => {
  assert.deepEqual(parseArgs(['--budget', '3']), { budget: 3, settle: true });
  assert.deepEqual(parseArgs(['--budget', 'all']), { budget: 'all', settle: true });
  assert.deepEqual(parseArgs(['--no-settle', '--budget', '1']), { budget: 1, settle: false });
  assert.deepEqual(parseArgs(['--budget', '2', '--no-settle']), { budget: 2, settle: false });
  assert.deepEqual(parseArgs(['--budget', '0', '--help']), { help: true });
  assert.match(parseArgs(['--budget', '2', '#12']).error, /exclusive/);
  assert.match(parseArgs(['--budget', '2', '--budget', '3']).error, /more than once/);
});

test('budget usage: USAGE and the drive.js header state the --budget form and that --no-settle applies to each driven record', () => {
  const header = readText(DRIVE).split('\n').filter((l) => l.startsWith('//')).join('\n');
  for (const text of [USAGE, header]) {
    assert.match(text, /drive\.js \[--no-settle\] --budget <n\|all>/);
    assert.match(text, /--no-settle applies to each driven record/);
    assert.match(text, /with --budget, also a failed queue pull/);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="^budget" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 (`--budget` is an unknown option today, so `parseArgs(['--budget','3'])` returns an error and the usage regexes do not match)

- [ ] **Step 3: Implement `parseArgs`, `USAGE` and the drive.js header**

`parseArgs` walks argv by index. `--budget` takes the next element as its value: absent (last element) → error `--budget needs a value: a positive integer or all`; a second `--budget` → error `--budget given more than once`; value `all` → `'all'`; value matching `/^[1-9][0-9]*$/` and `Number.isSafeInteger` → that number; anything else (including `''`, `0`, `-1`, `1.5`, `01`, `ALL`) → error `--budget must be a positive integer or all, got: ${JSON.stringify(v)}`. After the walk: budget plus any record → error `--budget and a named record (#N) are exclusive`; budget alone → `{ budget, settle }`; no record and no budget → error `a record reference (#N) or --budget <n|all> is required`. `--help`/`-h` anywhere still wins first; `--no-settle` and record references are parsed as today.

USAGE: insert directly after the existing `--no-settle` line (the `AC4.4` test pins that adjacency and `AC10.6` pins line 0):
`'       drive.js [--no-settle] --budget <n|all>   (picks records from the dispatch queue and drives up to n of them, or all that are admitted; --no-settle applies to each driven record)'`.
Extend the three exit lines by appending, never rewording, so the `AC10.6` prefix regexes still match:
- 0: `…, whatever its outcome; with --budget, the loop ended normally (budget spent, queue exhausted, a claim stop on claim-targets.js exit 2, 6 or 7, or express-driver off), whatever each record's outcome`
- 1: `…and no further record is attempted; with --budget, also a failed queue pull`
- 2: `…or an internal error (run itself failed); a bad or repeated --budget value, or --budget with a named record`

Mirror the same usage line and exit-line extensions in `plugin/bin/drive.js`'s header comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS (the whole file: the existing `AC10.1`, `AC10.6`, `AC4.4` and `parseArgs` pins stay green)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/run.js plugin/bin/drive.js tests/bin-lib/driver/run.test.js
git commit -m "Parse drive.js --budget — usage errors before any probe, exclusive with named records"
```

### Task 2: Per-record facts for the budget loop

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (newCtx, driveRecord, new driveRecordFacts, exports)
- Modify: `plugin/bin/lib/driver/steps.js` (claimStep, eligibilityStep, new eligibilityOptions, exports)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: `driveRecordFacts(record, shared, deps, steps = STEPS)` → `Promise<{ final: object | null, outcome: string | null, claimed: boolean, claimExit: number | null }>`, exported from `run.js`. `outcome` is `final.outcome` (null when an interrupt landed before the first step); `claimed` is `ctx.claimed === true && typeof ctx.runDir === 'string' && ctx.runDir !== ''`; `claimExit` is `ctx.claimExit`.
- Produces: `eligibilityOptions(policy)` → `{ enabled: true, allowAbsentCeremony: true, integrationModel: policy['integration-model'].value, sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']) }`, exported from `steps.js`; the eligibility step calls it.
- Unchanged: `driveRecord(record, shared, deps, steps = STEPS)` still resolves to the final event (or null). Return-shape widening check: `git grep -n "await driveRecord(" -- tests` finds 12 assertions on `final.step`/`final.outcome`/`final.stop` (run.test.js lines 729, 741, 756, 772, 801, 1223, 1238, 1322, 2585, 2781, 2816, 3018); none is touched because the facts come from a separate export. No test asserts on `ctx`'s key set (`git grep -n "Object.keys(ctx" -- tests` is empty), so the new `claimExit` field defangs nothing.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js` (import `driveRecordFacts` from run.js and `eligibilityOptions` from steps.js beside the existing imports):

```js
const policyOnce = async (h) => { const shared = newShared(); await driveRecordFacts(1, shared, h.deps, [STEPS[0]]); return shared; };

test('budget AC4.1: a record whose claim was obtained and run dir minted counts as claimed, whatever its outcome', async () => {
  const cases = [
    [{}, 'pending-review'],
    [REDTESTS, 'express-escalated'],
    [{ script: [[on('node', /express-lane\.js$/, 'check'), { code: 1, stdout: '', stderr: 'boom' }]] }, 'blocked'],
    [{ script: [[on('node', /log-decision\.js$/), { code: 1, stdout: '', stderr: 'nope' }]] }, 'express-escalated'],
  ];
  for (const [over, outcome] of cases) {
    const h = harness(over);
    const shared = await policyOnce(h);
    const facts = await driveRecordFacts(7, shared, h.deps);
    assert.equal(facts.outcome, outcome);
    assert.equal(facts.claimed, true);
    assert.equal(facts.claimExit, 0);
    assert.equal(facts.final.step, FINAL_STEP);
  }
});

test('budget AC4.2: refused, contested, other claim failures and a failed mint are not claimed', async () => {
  const claimExit = (code) => ({ script: [[on('node', /claim-targets\.js$/), { code, stdout: '{}', stderr: '' }]] });
  const cases = [
    [{ admission: { admitted: false, reasons: ['no'] } }, 'refused', null],
    [claimExit(3), 'blocked', 3], [claimExit(4), 'blocked', 4], [claimExit(5), 'blocked', 5],
    [claimExit(6), 'blocked', 6], [claimExit(7), 'blocked', 7], [claimExit(null), 'blocked', null],
    [{ script: [[on('resolveRunDir'), { ok: false, message: 'no' }]] }, 'blocked', 0],
  ];
  for (const [over, outcome, exit] of cases) {
    const h = harness(over);
    const facts = await driveRecordFacts(7, await policyOnce(h), h.deps);
    assert.equal(facts.outcome, outcome, JSON.stringify(over));
    assert.equal(facts.claimed, false);
    assert.equal(facts.claimExit, exit);
  }
});

test('budget: driveRecord still resolves to the same final event driveRecordFacts carries', async () => {
  const a = harness(); const b = harness();
  const final = await driveRecord(7, await policyOnce(a), a.deps);
  const facts = await driveRecordFacts(7, await policyOnce(b), b.deps);
  assert.equal(final.step, FINAL_STEP);
  assert.deepEqual(Object.keys(final).sort(), Object.keys(facts.final).sort());
});

test('budget pre-screen: eligibilityOptions is exactly what the eligibility step passes', async () => {
  const h = harness();
  await run(['#7'], h.deps);
  const live = h.calls.find((c) => c.kind === 'eligibility').args[1];
  const shared = await policyOnce(harness());
  assert.deepEqual(eligibilityOptions(shared.policy), live);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="^budget AC4|^budget: driveRecord|^budget pre-screen" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 (`driveRecordFacts is not a function`)

- [ ] **Step 3: Implement**

- Re-read `plugin/bin/claim-targets.js`'s header and confirm exits 3 (contested or in flight) and 7 (permission denied) before relying on them (the spec's Gotcha). On a mismatch, stop and report.
- `steps.js` claimStep: right after `deps.node(...)` returns, set `ctx.claimExit = Number.isInteger(r.code) ? r.code : null`. Add `eligibilityOptions(policy)` and make the eligibility step call it; export both it and `STEPS` as today.
- `run.js`: `newCtx` gains `claimExit: null`. Move `driveRecord`'s body into an internal `driveWithCtx(record, shared, deps, steps)` that resolves to `{ final, ctx }`; `driveRecord` returns `.final`; `driveRecordFacts` maps per the Interfaces block. Export `driveRecordFacts`. No quoted step name enters run.js (AC13.1).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/run.js plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Expose per-record claim facts — driveRecordFacts returns outcome, claimed and claimExit"
```

### Task 3: The budget loop and its summary line

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/budget.js`
- Modify: `plugin/bin/lib/driver/events.js` (BUDGET_STEP, header comment)
- Create: `tests/bin-lib/driver/budget.test.js`
- Modify: `tests/bin-lib/driver/run.test.js` (constants test: the `BUDGET_STEP` pin)

**Interfaces:**
- Consumes: `driveRecordFacts` (Task 2) through the `driveOne` option; `eligibilityOptions(policy)` (Task 2); `STEPS`, `STEP`, `yieldToEventLoop`, `createEventSink`, `firstLine` from the driver modules; `formatTimestamp` from `../hooks/run-dir-resolve`.
- Produces (`events.js`): `BUDGET_STEP = 'budget'`, exported beside `FINAL_STEP`; not in `STEP_NAMES` or `SETTLE_STEP_NAMES`.
- Produces (`budget.js`):
  - `runBudget(budget: number | 'all', shared, deps, { driveOne: (n) => Promise<facts>, steps = STEPS })` → `Promise<0 | 1>`. `deps` members read: `date`, `now`, `stdout`, `stderr`, `appendFile`, `pid`, `env`, `queuePull(options, moduleDeps)`, `rankNext(groups, entries, opts)`, `evaluateRecordEligibility(issue, opts)`, plus whatever the policy step reads.
  - `ENDED` = frozen `{ BUDGET: 'budget', EXHAUSTED: 'exhausted', PERMISSION_STOP: 'permission-stop', CLAIM_STOP: 'claim-stop', PULL_FAILED: 'pull-failed', POLICY_REFUSED: 'policy-refused' }`; `STATUS_BY_ENDED` = frozen `{ budget: 'ok', exhausted: 'ok', 'permission-stop': 'stop', 'claim-stop': 'stop', 'pull-failed': 'fail', 'policy-refused': 'ok' }`.
  - `COUNTERS` = frozen `['driven', 'refused', 'skipped', 'contested', 'claimFailed', 'permissionStopped']`.
  - `CLAIM_STOP_EXITS` = frozen `[2, 6]` (Plan Review Clarification 1).
  - `classifyFacts(facts)` → one counter name: `claimed` → `driven`; else `claimExit === 7` → `permissionStopped`; else `claimExit === 3` → `contested`; else `outcome === 'refused' && claimExit === null` → `refused`; else `claimFailed` (exits 2, 4, 5, 6, 0-without-claim, a killed claim, a failed mint). Whether the run then ends is the loop's decision (step 7), not the counter's.
  - `preScreen(record, opts, deps)` → `{ verdict: 'skip' | 'pass' | 'unparseable', reasons: string[] }`: `unparseable` when the record is not an object, `body` is not a string or `labels` is not an array, or the eligibility call throws; else `skip` when `eligible !== true`, `pass` otherwise. The call passes `{ number, title, body, labels, state }` of the pulled record.

The loop (`runBudget`), in order:
1. `t0 = deps.now()`; a sink from `createEventSink({ stdout: deps.stdout, appendFile: deps.appendFile })`, never bound to a run dir.
2. Policy: `policyStep = steps.find((s) => s.name === STEP.policy)`; `result = await policyStep.run({ shared, record: null }, deps)`. On `status !== 'ok'`: emit `{ ts, run: null, record: null, step: STEP.policy, status: result.status, ms, detail }`, write `drive.js: ${detail}` to stderr, return 1 (no summary line). On `shared.policy['express-driver'].value === 'off'`: emit `{ …, step: STEP.policy, status: 'stop', detail: 'express-driver off: --budget drives nothing' }`, then the summary with `ended: policy-refused`, return 0. No pull, no module call, no file write on either path.
3. `sessionId = \`drive-${formatTimestamp(deps.date())}-${deps.pid}\`` (a per-invocation queue-pull session, so two budget runs never share session files); `attempted = new Set()` (ranking exclusion); counters all 0.
4. Loop: `await yieldToEventLoop()`; `if (shared.interrupted) return 0` (nothing further is emitted). Pull: `deps.queuePull({ transport: 'gh', sessionId, cwd: shared.mainRoot, env: deps.env, inputs: {}, omit: [] }, { stdout: deps.stderr, stderr: deps.stderr })`, inside try. A throw, or a result whose `groups` is not an array of arrays, or whose `exclusions` is not an array → stderr `drive.js: queue pull failed: ${firstLine(err.line || err.message)}`, summary `ended: pull-failed` with that text as `detail`, return 1. `await yieldToEventLoop()`; interrupt check again.
5. Pre-screen every member of every pulled group not already in `attempted`, once per record per invocation (memoize the verdict by number). A group whose every member is `skip` joins `attempted` now, each member counted `skipped`.
6. Rank: `deps.rankNext(groups, [...exclusions, { reason: 'firing', records: [...attempted] }], {})` inside the same try (a throw is `pull-failed`). `null` → summary `ended: exhausted`, return 0.
7. Add every member of the top group to `attempted`. For each member in group order: if `skip`, count `skipped` and continue; if `budget !== 'all' && counters.driven >= budget`, end `budget` (unprocessed members stay uncounted); `facts = await driveOne(n)`; then `await yieldToEventLoop()` before `if (shared.interrupted) return 0` (a signal queued during the record's last synchronous call is delivered only when the event loop turns, as run.js's named-record loop explains at its `yieldToEventLoop` after `driveRecord`; without this turn the loop would count the record and emit a summary under a pending signal); count `classifyFacts(facts)`; on `permissionStopped`, summary `ended: permission-stop` with `detail: claim-targets.js exit 7 on #${n}`, return 0; when `!facts.claimed && CLAIM_STOP_EXITS.includes(facts.claimExit)`, summary `ended: claim-stop` with `detail: claim-targets.js exit ${facts.claimExit} on #${n}`, return 0 (the record was already settled by the per-record path's claim row); after counting, if the budget is now spent, summary `ended: budget`, return 0 (no further pull).
8. Back to step 4.

Summary line: `{ ts, run: null, record: null, step: BUDGET_STEP, status: STATUS_BY_ENDED[ended], ms: deps.now() - t0, detail? , budget, ...counters, ended }` (field order as the Global Constraints line; `detail` only when set).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/budget.test.js`. A light fixture, no gh harness: `pulled(n, { priority = null, createdAt })` returns `{ number: n, title: \`r${n}\`, body: 'body', labels: [], state: 'OPEN', createdAt, facets: { priority } }`; `fake({ pulls, eligibility, facts })` returns `{ deps, calls, lines(), err }` where `deps.queuePull` records and returns the next pull (or the last one forever, or throws when the pull entry is an Error), `deps.rankNext` is the real `rankNext` from `plugin/bin/lib/dispatch/queue-pull.js`, `deps.evaluateRecordEligibility` defaults to eligible, and `driveOne(n)` records `n` and returns `facts(n)` (default `{ final: null, outcome: 'pending-review', claimed: true, claimExit: 0 }`). `policyStep` is a test table `[defineStep(STEP.policy, 'refused', async (ctx) => { ctx.shared.policy = POLICY_RESOLVED; ctx.shared.mainRoot = '/main'; return { status: 'ok' }; })]` passed as `steps`, with `POLICY_RESOLVED` holding `{ value }` entries for every key steps.js reads (`express-driver: 'on'`, `integration-model: 'pr-first'`, `merge-sensitive-paths: []`). Tests:

```js
test('AC1.1, AC1.2, AC1.3: --budget all drives the module-iterated order, restricted to admitted records', async () => {
  // high band: #11 older than #10 (a tie in the band); medium: bundle [20, 21, 22] whose first member admission refuses;
  // low: #30; no priority: #50; [40, 41] is oversized.
  const groups = [[pulled(10, { priority: 'high', createdAt: '2026-01-02T00:00:00Z' })], [pulled(11, { priority: 'high', createdAt: '2026-01-01T00:00:00Z' })],
    [pulled(20, { priority: 'medium', createdAt: '2026-01-03T00:00:00Z' }), pulled(21, { priority: 'medium', createdAt: '2026-01-04T00:00:00Z' }), pulled(22, { priority: 'medium', createdAt: '2026-01-05T00:00:00Z' })],
    [pulled(30, { priority: 'low', createdAt: '2026-01-01T00:00:00Z' })], [pulled(40, { priority: 'high', createdAt: '2025-01-01T00:00:00Z' }), pulled(41, { priority: 'high', createdAt: '2025-01-02T00:00:00Z' })],
    [pulled(50, { createdAt: '2025-06-01T00:00:00Z' })]];
  const exclusions = [{ reason: 'oversized', records: [40, 41], detail: { size: 2, threshold: 1 } }];
  // Expected: the dispatch Loop over the module — rank, take the top group, add it to firing, pull again.
  const reference = []; const firing = [];
  for (let g = rankNext(groups, exclusions, {}); g; g = rankNext(groups, [...exclusions, { reason: 'firing', records: firing.slice() }], {})) {
    for (const r of g) { reference.push(r.number); firing.push(r.number); }
  }
  const refused = new Set([20]);
  const f = fake({ pulls: [{ groups, exclusions }], facts: (n) => (refused.has(n) ? { final: null, outcome: 'refused', claimed: false, claimExit: null } : undefined) });
  assert.equal(await runBudget('all', newShared(), f.deps, { driveOne: f.driveOne, steps: f.steps }), 0);
  assert.deepEqual(f.driven(), reference, 'every handed record, in the reference order');
  assert.deepEqual(f.driven().filter((n) => !refused.has(n)), reference.filter((n) => !refused.has(n)));
  assert.ok(f.driven().indexOf(21) > f.driven().indexOf(20) && f.driven().indexOf(22) > f.driven().indexOf(21), 'the bundle is driven in its own order after a refused first member');
  assert.ok(!f.driven().includes(40) && !f.driven().includes(41), 'the oversized group is never driven');
});
```

Further tests in the same file, each asserting exactly the values named:
- `AC4.3: a record handled once is never selected again in this invocation` — static queue `[[#1],[#2]]`, `#1` refused: `driven()` is `[1, 2]`, `#1` once.
- `AC6.1, AC6.2: the same admission-refused record on every pull is attempted once` — static queue `[[#1]]` refused: `driven()` is `[1]`, `queuePull` called twice, summary `ended: exhausted`, `refused: 1`; the second `rankNext` call's entries hold `{ reason: 'firing', records: [1] }` (recorded inside the fake, asserted after the run).
- `AC6.3: an empty queue ends with zero driven` — `{ groups: [], exclusions: [] }`: summary `ended: exhausted`, `status: ok`, every counter 0, one pull, exit 0.
- `AC6.4: a top record the pre-screen rules out is skipped once and the run reaches the records below it` — static `[[#1 high], [#2 medium], [#3 low]]`, eligibility `eligible: false` for `#1`: `driven()` is `[2, 3]`, summary `skipped: 1`, `driven: 2`, `ended: exhausted`.
- `AC6.5: a queue that never shrinks still ends` — the same three records returned on every pull, all claimed: run ends with `driven: 3`, `queuePull` called exactly 4 times.
- `AC7.1: claim exit 7 ends the run with the rest of the budget unused` — `--budget 5` over `[[#1],[#2],[#3]]`, `#2` facts `{ outcome: 'blocked', claimed: false, claimExit: 7 }`: `driven()` is `[1, 2]`, summary `ended: permission-stop`, `status: stop`, `permissionStopped: 1`, `driven: 1`, exit 0.
- `AC8.1: a failed first pull is not an empty queue` — first pull throws `Object.assign(new Error('x'), { name: 'QueuePullStopped', line: 'dispatch: queue-pull stopped -- fetch failed' })`: exit 1, stderr names `dispatch: queue-pull stopped -- fetch failed`, summary `ended: pull-failed`, `status: fail`, `driven: 0`, `driveOne` never called.
- `AC8.2: a failed re-pull keeps what was driven` — pull 1 `[[#1]]`, pull 2 throws: exit 1, `driven()` `[1]`, summary `driven: 1`, `ended: pull-failed`.
- `pull-failed: a malformed pull is not an empty queue` (Review Focus 3) — `{ groups: 'x', exclusions: [] }` and `{ groups: [[{ number: 1 }], 'x'], exclusions: [] }`: exit 1, `ended: pull-failed`.
- `AC9.4, AC9.6: counters partition every handled record` — `--budget all` over singletons `#1…#6` with facts: `#1` claimed (`driven`), `#2` refused, `#3` exit 3 (`contested`), `#4` exit 5 (`claimFailed`), `#5` `{ outcome: 'blocked', claimed: false, claimExit: 0 }` (failed mint, `claimFailed`), `#6` pre-screen skip: summary exactly `{ budget: 'all', driven: 1, refused: 1, skipped: 1, contested: 1, claimFailed: 2, permissionStopped: 0, ended: 'exhausted', status: 'ok' }` and the sum of `COUNTERS` equals 6, the fixture's record count.
- `AC9.5: status follows ended` — `assert.deepEqual(STATUS_BY_ENDED, { budget: 'ok', exhausted: 'ok', 'permission-stop': 'stop', 'claim-stop': 'stop', 'pull-failed': 'fail', 'policy-refused': 'ok' })`, and every summary line in this file carries `step: BUDGET_STEP`, `run: null`, `record: null`.
- `PRC1: claim exits 2 and 6 end the run; exits 4 and 5 do not` — `--budget all` over `[[#1],[#2],[#3]]`; for each exit in `[2, 6]`, `#2` facts `{ outcome: 'blocked', claimed: false, claimExit: exit }`: `driven()` is `[1, 2]`, summary `ended: 'claim-stop'`, `status: 'stop'`, `claimFailed: 1`, `permissionStopped: 0`, `detail` matching `/exit ${exit} on #2/`, exit 0; for each exit in `[4, 5]`, `driven()` is `[1, 2, 3]` and `ended: 'exhausted'`.
- `AC11.1: a pulled record lacking a field the eligibility function needs passes through` — `#1` without `labels`, `#2` with `body: 42`: both reach `driveOne`, the eligibility fake is never called for them, `skipped: 0`. And `preScreen` returns `unparseable` when the eligibility call throws, and the record reaches `driveOne`.
- `budget: the module's stdout goes to stderr` (Review Focus 5) — a `queuePull` fake that calls `moduleDeps.stdout('Warning: x\n')`: `f.out` holds only JSON lines; `f.err` holds `Warning: x`.

In `tests/bin-lib/driver/run.test.js`'s `constants: step vocabulary…` test add: `assert.equal(BUDGET_STEP, 'budget'); assert.ok(!STEP_NAMES.includes(BUDGET_STEP) && !SETTLE_STEP_NAMES.includes(BUDGET_STEP) && BUDGET_STEP !== FINAL_STEP);` (import `BUDGET_STEP` from events.js). `STEP_NAMES.length` stays 17 there and in `settle.test.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/budget.test.js`
Expected: FAIL (`Cannot find module '…/plugin/bin/lib/driver/budget'`)

- [ ] **Step 3: Implement `budget.js` and `BUDGET_STEP`** per the Interfaces block and the loop above. Header comment: what the loop does, the counting rule (counts from the claim: `claimed` true consumes budget, nothing else does), the termination rule (every handled record and every all-skipped group joins the in-memory `firing` set, so no record is selected twice), and that the module's stdout is routed to stderr. `events.js`'s header: event lines carry `step` from `STEP_NAMES`, plus `FINAL_STEP` for a record's closing line and `BUDGET_STEP` for a `--budget` run's summary line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/budget.js plugin/bin/lib/driver/events.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/run.test.js
git commit -m "Add the --budget loop — pull, pre-screen, rank, drive, count, and one summary line"
```

### Task 4: Wire `--budget` into `run()` and prove it over the fake runner

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (run, realDeps)
- Test: `tests/bin-lib/driver/run.test.js` (harness, new tests, AC13.1 scan)

**Interfaces:**
- Consumes: `runBudget`, `ENDED`, `STATUS_BY_ENDED` (Task 3), `driveRecordFacts` (Task 2), `parseArgs`'s `{ budget, settle }` (Task 1).
- Produces: `run(argv, deps)` routes `{ budget }` to `require('./budget').runBudget(parsed.budget, shared, deps, { driveOne: (n) => driveRecordFacts(n, shared, deps) })`, lazily required, inside the existing try whose `finally` unsubscribes, after `shared.settle = parsed.settle`. `realDeps` gains `queuePull: (options, d) => require('../dispatch/queue-pull').queuePull(options, d)` and `rankNext: (groups, entries, opts) => require('../dispatch/queue-pull').rankNext(groups, entries, opts)`, with a comment that the module bounds its own gh calls (`isBatchGhCall`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js`. Harness: `deps.queuePull: (options, d) => dispatch('queuePull', [options, d])` with a `defaultScript` reply `[on('queuePull'), { groups: [], exclusions: [] }]`; `deps.rankNext` records `{ kind: 'rankNext' }` then calls the real `rankNext`. A fixture helper `queueOf(...numbers)` returns singleton groups of `{ number, title, body, labels: [{ name: 'risk:low' }], state: 'OPEN', createdAt: <ascending by position>, facets: { priority: null } }`. Tests:

```js
test('budget AC4.4: --budget 2 over refused, blocked, contested, pending-review, pending-review drives the second and fourth and leaves the fifth', async () => {
  const h = harness({
    admission: (c) => (c.args[0].number === 1 ? { admitted: false, reasons: ['no'] } : {}),
    script: [
      [on('queuePull'), { groups: queueOf(1, 2, 3, 4, 5), exclusions: [] }],
      [(c) => c.kind === 'node' && /express-lane\.js$/.test(c.args[0]) && c.args[1] === 'check' && c.args.includes('2'), { code: 1, stdout: '', stderr: 'x' }],
      [(c) => c.kind === 'node' && /claim-targets\.js$/.test(c.args[0]) && claimTarget(c) === 3, { code: 3, stdout: JSON.stringify({ contested: [3] }), stderr: '' }],
    ],
  });
  assert.equal(await run(['--budget', '2'], h.deps), 0);
  assert.deepEqual(finals(h).map((f) => [f.record, f.outcome]), [[1, 'refused'], [2, 'blocked'], [3, 'blocked'], [4, 'pending-review']]);
  const summary = h.lines().at(-1);
  assert.deepEqual({ ...summary, ts: 0, ms: 0 }, { ts: 0, run: null, record: null, step: 'budget', status: 'ok', ms: 0, budget: 2, driven: 2, refused: 1, skipped: 0, contested: 1, claimFailed: 0, permissionStopped: 0, ended: 'budget' });
  assert.ok(!h.calls.some((c) => c.kind === 'gh' && c.args[0] === 'issue' && c.args.at(-1) === '5'), 'no live fetch of #5');
  assert.ok(!h.calls.some((c) => c.kind === 'node' && /claim-targets\.js$/.test(c.args[0]) && claimTarget(c) === 5), 'no claim of #5');
  assert.equal(h.calls.filter((c) => c.kind === 'queuePull').length, 4);
});
```

Further tests, each asserting exactly the values named:
- `budget AC5.1, AC5.2: express-driver off reads policy first and drives nothing` — `harness({ policy: { 'express-driver': 'off' } })`, `run(['--budget', '2'])` → 0; no call of kind `queuePull`, `rankNext`, `gh`, `eligibility` or `node`; `h.writes()` is `[]`; `h.lines()` is exactly two lines: `{ step: 'policy', status: 'stop', record: null, run: null }` with `detail` matching `/express-driver off/`, then the summary with `ended: 'policy-refused'`, `status: 'ok'`, `budget: 2` and all six counters 0.
- `budget AC7.2: a claim permission stop settles the record by the claim row and ends the run` — queue `#1 #2 #3`, claim of `#2` exits 7: exit 0; `#2`'s settle made one `gh issue comment` and one `gh issue edit` adding `bot:blocked` and no `release-claim.js` call; no live fetch of `#3`; summary `ended: 'permission-stop'`, `status: 'stop'`, `permissionStopped: 1`, `driven: 1`.
- `budget AC8.3: an unreadable policy exits 1 with nothing driven` — `script: [[on('policy'), { 'express-driver': { error: 'unknown-key' } }]]`: exit 1; no `queuePull` call; no line with `step: 'final'`; no summary line.
- `budget AC8.1, AC9.2: a failed pull exits 1 through run()` — `[on('queuePull'), new Error('boom')]`: exit 1, stderr matches `/queue pull failed: boom/`, summary `ended: 'pull-failed'`.
- `budget AC9.1, AC9.3: exit 0 whatever the outcomes; exit 2 with gh or git absent` — the AC4.4 run returns 0; `harness({ ghAvailable: false })` and `harness({ gitAvailable: false })` with `['--budget', '1']` return 2 with zero calls.
- `budget AC11.1: a record the pre-screen skips gets no live fetch and no claim` — queue `#1 #2`; the eligibility reply returns `eligible: false` when `c.args[0].comments === undefined && c.args[0].number === 1`. That is the pre-screen call: the pre-screen passes only `{ number, title, body, labels, state }`, while the live eligibility step passes the fetched issue, which carries `comments` (steps.js `ISSUE_JSON_FIELDS` is `'number,title,body,labels,state,comments'`, and the harness's `issueFor` sets `comments: []`). Result: no `gh issue view … 1`, no claim of `#1`, `#2` driven, summary `skipped: 1`.
- `budget AC11.1: a pulled record with no labels or a non-string body takes the full path` — queue members `#1` without `labels`, `#2` with `body: 7`: both get a live `gh issue view` and a claim; `skipped: 0`.
- `budget PRC1: claim exit 6 ends the run` — `--budget all` over queue `#1 #2 #3 #4`, claim of `#2` exits 6 (`{ code: 6, stdout: '{}', stderr: '' }`): exit 0; `#2`'s settle made one `gh issue comment` and one `gh issue edit` adding `bot:blocked` and no `release-claim.js` call; no live `gh issue view` and no claim of `#3` or `#4`; one `queuePull` call per handled group (2); summary `ended: 'claim-stop'`, `status: 'stop'`, `claimFailed: 1`, `permissionStopped: 0`, `driven: 1`.
- `budget PRC1: claim exit 2 ends the run` — the same fixture with `#2`'s claim exiting 2: the same assertions.
- `budget AC9.5: ENDED and STATUS_BY_ENDED are the full closed mapping` — `assert.deepEqual(ENDED, { BUDGET: 'budget', EXHAUSTED: 'exhausted', PERMISSION_STOP: 'permission-stop', CLAIM_STOP: 'claim-stop', PULL_FAILED: 'pull-failed', POLICY_REFUSED: 'policy-refused' })` and `assert.deepEqual(STATUS_BY_ENDED, { budget: 'ok', exhausted: 'ok', 'permission-stop': 'stop', 'claim-stop': 'stop', 'pull-failed': 'fail', 'policy-refused': 'ok' })` (import both from `plugin/bin/lib/driver/budget.js`). This pin is the one `docs/driver.md` points at.
- `budget AC6.3: an empty queue ends exhausted through run()` — the default empty `queuePull` reply with `['--budget', 'all']`: exit 0; `h.lines()` is exactly one line, the summary, with `ended: 'exhausted'`, `status: 'ok'`, `budget: 'all'` and all six counters 0; no `gh` call.
- `budget: a signal queued during the last record's final synchronous call ends the run with no summary` (amendment 5; the shape of the existing `a signal queued during the last record's final synchronous call…` test) — `--budget 1` over queue `#1`, with the `pr-checks.js` reply calling `setImmediate(() => handler('SIGTERM'))` before returning green, and `onSignal` capturing `handler`: `terminate` was called once with `SIGTERM`; `#1`'s final line is its own (`pending-review`); no line has `step: 'budget'`. Without the loop's `yieldToEventLoop()` after `driveOne`, the loop counts `#1`, sees the budget spent and emits the summary, so this test goes red.
- `budget: --no-settle applies to each driven record` (Review Focus 4) — `REDTESTS` script plus `['--no-settle', '--budget', '1']`: the final line has `settle: 'left-to-caller'`, no settle call is made, the summary follows it.
- `budget: an unknown origin exits 1 before any pull` (Review Focus 2) — `harness({ remoteUrl: 'https://git.corp.invalid/acme/widgets.git', deps: { env: { GH_CONFIG_DIR: tmpDir('drive-budget-gh-config-') } } })` (the shape of the existing `an unresolvable main root, origin or integration ref is fatal` case) with `['--budget', '1']`: exit 1, a `policy` fail line whose `detail` matches `/origin host git\.corp\.invalid is not a known GitHub host/`, no `queuePull` and no `gh` call, and no line with `step: 'budget'` (Plan Review Clarification 3).
- `budget: a signal during the pull ends the run with nothing further` (Review Focus 1) — a `queuePull` reply that calls `h.signals[0]('SIGTERM')` and returns `queueOf(1)`: `terminate` recorded once with `SIGTERM`, no `gh issue view`, no summary line. A second case signals from inside `#1`'s check reply with queue `#1 #2`: `#1`'s final line is written, `#2` is never fetched, no summary line.
- Extend `AC13.1: STEPS names equal STEP_NAMES and run.js names no step` to scan `budget.js` too with `codeOf` (same regex loop), and add `budget.js` to the `codeOf self-test` floor loop with `codeOf(...).length > 1000`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="^budget AC4.4|^budget AC5|^budget AC6.3|^budget AC7|^budget AC8|^budget AC9|^budget AC11.1|^budget PRC1|^budget: --no-settle|^budget: an unknown|^budget: a signal" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 (`run(['--budget', …])` has no budget route yet: no summary line and no `queuePull` call)

- [ ] **Step 3: Implement the `run()` route and the two `realDeps` members** per the Interfaces block. `run()` keeps every check before the route (`--help`, usage, gh, git), so AC2/AC3 stay call-free.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/settle.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/run.js tests/bin-lib/driver/run.test.js
git commit -m "Route drive.js --budget to the budget loop — accounting, policy refusal and permission stop over the fake runner"
```

### Task 5: Document `--budget`

**Role:** integration

**Files:**
- Modify: `docs/driver.md`
- Modify: `docs/plugin-structure.md:76` (the `plugin/bin/lib/driver/` line), `docs/plugin-structure.md:189` (the `drive.js` command line), `docs/plugin-structure.md:278` (the driver test-suite line)
- Test: `tests/bin-lib/driver/run.test.js` (the plugin-structure pin)

**Interfaces:**
- Consumes: the names fixed in Tasks 1-4 (`BUDGET_STEP`, `ENDED`, `COUNTERS`, the USAGE text).

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/driver/run.test.js`, beside `AC11: docs/plugin-structure.md lists drive.js`:

```js
test('budget AC10.1: docs/plugin-structure.md names drive.js --budget and budget.js', () => {
  const doc = readText(DOC);
  assert.match(doc, /node plugin\/bin\/drive\.js --budget <n\|all>/);
  assert.match(doc, /budget\.js — `runBudget/);
  assert.match(doc, /budget\.test\.js/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="^budget AC10.1" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 (the doc does not name `--budget`)

- [ ] **Step 3: Write the docs**

- `docs/driver.md` "Running it": add `node plugin/bin/drive.js [--no-settle] --budget <n|all>` to the code block, and a bullet: `--budget` takes a positive integer or `all`, is exclusive with named records, may be given once, and `--no-settle` applies to each driven record. Exit-code table: 0 also covers a `--budget` loop that ended normally (`budget`, `exhausted`, `permission-stop`, `claim-stop`, `policy-refused`); 1 also covers a failed queue pull.
- New section "Picking records: `--budget`": selection (queue pull and `next` ranking from `plugin/bin/lib/dispatch/queue-pull.js`, a fresh pull per group, the grouping policy the module applies under `express-lane`, a bundle's members driven one at a time in bundle order); the pre-screen (the eligibility step's own call over the pulled record; may skip, never admits; a record missing `labels` or a string `body` takes the full path); the counting rule (a record consumes budget when its claim was obtained and its run directory minted, whatever its outcome; a refused, pre-screen-skipped or contested record, or a claim that fails any other way, consumes nothing); the termination rule (every handled record joins this invocation's `firing` set and is never selected twice; the run ends when the budget is spent, the ranking returns `null`, a pull fails, or a claim stop ends it: exit 7 gives `permission-stop`, and exit 2 or 6 gives `claim-stop`; in both cases that record gets the claim row's settle (one comment and `bot:blocked`, no release) and is counted in `permissionStopped` or `claimFailed`; exits 4 and 5 and a failed mint count `claimFailed` and the loop goes on); `express-driver: off` refuses before the pull. When no summary line is written: an unreadable policy or a refused origin exits 1 with no summary line, and an interrupt ends the process by its signal with no summary line; there the hub reads the exit code, or the death by signal. What the queue pull itself writes, accepted as dispatch has it: the target-missing and shipped passes log decisions and stage Close proposals into the newest `dispatch-standalone` run directory (or an inherited `PIPELINE_RUN_DIR`), and the write-back pass rewrites the queue-order cache; the pull's own session files sit under `os.tmpdir()`.
- "Event lines": the summary line (`step: "budget"`, `run` and `record` null) with a table of its fields (`budget`, the six counters, `ended`, `status`, `detail`), the `ended` → `status` mapping (six values, `claim-stop` included), that every handled record is in exactly one counter, that fields are added and never renamed (a consumer in another repository, the hub, reads this line), and that `tests/bin-lib/driver/run.test.js` pins the exit codes and the `ended` values (with `tests/bin-lib/driver/budget.test.js` for the loop).
- `docs/plugin-structure.md:189`: append the form `node plugin/bin/drive.js --budget <n|all>` with one clause on what it does, and extend the exit list as in Task 1's USAGE. `:76`: add `budget.js — \`runBudget(budget, shared, deps, { driveOne })\`, the \`--budget\` loop (#5229): …` and name `driveRecordFacts` in run.js's clause. `:278`: name `budget.test.js`.
- Exit-code and command-line sweep (cli-wrapper contract): run `git grep -n -i -E "drive\.js.*(exit|usage|#N)|exit.*drive\.js" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. Today it hits `.claude/skills/gh-api-module-pattern/SKILL.md:17` (origin gate, still true: no change), `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md:14` and `docs/journeys/find-a-stopped-driver-run-already-settled-5219.md:69` (named-record journeys, still true: no change); fix any other hit that states drive.js's exit codes or forms. `plugin/skills/_shared/policy-schema.md:100`'s `express-driver` row stays as is (its statement holds under `--budget`).

- [ ] **Step 4: Verify**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS

Run: `grep -c -F -e "--budget" -e "permission-stop" -e "claim-stop" -e "policy-refused" -e "claimFailed" docs/driver.md`
Expected: a count of at least 4 (AC10.1: the flag, the counting rule, the termination rule and the exit codes are on the page; `docs/driver.md` is pinned by no test, per the spec's Non-Goals). Control, run at plan time on the pre-change file: the same command printed `0`, so the count can fail.

- [ ] **Step 5: Commit**

```bash
git add docs/driver.md docs/plugin-structure.md tests/bin-lib/driver/run.test.js
git commit -m "Document drive.js --budget — counting, termination, exit codes and the summary line"
```

## Real-input probe (before the whole-branch review)

Read-only and drives nothing. Never run `drive.js --budget` itself.

A scratch script in the session scratchpad (never committed) that requires the worktree's `plugin/bin/lib/driver/run.js` (`realDeps`, `newShared`) and `budget.js` (`runBudget`), and calls `runBudget('all', shared, deps, { driveOne })` with:
- `deps = { ...realDeps, cwd: () => '<main checkout>', queuePull: (o, d) => realQueuePull(o, { ...d, queueOrder: { readOrder: <real>, writeOrder: () => ({ ok: true }) }, spawnCli: <real spawnCli, except these three, each recorded with its argv and answered { status: 0, stdout: '', stderr: '' } without spawning: 'stage-item.js'; 'log-decision.js'; and 'hooks.js' when its first argument is 'resolve-run-dir', whose empty stdout means no run dir resolves, so no decision is logged and no Close proposal is staged> }) }`, with `PIPELINE_RUN_DIR` deleted from the env passed to the pull. The pull then reads the live queue and writes nothing durable: no queue-order cache, no run-dir resolution, no decision line and no staged item. The only files it writes are its own scratch files: the session files and any temporary proposal text under `os.tmpdir()`, under the probe's own session id. List the recorded stub calls in the evidence: they are what a real `--budget` run would have written (Plan Review Clarification 2);
- `driveOne` a recording fake that pushes `n` and returns `{ final: null, outcome: 'refused', claimed: false, claimExit: null }`, so nothing is fetched, claimed or written and `--budget all` walks the whole queue;
- `shared.settle = false`.

Record: the summary line, the order of numbers the fake received, the number of pulls, and the pre-screen's skipped count. Independent count: over the first pull's `dispatch-groups.json` in the probe's session directory, a separate one-liner applies `evaluateRecordEligibility` with `eligibilityOptions(policy)` to every member of the groups that are not `oversized` or `neighbour-in-flight` in `dispatch-exclusions.json`, and counts eligible and ineligible records. The fake's received set must equal the eligible-or-unparseable set and `skipped` the ineligible count, unless the queue moved between pulls (name each differing record and why). Write the full output to `$PIPELINE_RUN_DIR/evidence/budget-probe.txt` (after `mkdir -p "$PIPELINE_RUN_DIR/evidence"`), and log one entry with `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text file holding one line naming AC1.1 and AC11.1, the command shape, the counts and the evidence path.

## Waivers

- Waived plugin/bin/claim-targets.js: read only, by Task 2 Step 3 (re-reading the header's exits 3 and 7, the spec's Gotcha); this unit does not change it.

Read-only modules, no change: `plugin/bin/lib/express/queue.js` (`expressQueuePolicy` is applied inside `queuePull`'s own `defaultDeps`; the driver passes no override, so the grouping is the one dispatch gets under the same `express-lane` value) and `plugin/bin/lib/express/eligibility.js` (called through `deps.evaluateRecordEligibility` by the pre-screen with `eligibilityOptions`).
- Waived plugin/skills/flow/claim-targets.md: read only; the exit meanings it states are confirmed against `claim-targets.js`'s header in Task 2 Step 3.
