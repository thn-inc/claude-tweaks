# Pipelines push first and take CI-declared suites from CI; this repo opts in to `localRuns` (#5370) Implementation Plan

**Goal:** Every pipeline verify in a project with a declaration runs the scoped invocation, a `pr-first` worktree run pushes before it so CI can answer, an exit 3 never stops a run, and under `"localRuns": "on-request"` the whole suite runs on the developer machine only when asked by name (`/claude-tweaks:test full`, the release's pre-bump run). This repo opts in.

**Architecture:** The rule lives once, in `plugin/skills/test/verification.md` (the scoping table, a new Push first paragraph, the rewritten Standalone paragraph), and every site cites it. The sites that run before any push (the express lane, an SDD implementer's affected set, the driver's `testStep`) pass `--local` unconditionally. `/claude-tweaks:test` gains a `full` argument and `/claude-tweaks:release` calls it before the review. `residue.js` reads the declaration and, under the key, reports the suite probe as not run instead of starting `npm test`. A decision document and a new `impact-selection.md` section state what an impact-map miss can let through and what catches it. The opt-in commit also gives `windows-regression.yml`'s unscoped verify `--local`, or the repo's own post-merge Windows job would exit 2.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS, `node --test`.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5319-5369-5370/.claude-tweaks/pipelines/2026-11-13T132412-spec-5319-5369-5370/spec-5370/work/5370-spec.md`

Scope keywords: localRuns, on-request, --local, Push first, exit 3, no verdict yet, Standalone is always full, test full, whole suite, residue suite probe, testStep, windows-regression, scoped invocation

Risk flags: the spec carries no `Risk-flags:` line (its frontmatter has `risk: medium` only), so plan-audit Check G has nothing to prove and this plan carries no `Proof(<slug>):` lines.

## Premises checked against HEAD (the spec's stamp, 79cd5710d, is 58 commits behind)

Each line names the probe that settled it.

- **True.** `verification.md:80` lists Build Common Step 5 as `full (impact-selected via …)` and `:86` gives standalone `/claude-tweaks:test` `full`. `impact-selection.md:98` is the only text that says Common Step 5 runs the scoped invocation (`grep -n "Common Step 5" plugin/skills/test/*.md`).
- **True.** `build/SKILL.md:281` ends "**CI source (#4347):** a `ci` block needs HEAD pushed first (`test/ci-source.md`)", and the phase-exit push is `:305`, after Common Step 5.
- **True.** `residue.js:98` runs `execFileSync('npm', ['test'], …)` and `probeSuite` reads exit 0 as a green suite (`plugin/bin/lib/residue/probes/suite.js:20`).
- **Partly false: the driver.** The spec says `testStep` "treats any non-zero exit as a test failure". At HEAD exit 1 is `stop` with reason `failing-test`, and any other non-zero exit is `status: 'fail'`, a failed call (`plugin/bin/lib/driver/steps.js:692-695`). Exit 3 is already a `fail`, which settles as `express-error`, not `failing-test`. The spec's "pushes first where it has a PR to push to" cannot happen either. `STEPS` runs `testStep` before `pushStep` and `prStep` (`steps.js:1020-1023`), so the driver never has a pushed branch or a PR at the test step. The only reachable branch is "otherwise passes `--local`" (Task 3).
- **Partly false: the release.** `/claude-tweaks:release` has no verification step of its own. The only pre-bump test run is `/claude-tweaks:review`'s Step 1.5 test gate, which Step 3 invokes (`release/SKILL.md:148,165`). With a declaration, that gate auto-triggers `/claude-tweaks:test --source review`, which is scoped (`review/code-mode-steps.md:86`). "Asks for the whole suite by name" is therefore a new paragraph (Task 5), not an edit.
- **False by omission: unlisted sites.** The spec's Key Files miss five sites that the opt-in breaks or that run before any push:
  - `.github/workflows/windows-regression.yml:134-135` runs an unscoped `node plugin/bin/verify.js --cmd tests="npm test -- --full"`. Under the key, `tests` is a `ci` key, so verify.js exits 2 before any check (`plugin/bin/verify.js:508-512`), and the post-merge Windows job never runs the suite. Task 8 adds `--local`.
  - `plugin/skills/_shared/express-lane.md:16` runs a scoped verify before its step 6 push. Task 2 adds `--local`.
  - `plugin/skills/build/dispatch.md:14`'s per-task affected set runs mid-build, before any push, often on a dirty tree. Task 2 adds `--local`.
  - `plugin/skills/test/flake-handling.md:17`'s whole-suite re-run. Task 2 adds `--local`.
  - `plugin/skills/test/verification.md:54,153`, this repo's unscoped full set. Task 1 adds `--local`.
- **False by omission: the pinning test.** The spec names `tests/build-verify-after-doc-steps.test.js` for the Common Step 5 prose, but that suite does not read the CI-source sentence. The Build Common Step 5 scoping row is pinned by `tests/test-skill-affected-conformance.test.js:49` (`'| full (impact-selected via'`), which the spec does not name. Task 1 re-points it.
- **True.** The merge gate parks red and waits on pending (`_shared/pr-first-merge.md:8`). CI is `ubuntu-latest` on Node 20 (`.github/workflows/test.yml:26,52`).
- **True.** `readDeclaration` returns `{ ok: true, decl: null }` for a missing file (`plugin/bin/lib/verify/declaration.js:53`). Scratch probe: `localRuns` parses `'on-request'` with a `ci` block, in both the single-command and the map-form `checks.tests`. This repo's file parses with `localRuns: null` today.
- **Composed bundles.** A scratch run of `composedBytesReport(plugin/)` lists 12 compose call sites. None has a source this plan edits. The tightest is `worktree-setup` at 52,476 B (24 B under the rail), and its sources are the two `worktree-setup.md` files. This plan touches neither.

## Global Constraints

- The key, verbatim: a top-level `"localRuns": "on-request"`, valid only beside a `ci` block (#5369). Without the key every behavior in this plan stays as it is today, except the unconditional `--local` at the four pre-push sites (Decision 2).
- Exit 3 means no verdict yet and is never a test failure. Line 1 of its stderr is `verify.js: no verdict yet for suite "{suite}" — CI could not answer ({reason}), and the declaration's localRuns "on-request" keeps it off this machine; no check ran and no pass stamp was written.` (`plugin/bin/verify.js:243`).
- No new mid-flow stop in `auto` mode (CLAUDE.md's Auto-Mode Contract). Exit 3 resolves to a push-and-re-run or a `--local` re-run plus one `AUTO` entry.
- Byte rail, measured with `wc -c` against `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js:53`, `floor(25000 × 2.1)`):

  | File | Now | Planned growth | After | Headroom |
  |---|---|---|---|---|
  | `plugin/skills/test/verification.md` | 46,991 | about +2,230 (Push first paragraph 1,494 B, Standalone +500, rows +160, two `--local` clauses +70) | about 49,220 | about 3,280 |
  | `plugin/skills/build/SKILL.md` | 49,167 | +171 (a 258 B sentence replaces an 87 B one) | 49,338 | 3,162 |
  | `plugin/skills/release/SKILL.md` | 48,878 | +650 | 49,528 | 2,972 |
  | `plugin/skills/test/SKILL.md` | 24,779 | about +900 | about 25,700 | far |
  | `plugin/skills/test/impact-selection.md` | 13,719 | about +2,100 | about 15,800 | far |
  | `plugin/skills/build/dispatch.md` | 43,677 | about +110 | about 43,790 | about 8,700 |
  | `plugin/skills/_shared/express-lane.md` | 18,305 | about +130 | far | far |
  | `plugin/skills/test/flake-handling.md` | 11,506 | about +230 | far | far |
  | `plugin/skills/wrap-up/residue-sweep.md` | 16,948 | about +260 | far | far |
  | `plugin/skills/help/reference-card.md` | 21,098 | about +110 | far | far |

  The remedy for `build/SKILL.md` is the spec's own: the push-first detail lives in `test/verification.md`, and Common Step 5 carries one 258 B pointer sentence. If an edit to `verification.md` ever pushes it past 51,500 B, move the Push first paragraph into `ci-source.md` (7,928 B) and leave a one-line pointer. No file here needs that today.
- Never add a fenced ` ```bash ` block containing `bin/verify.js` to `verification.md`. `tests/bin-lib/verify/snippet-conformance.test.js` asserts exactly one unscoped and exactly one `--scope` fenced invocation. Write the push command as inline code.
- Test commands: targeted `node --test <files>` only. Never a bare `npm test`, `npm test -- --full`, an unscoped `verify.js`, or `/claude-tweaks:test full` in this plan's own steps. The central verification step owns the full run.
- Commit style: `{Verb} {what} — {detail}, refs #5370`, ending with the session's `Claude-Session:` attribution line.
- `skill-prose-conformance-tests`, quoted: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
- `skill-prose-conformance-tests`, quoted: "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)`". `assertEachPatternGoesRed` (`tests/helpers/conformance-asserts.js`) does both, and it forces each pattern to match exactly once in its slice.
- `skill-prose-conformance-tests`, quoted (Anti-Patterns): "A retirement sweep whose walk stops at `plugin/` and `docs/` | `.claude/skills/` restates plugin contracts … Add `.claude/skills/` to the walk and assert a file from it reached the list".
- `skill-prose-conformance-tests`, quoted: "**The silent direction: new prose inside another suite's slice.** … Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice." The slices this plan's new text lands in:
  - `tests/release-review-tree-check-conformance.test.js` checks that each `STOP_FACTS` pattern matches exactly once in release Step 3. Task 5's paragraph contains none of them: no `git push`, no `switch {branch}`, no `pull --rebase`, no `review tree is not`.
  - `tests/pipeline-test-scope-conformance.test.js` pins `dispatch.md`'s affected-set line (facts 23-33). Task 2 inserts `--local` between the `--scope` path and `--integration-branch`, so fact 24 (`--integration-branch \{integration-branch\} --no-stamp\` selects`) and fact 27 still match. Fact 33, "Common Step 5's verification run (full, or impact-selected when declared) is the branch's one suite run", is kept unchanged: under the key that run is CI's whole-suite verdict, which is still the branch's one suite run.
  - `tests/test-skill-affected-conformance.test.js:62` asserts that `Standalone is always full` is present. Task 1's label keeps that literal.
- `driver-step-addition`, quoted: "The test step runs the worker's test files through `verify.js`. It spawns that child with `buildEnv(deps.env, deps.platform)` from `worker.js` plus `GH_CONFIG_DIR` set to an empty directory, never bare `deps.env`". Task 3 changes only the argv.
- `driver-step-addition`, quoted: "A step that ports a section of `plugin/skills/_shared/express-lane.md` names that section in its comment. No test reads that prose, so the two are kept in step by hand." Task 2 edits express-lane step 4 and Task 3 edits `testStep`, so the two change together.
- `verify-scope-rule-kind`, quoted: "**The committed declaration stays readable by the previous release.** The installed plugin build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code." `localRuns` is top-level, and `readDeclaration` has no unknown-top-level-key check, so a pre-#5369 reader ignores it. `tests/verify-scope-declaration.test.js`'s `AC2.1` parses the committed file with the latest release tag's reader (#4135) and must stay green after Task 8.
- `suite-slot-test-env`, quoted: "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env`". This applies to Task 8's `--stamp-status` spawn.
- `windows-checkout-test-parity`: a test whose assertion depends on a launcher that win32 cannot spawn skips with a stated reason true of that test alone. `residue.js` spawns `npm` without a shell, which finds no `npm.cmd` on win32. So the one Task 6 CLI test that expects `npm test` to run skips on win32. The under-the-key CLI test spawns no `npm` and runs everywhere.
- Degrade-clause convention: the "no PR to push to" clause cites `_shared/integration-model.md`'s resolution for `local-merge` / `current-branch`, and `flow/multispec-parallel-waves.md:107` ("Never push") for wave members. It invents no new detection.

## Decisions this plan makes where the spec leaves a choice

1. **Standalone never pushes.** A standalone session runs the scoped invocation and, on exit 3, re-runs with `--local` and reports the no-verdict line. Pushing a person's branch unasked is a side effect no standalone `/test` has today. Push-first applies to pipeline sites in a `pr-first` worktree run (a run dir is set). The spec's "a standalone session on a branch without a PR passes `--local` on its first call" is met through the runner: its exit 3 on `head-not-pushed`/`no-open-pr-at-head` is the PR probe, and an agent-side `gh` lookup would duplicate `ci-source.js`'s check. That costs one `gh` round trip and no check run.
2. **The four pre-push sites pass `--local` unconditionally**, with or without the key. These are the express lane, an implementer's affected set, the driver's `testStep` and a parallel-wave member. Before a push CI cannot answer for any project. Without the key, `--local` changes only the recorded reason (`local-requested` instead of `head-not-pushed`/`dirty-tree`) and skips a `gh` call. The skill prose and `verify.js` ship in one plugin, so no installed build lacks the flag. The driver does not read the declaration to decide, which keeps the worker-adjacent scope file out of a second reader.
3. **`full` is never skipped** by Skip-if-recent or by a `VERIFICATION_PASSED=true` signal. A CI-written or subset stamp verifies HEAD, but the release asks for this machine's run on macOS and Node 22, which no stamp proves. `full` stamps as a full set and runs no QA stories.
4. **The release runs `/claude-tweaks:test full` in Step 3**, after the review-tree check passes and before the `## /review` marker. Its full stamp makes review's Step 1.5 read `verifiedHead: true`, so the review runs no second subset. A red run stops the release before Step 4 with reason `whole-suite run failed`.
5. **The residue probe skips the whole `npm test` under the key,** including suites with no `ci` source (`journeys` here). `npm test` cannot run one suite of a declaration. The pass stamp the pipeline already wrote holds this run's suite state (`wrap-up/residue-sweep.md:22`). The skip reason names every `ci` entry as `{suite} ({workflow} / {job})`.
6. **`all` keeps meaning "the standard suite plus QA".** Under the key the standard suite is scoped, so the `all` row and the three "full suite + QA" restatements say "standard suite".

## Review Focus

1. **A push-first re-run that outlives the foreground ceiling.** After a push, verify.js polls CI for up to `waitSeconds` (900 by default), which is past the Bash tool's 600 s foreground cap. A reasonable person expects the run to be waited on, not demoted to a silent background run. Task 1's paragraph sends it through the Foreground rule's exception, pinned by the fact `takes the Foreground rule's exception above`.
2. **A parallel-wave member under the key.** Members never push (`multispec-parallel-waves.md:107`), so a member's scoped verify must not try. Pinned in Task 1 (fact `a parallel-wave member, which never pushes`).
3. **This repo's own post-merge Windows job after the opt-in.** Its unscoped verify would exit 2, and the filer would report an unreadable report, on every push to main. Pinned in Task 8, plus a `workflow_dispatch` proof run on the branch.
4. **A declaration with several `ci` suites in the residue reason.** Each must be named. Pinned in Task 6 (`two ci suites are both named`).
5. **The release's red whole-suite run.** It must stop the release, not stage a finding and carry on. Pinned in Task 5 (fact `Step 8's summary reads \`failed\` with reason \`whole-suite run failed\``).

## Out of scope (stated, not deferred silently)

- `tests/build-verify-after-doc-steps.test.js` is in the spec's Key Files but pins nothing this plan changes (#3060's step order and #3489's Category A paragraph). It is run in Task 1 Step 4 as a sibling pin, unchanged.
- `plugin/skills/release/execute.md:202`'s delta review keeps review's own Step 1.5 as its test gate. Under the key that gate runs the delta scoped, which is the intended subset for a delta. No change.
- `plugin/skills/review/code-mode-steps.md:86`'s "scoped when a declaration exists" already matches. Only its "(full suite + QA)" parenthetical changes (Task 4).
- `residue.js` spawning `npm` without a shell fails on win32 (`could not run the project test command`). That is a pre-existing defect, outside this record. File it at wrap-up as a follow-up with its probe: `execFileSync('npm', ['test'])` on win32 throws ENOENT because npm is `npm.cmd`.

---

### Task 1: The scoping table, Push first and exit 3, and the Standalone rule

**Files:**
- Modify: `plugin/skills/test/verification.md:80` (Build row), `:86-87` (Standalone and review rows), `:54` (this repo's whole set), insert the Push first paragraph after `:100` (CI source), `:106` (Standalone paragraph), `:153` (baseline snippet)
- Modify: `plugin/skills/build/SKILL.md:281` (the last sentence of Common Step 5's first paragraph)
- Modify: `tests/test-skill-affected-conformance.test.js:49`
- Create: `tests/pipelines-push-first-local-runs-conformance.test.js`
- Test: `tests/bin-lib/verify/snippet-conformance.test.js`, `tests/build-verify-after-doc-steps.test.js`, `tests/verification-skip-before-execute.test.js`, `tests/build-pre-verify-catchup-conformance.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Produces: the paragraph labels `**Push first, and exit 3 (#5370).**` and `**Standalone is always full — without \`localRuns\`.**`, which Tasks 2, 4 and 5 cite as "`verification.md`'s Push first paragraph" and "Standalone rule". Also the new test file's helpers `scopingProblems(text) -> string[]`, `pinned(text, facts)` and `para(text, label)`, which later tasks reuse in the same file.

The exact text to write (checked with a scratch inline self-consistency run: every fact below matches its text exactly once, and `assertEachPatternGoesRed` passes on it):

- **Row 80:** `| Build Common Step 5 (\`/claude-tweaks:build\`) | scoped (the impact subset via [impact-selection.md](impact-selection.md) when the declaration has \`impact\`; taken from the PR's CI job via [ci-source.md](ci-source.md) when it has \`ci\`; full without a declaration) |`
- **Row 86:** `| Standalone \`/claude-tweaks:test\` | full without \`localRuns\`; scoped under it, and \`/claude-tweaks:test full\` runs the whole suite here |`
- **Row 87:** `| \`/claude-tweaks:review\` Step 1.5 standalone auto-trigger | scoped when it passes \`--source review\`, else as standalone \`/claude-tweaks:test\` |`
- **New paragraph after the CI source (#4347) paragraph:**

  > **Push first, and exit 3 (#5370).** With a `ci` block, a `pr-first` worktree run pushes its branch immediately before each scoped invocation, after any commit or catch-up merge that moves HEAD: `git -C "{worktree-path}" push origin {branch}` (`_shared/pr-early-run-lifecycle.md`'s Step 2 push form). CI answers only for the open PR's head, and its wait (`waitSeconds`) can outlast the 600 s foreground ceiling, so the run takes the Foreground rule's exception above. Under the declaration's `localRuns: "on-request"` a scoped run CI cannot answer exits 3, which is never a test failure: stderr's first line names the suite and the reason (`no verdict yet for suite "{suite}" — CI could not answer ({reason})`). On `head-not-pushed` push and re-run once; on `no-open-pr-at-head` open or record the PR (`_shared/pr-early-run-lifecycle.md`'s Run start) and re-run once. On a second exit 3, or any other reason, re-run with `--local` and log one entry under the calling skill's section: `AUTO {time} — Verification: no CI verdict for suite "{suite}" ({reason}); re-ran with --local on this machine. Reversibility: high.` This adds no stop in `auto` mode, and fix mode never reads exit 3 as a failure. A run with no PR to push to passes `--local` on its first call: `local-merge`, `current-branch` (`_shared/integration-model.md`'s resolution), a parallel-wave member, which never pushes (`flow/multispec-parallel-waves.md`), and a pre-push run (an implementer's affected set, the express lane).

- **Paragraph `:106` becomes:**

  > **Standalone is always full — without `localRuns`.** A site is scoped-eligible only when `$PIPELINE_RUN_DIR` is set (or a parent passed `--source {parent}`, the fallback signal for a caller with no run dir — `/claude-tweaks:flow` sets the run dir and never passes `--source`); with neither signal the invocation is standalone — a human asked for the suite and gets the suite; without `localRuns`, never pass `--scope` there. Under the declaration's `localRuns: "on-request"` a standalone invocation runs the scoped invocation instead, and wherever this file says to run the full procedure for a project with that declaration, the scoped invocation is what runs. Standalone never pushes: on exit 3 it re-runs with `--local` and reports the no-verdict line in Step 3's report. The whole suite runs on this machine only when someone asks for it by name: `/claude-tweaks:test full` (`verify.js --local`, no `--scope`).

- **`:54`:** `in this repo the whole set is \`npm test -- --full\`)` becomes `in this repo the whole set is \`npm test -- --full\`, run with \`--local\` since the repo declares \`localRuns\`)`.
- **`:153`:** insert ` --local` immediately before ` --baseline origin/main` in the indented snippet.
- **`build/SKILL.md:281`:** `**CI source (#4347):** a \`ci\` block needs HEAD pushed first (\`test/ci-source.md\`).` becomes `**Scoped, push first (#5370):** with a declaration this run is \`verification.md\`'s scoped invocation; with a \`ci\` block a \`pr-first\` worktree run pushes immediately before it, after the catch-up below, and handles exit 3 per that file's Push first paragraph.`

- [ ] **Step 1: Write the failing tests.** Create `tests/pipelines-push-first-local-runs-conformance.test.js`. Put its header comment first: it pins #5370's pipeline verify rule in the prose that states it, reads live prose deliberately, and gives each fact list a go-red proof. Then write:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const VERIFICATION = 'plugin/skills/test/verification.md';
const BUILD = 'plugin/skills/build/SKILL.md';

// A paragraph found by its opening label; '' when absent, so the facts go missing rather than throw.
const para = (text, label) => lineStartingWith(text, label);
// Asserts every fact matches, then proves each one can go red on its own.
function pinned(text, facts) {
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(text), []);
  assertEachPatternGoesRed(text, facts, missing);
}

// The Re-verify scoping table: every pipeline site's Mode cell starts `scoped`.
const NOT_PIPELINE = ['Standalone `/claude-tweaks:test`', '`/claude-tweaks:review` Step 1.5 standalone auto-trigger', '`/claude-tweaks:test affected`'];
function scopingProblems(text) {
  const at = text.indexOf('### Re-verify scoping');
  const end = text.indexOf('**Scoped invocation.**', at);
  assert.ok(at !== -1 && end > at, 'the Re-verify scoping table and the Scoped invocation paragraph after it must exist');
  const rows = text.slice(at, end).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Site |'));
  const cells = rows.map((l) => l.split(' | ').map((c) => c.replace(/^\| |\s*\|$/g, '')));
  const problems = [];
  const pipeline = cells.filter(([site]) => !NOT_PIPELINE.includes(site));
  if (pipeline.length !== 6) problems.push(`expected 6 pipeline rows, found ${pipeline.length}`);
  for (const [site, mode] of pipeline) if (!mode.startsWith('scoped')) problems.push(`${site}: ${mode}`);
  const standalone = cells.find(([site]) => site === NOT_PIPELINE[0]);
  if (!standalone || !standalone[1].includes('full without `localRuns`; scoped under it')) problems.push('Standalone row must read full without `localRuns`; scoped under it');
  return problems;
}
```

  Then add these tests:
  - `'AC1.1: every pipeline row of the scoping table is scoped, Build Common Step 5 included (#5370)'`: `assert.deepEqual(scopingProblems(read(VERIFICATION)), [])`.
  - `'AC1.2: reverting the Build row to full makes the scoping assertion name it'`: take `v = read(VERIFICATION)`, replace `'| scoped (the impact subset via'` with `'| full (impact-selected via'`, `assert.notEqual(mutated, v)`, then `assert.ok(scopingProblems(mutated).some((p) => p.startsWith('Build Common Step 5')))`. Also add two controls in the same shape. The first replaces the Polish row's `| scoped |` with `| full |` and expects a problem starting `Polish re-verify`. The second replaces `full without \`localRuns\`; scoped under it` with `full` and expects the Standalone problem.
  - `'AC1.1, AC3.2: the Push first paragraph states the push, exit 3 handling and the --local fallback (#5370)'`: `pinned(para(read(VERIFICATION), '**Push first, and exit 3 (#5370).**'), PUSH_FACTS)` with:

```js
const PUSH_FACTS = [
  [/\*\*Push first, and exit 3 \(#5370\)\.\*\*/, 'labeled'],
  [/a `pr-first` worktree run pushes its branch immediately before each scoped invocation/, 'push before each scoped invocation'],
  [/`git -C "\{worktree-path\}" push origin \{branch\}`/, 'the push command'],
  [/takes the Foreground rule's exception above/, 'the CI wait follows the Foreground exception'],
  [/exits 3, which is never a test failure/, 'exit 3 is not a failure'],
  [/On `head-not-pushed` push and re-run once/, 'head-not-pushed: push, re-run once'],
  [/on `no-open-pr-at-head` open or record the PR/, 'no-open-pr-at-head: open or record the PR'],
  [/On a second exit 3, or any other reason, re-run with `--local`/, 'second exit 3 or another reason: --local'],
  [/`AUTO \{time\} — Verification: no CI verdict for suite "\{suite\}" \(\{reason\}\); re-ran with --local on this machine\. Reversibility: high\.`/, 'the one AUTO entry naming the reason'],
  [/adds no stop in `auto` mode/, 'no auto-mode stop'],
  [/passes `--local` on its first call/, 'a run with no PR passes --local first'],
  [/`local-merge`, `current-branch`/, 'the no-PR integration models'],
  [/a parallel-wave member, which never pushes/, 'parallel-wave members'],
  [/a pre-push run/, 'pre-push runs'],
];
```

  - `'the Standalone rule keeps "always full" for a project without the key and scopes it under the key (#5370)'`: `pinned(para(read(VERIFICATION), '**Standalone is always full — without \`localRuns\`.**'), STANDALONE_FACTS)` with:

```js
const STANDALONE_FACTS = [
  [/\*\*Standalone is always full — without `localRuns`\.\*\*/, 'labeled, keeping the old literal'],
  [/a standalone invocation runs the scoped invocation instead/, 'standalone is scoped under the key'],
  [/wherever this file says to run the full procedure for a project with that declaration/, 'the full-procedure override'],
  [/Standalone never pushes: on exit 3 it re-runs with `--local`/, 'standalone never pushes'],
  [/`\/claude-tweaks:test full` \(`verify\.js --local`, no `--scope`\)/, 'the whole suite by name'],
];
```

  - `'AC2.1: Common Step 5 is scoped and pushes first, after the catch-up (#5133, #5370)'`: slice `step5 = b.slice(b.indexOf('### Common Step 5:'), b.indexOf('\n### ', b.indexOf('### Common Step 5:') + 1))` from `read(BUILD)`. Assert `!step5.includes('needs HEAD pushed first')`, then `pinned(step5, BUILD_FACTS)` with:

```js
const BUILD_FACTS = [
  [/\*\*Scoped, push first \(#5370\):\*\* with a declaration this run is `verification\.md`'s scoped invocation/, 'scoped with a declaration'],
  [/pushes immediately before it, after the catch-up below/, 'the push follows the catch-up'],
  [/handles exit 3 per that file's Push first paragraph/, 'the exit 3 pointer'],
];
```

  - `"this repo's unscoped whole set carries --local (#5370)"`: in `read(VERIFICATION)`, the line containing `the whole set is \`npm test -- --full\`` includes `run with \`--local\``. The one line matching `/^ {4}node ".*bin\/verify\.js".*--baseline /` includes ` --local --baseline origin/main`.

  In `tests/test-skill-affected-conformance.test.js:49`, change `'| full (impact-selected via'` to `'| scoped (the impact subset via'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/test-skill-affected-conformance.test.js`
Expected: FAIL after Step 1. This run is the revert proof: the tree is still the pre-change text. `scopingProblems` names `Build Common Step 5: full (impact-selected via …`, the Push first and Standalone paragraphs are absent (facts missing), Common Step 5 still says `needs HEAD pushed first`, and `test-skill-affected-conformance`'s row check fails on `| scoped (the impact subset via`.

- [ ] **Step 3: Edit `verification.md` and `build/SKILL.md`** with the exact text above. The Push first paragraph goes after the `**CI source (#4347).**` paragraph and before `**Baseline on the same invocation (#3511).**`, so "the Foreground rule's exception above" points back to Step 2's Foreground rule. Add no fenced block.

- [ ] **Step 4: Run the tests to verify they pass, with the sibling pins**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/test-skill-affected-conformance.test.js tests/bin-lib/verify/snippet-conformance.test.js tests/build-verify-after-doc-steps.test.js tests/verification-skip-before-execute.test.js tests/build-pre-verify-catchup-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, including `context-cost`'s `rail:` tests (AC2.1's rail clause: `build/SKILL.md` and every composed bundle fit one Read call).

Run: `wc -c plugin/skills/test/verification.md plugin/skills/build/SKILL.md`
Expected: `verification.md` under 49,500 B, `build/SKILL.md` under 49,400 B.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md plugin/skills/build/SKILL.md tests/pipelines-push-first-local-runs-conformance.test.js tests/test-skill-affected-conformance.test.js
git commit -m "Scope Build Common Step 5 and push before each scoped verify — exit 3 re-runs once or with --local, standalone keeps full without localRuns, refs #5370"
```

### Task 2: The pre-push and re-run sites pass `--local`

**Files:**
- Modify: `plugin/skills/_shared/express-lane.md:16` (step 4)
- Modify: `plugin/skills/build/dispatch.md:14` (the `**Affected-set testing (#5117).**` call)
- Modify: `plugin/skills/test/flake-handling.md:17` (`## Whole-suite re-run`)
- Test: `tests/pipelines-push-first-local-runs-conformance.test.js`, `tests/pipeline-test-scope-conformance.test.js`, `tests/express-lane-prose.test.js`, `tests/verification-flake-handling.test.js`

**Interfaces:**
- Consumes: Task 1's "Push first paragraph" label, `pinned`, `para`.

Exact edits:
- **`express-lane.md:16`:** inside the code span, `--integration-branch {ref}\`` becomes `--integration-branch {ref} --local\``. After `{slots}` resolved first per its Step 2 Suite slots paragraph`, insert `; \`--local\` because the branch is not pushed until step 6, so CI cannot answer, per its Push first paragraph`.
- **`dispatch.md:14`:** `--scope .claude-tweaks/verify-scope.json --integration-branch {integration-branch} --no-stamp` becomes `--scope .claude-tweaks/verify-scope.json --local --integration-branch {integration-branch} --no-stamp`. After `(\`test/verification.md\`'s Suite slots paragraph)`, insert ` — \`--local\` because these runs are pre-push (\`test/verification.md\`'s Push first paragraph) —`.
- **`flake-handling.md:17`:** after `exactly as the scoped invocation in \`verification.md\`'s "Re-verify scoping" does.`, insert ` Under the declaration's \`localRuns: "on-request"\` add \`--local\`: the re-run is a second run on this machine, and without it a scoped re-run takes CI's same verdict again and an unscoped one exits 2.`

- [ ] **Step 1: Write the failing tests.** Append to `tests/pipelines-push-first-local-runs-conformance.test.js` one test, `'AC1.1: the pre-push sites and the whole-suite re-run pass --local (#5370)'`, which calls `pinned` on three slices:
  - `lineStartingWith(read('plugin/skills/_shared/express-lane.md'), '4. **Impacted tests.**')` with `[[/--integration-branch \{ref\} --local`/, 'the lane passes --local'], [/`--local` because the branch is not pushed until step 6/, 'why: pre-push']]`.
  - `read('plugin/skills/build/dispatch.md').split('\n').find((l) => l.includes('**Affected-set testing (#5117).**'))` with `[[/--scope \.claude-tweaks\/verify-scope\.json --local --integration-branch \{integration-branch\} --no-stamp`/, 'the affected set passes --local'], [/`--local` because these runs are pre-push/, 'why: pre-push']]`.
  - `sectionOf(read('plugin/skills/test/flake-handling.md'), '## Whole-suite re-run')` (import `sectionOf` too) with `[[/Under the declaration's `localRuns: "on-request"` add `--local`/, 'the re-run passes --local'], [/a scoped re-run takes CI's same verdict again and an unscoped one exits 2/, 'why']]`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js`
Expected: FAIL after Step 1 (the revert proof: pre-change text). All six facts are missing.

- [ ] **Step 3: Make the three edits above.**

- [ ] **Step 4: Run the tests to verify they pass, with the sibling pins**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/pipeline-test-scope-conformance.test.js tests/express-lane-prose.test.js tests/verification-flake-handling.test.js tests/risk-flags-bypass-prose.test.js tests/flow-claim-preflight.test.js tests/dispatch-prompt-cli-prose.test.js`
Expected: PASS. `pipeline-test-scope-conformance`'s `assertEachPatternGoesRed` on `dispatch.md` still finds facts 23-33 exactly once each.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/express-lane.md plugin/skills/build/dispatch.md plugin/skills/test/flake-handling.md tests/pipelines-push-first-local-runs-conformance.test.js
git commit -m "Pass --local at the pre-push verify sites and the whole-suite re-run — CI cannot answer before a push, refs #5370"
```

### Task 3: The driver's test step passes `--local`

**Review risk:** high (decision logic: which exit maps to which stop)

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js:672-675` (the scoped `args`) and the `testStep` comment at `:639-641`
- Modify: `tests/bin-lib/driver/run.test.js:1946-1954` (`AC12.1`'s expected argv gains `'--local'`)
- Test: `tests/bin-lib/driver/run.test.js`, `tests/bin-lib/driver/settle.test.js`

**Interfaces:**
- Produces: the scoped `testStep` argv is `['--run', runDir, '--default-suite-slots', slots, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', ref, '--local']`. The full branch (no scope file) is unchanged: there is no declaration there, so no key.

- [ ] **Step 1: Write the failing tests.** In `tests/bin-lib/driver/run.test.js`, append `'--local'` to `AC12.1`'s expected `v.args.slice(1)`. Then add, beside it:

```js
const NO_VERDICT = 'verify.js: no verdict yet for suite "tests" — CI could not answer (head-not-pushed), and the declaration\'s localRuns "on-request" keeps it off this machine; no check ran and no pass stamp was written.';

test('AC8.1: under the key the test step passes --local, so a verify that exits 3 without it never fails the run (#5370)', async () => {
  const h = harness({ script: [scopeIs('file'), scopeSame(),
    [on('node', /verify\.js$/), (c) => (c.args.includes('--local')
      ? { code: 0, stdout: '', stderr: '' }
      : { code: 3, stdout: '', stderr: `${NO_VERDICT}\n  Either push the branch …\n  or re-run it with --local …\n` })]] });
  await run(['#7'], h.deps);
  const calls = verifyCalls(h);
  assert.equal(calls.length, 1, 'one verify call, carrying --local');
  assert.ok(calls[0].args.includes('--local'));
  assert.equal(h.lines().find((l) => l.step === 'test').status, 'ok');
  assert.notEqual(lastLine(h).stop && lastLine(h).stop.reason, 'failing-test');
});

test('AC8.1: an exit 3 that still reaches the test step is a failed call, never a failing-test stop (#5370)', async () => {
  const h = harness({ script: [scopeIs('file'), scopeSame(), [on('node', /verify\.js$/), { code: 3, stdout: '', stderr: `${NO_VERDICT}\n` }]] });
  await run(['#7'], h.deps);
  const testLine = h.lines().find((l) => l.step === 'test');
  assert.equal(testLine.status, 'fail');
  assert.equal(testLine.detail, NO_VERDICT);
  assert.deepEqual([lastLine(h).stop.step, lastLine(h).stop.reason], ['test', 'express-error']);
});
```

  The second test pins behavior that already holds at HEAD (`steps.js:695`). It guards against a later change that maps every non-zero exit to `failing-test`. To prove it can go red, temporarily change `steps.js:695` to return `{ status: 'stop', reason: 'failing-test', detail: 'red tests' }` for every non-zero code, run it, watch it fail, and restore the line before committing (`git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5319-5369-5370" diff -- plugin/bin/lib/driver/steps.js` shows only the Step 3 change).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 (the revert proof). `AC12.1` sees no `'--local'`. The first AC8.1 test gets a verify call without `--local`, which exits 3, so the test step is `fail`. The second AC8.1 test passes. It is the guard described above.

- [ ] **Step 3: Implement in `steps.js`.** Append `'--local'` to the scoped `args`. Extend the `testStep` comment: the step runs before the push and before any PR exists (`STEPS` order), so CI cannot answer; `--local` keeps verify.js from exiting 3 under a declaration's `localRuns` and is harmless without it (#5370); it ports express-lane.md step 4, which says the same.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Pass --local from the driver's pre-push test step — no PR exists yet, so CI cannot answer and exit 3 never reaches it, refs #5370"
```

### Task 4: `/claude-tweaks:test full` and the standalone rule in the test skill

**Files:**
- Modify: `plugin/skills/test/SKILL.md:4` (argument-hint), `:31` (`(none)` row), `:51` (`all` row, plus a new `full` row after it), `:76` (default bullet), `### Standard suite (no arguments)` (one sentence), new `### Whole suite here (\`full\`)` subsection between it and `### Targeted scope (with arguments)`
- Modify: `plugin/skills/help/reference-card.md:16` (Takes cell), `:121` (usage line, plus a new `full` usage line after it)
- Modify: `plugin/skills/review/code-mode-steps.md:86` (`(full suite + QA)` becomes `(standard suite + QA)`)
- Modify: `docs/getting-started.md:53` (`→ full suite + QA stories` becomes `→ standard suite + QA stories`)
- Test: `tests/pipelines-push-first-local-runs-conformance.test.js`, `tests/argument-hint-mirrors.test.js`, `tests/argument-hint-input.test.js`, `tests/test-skill-affected-conformance.test.js`, `tests/skill-catalog-completeness.test.js`, `tests/skill-conventions.test.js`

**Interfaces:**
- Consumes: Task 1's Standalone rule and `verify.js --local` (#5369).

Mirror surfaces, from `docs/skill-authoring.md`'s Argument-hint mirror surfaces table: `frontmatter` and `reference-card-takes` are required. `test/SKILL.md` has no `input-parse-line`, `usage-line` or `syntax-block` (its `## Input` opens "`$ARGUMENTS` controls scope and mode:"). Grep for an existing flag, `git grep -n -F "affected|qa|all|skip-qa" -- plugin docs README.md tests`, finds only `test/SKILL.md:4`. Descriptive restatements found with `git grep -n -F "full suite + QA"` are `reference-card.md:121`, `docs/getting-started.md:53`, `review/code-mode-steps.md:86` and `test/SKILL.md:51` (that last as "Full suite"). Each is edited here.

Exact text:
- **argument-hint:** `[types|lint|unit|integration|e2e|affected|qa|all|full|skip-qa|<path>] [tag=<tag>] …` (insert `full|` after `all|`, rest unchanged). The card's Takes cell gets the same insertion, `all\|full\|skip-qa`.
- **`(none)` row:** `| *(none)* | Standard suite — run all checks documented in CLAUDE.md (types + lint + tests); under the declaration's \`localRuns\`, the scoped invocation, never the whole suite (\`verification.md\`) |`
- **`all` row:** `| \`all\` | Standard suite (types + lint + tests, as with no argument) AND QA story validation |`
- **`full` row, after `all`:** `| \`full\` | The whole suite here: every suite's full command on this machine (\`verify.js --local\`, no \`--scope\`), never skipped by Skip-if-recent. Under the declaration's \`localRuns\` it is the only way to ask for the whole suite on this machine |`
- **`:76`:** `- No \`VERIFICATION_PASSED\` (default) → run full suite (and QA …)` becomes `- No \`VERIFICATION_PASSED\` (default) → run the standard suite (\`verification.md\`'s scoping table) (and QA …)`, rest unchanged.
- **Standard suite subsection, appended sentence:** `Under the declaration's \`localRuns: "on-request"\`, that procedure runs the scoped invocation, standalone too (\`verification.md\`'s Standalone rule), and never the whole suite.`
- **New subsection:**

  > ### Whole suite here (`full`)
  >
  > Run `verification.md` Step 2's run command with `--local` added and no `--scope`, as the full check set: it is not a targeted scope and never passes `--no-stamp`, so it stamps. Skip-if-recent does not apply, and neither does a `VERIFICATION_PASSED=true` signal: a stamp CI wrote, or one from an impact subset, never stands in for a run here. With `$PIPELINE_RUN_DIR` set the baseline flags still apply (`verification.md`'s Baseline adjudication). QA stories do not run.

- **Reference card, after `:121`:** `/claude-tweaks:test full                              → the whole suite on this machine, asked for by name`, with the arrow aligned to the neighbouring lines.

- [ ] **Step 1: Write the failing tests.** Append to `tests/pipelines-push-first-local-runs-conformance.test.js` one test, `'AC4.1, AC4.3: /claude-tweaks:test full runs the whole suite here, no argument does not, and the hint and card name full (#5370)'`. Read `s = read('plugin/skills/test/SKILL.md')` and assert:
  - `lineStartingWith(s, 'argument-hint:').includes('|all|full|skip-qa|')`.
  - `lineStartingWith(read('plugin/skills/help/reference-card.md'), '| \`/claude-tweaks:test\` |').includes('all\\|full\\|skip-qa')`.
  - `pinned(lineStartingWith(s, '| \`full\` |'), [[/every suite's full command on this machine \(`verify\.js --local`, no `--scope`\)/, 'full runs every full command here'], [/never skipped by Skip-if-recent/, 'never skipped']])`.
  - `pinned(sub(s, '### Whole suite here (\`full\`)'), WHOLE_FACTS)`, where `sub(text, heading)` slices from the heading to the next `\n### ` (assert the heading exists) and `WHOLE_FACTS` is `[[/Run `verification\.md` Step 2's run command with `--local` added and no `--scope`/, 'the command'], [/never passes `--no-stamp`/, 'it stamps'], [/Skip-if-recent does not apply/, 'never skipped'], [/a stamp CI wrote, or one from an impact subset, never stands in for a run here/, 'why']]`.
  - `pinned(sub(s, '### Standard suite (no arguments)'), [[/Under the declaration's `localRuns: "on-request"`, that procedure runs the scoped invocation, standalone too/, 'no argument is scoped under the key']])`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js`
Expected: FAIL after Step 1 (the revert proof). The hint has no `|full|`, the card has no `all\|full`, the `full` row and subsection are absent, and the Standard suite sentence is missing.

- [ ] **Step 3: Make the edits above.**

- [ ] **Step 4: Run the tests to verify they pass, with every mirror suite**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/test-skill-affected-conformance.test.js tests/skill-catalog-completeness.test.js tests/skill-conventions.test.js tests/review-build-not-run-conformance.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. `argument-hint-mirrors` finds the hint byte-equal in the card's Takes cell, and `argument-hint-input` finds the `full` leaf documented in `## Input`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/SKILL.md plugin/skills/help/reference-card.md plugin/skills/review/code-mode-steps.md docs/getting-started.md tests/pipelines-push-first-local-runs-conformance.test.js
git commit -m "Add /claude-tweaks:test full — the whole suite on this machine by name; no argument runs scoped under localRuns, refs #5370"
```

### Task 5: The release runs the whole suite before the review

**Files:**
- Modify: `plugin/skills/release/SKILL.md` (a new paragraph after `:173`, "Step 8's summary reads `failed` with that same reason.", and before `**This review stages; it never commits.**`)
- Modify: `docs/skill-graph.md` (`## release` table: a `/test` row)
- Test: `tests/pipelines-push-first-local-runs-conformance.test.js`, `tests/release-review-tree-check-conformance.test.js`, `tests/release-run-dir-lifecycle-conformance.test.js`, `tests/release-skill-reference-form.test.js`, `tests/skill-graph-table-structure.test.js`, `tests/skill-graph-dangling-pointer.test.js`

**Interfaces:**
- Consumes: Task 4's `/claude-tweaks:test full`.

Exact text:

> **The whole suite on this machine, by name (#5370).** Once the tree check exits 0, and before the marker below, run `/claude-tweaks:test full` from `$RUN_ROOT` with `$PIPELINE_RUN_DIR={run-dir}` set. It is the one deliberate whole-suite run on a developer machine per version, and the only one on macOS and Node 22 before the tag (`test/impact-selection.md`'s Whole suite on request). Its full pass stamp verifies the tip, so the review's Step 1.5 test gate reads `verifiedHead: true` and does not re-run a subset. A failing run stops here, before Step 4: nothing has moved, and Step 8's summary reads `failed` with reason `whole-suite run failed`.

Skill-graph row: `| \`/test\` | Step 3 runs \`/claude-tweaks:test full\` after the review-tree check and before the whole-branch review (#5370): the one deliberate whole-suite run on the developer machine per version, whose full pass stamp review's Step 1.5 test gate then reads; a red run stops the release before Step 4. |`

Step-position trace (the Step-position check): this paragraph runs in Step 3 at `$RUN_ROOT`, the main checkout, on `{branch}` at `{tip-sha}`. The tree check just proved that. The run directory is live (Step 0 created or adopted it), and no worktree is involved, so `/claude-tweaks:test full` stamps `$RUN_ROOT`'s own git dir. That is the checkout review's Step 1.5 reads, because the review is invoked from `$RUN_ROOT` too (`:150`).

- [ ] **Step 1: Write the failing tests.** Append `'AC4.2: the release runs /claude-tweaks:test full after the tree check and before the review marker (#5370)'`. Read `r = read('plugin/skills/release/SKILL.md')` and `p = para(r, '**The whole suite on this machine, by name (#5370).**')`. Call `pinned(p, RELEASE_FACTS)`. Then assert the order: `r.indexOf(p) > r.indexOf('&& git -C "$RUN_ROOT" diff --quiet {tip-sha} HEAD')` and `r.indexOf(p) < r.indexOf('**Mark the \`## /review\` block before invoking.**')`, with `p !== ''` asserted first. Add a control: moving the paragraph to after the Mark heading's paragraph fails the order assertion (`assert.notEqual(mutated, r)`, then `assert.throws(() => assertOrder(mutated), /before the review marker/)`, with the order check factored into `assertOrder(text)` and messages `'after the tree check'` / `'before the review marker'`).

```js
const RELEASE_FACTS = [
  [/run `\/claude-tweaks:test full` from `\$RUN_ROOT` with `\$PIPELINE_RUN_DIR=\{run-dir\}` set/, 'runs test full from RUN_ROOT'],
  [/before the marker below/, 'before the review marker'],
  [/one deliberate whole-suite run on a developer machine per version/, 'once per version'],
  [/the only one on macOS and Node 22 before the tag/, 'the only macOS and Node 22 run'],
  [/reads `verifiedHead: true` and does not re-run a subset/, 'the review gate reads the full stamp'],
  [/Step 8's summary reads `failed` with reason `whole-suite run failed`/, 'a red run stops the release'],
];
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js`
Expected: FAIL after Step 1 (the revert proof). The paragraph is absent.

- [ ] **Step 3: Insert the paragraph and the skill-graph row.**

- [ ] **Step 4: Run the tests to verify they pass, with the release and graph suites**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/release-review-tree-check-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js tests/release-as-anchor-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js`
Expected: PASS. `release-review-tree-check-conformance`'s `STOP_FACTS` still match exactly once in Step 3.

Run: `wc -c plugin/skills/release/SKILL.md`
Expected: under 49,600 B.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/release/SKILL.md docs/skill-graph.md tests/pipelines-push-first-local-runs-conformance.test.js
git commit -m "Run /claude-tweaks:test full in the release before the whole-branch review — the one whole-suite run here per version, refs #5370"
```

### Task 6: The close-time suite probe under the key

**Files:**
- Modify: `plugin/bin/lib/residue/probes/suite.js` (add and export `localRunsSkip`)
- Modify: `plugin/bin/residue.js:116-123` (read the declaration, consult `localRunsSkip` after `--no-suite` and before `hasTestScript`)
- Modify: `docs/plugin-structure.md:184` (the residue CLI entry)
- Modify: `plugin/skills/wrap-up/residue-sweep.md:45-48` (one sentence after the `--no-suite` paragraph)
- Test: `tests/bin-lib/residue/probes-observed.test.js`, `tests/bin-lib/residue/cli.test.js`

**Interfaces:**
- Produces: `localRunsSkip(decl) -> null | { ran: false, reason: string, findings: [] }`, a pure function. It returns non-null only when `decl && decl.localRuns === 'on-request' && decl.ci`. Reason, exact: `` `not run on this machine — the declaration's localRuns "on-request" takes ${jobs} from the PR's CI job; /claude-tweaks:test full runs it here` ``, where `jobs` is `Object.entries(decl.ci).map(([suite, c]) => \`${suite} (${c.workflow} / ${c.job})\`).join(', ')`.
- In `residue.js`: `const root = git(['rev-parse', '--show-toplevel']) || cwd;`, then `const read = readDeclaration(path.join(root, DECLARATION_PATH));` and `const skip = localRunsSkip(read.ok ? read.decl : null);`. Import `readDeclaration` and `DECLARATION_PATH` from `./lib/verify/declaration`. No `existsSync`: a missing file reads `{ ok: true, decl: null }` and an unreadable one `{ ok: false }`, and both mean no key (`tests/path-guard-conformance.test.js`'s allowlist stays as it is). Reuse `root` for `probePipelineRuns`' `worktreeRoot`, so `rev-parse --show-toplevel` runs once.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/bin-lib/residue/probes-observed.test.js` (import `localRunsSkip` beside `probeSuite`):

```js
const CI1 = { tests: { workflow: 'test.yml', job: 'test', waitSeconds: 900, pollSeconds: 20 } };
test('AC7.1: under localRuns the suite probe is not run, naming the declared CI job (#5370)', () => {
  assert.deepStrictEqual(localRunsSkip({ localRuns: 'on-request', ci: CI1 }), {
    ran: false, findings: [],
    reason: 'not run on this machine — the declaration\'s localRuns "on-request" takes tests (test.yml / test) from the PR\'s CI job; /claude-tweaks:test full runs it here',
  });
});
test('#5370: two ci suites are both named in the skip reason', () => {
  const r = localRunsSkip({ localRuns: 'on-request', ci: { ...CI1, e2e: { workflow: 'e2e.yml', job: 'browser' } } });
  assert.match(r.reason, /takes tests \(test\.yml \/ test\), e2e \(e2e\.yml \/ browser\) from the PR's CI job/);
});
test('AC7.2: without the key, or with no declaration, the probe is not skipped (#5370)', () => {
  for (const decl of [null, { localRuns: null, ci: CI1 }, { localRuns: null, ci: null }]) assert.strictEqual(localRunsSkip(decl), null, JSON.stringify(decl));
});
```

  - In `tests/bin-lib/residue/cli.test.js`, add a `suiteRepo(declaration)` helper. Its `mkdtemp` git repo copies the existing tests' `init` and `config user.*` calls. It writes `package.json` `{ "scripts": { "test": "node -e \"require('fs').writeFileSync('suite-ran', 'x')\"" } }`, writes `.claude-tweaks/verify-scope.json` when `declaration` is given, and makes one commit. Then add two tests:

```js
const DECL = { checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], ci: { tests: { workflow: 'test.yml', job: 'test' } } };
const suiteResult = (out) => JSON.parse(out).results[3]; // worktrees, branches, forge, suite, …

test('AC7.1, AC7.3: with localRuns the probe never starts npm test and names the CI job (#5370)', () => {
  const root = suiteRepo({ ...DECL, localRuns: 'on-request' });
  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--json'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(suiteResult(out).ran, false);
  assert.match(suiteResult(out).reason, /^not run on this machine — .*takes tests \(test\.yml \/ test\) from the PR's CI job/);
  assert.ok(!fs.existsSync(path.join(root, 'suite-ran')), 'npm test must not start');
});

test('AC7.2, AC7.3: without the key the probe runs npm test as before (#5370)',
  { skip: process.platform === 'win32' && 'win32: residue.js spawns npm without a shell, and npm is npm.cmd there' }, () => {
  const root = suiteRepo(DECL);
  const out = execFileSync('node', [CLI, '--base', 'HEAD', '--json'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(suiteResult(out).ran, true);
  assert.ok(fs.existsSync(path.join(root, 'suite-ran')), 'npm test must run');
});
```

  Real-writer note: the fixture declaration is parsed by the real `readDeclaration`. A scratch probe while authoring confirmed this shape parses `ok: true` with and without `localRuns`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/residue/probes-observed.test.js tests/bin-lib/residue/cli.test.js`
Expected: FAIL after Step 1 (the revert proof). `localRunsSkip` is not a function, and the under-the-key CLI test sees `ran: true` with the `suite-ran` marker written. The without-key CLI test passes at HEAD. That is the point of AC7.2: behavior unchanged.

- [ ] **Step 3: Implement `localRunsSkip` and the `residue.js` read** as in Interfaces. In `residue.js` the order is `--no-suite`, then `localRunsSkip`, then `hasTestScript`, then `probeSuite`. Extend the comment above `let suiteResult` with one sentence: under `localRuns` the suite is CI's and a bare `npm test` here may run a subset or nothing (#5319), so its exit 0 is no green suite (#5370).
  - **`docs/plugin-structure.md:184`:** before "Exits 2 only on a malformed invocation", insert `; under the declaration's \`localRuns: "on-request"\` the suite probe never runs \`npm test\` and reports \`ran: false\` with a reason naming each declared CI job (#5370).`
  - **`residue-sweep.md`:** after "…rather than silently treating a skip as a pass.", insert `Under the declaration's \`localRuns: "on-request"\` (\`test/ci-source.md\`) the probe never runs the suite either: it reports \`unknown: not run on this machine — …\` naming the declared CI job, and this run's suite state comes from the pass stamp, as for a pack-fed residue.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/residue/probes-observed.test.js tests/bin-lib/residue/cli.test.js tests/bin-lib/residue/render.test.js tests/bin-lib/residue/scope-filter.test.js tests/bin-lib/console/residue-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/residue-own-pr-conformance.test.js tests/bin-lib/health-core/purity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/residue/probes/suite.js plugin/bin/residue.js docs/plugin-structure.md plugin/skills/wrap-up/residue-sweep.md tests/bin-lib/residue/probes-observed.test.js tests/bin-lib/residue/cli.test.js
git commit -m "Report the close-time suite probe as not run under localRuns — a bare npm test may run a subset or nothing, so its exit 0 is no green suite, refs #5370"
```

### Task 7: The decision document, the consumer section, and the retirement sweep

**Files:**
- Create: `docs/decisions/0032-whole-suite-runs-in-ci-local-runs-on-request.md`
- Modify: `plugin/skills/test/impact-selection.md:96-102` (`## Full mode`: rewrite `:98` and `:102`) and append a `## Whole suite on request` section at the end of the file
- Modify: `docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md:76-77`
- Modify: `docs/getting-started.md:11` (one sentence after the `localRuns` sentence)
- Test: `tests/pipelines-push-first-local-runs-conformance.test.js`

**Interfaces:**
- Consumes: every earlier task's wording (the retirement sweep runs over all of it).

Exact text:
- **`impact-selection.md:98`:** `\`verification.md\`'s Re-verify scoping decides the mode. Build Common Step 5 is a scoped site whenever the declaration exists, so the impact suite runs its selected subset, or takes CI's whole-suite verdict when the suite has a \`ci\` source. A standalone run (no \`$PIPELINE_RUN_DIR\`, no \`--source\`) runs full without \`localRuns\` and scoped under it.`
- **`impact-selection.md:102`:** `The explicit full mode is \`/claude-tweaks:test full\`: \`verify.js --local\` with no \`--scope\`, every suite's full command on this machine. Without \`localRuns\`, a standalone \`/claude-tweaks:test\` with no argument is full too.`
- **Appended section** (consumer form: it names the declared CI job, never this repo's `test` job):

  > ## Whole suite on request
  >
  > This section applies under the declaration's `localRuns: "on-request"` (`ci-source.md`).
  >
  > - **The rule.** On a developer machine a CI-declared suite runs as the whole suite only when someone asks for it by name: `/claude-tweaks:test full`, `verify.js --local` with no `--scope`, or `/claude-tweaks:release`'s run before the version bump. Every pipeline verify takes it from the PR's CI job, and runs the impact subset here only when CI cannot answer.
  > - **What a miss is.** A test whose result a change affects but which selection leaves out. Its causes are reads the tracer cannot see (`#` imports, a package's self-reference, a native addon's content, a non-node child's reads, a wrapper such as `xargs` or `timeout`; Known limits above), reads that differ between CI's trace environment and this machine, and reads a test gained after the map was traced without the test file itself changing, since the map may trail HEAD by up to `maxAgeCommits` commits.
  > - **How CI catches it.** When CI answers a pipeline's verify, CI ran the whole suite on that commit, so a miss cannot pass. When `--local` ran the subset, the miss passes on this machine and the declared CI job on the same head is red. The merge gate (`_shared/pr-first-merge.md` Step 2.5) reads the PR's check rollup and its head workflow runs, parks a red PR and waits on a pending one, so the change does not merge.
  > - **What CI does not catch.** A failure that happens only on macOS, on Node 22 or on Windows and that the map also misses. The plugin's own CI runs ubuntu on Node 20, and Windows is checked after merge. The release's whole-suite run on the developer machine is the remaining check before a version ships.
  > - **Who enforces the gate.** The merge gate is the plugin's. A merge made outside it is stopped only when the repository protects its integration branch with the declared CI job's check required.

- **Decision document.** Copy `docs/decisions/0031-*.md`'s shape: `# 0032. …` title; `- **Status:** accepted`, `- **Date:** 2026-11-13`, and `- **Context:** #5370; builds on #5369 (\`localRuns\`, \`--local\`, exit 3), #5319 (a plain \`npm test\` runs the impact subset), #4347 (the \`ci\` source), #4024 (impact selection) and #5133 (the push before Common Step 5)`.
  - `## Context`: the measured redundant runs from the spec's Current State. These are 91 `verify` events in 38 pipeline runs between 9 and 13 November 2026; 21 unscoped runs (149 minutes of test time); 6 of 9 scoped runs falling back on `head-not-pushed`; and standalone always full.
  - `## Decision`: the five numbered items below, then one closing sentence. That sentence says pipelines push first and handle exit 3 per `plugin/skills/test/verification.md`, and this repo opts in with `"localRuns": "on-request"`.
  - `## Alternatives considered`: keep Common Step 5 full here (rejected: it is the 149 minutes); push only at phase exit (rejected: CI cannot answer, #5133); require branch protection (rejected: a repository setting the plugin does not own, so it is stated as the enforcement boundary instead).
  - `## Consequences`: `windows-regression.yml` passes `--local`; the residue probe reports not run; the express lane, implementer affected sets and the driver pass `--local`; installed builds older than #5369 ignore the key (and so still run locally), which is the version floor; and a revisit condition: if the plugin's CI gains macOS or Node 22, the release's whole-suite run is no longer the only check there.

  The `## Decision` items, verbatim (scratch-checked against `AC5_FACTS`):

  > 1. **The rule.** On a developer machine a CI-declared suite runs as the whole suite only when someone asks for it by name: `/claude-tweaks:test full`, `verify.js --local` with no `--scope`, or `/claude-tweaks:release`'s run before the version bump. Every pipeline verify takes it from the PR's CI job, and runs the impact subset here only when CI cannot answer.
  > 2. **What a miss is.** A test whose result a change affects but which selection leaves out. Its causes are reads the tracer cannot see (`#` imports, a package's self-reference, a native addon's content, a non-node child's reads, a wrapper such as `xargs` or `timeout`), reads that differ between CI's trace environment and this machine, and reads a test gained after the map was traced without the test file itself changing: the map may trail HEAD by up to 200 commits (`maxAgeCommits`).
  > 3. **How CI catches it.** When CI answers a pipeline's verify, CI ran the whole suite on that commit, so a miss cannot pass. When `--local` ran the subset, the miss passes on this machine and the PR's `test` job on the same head is red. The merge gate (`plugin/skills/_shared/pr-first-merge.md` Step 2.5) reads the PR's check rollup and its head workflow runs, parks a red PR and waits on a pending one, so the change does not merge.
  > 4. **What CI does not catch.** A failure that happens only on macOS, on Node 22 or on Windows and that the map also misses. CI runs ubuntu on Node 20 (`.github/workflows/test.yml`), and Windows is checked after merge (`windows-regression.yml`). The release's whole-suite run on the developer machine is the remaining check before a version ships.
  > 5. **Who enforces the gate.** The merge gate is the plugin's. A merge made outside it is stopped only when the repository protects its integration branch with the `test` check required.

  Behavioral-claim check: "parks a red PR and waits on a pending one" is `pr-first-merge.md:8`'s shape line and Step 2.5's table (`:198-202`). "Windows is checked after merge" is `windows-regression.yml:3,31-34` (push to main and dispatch only).

- **Journey 4024, `:76`:** `  - Standalone \`/claude-tweaks:test\` and a standalone \`/build\` stay full, without the declaration's \`localRuns\`; under it they run scoped, and \`/claude-tweaks:test full\` runs the whole suite (\`plugin/skills/test/impact-selection.md\`'s Whole suite on request).` On `:77`, after `a \`verify.js --cmd tests="npm test"\` check still runs the whole suite`, insert ` (with \`--local\` under \`localRuns\`)`.
- **`docs/getting-started.md:11`,** after "…and the suite runs here only with `verify.js --local`.": ` Pipelines then push before each scoped verify, and \`/claude-tweaks:test full\` asks for the whole suite on this machine by name.`

- [ ] **Step 1: Write the failing tests.** Append two tests.
  - `'AC5.1-AC5.6: the decision document and impact-selection.md state the rule, a miss, what catches it, what does not, and who enforces the gate (#5370)'`: run `pinned(sectionOf(read('docs/decisions/0032-whole-suite-runs-in-ci-local-runs-on-request.md'), '## Decision'), AC5_FACTS)` and `pinned(sectionOf(read('plugin/skills/test/impact-selection.md'), '## Whole suite on request'), AC5_FACTS)` with:

```js
const AC5_FACTS = [
  [/`\/claude-tweaks:test full`, `verify\.js --local` with no `--scope`/, 'the rule: by name'],
  [/run before the version bump/, 'the rule: the release run'],
  [/Every pipeline verify takes it from the PR's CI job, and runs the impact subset here only when CI cannot answer/, 'the rule: pipelines'],
  [/A test whose result a change affects but which selection leaves out/, 'a miss: definition'],
  [/`#` imports, a package's self-reference, a native addon's content, a non-node child's reads, a wrapper such as `xargs` or `timeout`/, 'a miss: unseen reads'],
  [/reads that differ between CI's trace environment and this machine/, 'a miss: trace environment'],
  [/without the test file itself changing/, 'a miss: reads gained after the trace'],
  [/trail HEAD by up to/, 'a miss: map age'],
  [/CI ran the whole suite on that commit, so a miss cannot pass/, 'caught: CI answered'],
  [/on the same head is red/, 'caught: a local subset passed, CI is red'],
  [/parks a red PR and waits on a pending one, so the change does not merge/, 'caught: the merge gate'],
  [/only on macOS, on Node 22 or on Windows and that the map also misses/, 'not caught: platforms'],
  [/ubuntu on Node 20/, 'not caught: the CI platform'],
  [/Windows is checked after merge/, 'not caught: Windows after merge'],
  [/the remaining check before a version ships/, 'not caught: the release run'],
  [/The merge gate is the plugin's/, 'enforcement: the owner'],
  [/protects its integration branch with the .{1,40} check required/, 'enforcement: branch protection'],
];
```

  - `'AC1.1: no shipped doc keeps a retired always-full or push-later sentence (#5370)'`: walk every `.md` under `plugin/skills/`, `.claude/skills/` and `docs/journeys/`, plus `docs/plugin-structure.md` and `docs/getting-started.md`, through `readText`. Assert the list holds at least one `.claude/skills/` file. Assert no file contains any of `RETIRED`:

```js
const RETIRED = [
  'a `ci` block needs HEAD pushed first',
  '| full (impact-selected via',
  'passes no `--scope` and is the explicit full mode',
  'Standalone `/claude-tweaks:test` and a standalone `/build` stay full.',
  'Otherwise it runs full, as does a standalone `/build`.',
];
```

  For the control, plant each `RETIRED` string in a copy of one walked file's text and assert the same check (factored as `retiredIn(text) -> string[]`) returns it.

  Absence-grep control, run while authoring against HEAD: `git grep -n -F` for all five strings over `plugin .claude/skills docs/plugin-structure.md docs/getting-started.md docs/journeys` matches `build/SKILL.md:281`, `impact-selection.md:98` and `:102`, `verification.md:80` and journey 4024 `:76`. So the sweep can see each of its targets. The walk names its paths and stays outside `.claude-tweaks/` and `docs/superpowers/plans`, so the #4579 exclusions are not needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js`
Expected: FAIL after Step 1 (the revert proof). `sectionOf` throws on the missing decision file and the missing `## Whole suite on request` heading. The sweep finds `passes no \`--scope\` and is the explicit full mode`, `Otherwise it runs full, as does a standalone \`/build\`.` and the journey line. Tasks 1 and 4 already retired the other two.

- [ ] **Step 3: Write the decision document and the four edits above.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/test-skill-affected-conformance.test.js tests/timing-prose-conformance.test.js tests/bin-lib/docs-health/scope.test.js tests/payload-boundary.test.js tests/plan-citations-resolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0032-whole-suite-runs-in-ci-local-runs-on-request.md plugin/skills/test/impact-selection.md docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md docs/getting-started.md tests/pipelines-push-first-local-runs-conformance.test.js
git commit -m "Record decision 0032 — the whole suite runs in CI, here only on request; impact-selection.md states what a miss is and what catches it, refs #5370"
```

### Task 8: This repo opts in, and its Windows job keeps running the suite

**Files:**
- Modify: `.claude-tweaks/verify-scope.json:13` (add `"localRuns": "on-request",` on the line after `"ci"`)
- Modify: `.github/workflows/windows-regression.yml:122-142` (a `--local` line after `--cmd tests="npm test -- --full"`, and one comment line in the block above `run:`)
- Test: `tests/verify-scope-declaration.test.js`, `tests/windows-regression-file-issue.test.js`

**Interfaces:**
- Consumes: `readDeclaration` (#5369's `localRuns` validation), `verify.js --stamp-status --scope`.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/verify-scope-declaration.test.js`, add `const VERIFY_JS = path.join(REPO_ROOT, 'plugin', 'bin', 'verify.js');` and:

```js
test('AC6.1: this repo declares localRuns "on-request" beside its ci block (#5370)', () => {
  const r = readDeclaration(DECL);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.decl.localRuns, 'on-request');
  assert.deepStrictEqual(Object.keys(r.decl.ci), ['tests']);
});

test('AC6.1: verify.js --stamp-status --scope reads this checkout\'s declaration with no validation error (#5370)', () => {
  const out = execFileSync(process.execPath, [VERIFY_JS, '--stamp-status', '--scope', '.claude-tweaks/verify-scope.json'],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' } });
  assert.strictEqual(JSON.parse(out).scopeError, null);
  // Control: the same file with its ci block removed fails on the key, so this check can go red.
  const raw = JSON.parse(fs.readFileSync(DECL, 'utf8'));
  delete raw.ci;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-5370-'));
  fs.writeFileSync(path.join(dir, 'verify-scope.json'), JSON.stringify(raw));
  const bad = readDeclaration(path.join(dir, 'verify-scope.json'));
  assert.strictEqual(bad.ok, false);
  assert.match(bad.errors[0], /^localRuns: needs a ci block/);
});
```

  - In `tests/windows-regression-file-issue.test.js`, beside `F2b`:

```js
test('#5370: the windows job passes --local, so the declaration\'s localRuns never refuses its unscoped run', () => {
  assert.match(stepContaining(jobBlock('windows'), 'id: verify'), /--cmd tests="npm test -- --full"\s+--local\s/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/verify-scope-declaration.test.js tests/windows-regression-file-issue.test.js`
Expected: FAIL after Step 1 (the revert proof). `decl.localRuns` is `null`, the control fails because the current file has no key (`bad.ok` is `true`), and the workflow has no `--local`.

- [ ] **Step 3: Opt in.** Add the key to `.claude-tweaks/verify-scope.json`. Add `--local` to the workflow's `run:` block on its own line after `--cmd tests="npm test -- --full"`. Add the comment `# --local: this repo's declaration sets localRuns "on-request", so an unscoped run naming the CI-declared tests suite needs it, or verify.js exits 2 before any check (#5370).` to the comment block above `run:`.

- [ ] **Step 4: Run the tests to verify they pass, with the release-reader pin**

Run: `node --test tests/verify-scope-declaration.test.js tests/windows-regression-file-issue.test.js tests/run-tests-default-run.test.js tests/bin-lib/verify/declaration.test.js`
Expected: PASS, including `AC2.1: the committed verify-scope.json parses with the latest release tag's declaration reader (#4135)`. That reader predates `localRuns` and ignores the top-level key.

- [ ] **Step 5: Commit**

```bash
git add .claude-tweaks/verify-scope.json .github/workflows/windows-regression.yml tests/verify-scope-declaration.test.js tests/windows-regression-file-issue.test.js
git commit -m "Opt this repo in to localRuns on-request — the post-merge Windows verify passes --local so it still runs the suite, refs #5370"
```

- [ ] **Step 6: Platform proof, after the last code change** (after simplify and after any review fix wave). Push the branch, dispatch the Windows job on it, and read its result. `gh workflow run` has no read-only form, so its argv is unverified until it runs. `gh run list --workflow windows-regression.yml --limit 2 --json databaseId,headBranch,event,conclusion` was run once while authoring and returned this branch's two earlier dispatch runs, both `success`.

Run: `gh workflow run windows-regression.yml --ref worktree-flow+spec-5319-5369-5370`
Then: `gh run list --workflow windows-regression.yml --branch worktree-flow+spec-5319-5369-5370 --limit 1 --json databaseId,conclusion,status`
Expected: once `completed`, `conclusion: success`. A `failure` whose `file` job reports an unreadable report means verify exited 2 (the `--local` is missing). Any other failure is compared against the branch's earlier run 43514526257 before it is read as new.

## Common Step 5 for this build (AC3 evidence, no commit)

This build's own Final Verification is AC3's real input. Follow Task 1's Push first paragraph:
1. Push the branch: `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5319-5369-5370" push origin worktree-flow+spec-5319-5369-5370`.
2. Run the scoped invocation through this worktree's own runner: `node plugin/bin/verify.js --run "$PIPELINE_RUN_DIR" --default-suite-slots {slots} --scope .claude-tweaks/verify-scope.json --integration-branch main --baseline origin/main`. The installed 6.167.0 build predates `localRuns`, so use the worktree's runner. Give the Bash call a 600 s timeout, under the Foreground rule's exception.
3. Read `report.json`'s `ci` entry for `tests`: it must show `used: true`.
4. On exit 3, follow the paragraph (push or `--local`) and log its `AUTO` entry.
5. Write the full stdout to `$PIPELINE_RUN_DIR/evidence/ac3-push-first-verify.txt` (after `mkdir -p "$PIPELINE_RUN_DIR/evidence"`), and log one `AC evidence` entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. Its single line names AC3.1, the command shape, the `ci[0].used` value and the evidence path.

Waived AC3.1 (as a committed test): it describes a live pipeline run against GitHub, so the evidence is the run artifact above, not a fixture.

## Acceptance-criterion coverage

| AC clause | Task(s) | Test that proves it |
|---|---|---|
| AC1.1: Build Common Step 5 scoped, no pipeline site reads as the unscoped command with a declaration | 1, 2, 7 | `AC1.1: every pipeline row of the scoping table is scoped`; `AC1.1, AC3.2: the Push first paragraph …`; `AC1.1: the pre-push sites and the whole-suite re-run pass --local`; `AC1.1: no shipped doc keeps a retired … sentence` |
| AC1.2: a conformance test pins it and goes red when the row is reverted | 1 | `AC1.2: reverting the Build row to full makes the scoping assertion name it`; Task 1 Step 2's run on the pre-change text |
| AC2.1: #5133's two criteria, a push before Common Step 5's verify, and the `rail:` tests pass | 1 | `AC2.1: Common Step 5 is scoped and pushes first, after the catch-up`; `context-cost.test.js`'s `rail:` tests in Task 1 Step 4 |
| AC3.1: a `pr-first` worktree build pushes first and `report.json` shows `used: true` | (Common Step 5) | Waived as a committed test; the AC evidence entry and `evidence/ac3-push-first-verify.txt` |
| AC3.2: exit 3 never ends an `auto` run; the `--local` re-run logs one `AUTO` naming the reason | 1, 3 | `AC1.1, AC3.2: the Push first paragraph …` (the AUTO entry and the no-stop facts); `AC8.1` tests for the driver |
| AC4.1: under the key `test full` runs the whole suite here, no argument does not | 1, 4 | `AC4.1, AC4.3: /claude-tweaks:test full …`; the Standalone rule facts |
| AC4.2: the release's pre-bump verification runs the whole suite here | 5 | `AC4.2: the release runs /claude-tweaks:test full …` |
| AC4.3: `full` in the argument hint and `/help`'s reference card | 4 | `AC4.1, AC4.3: …`; `tests/argument-hint-mirrors.test.js` |
| AC5 (every clause): the rule, a miss, how CI catches it, what it does not, who enforces it | 7 | `AC5.1-AC5.6: the decision document and impact-selection.md state …` (17 facts per slice, each with a go-red proof) |
| AC6.1: the committed declaration with the key is accepted, and `verify.js --scope` reads it with no validation error | 8 | `AC6.1: this repo declares localRuns …`; `AC6.1: verify.js --stamp-status --scope reads …` |
| AC7.1: with the key, the probe is not run, names the CI job, never starts `npm test` | 6 | `AC7.1: under localRuns the suite probe is not run …`; `AC7.1, AC7.3: with localRuns the probe never starts npm test …` |
| AC7.2: without the key it runs `npm test` as before | 6 | `AC7.2: without the key, or with no declaration …`; `AC7.2, AC7.3: without the key the probe runs npm test as before` |
| AC7.3: a test covers both cases | 6 | the two CLI tests above |
| AC8.1: under the key the driver's test step never fails a run on exit 3 | 3 | `AC8.1: under the key the test step passes --local …`; `AC8.1: an exit 3 that still reaches the test step is a failed call …` |
