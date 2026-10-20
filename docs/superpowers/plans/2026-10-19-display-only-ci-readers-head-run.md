# Display-only CI readers route through pr-checks.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The review console, the settle-parked table and the pr-scan arm filter classify CI through `bin/pr-checks.js`, so a green rollup with an unfinished head run shows as pending instead of passing.

**Architecture:** `bin/pr-checks.js` already does Step 2.5's head-sha runs read and `classifyRollup` for a run's own PR (`--run`). This plan adds a `--pr <n>` mode for readers that hold a PR number but no local checkout of its branch (settle-parked, pr-scan item 9). The wrap-up pack's `pr` probe spawns `pr-checks.js --run` and attaches the verdict as `ci`, which the review console reads. One classification, three entry points. No reader restates the rollup read any more.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T195013-record-3469/work/3469-spec.md`

Scope keywords: statusCheckRollup

Premise-refs: plugin/bin/pr-checks.js
Premise-refs: plugin/bin/lib/pr-checks/classify.js
Premise-refs: plugin/bin/lib/wrap-up/pack.js

## Global Constraints

- Classification rules are `_shared/pr-first-merge.md` Step 2.5's. Its code twin is `classifyRollup` in `plugin/bin/lib/pr-checks/classify.js`. Do not change `classify.js`.
- `pr-checks.js` status-as-data contract stays: exit 0 in every state, 2 malformed invocation, 3 run dir missing/unanchored (`--run` only).
- `plugin/skills/**/*.md` Read-limit rail is `RAIL_BYTES` = 52,500 B. `_shared/github-pr-scan.md` is 46,020 B at base (5.5 KB headroom, nearCeiling at 47,250), so keep its addition under ~1,000 B.
- `tests/issue-claims-pr-scan-composition.test.js` pins `PR_SCAN_UNARMED` at exactly 15 matching lines in `github-pr-scan.md`. The item-9 edit must not add or remove a line containing `PR_SCAN_UNARMED`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3469`, never `closes`/`fixes`.

## Review Focus

1. `--pr` combined with `--run`, or `--pr` with a non-positive-integer value. Expected: exit 2 with usage, no gh call (Task 1 tests).
2. `--pr` while `gh` is absent. Expected: `state: gh-absent`, never green (Task 1 test).
3. The pack's `pr-checks.js` spawn fails or prints non-JSON. Expected: `pack.pr` stays `ok: true` with `value.ci = {state: 'read-failed', reason}`. The console treats that as never green (Task 2 test).
4. A pr-scan candidate whose verdict is `read-failed`/`pending`/`red`. Expected: dropped from the arm candidates, with a stderr note naming the state (Task 4 conformance assertion on the snippet).
5. A settle-parked verdict of `read-failed`/`gh-absent`. Expected: renders `unavailable`, never `passing` (Task 3 conformance assertion).

Sole-site / consumer enumeration (grep `git grep -n statusCheckRollup -- plugin`): `pack.js:633` (Task 2), `review-console-interactive.md:41` (Task 2), `settle-parked.md:37,57` (Task 3), `github-pr-scan.md:34,97,111` (Task 4: item 9 only, lines 97/111). Already head-run-aware since #3405 (no change): `pr-first-merge.md`, `release/execute.md`, `dispatch/close-out.md`, `dispatch/resume-confirmation.md`, `tidy/actions-github-issues.md`. Out of scope, and filed as a follow-up: `github-pr-scan.md` item 1 (`current-pr` scope) and items 1/3 (`gh pr checks` summaries, repo-wide scope). `pack.pr` consumers (`git grep -n "pack\.pr" -- plugin`): only `review-console-interactive.md:42`.

---

### Task 1: `pr-checks.js --pr <n>` mode

**Files:**
- Modify: `plugin/bin/pr-checks.js`
- Modify: `docs/plugin-structure.md:178` (CLI usage line: add `--pr <n>`)
- Test: `tests/bin-lib/pr-checks/cli.test.js`

**Interfaces:**
- Produces: `node bin/pr-checks.js --pr <n>` prints the same JSON shape as `--run`, with `pr: n` and `localHead: null`. The PR's own `headRefOid` stands in for the local HEAD, so `stale` cannot occur. States: `red | inherited-red | pending | green | no-ci | read-failed | gh-absent`. `parseArgs` returns `{ run, pr, help }` (`pr` is a number or null).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pr-checks/cli.test.js` (reuse `fixture`/`makeDeps`; for `--pr`, `git` answers only `rev-parse --show-toplevel`. A `rev-parse HEAD` call must throw, which proves `--pr` never reads local HEAD):
  - `parseArgs`: `parseArgs(['--run','x'])` deep-equals `{ run: 'x', pr: null, help: false }` (update the existing assertion). `parseArgs(['--pr','12']).pr === 12`.
  - `'--pr and --run together is exit 2'`: `run(['--pr','7','--run',runDir])` → 2, zero gh calls.
  - `'--pr with a non-integer is exit 2'`: `--pr abc` and `--pr 0` → 2.
  - `'AC1.1: --pr reads a green rollup with an in-progress head run as pending'`: gh `pr view` returns `{headRefOid: HEAD, statusCheckRollup:[{name:'lint',status:'COMPLETED',conclusion:'SUCCESS'}], baseRefName:'main'}`, gh `run list` returns `[{name:'test',workflowName:'test',status:'in_progress',conclusion:'',url:'u'}]` → exit 0, `state === 'pending'`, `pending` includes `'test'`, `pr === 7`, `localHead === null`. Assert `ghCalls[0]` deep-equals `['pr','view','7','--json','headRefOid,statusCheckRollup,baseRefName']` and the run list call carries `'--commit', HEAD`.
  - `'--pr green when rollup and head runs are complete'`: same with the head run `completed`/`success` → `green`.
  - `'--pr with gh absent is gh-absent'`: `ghAvailable: () => false` → `state: 'gh-absent'`, `pr: 7`, no gh calls.
  - `'--pr: a failed head-runs read on a non-red verdict is read-failed'`: `run list` throws → `state: 'read-failed'`, `reason` matches `/gh run list failed/`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/pr-checks/cli.test.js`
  Expected: FAIL (the `--pr` cases report `unknown argument: --pr`).

- [ ] **Step 3: Implement.** In `pr-checks.js`: `parseArgs` accepts `--pr <n>` (a positive integer, otherwise `{error}`) and errors when both `--run` and `--pr` are given. `run` requires exactly one of them. Extract the shared tail (gh pr view → head runs when `headRefOid === localHead` → `hasPullRequestCi` → `classifyRollup` → red-only `readBase` → runs-failure rule → `report`) into `classifyPr(deps, n, localHead)`. `--run` calls it with the `git rev-parse HEAD` value, exactly as today. `--pr` checks `ghAvailable` (→ `gh-absent`), then calls `classifyPr(deps, n, null)`. A null `localHead` means "use the view's `headRefOid`" for both the runs-read condition and `classifyRollup`'s `localHead`, and the reported `localHead` stays `null`. Update the header comment and `USAGE` (`usage: pr-checks.js --run <run-dir> | --pr <n> [--help]`). The existing `--help` test matches `/usage: pr-checks\.js --run <run-dir>/`, which still matches. Update `docs/plugin-structure.md:178`'s usage line to name `--pr <n>` ("classify a PR by number, no run dir, local HEAD not compared, #3469").

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/pr-checks/cli.test.js tests/bin-lib/pr-checks/classify.test.js tests/pr-check-gate-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Real-input probe.** From the worktree, run `node plugin/bin/pr-checks.js --pr 3640` and `node plugin/bin/pr-checks.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-19T195013-record-3469"`. Record both JSON lines in the commit body. Expected: the same `state` from both (the branch is pushed), `localHead` null versus a sha.

