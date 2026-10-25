# Release reviewed-tip check CLI (#4152) Implementation Plan

> **Superseded in one place (`e836498f8`, the final whole-branch review).** The CLI does not return `held` for an arrived-commit major. It reports `arrived` (the last delta verdict line's `base..tip`) beside every verdict, and `execute.md` takes delta 5's major gate before routing the verdict, so an interactive `Proceed` continues with the same verdict. Where Task 3, Task 5 and the Task 6 prose below say the CLI holds with `re-rendered to a major after the console`, read this note instead; the spec's Build notes record the ruling.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/claude-tweaks:release` Step 5's prose reviewed-tip state machine (`plugin/skills/release/execute.md`, "Reviewed-tip comparison" steps 1–4, 3a and step 7's arrived-commit bump derivation) with one unit-tested CLI, `plugin/bin/release-tip-check.js`, that prints one JSON verdict the step routes on.

**Architecture:** A pure-ish library `plugin/bin/lib/release-tip/check.js` (decisions.md parsing, arrived-commit bump part through `bumpPart`, and the verdict engine over an injected `git` runner, bound reader and log appender) plus a thin `run(argv, deps)` CLI wrapper. The CLI owns every deterministic branch: read the reviewed tip, fetch, classify, advance past run-dir-only moves (logging each advance itself, since the next read depends on it), count moves, read `release-tip-moves` failing closed, and hold on a major among already-reviewed arrived commits. `execute.md` keeps only the agent-driven parts (staging `release-held.md`, bringing the checkout to the tip, the delta review, routing its verdict) and routes on the CLI's `verdict`.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI; reuses `plugin/bin/lib/release-local/{bump,commits,manifest}.js` and `plugin/bin/lib/log-decision/append.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T122522-record-4152/work/4152-spec.md`

## Global Constraints

- The bump part of arrived commits comes from `bumpPart` (`plugin/bin/lib/release-local/bump.js`) — never a prose or reimplemented precedence. A chore-only range is `none`.
- Commit parsing reuses `readCommits(git, base, tip, { firstParent: false })` (`plugin/bin/lib/release-local/commits.js`); bump flags reuse `readBumpFlags` (`plugin/bin/lib/release-local/manifest.js`), read at the reviewed tip.
- Every `execFileSync`/`spawnSync` passes `windowsHide: true`; git argv that takes a revision puts it after options (the repo's bin source-scan conformance suites run over every new `plugin/bin/**/*.js`).
- CLI guard assigns `process.exitCode`, never `process.exit()` (`tests/bin-lib/exit-code-conformance.test.js`).
- Exit codes: `0` a verdict was printed (every verdict, `failed` included — the verdict is data), `2` malformed invocation, `3` `--run` missing or not anchored under the main checkout (`resolveTarget` from `plugin/bin/lib/log-decision/append.js`), `1` undecided crash.
- `execute.md` must stay under `RAIL_BYTES` (52,500 B); today 50,529 B — this plan removes prose, so it shrinks.
- Commit messages: `{Verb} {what} — {detail}`, `refs #4152` (never `closes`/`fixes`), ending with the line `Claude-Session: https://claude.ai/code/session_01GEHZrLRQzQ3ByZc395shtp`.

Scope keywords: release-tip-moves, at reviewed tip, Reviewed-tip comparison

## Review Focus

1. **Real decisions.md lines are freer than the templates.** The archived run `.claude-tweaks/pipelines/archive/2026-10-24T152958-release-standalone/decisions.md` (main checkout) merges extra prose into the Step 3 marker and the delta marker lines. The parser keys on substrings (`whole-branch review starting`, `at reviewed tip <40-hex>`, `origin/{branch} moved <hex> →`), never on whole-line templates. Task 1 pins it against that real block.
2. **A short sha after `at reviewed tip`** (the unmoved log line `still at reviewed tip {short}`) must never be read as a reviewed tip. Only a full 40-hex sha counts. Task 1 pins it.
3. **A `## /release` block that is not the first section, or a later `## /review` block holding `moved … →` text.** Only lines inside `## /release`, and for counting only lines after Step 3's last marker, count. Task 1 pins it.
4. **A fetch that fails silently or a run-dir-only advance that never converges** must end in `failed`, never in `merge`. Task 3 pins both: an unreachable origin → `failed` reason `fetch failed`, and an advance cap → `failed`.
5. **Branch names with regex metacharacters** (`release/1.x`) must not break the counted-line regex. Task 1 escapes the branch and pins it.

---

### Task 1: decisions.md parsing and the counted-line forms

**Files:**
- Create: `plugin/bin/lib/release-tip/check.js`
- Test: `tests/bin-lib/release-tip/parse.test.js`

**Interfaces:**
- Produces (exported from `check.js`):
  - `REVIEWED_TIP_RE: RegExp`, which matches `at reviewed tip ([0-9a-f]{40})(?![0-9a-f])`.
  - `movedLineRe(branch: string): RegExp`, which matches `origin/<escaped branch> moved [0-9a-f]{4,40} →`.
  - `releaseBlock(decisionsText: string): string[]` returns the lines between a `## /release` heading line and the next `^## ` heading. The result is `[]` when there is no heading.
  - `parseReleaseLog(decisionsText: string, branch: string): { reviewedTip: string|null, step3Tip: string|null, priorMoves: number }`.
    - `reviewedTip` is the sha on the last block line that matches `REVIEWED_TIP_RE`.
    - `step3Tip` is the `REVIEWED_TIP_RE` sha on the last block line containing `whole-branch review starting`. It is `null` when that line has none, or when there is no such line.
    - `priorMoves` is the number of block lines *after* that Step 3 line that match `movedLineRe(branch)`. It is `0` when there is no Step 3 line.
  - `advanceText({ branch, from, to, commits }): string` is the advance line's text. `from` and `to` are full shas, and the text renders them as 7-char shorts. The exact text is `` `origin/${branch} advanced ${from7} → ${to7} by run-dir-only commits (${commits} commits, nothing outside .claude-tweaks/pipelines); no review, not counted; at reviewed tip ${to}` ``. It must match `REVIEWED_TIP_RE` and must not match `movedLineRe(branch)`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/release-tip/parse.test.js`:
  - `parses the real 2026-10-24 release block`: a fixture string holding lines 1, 4, 7, 8 and 9 of the archived `decisions.md` named in Review Focus 1, each verbatim. Copy them with `sed -n` from the main checkout's archive path; do not retype them. Add a trailing `## /review` heading and one line under it containing `origin/main moved aaaaaaa → bbbbbbb`. The test asserts `{ reviewedTip: '0ecde186ccb4a2d176d86f359699b006014852e6', step3Tip: '1813941ecfe019b89307ea75526f2c863ffb5e1e', priorMoves: 1 }`. The independent count is `grep -c 'origin/main moved [0-9a-f]* →'` on the archived file, which gives 1. Record that in the commit message.
  - `a short sha after "at reviewed tip" is not a reviewed tip`: the block has the Step 3 marker with sha A, followed by `- AUTO 10:00:00 — Step 5: origin/main still at reviewed tip abc1234; merging. Reversibility: n/a (gate evaluation).`. Expect `reviewedTip === A`.
  - `counts every earlier delta marker whatever short sha it names`: two markers with different shorts after the Step 3 marker give `priorMoves === 2`. A marker *before* the Step 3 marker is not counted.
  - `no Step 3 marker → nulls and 0`; `no ## /release heading → nulls and 0`.
  - `branch is regex-escaped`: `movedLineRe('release/1.x').test('origin/release/1.x moved abc1234 → def5678')` is true. The same call on `'origin/release/1Xx moved abc1234 → def5678'` is false.
  - `advance text carries the tip and is not a counted move`: `REVIEWED_TIP_RE.exec(advanceText(...))[1] === to`, and `movedLineRe('main').test(advanceText(...)) === false`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/release-tip/parse.test.js`
  Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/release-tip/check.js'`)

- [ ] **Step 3: Implement the exports above in `plugin/bin/lib/release-tip/check.js`.** Add a header comment that names #4152 and IL-168.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/release-tip/parse.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/release-tip/check.js tests/bin-lib/release-tip/parse.test.js`, then commit with the message `Add release-tip decisions.md parser — refs #4152`.

### Task 2: arrived-commit bump part through `bumpPart`

**Files:**
- Modify: `plugin/bin/lib/release-tip/check.js`
- Test: `tests/bin-lib/release-tip/arrived.test.js`

**Interfaces:**
- Consumes: `bumpPart` (`release-local/bump.js`), `readCommits` (`release-local/commits.js`), `readBumpFlags` (`release-local/manifest.js`).
- Produces: `arrivedPart({ git, base, tip, preMajor }): { base, tip, part: 'major'|'minor'|'patch'|'none', shas: string[] }`. Here `git(args) → { status, stdout, stderr }`, and it throws `GitError { args, status, stderr }` (also exported) when `readCommits`' log fails. The function reads commits with `readCommits(stdoutGit, base, tip, { firstParent: false })`. Here `stdoutGit` adapts `git` to return stdout and throw `GitError` on a non-zero status. The flags come from `readBumpFlags((p) => …)`, whose reader runs `git(['show', `${tip}:${p}`])` and returns `null` on a non-zero status. The return is `bumpPart(commits, { preMajor, ...flags })`. `shas` are the commits' full shas.

- [ ] **Step 1: Write the failing tests** with `originWithTwoClones` (`tests/helpers/git-fixtures.js`). Commit in `work` with messages chosen per case; `git` runs `spawnSync('git', args, { cwd: fx.work, env: fx.env, encoding: 'utf8' })`.
  - `chore-only range is none`: two `chore: x` commits give `part === 'none'`, and `shas.length === 2`. This covers AC2.1.
  - `feat is minor; fix is patch; feat! is major; a BREAKING CHANGE: footer is major`. Each case gets its own range.
  - `pre-major softens a breaking marker to minor by default`: `preMajor: true` with `feat!` and no config file gives `minor`, since `readBumpFlags`' default `bump-minor-pre-major` is true.
  - `pre-major with bump-minor-pre-major false stays major`: commit `release-please-config.json` holding `{"bump-minor-pre-major": false}` at the tip. `feat!` with `preMajor: true` then gives `major`.
  - `real range from the 2026-10-24 release`: run against this repo's own checkout (`cwd` = repo root) over `1813941ecfe019b89307ea75526f2c863ffb5e1e..0ecde186ccb4a2d176d86f359699b006014852e6` and expect `part === 'minor'` with 5 shas. The independent check is `git log --format=%s` over that range, which shows one `feat:`, one `fix:`, two `chore:` and one unconventional subject. Skip the test with `t.skip` when `git cat-file -e 0ecde186c` fails, which happens in a shallow clone.
  - `unresolvable base throws GitError`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/release-tip/arrived.test.js`
  Expected: FAIL (`arrivedPart is not a function`)

- [ ] **Step 3: Implement `arrivedPart` and `GitError`**

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/release-tip/arrived.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** `Derive arrived-commit bump part through bumpPart — refs #4152`

### Task 3: the verdict engine

**Files:**
- Modify: `plugin/bin/lib/release-tip/check.js`
- Test: `tests/bin-lib/release-tip/check.test.js`

**Interfaces:**
- Consumes: Task 1's `parseReleaseLog`, `advanceText`; Task 2's `arrivedPart`, `GitError`.
- Produces: `checkReviewedTip({ decisionsText, branch, asGiven, preMajor }, { git, resolveBound, appendLog }): Verdict`.
  - `resolveBound() → { status, stdout, stderr }` is the raw result of `resolve-policy.js --run <run> release-tip-moves`.
  - `appendLog(text) → void`, which may throw.
  - `MAX_ADVANCES = 20` (exported).
  - `Verdict` always carries every key below, with `null` or `[]` where a key does not apply:
    `{ verdict: 'merge'|'delta'|'held'|'failed', reason, detail, branch, reviewedTip, step3Tip, tipSha, commits, move, bound, source, advanced: [{ from, to, commits }], arrived, arrivedLog }`

**Algorithm (the one non-obvious piece; order matters):**
1. `parseReleaseLog`. If `reviewedTip` or `step3Tip` is null, return `failed`, reason `no reviewed tip recorded`.
2. Unless `asGiven`, when `step3Tip !== reviewedTip`: `arrived = arrivedPart({ base: step3Tip, tip: reviewedTip, preMajor })`. If `arrived.part === 'major'`, return `held`, reason `re-rendered to a major after the console`, carrying `arrived`. A `GitError` returns `failed`, reason `git error`, with `detail` set to the stderr verbatim.
3. Loop, at most `MAX_ADVANCES` times:
   - `git fetch --quiet origin <branch>`. A non-zero status returns `failed`, reason `fetch failed`, with `detail` set to the stderr verbatim.
   - `git rev-parse --verify --end-of-options origin/<branch>^{commit}` gives `tipSha`. A non-zero status returns `failed`, reason `git error`.
   - If `tipSha === reviewedTip`, return `merge`.
   - `git diff --quiet <reviewedTip> <tipSha> -- :!.claude-tweaks/pipelines`:
     - Exit 0 means the move is run-dir-only. Count the commits with `git rev-list --count <reviewedTip>..<tipSha>`. Call `appendLog(advanceText(...))`, and return `failed` with reason `log write failed` if it throws. Push the advance onto `advanced`, set `reviewedTip = tipSha`, and continue.
     - Exit 1 means a code move; break out of the loop.
     - Any other exit returns `failed`, reason `git error`, with stderr verbatim.
   - When the loop runs out, return `failed`, reason `run-dir-only advances did not converge`.
4. Read the bound. Return `failed`, reason `release-tip-moves unreadable`, when:
   - `resolveBound().status !== 0`,
   - the stdout is not JSON shaped `{ 'release-tip-moves': { value, source } }`,
   - the entry carries `invalid === true`, or
   - `value` is not a non-negative integer.

   Never substitute a default.
5. `move = priorMoves + 1`. If `move > bound`, return `held`, reason `integration branch kept moving`. Its `arrivedLog` is the stdout of `git log --first-parent --oneline <step3Tip>..<tipSha>`; a non-zero status there returns `failed`, reason `git error`.
6. Otherwise return `delta`, carrying `commits` from `git rev-list --count <reviewedTip>..<tipSha>`, plus `move`, `bound` and `source`.

- [ ] **Step 1: Write the failing tests** (covers AC3.1 — one test per branch: unmoved, run-dir-only advance, move within bound, bound exceeded, unreadable lever, no reviewed tip), on `originWithTwoClones`. Each test does the following:
  - Builds `decisionsText` with a Step 3 marker whose `at reviewed tip` carries `work`'s fetched `origin/main` sha.
  - Uses `git` = `spawnSync` in `fx.work`.
  - Uses `resolveBound` = a stub returning `{ status: 0, stdout: JSON.stringify({ 'release-tip-moves': { value: 2, source: 'default' } }), stderr: '' }` unless the test varies it.
  - Uses `appendLog` = a function that pushes onto an array.

  The tests:
  - `unmoved origin → merge`: `verdict === 'merge'`, and `tipSha === reviewedTip`.
  - `code move within the bound → delta, move 1 of 2`: `other` commits `upstream.txt` and pushes. Expect `verdict === 'delta'`, `move === 1`, `bound === 2`, `source === 'default'`, `commits === 1`, and `tipSha` equal to the new origin sha.
  - `run-dir-only move advances, logs, and re-compares to merge`: `other` commits a file under `.claude-tweaks/pipelines/archive/r2/` and pushes. Expect `verdict === 'merge'`, `advanced.length === 1`, and exactly one logged line. The logged line matches `REVIEWED_TIP_RE` with the new sha and does not match `movedLineRe('main')`.
  - `run-dir-only then code move → delta from the advanced tip`.
  - `bound exceeded → held, integration branch kept moving`: give `decisionsText` two prior delta markers after Step 3, then push a code move. Expect `verdict === 'held'`, `move === 3`, and `arrivedLog` containing `upstream.txt`. Add a case with bound `0` and no prior markers, which expects `held` on the first move.
  - `bound equal to move is not exceeded`: bound 1 with no prior markers gives `delta`, move 1.
  - `unreadable lever → failed` across five stub cases: `status: 1`; `stdout: 'nope'`; `invalid: true` with `value: 2`; `value: -1`; `value: 1.5`. Each expects `reason === 'release-tip-moves unreadable'`, and `bound === null`.
  - `no reviewed tip → failed`: `decisionsText` with no Step 3 marker gives `reason === 'no reviewed tip recorded'`. It runs no git call: assert that a throwing `git` stub is never invoked.
  - `fetch failure → failed with stderr`: set `work`'s origin URL to a missing path. Expect `reason === 'fetch failed'` and a non-empty `detail`.
  - `arrived major after a delta → held`: `decisionsText` sets the Step 3 tip to base, then a delta verdict line `… at reviewed tip <sha of a feat! commit pushed by other>`, which `work` has fetched. Expect `verdict === 'held'`, `reason === 're-rendered to a major after the console'`, and `arrived.part === 'major'`.
  - `asGiven exempts the arrived major`: the same setup with `asGiven: true` gives `merge`.
  - `chore-only arrived range is none and does not hold`: the same setup with a `chore:` commit gives `merge`, and `arrived.part === 'none'`.
  - `non-converging advances → failed`: a `git` wrapper that answers `diff --quiet` with status 0 and a new fake `rev-parse` sha on every call returns `failed`, reason `run-dir-only advances did not converge`, after `MAX_ADVANCES` appends.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/release-tip/check.test.js`
  Expected: FAIL (`checkReviewedTip is not a function`)

- [ ] **Step 3: Implement `checkReviewedTip`** per the algorithm.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/release-tip/check.test.js tests/bin-lib/release-tip/parse.test.js tests/bin-lib/release-tip/arrived.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** `Add release-tip verdict engine — refs #4152`

### Task 4: the CLI wrapper and its docs rows

**Files:**
- Create: `plugin/bin/release-tip-check.js`
- Test: `tests/bin-lib/release-tip/cli.test.js`
- Modify: `docs/plugin-structure.md`. Add a `plugin/bin/lib/release-tip/` row next to the `release-preflight` row (line ~33). Add a command row next to the `release-preflight.js` command row (line ~226), naming the flags, the exit codes and the test dir.
- Modify: `docs/skill-graph.md`. Add a `bin/release-tip-check.js` row next to the `bin/release-preflight.js` row (line ~451): "Step 5's reviewed-tip comparison (#4152): one JSON verdict (`merge`/`delta`/`held`/`failed`) `execute.md` routes on."

**Interfaces:**
- Consumes: `checkReviewedTip` (Task 3), and `resolveTarget` and `appendEntry`/`formatEntry` (`lib/log-decision/append.js`).
- Produces: `run(argv, deps) → exit code`. The usage line is `release-tip-check.js --run <run-dir> --root <checkout> --branch <name> [--as]`.
  - `deps`: `{ stdout, stderr, now, cwd, mainRoot, spawn }`. `spawn` defaults to `spawnSync` with `windowsHide: true`.
  - The CLI does the following:
    - Reads `<run>/decisions.md`; a missing file is `''`.
    - Reads `preMajor` from `<run>/release-preflight.json` as `proposedVersion.ok === true && proposedVersion.value.preMajor === true`. An absent or unparseable file gives `false`.
    - Wires `git` to `spawn('git', args, { cwd: root })`.
    - Wires `resolveBound` to `spawn(process.execPath, [<this dir>/resolve-policy.js, '--run', run, 'release-tip-moves'], { cwd: root })`.
    - Wires `appendLog(text)` to `appendEntry({ runDir, section: '/release', entry: formatEntry({ status: 'AUTO', now, step: 'Step 5', text, reversibility: 'n/a (gate evaluation)' }) })`.
    - Prints `JSON.stringify(verdict)` plus a newline and returns 0.
  - Exit 2: a missing `--run`/`--root`/`--branch`, an unknown flag, or a flag with no value.
  - Exit 3: `resolveTarget({ runDir, cwd: root, mainRoot })` is not `ok`. The stderr names the reason.

- [ ] **Step 1: Write the failing tests:**
  - `missing --branch → 2`.
  - `unknown flag → 2`.
  - `run dir missing → 3`.
  - `end to end on a fixture prints a merge verdict and exits 0`: the run dir sits inside `fx.work`, passed with `mainRoot: fx.work`. Write `decisions.md` with a Step 3 marker for `work`'s origin tip and parse stdout as JSON.
  - `run-dir-only advance writes its line under ## /release in decisions.md`: re-read the file, and expect one new `- AUTO … — Step 5: origin/main advanced …` line under `## /release`.
  - `preMajor read from release-preflight.json`: an arrived `feat!` with `proposedVersion: { ok: true, value: { preMajor: true } }` gives `merge`. Without the file it gives `held`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/release-tip/cli.test.js`
  Expected: FAIL (module not found)

- [ ] **Step 3: Implement `plugin/bin/release-tip-check.js`.** Use the shebang, a header comment naming #4152/IL-168 and the exit codes, and `if (require.main === module) process.exitCode = run(process.argv.slice(2));`.

- [ ] **Step 4: Run to verify it passes, plus the bin conformance scans**
  Run: `node --test tests/bin-lib/release-tip/cli.test.js tests/bin-lib/exit-code-conformance.test.js`
  Then run `git grep -l -F windowsHide -- tests` and run each hit's suite. These are the source-scan suites that walk `plugin/bin`.
  Expected: PASS

- [ ] **Step 5: Commit** `Add release-tip-check CLI — refs #4152`

### Task 5: execute.md calls the CLI; conformance suite re-pointed; IL-168 linked

**Files:**
- Modify: `plugin/skills/release/execute.md`, the "**Reviewed-tip comparison — immediately before the merge.**" block (lines 167–251). The block keeps its heading and its placement after delta 5 and before `**Merge.**`.
- Modify: `tests/release-reviewed-tip-conformance.test.js`. This is the only test that pins this block's prose. Found by `git grep -l -F -e "no reviewed tip recorded" -e "any-short" -e "Fold pre-major" -- tests plugin`; `tests/release-review-tree-check-conformance.test.js` pins SKILL.md only.
- Modify: `docs/incident-log.md`. IL-168's last paragraph gains a sentence saying the Step 5 reviewed-tip state machine is now `plugin/bin/release-tip-check.js` (#4152). The Step 0 guard and the Step 3 classifier it names remain prose.

**Interfaces:**
- Consumes: Task 4's CLI, and Task 1's `movedLineRe`, `REVIEWED_TIP_RE` and `parseReleaseLog`, for the twin pins below.

Reviewed, no change needed (Check B scope-keyword hits; each stays true because behavior is unchanged and only its executor moves): `plugin/skills/release/SKILL.md`, `console.md`, `bookkeeping.md`, `routine-template.yml`, `_shared/autonomy-ceiling.md`, `_shared/policy-schema.md` (with `plugin/bin/lib/policy-schema.js` and `tests/policy-schema.test.js` — the `release-tip-moves` row is unchanged), `docs/releasing.md`, `docs/journeys/release-a-version.md` (Common Step 6 owns any journey note), and the historical plan/ledger files under `docs/plans/` and `docs/superpowers/plans/`, which are never rewritten.

**New block content.** These are the decisions; wording is the implementer's choice.
- Keep the intro paragraph (why compare last), the "every log line goes through `log-decision.js --section "/release"`" sentence, and the `--as` `release-held.md` warning sentence, verbatim.
- **1. Run the check.** One `bash` fence: `node "${CLAUDE_PLUGIN_ROOT}/bin/release-tip-check.js" --run "{run-dir}" --root "$RUN_ROOT" --branch {branch}`, plus a sentence that `--as` is appended when `--as` was given (it exempts the arrived-commit major hold: the shipped version is pinned by the `Release-As:` override, and Step 4's `--as` major gate measures the `--as` value, not commit parts). Then one sentence each on what it owns:
  - The reviewed tip is read from the last `at reviewed tip` line in decisions.md, never re-derived.
  - Run-dir-only advances are logged by the CLI itself, not counted.
  - The bound is read fail-closed.
  - Arrived commits are folded through `bumpPart`.

  Exit non-zero, or stdout that does not parse as one JSON object, is `failed`, reason `release-tip-check did not produce a verdict`, nothing merged.
- **2. Route on `verdict`.**
  - `merge` → log the existing unmoved line (`Step 5: origin/{branch} still at reviewed tip {short}; merging.`, `{short}` from `tipSha`) → **Merge**.
  - `failed` → `failed`, reason `{reason}` and `{detail}` verbatim, nothing merged.
  - `held` with reason `integration branch kept moving` → keep the existing `HELD` paragraph. Stage `release-held.md` through `stage-item.js`, holding the reason, version and base, bound and move, and the CLI's `arrivedLog` (the arrived commits). Suggest holding merges or raising `release-tip-moves`. Write the existing STAGED line with its `[lever: …]` field, `{m}` = `move`, `{bound}`/`{source}` from the verdict. Keep the "Step 8's HELD summary also prints that `git log` output, the arrived commits…" sentence, reworded to the `arrivedLog` field.
  - `held` with reason `re-rendered to a major after the console` → delta 5's HELD path, with the reason named `re-rendered to a major after the console — from the arrived commits {shas}, the release PR title still reads v{title-version}` (`{shas}` from `arrived.shas`).
  - `delta` → continue with steps 3–5 below.
- **3. Bring the checkout to the tip** = the old step 5, verbatim.
- **4. Delta review** = the old step 6, verbatim. It uses the delta marker line and `{m}`/`{bound}`/`{source}` from the verdict's `move`/`bound`/`source`.
- **5. Route the verdict** = the old step 7's first bullet, plus the clean/findings bullet ending at "…so a further move counts as move `{m}` + 1". Add one sentence: on that re-entry, run step 1 again — the CLI reads the delta verdict line's `at reviewed tip` and holds on a major among the arrived commits. Delete the old "On that re-entry, derive the bump part…" paragraph.
- Delete old steps 1, 2, 3, 3a and 4's counting, bound-read and `git log` fence. The STAGED line, `stage-item` fence and HELD wording move into step 2's routing above.

**Conformance suite changes** (`tests/release-reviewed-tip-conformance.test.js`):
- Delete these tests, whose behavior now lives in the Task 1–3 unit tests:
  - the fence-extraction helpers and every test that runs an execute.md fence: the four `AC1.1` tests, both `AC1.2` go-reds, the `--quiet` go-red, the four `3a:` tests and the three `bound read:` tests;
  - `move count: …` (both);
  - `placement: 3a sits between…`. Keep its last two assertions (the branch assertion and the local-change assertion precede the pull; the abort follows it) as a renamed `placement: the branch and local-change assertions precede the pull`;
  - `A13`.
- Keep the `release-tip-moves` schema test, `SKILL.md`/`console`/`routine`/`ceiling`/`bookkeeping`/`schemaDoc` FACTS, `STALE_HELD_PHRASES`, the Step 8 HELD bullet test, the Step 3 marker test, `placement: the comparison block sits after delta 5 and before Merge`, the `stopped before the console` test, the no-`switch` test (re-point its split anchors to the new step numbers), `A8` and `A12`.
- In FACTS, drop the `block` entries whose prose is deleted (their labels mention: the move count, keying on the current reviewed tip, the JSON-form read, every fail-closed clause, the strict comparator, the bound-stop `git log` literal and its failure, the silent non-zero confirm, every 3a fact, every arrived-commit derivation fact, and the step-1 line list). Keep and re-anchor the rest. Add these facts:
  - (a) the block invokes `bin/release-tip-check.js" --run "{run-dir}" --root "$RUN_ROOT" --branch {branch}`;
  - (b) each verdict is routed: `merge`, `delta`, `held`, `failed`;
  - (c) `arrivedLog` is staged in the bound stop;
  - (d) a missing or unparseable verdict is `failed`.
- Add `AC1: no hand-run state machine remains in the block` (covers AC1.1). It asserts that the block contains none of these: `fetch --quiet`, `{any-short}`, `Classify the exit`, `that carry \`origin/{branch} moved`, `resolve-policy.js" --run "{run-dir}" release-tip-moves`, `conventional-commit part`. Include a go-red that re-adds each phrase and must be caught.
- Add twin pins (prose template ↔ CLI regex):
  - `the delta marker template is what the CLI counts`: substitute `{branch}`→`main`, `{reviewed-short}`→`aaaaaaa`, `{tip-short}`→`bbbbbbb` in the block's delta-marker line. Then `movedLineRe('main')` matches it. The STAGED bound line and the CLI's `advanceText(...)` do not.
  - `the delta verdict template carries the tip the CLI reads`: substitute `{reviewed-tip}`/`{tip-sha}` with two distinct 40-hex shas in a Step 3 marker plus the delta verdict line. `parseReleaseLog(...).reviewedTip` is then the verdict's `{tip-sha}`. With the delta marker appended after it, the result is unchanged.

- [ ] **Step 1: Write the failing tests — edit the conformance suite first** (new facts, the AC1 test covering AC1.1, twin pins, deletions). Run `node --test tests/release-reviewed-tip-conformance.test.js`. Expected: FAIL on the new facts and the AC1 test, because execute.md still holds the old prose.
- [ ] **Step 2: Rewrite the execute.md block** as specified.
- [ ] **Step 3: Run**
  `node --test tests/release-reviewed-tip-conformance.test.js tests/release-review-tree-check-conformance.test.js tests/release-skill-reference-form.test.js tests/release-routine-template.test.js tests/merge-verification-gate-conformance.test.js`
  Expected: PASS. Also run `wc -c plugin/skills/release/execute.md`, which must be < 52,500.
- [ ] **Step 4: Edit IL-168 in `docs/incident-log.md`** (one sentence, as above). Then run `git grep -n -F "release-state CLI" -- docs plugin` to confirm the deferral wording is updated, not duplicated.
- [ ] **Step 5: Commit** `Route release Step 5 on release-tip-check — refs #4152`

Waived AC4.1: no plan task owns it — it is verified by `/build` Common Step 5's full-suite verification run after all tasks (`verify.js`), not by a per-task step.
