# Dispatch → Driver Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/claude-tweaks:dispatch` hand a driver-admitted singleton to `drive.js` as one background Bash call — `drive.js --check #N` decides, `drive.js #N --run <dir> --no-settle --in-flight-prs <file>` builds inside the run directory and worktree dispatch already made, and the driver holds its own merge on a drain-PR overlap.

**Architecture:** Three driver CLI additions in `plugin/bin/lib/driver/` (a read-only verdict path over the existing head-of-table steps; an adopted-run mode guarded by a new `adopt.js`; a `merge-overlap` sub-step in `merge.js` before mark-ready), then one lazily read dispatch sub-file (`driver-route.md`) behind a one-sentence conditional pointer in `dispatch/SKILL.md`, trimmed to stay under the Read rail.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T173500-spec-5232/work/5232-spec.md` (record #5232)

**Scope keywords:** express-driver, drive.js, driver-route, in-flight-prs, MERGE_STEP_NAMES

## Global Constraints

- Every side effect in `plugin/bin/lib/driver/` goes through `deps`, except fs-only *reads* the run loop already makes directly (`mainCheckoutRoot`, as `policyStep` does); `adopt.js` follows that same exception and writes nothing.
- `drive.js --check #N` is read-only by contract: "if admission needs a fact only a write can produce, it reports the reason as unknown and refuses, never writes to find out" (spec Gotchas).
- `drive.js --check` exits 0 whenever it printed a verdict, admitting or refusing; a non-zero exit means no verdict could be computed (spec Technical Approach).
- `--run` refusals are exit 3 with nothing written, "as `log-decision.js` and `express-lane.js` use it" (spec Data / API Surface).
- Final event line: "fields may be added, never renamed" (spec Data / API Surface).
- No `sleep` while the driver runs; the route reads only the final event line (spec AC6).
- `dispatch/SKILL.md` must end ≤ 52,500 bytes (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`); target ≤ 51,500 (advisory, spec Technical Approach). It is 52,088 bytes at the merge base (`wc -c`), headroom 412 bytes.
- No skill-graph edge and no Subagent Contract site for the driver call: it is a Bash call (spec Non-Goals, Gotchas).
- `express-prompt.md`, `express-lane.js gate` and the prose express lane are unchanged (spec Non-Goals).
- Source-scan suites walk `plugin/bin/`: no bare `fs.existsSync`/`fs.realpathSync` outside `plugin/bin/lib/path-guard` — use `lstatType`/`canonicalRealpath` from `../path-guard` or `safeReal` from `../hooks/worktree-detect` (`tests/path-guard-conformance.test.js`); every `execFileSync`/`spawnSync` keeps `windowsHide: true`.
- Commit subjects: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer `https://claude.ai/code/session_01JHXvgUnUoUX1q7EQ4M7XY5`.

### Governing project skills (quoted verbatim)

From `.claude/skills/driver-step-addition/SKILL.md`:
- (Task 3) "**A sub-step vocabulary of its own.** The sub-step event names are a frozen list in `events.js` kept apart from `STEP_NAMES`, as `SETTLE_STEP_NAMES` is, because the pipeline-step list is pinned (`MERGE_STEP_NAMES`). The module's `emit` throws on a name not in it, `tests/bin-lib/driver/merge.test.js` asserts every emitted event's step is in it, and `docs/driver.md`'s "Event lines" paragraph lists the names by hand."
- (Task 3) "**No import from `steps.js`.** `steps.js` requires the module, so the reverse import is a require cycle."
- (Task 3) "**A result for every stop, never a throw.** `merge()` turns an unexpected throw into `pending-review` / `unclassified` naming the sub-step, so the step never halts and its class (`none`) covers only a throw in the entry itself."
- (Tasks 2, 3) "**One deps namespace with the driver.** The entry passes `{ ...deps, … }`, so a seam the module adds is a new member of run.js's `realDeps`. Grep `realDeps` for the name before choosing it … Add the member to `realDeps`, to `run.test.js`'s `harness` and to `merge.test.js`'s `mergeHarness`, then route one test through `realDeps`' own member … Every harness replaces the member, so without that test a broken `realDeps` wiring stays green (#5432 review)."
- (Tasks 1, 2) "| `tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else — except `git rev-parse`, which a catch-all `[onGit('rev-parse'), exitOne]` answers as absent (the leftover and settle probes rely on it). A new `rev-parse` read gets its own default reply placed before that catch-all, matched narrowly enough (its cwd, its flags) that the main checkout's `--quiet` probes keep their absent answer, as #5458's `isBranchRead` does. A new gh-shaped dep kind joins the kind list in `dispatch` that refuses `pr merge` and `pr ready` (AC8). …"
- (Tasks 1, 2) "Facts from the record's ctx … A fact a step records for the caller (`ctx.claimExit`, set by the claim step) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a recorded fact, not a side effect."
- (Task 1) "| A step-name literal in `run.js` | It breaks the table-only contract, and `AC13.1` fails on it |" — so `checkRecord` walks `CHECK_STEPS` and never names a step.
- (Tasks 1-3) "| `docs/driver.md` | Copied by hand. A few tests in `run.test.js` pin named rules in it (the `AC9.1` docs tests, and #5454's tree-stop test), so a change to a pinned rule's wording updates its test too; nothing checks the rest. …"
- (Task 3) "| Adding a second call of a shape existing tests script as `[match, reply]` | The harness answers every call an entry matches, so the new call gets the old reply … Move such entries to `nthCall(match, 1, reply)` |" — the new `gh pr view` reads must not be answered by an existing `pr view` entry in `mergeHarness`.

From `.claude/skills/gh-api-module-pattern/` (`SKILL.md`, `cli-wrapper-contract.md`, `call-bounds.md`, `run-dir-boundary-guards.md`):
- (Task 3) "A paginated list is a batch too: a `gh issue list` / `gh pr list` with `--limit` above 100, or a `gh pr list --json files` read, takes `GH_BATCH_TIMEOUT_MS`" — so the hold's `--json files` reads go through `deps.ghBatch`, never `deps.gh`.
- (Task 3) "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**" — use `ctx.repo` (the run's `shared.ghRepo`).
- (Tasks 2, 3) "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs` … each path-taking flag gets a relative-path case under an injected `cwd` that differs from the real one."
- (Tasks 1-3) "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.** … Validate the value inside `parseArgs` … — `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases."
- (Task 2) "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.** … inject it (`deps.cwd`, `deps.mainRoot`, `deps.isAnchored`) as you write it, and add the fake to every consuming test's deps object in the same commit." — so the guard is the `deps.adoptRun` seam (realDeps: `require('./adopt').adoptRun`), real-fixture tests pass the real function.
- (Task 2) "Import the copy that sits beside the writer you call … `claim-targets.js` (#2775) imports append.js's together with `appendEntry` — and pin the refusal with a fixture carrying both a real main-checkout run dir and a worktree-local shadow of it, asserting the shadow's file is byte-unchanged after the exit 3." "Take that split only when the new CLI's 3 is already spoken for; otherwise shape 3's exit 3 stands."
- (Task 2) "**Codes above the base vocabulary are per-CLI domain outcomes and are not portable.** … Spell each one out in that CLI's own `USAGE` and in the prose that branches on it" and "**Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done.**" — exit 3 is mandated by spec AC2; `drive.js`'s header states it beside Combined-2 and why no caller branches on it differently (`driver-route.md` reads every non-zero exit as `blocked`).
- (Task 3) "**A prose guard that keys on who is calling … becomes an explicit flag the prose passes, and the absent flag takes the safe route.**" — deliberate exception: spec AC9 fixes "With the flag absent no hold is applied, which is the standalone case of one record at a time"; the header says so and a test pins the absent case.
- (Task 1) "**A deps seam that must not be called on some path is pinned by counting calls, not by output parity**" — the `--check` no-write proof is an allow-list over every recorded call.
- (Task 3) "A successful parse is not a valid shape: check `value !== null && typeof value === 'object' && !Array.isArray(value)` before touching a field" — here: the parsed in-flight file must be an array, each entry validated.

From `.claude/skills/prose-code-twin-pin/SKILL.md`:
- (Task 4) "| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) when the two sides name the same closed vocabulary | Assert set equality both ways — a prose row with no code twin drifts as much as the reverse." — `driver-route.md`'s outcome words vs `OUTCOMES`.
- (Task 3) "When one vocabulary lives in three or more hand-kept places, list every pair. Pin each pair a real failure can travel along, or say why that pair cannot drift." — `MERGE_STEP_NAMES` vs `docs/driver.md`'s "Event lines" list gets a set-equality pin if none exists; `OUTCOMES` vs `docs/driver.md`'s "Outcome words" table is unchanged by this unit (no new outcome word).
- (Task 4) "An executing pin and a set-equality pin cover opposite halves of the same twin: write both" — the route's `drive.js` command lines are tokenized and fed through `parseArgs`.

From `.claude/skills/skill-prose-conformance-tests/SKILL.md` (+ `executable-snippet-pins.md`):
- (Task 4) "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- (Task 4) "**A clause pinned to its row or paragraph owes a move-out control, not only a deletion.**" — Closed rule rows and outcome rows.
- (Task 4) "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()` … Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)`"
- (Task 4) "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice." — the SKILL.md pointer sits inside `step5()`'s slice; re-run `STEP5_FACTS`' go-red controls.
- (Task 4) "| Pinning a templated CLI invocation in skill prose up to a value-taking flag's name, not its value | …" — pin `--run "{minted-run-dir}"` and `--in-flight-prs "{drain-prs}"` with their values.
- (Task 4) "| Pinning a semantic claim with a bare word needle (`includes('interactive')`) | A lookalike token elsewhere in the same haystack satisfies it, so the pin cannot go red." — absence pins use word-bounded regexes.
- (Task 4) "A fence added or reshaped for that change must also pass the worktree guard. … Put that suite in the targeted set for any change that adds or edits a fence" — `tests/skill-fence-guard-shapes.test.js` runs in Task 4.
- (all) "These suites go red at the *merge combination*, not on the branch … Re-merge `main` and run the full `npm test -- --full` immediately before merging"

## Review Focus

1. **A drain's first driver group** has no `dispatch-drain-prs.json` yet: the route must write `[]` to it before the call, or the driver fails closed and every first group lands `pending-review`. Pinned in Task 4's route facts.
2. **`gh pr view --json files` returns at most 100 files** per PR (GraphQL `files(first: 100)`): a 100-entry list may be truncated, so the hold treats exactly 100 as unreadable and holds. Pinned in Task 3.
3. **A listed drain PR that merged or closed since it was listed** is skipped, not held — the same "still open" rule `drain-pr-overlap.md`'s Step 6 applies, so the driver lane and the prose lane hold on the same set. Pinned in Task 3.
4. **The background output file's last line is the harness's exit marker** (`[exited with code N]`, after a blank line — probed at build, `decisions.md` "premise reversed"), not the driver's final event line: the route reads `tail -n 3` and takes the last line above the marker. Pinned in Task 4.
5. **An adopted worktree on a detached HEAD, or a run-dir path with spaces** (this repo's own checkout is under `Code Workspaces/`): the first is refused at the `--run` guard (exit 3, nothing written) because the driver needs a branch to push; the second must adopt normally. Pinned in Task 2.

## Decisions taken at plan time

- **Order of `--check` and the bind.** The spec's "Who does what, in order" lists the bind before `--check`, but its "Where the route sits" places the route before `sibling-session-check.md`'s bind, and the bind's form (with or without `--dispatch`) depends on the verdict — exactly why the express gate runs before the bind. So: mint → `drive.js --check` → admitted: bind without `--dispatch`, then `drive.js --run`; not admitted: fall through to the express gate (which still runs before the bind) or the normal path.
- **`--run` requires `--no-settle`.** Under `--run` the dispatch session settles; a settle by the driver would release the claim and close dispatch's run directory (`settle.js` rows `release-claim.js`, `hooks.js close-run`). A `--run` without `--no-settle` is a malformed invocation (exit 2) rather than a second settle racing dispatch's (spec Decision Rationale).
- **`--in-flight-prs` entries** are positive integers or objects carrying a positive-integer `number` (the `dispatch-drain-prs.json` shape `drain-pr-overlap.md` Step 5 writes), so the route passes that file directly and never composes JSON by hand.
- **Overlap is plain path equality** over the own PR's and each still-open listed PR's changed paths — AC9's "if any path is shared". `detectCrossPRFileOverlap`'s hub-path exclusion is not applied: it would let a shared hub path through, which AC9 does not allow.
- **Run-dir guard is stricter than `resolveTarget`:** after `resolveTarget` (realpath, `.git`-directory root equal to the main checkout), the real path's parent must equal `{main}/.claude-tweaks/pipelines`. The spec's own dot-segment example (`x/../../../elsewhere`) normalizes to `{main}/elsewhere`, which is still inside the checkout and passes `resolveTarget` alone.
- **Post-merge under `--run` keeps the worktree (decided by the user at plan review).** `express-prompt.md` forbids the express agent tearing the worktree down "on any outcome", and dispatch's worktree outlives the firing. Under `--run`, `merge.js`'s teardown keeps the adopted worktree and local branch; the remote-branch delete and `hooks.js close-run` still run (Task 3).
- **Near-duplicate hold (decided by the user at plan review).** The hold also ports `drain-pr-overlap.md` Step 6's #3520 near-duplicate half: `--near-dup-pairs <file>` (Task 3), passed by the route whenever the firing wrote `dispatch-near-dup-pairs.json` (Task 4).

---

### Task 1: `drive.js --check #N` — the read-only verdict

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/run.js` (`parseArgs`, `USAGE`, `run`, new `checkRecord`)
- Modify: `plugin/bin/lib/driver/steps.js` (eligibility and admission steps keep their reasons on ctx; export `CHECK_STEPS`)
- Modify: `plugin/bin/drive.js` (header usage and exit-code comment)
- Modify: `docs/driver.md` ("Running it": the `--check` form and its exit codes)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: `parseArgs(['--check', '#N'])` → `{ check: N }`; `checkRecord(n, shared, deps, steps = CHECK_STEPS) → Promise<0|1>`; stdout line `{"record":N,"admitted":bool,"reasons":[string,...]}\n`; `steps.CHECK_STEPS` (frozen array: policy, fetch, eligibility, admission step objects — the first four entries of `STEPS`); ctx fields `ctx.eligibilityReasons: string[]`, `ctx.admissionReasons: string[]`.

- [ ] **Step 1: Write the failing tests** (every new test name starts `#5232 `, so Step 2's name pattern selects only them) in `tests/bin-lib/driver/run.test.js`, all through `harness()` and `run([...], h.deps)`:
  - `#5232 AC1.1: --check prints one JSON line with the verdict and every reason` — admitted record #7: exit 0, `h.out.join('')` is exactly one line, parsed `{ record: 7, admitted: true, reasons: [] }`.
  - `#5232 AC1.1: --check on a refused record reports eligibility and admission reasons together` — `over.eligibility: { eligible: false, reasons: ['risk is not low'] }`, `over.admission: { admitted: false, reasons: ['record lacks auto:build'] }`: exit 0, `admitted: false`, `reasons` deep-equals `['risk is not low', 'record lacks auto:build']` (admission still runs after an eligibility refusal).
  - `#5232 AC4.1: --check under split admits an even record and refuses an odd one` — policy `'express-driver': 'split'`, `deps.evaluateAdmission` replaced by the real `require(path.join(LIB, 'driver', 'admission')).evaluateAdmission`, issue labels include `auto:build`: `#8` → `admitted: true`; `#7` → `admitted: false`, reasons include `'express-driver split: issue number is odd'`.
  - `#5232 AC1.1: --check refuses a local-merge project` — policy `'integration-model': 'local-merge'`, real `evaluateRecordEligibility` (`require(path.join(LIB, 'express', 'eligibility'))`): exit 0, reasons include `'integration-model is not pr-first'`.
  - `#5232 AC1.2: --check makes no write of any kind, for an admitted record and for each refused class` — over the four cases above plus an admission-refused-only case: every recorded call satisfies `isCheckRead(c)`, an allow-list helper accepting only `policy`, `gh issue view …`, `git symbolic-ref …`, `eligibility`, `native-deps`, `linked-prs`, `admission` calls; additionally `h.writes()` is empty and no call has kind `node`, `ghCreate`, `resolveRunDir`, `worker`, `writeFile`, `appendFile`, `mkdirSync`, `writeFileExclusive`.
  - `#5232 AC1.2 go-red: the write-free assertion fails on an injected claim call` — the same assertion function run over a copy of one case's calls with `{ kind: 'node', args: ['/x/claim-targets.js'] }` appended throws.
  - `#5232 AC1.1: --check with no computable verdict exits 1 and prints nothing` — policy reply with `integration-model: { error: 'boom' }` → exit 1, `h.out` empty, `h.err` names the step; `gh issue view` throwing → exit 1, `h.out` empty.
  - `#5232 --check grammar` — exit 2 for `['--check']`, `['--check', '#7', '#8']`, `['--check', '#7', '--no-settle']`, `['--check', '--budget', '1']`; `parseArgs(['#7', '--check'])` deep-equals `{ check: 7 }`.
  - `#5232 CHECK_STEPS is the head of STEPS` — `assert.deepEqual(CHECK_STEPS.map((s) => s.name), STEPS.slice(0, 4).map((s) => s.name))` and each entry is the identical object (`CHECK_STEPS[i] === STEPS[i]`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="#5232" tests/bin-lib/driver/run.test.js`
Expected: FAIL (`--check` is an unknown option; `CHECK_STEPS` is undefined)

- [ ] **Step 3: Implement**
  - `steps.js`: in `eligibilityStep` set `ctx.eligibilityReasons` to the refusal's `reasons` array (`[]` on eligible); in `admissionStep` set `ctx.admissionReasons = (verdict && verdict.reasons) || []` on both branches. Export `CHECK_STEPS = Object.freeze([policyStep, fetchStep, eligibilityStep, admissionStep])`.
  - `run.js` `parseArgs`: `--check` anywhere → check mode; exactly one record reference, no other option → `{ check: n }`; otherwise `{ error: '--check takes exactly one record reference (#N) and no other option' }`.
  - `run.js` `checkRecord`: walk `CHECK_STEPS` on `newCtx(n, shared)`; a `fail` status in any step, or a non-`ok` policy/fetch step → `deps.stderr('drive.js --check: {step} {status}: {detail}\n')`, return 1, nothing on stdout; otherwise print the one line and return 0. `run()`: after the gh/git probes, `if (parsed.check !== undefined) return checkRecord(parsed.check, newShared(), deps);` (before the signal subscription — the path is short and read-only).
  - `USAGE` and `drive.js`'s header gain `drive.js --check #N   (prints the admission verdict as one JSON line; no write of any kind)` and the `--check` exit rule (0 printed a verdict; 1 none could be computed; 2 malformed).
  - `docs/driver.md` "Running it": the `--check` form, its output line, its exit codes.
  - Before Step 4, grep `tests/` for suites that pin `USAGE` or drive.js's header text (`git grep -n -e "Combined-2" -e "drive.js --help" -e "USAGE" -- tests`) and update any that compare the exit-code lines.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/run.js plugin/bin/lib/driver/steps.js plugin/bin/drive.js docs/driver.md tests/bin-lib/driver/run.test.js
git commit -m "Add drive.js --check — the admission verdict as one read-only JSON line"
```

---

### Task 2: `drive.js #N --run <dir>` — adopt dispatch's run directory and worktree

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/adopt.js`
- Modify: `plugin/bin/lib/driver/run.js` (`parseArgs`, `USAGE`, `run`, `newShared` gains `adopted: null`)
- Modify: `plugin/bin/lib/driver/steps.js` (`claimStep`, `runDirStep`, `worktreeStep` branch on `ctx.shared.adopted`)
- Modify: `plugin/bin/drive.js` (header: `--run` form, exit 3)
- Modify: `docs/driver.md` ("Running it": `--run`, exit 3; "When a run stops": what `--run --no-settle` leaves)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: Task 1's `parseArgs` shape.
- Produces: `parseArgs(['#7', '--run', d, '--no-settle'])` → `{ records: [7], settle: false, runDir: d }` (the `runDir` key — and Task 3's `inFlightPrsFile` — present only when its flag was given, so every existing `parseArgs` deep-equal stays as it is; `parseArgs` returns the raw value, `run()` resolves it); `adoptRun({ runDir, cwd }, deps) → { ok: true, runDir: string, runId: string, wt: string, branch: string, mainRoot: string } | { ok: false, why: string }` in `adopt.js`; `shared.adopted` holds the ok result for the run.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js` (every new test name starts `#5232 `). Build a real fixture once: `ADOPT_MAIN = tmpDir('drive adopt main-')` (the space is deliberate — Review Focus 5) with a `.git` directory and `.git/worktrees/w/`; `ADOPT_WT = {ADOPT_MAIN}/.claude/worktrees/w` holding a `.git` *file* `gitdir: {ADOPT_MAIN}/.git/worktrees/w`; `ADOPT_RUN = {ADOPT_MAIN}/.claude-tweaks/pipelines/2026-11-15T000000-spec-7` (a directory). Each guard test runs `run(['#7', '--run', P, '--no-settle'], h.deps)` with `h.deps.cwd` returning the named cwd and asserts the same `assertRefusedNothingWritten(h, code)`: exit 3, `h.out` empty, `h.writes()` empty, no `node`, `ghCreate`, `worker` or `git` call recorded, `h.err` starts with `drive.js: --run refused:`. One test each:
  - `#5232 AC2.2, AC2.10: a missing run directory is refused` — `{ADOPT_RUN}-absent`.
  - `#5232 AC2.4, AC2.10: a dot-segment path is refused once normalized` — `{ADOPT_MAIN}/.claude-tweaks/pipelines/x/../../../elsewhere` with `{ADOPT_MAIN}/elsewhere` created as a directory (inside the checkout, but not a run directory), and a second path with four `..` segments ending outside the checkout at a created directory.
  - `#5232 AC2.5, AC2.10: the same path with a trailing slash is refused` — both dot-segment paths plus `/`.
  - `#5232 AC2.6, AC2.10: a symlink under the pipelines directory that resolves outside the checkout is refused` — `fs.symlinkSync(OUTSIDE, {ADOPT_MAIN}/.claude-tweaks/pipelines/link)`.
  - `#5232 AC2.7, AC2.10: a worktree-local shadow pipelines directory is refused` — `{ADOPT_WT}/.claude-tweaks/pipelines/2026-11-15T000000-spec-7` (created).
  - `#5232 AC2.8, AC2.10: a path holding the main checkout's path as a substring of another component is refused` — `{ADOPT_MAIN}-evil/.claude-tweaks/pipelines/2026-11-15T000000-spec-7`, `{ADOPT_MAIN}-evil/.git` a directory.
  - `#5232 AC2.2, AC2.9, AC2.10: a working directory that is the main checkout itself is refused` — valid `ADOPT_RUN`, cwd `ADOPT_MAIN`.
  - `#5232 Review Focus 5: an adopted worktree on a detached HEAD is refused` — valid run dir and cwd, `git -C {ADOPT_WT} branch --show-current` replies `''`: exit 3 and nothing written (the guard's one git call is a read; the assertion helper takes a flag allowing exactly that call).
  - `#5232 AC2.1: --run adopts the run directory and the worktree, minting and creating neither` — cwd `ADOPT_WT`, branch reply `worktree-dispatch-record-7`, record-worktree **not** scripted (an unscripted call throws in the harness): exit 0; no `resolveRunDir` call; no `git worktree add`; no `hooks.js record-worktree` call; `git fetch`/`merge` catch-up runs with `cwd === ADOPT_WT`; the push is `push … origin worktree-dispatch-record-7`; the final line's `run` equals `path.basename(ADOPT_RUN)`.
  - `#5232 AC2.3: the adopted run's claim runId is the given directory's basename` — the `claim-targets.js` call's `--run-id` value equals `'2026-11-15T000000-spec-7'` and the claim-log `log-decision.js` call's `--run` value equals the real path of `ADOPT_RUN`.
  - `#5232 (Deliverable 2): a --run --no-settle stop leaves the claim, worktree, branch and run directory` — the push step fails (`[onGit('push'), () => { throw new Error('rejected'); }]`): final `settle` is `left-to-caller`, outcome `blocked`; no `release-claim.js`, `express-lane.js escalate`, `hooks.js close-run`, `git worktree remove` or `git branch -D` call.
  - `#5232 --run grammar` — exit 2 for `['#7', '--run', d]` (no `--no-settle`), `['#7', '#8', '--run', d, '--no-settle']`, `['--run', d, '--no-settle', '--budget', '1']`, `['--check', '#7', '--run', d]`, `['#7', '--no-settle', '--run']` (trailing bare flag), `['#7', '--run', '', '--no-settle']` (empty value), `['#7', '--run', '--no-settle']` (flag-shaped value), `['#7', '--run', d, '--run', d, '--no-settle']`.
  - `#5232 --run resolves a relative directory against deps.cwd()` — cwd `ADOPT_WT`, `--run ../../../.claude-tweaks/pipelines/2026-11-15T000000-spec-7` (relative to the worktree): adopts `ADOPT_RUN` (claim `--run-id` is its basename).
  - The shadow-directory test above also writes `{shadow}/decisions.md` with known bytes and asserts them byte-unchanged after the exit 3 (run-dir-boundary-guards rule).
  - `#5232 realDeps.adoptRun is the adopt.js guard` — one guard test (the missing-directory one) runs with `deps.adoptRun: realDeps.adoptRun` (`require(path.join(LIB, 'driver', 'run')).realDeps`) to prove the wiring; every other guard test passes `require(path.join(LIB, 'driver', 'adopt')).adoptRun` explicitly.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="#5232" tests/bin-lib/driver/run.test.js`
Expected: FAIL (`--run` is an unknown option)

- [ ] **Step 3: Implement**
  - `adopt.js` `adoptRun({ runDir, cwd }, deps)`: (1) `resolveTarget({ runDir, cwd })` from `../log-decision/append` — not ok → `why: 'run directory {reason}'`; (2) `real = path.dirname(target.file)`, `main = mainCheckoutRoot(cwd)` (`../hooks/worktree-detect`); `path.dirname(real) !== path.join(main, '.claude-tweaks', 'pipelines')` → `why: 'not a run directory under the main checkout'`; (3) walk up from `safeReal(cwd)` to the nearest directory holding a `.git` entry (`lstatType` from `../path-guard`): it must be a file, `mainCheckoutRoot(top) === main`, and `top !== main` → else `why: 'working directory is not a linked worktree of the main checkout'`; (4) `branch = String(deps.git(['-C', top, 'branch', '--show-current'], { cwd: top })).trim()`, empty or a thrown read → `why: 'adopted worktree has no branch (detached HEAD or unreadable)'`. Return `{ ok: true, runDir: real, runId: path.basename(real), wt: top, branch, mainRoot: main }`. Header comment: what it checks, that it writes nothing, and that it reads the file system directly as `policyStep`'s `mainCheckoutRoot` does.
  - `run.js` `parseArgs`: `--run <dir>` once, a value required (`typeof v !== 'string' || !v.trim() || v.startsWith('--')` is a usage error); needs exactly one record and `--no-settle`; exclusive with `--budget` and `--check`; error strings name the rule. `realDeps.adoptRun = (opts, d) => require('./adopt').adoptRun(opts, d)` (lazy, as the other lib seams); the `run.test.js` `harness` gains a default `adoptRun` that records the call and returns `{ ok: false, why: 'adoptRun not scripted' }` unless `over.deps.adoptRun` replaces it. `run()`: after the probes, when `parsed.runDir` is set, `deps.adoptRun({ runDir: path.resolve(deps.cwd(), parsed.runDir), cwd: deps.cwd() }, deps)` (a relative `--run` resolves against `deps.cwd()`; the guard's realpath then normalizes it), wrapped in try/catch (a throw is a refusal naming the error); not ok → `deps.stderr('drive.js: --run refused: {why}\n')`, return 3; ok → `shared.adopted = result` before the first record.
  - `steps.js`: `claimStep` — `ctx.runId = adopted ? adopted.runId : \`${formatTimestamp(ctx.claimDate)}-drive-${n}\``; `runDirStep` — adopted: `ctx.runDir = adopted.runDir`, no `resolveRunDir`, the claim-log write unchanged; `worktreeStep` — adopted: `ctx.wt = adopted.wt`, `ctx.branch = adopted.branch`, `ctx.created` left all `false`, no `findLeftovers`, no `worktree add`, no `record-worktree` (dispatch's bind is the only bind before the call); the catch-up `fetch` + `merge` in `ctx.wt`, the `ignoreStatStop` and the index-flag baseline run as today. Comment each branch with why (spec Technical Approach "Adopting the run").
  - `USAGE`, `drive.js` header and `docs/driver.md`: the `--run <dir>` form (`requires --no-settle and one record`), exit `3  --run refused: the run directory is missing or not a run directory under the main checkout, or the working directory is not a linked worktree of it, or that worktree has no branch; nothing written`, and in "When a run stops" one paragraph: under `--run --no-settle` the claim, worktree, branch and run directory stay for the caller.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Prove the guards discriminate.** For each of the four `adoptRun` checks, comment the check out in a scratch copy made with `git archive HEAD plugin tests | tar -x -C {scratch}` (never edit the worktree), run `node --test --test-name-pattern="AC2.2|Review Focus 5" {scratch}/tests/bin-lib/driver/run.test.js`, and confirm the test(s) naming that check go red; record the four results in the commit body.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/adopt.js plugin/bin/lib/driver/run.js plugin/bin/lib/driver/steps.js plugin/bin/drive.js docs/driver.md tests/bin-lib/driver/run.test.js
git commit -m "Add drive.js --run — adopt dispatch's run directory and worktree, exit 3 on a bad one"
```

---

### Task 3: `--in-flight-prs` — the drain-overlap hold in code

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js` (new `overlapHold(s)` between `compose` and `markReady`; `REASONS` gains four words; `postMerge` keeps an adopted worktree)
- Modify: `plugin/bin/lib/driver/events.js` (`MERGE_STEP_NAMES` gains `'merge-overlap'`, placed between `'merge-compose'` and `'merge-ready'`)
- Modify: `plugin/bin/lib/driver/steps.js` (`mergeStep`'s `mctx` gains `inFlightPrsFile: ctx.shared.inFlightPrsFile || null`, `nearDupPairsFile: ctx.shared.nearDupPairsFile || null`, `adopted: Boolean(ctx.shared.adopted)`)
- Modify: `plugin/bin/lib/driver/run.js` (`parseArgs`, `USAGE`, `newShared` gains `inFlightPrsFile: null`, `nearDupPairsFile: null`)
- Modify: `plugin/bin/drive.js`, `docs/driver.md` ("The merge step": the hold and the adopted-worktree keep; the closed reason list at its `REASONS` paragraph gains the four words; "Event lines" gains `merge-overlap`)
- Test: `tests/bin-lib/driver/merge.test.js`, `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: Task 2's `parseArgs` shape.
- Produces: `parseArgs([..., '--in-flight-prs', f])` → `inFlightPrsFile: f`, `parseArgs([..., '--near-dup-pairs', p])` → `nearDupPairsFile: p` on the records or `--run` result (both refused with `--check`; each key present only when given); `merge()` result `{ outcome: 'pending-review', reason: 'drain-overlap' | 'near-duplicate' | 'in-flight-unreadable' | 'in-flight-read-failed', detail }` on a hold; event `merge-overlap`; `REASONS` gains those four words (24 spec reasons plus `unclassified`).

- [ ] **Step 1: Write the failing tests** (every new test name starts `#5232 `) in `tests/bin-lib/driver/merge.test.js` through `mergeHarness`, with `CTX` extended by `inFlightPrsFile` and the file's content served by the harness's `readFile` seam; listed-PR reads answered with `[isGh('pr', 'view'), …]` replies keyed on the PR number argument. Each hold case calls `assertNoReadyNoMerge(h)` and asserts the PR was never marked ready:
  - `#5232 AC9.1, AC9.3, AC9.4, AC9.7, AC9.11: a path shared with an open in-flight PR holds at pending-review, PR left in draft` — own PR #9 files `['a.js', 'b.js']`, listed `[{ number: 12 }]` open with `['b.js']`: outcome `pending-review`, reason `drain-overlap`, the `merge-overlap` stop event's detail names `#12` and `b.js`.
  - `#5232 AC9.8: disjoint paths proceed to the merge` — listed #12 open with `['c.js']`: the run reaches `merge-ready` and the merge call (the existing happy-path outcome `merged`).
  - `#5232 AC9.5, AC9.9, AC9.11: a malformed in-flight file holds` — one sub-case each: not JSON; JSON object; `[0]`; `["12"]`; `[{ "number": -1 }]`: reason `in-flight-unreadable`.
  - `#5232 AC9.5, AC9.11: an unreadable in-flight file holds` — `readFile` throws ENOENT: reason `in-flight-unreadable`.
  - `#5232 AC9.5, AC9.10, AC9.11: a failed read of the own PR or of a listed PR holds` — `gh pr view 9` throws; separately `gh pr view 12` throws: reason `in-flight-read-failed`.
  - `#5232 AC9.6: with the flag absent no hold is applied` — `inFlightPrsFile: null`: no `gh pr view … --json state,files` and no `--json files` call; the run merges.
  - `#5232 Review Focus 3: a listed PR no longer open is skipped` — #12 `state: 'MERGED'` with `['b.js']`: proceeds to merge.
  - `#5232 Review Focus 2, AC9.11: a 100-file list is treated as possibly truncated and holds` — own PR with exactly 100 paths: reason `in-flight-read-failed`, detail says the list may be truncated.
  - `#5232 near-dup: a still-open listed PR closing a strong partner holds` — `nearDupPairsFile` served `[{ "records": [7, 30], "strong": true }]`, listed #12 open, disjoint files, `closingIssuesReferences: [{ number: 30 }]`: reason `near-duplicate`, detail names `#12` and `#30`, `assertNoReadyNoMerge(h)`; the same with #12 `CLOSED` proceeds; a pairs file that is not a JSON array holds `in-flight-unreadable`; with `nearDupPairsFile: null` the same listed PR proceeds (no near-duplicate hold).
  - `#5232 adopted: a --run merge keeps the worktree and local branch` — `CTX` with `adopted: true` on the merged happy path: no `git worktree unlock`, `worktree remove` or local `branch -D` call; the remote-branch delete and `hooks.js close-run` calls are made; `postMerge`'s failures list carries no `teardown-*`/`delete-branch` entry; a `merge-teardown` `ok` event says the adopted worktree was kept for the caller. Standalone (`adopted` absent) is unchanged (the existing teardown tests).
  - `#5232 REASONS: the four hold words are in the closed set` — update the existing `SPEC_REASONS` pin (`merge.test.js` near line 2747) from 20 to 24 entries with `drain-overlap`, `near-duplicate`, `in-flight-unreadable`, `in-flight-read-failed`; the existing "every reason literal … is in the closed set" test then covers the new literals.
  - `#5232 the own PR in the list is excluded` — listed `[9, 12]` with #12 disjoint: proceeds; no `gh pr view 9 --json state,files` call.
  - `#5232 the files reads use the batch bound` — every recorded `--json files` / `--json state,files,closingIssuesReferences` read is kind `ghBatch` (none is `gh`), and its argv carries `--repo` equal to `CTX.repo`. **Harness:** `mergeHarness`'s deps gain `ghBatch: (args) => dispatch('ghBatch', args)` (the same refusal of `pr merge`/`pr ready` as `gh`), and these reads are scripted with a `ghBatch`-kind matcher keyed on the PR-number argument — `isGh` matches only kind `gh`, so it must not answer them.
  - `every merge-overlap event step is in MERGE_STEP_NAMES` is covered by merge.test.js's existing every-emitted-step assertion — confirm it runs over the new hold tests; add the hold tests to its loop if it iterates a fixed list.
  - In `run.test.js`: `#5232 AC9.2: --in-flight-prs reaches the merge step` — a green `auto:merge` run with `--in-flight-prs /f.json` through the real merge step whose readFile reply for `/f.json` is `[]`: the readFile call for `/f.json` is recorded; and `#5232 --in-flight-prs resolves a relative file against deps.cwd()` — `--in-flight-prs f.json` with `deps.cwd` → `MAIN` reads `path.join(MAIN, 'f.json')`. Grammar: exit 2 for `['--check', '#7', '--in-flight-prs', f]`, `['#7', '--in-flight-prs']` (trailing bare flag), `['#7', '--in-flight-prs', '']`, `['#7', '--in-flight-prs', '--no-settle']`, a repeated flag.
  - `#5232 docs/driver.md's merge sub-step list equals MERGE_STEP_NAMES` (in `merge.test.js`, unless `git grep -n "MERGE_STEP_NAMES" -- tests` shows an existing docs pin to extend): parse the backticked `merge-*` names from the "Event lines" section (`sectionOf(readText(DOCS), '## Event lines')`) and `assert.deepEqual(new Set(names), new Set(MERGE_STEP_NAMES))`; go-red: the same comparison against `[...MERGE_STEP_NAMES, 'merge-bogus']` fails.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="#5232" tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: FAIL (no `merge-overlap` sub-step; `--in-flight-prs` unknown)

- [ ] **Step 3: Implement** `overlapHold(s)` in `merge.js`, called in `merge()` right after a successful `compose(s)` and before `markReady(s)`; on `{ stop }` return `result(s, 'pending-review', stop, detail)` like its neighbours. Body: `ctx.inFlightPrsFile` null → return `{ ok: true }` with no event and no call. Else `deps.readFile` + `JSON.parse`; not an array, or any entry neither a positive integer nor an object with a positive-integer `number` → `stop(s, 'merge-overlap', 'in-flight-unreadable', …)`. De-duplicate, drop `ctx.pr`; empty → emit `ok` "no in-flight PR besides this one" and return. Read the own PR `deps.ghBatch(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', 'files'])`, then each listed one with `--json state,files` (also `deps.ghBatch`: a files list is a batch-bounded read per call-bounds.md); the file path is resolved against `deps.cwd()` in `run.js` before it reaches `shared.inFlightPrsFile`; any throw, unparseable output, non-array `files`, or a `files` list of exactly 100 entries → `in-flight-read-failed`; a listed state other than `OPEN` is skipped; the first listed PR sharing a path → `stop(s, 'merge-overlap', 'drain-overlap', \`overlaps in-flight PR #${n} on ${shared.join(', ')}\`)` (through `reduceDetail` for length). Near-duplicates: when `ctx.nearDupPairsFile` is set, read and parse it once (not an array → `in-flight-unreadable`); the listed-PR read asks `--json state,files,closingIssuesReferences`; for each still-open listed PR, `drainNearDuplicateHits([ctx.record], pairs, [{ number: n, closingIssueNumbers }])` (`require('../dispatch/near-dup-pairs')`) — a hit → `stop(s, 'merge-overlap', 'near-duplicate', \`overlaps in-flight PR #${n} (near-duplicate of #${partner})\`)`. Add the four words to `REASONS`. Adopted teardown: in `postMerge`, when `ctx.adopted === true`, `teardown` makes no git call and emits `merge-teardown` `ok` "adopted worktree and local branch kept for the caller", and the remote-branch delete and `closeRun` treat that as proceed (today they gate on the worktree being gone; give the gate a third, deliberate "kept for the caller" value rather than reusing `gone = true`). `parseArgs`: `--near-dup-pairs <file>` like `--in-flight-prs` (once, value required, refused with `--check`, resolved against `deps.cwd()`). No hold → emit `ok` naming how many were read. Header comment: ports `drain-pr-overlap.md` Step 6's hold into code, the two deliberate differences (plain path equality, not `detectCrossPRFileOverlap`'s hub filter; fail closed on any read). `parseArgs`: `--in-flight-prs <file>` once, value required, refused with `--check`; `shared.inFlightPrsFile`. `docs/driver.md` "The merge step": one paragraph on the hold.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js tests/bin-lib/dispatch/near-dup-pairs.test.js`
Expected: PASS, 0 failures (any suite enumerating `MERGE_STEP_NAMES` — grep `git grep -n MERGE_STEP_NAMES -- tests plugin` — still green)

- [ ] **Step 5: Prove the hold discriminates.** In a `git archive` scratch copy (as Task 2 Step 5), delete the `overlapHold(s)` call: the shared-path test and every AC9.5 test go red; restore it and delete only the `state !== 'OPEN'` skip: the Review Focus 3 test goes red. Record both in the commit body.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/merge.js plugin/bin/lib/driver/events.js plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/run.js plugin/bin/drive.js docs/driver.md tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js
git commit -m "Hold the driver's merge on an in-flight drain PR overlap — --in-flight-prs, fail closed"
```

---

### Task 4: The dispatch route — `driver-route.md`, the pointer, the trim, the prose pins

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/dispatch/driver-route.md`
- Modify: `plugin/skills/dispatch/SKILL.md` (one pointer sentence before Step 5's `**Express lane (#4025).**` paragraph; the trims listed below)
- Modify: `plugin/skills/dispatch/sibling-session-check.md` (line 63's express-gate sentence gains one clause for the driver route)
- Modify: `plugin/skills/dispatch/configuration.md` (an `express-driver` row after `express-review-sample-every`)
- Modify: `docs/plugin-structure.md` (the `dispatch` row lists `driver-route.md`)
- Test: `tests/dispatch-express-routing-prose.test.js`

**Interfaces:**
- Consumes: Task 1's `--check` line (`admitted`, `reasons`), Task 2's `--run` + exit 3, Task 3's `--in-flight-prs`, `events.js`'s `OUTCOMES`.

- [ ] **Step 1: Write the failing tests** in `tests/dispatch-express-routing-prose.test.js`, in the shape of `STEP5_FACTS` (`missingFactsOf` + `assertEachFactGoesRed`):
  - `AC3.2: SKILL.md names driver-route.md in exactly one conditional pointer and names no drive.js call` — `(text.match(/driver-route\.md/g) || []).length === 1`; that one occurrence sits in a sentence matching `/unless it resolves `off`/`; `/drive\.js/.test(text) === false`. Go-red: the same assertion function over `text + ' drive.js'` and over the text with the pointer sentence duplicated both throw.
  - `AC3.3: express-driver is resolved by the same resolve-policy.js call as express-lane` — SKILL.md matches `/`resolve-policy\.js --values express-lane express-driver`/`.
  - `ROUTE_FACTS` over `driver-route.md` (each with its go-red): the Closed rule's five rows (`off`/unknown/unreadable → not read, no `drive.js` call; `split` or `on` singleton → `--check` runs whatever `express-lane` resolves; `--check` non-zero / no line / not one JSON object / `admitted` missing or not `true` → today's path plus one `SKIP`; admits → `drive.js {n} --run "{minted-run-dir}" --no-settle --in-flight-prs` as one background Bash call; bundle → today's path, never consulted) — test names cite `AC3.1`, `AC4.2`, `AC5.1`, and for the outcome-handling facts `AC5.2` (merged/armed/pending-review), `AC5.3` (express-escalated), `AC5.5` (blocked), `AC5.6` (refused → today's path plus one `SKIP`, and that path re-decides the bind: the express gate when `express-lane` resolves `true`, and on anything but an eligible verdict a re-bind with `hooks.js record-worktree --run "{minted-run-dir}" "{worktree}" --dispatch` before the ordinary first call — the first bind was without `--dispatch`), a `blocked` final line whose `stop.step` is `claim` and `stop.reason` is `claim-exit-7` → dispatch's Claim permission stop (ends the firing, as `SKILL.md`'s `failed:claim-permission-denied` rule), `--near-dup-pairs "{near-dup-pairs}"` passed whenever this firing wrote `dispatch-near-dup-pairs.json`, `AC5.7` (the Step 5 list write), `AC5.8` (counts for the Drain-overlap hold), `AC5.9`, `AC5.10`, `AC5.11` and `AC9.2` (the route always passes `--in-flight-prs`, the hold and the merge are driver code, no model performs the merge); the order mint → `--check` → bind without `--dispatch` → `--run`; the `SKIP` via `log-decision.js --run "{minted-run-dir}" --status SKIP --step "Driver route"` with `--text-file`; `[]` written to `dispatch-drain-prs.json` when absent (Review Focus 1); no `sleep`, wait for the completion notification (`AC6.1`); `tail -n 3` and the last line above `[exited with code N]` (Review Focus 4); `express-escalated` re-binds with `--dispatch`; `merged`/`armed`/`pending-review` → `express-lane.js verify --run "{minted-run-dir}" --issue {n}` exits 0, non-zero `blocked`; `blocked` and every unparseable/non-zero-no-line case → `two-call-gate.md` §5 (`AC5.2`); `refused` → today's path with one `SKIP`; `drain-pr-overlap.md`'s Step 5 list write after the call; counts for `settle-and-merge.md`'s Drain-overlap hold (`AC5.3`).
  - `AC4.1: driver-route.md states no parity, label or number rule` — none of `/\bodd\b/i`, `/\beven\b/i`, `/parity/i`, `/`auto:/`, `/`size:/`, `/`risk:/`, `/`ceremony:/`, `/% ?2\b/` matches. Go-red: each pattern's assertion fails on the text with `" odd"` (resp. the matching token) appended.
  - `AC5.4: the outcome words driver-route.md maps equal the driver's OUTCOMES` — parse the backticked first-column words of the table under `## Outcome words`; `assert.deepEqual(new Set(words), new Set(Object.values(OUTCOMES)))` with `OUTCOMES` from `plugin/bin/lib/driver/events.js`. Go-red: the same comparison against `[...Object.values(OUTCOMES), 'parked']` fails, and against the words with one row's word removed fails.
  - `the route's drive.js command lines parse through drive.js's own parseArgs` — extract `driver-route.md`'s fenced `drive.js` invocations (anchor on the fence, `\r?\n`-tolerant), substitute `{n}` → `7`, `{minted-run-dir}` → `/r/x y` (a space, hostile-ish), `{drain-prs}` → `/t/dispatch-drain-prs.json`, tokenize, drop the leading `node "…/drive.js"`, and assert `parseArgs` returns `{ check: 7 }` for the check line and `{ records: [7], settle: false, runDir: '/r/x y', inFlightPrsFile: '/t/dispatch-drain-prs.json' }` (Task 3's key) for the run line — plus `nearDupPairsFile: '/t/dispatch-near-dup-pairs.json'` for the run line's `--near-dup-pairs` form (`{near-dup-pairs}` substituted to that path) if the route writes it as a second fence or an optional suffix; a CRLF copy of the text extracts the same lines.
  - Existing `STEP5_FACTS` and `LOOP_FACTS` unchanged (`AC7.2`), and their go-red controls re-run green on the edited Step 5 slice (the pointer sentence sits inside `step5()`).
  - `AC7.1: SKILL.md stays under RAIL_BYTES` — `Buffer.byteLength(readText(SKILL)) <= RAIL_BYTES` (`require('../plugin/bin/lib/skill-audit/budgets').RAIL_BYTES`) — only if no existing `rail:` test already covers this file; check with `git grep -n "rail:" -- tests` first and skip this test if one does.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dispatch-express-routing-prose.test.js`
Expected: FAIL (`driver-route.md` does not exist)

- [ ] **Step 3: Write `driver-route.md`.** Sections: one-line purpose and when it is read (`express-driver` neither `off`, unknown nor unreadable; singleton groups only); **Closed rule** (the spec's table, verbatim rows, plus its unlisted-state sentence: a state not listed is refused with one line naming it and the record takes today's path); **Order** (mint → `--check` → bind without `--dispatch` → `--run`, with the reason the check precedes the bind); **The call** (`node "${CLAUDE_PLUGIN_ROOT}/bin/drive.js" {n} --run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}"` as one `run_in_background` Bash call from the group's worktree, prefixed `cd {worktree-path} &&` only in Step 5's cwd-pinned case (#447); `{drain-prs}` the path `session-tmp-resolve.js --value dispatch-drain-prs.json` prints, written `[]` with the Write tool first when absent); **Waiting and reading** (no `sleep`, end the turn, on the completion notification run `tail -n 3 {output-file}` as one plain command; the final event line is the last line above the harness's `[exited with code N]` marker); **Outcome words** (a table, one row per `OUTCOMES` value, with the spec AC5 mapping; then the catch-all: any other word, no line, a line that is not one JSON object, or a non-zero exit without one — exit 3 included — is `blocked` through `two-call-gate.md` §5, a dispatch-side defect); **After the call** (`drain-pr-overlap.md`'s Step 5 list write; counts for the Drain-overlap hold; no model-selection log line — the final line's `model`/`usage` are the record); **Logging a decline** (the `SKIP` command). Write it in dispatch's own imperative voice (match `express-prompt.md`'s dispatcher-facing preamble). It must state no rule about the record's number or labels.

- [ ] **Step 4: Edit `SKILL.md`.** Insert before `**Express lane (#4025).**`: `**Driver route (#5232).** \`express-driver\` is read with \`express-lane\` in one \`resolve-policy.js --values express-lane express-driver\` call, once per firing; unless it resolves \`off\`, an unknown value or nothing, a singleton group first follows \`driver-route.md\` in this skill's directory, which may take the record before the Express lane below.` Then apply the trims listed under **SKILL.md trims** below, and confirm `wc -c plugin/skills/dispatch/SKILL.md` ≤ 51,500 (record the number in the commit body). Edit `sibling-session-check.md` line 63: after the sentence naming the express gate running first, add `When \`express-driver\` is not \`off\`, \`driver-route.md\`'s \`drive.js --check\` runs before that gate, and an admitted singleton is bound the same way, without \`--dispatch\`.` Add the `configuration.md` row: `| \`express-driver\` | \`off\` | Routes an eligible singleton to the pipeline driver (\`driver-route.md\`): \`off\`, \`split\` (the driver's own admission decides which records), \`on\`. Canonical row: \`_shared/policy-schema.md\`. |` — first grep `tests/` for a suite mirroring `configuration.md`'s rows against `policy-schema.md` or `work-record-config.md` (`git grep -n "configuration.md" -- tests`) and satisfy it. Add `driver-route.md` to `docs/plugin-structure.md`'s `dispatch` row in its existing order.

**SKILL.md trims** (1,006 bytes; 52,088 → 51,082, ~51,432 with the pointer). The exact current/replacement text of all nine is in `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T173500-spec-5232/evidence/skill-trims.js`; apply them with `node "{that path}" plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/SKILL.md` *before* inserting the pointer (the script refuses any cut that does not match exactly once, and prints each saving). Each cut, the text that still states what it drops, and the pin checked:

| # | Where | Cut | Still stated at | Pins checked |
|---|---|---|---|---|
| C1 | `## Settle Parked` | the "none of that applies …" aside and the procedure summary | Input table's `--settle-parked` row; `settle-parked.md` | `tests/dispatch-settle-parked-prose.test.js` (`--settle-parked`, mutually exclusive, human-present only/Routine, `settle-parked.md`) — all still match |
| C2 | `## Preflight` ladder | the three checks' names in parentheses | the line before names checks 1-3 | `tests/dispatch-graphql-blocked-preflight.test.js` (`GraphQL-blocked`, `mcp-transport.md`, check-3 hard stop) — untouched text |
| C3 | Step 1 `#2430` note | "This is a simple fact about which branch …" | the preceding sentence (minted = step 4, adopted = step 2) | none on this text; `dispatch-drain-close-run-reconcile`, `standalone-run-dir-closeout-conformance` read untouched wording |
| C4 | Step 3 zero-eligible | the `_shared/session-tmp-root.md` cite | Step 2's cite of the same file | `tests/session-tmp-root-migration.test.js` (`session-tmp-root.md` anywhere in the file) — Step 2 still matches |
| C9 | `**MCP transport details.**` | "since check 3 stays a hard gate on either transport" | the ladder paragraph (C2's) | `mcp-transport.md` pin unaffected |
| C5 | `next` bullet | "A Routine now fires bare `--budget 1` …, not `next`." | When to Use; Routine Configuration | `tests/dispatch-queue-pull-cutover-prose.test.js`'s `nextBullet` regex still matches ("Step 1's close-out runs" kept) |
| C6 | Component-Skill Contract | the `--settle-parked` human-present-only paragraph | Input row; Contract's "never invoked by another skill"; Anti-Patterns row | settle-parked suite matches the Input row first |
| C7 | Component-Skill Contract | "Unlike before, there is no separate identity to bridge …" | Step 5's inline `PIPELINE_RUN_DIR` / "no second, later run directory" | `tests/dispatch-flow-rundir-handoff.test.js` asserts Step 4 only |
| C8 | Step 5 group order | "its deprecated `next` alias, itself `--budget 1`" and "unaffected by this migration" | Input table; `next` bullet heading | `tests/dispatch-budget-drain.test.js:24` (`Step 3's own loop is the driver — re-fetch, rank, dispatch, repeat`) kept verbatim |

Probe at plan time: a clean-room agent applied all nine to a `git archive` extract and ran the 645 test files mentioning `skills`/`SKILL` before and after — the same 11 files failed both times (extract-environment failures, identical failing subtests in the three that read dispatch prose). The controller re-ran the script on a fresh copy: each cut matched once, 52,088 → 51,082. Step 5 below re-proves it in the real worktree.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/dispatch-express-routing-prose.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS, 0 failures; then every test file that reads `dispatch/SKILL.md` (`git grep -l "dispatch', 'SKILL.md'\|dispatch/SKILL.md" -- tests`) run once with `node --test {files}`: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/driver-route.md plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/sibling-session-check.md plugin/skills/dispatch/configuration.md docs/plugin-structure.md tests/dispatch-express-routing-prose.test.js
git commit -m "Route driver-admitted singletons from dispatch to drive.js — driver-route.md behind one pointer"
```

---

## Acceptance-criterion coverage

- AC1 → Task 1 (AC1.1, AC1.2). AC2 → Task 2 (AC2.1–AC2.10). AC3 → Task 4 (AC3.1–AC3.3). AC4 → Task 1 (AC4.1 code side) and Task 4 (AC4.1 prose side, AC4.2). AC5 → Task 4 (AC5.1–AC5.4). AC6 → Task 4 (AC6.1). AC7 → Task 4 (AC7.1, AC7.2). AC9 → Task 3 (AC9.1, AC9.3–AC9.11) and Task 4 (AC9.2).
- Waived AC2.11: the spec itself rules percent-encoding, uppercase schemes and mount prefixes out of scope for a filesystem path.
- Waived plugin/bin/lib/log-decision/append.js: read only — Task 2's `adopt.js` imports its `resolveTarget` unchanged.
- Waived _shared/auto-decision-log.md: read only — Task 4 reads its Degrade-trace rule for the `SKIP` line shape `driver-route.md` cites.
- Waived AC8.1: a live drain needs the merged, released plugin; it runs after release and its token-use quote goes on #5232's closing comment — carried as an `ops` ledger row with a staged follow-up, not testable before merge.