- [ ] **Step 6: Commit** — `Add pr-checks.js --pr mode — classify a PR by number without a run dir`.

### Task 2: Wrap-up pack `pr.ci` + review console reads it

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js:631-635` (the `pr` probe)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md:39-51`
- Test: `tests/bin-lib/wrap-up/pack.test.js`
- Test: Create `tests/display-ci-readers-conformance.test.js`

**Interfaces:**
- Consumes: `pr-checks.js --run <run-dir>` (existing) JSON.
- Produces: `pack.pr.value` = the `gh pr view` JSON (unchanged) plus `ci`: the parsed `pr-checks.js` JSON line. On spawn failure or unparseable output, `ci = { state: 'read-failed', reason }`, and `pack.pr` stays `ok: true`.

- [ ] **Step 1: Write the failing tests.**
  - `pack.test.js` `'pr probe attaches the pr-checks.js --run verdict as ci (#3469)'`: `okDeps` with an `execFile` override answering `node …pr-checks.js` with `{"state":"pending","pending":["test"],"failing":[]}`. Assert the argv equals `[<…>/pr-checks.js, '--run', runDir]` (the `inputs.runDir`), and that `pack.pr.value.ci.state === 'pending'` and `pack.pr.value.state === 'OPEN'`.
  - `pack.test.js` `'pr probe: a failed pr-checks.js spawn is ci read-failed, pr still ok (#3469)'`: the node call throws → `pack.pr.ok === true`, `pack.pr.value.ci.state === 'read-failed'`, `ci.reason` is a non-empty string. (The existing `okDeps` default throws on the unknown call, so add an explicit `pr-checks.js` branch to `okDeps` that returns `{"state":"green","failing":[],"pending":[]}`. That keeps every other test's `pr` probe on the success path.)
  - New `tests/display-ci-readers-conformance.test.js`, `'AC1.1: review console classifies CI from pack.pr.value.ci (pr-checks.js), not the rollup alone'`: slice `review-console-interactive.md` from `**\`integration-model: pr-first\`** — read the PR's live CI status` to `Exactly one of options 1 and 2`. Assert the slice includes `pack.pr.value.ci`, `pr-checks.js" --run`, `pending`, and `read-failed`. Assert it no longer includes `--json state,mergeStateStatus,headRefOid,statusCheckRollup`. Assert option 1's Recommended clause names `stale` alongside green/pending, and option 2's names `inherited-red`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/display-ci-readers-conformance.test.js`
  Expected: FAIL (no `ci` field; the slice still names the rollup command).

- [ ] **Step 3: Implement.**
  - `pack.js` `pr` probe: after the view, `deps.execFile('node', [path.join(BIN, 'pr-checks.js'), '--run', String(inputs.runDir)], { cwd: inputs.worktree, ...EXEC_OPTS })`. Parse the stdout's last non-empty line as JSON, and on any throw set `ci = { state: 'read-failed', reason: <message> }`. Return `{ ...view, ci }`. Add a one-line comment: #3469, the rollup alone reads a partial run green.
  - `review-console-interactive.md` pr-first paragraph: replace the inline `gh pr view … statusCheckRollup` read with: read `pack.pr.value.ci`, the `bin/pr-checks.js` verdict (Step 2.5's state read plus its head-run read, classified by `classifyRollup`). When the pack file is absent, run `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --run "$PIPELINE_RUN_DIR"` itself. Mapping: `green`/`no-ci`/`pending`/`stale` → option 1 Recommended; `red`/`inherited-red` → option 2 Recommended; `read-failed`/`gh-absent`/`no-pr`, or `pack.pr` `ok: false` → Step 2.5's `state-read-failed`, never green, so option 2 carries Recommended. Keep the existing cross-reference to dispatch's "Confirm before resuming" sentence. In options 1/2, change "when CI reads green or pending" to "when `ci.state` is green, no-ci, pending or stale" and "when CI reads red" to "when `ci.state` is red or inherited-red, or the read failed".

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/pack-cli.test.js tests/wrap-up-pack-conformance.test.js tests/display-ci-readers-conformance.test.js tests/console-on-pr.test.js tests/console-execution.test.js`
  Expected: PASS. `pack-cli.test.js`'s execFile fake answers `node` calls with `{"suite":{"ran":false}}`, which parses, so `ci` is that object. Its tests assert keys only.

- [ ] **Step 5: Commit** — `Route the review console's CI read through pr-checks.js — pack.pr carries the verdict`.

### Task 3: settle-parked CI status via `pr-checks.js --pr`

**Files:**
- Modify: `plugin/skills/dispatch/settle-parked.md:31-57`
- Test: `tests/display-ci-readers-conformance.test.js`

**Interfaces:** Consumes Task 1's `--pr <n>` mode.

- [ ] **Step 1: Write the failing test** `'AC1.1: settle-parked reads CI through pr-checks.js --pr and maps its states'`: slice from `## Step 2:` to `## Step 4:`. Assert it includes `pr-checks.js" --pr {n}` and does not include `statusCheckRollup`. Assert the CI status bullet maps `pending` → `pending`, `green`/`no-ci` → `passing`, `red`/`inherited-red` → `failing`, and `read-failed`/`gh-absent` → `unavailable` (assert each of `unavailable`, `inherited-red` and `no-ci` is present).
- [ ] **Step 2: Run** `node --test tests/display-ci-readers-conformance.test.js` → FAIL.
- [ ] **Step 3: Implement.** Step 2 item 2 becomes **Fresh CI read:** `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --pr {n}`. Explain why: it is Step 2.5's state read plus its head-run read, classified once by `classifyRollup`, and `--pr` because the dispatching session's own HEAD is not this PR's branch, so `--run` would read `stale`. Step 3's CI status bullet gets the mapping above, and keeps "same vocabulary `resume-confirmation.md` uses" (plus `unavailable`, which that file already uses for gh-absent).
- [ ] **Step 4: Run** `node --test tests/display-ci-readers-conformance.test.js tests/dispatch-settle-parked-prose.test.js` → PASS.
- [ ] **Step 5: Commit** — `Read settle-parked's CI status through pr-checks.js --pr — a partial rollup is pending`.

### Task 4: pr-scan item 9's arm filter requires a green `pr-checks.js` verdict

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md:100-122` (item 9's first fence: a new, second `node -e` after the existing candidate filter)
- Modify: `tests/issue-claims-pr-scan-composition.test.js:55` (the `PR_SCAN_UNARMED` line-count pin 15 → 17, comment naming #3469's two lines)
- Test: `tests/display-ci-readers-conformance.test.js`

**Interfaces:** Consumes Task 1's `--pr <n>` mode.

**Why a separate `node -e`:** `tests/sweep-backstop.test.js` extracts item 9's first `node -e` (`extractNodeScripts(ITEM9)[0]`) and runs it for real against fixture PRs, with only `$PR_SCAN_UNARMED*` substituted. A `pr-checks.js` call inside that script would spawn an unsubstituted `${CLAUDE_PLUGIN_ROOT}` path, read every fixture as `read-failed`, and turn its two positive cases red. Leave script [0] byte-identical. The CI filter becomes script [1], which runs right after it in the same fence. sweep-backstop's syntax check covers it automatically.

- [ ] **Step 1: Write the failing tests** in `tests/display-ci-readers-conformance.test.js`:
  - `'AC1.1: pr-scan item 9 gates candidates on a pr-checks.js --pr verdict'`: slice from `9. **Unarmed ready PR**` to `10. **Unsettled run**`. Assert it includes `pr-checks.js` and `'--pr'`, and that the existing `NON_BLOCKING` pre-filter is still present.
  - `'AC1.1: item 9 CI filter keeps green/no-ci, drops pending, red and a failed read'` (behavioural, reaches the gate): extract item 9's `node -e` scripts with the same regex `sweep-backstop.test.js` uses (`/node -e "\n([\s\S]*?)\n\s*"/g`, unescaping `\"` and `\$`), and take index [1]. Write a stub `bin/pr-checks.js` into a temp plugin root. It prints `{"state":"green"}` for `--pr 1`, `{"state":"no-ci"}` for 2, and `{"state":"pending"}` for 3, prints `{"state":"red"}` for 4, and exits 1 for 5. Substitute `${CLAUDE_PLUGIN_ROOT}` with the temp root and `$PR_SCAN_UNARMED_CANDIDATES` with a temp candidates file holding PRs 1-5, then run it. Assert the rewritten candidates file holds exactly `[1, 2]` and that stderr names PR #3 `pending` and PR #5 `read-failed`.
  - `'github-pr-scan.md stays under the nearCeiling'`: `fs.statSync(file).size < 47250`.
- [ ] **Step 2: Run** `node --test tests/display-ci-readers-conformance.test.js` → FAIL.
- [ ] **Step 3: Implement.** After item 9's first `node -e` (still inside the same fence), add a second `node -e` that: requires `fs` and `child_process`'s `execFileSync`; reads `require('$PR_SCAN_UNARMED_CANDIDATES')`; and, for each candidate, parses `execFileSync('node', ['${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js', '--pr', String(pr.number)], { encoding: 'utf8' })`'s `.state`. Any throw counts as `'read-failed'`. It keeps the PR only when the state is `'green'` or `'no-ci'`, and otherwise `console.error('[pr-unarmed] PR #' + n + ' not offered: CI ' + state)`. It then writes the kept list back to `'$PR_SCAN_UNARMED_CANDIDATES'`. Add a short JS comment: the rollup lists only registered checks, and `pr-checks.js` adds the head-sha runs (Step 2.5, #3469). Add one prose sentence after the fence: candidates also need a `green`/`no-ci` `pr-checks.js --pr` verdict. Exactly two new lines contain `PR_SCAN_UNARMED`, so update the count pin to 17. Keep the addition under ~900 B.
- [ ] **Step 4: Run** `node --test tests/display-ci-readers-conformance.test.js tests/issue-claims-pr-scan-composition.test.js tests/sweep-backstop.test.js tests/github-pr-scan-unsettled-node-budget.test.js tests/pr-first-merge.test.js` → PASS.
- [ ] **Step 5: Commit** — `Gate pr-scan's arm candidates on pr-checks.js --pr — a partial rollup is not green`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — route readers through one shared classification | Tasks 1-4 (`pr-checks.js` is the one classification) |
| Deliverable 2 — pin each reader with a conformance test, sliced | Task 2 (console + pack unit), Task 3 (settle-parked), Task 4 (pr-scan) |
| AC1.1 — green rollup + not-yet-completed head run → pending in console, settle-parked table, pr-scan arm filter | Task 1's AC1.1 behavioural test; Tasks 2-4 AC1.1 conformance tests |
