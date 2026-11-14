# Init Review of Existing PR CI Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, report-only review of a project's existing PR-triggered GitHub Actions workflows (five checks plus an `unparsed` outcome), run by a new `/claude-tweaks:init` Step 22 on first run and by a new Update Mode drift row on re-run, both through one CLI, `plugin/bin/ci-workflow-review.js`.

**Architecture:** `plugin/bin/lib/merge-verification.js` gains one more line-based reader, `readWorkflowShape(text)`, beside `readPullRequestWorkflow` (which stays byte-unchanged). A new pure module `plugin/bin/lib/init/ci-workflow-review.js` turns shapes into findings (`reviewWorkflows`) and owns file discovery with realpath containment (`readWorkflowSet`, `readCiSources`). A thin CLI with a `run(argv, deps)` seam prints a table, drift lines, or one JSON line. Prose: a Step 22 sub-file, a SKILL.md paragraph, an Update Mode row, a `## Concurrency` section in `_shared/ci-skips-drafts.md`, and doc updates.

**Tech Stack:** Node 18+ CommonJS, zero npm deps, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T102742-spec-5160-5161-5162/spec-5162/work/5162-spec.md` (record #5162).

**Execution:** per-task

Scope keywords: readWorkflowShape, classifyDraftCondition, ci-workflow-review

## Build-time facts (spec Task 0 — #5153's reader, as it is on this branch)

The spec's ASSUMPTION Gotcha is resolved by reading `plugin/bin/lib/merge-verification.js` on this branch (#5153 merged):

| Field the checks need | #5153's reader exposes it? | This plan |
|---|---|---|
| PR trigger types | yes — `readPullRequestWorkflow(text).types` / `typesDeclared` (union over `pull_request` + `pull_request_target`) | reused as-is, copied into the new shape |
| draft reference | partly — `draftReference` is a whole-file boolean (any non-comment line matching `DRAFT_REF`), no job scoping, no polarity | kept as a copied field; the checks use the new per-job `if:` text plus `classifyDraftCondition` instead |
| unparsed | partly — a boolean with no reason | becomes reason `pull_request trigger not read`; every new reason is a string |
| `paths`/`paths-ignore`/`branches`/`branches-ignore` under PR triggers; `branches`/`branches-ignore`/`tags`/`tags-ignore` under `push` | no | new (Task 1) |
| `jobs:` structure, job-level `if:`, step-level `if:` count, job-level `concurrency` | no | new (Task 1) |
| workflow-level `concurrency` (scalar, block map, flow map) | no | new (Task 1) |
| top-level `name:` | no | new (Task 1) |

`plugin/skills/_shared/ci-skips-drafts.md` has sections `Workflow shape`, `Pending-status pattern`, `Path filters`, `Coexistence with the \`ci\` verification source`, `Why projects skip drafts`. No push-gating section, so check 5's remedy is the spec's `see #5152` pointer. No concurrency section either; Task 5 adds `## Concurrency` (spec gap G2 below).

Return-shape widening check: `readPullRequestWorkflow`, `readyRequirement`, `workflowHasPullRequestTrigger` and `hasPullRequestCi` are not changed; their consumers (`git grep -n -E "merge-verification['\")]" -- plugin tests`: `plugin/bin/lib/pr-checks/ready-run.js`, `plugin/bin/pr-checks.js`, `plugin/bin/lib/policy-derived-defaults.js`, `tests/merge-verification.test.js`, `tests/bin-lib/pr-checks/ready-run.test.js`, `tests/bin-lib/pr-checks/classify.test.js`) need no edit. The module's export list only grows.

## Spec gaps resolved by recommendation (raised to the controller, not decided silently)

G1, G4, G5 and G8 were raised again at plan review and decided by the user; the spec's `## Plan Review Clarifications` records the four decisions, and the bullets below state the plan that follows from them.

