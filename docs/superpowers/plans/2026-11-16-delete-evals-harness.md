# Delete the Evals Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dormant `evals/` harness and its `eval-benchmark.yml` workflow, record the decision, and repair every reference outside `evals/` that points into it.

**Architecture:** Promote first, delete second, repair third. The three sections of `evals/NOTES.md` that live code and a project skill cite are copied to `docs/reference/` before the directory goes. The delete and the one root test that walks `evals/` change in the same task, so the suite is never red between tasks. Every other task is a prose or comment repair with its replacement text fixed in this plan.

**Tech Stack:** Markdown, Node `node --test` suites, git.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231051-spec-5561/work/5561-spec.md` (record #5561, draft PR #5581).

## Global Constraints

- Line numbers in this plan are at `026e203f3` (the branch base). Locate each edit by its quoted text, not by number.
- Non-goals, never edited: the six `main()` shim comments that say "or evals/" (`plugin/bin/code-health.js`, `design-detect.js`, `docs-health.js`, `harness-health.js`, `journey-health.js`, `phase-timing.js`); history (`docs/decisions/0012-*`, `docs/decisions/0015-*`, `docs/incident-log.md`, `CHANGELOG.md`, `docs/superpowers/**`, archived run files); `docs/skill-authoring.md`; the synthetic fixture paths in `tests/bin-lib/skill-audit/load.test.js` and `tests/load-delta-cli.test.js`; the `.superpowers/sdd/task-9-report.md` pointer in `local-files-preflight-stop.md`.
- `plugin/skills/backlog/SKILL.md`'s grant sub-stage paragraph and `plugin/skills/_shared/local-files-preflight-stop.md` are long paragraphs other tests read. Change only the text this plan quotes.
- `git grep -E` with `\b` matches nothing on this machine. Use `-F`, `-w` or `-P`.
- One plain command per Bash call, with literal arguments, run from the worktree root. No `cd … &&`, no `$(…)`, no pipes into `node -e`.
- Commit style: `{Verb} {what} — {detail}`, then a body line `refs #5561`, then the trailer `Claude-Session: https://claude.ai/code/session_017vXcAdc42Z6F8aPqLoVBNZ`. Stage files by explicit path. Never `git reset`, `git checkout .` or a force push.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skill, `.claude/skills/skill-prose-conformance-tests/SKILL.md` (applies to Task 4's test edit), quoted: "`[IL-105]` says prove the assertion can go red; the mechanism this repo converged on three times is to freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt." and "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." (`tests/sweep-orchestrator.test.js` already reads through `readText`.)
- Governing project skill, `.claude/skills/removal-condition-execution/SKILL.md` (applies to every repair task), quoted: "**Rationales.** A surviving rule that gave the removed thing as its reason. … Keep the rule and re-point the reason at what still enforces it".
- No other project skill under `.claude/skills/` names a file this plan edits in a way that adds a rule: `transcript-payload-verification` is itself edited (Task 1), and `bin-source-scan-conformance`, `windows-checkout-test-parity`, `node-test-output-evidence`, `single-source-constant-guard`, `pre-tool-use-gate-exemptions`, `driver-skill-outcome-taxonomy` and `gh-api-module-pattern` name `post-tool-use.js`, `docs/donts.md` or `docs/decisions` only as examples; this plan changes comments there, not code.

## Departures from the spec

Two findings the spec's file list missed. Both are "shipped prose that says an eval enforces something", the class the spec's fifth deliverable removes, and the spec calls its own grep "a floor, not proof of completeness".

1. `plugin/skills/sweep/SKILL.md`'s Anti-Patterns row ends "— the eval scenario fails CI on this, not just doc review", and `tests/sweep-orchestrator.test.js:116-120` pins that clause. The spec's seventh criterion expected that test to need no edit beyond the `sweep/SKILL.md:9` sentence. Task 4 removes the clause and re-points the assertion.
2. `plugin/bin/lib/skill-audit/bloat.js:43-44` ends a comment with "the same posture the eval cost check takes with a thin history". That check is `evals/tests/context-cost-regression.test.js`. Task 6 drops the comparison.

## Review Focus

- A reference into `evals/` that no grep in this plan matches because it is worded without the path (for example "the eval scenario"). Expected: no shipped skill, code comment or doc outside history claims an eval exists, runs or enforces anything. Task 7's phrase sweep reads every remaining hit.
- A reader following `docs/incident-log.md`'s `evals/NOTES.md` mention. Expected: the new reference file's first line names `evals/NOTES.md`, so a repo search for that name lands on it. Task 1 Step 5 checks the first line.
- `tests/backlog-refine-headless.test.js` after the `evals/` walk is gone. Expected: it still fails when a retired token appears under `plugin/skills/backlog/`. Task 3 Step 5 proves it.
- A second branch taking decision number `0034` before this one merges. Expected: the number is unique at merge time. Task 7 Step 5 re-lists `docs/decisions/` after the pre-verification catch-up.
- The always-loaded `CLAUDE.md`. Expected: it gets shorter and `tests/claude-md-budget.test.js` stays green. Task 6 Step 8 runs it.

---

### Task 1: Promote the cited sections of `evals/NOTES.md` to `docs/reference/`

**Role:** integration

**Files:**
- Create: `docs/reference/agent-sdk-payload-notes.md`
- Modify: `docs/REGISTRY.md`
- Modify: `plugin/bin/lib/hooks/post-tool-use.js`
- Modify: `tests/hooks-post-tool-use-ask-user-question.test.js`
- Modify: `.claude/skills/transcript-payload-verification/SKILL.md`

**Interfaces:**
- Consumes: `evals/NOTES.md` (read only; Task 3 deletes it).
- Produces: `docs/reference/agent-sdk-payload-notes.md`, whose section heading `## AskUserQuestion input/output shapes (confirmed Task 4, Step 1)` and its `**Correction` paragraph the three citers name.

- [ ] **Step 1: Read `evals/NOTES.md` lines 1-3 and 123-173**

- [ ] **Step 2: Confirm the reference file does not exist yet**

Run: `test -f docs/reference/agent-sdk-payload-notes.md`
Expected: FAIL (exit 1, no such file)

- [ ] **Step 3: Create `docs/reference/agent-sdk-payload-notes.md`**

Opening, exactly:

```markdown
# Agent SDK payload notes

This file replaces `evals/NOTES.md`, which was deleted with the eval harness in #5561 (`docs/decisions/0034-evals-harness-and-benchmark-workflow-deleted.md`). It keeps the three sections that code and a project skill outside the harness cite. The rest of that file is in git history at the parent of the deleting commit.

Confirmed against: @anthropic-ai/claude-agent-sdk@0.3.217 (ESM, "type": "module", main sdk.mjs). Capture dates: the `AskUserQuestion` shapes 2026-07-22, their Correction 2026-08-15 (#452), the `run_in_background` and `autoAllowBashIfSandboxed` defaults 2026-07-24, the `autoAllowBashIfSandboxed` supersession note 2026-08-02. `actor.js`, `runner.js` and the README named below were files of the removed harness.
```

Then the three sections, each copied byte for byte from `evals/NOTES.md`, headings included: lines 123-140 (`## AskUserQuestion input/output shapes (confirmed Task 4, Step 1)`), lines 142-155 (`## AgentInput.run_in_background default (confirmed during final-review follow-up)`), lines 157-173 (`## managedSettings.sandbox.autoAllowBashIfSandboxed default (confirmed during Task 7.5 sandbox validation)`), separated by one blank line. Apply exactly these four substitutions and no other change (they drop the path links into `evals/`):

| In the copied text | Becomes |
|---|---|
| `` `evals/actor.js`'s `updatedInput: { questions, answers }` return shape matches `` | `` The `updatedInput: { questions, answers }` return shape of the harness's `actor.js` matches `` |
| `` `evals/actor.js`'s original Agent-dispatch guard checked only `` | `` The original Agent-dispatch guard in the harness's `actor.js` checked only `` |
| `` in `evals/README.md`'s Safety model section and as `` | `` in the harness README's Safety model section and as `` |
| `` `evals/scenarios/actor-escape-attempt.yaml` is the confirming live run `` | `` The harness's `actor-escape-attempt` scenario was the confirming live run `` |

The quoted command line containing `path.join('evals','node_modules',…)` stays as written, since it records the command that was run.

- [ ] **Step 4: Add the `docs/REGISTRY.md` row and repoint the three citers**

`docs/REGISTRY.md`: insert this row directly after the `docs/reference/gh-issue-write-inventory.md` row:

```markdown
| docs/reference/agent-sdk-payload-notes.md | Agent SDK and hook payload facts confirmed against the installed SDK (#5561, promoted from the removed `evals/NOTES.md`) — the `AskUserQuestion` input/output shapes and what a `PostToolUse` hook's `tool_response` carries for that tool, `AgentInput.run_in_background`'s default, and `sandbox.autoAllowBashIfSandboxed`'s default | *(no auto-detect — hand-curated reference, revisited when an SDK upgrade or a new payload capture contradicts it)* |
```

In each of these, replace the text `evals/NOTES.md` with `docs/reference/agent-sdk-payload-notes.md` and change nothing else on the line: `plugin/bin/lib/hooks/post-tool-use.js` (the comment above `logAskUserQuestion`, one occurrence), `tests/hooks-post-tool-use-ask-user-question.test.js` (two comments), `.claude/skills/transcript-payload-verification/SKILL.md` (the Origin section, one occurrence). Re-wrap a comment line only if the longer path pushes it past its neighbours' width.

- [ ] **Step 5: Verify the reference file and its citers (AC4.1, AC4.2)**

Run: `git grep -n -F -e "this is the SDK's typed API-level output" -e "Agents run in the background by default" -e "still defaults to" -- docs/reference/agent-sdk-payload-notes.md`
Expected: three or more lines, at least one per pattern (AC4.1: the Correction, the `run_in_background` default and the `autoAllowBashIfSandboxed` note are present).

Run: `git grep -n -F "docs/reference/agent-sdk-payload-notes.md" -- plugin/bin/lib/hooks/post-tool-use.js tests/hooks-post-tool-use-ask-user-question.test.js .claude/skills/transcript-payload-verification/SKILL.md docs/REGISTRY.md`
Expected: five lines (AC4.2: one in `post-tool-use.js`, two in the test, one in the skill; plus the registry row).

Run: `git grep -n -F "evals/" -- docs/reference/agent-sdk-payload-notes.md`
Expected: exactly one line, line 3, the sentence naming `evals/NOTES.md`.

Run: `node --test tests/hooks-post-tool-use-ask-user-question.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

Stage the five files by path. Message: `Promote the cited Agent SDK notes to docs/reference — ahead of deleting evals/`.

### Task 2: Add decision record 0034

**Role:** transcription

**Files:**
- Create: `docs/decisions/0034-evals-harness-and-benchmark-workflow-deleted.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the decision record Task 1's reference file names.

- [ ] **Step 1: List `docs/decisions/` and confirm `0033-…` is the highest number**

If a file numbered `0034` or higher exists, use the next free number in the file name and heading, and report the change so Task 1's reference line can be corrected.

- [ ] **Step 2: Confirm no record 0034 exists**

Run: `ls docs/decisions/0034-evals-harness-and-benchmark-workflow-deleted.md`
Expected: FAIL (No such file or directory)

- [ ] **Step 3: Create the record with exactly this content**

```markdown
# 0034. The evals harness and its benchmark workflow are deleted

- **Status:** accepted
- **Date:** 2026-11-15
- **Context:** #5561

## Context

`evals/` was a separate Node project (102 tracked files, its own `package.json`) that ran skill scenarios against a live model through the Claude Agent SDK. By 2026-11-15 it was dormant:

- Its last commit was `57da82f41`, 2026-08-30.
- Its last recorded result, the final line of `evals/history.jsonl`, started on 2026-08-09.
- `.github/workflows/eval-benchmark.yml` was manual-dispatch only and offered six of the directory's 22 scenarios. GitHub shows one run of it (2026-10-09), which failed at its scenario step because the runner had neither `bwrap` nor `socat`, so the harness's required sandbox was unavailable. That is a gap in the harness's environment, not a plugin regression.
- Its 15 test files never ran in root CI. `npm test` covers `tests/` and `tools/upstream-drift/tests/` only.

Shipped skill text and code comments still cited eval scenario files, some as incident evidence and two as the thing that "pins" a boundary, although nothing had run those scenarios since August.

## Decision

Delete `evals/` and `.github/workflows/eval-benchmark.yml`. Do not replace them with another eval system in this change. Repair every reference outside `evals/` that pointed into it, so no shipped text names a file that does not exist or claims a check that does not run.

## Consequences

- No scenario-level regression check exists. Nothing tests that a live model respects a skill's stated boundary.
- Sweep's "never claims, builds, or merges" boundary: its statement in `plugin/skills/sweep/SKILL.md` is pinned by `tests/sweep-orchestrator.test.js`, which runs in CI. That test pins the wording, not a model's behavior.
- The permission-matrix-compliance and local-files preflight-stop scenarios have no CI replacement. The paragraphs they exercised, in `plugin/skills/backlog/SKILL.md`'s grant sub-stage, `plugin/skills/_shared/autonomy-ceiling.md` and `plugin/skills/_shared/local-files-preflight-stop.md`, are no longer regression-tested. They keep their sentences about the incidents, which remain the evidence.
- Six `main()` shim comments under `plugin/bin/` name `evals/` as an importer scope. That scope ceased to exist on this date; #5535 and #5536 delete the shims.
- `evals/NOTES.md` is now `docs/reference/agent-sdk-payload-notes.md`, which keeps the three sections cited from outside the harness.
- The `ANTHROPIC_API_KEY` Actions secret is used by no workflow. Whether to delete it is the maintainer's call.
- The harness's history is in git at the parent of the commit that deleted it, which landed through pull request #5581.
```

- [ ] **Step 4: Verify the record (AC5.1)**

Run: `ls docs/decisions`
Expected: exactly one file whose name starts with this record's number (AC5.1: the number is not used by another file), and the file states the decision, the date 2026-11-15 and a Consequences section.

- [ ] **Step 5: Commit**

Message: `Record the decision to delete the evals harness — decision 0034`.

### Task 3: Delete the harness, the workflow and the harness journey; fix the test that walks `evals/`

**Role:** integration

**Files:**
- Delete: `evals/README.md`
- Delete: `evals/NOTES.md`
- Delete: `.github/workflows/eval-benchmark.yml`
- Delete: `docs/journeys/verify-eval-harness-sandbox-security.md`
- Modify: `tests/backlog-refine-headless.test.js`

(`evals/README.md` and `evals/NOTES.md` stand for the whole directory: `git rm -r evals` removes all 102 tracked files.)

**Interfaces:**
- Consumes: Task 1 has already copied what survives from `evals/NOTES.md`.
- Produces: a tree with no `evals/` directory.

- [ ] **Step 1: Remove the tracked files**

Three separate calls: `git rm -r -q evals`, `git rm -q .github/workflows/eval-benchmark.yml`, `git rm -q docs/journeys/verify-eval-harness-sandbox-security.md`. Then `ls evals`: if a leftover untracked directory remains (for example `evals/node_modules`), remove it with `rm -rf evals` and do not read it.

- [ ] **Step 2: Run the test that walks the deleted directory**

Run: `node --test tests/backlog-refine-headless.test.js`
Expected: FAIL after Step 1 (`ENOENT … scandir … evals` in the retired-vocabulary sweep test)

- [ ] **Step 3: Remove the `evals/` handling from `tests/backlog-refine-headless.test.js`**

In the "retired-vocabulary sweep" test and the comment block above it, remove exactly:
- from the section comment, the words `, evals/ walked too` (the line becomes `// whole-branch review fix-wave — four offender tokens ---`);
- the exemption-ruling bullet that starts `//   - evals/scenarios/backlog-grant-local-files-preflight-stop.yaml — ONLY` (five comment lines, through `//     "backlog grant" count.`);
- the `CAPPED_FILES` entry `'evals/scenarios/backlog-grant-local-files-preflight-stop.yaml': { 'backlog grant': 1 },`;
- the line `const EVALS_DIR = path.join(ROOT, 'evals');`;
- the line `walk(EVALS_DIR, files);`.

`walk` itself has no handling that only the `evals/` walk used; leave it and everything else as it is. #5559 edits other lines of this file later.

- [ ] **Step 4: Run the test again**

Run: `node --test tests/backlog-refine-headless.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Verify the test still discriminates, and the deletions (AC6.1, AC1.1, AC8.1)**

With the Edit tool, append the line `scratch probe: backlog grant` to the end of `plugin/skills/backlog/refine-mode.md`.
Run: `node --test tests/backlog-refine-headless.test.js`
Expected: FAIL, the message naming `plugin/skills/backlog/refine-mode.md: found 1 occurrence(s) of "backlog grant"` (AC6.1).
With the Edit tool, remove that line again. Run: `git diff --stat -- plugin/skills/backlog/refine-mode.md`
Expected: no output (the file is byte-identical to HEAD).
Run: `node --test tests/backlog-refine-headless.test.js`
Expected: PASS (AC6.1).

Run: `git ls-files evals .github/workflows/eval-benchmark.yml docs/journeys/verify-eval-harness-sandbox-security.md`
Expected: no output (AC1.1).

Run: `ls .github/workflows`
Expected: seven files, no `eval-benchmark.yml` (AC8.1, first half).
Run: `node --test tests/verify-scope-declaration.test.js`
Expected: PASS, 0 failures (AC8.1, second half).

- [ ] **Step 6: Commit**

Stage `tests/backlog-refine-headless.test.js` by path (the `git rm` calls already staged the deletions). Message: `Delete the evals harness, its workflow and its journey page — drop the test's evals walk`.

### Task 4: Remove the "an eval pins it" claims about sweep

**Role:** transcription

**Files:**
- Modify: `tests/sweep-orchestrator.test.js`
- Modify: `plugin/skills/sweep/SKILL.md`
- Modify: `docs/skill-graph.md`
- Modify: `docs/journeys/run-a-hands-off-hygiene-sweep.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: Re-point the Anti-Patterns assertion in `tests/sweep-orchestrator.test.js`**

In the test `sweep/SKILL.md: never-invokes-build-machinery boundary is stated in When-to-Use and Anti-Patterns`, replace the final `assert.match(antiPatternRow, /the eval scenario fails CI on this, not just doc review/, …);` call with:

```js
  // #5561: the row used to end "— the eval scenario fails CI on this, not just
  // doc review". The eval harness is deleted and never ran in CI, so the row now
  // ends on its reason. The frozen pre-change row proves the end-anchored
  // pattern can go red [IL-105].
  const PRE_CHANGE_ROW = "| Invoking `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or `/claude-tweaks:build` from sweep | Sweep's legality as a headless parent of the grant chain rests on never claiming, building, or merging — the eval scenario fails CI on this, not just doc review |";
  const endsOnReason = /rests on never claiming, building, or merging \|$/;
  assert.match(
    antiPatternRow,
    endsOnReason,
    'expected the Anti-Patterns row to end on the legality reason, with no enforcement claim after it',
  );
  assert.doesNotMatch(PRE_CHANGE_ROW, endsOnReason, 'pattern must NOT match the pre-change row (proves it can go red)');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/sweep-orchestrator.test.js`
Expected: FAIL after Step 1 (`expected the Anti-Patterns row to end on the legality reason`)

- [ ] **Step 3: Edit the four prose sites**

| File | Replace | With |
|---|---|---|
| `plugin/skills/sweep/SKILL.md` (opening paragraph) | `` under this codebase's self-authorization rule, and `evals/scenarios/sweep-never-invokes-build-machinery.yaml` pins it. `` | `` under this codebase's self-authorization rule. `` |
| `plugin/skills/sweep/SKILL.md` (Anti-Patterns row) | `` rests on never claiming, building, or merging — the eval scenario fails CI on this, not just doc review | `` | `` rests on never claiming, building, or merging | `` |
| `docs/skill-graph.md` (sweep's `/dispatch` row) | `` (`evals/scenarios/sweep-never-invokes-build-machinery.yaml` pins it). `` | `` (`tests/sweep-orchestrator.test.js` pins the boundary's statement in `sweep/SKILL.md`). `` |
| `docs/journeys/run-a-hands-off-hygiene-sweep.md` (Step 4, Should understand) | `` and a dedicated eval pins it (`evals/scenarios/sweep-never-invokes-build-machinery.yaml`). `` | `` and `tests/sweep-orchestrator.test.js` pins the statement of that boundary in the skill. `` |

- [ ] **Step 4: Run the tests to verify they pass (AC7.1)**

Run: `node --test tests/sweep-orchestrator.test.js`
Expected: PASS, 0 failures (AC7.1, with the edit this plan's Departures section explains).
Run: `node --test tests/skill-graph-table-structure.test.js`
Expected: PASS, 0 failures.
Run: `git grep -n -i -F -e "evals/" -e "eval scenario" -e "dedicated eval" -- plugin/skills/sweep docs/journeys/run-a-hands-off-hygiene-sweep.md`
Expected: no output.

- [ ] **Step 5: Commit**

Message: `Stop claiming an eval pins sweep's boundary — cite the test that pins its statement`.

### Task 5: Reword the incident-evidence citations

**Role:** transcription

**Files:**
- Modify: `plugin/skills/backlog/SKILL.md`
- Modify: `plugin/skills/_shared/autonomy-ceiling.md`
- Modify: `plugin/skills/_shared/local-files-preflight-stop.md`
- Modify: `plugin/bin/lib/issues/autonomy.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: `plugin/skills/backlog/SKILL.md`, grant sub-stage paragraph**

Replace `` lifecycle anyway (`evals/scenarios/backlog-refine-permission-matrix-compliance.yaml`). `` with `` lifecycle anyway. `` Nothing else in the paragraph changes.

- [ ] **Step 2: `plugin/skills/_shared/autonomy-ceiling.md`**

Replace the passage that starts `` lifecycle on its own judgment. `evals/scenarios/backlog-refine-permission-matrix-compliance.yaml` `` and ends `The incident is the\nevidence; the eval is a partial guard on it.` with the following, wrapped to the file's width (about 100 columns):

```markdown
lifecycle on its own judgment. An eval scenario was written because of that incident, though what
it could actually assert was narrower — the grant path was untestable in its sandbox (no live
`gh`, network blocked), so it pinned the `local-files` boundary rather than the grant invariant
itself. It was deleted with the eval harness. The incident is the evidence.
```

- [ ] **Step 3: `plugin/skills/_shared/local-files-preflight-stop.md`, four sites in "Why this exists"**

| Replace | With |
|---|---|
| `` via this repo's own `evals/` harness running against real API calls, not hypothesized — `` | `` via a since-removed eval harness running against real API calls, not hypothesized — `` |
| the two lines `` (`evals/scenarios/backlog-refine-permission-matrix-compliance.yaml`, `` and `` `.superpowers/sdd/task-9-report.md`). Root cause: `` | one line `` (`.superpowers/sdd/task-9-report.md`). Root cause: `` (the rest of that sentence re-wraps as it falls; its words do not change) |
| `` run (`evals/scenarios/dispatch-local-files-preflight-stop.yaml`). `` | `` run. `` |
| `` tool calls, $17.47 — `evals/scenarios/backlog-refine-permission-matrix-compliance.yaml`). `` | `` tool calls, $17.47). `` |

- [ ] **Step 4: `plugin/bin/lib/issues/autonomy.js`, the comment above the `unattended` check**

Replace the comment lines from `// a full build-to-close lifecycle on its own judgment` through `// weight here). The tier is defined so the ceiling is complete; the grant path` with:

```js
  // a full build-to-close lifecycle on its own judgment (an eval scenario was
  // written because of it, though what that scenario could actually assert was
  // the local-files boundary — the grant path was untestable in its sandbox, so
  // it is the incident, not the since-deleted eval, that carries the weight
  // here). The tier is defined so the ceiling is complete; the grant path
```

The lines before and after stay as they are.

- [ ] **Step 5: Verify the citations are gone and the module's tests pass**

Run: `git grep -n -F "evals/" -- plugin/skills/backlog plugin/skills/_shared/autonomy-ceiling.md plugin/skills/_shared/local-files-preflight-stop.md plugin/bin/lib/issues`
Expected: no output.
Run: `git grep -n -F ".superpowers/sdd/task-9-report.md" -- plugin/skills/_shared/local-files-preflight-stop.md`
Expected: one line (the untouched pointer).
Run: `node --test tests/bin-lib/issues/autonomy.test.js`
Expected: PASS, 0 failures. If that file does not exist, run `git grep -l -F "issues/autonomy" -- tests` and run the files it lists.

- [ ] **Step 6: Commit**

Message: `Drop eval file paths from incident-evidence citations — the incidents stay as the evidence`.

### Task 6: Update docs, the retired rule and example comments

**Role:** transcription

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/plugin-structure.md`
- Modify: `docs/skill-graph.md`
- Modify: `docs/donts.md`
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Modify: `plugin/bin/lib/skill-audit/load.js`
- Modify: `plugin/bin/lib/skill-audit/bloat.js`
- Modify: `tests/working-approach-scope-discipline.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: `CLAUDE.md`, three edits**

| Replace | With |
|---|---|
| `` `tests/`, `docs/`, `evals/`, `perf/`, `tools/`, `scripts/`, and `work/` are maintainer-side `` | `` `tests/`, `docs/`, `perf/`, `tools/`, `scripts/`, and `work/` are maintainer-side `` |
| `` - `tests/` — `node --test` suites; `evals/` — a separate Node project (own `package.json`/`node_modules`), not part of the plugin runtime `` | `` - `tests/` — `node --test` suites `` |
| `` Per-suite test invocations, the `plugin/bin/*.js` CLIs (the four health sweeps plus the standalone CLIs listed there), and the evals harness commands are in `docs/plugin-structure.md`. `` | `` Per-suite test invocations and the `plugin/bin/*.js` CLIs (the four health sweeps plus the standalone CLIs listed there) are in `docs/plugin-structure.md`. `` |

- [ ] **Step 2: `docs/plugin-structure.md`, three deleted lines**

Delete the tree line that starts `evals/                            → Reproducible eval/benchmark harness`, and the two command lines that start `cd evals && npm install && node --test tests/` and `cd evals && node runner.js run <scenario>`. The closing code fence after them stays.

- [ ] **Step 3: `docs/skill-graph.md`, the payload-paths paragraph**

Replace `` (`docs/…`,\n`tests/…`, `evals/…`) are written from the repo root `` with `` (`docs/…`,\n`tests/…`) are written from the repo root `` (the line break stays where it is).

- [ ] **Step 4: `docs/donts.md`**

Delete the whole line that starts `- Don't spec an eval-scenario deliverable without checking it against` and ends `` `[IL-124]` ``. `docs/incident-log.md`'s IL-124 entry stays.

- [ ] **Step 5: Three code comments under `plugin/bin/lib/`**

| File | Replace | With |
|---|---|---|
| `plan-audit/checks.js` (in `walkFiles`) | the three lines `// "node_modules" is excluded at any depth (the WALK_EXCLUDES check`, `// above), which already covers evals/node_modules — no depth-1 special`, `// case needed.` | the two lines `// "node_modules" is excluded at any depth (the WALK_EXCLUDES check` and `// above) — no depth-1 special case needed.` |
| `skill-audit/load.js` | `// test fixtures (evals/fixtures/…, tools/upstream-drift/fixtures/…), never a` | `// test fixtures (tools/upstream-drift/fixtures/…), never a` |
| `skill-audit/bloat.js` (above `MIN_ROW_SAMPLE`) | the two lines `// rows the check reports that it has no baseline instead of guessing — the same` and `// posture the eval cost check takes with a thin history.` | the one line `// rows the check reports that it has no baseline instead of guessing.` |

- [ ] **Step 6: `tests/working-approach-scope-discipline.test.js`, header comment**

Replace the two lines `//      design (this repo carries its own Integration-model paragraph), and` and `//      the evals fixtures are frozen generator output, deliberately not synced.` with the one line `//      design (this repo carries its own Integration-model paragraph).`

- [ ] **Step 7: Sweep for anything this task's files still say about the harness**

Run: `git grep -n -i -F -e "evals/" -e "evals harness" -e "eval harness" -e "eval-scenario" -e "eval cost" -e "evals fixtures" -- CLAUDE.md docs/plugin-structure.md docs/skill-graph.md docs/donts.md plugin/bin/lib/plan-audit plugin/bin/lib/skill-audit tests/working-approach-scope-discipline.test.js`
Expected: no output.

- [ ] **Step 8: Run the tests that read the edited files**

Run: `node --test tests/claude-md-budget.test.js tests/working-approach-scope-discipline.test.js tests/skill-graph-table-structure.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/skill-audit/load.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

Message: `Remove the evals harness from the docs — structure lists, commands, a retired rule and example comments`.

### Task 7: Final verification and the note on #4237

**Role:** integration

This task is folded into `/claude-tweaks:build`'s Common Step 5 and run by the controller, not dispatched. Evidence goes to `$PIPELINE_RUN_DIR/evidence/` with one `AC evidence` decision line per criterion.

**Files:**
- Test: `tests/backlog-refine-headless.test.js`
- Test: `tests/sweep-orchestrator.test.js`

**Interfaces:**
- Consumes: Tasks 1-6 committed.
- Produces: the evidence the Review Console and `/claude-tweaks:review` read.

- [ ] **Step 1: Verify the floor grep at base and at HEAD (AC2.1, AC2.2)**

Run at base (AC2.2): `git grep -n -F "evals/" 026e203f3 -- plugin/skills plugin/bin/lib CLAUDE.md docs/plugin-structure.md docs/skill-graph.md docs/donts.md docs/journeys .claude/skills tests ':!tests/bin-lib/skill-audit/load.test.js' ':!tests/load-delta-cli.test.js'`
Expected: lines in each of `plugin/skills`, `plugin/bin/lib`, `CLAUDE.md`, `docs/plugin-structure.md`, `docs/skill-graph.md`, `docs/donts.md`, `docs/journeys`, `.claude/skills` and `tests` (this is also the control showing the grep can match).
Run at HEAD (AC2.1): the same command without the `026e203f3` argument.
Expected: no output.

- [ ] **Step 2: Verify the whole-word sweep and the phrase sweep, reading every hit (AC2.3)**

Run: `git grep -n -w evals -- CLAUDE.md docs/plugin-structure.md docs/skill-graph.md docs/donts.md docs/journeys .claude/skills plugin/skills tests ':!tests/bin-lib/skill-audit/load.test.js' ':!tests/load-delta-cli.test.js'`
Expected (AC2.3): only the unrelated verb uses in `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md` and `tests/merge-subject-composer-conformance.test.js`.
Run: `git grep -n -i -F -e "eval scenario" -e "eval harness" -e "evals harness" -e "eval-scenario" -e "dedicated eval" -e "eval cost" -e "eval-benchmark" -- . ':!CHANGELOG.md' ':!docs/incident-log.md' ':!docs/superpowers' ':!docs/decisions' ':!.claude-tweaks/pipelines' ':!docs/plans/*-ledger.md'`
Expected: only the past-tense mentions this plan wrote (`autonomy-ceiling.md`, `local-files-preflight-stop.md`, `autonomy.js`, the frozen `PRE_CHANGE_ROW` and its comment in `tests/sweep-orchestrator.test.js`, the reference file's header). Read each hit; any present-tense claim that an eval exists or runs is a fix-now finding.

- [ ] **Step 3: Verify `plugin/bin` (AC3.1)**

Run: `git grep -n -F "evals/" -- plugin/bin`
Expected: exactly the six `main()` shim comment lines named in Global Constraints, or fewer if #5535 or #5536 landed in the catch-up merge (AC3.1).

- [ ] **Step 4: Verify the two edited suites and the full suite (AC6.1, AC7.1, AC9.1)**

Run: `node --test tests/backlog-refine-headless.test.js tests/sweep-orchestrator.test.js`
Expected: PASS (AC6.1's pass half, AC7.1).
Then the project's full verification through Common Step 5's runner, whole suite (AC9.1: `npm test -- --full` passes).

- [ ] **Step 5: Verify the decision number is still unique after the catch-up merge (AC5.1)**

Run: `ls docs/decisions`
Expected: one file numbered `0034`. If the catch-up brought another, renumber this record to the next free number and update the reference file's first paragraph.

- [ ] **Step 6: Post the note on #4237**

Write the comment body with the Write tool to a session temp file and post it with `gh issue comment 4237 --repo thn-inc/claude-tweaks --body-file {file}`:

> PR #5581 (record #5561) deletes `.github/workflows/eval-benchmark.yml` together with the `evals/` harness. Once it merges, this record's Current State and Key Files lines for that workflow are moot: the file no longer exists, so there is nothing in it to move off Node 20.
