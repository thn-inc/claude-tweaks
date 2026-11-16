# Remove Dead Code From the Four Health CLIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the code in the four health CLIs and `lib/code-health/` that nothing reaches, keep the legacy fingerprint-marker reader with a recorded removal condition, and make the listed comments state what the code does now.

**Architecture:** Delete in dependency order: callers first (the test's `main` calls, the dispatch branch), then the functions, then the modules. Every edit anchors on a function, flag or comment name, never a line number: #5528 and #5529 landed after the spec's line numbers were taken (`code-health.js` moved by about +47 lines). The legacy marker reader (`FP_RE_LEGACY`) is the one thing kept. No new guard is added to `fingerprint()`.

**Tech Stack:** Node 18+ (CI runs Node 20), `node --test`, CommonJS, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153417-record-5536/work/5536-spec.md` (record #5536, unit 1.3 of the 2026-11-15 audit simplification design).

## Global Constraints

- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-record-5536`, branch `worktree-flow-record-5536`. Before any commit, `pwd` and `git rev-parse --show-toplevel` must both print that path. Run `git` as plain `git ...` in the worktree (never `git -C`, never inside `$(...)`), one plain command per Bash call, and write multi-line text (commit messages) with the Write tool to the scratchpad `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/314d0933-d8d1-4d71-bf6f-98969a7160fc/scratchpad/` and commit with `git commit -F {file}`. Stage specific files by path; never `git add -A`, `git reset`, `git checkout .`, or `git stash`.
- Commit subjects use `{Verb} {what} — {detail}`, no conventional-commit prefix. Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_016yg3zmmeBYRp3T2gR56asJ` and a `refs #5536` line before it.
- Plugin root literal for any claude-tweaks CLI: `/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0`. Run dir (absolute): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T153417-record-5536`.
- Scope and edit discipline (verbatim from the project's Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same." A follow-up you notice is reported in your reply, not fixed. Known one: `plugin/bin/design-detect.js` carries the same `Removal condition: delete once no file under plugin/, tests/, tools/, perf/ or evals/ imports it` shim comment; it is not one of the four CLIs and stays untouched.
- Non-goals (spec): the reader of the old `code-health-fingerprint` marker (`FP_RE_LEGACY` in `plugin/bin/lib/issues/record-fingerprint.js`) keeps its behavior; no `V2` renames; no `decide()`/`run()` merge (#5440); `toIssuePayload` in `docs-health.js`, `harness-health.js`, `journey-health.js` and `health-core/validate-findings-dispatch.js` is live and stays; the unused `listSlices` import in `code-health.js` stays.
- Governing project skills (quoted verbatim; each file-to-skill match found by grepping `.claude/skills` for the touched modules):
  - `removal-condition-execution` governs the four `main()` shims, whose comment is a recorded `Removal condition:`, and the `FP_RE_LEGACY` condition: "A condition usually names a check. ... Run it and put the result in the PR." / "Sweep the framing words, not only the identifiers" / "A retargeted pin keeps the feature it was named for and can still drop a second rule its old fixture covered by accident. ... Before retargeting, list every assertion the old test made, the incidental ones included, and say which test covers each one afterwards." / Decision Framework: "a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise" / "Grep the identifiers, then the skip-list and range shapes, then the framing words, across `plugin docs tests .claude/skills` with the history paths excluded."
  - `gh-api-module-pattern` (`cli-wrapper-contract.md`) governs the CLI entry shape: "All four CLIs ... return it from `run(argv, deps)` (`if (cmd === 'churn-report') return ctx.cmdChurnReport(args);`), and their entry guard is their only `process.exitCode` write." The guard `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` stays byte-identical.
  - `skill-prose-conformance-tests` governs the two `plugin/skills/_shared/*.md` edits (Reference line of `removal-condition-execution`): "absence assertions fail open; sweep roots include `.claude/skills/`." Any absence sweep in this plan includes `.claude/skills`.
  - No rule applies from `windows-checkout-test-parity` (the one real-process test spawns a `node` script, no `.cmd` launcher, no tracked text read, no path ID), `node-test-output-evidence` (no parser touched; this plan only runs suites), `bin-source-scan-conformance` (only deletions and comments under `plugin/bin`; the full suite in Task 8 runs the source-scan suites), or `code-health-focus-vertical` (no vertical is added; Task 7 corrects only `focus-generators.js`'s header).
- Verification evidence: quote raw command output; never paraphrase a pass count. Redirect a long run to a `.txt` file in the scratchpad and quote its summary lines. CI runs Node 20.
- Size headroom (byte-pin check): `plugin/skills/_shared/work-record.md` is 41,821 bytes against `RAIL_BYTES` 52,500 (measured with `wc -c` in this worktree): 10,679 bytes of headroom, so Task 6's growth of a few hundred bytes is safe. `health-issue-index.md` is 7,686 bytes and only shrinks.

## Review Focus

- A removed flag still passed by a caller: `parseArgs` pushes an unrecognised flag and its value into `args._` (the spec accepts "ignored, not rejected"). Repo-wide, `--max-slices` occurs only on its parse line and `--label`/`--min-severity` only inside `pull-issues`, so no caller exists; Task 2's retirement grep proves it.
- `fingerprint()` called without `criterion` after the v1 branch is gone hashes `[undefined, areaId, ...]` and collides silently. The only guard is `validateFindingV2`'s required `criterion`; Task 3 pins it with a mutation proof.
- The usage string is byte-pinned (`commands: ... churn-report, retry-queue drain, ...`): a stray `, ` or a missed `pull-issues, ` fails Task 2's moved test, and `node plugin/bin/code-health.js pull-issues` must print the same general usage.
- `tools/test-durations.json` must stay valid JSON and name only tests that exist (`tests/run-tests-shard.test.js` fails otherwise); Task 2 parses it after the edit.
- Old issues still carry `<!-- code-health-fingerprint: ... -->` markers (closed #19 today); `tests/bin-lib/issues/record.test.js`'s legacy-marker tests must pass unedited (Task 6).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (shims) | Task 1 |
| Deliverables 2, 3, 6a (`--max-slices`), 7 (`health-issue-index.md`) | Task 2 |
| Deliverable 9 (`validate-finding` guard test) | Task 3 |
| Deliverable 4 (v1 payload, v1 fingerprint, v1/v2 labels) | Task 4 |
| Deliverable 6b (`staleDaysDeep`) | Task 5 |
| Deliverable 5 (`FP_RE_LEGACY` removal condition) | Task 6 |
| Deliverable 8 (stale comments) | Task 7 |
| Every Acceptance Criterion, final proof | Task 8 |

---

### Task 1: Retarget `main()` calls to `run()` and delete the four shims

**Files:**
- Modify: `tests/bin-lib/health-core/main-exitcode-integration.test.js` (15 calls, header comment, test titles, assertion messages)
- Modify: `plugin/bin/code-health.js` (delete `function main(argv)` with its `Removal condition:` comment; drop `main` from `module.exports`)
- Modify: `plugin/bin/docs-health.js` (same)
- Modify: `plugin/bin/harness-health.js` (same)
- Modify: `plugin/bin/journey-health.js` (same)
- Read: `plugin/bin/design-detect.js` (confirm untouched), `plugin/bin/lib/health-core/*.js` (confirm none imports `main`)

**Interfaces:**
- Consumes: `run(argv, deps = realDeps)` exported from all four CLIs (already `function run(argv, deps = realDeps)` in each); `returnedCode(fn)` and `captureStdio(fn)` in the test file.
- Produces: the four modules export `run` and `realDeps` but no `main`.

- [ ] **Step 1: Record the pre-change real-process behaviour of all four CLIs**

Run each as its own call and keep the output: `node plugin/bin/code-health.js no-such-command`, then the same for `docs-health.js`, `harness-health.js`, `journey-health.js`, each followed by `; echo "exit=$?"`. Save the four outputs with a plain redirect to `{run dir}/evidence/shim-before-{cli}.txt` (create the directory first with `mkdir -p`). Expected today: code-health prints the two-line usage and `exit=2` (its pre-change text names `pull-issues`).

- [ ] **Step 2: Inventory the old test's assertions (retarget rule), then retarget**

List the assertions each of the 15 tests makes (`returnedCode` return value, `process.exitCode === undefined`, the per-row exit code 2/1) — the assertions stay unchanged (AC4.2). Replace each `X.main(` with `X.run(` in all 15 calls (`git grep -n -P "(codeHealth|docsHealth|harnessHealth|journeyHealth)\.main\(" -- tests/bin-lib/health-core/main-exitcode-integration.test.js` lists them: 15 lines today at 90-182). Reword the file's header comment, the 15 test titles (`code-health.js main():` becomes `code-health.js run():`), and the assertion message `'main() must not set process.exitCode'` so none says `main`. Grep the file for `-w main` afterwards: no hits.

- [ ] **Step 3: Run the retargeted test (green before the shims go)**

Run: `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js`
Expected: all 15 rows pass (`run` already exists, so this is green before the deletion; AC4.2 asserts the 15 retargeted calls keep their assertions unchanged).

- [ ] **Step 4: Delete the shims**

In each of the four CLIs delete `function main(argv) { return run(argv, realDeps); }` together with the `// Removal condition: delete once no file under plugin/, tests/, tools/, perf/ or evals/ imports it ...` comment above it, and remove `main` from that file's `module.exports` list. Leave `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` byte-identical.

- [ ] **Step 5: Verify AC4 and the removal condition's own check**

Run `git grep -n -P "(codeHealth|docsHealth|harnessHealth|journeyHealth)\.main\(" -- tests` (pre-change control: 15 lines in `main-exitcode-integration.test.js`, recorded above) — AC4.2: prints nothing now. Run `git grep -n -P "\bmain\b" -- plugin/bin/code-health.js plugin/bin/docs-health.js plugin/bin/harness-health.js plugin/bin/journey-health.js` and read each hit (a hit that is not the removed shim stays). AC4.1: none of the four modules exports `main`: `node -e "for (const m of ['code-health','docs-health','harness-health','journey-health']) console.log(m, 'main' in require('./plugin/bin/' + m + '.js'))"` prints four `false` lines. The removal-condition check from the shim comment: `git grep -n -P "require\([^)]*(code-health|docs-health|harness-health|journey-health)(\.js)?'\)[^;]*\.main\b" -- plugin tests tools perf evals scripts` prints nothing.

- [ ] **Step 6: Re-run the four real-process commands from Step 1 and compare**

Save to `shim-after-{cli}.txt` and `cmp` each pair; all four pairs must be byte-identical (this task lands before Task 2, so code-health's usage text still names `pull-issues` here; the entry guard's behaviour is unchanged). Run `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js` again: all pass.

- [ ] **Step 7: Commit**

`git add` the test and the four CLIs by path; subject `Delete the four main() shims — callers use run(argv, deps)`.

---

### Task 2: Delete `pull-issues` and the flags only it and one alias used

**Files:**
- Modify: `tests/bin-lib/code-health/cli-nextslice.test.js` (receives the moved real-process usage test)
- Delete: `tests/bin-lib/code-health/cli-pull-issues.test.js`
- Delete: `tests/bin-lib/code-health/pull-issues-v2.test.js`
- Delete: `plugin/bin/lib/code-health/pull-issues.js`
- Modify: `plugin/bin/code-health.js` (`cmdPullIssues`, the `pull-issues` dispatch branch in `run`, its entry in the usage string, `--label`, `--min-severity`, `--max-slices` in `parseArgs`, the `validateRiskArg` comment and the `--min-severity` comment)
- Modify: `tools/test-durations.json` (two entries)
- Modify: `plugin/skills/_shared/health-issue-index.md` (drop the `pullReconIssues` clause)
- Modify: `plugin/bin/docs-health.js` (comment above `validateConfidenceArg`)
- Modify: `plugin/bin/journey-health.js` (comment above `CONFIDENCE_RANK`)
- Read: `plugin/bin/code-health.js` (`resolveAgainst` stays: `cmdValidateFindings` still calls it)

**Interfaces:**
- Consumes: `spawnCli(CLI, args, { env, cwd })` from `tests/helpers/run-cli` and `tmp()`/`CLI` already defined in `cli-nextslice.test.js`.
- Produces: `code-health.js` no longer recognises `pull-issues`, `--label`, `--min-severity` or `--max-slices`; its usage string is exactly `usage: code-health.js <command> [options]\ncommands: validate-findings [--slice <id>], classify, next-slice, status, churn-report, retry-queue drain, retry-queue update <results.json>\n`.

- [ ] **Step 1: Write the failing test first — move and extend the real-process usage test**

In `cli-nextslice.test.js` add `test('AC2.1, AC2.2: code-health.js no-such-command and pull-issues both exit 2 with the usage text on stderr (real process)', ...)`: for each of `['no-such-command', 'pull-issues']`, `spawnCli(CLI, [cmd], { env: { ...process.env }, cwd: tmp() })`, assert `r.code === 2`, `r.stdout === ''`, and `r.stderr` strictly equals the usage string above (AC2.1: the string names no `pull-issues`). Copy the test's `{ spawnCli } = require('../../helpers/run-cli')` shape and its "Real-process pin of the script entry (#5381)" comment from `cli-pull-issues.test.js` (the comment's claim moves with it).

- [ ] **Step 2: Confirm the usage string against the CLI's printed output, then run the test to see it red**

Run `node plugin/bin/code-health.js no-such-command` and compare its two printed lines with the string in the test (pre-change they include `pull-issues, `, so the test is red for that reason). Run: `node --test tests/bin-lib/code-health/cli-nextslice.test.js`
Expected: FAIL on the `AC2.1, AC2.2` test (stderr differs: it still contains `pull-issues`; the `pull-issues` argument prints the pull-issues-specific usage).

- [ ] **Step 3: Delete the code in `code-health.js`**

Delete `function cmdPullIssues`, the `if (cmd === 'pull-issues') return cmdPullIssues(args, ctx);` branch, the `pull-issues, ` entry in the usage string, the `--label` and `--min-severity` branches of `parseArgs` (and the comment above `--min-severity`), and the `|| a === '--max-slices'` alias (`--budget` stays). Reword the comment above `validateRiskArg`: it now has one caller, `cmdValidateFindings`' `--min-risk`; keep the function. Delete `plugin/bin/lib/code-health/pull-issues.js`. Keep `resolveAgainst`, `fs` and `RISK_RANK` imports (still used).

- [ ] **Step 4: Delete the two test files and their duration entries**

Delete `cli-pull-issues.test.js` and `pull-issues-v2.test.js`. Remove their two entries from `tools/test-durations.json` (`"tests/bin-lib/code-health/cli-pull-issues.test.js"` and `"tests/bin-lib/code-health/pull-issues-v2.test.js"`), then check the file still parses: `node -e "JSON.parse(require('fs').readFileSync('tools/test-durations.json','utf8')); console.log('ok')"` prints `ok`.

- [ ] **Step 5: Edit the prose and the two pattern-citing comments**

In `health-issue-index.md` remove only the `pullReconIssues` clause: the parenthesis becomes `(this file's own \`gh\`-absent projection step and each health sweep's own GATHER OPEN ISSUES instructions)`. In `docs-health.js` and `journey-health.js` make the comment name what is mirrored now: `validateRiskArg`'s `--min-risk` check (the shape is unchanged; only its two-command sharing is gone), as a one-clause addition, not a rewrite.

- [ ] **Step 6: Run the targeted suites**

Run: `node --test tests/bin-lib/code-health/cli-nextslice.test.js tests/run-tests-shard.test.js tests/bin-lib/code-health/skill-md.test.js`
Expected: PASS (the moved test is green; `run-tests-shard` accepts the edited durations file).

- [ ] **Step 7: Verify AC1, AC2 and AC3.1 and run the retirement sweeps**

AC1.1: `git grep -n -e "pull-issues" -e "pullReconIssues" -e "cmdPullIssues" -- plugin tests tools` prints nothing (control run before this plan: lines in `plugin/bin/code-health.js` 8, `plugin/bin/lib/code-health/pull-issues.js` 3, `health-issue-index.md` 1, `cli-pull-issues.test.js` 11, `pull-issues-v2.test.js` 17, `tools/test-durations.json` 2; AC1.2). The named roots `plugin tests tools` reach neither the spec, the plan nor the ledger, so no pathspec exclusion is needed. AC2.1: `node plugin/bin/code-health.js pull-issues; echo "exit=$?"` prints the general usage without `pull-issues` and `exit=2` (control: today it prints the `pull-issues`-specific usage line, exit 2). AC3.1 (the `--max-slices` half): `git grep -n -F -- "--max-slices" plugin tests` prints nothing (AC3.2 control, run once on the unchanged tree: one line, `plugin/bin/code-health.js:93`). Then the broader retirement sweep across live roots, one `-e` per phrasing: `git grep -n -i -e "pull-issues" -e "pull issues" -e "pullReconIssues" -e "--min-severity" -e "minSeverity" -e "max-slices" -- plugin docs tests tools .claude/skills ':!docs/incident-log.md' ':!CHANGELOG.md' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!.claude-tweaks/pipelines'` — give each hit a verdict (rewrite, or leave if history); report hits in your reply.

- [ ] **Step 8: Commit**

Stage the paths by name (deleted files included); subject `Delete the pull-issues command — no skill has invoked it since 2026-07-10`.

---

### Task 3: Pin `validate-finding.js`'s `criterion` requirement

**Files:**
- Modify: `tests/bin-lib/code-health/validate-finding.test.js`
- Read: `plugin/bin/lib/code-health/validate-finding.js` (`V2_REQUIRED_STRINGS`), `plugin/bin/lib/health-core/finding-validation.js` (`requireNonEmptyStrings`)

**Interfaces:**
- Consumes: `validateFindingV2(obj) -> { ok, errors, value? }`; the file's `validV2Finding(overrides)` fixture.
- Produces: a named test the PR cites for AC9.

- [ ] **Step 1: Confirm no test asserts this today (verify-then-maybe-change)**

Read `validate-finding.test.js`: `git grep -n "criterion" tests/bin-lib/code-health/validate-finding.test.js` shows only a fixture field, the unknown-id test (`not-a-real-criterion`, which runs the catalog check and so does not need the required-string guard) and the value-carry test. A missing or blank `criterion` is asserted nowhere, so add the case.

- [ ] **Step 2: Write the test**

Add `test('AC9.1: validateFindingV2 rejects a finding with a missing or blank criterion — the only guard in front of fingerprint() (#5536)', ...)`: for `{ ...validV2Finding(), criterion: undefined }` (property deleted) and `validV2Finding({ criterion: '   ' })`, assert `result.ok === false` and `result.errors.some((e) => e.startsWith('criterion: required non-empty string'))`. The error text comes from `requireNonEmptyStrings`; the catalog check at `validate-finding.js` ("criterion: unknown criterion id") only runs when `criterion` is already a non-empty string, so only the required-string guard can produce the asserted error.

- [ ] **Step 3: Run it green, then prove it discriminates by reverting the guard**

Run: `node --test tests/bin-lib/code-health/validate-finding.test.js` → PASS. Now Edit `V2_REQUIRED_STRINGS` in `plugin/bin/lib/code-health/validate-finding.js`, removing `'criterion', ` from the array; run the same command → Expected: FAIL on the `AC9.1` test only (a finding without `criterion` now validates `ok: true`). Restore the line with the Edit tool (the inverse edit; not `git checkout`), re-run → PASS, and confirm `git diff -- plugin/bin/lib/code-health/validate-finding.js` prints nothing. Save the red and green output to `{run dir}/evidence/ac9-criterion-guard.txt` with a plain redirect.

- [ ] **Step 4: Commit**

Stage only `tests/bin-lib/code-health/validate-finding.test.js`; subject `Pin validate-finding's criterion requirement — the guard in front of fingerprint()`.

---

### Task 4: Delete the frozen v1 payload and the v1 fingerprint branch

**Review risk:** high (decision logic: every `fingerprint()` call now hashes the v2 basis, and that id is the identity dedup decides on)

**Files:**
- Modify: `plugin/bin/lib/code-health/issue-payload.js` (delete `toIssuePayload` and its export; relabel the `v2:` comment above `toIssuePayloadV2`)
- Modify: `plugin/bin/lib/code-health/fingerprint.js` (delete the v1 branch, `normalizeSignature` and the `lens`, `signature`, `file` parameters; update the v1/v2 comments; drop `normalizeSignature` from exports)
- Modify: `plugin/bin/lib/health-core/fingerprint.js` (the `createFingerprint` comment)
- Modify: `plugin/bin/code-health.js` (the `// 2. Fingerprint via v2 form` comment in `cmdValidateFindings`)
- Modify: `tests/bin-lib/code-health/issue-payload.test.js`
- Modify: `tests/bin-lib/code-health/fingerprint.test.js`
- Read: `plugin/bin/lib/code-health/dedup.js`, `plugin/bin/lib/code-health/validate-finding.js` (no other caller of `normalizeSignature` or the v1 payload; the greps below prove it)

**Interfaces:**
- Consumes: `fingerprintFromBasis(prefix, basis)` from `health-core/fingerprint`; `normalizeAnchor(anchor)` (stays exported).
- Produces: `fingerprint({ criterion, areaId, anchor }) -> 'codehealth-<8hex>'` is the only accepted form; `issue-payload.js` exports `{ toIssuePayloadV2 }` only; `fingerprint.js` exports `{ fingerprint, normalizeAnchor }`.

- [ ] **Step 1: Capture the before-state for AC5.2 and AC6 (scratch, uncommitted)**

With a scratch script in the scratchpad (not committed), print `JSON.stringify(toIssuePayloadV2(V2_FINDING, 'abc1234'), null, 2)` where `V2_FINDING` is the fixture object in `issue-payload.test.js` (copy it), to `{run dir}/evidence/payload-v2-before.json`, and the ids `fingerprint({ criterion, areaId, anchor })` returns for **every** v2-form call in `fingerprint.test.js` (AC6.1 covers all of them, and the `v1 and v2 forms coexist` test that Step 2 deletes holds one): `simplification`/`src/api`/`src/api/user.js#getUser`, `dead-code`/`src`/`src/util.js:42#trimPath` and `:99#trimPath`, `naming-clarity`/`lib`/`lib/parser.js#parse`, `resilience`/`src`/`src/http.js#fetch`, the `security-logic` variant of that base, and `bad-practice`/`.`/`a.js#TODO x`. Print one `label<TAB>id` line each to `fingerprints-before.txt`; re-derive the list with `git grep -n "criterion:" tests/bin-lib/code-health/fingerprint.test.js` so none is missed.

- [ ] **Step 2: Remove the v1 tests (callers first)**

In `issue-payload.test.js` delete the five v1 tests and the v1 fixtures: `labels are code-health + code-health:<severity>`, `title is the finding title`, `body embeds the fingerprint marker ...`, `body carries /specify-shaped sections ...`, `the fingerprint can be re-extracted from the body with a stable regex`, plus `toIssuePayload (v1) still works after extending the module`, `toIssuePayload (v1) footer stays the unqualified legacy form` and `legacy toIssuePayload (v1) never carries a verifiedAsOf param ...`; drop `toIssuePayload` from the first `require` and delete the v1 `FINDING` constant if nothing else uses it (the v2 tests use `V2_FINDING`). In `fingerprint.test.js` delete the four v1-input tests at the top (`fingerprint returns a codehealth-<8hex> id`, `... stable when the finding moves lines or columns`, `... stable across whitespace, case, and embedded line refs in signature`, `... differs when lens or area differs`), `normalizeSignature strips line refs ...`, `v1 fingerprint is byte-identical to ...`, `v1 and v2 forms coexist ...`, and the v1 half of the `REGRESSION: both v1 and v2 branches must delegate` comment (reword it for the one remaining branch); drop `normalizeSignature` from the require. The v2 tests stay unedited (AC6.1: they cover the same ids; the three v2 byte-identity and differ tests are the discriminating ones).

- [ ] **Step 3: Delete the production code**

`toIssuePayload` and the `// legacy: v1, frozen ...` comment block above it; the export becomes `module.exports = { toIssuePayloadV2 };` Relabel `// v2: body uses anchor ...` as a plain description of `toIssuePayloadV2`. In `fingerprint.js` the function becomes `function fingerprint({ criterion, areaId, anchor })` returning `fingerprintFromBasis('codehealth', [criterion, areaId, normalizeAnchor(anchor || '')])` (no `criterion !== undefined` branch, no guard: `validate-finding.js` is the guard); reword the `// v2: ...`/`// v2 form: ... // v1 form: ...` comments so no `v1`/`v2` label remains in this file. Reword `health-core/fingerprint.js`'s `createFingerprint` comment: code-health's own `fingerprint.js` is not built on the factory because it normalizes its anchor with its own `normalizeAnchor`, not `normalizeText` (drop "v1 lens/areaId/file/signature vs. v2"). Reword `// 2. Fingerprint via v2 form, ...` in `code-health.js` to describe what it computes (criterion, areaId, anchor).

- [ ] **Step 4: Run the suites and compare against Step 1**

Run: `node --test tests/bin-lib/code-health/*.test.js tests/bin-lib/health-core/*.test.js` → PASS. Re-run Step 1's scratch script to `payload-v2-after.json` and `fingerprints-after.txt` and `cmp` against the before files — AC5.2: byte-identical; AC6.1: identical ids. AC5.1: `node -e "console.log(Object.keys(require('./plugin/bin/lib/code-health/issue-payload.js')))"` prints `[ 'toIssuePayloadV2' ]`.

- [ ] **Step 5: Retirement sweep for the v1 names**

`git grep -n -w -e normalizeSignature -- plugin tests tools .claude/skills` prints nothing (control run before this plan: hits in `fingerprint.js` ×3, `health-core/fingerprint.js:28`, `fingerprint.test.js` ×4). `git grep -n -w toIssuePayload -- plugin/bin/lib/code-health tests/bin-lib/code-health plugin/bin/code-health.js` prints nothing (control: 17 hits, all in `issue-payload.js` and its test). Do not sweep `toIssuePayload` repo-wide: three other health skills use that name live (spec Gotcha). Grep the framing words in code-health's files and tests: `git grep -n -i -e "v1 form" -e "v1:" -e "(v1)" -e "frozen" -e "legacy: v1" -- plugin/bin/lib/code-health tests/bin-lib/code-health plugin/bin/code-health.js` and give each hit a verdict (history stays; a live claim is rewritten).

- [ ] **Step 6: Commit**

Stage by path; subject `Delete the frozen v1 issue payload and v1 fingerprint branch — validate-finding requires criterion`.

---

### Task 5: Delete the `staleDaysDeep` option

**Files:**
- Modify: `plugin/bin/lib/journey-health/qa-evidence.js` (`evaluateQaEvidence`)
- Read: `plugin/bin/journey-health.js` (the one caller passes `{ now }`), `tests/bin-lib/journey-health/qa-evidence*.test.js` (14 calls pass `{ now: NOW }`)

**Interfaces:**
- Consumes: `STALE_DAYS_DEEP` from `./score`.
- Produces: `evaluateQaEvidence(storyIds, report, opts = {})` reads only `opts.now`; the window is always `STALE_DAYS_DEEP`.

- [ ] **Step 1: Prove no caller passes the option**

`git grep -n -w staleDaysDeep -- plugin tests` prints three lines, all in `qa-evidence.js` (AC3.2 control, run once on the unchanged tree: lines 19, 28, 29). Read the production call (`journey-health.js` passes `{ now }`) and `git grep -n -c "evaluateQaEvidence" -- tests` to confirm every test call passes `{ now: NOW }` only.

- [ ] **Step 2: Edit**

Delete the `const staleDaysDeep = ...` line, use `STALE_DAYS_DEEP` directly in the age check and in the `past the ${...}-day window` reason string. Adjust the doc comment above the function only if it names the option.

- [ ] **Step 3: Verify AC3.1 (the `staleDaysDeep` half) and run**

`git grep -n -w staleDaysDeep -- plugin tests` prints nothing. Run: `node --test tests/bin-lib/journey-health/*.test.js` → PASS.

- [ ] **Step 4: Commit**

Stage `plugin/bin/lib/journey-health/qa-evidence.js`; subject `Delete the unused staleDaysDeep option — no caller passes it`.

---

### Task 6: Record the removal condition for the legacy marker reader

**Files:**
- Modify: `plugin/bin/lib/issues/record-fingerprint.js` (comment above `FP_RE_WORK`/`FP_RE_LEGACY`)
- Modify: `plugin/skills/_shared/work-record.md` (the paragraph that says "migration window")
- Read: `tests/bin-lib/issues/record.test.js` (legacy-marker tests, `extractFingerprint reads the legacy code-health-fingerprint marker` and its neighbours)

Waived plugin/skills/code-health/SKILL.md: read-only in Step 3's dependent-reader read; it depends on the legacy marker reader and stays.
Waived harness-health/SKILL.md: read-only in Step 3's dependent-reader read (`plugin/skills/harness-health/SKILL.md`); it depends on the legacy marker reader and stays.
Waived journey-health/SKILL.md: read-only in Step 3's dependent-reader read (`plugin/skills/journey-health/SKILL.md`); it depends on the legacy marker reader and stays.
Waived tests/bin-lib/code-health/skill-md.test.js: read-only in Step 3's dependent-reader read; it pins the prose that depends on the legacy marker reader and stays.

**Interfaces:**
- Consumes: the removal-condition command from the spec.
- Produces: no behaviour change; `FP_RE_LEGACY` still exported and still matching the three marker names.

- [ ] **Step 1: Run the condition's own check and keep the result (removal-condition-execution)**

Run: `gh issue list --state all --limit 100000 --json number,body -q '[.[] | select(.body | test("(code|harness|journey)-health-fingerprint:"))] | length'`. Result when this plan was written: `1` (closed issue #19, "Migrate pull-issues.js's ingestion path onto record.js's readers, then retire ingest.js"), so the condition is not met and the reader stays. Re-run it now, save the number to `{run dir}/evidence/fp-legacy-condition.txt`, and quote the command and the count in your report (a count, never the issue bodies).

- [ ] **Step 2: Edit the two comments**

In `record-fingerprint.js` replace "still present on older issues during the migration window" with a recorded `Removal condition:`: remove `FP_RE_LEGACY` and its branch in `extractFingerprint` once no issue, open or closed, carries a `code-health-fingerprint`, `harness-health-fingerprint` or `journey-health-fingerprint` marker; the check is the command above and a result of 0 means the condition is met. In `work-record.md` replace "during the migration window" in the paragraph "Readers accept the legacy `<!-- code-health-fingerprint: {fingerprint} -->` marker ..." with the same condition and command (keep the rest of the paragraph). Add nothing else to either file.

- [ ] **Step 3: Verify AC7 and the moved-prose pin check**

`git grep -n -F -e "migration window" -- tests plugin .claude/skills` shows the two live sites you edited and no test pin (control run before this plan: `record-fingerprint.js:11`, `work-record.md:426`; no `tests/` hit). `wc -c plugin/skills/_shared/work-record.md` stays under 52,500. Dependent-reader read (spec Gotcha: they stay): read `plugin/skills/code-health/SKILL.md` near its fingerprint-marker mention, `plugin/skills/harness-health/SKILL.md`, `plugin/skills/journey-health/SKILL.md` and `tests/bin-lib/code-health/skill-md.test.js` (`git grep -n -F "code-health-fingerprint" -- plugin/skills tests/bin-lib/code-health/skill-md.test.js` lists them) and confirm each depends on the legacy reader; edit none. Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/code-health/skill-md.test.js` → PASS with `record.test.js` unedited (AC7.1: the reader's tests at `record.test.js` lines 174-184 pass unedited, `git diff --stat -- tests/bin-lib/issues/record.test.js` prints nothing, and the comment states a removal condition with the command that checks it); `node -e "const r=require('./plugin/bin/lib/issues/record-fingerprint.js'); console.log(typeof r.FP_RE_LEGACY, r.FP_RE_LEGACY.test('<!-- harness-health-fingerprint: x -->'))"` prints `object true`.

- [ ] **Step 4: Commit**

Stage the two files; subject `Record the removal condition for the legacy fingerprint marker reader`.

---

### Task 7: Make the stale comments state what the code does now

**Files:**
- Modify: `plugin/bin/lib/code-health/focus-generators.js` (header)
- Modify: `plugin/bin/lib/code-health/scope.js` (the comment above `sourceFilesRaw`/`contentHash`)
- Modify: `plugin/bin/lib/code-health/source-scan.js` (the `TEST_GLOB_BASENAME_RE` comment)
- Modify: `plugin/bin/lib/code-health/cache.js` (the `createDurable` comment and the `computeChurn` comment)
- Modify: `plugin/bin/harness-health.js` (the `resolvePluginVersion` comment, the `could not read or parse findings file` comment)
- Modify: `plugin/bin/journey-health.js` (the same findings-file comment)
- Modify: `plugin/bin/code-health.js` (the `// 4. Persist local cache` comment)
- Read: `plugin/bin/lib/code-health/scope.js` (`splitOversized`, `sliceRecursive`, the churn code), `tools/run-tests.js` (`DEFAULT_ROOTS`), `plugin/bin/lib/code-health/candidates-*.js` (registrations)

**Interfaces:**
- Consumes: the current code at each site.
- Produces: no code change; each comment states a fact true of today's code.

The spec's stale-comment deliverable has no grep: it is done when each comment below states what the code does now, and the whole-branch review reads each. Edit in place, comment text only.

- [ ] **Step 1: Read each site's code, then rewrite its comment**

| Site (anchor) | What is stale | Rewrite to say |
|---|---|---|
| `focus-generators.js` header | "`dead-code` ... is the only entry that ships today; the other three verticals ... add their own key"; cites `docs/plans/2026-08-09-code-health-focus-mode-dead-code-ledger.md` | every vertical (`candidates-{vertical}.js`; nine register today, see `git grep -n "registerGenerator('" -- plugin/bin/lib/code-health`) registers its own generator here; drop the untracked-plan citation (`git ls-files` prints nothing for it) and keep the reasoning (framework to vertical dependency direction) without it |
| `scope.js` comment above `sourceFilesRaw` | says `recursive:false` is "used for the '.' slice"; ends in the orphaned fragment "Was docs/superpowers/specs/2026-07-30-durable-state-git-native-write-design.md — deleted (70849915)." | `recursive:false` scans direct file children only and is used for the `.` slice and for `splitOversized`'s own-files slice of any oversized directory (read the `Resolve from relDir` comment and `sliceRecursive` lower in the file); delete the orphaned fragment |
| `source-scan.js` `TEST_GLOB_BASENAME_RE` comment | describes `package.json`'s `test` script as a `find tests tools/upstream-drift/tests -name '*.test.js'` | `package.json`'s `test` script runs `node tools/run-tests.js`, which walks `DEFAULT_ROOTS` (`tests`, `tools/upstream-drift/tests`) for `*.test.js`; the heuristic and its reasoning stay |
| `cache.js` `createDurable` comment | "exactly as before" | the module-level exports below are bound to `createDurable()` (inherited env, `process.stderr`) |
| `cache.js` `computeChurn` comment | "now lives once in health-core/runs.js ... re-export it here" | `computeChurn` is imported from `health-core/runs.js` (shared by all four health-suite engines) and re-exported so `bin/code-health.js` and `tests/bin-lib/code-health/*` import it from this module |
| `harness-health.js` `resolvePluginVersion` comment | tells the #1837 review history ("this was its own third copy ... now shared") | what it does: the RUNNING build's version from `CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json`, never this repo's own `plugin/.claude-plugin/plugin.json` (ahead of the installed build in development); fails toward `undefined` so a bad manifest drops the `Template:` line instead of crashing the sweep; shared with `bin/materialize.js` and `bin/lib/hooks/session-start.js` |
| `harness-health.js` and `journey-health.js` findings-file comment | "The message names the findings path as the caller gave it, as before." | the message names the findings path as the caller gave it (`findingsArg`), not the resolved path |
| `code-health.js` `// 4. Persist local cache` comment | "unaffected by the health-state migration, including the pre-existing dry-run contract" | step 4 persists the local cache and, unless dry-run, the durable cursor/run/remembered update in one batched health-state write; a dry-run writes neither |

Also fix any other comment one of this plan's deletions made false; none is expected (grep `git grep -n -i -e "pull-issues" -e "v1" -- plugin/bin/code-health.js plugin/bin/lib/code-health` and read hits).

- [ ] **Step 2: Verify no behavior moved**

`git diff -- plugin/bin plugin/bin/lib` (this task's files) shows only comment lines changed: every `+`/`-` line starts with `//` or sits inside a block comment. Run: `node --test tests/bin-lib/code-health/*.test.js tests/bin-lib/harness-health/*.test.js tests/bin-lib/journey-health/*.test.js` → PASS.

- [ ] **Step 3: Commit**

Stage the eight files by path; subject `Fix stale comments in the health CLIs — they now describe the code as it is`.

---

### Task 8: Prove every acceptance criterion and run the full suite

**Files:**
- Read: all of the above; no edit unless a check fails (a failure is fixed in the owning task's files).
- Create (uncommitted evidence): `{run dir}/evidence/*.txt`, `{run dir}/evidence/` is created with `mkdir -p`.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: one `decisions.md` `AC evidence` entry per scratch-verified criterion, and the full-suite result.

- [ ] **Step 1: Run each absence command and quote its output (AC1-AC5)**

| AC | Command | Expected now |
|---|---|---|
| AC1.1 | `git grep -n -e "pull-issues" -e "pullReconIssues" -e "cmdPullIssues" -- plugin tests tools` | no output |
| AC2.1 | `node plugin/bin/code-health.js pull-issues` | stderr is the general usage, no `pull-issues`; exit 2 |
| AC3.1 | `git grep -n -F -- "--max-slices" plugin tests`, then `git grep -n -w staleDaysDeep -- plugin tests` | no output from either (AC3.2's controls matched once on the unchanged tree: `code-health.js:93`; `qa-evidence.js:19,28,29`) |
| AC4.2 | `git grep -n -P "(codeHealth|docsHealth|harnessHealth|journeyHealth)\.main\(" -- tests` | no output |
| AC5.1 | `node -e "console.log(Object.keys(require('./plugin/bin/lib/code-health/issue-payload.js')))"` | `[ 'toIssuePayloadV2' ]` |

Each of the first four was run once against the unchanged tree before this plan was written and matched (controls in Tasks 1, 2, 5), so an empty result is evidence. Save the outputs with plain redirects to `{run dir}/evidence/ac-greps.txt`.

- [ ] **Step 2: Write the AC evidence entry for each scratch-verified criterion**

For AC1-AC5 and AC9 write one `decisions.md` line each with `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T153417-record-5536" --section "/build" --status AUTO --step "AC evidence" --text-file {one-line file}`; the text file (written with the Write tool) holds the criterion id and wording, the exact command, the observed result and the evidence path. AC9's line names the test `AC9.1: validateFindingV2 rejects a finding with a missing or blank criterion ...` and the red-then-green proof file from Task 3.

- [ ] **Step 3: Run the full suite centrally (AC8)**

Run: `npm test -- --full > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/314d0933-d8d1-4d71-bf6f-98969a7160fc/scratchpad/full-5536.txt 2>&1` (a long run: run it in the background and wait for its exit; no writes while it runs). Quote the summary lines (`ℹ tests`, `ℹ pass`, `ℹ fail`) from the file. AC8.1: it passes, including `tests/run-tests-shard.test.js`. A failing file is re-run alone with `node --test {path}` before any conclusion.

- [ ] **Step 4: Name the AC9 test for the PR**

The PR must name the test (AC9.1): record `AC9.1: validateFindingV2 rejects a finding with a missing or blank criterion — the only guard in front of fingerprint() (#5536)` (file `tests/bin-lib/code-health/validate-finding.test.js`) and the `FP_RE_LEGACY` condition command with its count (`1`, closed #19) per Task 6 in the build handoff, **and write both into the PR body itself**: `_shared/pr-checklist-refresh.md`'s Spec summary refresh only rewrites after a premise reversal, so it never carries them. Read the live body with `gh pr view 5764 --json body --jq .body` into a scratchpad file, append a short "Verification notes" paragraph naming the test, its file and the `FP_RE_LEGACY` check and count, keep the session link as the last line, apply with `gh pr edit 5764 --body-file {file}`, then read the body back and confirm both strings are present (`AC9.1: validateFindingV2` and `FP_RE_LEGACY`).

---

## Acceptance criterion coverage

| Id | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 2 Step 7 (command, control counts) and Task 8 Step 1 |
| AC2.1, AC2.2 | Task 2 Steps 1, 2, 7 and Task 8 Step 1 |
| AC3.1, AC3.2 | Task 2 Step 7 (`--max-slices`), Task 5 Steps 1 and 3 (`staleDaysDeep`), Task 8 Step 1 |
| AC4.1, AC4.2 | Task 1 Steps 3 and 5, Task 8 Step 1 |
| AC5.1, AC5.2 | Task 4 Step 4 and Task 8 Step 1 |
| AC6.1 | Task 4 Steps 1-4 |
| AC7.1 | Task 6 Step 3 |
| AC8.1 | Task 8 Step 3 |
| AC9.1 | Task 3 and Task 8 Step 4 |