- **G1 — "first run".** Deliverable: "A new bootstrap step … (first run: report-only table of findings; never writes)"; Overview: "a new init bootstrap step on first run, and a report-only Update Mode drift row on re-run". Phase 0 runs before Phase 1 decides the mode, so Step 22 cannot read the mode. Decided at plan review (spec Clarification 2): Step 22 skips itself only when this invocation will actually reach Update Mode's Phase 1u.5, counting the `--update`/`update` override and any `bootstrap` scope, filter-token-only or Scope Selection Gate stop before it, and runs otherwise. Because the gate renders after Phase 0, a run whose gate is still to come holds the review, and the gate's early exits run it (Task 6 states the exact condition and `scope-selection-gate.md`'s two sentences).
- **G2 — check 4's remedy.** Deliverable: "`remedy` is the section name in `_shared/ci-skips-drafts.md`". The doc has no concurrency section. Reading A: add a `## Concurrency` section and cite it. Reading B: a pointer such as check 5's `see #5152`, though no issue fits. Plan: A (Task 5).
- **G3 — "`pull_request` trigger".** The checks say `pull_request`. `readPullRequestWorkflow` unions `pull_request` and `pull_request_target`, and the merge gate treats both as PR CI. Plan: both (`PR_TRIGGERS`), so the review agrees with the gate.
- **G4 — "Do not review `track-issue-fixes.yml`".** Plan, confirmed at plan review (spec Clarification 4): a file with that basename is skipped only when `classifyExistingWorkflow` (`plugin/bin/lib/issue-branch-tracking.js`) returns `current` or `prior-generated`, because that is the plugin's generated file. A `modified` one is project-edited and is reviewed like any project-authored workflow. A skipped file is not counted in `reviewed` and is named on one text-mode line. Task 2's test covers all three classifier states.
- **G5 — Enhancement filter token.** The original premise was wrong: Step 21 already has a token (`release`), and SKILL.md line 47 promises "one per Optional Enhancement step". Decided at plan review (spec Clarification 3): Step 22 gets the token `ci-review`, added to SKILL.md's token line (line 47), the `argument-hint` (line 4), `input-grammar.md`'s token table and `help/reference-card.md`'s init Takes cell, with a conformance pin (Task 6). `argument-hint` and the Takes cell must stay byte-equal (`tests/argument-hint-mirrors.test.js`), so both change together. Both already lack `release`; that is pre-existing and is reported as a follow-up in Task 6's report, not folded in.
- **G8 — drift count.** The new row sits in Phase 1u.5, whose Contract Drift entries feed Phase 1u.6's Total drift count (`update-mode.md` line 557), and the Quick Audit block prints "No drift detected." (line 572). Decided at plan review (spec Clarification 1): the CI Workflow Review row's findings and `unparsed` entries do not count toward that total, so a lasting finding (G7) never forces the full pass. The Quick Audit block lists the row's lines as their own lines and never prints "No drift detected." while any exist (Task 6).
- **G6 — an unparsed workflow as the always-reporting candidate (check 3).** Plan: an unparsed workflow never counts as always-reporting, so check 3 still fires, and its detail names the unparsed files. That way "couldn't tell" is visible, never silently clean.
- **G7 — consequence on this repo.** `.github/workflows/test-impact-map.yml` deliberately sets `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Per AC4.4 every review of this repo reports it `unparsed` (`cancel-in-progress expression not evaluated`), indefinitely. That is per spec; recorded so nobody files it as a bug.

## Global Constraints

- Zero runtime npm deps. Workflow reading is line-based, with no YAML library (spec Gotcha: "The workflow reader is line-based, not a YAML parser (no dependency exists); the checks must tolerate comments, flow and block forms, quoted keys and a leading BOM exactly as `workflowHasPullRequestTrigger` does, and must degrade to `unparsed` rather than guess.").
- One parser: every YAML-shape read lives in `plugin/bin/lib/merge-verification.js`. `plugin/bin/lib/init/ci-workflow-review.js` never parses workflow text. It only classifies a job `if:` expression string (`classifyDraftCondition`).
- `workflowHasPullRequestTrigger`, `readWorkflowFiles`, `hasPullRequestCi`, `readPullRequestWorkflow`, `readyRequirement` and every helper they call (`stripQuotes`, `stripComment`, `flowMappingKeysAtDepth1`, `stripCommentQuoteAware`, `flowMappingEntries`, `readFlowItems`, `readInlineTriggerValue`, `readBlockTrigger`) stay byte-identical (AC6.2). New code may call them and must not edit them. Check: `git -C "<worktree>" diff a16b9ac5a -- plugin/bin/lib/merge-verification.js` shows only added lines plus the `module.exports` change.
- Report-only is structural. The CLI and both init surfaces never write, edit or regenerate a workflow or any other file (spec Gotcha, AC9.1).
- `check` vocabulary, verbatim: `draft-skip-no-ready-for-review | draft-skip-with-ci-source | paths-filter-no-always-reporting-job | no-cancel-in-progress-concurrency | push-all-step-gated`.
- `--drift --json` envelope, verbatim keys: `{reviewed: number, findings: [{workflow, check, remedy, detail}], unparsed: [{workflow, reason}]}`. Nothing else goes in the JSON line.
- Exit codes: 0 report printed, with or without findings (a per-file read failure is an `unparsed` entry); 1 an invalid `verify-scope.json` declaration, or a `.github/workflows` path that exists but cannot be read as a directory (reason on stderr, stdout empty); 2 usage.
- `workflow` field is the repo-display ID `` `.github/workflows/${name}` ``, built with a `/` template and never with `path.join`.
- Never review CI systems other than GitHub Actions. Never use run history.
- Byte rail (`RAIL_BYTES` 52,500), measured with `wc -c` after plan review: `plugin/skills/init/SKILL.md` is 40,682 B and `plugin/skills/init/update-mode.md` is 40,368 B today. Task 6 adds about 545 B to SKILL.md (the Step 22 paragraph plus the `ci-review` token on lines 4 and 47; about 41,230 B after, headroom about 11.3 KB) and about 2,150 B to update-mode.md (the row, its not-counted paragraph and the Quick Audit lines; about 42,520 B after, headroom about 10.0 KB). The other Task 6 prose files stay far below the rail: `input-grammar.md` 6,142 B → about 6,440 B, `scope-selection-gate.md` 4,468 B → about 4,820 B, `help/reference-card.md` 21,098 B → 21,109 B, `bootstrap-steps.md` 5,027 B → about 5,260 B. `plugin/skills/_shared/ci-skips-drafts.md` is far below the rail too.
- Commits: subject `{Verb} {what} — {detail}`, blank line, `Refs #5162`, last line `Claude-Session: https://claude.ai/code/session_017vXcAb4drRt8nWc8RSC5WA`. Write the message with Write to `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-flow-spec-5160-5161-5162/8cb45e2c-127d-459b-9d93-ebb999e56bda/scratchpad/commit-5162-task{N}.txt`. Stage by explicit path with `git -C "<worktree>" add <paths>`, then run `git -C "<worktree>" commit -F <file>`, each as its own Bash call. Never push.
- Tests: focused `node --test <file>` only. Quote the raw tail lines (`# pass`/`# fail`).

### Governing project skills (verbatim quotes)

`gh-api-module-pattern` / `cli-wrapper-contract.md` (the CLI shells out to nothing, but the seam rules apply):
- "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract — an un-wrapped deps call is where #610's one post-review high landed."
- "**A fail-closed branch around an injected dependency needs one test of the real dependency's failure shape, not only a stub that throws.**"
- "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
- "*Payload-1/Invocation-2* (`plugin/bin/wrap-up-engine.js`, `plugin/bin/declined-learning.js`): 0 success, 1 the invocation was well-formed but the stdin/file payload was not (unparseable JSON, a payload that fails validation), 2 malformed invocation (missing/unknown flags, an unknown verb)." This CLI's header names that family, with `init-verify-scope.js --drift`'s exit 1 as its sibling.
- "**Filesystem reads in a new `plugin/bin/` CLI follow two rules no review is guaranteed to catch.** An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` … A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as \"absent\", never checked for existence first"
- "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.** … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."

`parse-signal-discipline`:
- "1. **Give \"couldn't parse\" its own return shape**, distinguishable at the type level from \"doesn't apply\" … Never reuse the same `null`/`undefined`/`[]` for both."
- "2. **Surface the unparseable case as a warning**, not a silent skip — the caller (or the check's own output) should name which input it could not confidently parse"
- "4. **An optional declaration file that was never read is the same collapse, one level up.** … Pass `null`, or another shape the callee branches on explicitly; never the same empty collection the populated-but-empty case produces." Applied as `ciSources: null` (no `verify-scope.json`) versus `[]` (declared, no `ci`).
- "6. **A positive recogniser owes a whole-input match, not a prefix match.**" Applied to the draft-skip clause regexes, anchored `^…$`.
- "11. **A raw fs read's error code owes the same split as a shell-out's exit code (item 8), one level lower.** … Pin the non-ENOENT case with its own fixture (a plain file sitting where a directory is expected, producing `ENOTDIR`)" (AC8.4).
- "28. **A parser that fails closed owes a cheap precondition that proves the signal absent** … `readPullRequestWorkflow` … a file whose text never contains `pull_request` cannot name a PR trigger". `readWorkflowShape` keeps that early-return inside `readPullRequestWorkflow` untouched, and its own walks (push, jobs, concurrency) run regardless, because check 5 reads push-only files.

`regex-scan-linearity`:
- "| Runs on text no caller bounds | Probe it, pin it in `perf/` |"
- "Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`." / "Assert the verdict as well as the time" / "Each case goes red when its fix is reverted. Prove it once by reverting."
- "3. **A `\s` that crosses newlines under `/m`.** … Fix: `[ \t]`". New regexes run per line after `split(/\r?\n/)`, never with `/m`.

`windows-checkout-test-parity`:
- "When code parses text it reads from a tracked file (a workflow, a skill's markdown, a decisions log), add a CRLF case beside the LF one. Build it from the same string with `.replace(/\n/g, '\r\n')`" (the reader suite uses `bothEndings`, as `tests/merge-verification.test.js` does).
- "When the ID is composed from a fixed prefix and an `fs` entry name rather than from a native path, build it with a `/` template instead of `path.join`" (the `workflow` field).

`skill-prose-conformance-tests`:
- "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
- "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead" / "use a missing-facts predicate and prove each fact returns exactly itself … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`)".
- "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors" (Task 5 edits `ci-skips-drafts.md`, pinned by `tests/ci-skips-drafts-conformance.test.js`; Task 6 edits files pinned by `tests/init-release-bootstrap-conformance.test.js`).

`prose-code-twin-pin`: "**Prose-to-code instance (#2253):** `plugin/skills/init/bootstrap/step-21-release.md`'s `## Stack table` … must stay in sync with … `RELEASE_STACK_TABLE`". Step 22's check-to-remedy table gets the same pin against `CHECKS` (Task 6).

`bin-source-scan-conformance`: no task adds a source scan, so its authoring rules do not apply. The existing scans constrain the new `plugin/bin/` files. `tests/path-guard-conformance.test.js` asks you to "route it through plugin/bin/lib/path-guard (lstatType / resolveLeaf / canonicalRealpath / resolveWithin)", so the new files have no `existsSync`/`realpathSync` token, not even in a deps default. `tests/path-containment-conformance.test.js` says to call `isPathContained` from `plugin/bin/lib/shared-primitives.js`, so there is no `startsWith(… path.sep)` or `startsWith('..')`. `tests/bin-lib/exit-code-conformance.test.js` checks the `process.exitCode` guard. No spawn happens, so `windowsHide` never comes up.

## Review Focus

1. A workflow saved with CRLF endings or a leading BOM must read exactly as its LF twin. Task 1's `bothEndings` and BOM tests cover this.
2. `if:` text that is not a job or step condition must never count: a commented-out `# if:`, a line inside a `run: |` script, or a `with:` value. Task 1's step-if counting test covers this.
3. Quoted keys (`'on':`, `"jobs":`) and a quoted or `${{ }}`-wrapped job condition (`if: "${{ !github.event.pull_request.draft }}"`) read the same as their bare forms. Task 1 and Task 2 tests cover this.
4. A reusable-workflow job (`uses:` with no `steps:`) and a hyphenated job id are jobs with `stepIfCount: 0`, never a parse failure. Task 1 covers this.
5. Two `ci` suites naming the same workflow give one `draft-skip-with-ci-source` finding listing both suites, not two findings. Task 2 covers this.

## AC-to-test map

| AC clause | Task | Test (file → name) |
|---|---|---|
| AC1.1 | 2 | `tests/bin-lib/init/ci-workflow-review.test.js` → `AC1.1: a draft skip without ready_for_review …` |
| AC1.2 | 2 | same file → `AC1.2: a draft-only condition …` |
| AC1.3 | 2 | same file → `AC1.3: \|\| or contains() …` |
| AC2.1, AC2.2, AC2.3, AC2.4 | 2 | same file → `AC2.1 …`, `AC2.2 …`, `AC2.3 …`, `AC2.4 …` |
| AC3.1, AC3.2, AC3.3 | 3 | same file → `AC3.1 …`, `AC3.2 …`, `AC3.3 …` |
| AC4.1, AC4.2, AC4.3, AC4.4 | 3 | same file → `AC4.1 …` … `AC4.4 …` |
| AC5.1, AC5.2 | 3 | same file → `AC5.1 …`, `AC5.2 …` |
| AC6.1 | 3, 4 | same file → `AC6.1: a workflow set valid on every check …`; `tests/bin-lib/init/ci-workflow-review-cli.test.js` → `AC6.1: the CLI prints findings: 0 …` |
| AC6.2 | 1 | `tests/merge-verification-workflow-shape.test.js` → `AC6.2: …`, plus the unchanged runs of `tests/merge-verification.test.js` and `tests/merge-verification-gate-conformance.test.js` in Task 1 Step 4 |
| AC7.1 | 3, 4 | `ci-workflow-review.test.js` → `AC7.1: a malformed on: …`; CLI test → `AC7.1: the report line never reads clean …` |
| AC8.1, AC8.2, AC8.3, AC8.4, AC8.5 | 4 | CLI test → `AC8.1 …` … `AC8.5 …` |
| AC9.1 | 4 | CLI test → `AC9.1: every invocation leaves the fixture byte-identical` (plus the `runCli` snapshot assertion every CLI test goes through) |
| AC10.1, AC10.2, AC10.3, AC10.4 | 4 | CLI test → `AC10.1 …` … `AC10.4 …` |
| AC11.1, AC11.2 | 6 | `tests/init-ci-workflow-review-conformance.test.js` → `AC11.1 …`, `AC11.2 …` |

Plan Review Clarifications (spec), each pinned by its own test: 1 (drift count) → Task 6 `drift count: …`; 2 (Step 22 skip) → Task 6 `step-22 re-run gate: skips …` and `step-22 re-run gate: runs …` (both directions); 3 (`ci-review` token) → Task 6 `ci-review: …`, plus `tests/argument-hint-mirrors.test.js` and `tests/argument-hint-input.test.js` in Task 6 Step 4; 4 (generated `track-issue-fixes.yml`) → Task 2 `the generated track-issue-fixes.yml …`.

Waived plugin/bin/lib/verify/declaration.js: read-only. Task 4's `readCiSources` calls its `readDeclaration(filePath, fsImpl)` unchanged, and Task 4 Step 1's tests exercise it through the real CLI.

---

### Task 1: Extend the workflow reader with `readWorkflowShape` (spec Task 0)

**Role:** judgment
**Review risk:** high (a fail-closed parser; every check's verdict rests on it)

**Files:**
- Modify: `plugin/bin/lib/merge-verification.js` (append a `// --- Workflow shape reader (#5162) ---` section after `readyRequirement`; extend `module.exports`)
- Test: `tests/merge-verification-workflow-shape.test.js` (new)
- Create: `perf/workflow-shape-linearity.test.js`

**Interfaces:**
- Consumes: `readPullRequestWorkflow`, `PR_TRIGGERS`, `DRAFT_REF`, `stripQuotes`, `stripComment`, `stripCommentQuoteAware`, `flowMappingEntries`, `readFlowItems`, `TYPE_ITEM`, `BLOCK_ITEM` (existing, unchanged).
- Produces: `readWorkflowShape(text: string) -> WorkflowShape`, plus the newly exported `DRAFT_REF` (the existing regex) and `PR_FILTER_KEYS = Object.freeze(['branches', 'branches-ignore', 'paths', 'paths-ignore'])`.

```
WorkflowShape = {
  name: string | null,              // top-level name:, comment- and quote-stripped; null when absent or empty
  prTrigger: boolean,               // = readPullRequestWorkflow(text).prTrigger
  types: string[],                  // = readPullRequestWorkflow(text).types
  typesDeclared: boolean,           // = readPullRequestWorkflow(text).typesDeclared
  draftReference: boolean,          // = readPullRequestWorkflow(text).draftReference
  prFilters: string[],              // sorted, deduped PR_FILTER_KEYS present under any pull_request / pull_request_target trigger
  pushTrigger: boolean,
  pushBranches: 'absent' | 'all' | 'some',   // 'all' iff the branches items are exactly ['**']
  pushBranchesIgnore: boolean,
  pushTags: boolean,                // `tags` or `tags-ignore` present under push
  jobs: [{ id: string, if: string | null, stepIfCount: number, concurrency: boolean }],
  concurrency: 'absent' | 'no-cancel' | 'cancel-true' | 'cancel-false' | 'cancel-expression',
  unparsed: string[],               // reasons, in detection order, deduped; [] when fully read
}
```

Unparsed reasons (exact strings): `no on: block`, `no jobs: key`, `tab indentation in on:`, `tab indentation in jobs:`, `tab indentation in concurrency:`, `anchor or alias in on:`, `anchor or alias in jobs:`, `anchor or alias in concurrency:`, `on: block not read`, `pull_request trigger not read` (when `readPullRequestWorkflow(text).unparsed`), `push branches not read`, `jobs: not read`, `job {id} if: not read`, `concurrency not read`, `cancel-in-progress value not read`.

- [ ] **Step 1: Write the failing test** `tests/merge-verification-workflow-shape.test.js`. Header comment: pins #5162's reader extension and AC6.2. Use the same `bothEndings(text, fn)` helper as `tests/merge-verification.test.js` (LF then `.replace(/\n/g, '\r\n')`). Every fixture assertion runs through `bothEndings`.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mv = require('../plugin/bin/lib/merge-verification');

function bothEndings(text, fn) { fn(text); fn(text.replace(/\n/g, '\r\n')); }
const MIN = 'on: push\njobs:\n  a:\n    runs-on: x\n';

test('readWorkflowShape: every exported field is pinned by name — a rename fails here', () => {
  assert.equal(typeof mv.readWorkflowShape, 'function');
  assert.ok(mv.DRAFT_REF instanceof RegExp);
  assert.deepEqual([...mv.PR_FILTER_KEYS], ['branches', 'branches-ignore', 'paths', 'paths-ignore']);
  const s = mv.readWorkflowShape(MIN);
  assert.deepEqual(Object.keys(s).sort(), ['concurrency', 'draftReference', 'jobs', 'name', 'prFilters', 'prTrigger',
    'pushBranches', 'pushBranchesIgnore', 'pushTags', 'pushTrigger', 'types', 'typesDeclared', 'unparsed']);
  assert.deepEqual(Object.keys(s.jobs[0]).sort(), ['concurrency', 'id', 'if', 'stepIfCount']);
});
```

Further tests, each with its fixture set (a name each):
- `name: top-level name in bare, quoted and commented forms` — `name: CI\n`, `name: 'CI' # x\n`, `"name": "CI"\n` give `'CI'`. No `name:`, or `  name:` nested under a job, gives `null`.
- `prFilters: block, flow-mapping and pull_request_target forms` — `on:\n  pull_request:\n    paths: ['src/**']\n` → `['paths']`. `on: { pull_request: { branches: [main], paths-ignore: [docs/**] } }` → `['branches', 'paths-ignore']`. `on:\n  pull_request_target:\n    branches-ignore:\n      - x\n` → `['branches-ignore']`. `on: [push, pull_request]` → `[]`. A `paths:` under `push:` only → `[]`.
- `push: absent, all, some, ignore and tags` — `on: push` → `pushTrigger: true, pushBranches: 'absent'`. `branches: ['**']`, `branches: '**'` and the block list `- '**'` → `'all'`. `branches: [main]` and `branches:\n      - main\n      - 'release/*'` → `'some'`. `branches-ignore: [x]` → `pushBranchesIgnore: true`. `tags: ['v*']` and `tags-ignore: [x]` → `pushTags: true`. `on: { push: { branches: [main] } }` → `'some'`. `branches: ${{ x }}` → `unparsed` includes `push branches not read`. No push → `pushTrigger: false`.
- `jobs: job-level if in inline, quoted, wrapped, block and folded forms` — `if: github.event.pull_request.draft == false`, `if: "github.event.pull_request.draft == false"` (surrounding quotes stripped), `if: ${{ !github.event.pull_request.draft }}` (kept verbatim; the classifier unwraps it), `if: |\n      a &&\n      b` → `'a && b'`, `if: >-\n      a\n      && b` → `'a && b'`, and a plain multi-line `if: a\n      && b` → `'a && b'`. A job with no `if:` → `if: null`. `if:` with an empty value and nothing deeper → `unparsed` includes `job a if: not read`.
- `jobs: stepIfCount counts step keys only` — steps holding `- if: x`, a step whose `if:` sits on its key column after `- name: n`, `run: |` whose script lines contain `if: y` and `if [ -f z ]`, a `with:` child `if: w`, and a commented `# if: v` → `stepIfCount: 2`. A job with `uses: ./.github/workflows/r.yml` and no steps, id `build-and-test` → `{ id: 'build-and-test', if: null, stepIfCount: 0, concurrency: false }`. A job-level `concurrency: x` → `concurrency: true`.
- `concurrency: scalar, block and flow forms` — absent → `'absent'`. `concurrency: ci-${{ github.ref }}` → `'no-cancel'`. Block `group: x` only → `'no-cancel'`. Block `cancel-in-progress: true` → `'cancel-true'`, `false` → `'cancel-false'`, `${{ github.event_name == 'pull_request' }}` → `'cancel-expression'`. Flow `{group: x, cancel-in-progress: true}` → `'cancel-true'`. Unbalanced flow `{group: x,` → `unparsed` includes `concurrency not read`. `cancel-in-progress: 'true'` → `cancel-in-progress value not read`. Job-level concurrency only → workflow-level `'absent'`.
- `unparsed: each reason fires on its own fixture` — one fixture per reason string above, each asserting `deepEqual(s.unparsed, [reason])`, so no fixture trips a neighbouring reason (Guard-branch discrimination). Tab: `on:\n\tpush:\n`. Alias: `on: *t`, `jobs:\n  a: *j`, `concurrency: *c`. Anchor: `concurrency: &c\n  group: x`. A merge key `<<: *base` in the jobs region. No `on:`. No `jobs:`. `jobs: {}` → `jobs: not read`. Flow `on: [push,` → `on: block not read`. Negative controls in the same test: `run: ls *.md`, `run: echo a *b`, `if: a && b` and `paths: ['**/*.md']` add no alias reason.
- `BOM: a leading BOM reads as its BOM-less twin` — `'\uFEFF' + fixture` deepEquals the shape of `fixture`, for one PR and one push fixture.
- `AC6.2: readWorkflowShape copies readPullRequestWorkflow's four fields unchanged` — for every fixture string above and every case string in `tests/merge-verification.test.js`'s reader tests (inline the twelve strings from its `AC5.1` and `I1` tests), `{prTrigger, types, typesDeclared, draftReference}` of the shape deepEqual `readPullRequestWorkflow(text)`'s same four fields. When `readPullRequestWorkflow(text).unparsed`, the shape's `unparsed` includes `pull_request trigger not read`.

`perf/workflow-shape-linearity.test.js`: header names #5162, says it is not part of `npm test`, gives `Run with: npm run test:perf`, and lists each probe. Each case asserts the verdict and `ms < 2000`:
- `'jobs:\n  a:\n    if: ' + 'a && '.repeat(40000) + 'b\n'` (prefixed with `on: push\n`) → `jobs[0].if` length > 0, `unparsed` `[]`.
- `'on: push\n' + '\n'.repeat(40000) + 'jobs:\n  a:\n    runs-on: x\n'` → one job.
- a `run: |` block of 40,000 lines under one step → `stepIfCount: 0`.
- `` `on: push\njobs:\n  a:\n    if: a${' '.repeat(200000)}b\n` `` → `if` starts with `'a'`.
- `'on: push\njobs:\n' + Array.from({ length: 5000 }, (_, i) => `  j${i}:\n    runs-on: x\n`).join('')` → 5,000 jobs. This is the one-persistent-position check: no per-job rescan from the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/merge-verification-workflow-shape.test.js`
Expected: FAIL — `mv.readWorkflowShape` is not a function (`DRAFT_REF`/`PR_FILTER_KEYS` are not exported yet).

- [ ] **Step 3: Implement `readWorkflowShape(text)` in `plugin/bin/lib/merge-verification.js`**

Approach (the implementer writes the bodies; these are the decisions):
- Never throws. A non-string or empty input returns `{ ...emptyShape, unparsed: ['no on: block'] }`. Strip a leading BOM, then `lines = text.split(/\r?\n/)`. Every regex runs on one line, with no `/m`, and line-internal whitespace is matched as `[ \t]`.
- Top-level key lines are col 0 and quote-tolerant: `/^(?:KEY|'KEY'|"KEY")[ \t]*:(.*)$/` for `on`, `jobs`, `concurrency`, `name`. A region is its key line through the line before the next col-0 key. Blank and comment lines never end a region. The one exception is the indentless `- ` sequence under `on:`, which reuses `readPullRequestWorkflow`'s rule.
- Region checks before any other read of that region: a tab in a line's leading whitespace gives `tab indentation in {region}`. An anchor or alias gives `anchor or alias in {region}`: after `stripCommentQuoteAware` and blanking quoted spans, a `[&*][A-Za-z0-9_]` at a value start (after `key:` plus `[ \t]+`, after a line-leading `- `, or after `[`, `{` or `,` when the value starts with `[` or `{`), or a `<<[ \t]*:` key.
- `on:` filters: one new helper `readTriggerKeys(lines, onIdx)` returning `Map<'pull_request'|'pull_request_target'|'push', Map<subKey, {rest, line}>>` or the reason `on: block not read`. It reads the scalar, flow list, flow mapping (`flowMappingEntries` for the outer and each `{…}` trigger value) and block forms. Its comment marks it as a twin of `readPullRequestWorkflow`'s `on:` walk: it only reads trigger sub-keys, and it fails toward `unparsed`. `prFilters` = `PR_FILTER_KEYS` present under either PR trigger.
- Push branches items: a one-line `[..]` (via `readFlowItems`, quotes stripped), a scalar, or a block list read like `readBlockTrigger`'s list (items matching `BLOCK_ITEM` widened to allow `*`, `/`, `.`, `-`). `['**']` gives `'all'`. Anything else readable gives `'some'`. Unreadable gives `push branches not read`.
- Jobs walk, one forward pass with a persistent index: the job indent is the first content line's indent under `jobs:`. A line at the job indent must be `id:` with an empty value (`[A-Za-z_][A-Za-z0-9_-]*`, optionally quoted), else `jobs: not read`. The job key indent is its first content line's indent. Only keys at that indent are job-level (`if`, `concurrency`, `steps`). Any key whose value is a block-scalar indicator `^[|>][-+0-9]*$` swallows the deeper lines, except `if:`, whose deeper lines are joined. Job `if:` value: `stripCommentQuoteAware`, then strip one pair of surrounding quotes. A block or folded scalar, or a plain value with deeper continuation lines, is the trimmed lines joined by one space. Inside `steps:`, each `- ` item sets that step's key column (the column after `- `). A step `if:` is `- if:` or `if:` at that column. Deeper lines and block-scalar contents are skipped.
- Workflow `concurrency:`: an inline `{` value goes through `flowMappingEntries` (unbalanced gives `concurrency not read`). Any other non-empty inline value gives `'no-cancel'`. An empty value reads the sub-block at its first indent, and no sub-block gives `concurrency not read`. The `cancel-in-progress` value, comment-stripped: `true` → `'cancel-true'`, `false` → `'cancel-false'`, containing `${{` → `'cancel-expression'`, else `cancel-in-progress value not read`. No such key gives `'no-cancel'`.
- `pr = readPullRequestWorkflow(text)`: copy its four fields. `pr.unparsed` adds `pull_request trigger not read`.
- `module.exports` gains `readWorkflowShape, DRAFT_REF, PR_FILTER_KEYS`. Nothing else changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/merge-verification-workflow-shape.test.js tests/merge-verification.test.js tests/merge-verification-gate-conformance.test.js tests/bin-lib/pr-checks/ready-run.test.js perf/workflow-shape-linearity.test.js`
Expected: PASS, all five files. Then run `git -C "<worktree>" diff --stat a16b9ac5a -- tests/merge-verification.test.js tests/merge-verification-gate-conformance.test.js`. Expected: empty output (AC6.2: both suites unchanged). Prove the perf file once by reverting: make the jobs walk restart at `jobs:` for each job, confirm the 5,000-job case goes red, then restore.

- [ ] **Step 5: Commit** — stage `plugin/bin/lib/merge-verification.js`, `tests/merge-verification-workflow-shape.test.js`, `perf/workflow-shape-linearity.test.js`. Subject: `Add readWorkflowShape to the workflow reader — trigger filters, jobs, if: text, concurrency, unparsed reasons`.

---

### Task 2: Findings module — draft-skip predicate, unparsed, checks 1 and 2

**Role:** judgment
**Review risk:** high (decision logic: polarity, stacking, fail-closed)

**Files:**
- Create: `plugin/bin/lib/init/ci-workflow-review.js`
- Test: `tests/bin-lib/init/ci-workflow-review.test.js` (new)

**Interfaces:**
- Consumes: `readWorkflowShape`, `DRAFT_REF` (Task 1); `classifyExistingWorkflow` from `plugin/bin/lib/issue-branch-tracking.js`.
- Produces:
  - `CHECKS` — frozen, in this order: `{ 'draft-skip-no-ready-for-review': 'Workflow shape', 'draft-skip-with-ci-source': 'Coexistence with the \`ci\` verification source', 'paths-filter-no-always-reporting-job': 'Path filters', 'no-cancel-in-progress-concurrency': 'Concurrency', 'push-all-step-gated': 'see #5152' }`
  - `classifyDraftCondition(expr: string) -> 'skip' | 'draft-only' | 'none' | 'unparsed'`
  - `reviewWorkflows({ workflows: Array<{workflow: string, text: string} | {workflow: string, unreadable: string}>, ciSources: Array<{suite: string, workflow: string}> | null }) -> { reviewed: number, findings: Array<{workflow, check, remedy, detail}>, unparsed: Array<{workflow, reason}>, skipped: string[] }`
  - `formatRemedy(remedy: string) -> string` — `'see #5152'` unchanged; otherwise `` `_shared/ci-skips-drafts.md` § {remedy} ``.
  - `GENERATED_TRACKING_WORKFLOW = 'track-issue-fixes.yml'`

- [ ] **Step 1: Write the failing test** `tests/bin-lib/init/ci-workflow-review.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'init', 'ci-workflow-review.js'));
const { generateWorkflowYaml, classifyExistingWorkflow } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'issue-branch-tracking.js'));
const { readText } = require(path.join(__dirname, '..', '..', 'helpers', 'read-skill.js'));

const wf = (name, text) => ({ workflow: `.github/workflows/${name}`, text });
const checksOf = (r, w) => r.findings.filter((f) => f.workflow === w).map((f) => f.check);
const CONC = 'concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n';
const draftWf = ({ types = 'types: [opened, synchronize]', cond = 'github.event.pull_request.draft == false', name = 'CI' } = {}) =>
  `name: ${name}\non:\n  pull_request:\n${types ? `    ${types}\n` : ''}${CONC}jobs:\n  test:\n    if: ${cond}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
const W = '.github/workflows/ci.yml';
const review = (texts, ciSources = null) => M.reviewWorkflows({ workflows: Object.entries(texts).map(([n, t]) => wf(n, t)), ciSources });
```

Tests (each id goes in the test name):
- `classifyDraftCondition: skip, draft-only, none and unparsed forms`:
  - `skip`: `github.event.pull_request.draft == false`, `!github.event.pull_request.draft`, `${{ !github.event.pull_request.draft }}`, `github.event.pull_request['draft'] != true`, `github.event.pull_request.draft != true && github.actor != 'bot'`.
  - `draft-only`: `github.event.pull_request.draft == true`, `github.event.pull_request.draft != false`.
  - `none`: `github.actor != 'bot'`, `always()`.
  - `unparsed`: `github.event.pull_request.draft == false || always()`, `!contains(toJSON(github.event.pull_request.draft), 'true')`, `(!github.event.pull_request.draft)`, `false == github.event.pull_request.draft`, a bare `github.event.pull_request.draft`, the mixed `!github.event.pull_request.draft && github.event.pull_request.draft == true`, and the truncated `github.event.pull_request.draft ==`.
- `AC1.1: a draft skip without ready_for_review yields exactly draft-skip-no-ready-for-review` — loop `types` over `['types: [opened, synchronize]', '']` and `cond` over the three spec conditions (`… == false`, `!github.event.pull_request.draft`, `github.event.pull_request.draft != true && github.actor != 'bot'`). Each: `deepEqual(checksOf(r, W), ['draft-skip-no-ready-for-review'])`, `r.findings[0].remedy === 'Workflow shape'`, `r.findings[0].detail` includes `test`, `r.unparsed` `[]`.
- `AC1.2: a draft-only condition (== true) yields no finding` — `deepEqual(r.findings, [])`, `deepEqual(r.unparsed, [])`.
- `AC1.3: || or contains() around the draft reference is unparsed and nothing else` — two fixtures. Each: `checksOf(r, W)` `[]` and `deepEqual(r.unparsed, [{ workflow: W, reason: 'draft condition not understood' }])`.
- `AC2.1: ready_for_review in the types clears draft-skip-no-ready-for-review` — `types: [opened, synchronize, reopened, ready_for_review]` → findings `[]`.
- `AC2.2: a ci source naming the ready_for_review workflow by basename, path or name: yields exactly draft-skip-with-ci-source` — three runs with `ciSources: [{ suite: 'tests', workflow }]`, `workflow` ∈ `'ci.yml'`, `'.github/workflows/ci.yml'`, `'CI'`. Each: `deepEqual(checksOf(r, W), ['draft-skip-with-ci-source'])` and remedy `Coexistence with the \`ci\` verification source`.
- `AC2.3: without ready_for_review plus the ci source both checks stack` — `deepEqual(checksOf(r, W), ['draft-skip-no-ready-for-review', 'draft-skip-with-ci-source'])`.
- `AC2.4: a ci source naming a workflow file that does not exist yields no finding` — ready_for_review fixture, `ciSources: [{ suite: 'tests', workflow: 'missing.yml' }]` → findings `[]`, unparsed `[]`.
- `two ci suites naming one workflow give one finding listing both` — one `draft-skip-with-ci-source` whose detail includes `tests` and `e2e`.
- `ciSources null skips check 2; [] declares none` — both give findings `[]` on the ready_for_review fixture, and `reviewWorkflows` accepts both.
- `an unreadable entry and a reader unparsed reason are unparsed entries, never findings` — `{ workflow: W, unreadable: 'dangling symlink — not read' }` → `unparsed: [{ workflow: W, reason: 'dangling symlink — not read' }]`. A text with no `jobs:` gives reason `no jobs: key`, and several reader reasons are joined with `'; '`.
- `the generated track-issue-fixes.yml is skipped (current or prior-generated); a hand-modified copy is reviewed` — three runs at `track-issue-fixes.yml`, each first asserting the fixture's classifier rung with `classifyExistingWorkflow` (imported beside `generateWorkflowYaml`). `generateWorkflowYaml()` (`'current'`) → `reviewed: 0`, `skipped: ['.github/workflows/track-issue-fixes.yml']`. `readText(path.join(__dirname, '..', '..', 'fixtures', 'track-issue-fixes-pre-5152.yml'))` (`'prior-generated'`, the fixture `tests/issue-branch-tracking.test.js` already pins) → the same. The current text with a job's `if:` removed and a step `if:` added (`'modified'`) → `reviewed: 1`, `skipped: []`, and that workflow's findings and `unparsed` entries are exactly what the same text yields at `other.yml` (reviewed like any project-authored workflow).
- `formatRemedy renders a section citation and passes the #5152 pointer through` — `formatRemedy('Path filters') === '`_shared/ci-skips-drafts.md` § Path filters'`, `formatRemedy('see #5152') === 'see #5152'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/init/ci-workflow-review.test.js`
Expected: FAIL — `Cannot find module …/plugin/bin/lib/init/ci-workflow-review.js`.

- [ ] **Step 3: Implement the module**

Header comment: names #5162. It is the five checks as a pure function over `readWorkflowShape` results, plus (Task 4) discovery. It never parses YAML and never writes. Remedies are section names in `_shared/ci-skips-drafts.md`; they are never restated text.

`classifyDraftCondition` (the algorithm, since the tests leave the parse open):
1. `s = expr.trim()`. When `s` starts with `${{` and ends with `}}`, `s` = the trimmed inner text.
2. `!DRAFT_REF.test(s)` → `'none'`.
3. `s` contains `${{` or `||` → `'unparsed'`.
4. Split `s` on `&&` at paren depth 0 outside `'`/`"` quotes, in one pass. For each clause where `DRAFT_REF` matches, it must fully match `SKIP = /^(?:![ \t]*D|D[ \t]*==[ \t]*false|D[ \t]*!=[ \t]*true)$/` or `DRAFT_ONLY = /^(?:D[ \t]*==[ \t]*true|D[ \t]*!=[ \t]*false)$/`, where `D` is `github\.event\.pull_request(?:\.draft|\[[ \t]*'draft'[ \t]*\]|\[[ \t]*"draft"[ \t]*\])`. Any other clause → `'unparsed'`.
5. Every draft clause SKIP → `'skip'`. Every draft clause DRAFT_ONLY → `'draft-only'`. Mixed → `'unparsed'`.

`reviewWorkflows`:
- Skip `GENERATED_TRACKING_WORKFLOW` by basename when `classifyExistingWorkflow(text)` is `current` or `prior-generated` (spec gap G4, spec Clarification 4). A `modified` copy goes through every check like any other file.
- `reviewed` = entries not skipped.
- An `unreadable` entry → one `unparsed` entry.
- Otherwise `shape = readWorkflowShape(text)`. Unparsed reasons are `shape.unparsed`, plus (`shape.prTrigger` only) `draft condition not understood` when any job's `if` classifies `'unparsed'`, plus (Task 3) the concurrency expression reason.
- Any reason → one `{workflow, reason: reasons.join('; ')}` and no findings for that workflow (AC1.3).
- Draft-skip jobs = jobs with `if !== null && classifyDraftCondition(if) === 'skip'`. They count only when `shape.prTrigger`.
- Check 1: draft-skip jobs and `!shape.types.includes('ready_for_review')`. Detail: `` `job(s) ${ids.join(', ')} skip drafts; types: ${shape.types.join(', ')}${shape.typesDeclared ? '' : ' (default)'}` ``.
- Check 2: `ciSources` non-null, draft-skip jobs, and at least one source whose `workflow` equals the entry's basename, the entry's `.github/workflows/…` ID, or `shape.name`. Detail: `` `ci source ${suites.join(', ')} names this workflow; job(s) ${ids.join(', ')} skip drafts` ``.
- `findings` in workflow input order, then `CHECKS` key order. Each finding's `remedy` comes from `CHECKS`.
- Write each check as its own small function; Task 3 adds three more beside them.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/init/ci-workflow-review.test.js tests/issue-branch-tracking.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — stage `plugin/bin/lib/init/ci-workflow-review.js`, `tests/bin-lib/init/ci-workflow-review.test.js`. Subject: `Add the CI workflow review's draft-skip checks — job if: polarity, ready_for_review, ci-source conflict`.

---

### Task 3: Checks 3, 4 and 5, and the clean set

**Role:** integration
**Review risk:** high (cross-workflow decision in check 3)

**Files:**
- Modify: `plugin/bin/lib/init/ci-workflow-review.js`
- Test: `tests/bin-lib/init/ci-workflow-review.test.js` (append)

**Interfaces:**
- Consumes: Task 2's `reviewWorkflows` skeleton, `CHECKS`, `classifyDraftCondition`; Task 1's shape fields `prFilters`, `jobs`, `concurrency`, `pushTrigger`, `pushBranches`, `pushBranchesIgnore`, `pushTags`.
- Produces: no new exports. `reviewWorkflows` emits the three remaining checks and the `cancel-in-progress expression not evaluated` reason. Check 3's PR-candidate rule (Step 3) is internal and decides which unparsed files its detail names.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/init/ci-workflow-review.test.js`. Fixture builders: `prWf({ on = '  pull_request:\n', conc = CONC, jobs = '  a:\n    runs-on: x\n    steps:\n      - run: t\n' })` and `pushWf(onBlock, jobs)`.
  - `AC3.1: a paths filter on pull_request with no other workflow yields exactly paths-filter-no-always-reporting-job` — `on: '  pull_request:\n    paths: [\'src/**\']\n'`. `deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job'])`, remedy `Path filters`.
  - `AC3.2: a second unfiltered pull_request workflow with an if:-free job clears it` — add `other.yml` = `prWf()` → findings `[]`.
  - `AC3.3: a second workflow whose every job skips drafts, or whose trigger has branches:, does not count` — two runs. The second workflow is `prWf` with `types: [opened, synchronize, reopened, ready_for_review]` and every job `if: github.event.pull_request.draft == false`, or `prWf` with `branches: [main]`. Each yields the finding on `W` again.
  - `an unparsed second workflow is not counted, and the detail names it` — second workflow with no `jobs:` → finding on `W` whose detail includes `.github/workflows/other.yml`, plus that workflow's `unparsed` entry.
  - `an unreadable second workflow is a PR-candidate: not counted, and the detail names it; a read push-only unparsed file is not named` — call `M.reviewWorkflows` directly with `wf('ci.yml', prWf({ on: '  pull_request:\n    paths: [\'src/**\']\n' }))` and `{ workflow: '.github/workflows/other.yml', unreadable: 'could not read: EACCES' }` → `deepEqual(checksOf(r, W), ['paths-filter-no-always-reporting-job'])`, the finding's detail ends with `(unparsed, not counted: .github/workflows/other.yml)`, and `r.unparsed` includes `{ workflow: '.github/workflows/other.yml', reason: 'could not read: EACCES' }`. Second run, same `ci.yml` plus `push.yml` = `on: push\n` with no `jobs:` (unparsed `no jobs: key`, `prTrigger: false`, `on:` read) → the finding's detail has no `(unparsed, not counted` suffix, and `push.yml`'s `unparsed` entry is still there.
  - `AC4.1: a pull_request workflow with no concurrency key yields exactly no-cancel-in-progress-concurrency` — `conc: ''` → `deepEqual(checksOf(r, W), ['no-cancel-in-progress-concurrency'])`, remedy `Concurrency`, detail `no workflow-level concurrency`.
  - `AC4.2: flow-form and block-form cancel-in-progress: true yield none` — `concurrency: {group: x, cancel-in-progress: true}\n` and `CONC` → findings `[]`.
  - `AC4.3: cancel-in-progress: false, a scalar concurrency and job-level concurrency only each yield one` — details `cancel-in-progress: false`, `concurrency has no cancel-in-progress`, `job-level concurrency only`.
  - `AC4.4: a cancel-in-progress expression is unparsed` — `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` → findings `[]`, `unparsed: [{ workflow: W, reason: 'cancel-in-progress expression not evaluated' }]`. The same concurrency in a push-only workflow is not unparsed (the check applies to PR workflows only).
  - `AC5.1: on: push with only a step-level if: yields exactly push-all-step-gated` — `on: push` with step `- if: github.ref == 'refs/heads/main'` → `deepEqual(checksOf(r, W), ['push-all-step-gated'])`, remedy `see #5152`. Also `branches: ['**']` → the same finding.
  - `AC5.2: branches: [main], branches-ignore, tags only, a job-level if:, or no if: anywhere yield none` — five runs, each findings `[]`. A push with `tags` plus `branches: ['**']` still yields the finding.
  - `AC6.1: a workflow set valid on every check yields an empty findings list` — `ci.yml` (types with `ready_for_review`, draft skip, `CONC`), `docs.yml` (paths filter plus `CONC`), `always.yml` (bare `pull_request`, `CONC`, if-free job), and `deploy.yml` (push `branches: [main]`, step `if:`), with `ciSources: []` → `deepEqual(r.findings, [])`, `deepEqual(r.unparsed, [])`, `r.reviewed === 4`.
  - `AC7.1: a malformed on: yields an unparsed entry naming the file, never an empty list` — `on: [push,\n  pull_request]\njobs:\n  a:\n    runs-on: x\n` at `bad.yml` → `r.unparsed.length === 1`, `r.unparsed[0].workflow === '.github/workflows/bad.yml'`, findings `[]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/init/ci-workflow-review.test.js`
Expected: FAIL — the AC3, AC4 and AC5 tests find no `paths-filter-no-always-reporting-job` / `no-cancel-in-progress-concurrency` / `push-all-step-gated` findings, and AC4.4's `unparsed` is `[]`.

- [ ] **Step 3: Implement the three checks in `reviewWorkflows`**
  - Check 3 (`shape.prTrigger` and `prFilters` has `paths` or `paths-ignore`). An always-reporting workflow is a different, reviewed, not-unparsed entry with `prTrigger`, `prFilters` empty, and at least one job with `if === null`. None found → finding. Detail: `` `${filters.join(', ')} on pull_request; no always-reporting workflow` ``, plus `` ` (unparsed, not counted: ${files.join(', ')})` `` when any unparsed PR-candidate file exists, `files` in input order. A **PR-candidate** is a different, not-skipped entry that has an `unparsed` entry and could be the always-reporting workflow: any `unreadable` entry (it has no text, so its trigger is unknown), or a read entry whose shape has `prTrigger` true or whose PR trigger is unread, meaning its reasons include `pull_request trigger not read`, `on: block not read`, `tab indentation in on:` or `anchor or alias in on:`. An unparsed entry whose `on:` was read and names no PR trigger (`no on: block` included) is not a candidate and is not named. This needs every entry's shape first, so `reviewWorkflows` reads all shapes in one pass before emitting findings.
  - Check 4 (`shape.prTrigger`). `'cancel-expression'` adds the unparsed reason `cancel-in-progress expression not evaluated`. `'cancel-true'` → none. Otherwise a finding with detail: `'absent'` and some job has `concurrency` → `job-level concurrency only`; `'absent'` → `no workflow-level concurrency`; `'no-cancel'` → `concurrency has no cancel-in-progress`; `'cancel-false'` → `cancel-in-progress: false`.
  - Check 5: `pushTrigger`, `pushBranches` is `'absent'` or `'all'`, `!pushBranchesIgnore`, not (`pushTags` and `pushBranches === 'absent'`), every job `if === null`, and some job `stepIfCount > 0`. Detail: `` `push on every branch; no job-level if:, ${n} step-level if:` ``.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/init/ci-workflow-review.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — stage the module and the test. Subject: `Add the CI workflow review's paths, concurrency and push checks — always-reporting workflow, cancel-in-progress, step-gated push`.

---

### Task 4: Discovery with realpath containment, and the CLI

**Role:** integration
**Review risk:** high (filesystem containment and exit-code contract)

**Files:**
- Modify: `plugin/bin/lib/init/ci-workflow-review.js` (add `readWorkflowSet`, `readCiSources`)
- Create: `plugin/bin/ci-workflow-review.js`
- Test: `tests/bin-lib/init/ci-workflow-review-cli.test.js` (new)

**Interfaces:**
- Consumes: `reviewWorkflows`, `CHECKS`, `formatRemedy` (Tasks 2-3); `lstatType`, `resolveLeaf`, `canonicalRealpath` from `plugin/bin/lib/path-guard`; `isPathContained` from `plugin/bin/lib/shared-primitives.js`; `readDeclaration` from `plugin/bin/lib/verify/declaration.js`.
- Produces:
  - `readWorkflowSet(root: string, { fsImpl = fs, realpath } = {}) -> { ok: true, workflows } | { ok: false, error: string }`
  - `readCiSources(root: string, { fsImpl = fs, realpath } = {}) -> { ok: true, ciSources: Array<{suite, workflow}> | null } | { ok: false, errors: string[] }`
  - CLI `run(argv: string[], deps = {}) -> number`, `deps = { stdout(s), stderr(s), fsImpl, realpath }`. Exports `{ run, USAGE }`. `USAGE = 'usage: ci-workflow-review.js --root <dir> [--drift] [--json]'`.
  - Command lines Task 6 cites: `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root .` and `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root . --drift --json`.

- [ ] **Step 1: Write the failing test** `tests/bin-lib/init/ci-workflow-review-cli.test.js` — spawn the real binary (`spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000 })`) against `fs.mkdtempSync(path.join(os.tmpdir(), 'cwr-'))` fixtures, like `tests/bin-lib/init/init-verify-scope-cli.test.js`. Also call `run()` in-process for injected-fs cases. `runCli(root, args)` snapshots the root before and after every call and `deepEqual`s the two. The snapshot is a recursive `lstat` walk keyed by `toPosix` relative path: `{type, bytes (file) | link target (symlink)}`. This makes AC9.1 hold for every invocation in the file.

Tests:
- `AC8.1: --drift --json prints exactly one JSON line with exactly reviewed, findings, unparsed` — `stdout.trimEnd().split('\n').length === 1`, `deepEqual(Object.keys(JSON.parse(stdout)), ['reviewed', 'findings', 'unparsed'])`, exit 0.
- `AC8.2: no .github/workflows directory prints reviewed: 0 and no findings` — `deepEqual(JSON.parse(stdout), { reviewed: 0, findings: [], unparsed: [] })`.
- `AC8.3: an invalid verify-scope.json exits 1, error on stderr, stdout empty` — `.claude-tweaks/verify-scope.json` = `{` → `status === 1`, `stdout === ''`, `stderr` matches `/verify-scope\.json/`.
- `AC8.4: a .github/workflows that is a regular file exits 1 the same way` — `status === 1`, `stdout === ''`, `stderr` matches `/\.github\/workflows/`.
- `AC8.5: a single unreadable workflow file is an unparsed entry with exit 0`. Real case: `chmod 0o000` on one of two files, skipped when `process.platform === 'win32'` or `process.getuid?.() === 0`, giving `unparsed[0].reason` matching `/^could not read: EACCES$/` and exit 0. Injected case: `run()` with an `fsImpl` whose `readFileSync` throws `Object.assign(new Error('x'), { code: 'EIO' })` for that path gives reason `could not read: EIO` and returns 0. This is the real-dependency failure shape plus the stub.
- `AC10.1: a missing workflows directory and a missing verify-scope.json are silent` — no dir → `reviewed: 0`. A draft-skip workflow with `ready_for_review` and no declaration → findings `[]` (check 2 skipped).
- `AC10.2: a workflow or verify-scope.json symlinked outside the checkout is refused and never read` (skip on win32). Workflow: `.github/workflows/out.yml` → a file in a second tmp dir holding a draft-skip workflow → `unparsed: [{ workflow: '.github/workflows/out.yml', reason: 'symlink resolves outside the checkout — not read' }]`, and an in-process `run()` with a spying `fsImpl.readFileSync` never receives the outside path. verify-scope.json symlinked outside → exit 1, stdout `''`, stderr matches `/outside the checkout/`.
- `AC10.3: a dangling symlink is unparsed (workflow) or exit 1 (declaration), never absent` (skip on win32) — workflow reason `dangling symlink — not read`. Declaration → exit 1, stderr matches `/dangling symlink/`.
- `AC10.4: one fixture per case` — a meta-assertion over a `CASES` table that names the fixture each of AC10.1-10.3's six outcomes uses, `CASES.length === 6`, and every fixture id is unique. Each case above builds its own root.
- `AC6.1: the CLI prints findings: 0 on a clean set` — text mode, no `--drift` → stdout has a line exactly `findings: 0`, and no line starts with `| \``.
- `AC7.1: the report line never reads clean while any workflow is unparsed` — a malformed `on:` fixture. Text mode: no line matches `/^findings: 0$/`, and one line matches `/^findings: 0 — not clean: 1 workflow\(s\) unparsed$/`. JSON: `unparsed[0].workflow === '.github/workflows/bad.yml'`.
- `AC9.1: every invocation leaves the fixture byte-identical` — run all four flag shapes (`[]`, `['--drift']`, `['--json']`, `['--drift', '--json']`) over one fixture that has findings, an unparsed file, a symlink and a declaration. `runCli`'s snapshot assertion is the check. Control: a fixture changed between the two snapshots must fail the same comparison helper (`assert.throws`).
- `text formats: table without --drift, one line per finding with --drift` — table header `| Workflow | Check | Detail | Remedy |`, a row cell `` `_shared/ci-skips-drafts.md` § Workflow shape ``, the skipped tracking-workflow line `skipped .github/workflows/track-issue-fixes.yml — Step 16 classifies it`. Under `--drift`: `ci-workflow-review: .github/workflows/ci.yml — draft-skip-no-ready-for-review: … (remedy: \`_shared/ci-skips-drafts.md\` § Workflow shape)`.
- `usage: exit 2 for an unknown flag, a missing --root, a trailing bare --root, an empty or flag-shaped --root value, and a --root that is not a directory; --help exits 0` — each asserts `status` and `/usage:/`. `--help` prints USAGE on stdout.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/init/ci-workflow-review-cli.test.js`
Expected: FAIL — `plugin/bin/ci-workflow-review.js` does not exist (spawn exits 1 with `Cannot find module`), and `readWorkflowSet` is not exported.

- [ ] **Step 3: Implement discovery and the CLI**

Discovery, in the module:
- `rootReal = canonicalRealpath(root)`. A null `rootReal` is the error `could not resolve --root`.
- `readWorkflowSet`: dir = `path.join(root, '.github', 'workflows')`, `leaf = resolveLeaf(dir)`.
  - `missing` → `{ ok: true, workflows: [] }`.
  - `dangling`/`unreadable` → error `.github/workflows: {dangling symlink|unreadable: code} — not read`.
  - Resolved but not `isPathContained(leaf.path, rootReal, { orEqual: true })` → `.github/workflows resolves outside the checkout — not read`.
  - `lstatType(leaf.path).type !== 'directory'` → `.github/workflows is not a directory`.
  - A throw from `readdirSync` → `.github/workflows could not be listed: {code}`.
  - Names: `/\.ya?ml$/i`, sorted. Per file `p`, `resolveLeaf(p)`: `dangling` → `dangling symlink — not read`; `unreadable` → `unreadable: {code}`; `missing` → `vanished during the review`; outside → `symlink resolves outside the checkout — not read`; not a `file` → `not a regular file`; `readFileSync(leaf.path, 'utf8')` throwing → `could not read: {code}`; else `{workflow, text}`.
  - Containment runs for every file, a plain file included, because a parent directory can be the symlink.
- `readCiSources`: path `root/.claude-tweaks/verify-scope.json`, `resolveLeaf`.
  - `missing` → `{ ok: true, ciSources: null }`.
  - `dangling` → error `verify-scope.json: dangling symlink — not read`.
  - Outside → `verify-scope.json: resolves outside the checkout — not read`.
  - `unreadable` → `verify-scope.json: unreadable: {code}`.
  - Otherwise `readDeclaration(leaf.path, fsImpl)`: `ok: false` → its `errors`; `missing` → `null`; `decl.ci` null → `[]`; else `Object.entries(decl.ci).map(([suite, s]) => ({ suite, workflow: s.workflow }))`.
- No `existsSync`/`realpathSync` token anywhere. `realpath` is passed through to path-guard only when given.

CLI `plugin/bin/ci-workflow-review.js`:
- Header: #5162. It shells out to nothing and reads only `.github/workflows/*.y{a,}ml` and `.claude-tweaks/verify-scope.json` under `--root`. It never writes. Exit vocabulary is *Payload-1/Invocation-2* (0 report, findings or not; 1 invalid `verify-scope.json` or unreadable `.github/workflows`, reason on stderr, stdout empty; 2 usage), the same 0/1/2 split `init-verify-scope.js --drift` uses.
- `parseArgs`, value-validated: `--root` must be followed by a value that is a string, not empty after trim, and not starting with `-`.
- The root must pass `lstatType(path.resolve(root)).type === 'directory'`, else 2. A symlinked root is resolved first through `resolveLeaf`.
- Every deps call sits inside try/catch, and an unexpected throw is exit 1 with the message on stderr.
- Read the declaration first, then the workflow set. Any `ok: false` → each error on stderr as `ci-workflow-review.js: {error}`, stdout empty, return 1.
- `--json` (with or without `--drift`): the one JSON line `{reviewed, findings, unparsed}`.
- Text without `--drift`: header line `ci-workflow-review: reviewed {n} workflow(s) under .github/workflows (report-only, nothing written)`, then the markdown table when there are rows (findings, then unparsed rows with check `` `unparsed` `` and remedy `—`; `|` in a cell escaped as `\|`), then the skipped lines, then the summary.
- Text with `--drift`: the per-finding line `ci-workflow-review: {workflow} — {check}: {detail} (remedy: {formatRemedy(remedy)})`, the per-unparsed line `ci-workflow-review: {workflow} unparsed — {reason}`, then the summary.
- Summary: `findings: {n}` when no `unparsed`; else `findings: {n} — not clean: {m} workflow(s) unparsed`.
- `if (require.main === module) process.exitCode = run(process.argv.slice(2));`

- [ ] **Step 4: Run tests to verify they pass, then the real-input probe**

Run: `node --test tests/bin-lib/init/ci-workflow-review-cli.test.js tests/bin-lib/init/ci-workflow-review.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.

Real-input probe (Real-input probe and Independent-count checks), against this repo's own eight workflows:
Run: `node "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5160-5161-5162/plugin/bin/ci-workflow-review.js" --root "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5160-5161-5162" --drift --json`
Expected, predicted from reading the files: `{"reviewed":7,"findings":[],"unparsed":[{"workflow":".github/workflows/test-impact-map.yml","reason":"cancel-in-progress expression not evaluated"}]}`, exit 0.

Independent count: `ls .github/workflows` lists 8 files. `track-issue-fixes.yml` classifies `current` (probed at plan time with `classifyExistingWorkflow`: printed `current`), so 8 − 1 = 7 reviewed. `test.yml` (bare `pull_request`, block `cancel-in-progress: true`, job `shard` with no `if:`) is the always-reporting workflow for `test-impact-map.yml`'s `paths:` filter. `release-please.yml`, `test-impact-map.yml` and `windows-regression.yml` push only to named branches. `eval-benchmark.yml`, `mirror-marketplace.yml` and `test-perf.yml` have no PR or push trigger. Any difference from the predicted line is a defect in the reader or the checks to explain and fix before commit. Never adjust the prediction to match. Paste the printed line into the task report. Also run the text form without `--drift` and paste its last line (expected `findings: 0 — not clean: 1 workflow(s) unparsed`).

- [ ] **Step 5: Commit** — stage `plugin/bin/lib/init/ci-workflow-review.js`, `plugin/bin/ci-workflow-review.js`, `tests/bin-lib/init/ci-workflow-review-cli.test.js`. Subject: `Add ci-workflow-review.js — realpath-contained workflow discovery, table/drift/JSON report, 0/1/2 exits`.

---

### Task 5: `## Concurrency` remedy section in `_shared/ci-skips-drafts.md`

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/ci-skips-drafts.md`
- Test: `tests/ci-skips-drafts-conformance.test.js` (append a section entry)

**Interfaces:**
- Produces: the heading `## Concurrency`, which `CHECKS['no-cancel-in-progress-concurrency']` names (Task 2). Task 6 pins every non-pointer `CHECKS` value to a heading in this file.

- [ ] **Step 1: Write the failing test** — in `tests/ci-skips-drafts-conformance.test.js`, add to `SECTIONS`, between the Coexistence entry and `## Why projects skip drafts`:

```js
  ['## Concurrency', [
    [/cancel-in-progress: true\n```/, 'concurrency: the workflow-level block with cancel-in-progress true'],
    [/cancels the superseded run/, 'concurrency: what it buys'],
    [/Job-level `concurrency` alone, a scalar `concurrency: \{group\}` and `cancel-in-progress: false` all let superseded runs finish/, 'concurrency: the three shapes that do not cancel'],
    [/A `cancel-in-progress` expression is read as unparsed/, 'concurrency: an expression is unparsed'],
  ]],
```

and to the Coexistence entry's facts: `[/step-22-ci-workflow-review\.md/, 'coexistence: names the init step that detects the conflict']` (the existing `/#5162/` fact stays). Expected: FAIL after Step 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ci-skips-drafts-conformance.test.js`
Expected: FAIL after Step 1 — `sectionOf` throws for the missing `## Concurrency` heading, and the Coexistence section lacks `step-22-ci-workflow-review.md`.

- [ ] **Step 3: Edit `plugin/skills/_shared/ci-skips-drafts.md`.** Insert this section between `## Coexistence with the \`ci\` verification source` and `## Why projects skip drafts`. It goes before that section, so "below" is the right direction.

````markdown
## Concurrency

Every phase exit pushes, so a PR's earlier CI runs are superseded within minutes (the measured share is in Why projects skip drafts below). A workflow-level `concurrency` block whose `cancel-in-progress` is `true` cancels the superseded run when the next push starts one:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

The merge gate reads only runs on the head it merges (`_shared/pr-first-merge.md` Step 2.5), so a run cancelled on a superseded head costs it nothing. Job-level `concurrency` alone, a scalar `concurrency: {group}` and `cancel-in-progress: false` all let superseded runs finish. A `cancel-in-progress` expression is read as unparsed by init's CI-workflow review, which cannot evaluate it.
````

Replace the Coexistence sentence `Detecting the conflict is #5162's, at init's CI-workflow review.` with ``Init's CI-workflow review (`init/bootstrap/step-22-ci-workflow-review.md`, #5162) reports it as `draft-skip-with-ci-source`.``

Behavioral-claim check: "reads only runs on the head it merges" is produced by Step 2.5's head-run `gh run list` read. Confirm with `git -C "<worktree>" grep -n -F "head" -- plugin/skills/_shared/pr-first-merge.md`. If Step 2.5 does not filter by head sha, cut that sentence rather than assert it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ci-skips-drafts-conformance.test.js tests/pr-first-merge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — stage `plugin/skills/_shared/ci-skips-drafts.md`, `tests/ci-skips-drafts-conformance.test.js`. Subject: `Add a Concurrency remedy section to ci-skips-drafts.md — cancel-in-progress, and the init step that detects the ci-source conflict`.

---

### Task 6: Step 22 sub-file, SKILL.md paragraph, index row and the Update Mode row

**Role:** integration
**Review risk:** high (the Step 22 re-run gate, which decides from the computed Phase 1 routing and the scope/token/gate stops whether to run, hold or skip; the Update Mode row's branching on exit code and output shape; and the drift-count exclusion in Phase 1u.6)

**Files:**
- Create: `plugin/skills/init/bootstrap/step-22-ci-workflow-review.md`
- Modify: `plugin/skills/init/SKILL.md` (insert `### Step 22: CI Workflow Review (Optional)` after the Step 21 paragraph, before the `---` above `### Finalizing the worktree-always Decision`; add `ci-review` to the `argument-hint` on line 4 and to the Enhancement filter token line, line 47)
- Modify: `plugin/skills/init/bootstrap-steps.md` (index row after the `| 21 |` row)
- Modify: `plugin/skills/init/update-mode.md` (new `### CI Workflow Review` subsection directly after `### Verify-Scope Drift`'s table, before `### Routine Relevance`; Phase 1u.6's Quick Audit block, lines 570-589)
- Modify: `plugin/skills/init/input-grammar.md` (a `ci-review` row after the `release` row of the token table, line 26)
- Modify: `plugin/skills/init/scope-selection-gate.md` (one sentence each on Option 2's per-phase "Done", line 28, and Option 4, line 32)
- Modify: `plugin/skills/help/reference-card.md` (the `/claude-tweaks:init` Takes cell, line 9)
- Test: `tests/init-ci-workflow-review-conformance.test.js` (new)

**Interfaces:**
- Consumes: `CHECKS` and `formatRemedy` (Task 2); the two command lines (Task 4); `## Concurrency` (Task 5); `extractArgumentHint` from `plugin/bin/lib/skill-audit/argument-hint` (existing, unchanged).
- Produces: the Enhancement filter token `ci-review` → Step 22; Step 22's re-run gate (run now, hold for the Scope Selection Gate, or skip to Phase 1u.5); the CI Workflow Review row, which does not count toward Phase 1u.6's Total drift count.

- [ ] **Step 1: Write the failing test** `tests/init-ci-workflow-review-conformance.test.js`. All reads go through `readText`. Facts are checked with `missingFactsOf`, and their go-red proofs with `assertEachPatternGoesRed` (`tests/helpers/conformance-asserts.js`). Write a local `subsectionOf(text, '### Heading')` that ends at the next `\n### ` or `\n## ` and throws when the heading is missing.
  - `AC11.1: update-mode.md's CI Workflow Review row calls the CLI with --drift --json, is report-only, and surfaces exit 1 as its own finding` — over `subsectionOf(UPDATE, '### CI Workflow Review')`, facts: `/ci-workflow-review\.js" --root \. --drift --json/`, `/\{reviewed, findings, unparsed\}/`, `/Report-only/`, `/exit 1 →/`, `/as its own finding, never as "no drift"/`, `/output unreadable/`, `/never "no drift" while `unparsed` is non-empty/`.
  - `AC11.1: init/SKILL.md carries a Step 22 paragraph after Step 21 and before the finalization section, pointing at its sub-file` — `indexOf` ordering of `### Step 21: Release Bootstrap` < `### Step 22: CI Workflow Review` < `### Finalizing the worktree-always Decision`. The body includes `bootstrap/step-22-ci-workflow-review.md` and `report-only`, and has ≤ 4 non-blank lines. Permutation control: splice the Step 22 block above Step 21 and `assert.throws` the ordering helper with its own ordering message. A deletion control throws with the `marker missing` message.
  - `AC11.2: removing the Update Mode row or the SKILL.md paragraph turns these checks red` — `assertEachPatternGoesRed` over the row facts. The SKILL.md control drops the whole `### Step 22` block (blank-line paragraph split, exact removed count 2: heading plus body) and asserts the paragraph helper throws its own message.
  - `step-22 file: preamble, command, never-writes, citations, and re-run gate` — starts `# Step 22 — `. Includes `*Optional Enhancement step — see \`../SKILL.md\``, `ci-workflow-review.js" --root .`, `never writes, edits or regenerates`, `_shared/ci-skips-drafts.md`, `update-mode.md`'s `CI Workflow Review`, and `ci-workflow-review: reported by Update Mode`.
  - `step-22 re-run gate: skips only when this run will reach Phase 1u.5` (skip direction, spec Clarification 2) — slice the paragraph that starts `**Re-run gate.**` up to the next blank line (throws when missing). Facts: `/skips itself only when this invocation will reach Update Mode's Phase 1u\.5/`, `/`\$ARGUMENTS` carries `--update` or `update`, or Phase 1's existence check/`, `/`\$ARGUMENTS` carries a Phase scope and no `bootstrap`/`, `/print `ci-workflow-review: reported by Update Mode's CI Workflow Review \(update-mode\.md\)` and stop/`. `assertEachPatternGoesRed` over the four.
  - `step-22 re-run gate: runs whenever the run stops before Phase 1u.5` (run direction) — same slice. Facts: `/In every other case it runs now: Initial Mode, the `bootstrap` scope, or Enhancement filter tokens with no Phase scope/`, `/no Phase scope and no Enhancement filter token, the Scope Selection Gate decides, so hold the review/`, `/the gate's Option 4 \("Done"\), or an Interactive "Done" chosen before Phase 1 runs, runs it before that exit/`. Over `scope-selection-gate.md`: the sentence `If Step 22 held its CI workflow review` occurs exactly twice, once after `**Option 2 (Interactive):**` and before `**Option 3`, and once after `**Option 4 (Done):**` (`indexOf` ordering). `assertEachPatternGoesRed` over the three step-file facts; control: a gate copy with the Option 4 sentence deleted fails the count with its own message.
  - `drift count: the CI Workflow Review row does not count toward Phase 1u.6's Total drift count, and the Quick Audit never prints "No drift detected" while it surfaced a line` (spec Clarification 1) — over `subsectionOf(UPDATE, '### CI Workflow Review')`, facts `/does not count toward Phase 1u\.6's Total drift count/` and `/listed in Phase 1u\.6's Quick Audit block instead, never dropped/`. Over a local `sectionOf(UPDATE, '## Phase 1u.6')` (ends at the next `\n## `), facts `/if the CI Workflow Review row surfaced any line/`, `/CI workflow review — report-only, not counted as drift:/` and `/Never print "No drift detected\." while the CI Workflow Review row surfaced any line/`. `assertEachPatternGoesRed` over all five. Control on the unchanged path: the same section still contains `Config is current. No drift detected.` (the line used when the row surfaced nothing).
  - `ci-review: the Enhancement filter token is listed in SKILL.md's token line, input-grammar.md, the argument-hint and the reference card` (spec Clarification 3) — `assert.match(SKILL, /Enhancement filter tokens\*\* — one per Optional Enhancement step:[^\n]*`ci-review`/)`; `assert.match(GRAMMAR, /^\| `ci-review` \| Step 22 — /m)`; `extractArgumentHint(SKILL).replace(/^\[|\]$/g, '').split('|')` includes `'ci-review'`; the `reference-card.md` line starting `` | `/claude-tweaks:init` | `` includes `\|ci-review]`. Control: a SKILL copy with `` , `ci-review` `` removed from line 47 fails the first match.
  - `step-22's check table matches CHECKS row for row` (prose-code twin) — parse the `| Check | Remedy |` table rows into `[check, remedy]`. The check cell is one code span; unwrap its backticks. The remedy cell is either `see #5152`, kept as is, or starts with the prefix `` `_shared/ci-skips-drafts.md` § ``: strip that prefix and keep the rest exactly, inner backticks included (so the Coexistence row reads `` Coexistence with the `ci` verification source ``). Any other remedy cell throws. Then `deepEqual` with `Object.entries(CHECKS)`. Controls: a copy with one row deleted fails the same helper, and a copy whose Coexistence cell loses its inner backticks fails too.
  - `every CHECKS remedy except the #5152 pointer is a ## heading in _shared/ci-skips-drafts.md` — `assert.ok(new RegExp(`^## ${escape(r)}$`, 'm').test(DOC))` per value. Control: a doc copy with `## Concurrency` renamed fails.
  - `bootstrap-steps.md lists step 22` — `/^\| 22 \| `step-22-ci-workflow-review\.md` \|/m`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/init-ci-workflow-review-conformance.test.js`
Expected: FAIL — `step-22-ci-workflow-review.md` does not exist (readText throws ENOENT) and `### CI Workflow Review` is missing from `update-mode.md`.

- [ ] **Step 3: Write the prose**

`plugin/skills/init/bootstrap/step-22-ci-workflow-review.md`, about 3.2 KB:
- Title `# Step 22 — CI Workflow Review (detailed procedure)`. Preamble, as step-21: `*Optional Enhancement step — see \`../SKILL.md\`'s \`## Input\` for when this group is offered or filtered, and \`../bootstrap-steps.md\` for its ordering and renumbering conventions.*`
- Purpose: one sentence on what the merge gate assumes about PR CI, citing `_shared/ci-skips-drafts.md`.
- **Re-run gate** (G1, spec Clarification 2), this exact paragraph:

```markdown
**Re-run gate.** This step skips itself only when this invocation will reach Update Mode's Phase 1u.5, where `../update-mode.md`'s `CI Workflow Review` row reports the same review. That holds when both are true: Phase 1 routes to Update Mode (`$ARGUMENTS` carries `--update` or `update`, or Phase 1's existence check in `../SKILL.md` finds existing config), and `$ARGUMENTS` carries a Phase scope and no `bootstrap` (Phase scopes choose among Phases 2-8.5 and leave Phase 1 in place). Then print `ci-workflow-review: reported by Update Mode's CI Workflow Review (update-mode.md)` and stop. When Phase 1 routes to Update Mode and `$ARGUMENTS` carries no Phase scope and no Enhancement filter token, the Scope Selection Gate decides, so hold the review and print nothing yet: the gate's Option 4 ("Done"), or an Interactive "Done" chosen before Phase 1 runs, runs it before that exit (`../scope-selection-gate.md`), and Auto, Essentials or Interactive continuing into Phase 1 leave it to Phase 1u.5. In every other case it runs now: Initial Mode, the `bootstrap` scope, or Enhancement filter tokens with no Phase scope.
```

  Every branch is computable at Step 22 from `$ARGUMENTS` and the Phase 1 existence check, except the gate's answer, which is why that one case holds instead of guessing. `ci-review` given alone is a filter-token-only invocation, so it runs now.
- **Run** one plain command: `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root .`. It shells out to nothing and reads only `.github/workflows/*.yml`/`*.yaml` and `.claude-tweaks/verify-scope.json`.
- **Read the result.** Exit 0 means show the printed table and its summary line verbatim. `findings: 0` alone is clean, and a `not clean: {m} workflow(s) unparsed` summary is never reported as clean. Exit 1: show `ci-workflow-review: could not review — {stderr}`. Exit 2 is a usage bug: report it.
- **The checks** table, `| Check | Remedy |`, five rows in `CHECKS` order. Each remedy cell is `` `_shared/ci-skips-drafts.md` § {section} `` or `see #5152`. Never restate the remedy text (spec Gotcha).
- **What this step never does:** "never writes, edits or regenerates a workflow or any other file, in any mode, `auto` included". It never reviews the plugin's generated `track-issue-fixes.yml`, current or an earlier generated version (Step 16 classifies it); a hand-modified copy is reviewed like any project workflow. It never reads CI systems other than GitHub Actions.

`plugin/skills/init/SKILL.md`, inserted after the Step 21 paragraph:

```markdown
### Step 22: CI Workflow Review (Optional)

A report-only review of the project's existing PR-triggered workflows — draft skips without `ready_for_review` or beside a declared `ci` source, `paths:` filters with no always-reporting workflow, missing `cancel-in-progress: true` concurrency, push triggers gated only at step level, and unparseable files — through `bin/ci-workflow-review.js`; never writes. Skips itself when this run will reach Update Mode's Phase 1u.5, whose CI Workflow Review row reports instead. Read `bootstrap/step-22-ci-workflow-review.md` for the full procedure.
```

`plugin/skills/init/SKILL.md` line 47: append `` , `ci-review` `` after `` `release` `` in the Enhancement filter token list. Line 4: append `|ci-review` after `integration-model`, inside the closing `]`.

`plugin/skills/help/reference-card.md` line 9, the `/claude-tweaks:init` Takes cell: append `\|ci-review` after `integration-model`, inside the closing `]`, so the cell stays byte-equal to the new `argument-hint` (`tests/argument-hint-mirrors.test.js`). Both already lack `release` (plan review row 3's evidence). That gap is pre-existing: name it as a follow-up in the task report for the controller to file, and do not fold it in.

`plugin/skills/init/input-grammar.md`, a row after the `release` row:
`` | `ci-review` | Step 22 — CI workflow review (`bootstrap/step-22-ci-workflow-review.md`), report-only. The step's own re-run gate still applies — when this run will reach Update Mode's Phase 1u.5, the step skips itself and that phase's CI Workflow Review row reports instead, same as in the unfiltered flow | ``

`plugin/skills/init/scope-selection-gate.md`: append to the Option 2 paragraph's "Done" sentence (line 28) `` If Step 22 held its CI workflow review (`bootstrap/step-22-ci-workflow-review.md`'s re-run gate) and Phase 1 has not run yet, run it now too, before this exit. `` Append to the Option 4 paragraph (line 32) `` If Step 22 held its CI workflow review (`bootstrap/step-22-ci-workflow-review.md`'s re-run gate), run it now too, before this exit. ``

`plugin/skills/init/bootstrap-steps.md`, a row after `| 21 |`:
`` | 22 | `step-22-ci-workflow-review.md` | Report-only review of existing PR-triggered workflows (`bin/ci-workflow-review.js`); skips itself when the run will reach Update Mode's CI Workflow Review row, which reports it instead. | ``

`plugin/skills/init/update-mode.md`, after `### Verify-Scope Drift`'s table:

```markdown
### CI Workflow Review

| Signal | Detection | Surfacing |
|---|---|---|
| An existing PR-triggered workflow skips drafts without `ready_for_review` or beside a declared `ci` source, filters by `paths:` with no always-reporting workflow, lacks workflow-level `cancel-in-progress: true`, gates a push-all trigger only at step level, or cannot be parsed | `node "${CLAUDE_PLUGIN_ROOT}/bin/ci-workflow-review.js" --root . --drift --json` — one JSON line `{reviewed, findings, unparsed}`; `reviewed: 0` → no workflows, nothing to report; exit 1 → `verify-scope.json` is invalid or `.github/workflows` cannot be read as a directory (the reason is on stderr, stdout is empty) — surface `ci-workflow-review: could not review — {stderr}` as its own finding, never as "no drift"; stdout that is not that one JSON line → `ci-workflow-review: output unreadable — {first line}`, its own finding too | Report-only: one line per finding, "ci-workflow-review: `{workflow}` — `{check}`: {detail} (remedy: `_shared/ci-skips-drafts.md` § {remedy}, or `see #5152`)", and one per `unparsed` entry, "ci-workflow-review: `{workflow}` unparsed — {reason}"; never "no drift" while `unparsed` is non-empty — never rewritten, no workflow is ever edited |

This row does not count toward Phase 1u.6's Total drift count: a finding or `unparsed` entry can last across re-runs (a deliberate `cancel-in-progress` expression stays unparsed), and counting it would force the full pass on every re-run. Its lines are listed in Phase 1u.6's Quick Audit block instead, never dropped.
```

`plugin/skills/init/update-mode.md`, Phase 1u.6 (spec Clarification 1). Inside the Quick Audit code block, directly after the line `Config is current. No drift detected. {N} preliminary gap signals (below threshold).`, add the indented line:

```
   {if the CI Workflow Review row surfaced any line — a finding, an `unparsed` entry, or its could-not-review or output-unreadable line: replace the line above with "Config is current. {N} preliminary gap signals (below threshold). CI workflow review — report-only, not counted as drift:" and list each of its lines verbatim}
```

After the block's `Only include lines for checks that ran; omit any the inventory pass did not compute.`, append the sentence `Never print "No drift detected." while the CI Workflow Review row surfaced any line.` The Total drift count table (line 557) is not edited: the row's own sentence above excludes it, the same way Routine Relevance (line 448) states its own exclusion.

Renumbering-completeness check: run these three greps and fix any hit that enumerates the bootstrap steps:
- `git -C "<worktree>" grep -n -E "Step 21\b" -- plugin/skills/init docs` (the number form; expected hits are Step 21's own references, unchanged)
- `git -C "<worktree>" grep -n -i -E "steps? (9|1)[-–]2[12]|through step 2[12]" -- plugin docs` (the range form; at plan time it matched nothing)
- `git -C "<worktree>" grep -n -i -E "twenty-(one|two)|2[12] (bootstrap )?steps" -- plugin docs` (the cardinal form; at plan time only unrelated `twenty-one themes` hits in `design-wrapper/third-party-design-skill-comparisons.md`)

Prose-held pins: `tests/init-release-bootstrap-conformance.test.js` slices SKILL.md from `### Step 21` to `### Finalizing` and checks that the Step 21 stub is ≤ 4 lines. The Step 22 block must start with its own heading so that slice's line count does not include it. The same suite matches line 47 with `[^\n]*`release``, which still matches once `` , `ci-review` `` follows `release`. `tests/argument-hint-mirrors.test.js` compares init's `argument-hint` with the reference-card Takes cell byte for byte, and `tests/argument-hint-input.test.js` checks that every hint leaf is documented in `## Input` (line 47 covers `ci-review`). No test pins the token list's length or order. Run all three suites in Step 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init-ci-workflow-review-conformance.test.js tests/init-release-bootstrap-conformance.test.js tests/init-port-isolation-conformance.test.js tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. Then `wc -c` on `plugin/skills/init/SKILL.md`, `plugin/skills/init/update-mode.md`, `plugin/skills/init/input-grammar.md`, `plugin/skills/init/scope-selection-gate.md`, `plugin/skills/init/bootstrap-steps.md` and `plugin/skills/help/reference-card.md`: each must be under 52,500. Quote all six numbers against the Global Constraints estimates (about 41,230, 42,520, 6,440, 4,820, 5,260 and 21,109).

- [ ] **Step 5: Commit** — stage the seven prose files (`plugin/skills/init/bootstrap/step-22-ci-workflow-review.md`, `plugin/skills/init/SKILL.md`, `plugin/skills/init/bootstrap-steps.md`, `plugin/skills/init/update-mode.md`, `plugin/skills/init/input-grammar.md`, `plugin/skills/init/scope-selection-gate.md`, `plugin/skills/help/reference-card.md`) and the test. Subject: `Add init Step 22 and the Update Mode CI Workflow Review row — report-only, one CLI, ci-review token, remedy table pinned to CHECKS`.

---

### Task 7: Docs — plugin-structure and skill-graph

**Role:** integration

**Files:**
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/init/` line 60, the `plugin/bin/lib/merge-verification.js` line 86, a new command line after the `init-verify-scope.js` one at line 181)
- Modify: `docs/skill-graph.md` (a row in `## init`)
- Test: `tests/init-ci-workflow-review-conformance.test.js` (append)

- [ ] **Step 1: Write the failing test** — append to `tests/init-ci-workflow-review-conformance.test.js`:
  - `docs/skill-graph.md's init section carries the ci-skips-drafts edge` — `sectionOf(graph, '## init')` has a line starting `` | `_shared/ci-skips-drafts.md` | `` that includes `Step 22`. Control: the section with that row removed fails.
  - `docs/plugin-structure.md lists the CLI, the module and the reader` — includes `node plugin/bin/ci-workflow-review.js --root <dir> [--drift] [--json]`, the `plugin/bin/lib/init/` line includes `ci-workflow-review.js (#5162`, and the merge-verification line includes `readWorkflowShape(text)`. Expected: FAIL after Step 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/init-ci-workflow-review-conformance.test.js`
Expected: FAIL after Step 1 — no `## init` ci-skips-drafts row; no `ci-workflow-review.js` command line.

- [ ] **Step 3: Edit the docs**
  - `docs/skill-graph.md`, under `## init`, after the `_shared/integration-model.md` row: `` | `_shared/ci-skips-drafts.md` | Step 22 (`bootstrap/step-22-ci-workflow-review.md`) and Update Mode's CI Workflow Review row run `bin/ci-workflow-review.js`, whose findings cite this file's sections as remedies — `Workflow shape`, `Coexistence with the \`ci\` verification source`, `Path filters`, `Concurrency` — and `see #5152` for a step-gated push (#5162). | ``
  - `docs/plugin-structure.md` line 60, append: `ci-workflow-review.js (#5162) — init Step 22's and Update Mode's report-only review of existing PR-triggered workflows: reviewWorkflows over readWorkflowShape results (five checks; CHECKS maps each to its _shared/ci-skips-drafts.md section), classifyDraftCondition (a job if:'s draft-skip polarity, unparsed on || or a function call), and readWorkflowSet / readCiSources, which refuse any file whose realpath leaves the checkout through path-guard; consumed by plugin/bin/ci-workflow-review.js`
  - Line 86: change `Two line-based GitHub Actions workflow readers (no YAML library) that fail in opposite directions.` to `Three line-based GitHub Actions workflow readers (no YAML library); the first fails toward off, the other two toward unparsed.` Append `(3) init's CI-workflow review reader (#5162): readWorkflowShape(text) → {name, prTrigger, types, typesDeclared, draftReference, prFilters, pushTrigger, pushBranches, pushBranchesIgnore, pushTags, jobs[{id, if, stepIfCount, concurrency}], concurrency, unparsed[reason]} — readPullRequestWorkflow's four fields copied unchanged, plus trigger filter keys, the jobs: structure and workflow-level concurrency; consumed by plugin/bin/lib/init/ci-workflow-review.js. Tests in tests/merge-verification-workflow-shape.test.js.` before `Tests in tests/merge-verification.test.js`.
  - After the `init-verify-scope.js` command line: `node plugin/bin/ci-workflow-review.js --root <dir> [--drift] [--json]   # Init's CI-workflow review (#5162) — report-only, shells out to nothing, never writes; reads .github/workflows/*.y{a,}ml and .claude-tweaks/verify-scope.json under --root, refusing a file whose realpath leaves the checkout (an unparsed entry; exit 1 for verify-scope.json); a markdown table by default, one line per finding under --drift, one JSON line {reviewed, findings, unparsed} under --json; the summary line reads findings: N, or "findings: N — not clean: M workflow(s) unparsed"; exit 0 report, 1 invalid verify-scope.json or unreadable .github/workflows (stderr, empty stdout), 2 usage`
  - Behavior-change prose sweep: `git -C "<worktree>" grep -n -i -e "two line-based" -e "workflow readers" -- plugin docs .claude/skills`. Classify each hit in the task report as changed or no-change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/init-ci-workflow-review-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/ci-skips-drafts-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — stage `docs/plugin-structure.md`, `docs/skill-graph.md`, `tests/init-ci-workflow-review-conformance.test.js`. Subject: `Document the CI workflow review — plugin-structure CLI and module entries, the init skill-graph edge`.

---

## Plan-authoring checks run

**Return-shape widening:** no existing function's return shape grows. `readWorkflowShape` is new, and the export list only gains three names. The consumer grep is recorded in Build-time facts.

**Blocking-verification-downgrade:** no live external contract. The real-input probe (Task 4 Step 4) runs the finished CLI against this repo's eight real workflows. It is not downgraded.

**Deictic-reference re-resolution:** Task 5 inserts `## Concurrency` before `## Why projects skip drafts`, and its text says "below". That direction is correct. Nothing else is reordered.

**Ordering-fix location:** no ordering fix. Step 22's re-run gate reads Phase 1's existence check, which `SKILL.md` Phase 1 states (`CLAUDE.md`, `.claude/skills/`, `.claude/rules/`, `.claude/settings.json`), plus the `--update`/`update` override and the `## Input` scope and token rules. Step 22 cites them instead of restating them (G1). The one input not known at Step 22, the Scope Selection Gate's answer, is handled by holding the review and running it at the gate's two early exits, which sit after Step 22 in execution order.

**Verbatim-command run-once:** `classifyExistingWorkflow` was run at authoring time on this repo's `track-issue-fixes.yml` and printed `current`. The two `ci-workflow-review.js` command lines cannot run before Task 4 creates the CLI. They are unverified until Task 4 Step 4's probe runs them.

**Degrade-clause convention:** no transport-unavailability clause is added. The CLI shells out to nothing.

**Copied-config re-derivation:** nothing is copied as a starting point.

**Renumbering-completeness:** Step 22 is added to the init step enumeration. Task 6 Step 3 writes the number, range and cardinal greps. At plan time the range and cardinal forms matched nothing relevant.

**Behavioral-claim:** Task 5's "the merge gate reads only runs on the head it merges" is checked against `_shared/pr-first-merge.md` Step 2.5, and cut if Step 2.5 does not filter by head. Step 22's "never writes" is produced by the CLI having no write call. AC9.1's snapshot test pins it.

**Already-satisfied ruling:** none ruled already satisfied.

**Byte-pin:** `RAIL_BYTES` 52,500. Headroom is recorded in Global Constraints (SKILL.md about 11.3 KB, update-mode.md about 10.0 KB after the task; the four smaller Task 6 prose files stay far below), and Task 6 Step 4 re-measures all six.

**Consumer-timing:** no pre-gathered values.

**Step-position:** Step 22 runs in Phase 0 from the project root, cwd `.`, before Phase 1. A held review runs at the Scope Selection Gate's Option 4 or an Interactive "Done" before Phase 1, still from the project root and still before Phase 1. The drift row runs in Phase 1u.5. All run on the project's checkout with no run dir involved.

**Gate-over-producers:** the drift row consumes the CLI's stdout, and its only producer is `run()`. Every output shape is tested in Task 4: JSON, exit 1 with empty stdout, and exit 2. The row also handles an unparseable stdout.

**Sole-site and producer-side:** no sole-site claim. The drift row's producer, the CLI, is built in Task 4, before the row in Task 6.

**Real-input probe:** Task 4 Step 4 names `.github/workflows/` of this worktree (8 files) and pins the exact expected line.

**Independent-count:** `ls .github/workflows` gives 8 files. Minus one generated `track-issue-fixes.yml` (classifier printed `current`), that is 7 reviewed. The derivation of the one unparsed entry is reasoned per file in Task 4 Step 4.

**Consumer-portability:** no repo-specific literal in shipped code. `track-issue-fixes.yml` is the plugin's own generator filename, not this repo's config, and `main` appears only in test fixtures.

**Source-scan lint:** the sanctioned forms are written into Tasks 1-4: path-guard `lstatType`/`resolveLeaf`/`canonicalRealpath`, `isPathContained`, no `existsSync`/`realpathSync` token, the `process.exitCode` guard, and no spawn. Task 4 Step 4 runs the three scans.

**Real-writer fixture:** check 2 reads `verify-scope.json` only through the real `readDeclaration` (Task 4 CLI tests write real JSON files). `track-issue-fixes.yml` fixtures come from the real `generateWorkflowYaml()` (Task 2).

**Moved-prose pin / Prose-held pin:** no prose is moved. New prose lands in `SKILL.md` beside Step 21's slice. Task 6 runs `tests/init-release-bootstrap-conformance.test.js`. `ci-skips-drafts.md`'s Coexistence sentence is pinned by `/#5162/`, which the rewording keeps.

**Derived-value / Empty-value probe:** the only runtime-resolved substitution is `--root .`. Task 4's usage tests cover an empty or flag-shaped `--root` value and a trailing bare `--root` (exit 2).

**New-skill suite-set:** no new skill.

**Reachability:** check 3's always-reporting search and check 5's push-all predicate each have an input that crosses the gate: AC3.2 clears it, AC3.3 does not, and AC5.2's `tags` plus `branches: ['**']` still fires. Every assertion is on findings, never on the presence of code.

**Guard-branch discrimination:** each unparsed reason has its own fixture asserting `deepEqual(unparsed, [reason])` (Task 1). Each AC5.2 variant removes exactly one push-all condition. Deleting the `pushTags` guard turns the `tags:` only case red. Deleting the containment check turns AC10.2 red, because its spied `readFileSync` would see the outside path.

**Inserted-guard re-proof:** no guard is inserted ahead of an existing check.

**Mirror-surface enumeration:** the Step 22 filter token `ci-review` is added (G5, spec Clarification 3). `docs/skill-authoring.md`'s Argument-hint mirror surfaces table lists `frontmatter`, `input-parse-line`, `usage-line`, `syntax-block` and `reference-card-takes`. Init carries only `frontmatter` and `reference-card-takes` (it has no `$ARGUMENTS` restatement line, no usage line and no `## Syntax` section), and Task 6 edits both. The token's other listings are SKILL.md line 47 and `input-grammar.md`'s table, both edited in Task 6 and pinned by its `ci-review: …` test.

**Inline self-consistency:** no task inlines both a complete test and a complete implementation. Bodies are the implementer's. Task 2's predicate regexes are inline, and Task 2's `classifyDraftCondition` test cases were traced by hand against them.

**Go-red control:** each control runs the positive helper on mutated input: `assertEachPatternGoesRed`, ordering permutation with message-matched throws, the table-twin row deletion, the heading rename, and the snapshot-changed control in AC9.1.

**Absence-grep control:** the one absence assertion is Task 1 Step 4's empty `git diff --stat` over two test files. Control: the same command against a file this task edits (`tests/merge-verification-workflow-shape.test.js`) prints a stat line.

**Cross-boundary:** no consumer of an artifact shipped through a different path. The only upstream schema is GitHub Actions' trigger semantics (`types` defaults, tags-only push), cited from GitHub's documented defaults already encoded as `DEFAULT_PR_TYPES`.

**Consumer-enumeration / Dependency-caller enumeration / Reader-inventory:** no existing reader's rows change, and no existing function gains a dependency.

**Retirement-sweep / Behavior-change prose sweep:** nothing retired. The merge-verification "two readers" description changes, and Task 7 greps for it. The Coexistence "#5162's" future-tense sentence is updated in Task 5.

**Acceptance-criterion clause-id:** every clause AC1.1-AC11.2 is cited by id in a test name (map above). There are no waivers.

**Verify-then-maybe-change:** the spec's ASSUMPTION Gotcha is resolved in Build-time facts. The "if #5153's reader already exposes a field, use it" sentence is Task 1's copy of the four fields. `plugin/bin/lib/verify/declaration.js` is read-only, waived above.

**AC-evidence persistence:** every AC is verified by a committed test. The real-input probe is a probe, not AC evidence. Its output is pasted into the Task 4 report.

**Prohibition-vs-existing-mandate:** the one new prohibition, "never writes", applies to a new step with no existing mandate.

**Trust-vs-existing-distrust:** no new trust rule.

**Dispatcher-voice:** no dispatcher-addressed prose.

**Pairing-loop:** no pairing loop.

**Per-task role/review-risk markers:** set on every task.

**Governing-skill quote:** see Global Constraints → Governing project skills. `bin-source-scan-conformance`'s authoring rules do not apply because no source scan is added. Its existing scans are listed there.

**Batched-plan / Adjacent-task merge:** per-task. Task 3 shares Task 2's files, but checks 3-5 are a separately reviewable decision surface with their own tests, so they stay separate. Task 7 appends to Task 6's test file but touches different files.
