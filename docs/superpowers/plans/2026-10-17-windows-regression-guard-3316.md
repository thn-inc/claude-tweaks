# Windows Post-Merge Regression Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the full suite on `windows-latest` after every push to `main`, adjudicate failures per test against `HEAD^1` with `verify.js --baseline`, and file one `type:bug` issue naming newly failing tests and the merged PR.

**Architecture:** A new workflow (`.github/workflows/windows-regression.yml`) runs the existing `plugin/bin/verify.js` in baseline mode and hands its `report.json` to a small maintainer-side CLI (`tools/windows-regression/file-issue.js`) that decides the job's exit code and, on `main` only, files the issue. All adjudication logic already exists in `plugin/bin/lib/verify/`; this plan adds no plugin payload.

**Tech Stack:** GitHub Actions, Node 20, `node --test`, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T110950-record-3316/work/3316-spec.md`

**Scope keywords:** windows-regression, file-issue

**Premise-refs:** plugin/bin/verify.js
**Premise-refs:** plugin/bin/lib/verify/report.js
**Premise-refs:** plugin/bin/lib/verify/baseline.js
**Premise-refs:** .github/workflows/test.yml
**Premise-refs:** tools/run-tests.js
**Premise-refs:** plugin/bin/lib/merge-verification.js

## Global Constraints

- Worktree: every command runs from `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-record-3316`; a subagent starts with `cd` there and checks `pwd` + `git rev-parse --show-toplevel`.
- `.github/workflows/test.yml` stays byte-identical (AC1.1).
- The new workflow never has a `pull_request` trigger (AC1.1). Its concurrency sets `cancel-in-progress: false` (AC2.1).
- The issue filer files only when `--ref` is `refs/heads/main`.
- Issue label: `type:bug` (exists in the repo), never `ready`.
- Body passed to `gh issue create` via `--body-file -` on stdin, never inline (failure text carries backticks and `$`).
- Commit style `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_019SAiy3kgXRaxR2TDB3C4sz`; reference the record as `refs #3316`, never a closing keyword. Stage named files only; never `git reset`/`git stash`.
- Tests live in `tests/` (picked up by `tools/run-tests.js`'s `DEFAULT_ROOTS = ['tests', 'tools/upstream-drift/tests']`); a `tools/windows-regression/tests/` directory would never run.

## Build-time facts (override the spec where they conflict)

- **`workflow_dispatch` premise reversed.** GitHub dispatches `workflow_dispatch` only for a workflow present on the default branch, so AC3's throwaway-branch run cannot use it before merge. Task 4 verifies via push-triggered runs on two `ci-probe/` branches whose own commit widens `push.branches`; `workflow_dispatch:` still ships for post-merge use.
- **verify.js contract** (`plugin/bin/verify.js` ~L436-848, `lib/verify/report.js` `composeReport`, `lib/verify/baseline.js` `adjudicate`): exit 0 = effective pass, 1 = fail, 2 = usage. `report.pass` is the RAW result. `report.baselineAdjudicated` is omitted when the raw run passed; otherwise it is `{base, baseSha, eligible: true, verdict: 'pass'|'fail', attributable[], baselineFailing[], flakyPassed[], failingFiles[], timedOut[], …}` or `{base, baseSha, eligible: false, reason}`. `report.checks.tests` is `{command, exitCode, durationMs, logPath, summary, failingRegion (string|null), timedOut?, spawnError?}`.
- **PR lookup** (probed live 2026-10-17): `gh api repos/{owner}/{repo}/commits/{sha}/pulls` returns every PR containing the commit, open ones included — unmerged commit `76128f3fa` returned 7 PRs (#3369 … #3390); squash-merge commit `77ed997bf` on `main` returned exactly `[{number: 3369, merged_at: "2026-10-17T10:16:13Z", …}]`. Pick the entry whose `merged_at` is non-null; none → `unknown`.
- **merge-verification derivation is unaffected:** `plugin/bin/lib/merge-verification.js` keys on `PR_TRIGGERS = {pull_request, pull_request_target}`; the new workflow has neither, and `test.yml` already supplies the PR trigger.
- **Docs:** no file lists `tools/` CLIs or `test.yml` (`grep -n "tools/\|\.github" docs/plugin-structure.md` → only the unrelated `mirror-marketplace.yml` row), so no docs change.

## Review Focus

1. A Windows `failingRegion` names files with backslashes and absolute paths while `attributable[]` may not — excerpt matching must normalize `\` → `/` and match on the path suffix, or every excerpt silently falls back to "file alone". Pinned in Task 1 (`excerpt matches a backslash-absolute TAP location`).
2. A failed run whose adjudication crashed (`eligible: false`) or never ran (no `baselineAdjudicated`) must still go red and, on `main`, still file — never read as a pass. Pinned in Task 1.
3. `report.json` that parses to `null`, an array, or a number must take the unreadable path (exit 1), not throw. Pinned in Task 1.
4. An issue body over GitHub's 65,536-character limit makes `gh issue create` fail — cap the composed body at 60,000 chars with a truncation note. Pinned in Task 1.
5. A trailing bare value flag (`--report` as the last argv element) must exit 2, not crash. Pinned in Task 1.

---

### Task 1: The issue filer CLI

**Files:**
- Create: `tools/windows-regression/file-issue.js`
- Test: `tests/windows-regression-file-issue.test.js`

**Interfaces:**
- Produces (exported from `tools/windows-regression/file-issue.js`):
  - `run(argv: string[], deps) -> 0|1|2` — sync. Exit vocabulary, stated in the header comment and `USAGE`: **0** verify outcome is a pass (nothing filed), **1** verify outcome is a failure — whether or not the issue was filed — or the report is missing/unreadable, or `gh issue create` failed; **2** malformed invocation.
  - `deps = { readFile(path) -> string, gh(args: string[], input?: string) -> string /* stdout; throws on non-zero */, stdout(s), stderr(s) }`; `defaultDeps()` wires `fs.readFileSync` and `execFileSync('gh', args, { input, encoding: 'utf8' })`.
  - `classify(report) -> { outcome: 'pass'|'fail', adjudicated: boolean, attributable: string[], reason: string|null }` — `pass` when `report.pass === true` or `baselineAdjudicated.verdict === 'pass'`; `adjudicated` false when `baselineAdjudicated` is absent or `eligible === false` (then `reason` = its `reason`, or `'baseline adjudication did not run'`).
  - `findMergedPr(pulls: object[]) -> { number, url } | null` — first entry with non-null `merged_at` (`url` from `html_url`).
  - `composeIssue({ report, verdict, sha, pr, runUrl }) -> { title, body }`.
- Flags: `--report <path> --ref <ref> --sha <sha> --repo <owner/name> --run-url <url>`, all required; `--help` prints `USAGE`, exits 0.

Follow `tools/upstream-drift/run.js`'s file shape (header comment, `'use strict'`, `run`/`main` split, `if (require.main === module)` guard) and `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: `process.exitCode = run(...)`, never `process.exit`; every `deps` call that can throw is caught into the exit vocabulary; validate each value flag inside the arg parser (`typeof v !== 'string' || !v.trim() || v.startsWith('--')` → exit 2).

Behaviour, in order:
1. Usage error → exit 2.
2. Read + `JSON.parse` the report; unreadable, or not a plain object (`null`, array, number) → stderr names it, exit 1, file nothing.
3. `classify`. `pass` → stdout `windows-regression: pass — nothing to file`, exit 0.
4. `fail` and `--ref` ≠ `refs/heads/main` → stdout `windows-regression: fail on {ref} — not filing (main only)`, exit 1.
5. `fail` on main → PR lookup: `gh(['api', `repos/${repo}/commits/${sha}/pulls`])`, parse, `findMergedPr`; a throw or parse failure → `pr = null` (body says `unknown`), never stops filing.
6. `composeIssue`, then `gh(['issue', 'create', '--repo', repo, '--label', 'type:bug', '--title', title, '--body-file', '-'], body)`; stdout the created URL; exit 1. A throw → stderr `gh issue create failed: …`, exit 1.

`composeIssue` text (exact):
- Title, adjudicated: `Windows regression: {N} test file(s) newly failing after {sha.slice(0, 9)}`; not adjudicated: `Windows regression: tests failing after {sha.slice(0, 9)} (not adjudicated)`.
- Body sections: a lead line `The post-merge Windows check failed on commit {sha}.`; `**Merged PR:** #{n} ({url})` or `**Merged PR:** unknown`; `**Run:** {runUrl}`; then either `### Newly failing test files` with one `- \`{file}\`` bullet per attributable file, each followed by a fenced excerpt (the first `failingRegion` line whose `\`→`/`-normalized text contains the file's normalized path, plus the next 10 lines) when found, or `### Failing output (baseline adjudication did not run: {reason})` with the first 200 lines of `failingRegion` fenced (or `(no failing output captured)`); a footer `_Filed by .github/workflows/windows-regression.yml — failures were compared against the previous commit on main (verify.js --baseline HEAD^1). Shape it with /claude-tweaks:specify before building._`. Body capped at 60,000 chars; when cut, end with `\n\n…(truncated — see the run's verify-report artifact)`.

- [ ] **Step 1: Write the failing tests** in `tests/windows-regression-file-issue.test.js` (size like `tests/revise-pr-summary-cli.test.js`, ~130 lines; in-process `run(argv, fakeDeps)` where the fake `gh` records calls and returns canned output or throws). Report fixtures are small objects built in the test. Tests, each name carrying its clause id:
  - `AC5.1: a raw-pass report files nothing and exits 0` — `report.pass: true`; `run` → 0; zero `gh` calls.
  - `AC5.2: a baseline-adjudicated pass files nothing and exits 0` — `pass: false`, `baselineAdjudicated: { eligible: true, verdict: 'pass', attributable: [] }`; → 0; zero `gh` calls.
  - `AC5.3: attributable failures compose title, file list, merged PR and run URL` — `verdict: 'fail', attributable: ['tests/a.test.js']`, ref main, `gh api` returns `[{number: 7, merged_at: null, html_url: 'u7'}, {number: 9, merged_at: '2026-10-17T00:00:00Z', html_url: 'https://github.com/o/r/pull/9'}]`; → 1; the `issue create` call's `--title` equals `Windows regression: 1 test file(s) newly failing after abcdef123` (sha `abcdef1234567`), its stdin contains `` `tests/a.test.js` ``, `**Merged PR:** #9 (https://github.com/o/r/pull/9)` and the run URL; `--label` is `type:bug`.
  - `AC5.4: a failed PR lookup composes unknown` — `gh api` throws; issue still created; stdin contains `**Merged PR:** unknown`.
  - `AC5.5: a non-main ref files nothing and exits 1` — ref `refs/heads/ci-probe/3316-planted`, failing verdict; → 1; zero `gh` calls.
  - `AC5.6: a gh issue create failure exits non-zero` — `issue create` throws; → 1; stderr contains `gh issue create failed`.
  - `fail-closed: ineligible adjudication still files, titled not adjudicated` — `baselineAdjudicated: { eligible: false, reason: 'adjudication error: boom' }`, `failingRegion: 'not ok 1 - x'`; issue title ends `(not adjudicated)`, body contains `baseline adjudication did not run: adjudication error: boom` and `not ok 1 - x`.
  - `fail-closed: a failed run with no baselineAdjudicated still files` — same assertions with reason `baseline adjudication did not run`.
  - `excerpt matches a backslash-absolute TAP location` — attributable `tests/bin-lib/wrap-up/ledger-write.test.js`, `failingRegion` containing `  location: 'D:\\a\\repo\\repo\\tests\\bin-lib\\wrap-up\\ledger-write.test.js:27:3'`; body contains that location line inside a fence.
  - `unreadable report: null JSON exits 1, files nothing` — `readFile` returns `'null'`; → 1; zero `gh` calls. Plus missing file (`readFile` throws) → 1.
  - `body over 60000 chars is truncated with a note` — `failingRegion` of 300 lines × 400 chars, not adjudicated; stdin length ≤ 60,000 + note length and ends with the truncation note.
  - `usage: a trailing bare --report exits 2` — argv ending in `--report`; → 2. Plus missing `--repo` → 2.
  - `findMergedPr picks the merged entry and returns null when none merged` — direct unit assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL with `Cannot find module '../tools/windows-regression/file-issue'`

- [ ] **Step 3: Implement `tools/windows-regression/file-issue.js`** to the Interfaces and behaviour above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js
git commit -m "Add the Windows regression issue filer — reads verify's report and files one type:bug issue on main

refs #3316

Claude-Session: https://claude.ai/code/session_019SAiy3kgXRaxR2TDB3C4sz"
```

### Task 2: The post-merge Windows workflow

**Files:**
- Create: `.github/workflows/windows-regression.yml`
- Test: `tests/windows-regression-file-issue.test.js` (append workflow-shape tests to Task 1's file)

**Interfaces:**
- Consumes: Task 1's CLI flags (`--report --ref --sha --repo --run-url`) and exit vocabulary (the job's result is the filer's exit code).

Workflow content (decided here; the implementer writes the YAML):
- `name: windows-regression`; `on: { push: { branches: [main] }, workflow_dispatch: {} }`.
- `concurrency: { group: windows-regression-${{ github.ref }}, cancel-in-progress: false }`.
- `permissions: { contents: read, issues: write, pull-requests: read }`.
- One job `windows`: `runs-on: windows-latest`, `timeout-minutes: 60`, `env` copied verbatim from `test.yml`'s job env (the four `GIT_*` identity vars and `GH_TOKEN: ${{ github.token }}`, with its two comments), `defaults: { run: { shell: bash } }`.
- Steps in order: `git config --global core.longpaths true` (named "Enable long paths", before checkout — `.claude-tweaks/pipelines/**/work/` paths are deep); `actions/checkout@v4` with `fetch-depth: 0`; `actions/setup-node@v4` with `node-version: 20`; "Line-ending diagnostics" printing `git config core.autocrlf` and `git ls-files --eol -- README.md`; "Verify against the previous commit" with `id: verify`, `continue-on-error: true`, running `node plugin/bin/verify.js --cmd tests="npm test" --baseline HEAD^1 --baseline-cmd tests="node --test {file}" --json "$RUNNER_TEMP/verify-report.json" --log-dir "$RUNNER_TEMP/verify-logs" --no-stamp`; `actions/upload-artifact@v4` with `if: always()`, `name: verify-report`, paths `${{ runner.temp }}/verify-report.json` and `${{ runner.temp }}/verify-logs`, `if-no-files-found: warn`; "File an issue for new failures" with `if: always()` running `node tools/windows-regression/file-issue.js --report "$RUNNER_TEMP/verify-report.json" --ref "$GITHUB_REF" --sha "$GITHUB_SHA" --repo "$GITHUB_REPOSITORY" --run-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"`.
- A short header comment: why post-merge only (PR merge gate waits on every check), why `HEAD^1` (squash merges keep `main` linear), and that the filer's exit code decides the job.

- [ ] **Step 1: Append the failing workflow-shape tests** to `tests/windows-regression-file-issue.test.js`, reading `.github/workflows/windows-regression.yml` as text:
  - `AC1.1: the windows-regression workflow has no pull_request trigger` — text does not match `/pull_request/`; matches `/push:\s*\n\s*branches:\s*\[main\]/`.
  - `AC2.1: concurrency sets cancel-in-progress: false` — matches `/cancel-in-progress:\s*false/`.
  - `the filer step runs under if: always() after the verify step` — `indexOf('id: verify')` < `indexOf('file-issue.js')`, and the text between them contains `if: always()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL with `ENOENT` on `.github/workflows/windows-regression.yml`

- [ ] **Step 3: Write `.github/workflows/windows-regression.yml`** as specified above.

- [ ] **Step 4: Run the tests, and confirm `test.yml` is untouched**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS
Run: `git diff --stat origin/main -- .github/workflows/test.yml`
Expected: no output (AC1.1's byte-identical half)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/windows-regression.yml tests/windows-regression-file-issue.test.js
git commit -m "Add the post-merge Windows regression workflow — windows-latest, verify.js --baseline HEAD^1, issue on new failures

refs #3316

Claude-Session: https://claude.ai/code/session_019SAiy3kgXRaxR2TDB3C4sz"
```

### Task 3: Real-input probe (main session, before the whole-branch review)

No commit — evidence for the ledger. Runs in the main session.

- [ ] **Step 1:** On a scratch branch `probe/3316-real-report` cut from the feature tip in a separate scratch worktree (`git worktree add` under the scratchpad, never this worktree), commit one failing assertion appended to `tests/windows-regression-file-issue.test.js` (`test('probe', () => assert.equal(1, 2))`).
- [ ] **Step 2:** In that scratch worktree run `node plugin/bin/verify.js --cmd tests="node --test tests/windows-regression-file-issue.test.js" --baseline HEAD^1 --baseline-cmd tests="node --test {file}" --json <scratchpad>/real-report.json --no-stamp`; expect exit 1 and `baselineAdjudicated.attributable` = `['tests/windows-regression-file-issue.test.js']` (the file passes at `HEAD^1`).
- [ ] **Step 3:** Run `node tools/windows-regression/file-issue.js --report <scratchpad>/real-report.json --ref refs/heads/probe --sha $(git rev-parse HEAD) --repo thn-inc/claude-tweaks --run-url local`; expect exit 1 and `windows-regression: fail on refs/heads/probe — not filing (main only)`. Then call `composeIssue` on the same report via `node -e` and confirm the body names the file and carries an excerpt (the TAP `location:` line). Record both outputs verbatim in the ledger.
- [ ] **Step 4:** Remove the scratch worktree (`git worktree remove`) and delete the local `probe/3316-real-report` branch.

### Task 4: Live Windows runs on throwaway branches (main session — needs `gh` and pushes)

Resolves AC3.1-AC3.3 and the two `ASSUMPTION — verify at build:` gotchas. Runs after Tasks 1-2 are committed and pushed.

- [ ] **Step 1:** In a scratch worktree from the feature tip, branch `ci-probe/3316-clean`; commit one change to `.github/workflows/windows-regression.yml`: `branches: [main, 'ci-probe/**']`. Push it (`git push origin ci-probe/3316-clean`).
- [ ] **Step 2:** On top of that, branch `ci-probe/3316-planted`; in `tests/bin-lib/wrap-up/ledger-write.test.js` line 27 replace `path.join('/run', 'ledger.md')` (the expected value only) with `'/run/ledger.md'`; confirm `node --test tests/bin-lib/wrap-up/ledger-write.test.js` still passes locally; commit and push.
- [ ] **Step 3:** Watch both runs (`gh run list --workflow windows-regression.yml --branch {b}`, then a Monitor/background wait — never a sleep loop). Expected: clean run green (any failures adjudicated baseline/flaky) (AC3.2); planted run red with `tests/bin-lib/wrap-up/ledger-write.test.js` in the uploaded report's `baselineAdjudicated.attributable` (`gh run download {id} -n verify-report`) and the filer printing `not filing (main only)` (AC3.1). No issue filed by either run.
- [ ] **Step 4:** From the clean run's log, copy the "Line-ending diagnostics" output and the job duration. Record in the ledger: both run URLs, durations, the `core.autocrlf` value and `ls-files --eol` line, and whether 60 minutes needs adjusting (if the clean run exceeded ~45 minutes, raise `timeout-minutes` in a follow-up commit on the feature branch). Add both run URLs to the PR body (AC3.3).
- [ ] **Step 5:** Delete both remote branches (`git push origin --delete ci-probe/3316-clean`, same for `-planted`), the scratch worktree and local branches.

If a run fails for a reason outside the separator class (a launcher, CRLF or runner problem that isn't adjudicated baseline), record it in the ledger as `open` with the run URL — do not widen this record to fix it (spec Gotcha).

## Post-merge steps (wrap-up, not build tasks)

- **AC4.1/AC4.2:** after the PR merges, wait for the first `windows-regression` run on `main`; quote its URL and duration (green, or red with a genuinely attributable issue filed).
- Comment on #3318 linking that run as an available Windows `npm test` checkout (`refs #3318`; do not close it).

## Coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2 test `AC1.1: …` + Step 4 `git diff` |
| AC2.1 | Task 2 test `AC2.1: …` |
| AC3.1, AC3.2, AC3.3 | Task 4 (live runs) |
| AC4.1, AC4.2 | Post-merge steps |
| AC5.1-AC5.6 | Task 1 tests `AC5.1` … `AC5.6` |
| AC6.1 | Common Step 5 full `npm test` |

Waived AC3.1: live Windows run, not a unit test — Task 4 evidence.
Waived AC3.2: live Windows run — Task 4 evidence.
Waived AC3.3: PR-body content — Task 4 Step 4.
Waived AC4.1: post-merge — wrap-up.
Waived AC4.2: post-merge — wrap-up.
Waived AC6.1: suite-level — Common Step 5.
