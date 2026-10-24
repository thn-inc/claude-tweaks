# Tidy Arm-Ready-PR Acceptance Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/tidy`'s `## Arm ready PR` action stops arming auto-merge on a record-linked PR whose acceptance labeling never landed, and holds it for a human instead.

**Architecture:** Prose-as-implementation. The action gains one guard paragraph, placed before its `_shared/pr-first-merge.md` Step 3 call. The paragraph applies `dispatch/close-out.md` step 3's landed rule (the run's `verify.json` `acceptance-labeling` row) and its live-state precheck (`demo:pending`, trusted brief/try-it comments). It never runs labeling itself. `pr-first-merge.md` Step 1 names tidy as the third caller of the rule, `docs/skill-graph.md` records the new tidy → close-out edge, and a `node --test` conformance suite with negative controls pins the change.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-22T135715-record-3877/work/3877-spec.md`

**Scope keywords:** Arm ready PR, never touches Step 1

## Global Constraints

- The housekeeping-marker flavor (`<!-- tidy-housekeeping-pr -->` / `<!-- wrap-up-residue-pr -->`, no linked record) is unchanged. It has no record to label.
- A tidy sweep never runs labeling (`wrap-up/verification-brief.md`) itself.
- The "never touches Step 1 … preconditions already hold" claim must no longer appear in `actions-github-issues.md`.
- The sentence `Arm ready PR action explicitly never touches Step 2 (Mark the PR ready)` in `tidy/step-7-5-worktree-always.md` is pinned by `tests/sweep-backstop.test.js:369`. Leave that file untouched. The Step 2 half of the corrected sentence stays true.
- The existing negative control in `tests/verify-json-acceptance-guard-conformance.test.js` strips `/Labeling has not landed when.*?reached this merge\./` from pr-first-merge Step 1 and asserts that `verify.json`, `acceptance-labeling`, `not landed` and `pass…skip` are all gone afterwards. Any text added to Step 1 must sit inside that span or contain none of those four tokens.
- Commit messages say "refs #3877", never "closes"/"fixes".

## Review Focus

1. **No resolvable run dir.** This happens when tidy runs in a fresh sandbox or the run was reaped. The guard must not refuse every record-linked PR forever. Once verify.json is unreadable it falls through to the live-state precheck, and only holds the PR when that precheck also fails. Task 1 pins this.
2. **Multi-spec parent run.** The marker names the parent and verify.json lives only under `spec-*/`. The guard must read every `spec-*/verify.json`. Task 1 pins this.
3. **Held PR reported silently.** A held PR must surface in the Step 7.5 verification output with its reason, unlike the existing re-verify "silent no-op". Task 1 pins the report line and adds the template row.
4. **Housekeeping PR caught by the guard.** That PR has no Fixes records, so its precheck could never pass. The guard must explicitly skip that flavor. Task 1 pins this.
5. **Untrusted brief comment counted as landed.** The live-state precheck must use the Trusted-authors rule, never any comment. Task 1 pins this.

---

### Task 1: Guard `## Arm ready PR` on acceptance labeling

**Files:**
- Modify: `plugin/skills/tidy/actions-github-issues.md` (`## Arm ready PR`, lines 84-100)
- Modify: `plugin/skills/tidy/SKILL.md` (Step 7.5 verification template: add one row after the `Resolved thread` row)
- Test: `tests/tidy-arm-ready-pr-acceptance-guard.test.js` (Create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the guard paragraph, which opens with the bold lead `**Acceptance labeling — record-linked flavor only, before Step 3.**` and ends with the sentence `…so there is nothing to label.` Task 2's skill-graph row names this section.

- [ ] **Step 1: Write the failing test** at `tests/tidy-arm-ready-pr-acceptance-guard.test.js`.

  Match the style of `tests/verify-json-acceptance-guard-conformance.test.js`:
  - Read files through `readText` from `./helpers/read-skill` and collapse whitespace with `.replace(/\s+/g, ' ')`.
  - Slice the section from `'## Arm ready PR'` to `'## Release claim'`.
  - Name the added paragraph `GUARD_ADDED = /\*\*Acceptance labeling — record-linked flavor only, before Step 3\.\*\*.*?nothing to label\./`.

  Tests:
  - `AC1.1: Arm ready PR names verify.json's acceptance-labeling row before its Step 3 call`. Match each pin in `GUARD_PINS = [/verify\.json/, /`acceptance-labeling` row/, /pass.{0,12}skip/, /read every `spec-\*\/verify\.json`/, /dispatch\/close-out\.md` step 3/]`. Also assert `section.indexOf('`acceptance-labeling` row') < section.indexOf("run `_shared/pr-first-merge.md`'s Step 3")`, with both indices `>= 0`.
  - `AC1.1: negative control — removing the guard paragraph fails each pin`. Assert `GUARD_ADDED` matches. Strip it, then assert each `GUARD_PINS` entry no longer matches.
  - `AC2.1: the "never touches Step 1 … preconditions already hold" claim is gone`. `doesNotMatch` both `/never touches Step 1/` and `/both preconditions already hold/`.
  - `AC3.1: a record-linked PR with no verify.json and no demo:pending on its Fixes records is held, not armed`. Pin each of: `/demo:pending/`, `/<!-- run-comment: brief -->/`, `/<!-- run-comment: try-it -->/`, `/Trusted authors/`, `/no valid marker or run dir resolves/`, `/is held, not armed/`, `/never run labeling from a tidy sweep/`, `/not armed — acceptance labeling not landed/`, `/\/claude-tweaks:dispatch close-out/`.
  - `AC3.1: negative control — the held outcome is gone once the guard paragraph is stripped`. After stripping `GUARD_ADDED`, `doesNotMatch(/is held, not armed/)` and `doesNotMatch(/not armed — acceptance labeling not landed/)`.
  - `housekeeping-marker flavor is exempt from the guard`. Pin `/housekeeping-marker flavor .{0,120}skips this check/`.
  - `Step 7.5 verification template lists the held outcome`. Pin `tidy/SKILL.md` for `/Held \(not armed\): PR #\{n\} — acceptance labeling not landed/`.

- [ ] **Step 2: Run the test to verify it fails**

  Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js`
  Expected: FAIL. The AC1.1, AC2.1, AC3.1 and template tests fail, and the "the added rule must be locatable" assertion fails.

- [ ] **Step 3: Edit `plugin/skills/tidy/actions-github-issues.md`.**

  (a) Insert this paragraph between the `When judging \`statusCheckRollup\`` paragraph and the `If every gate still holds` paragraph. The copy is exact; wrap lines at about 100 columns like the surrounding text.

  > **Acceptance labeling — record-linked flavor only, before Step 3.** Green says nothing about whether acceptance labeling (`demo:pending`, the Try it walkthrough) landed, and the merge closes every `Fixes` record. For a PR carrying the `claude-tweaks-run:` marker, apply `dispatch/close-out.md` step 3's landed rule and live-state precheck before arming. First, resolve the run dir from the marker as that step does (`$RUN_ROOT/.claude-tweaks/pipelines/{run-id}/`, else its `archive/{run-id}/` copy). Then read its `verify.json`: when the run dir has `spec-*/` subdirectories (a multi-spec parent), read every `spec-*/verify.json`; otherwise read the run dir's own. Labeling has landed when every file read exists and its `acceptance-labeling` row's `result` is `pass`/`skip`. When it has not, and also when no valid marker or run dir resolves, it still counts as landed in two cases: every record in the PR's `Fixes` lines carries `demo:pending`, or the PR carries a trusted `<!-- run-comment: brief -->` or `<!-- run-comment: try-it -->` run comment (or its multi-spec `brief:{N}`/`try-it:{N}` form; trusted per `_shared/pr-run-comments.md`'s Trusted authors). Otherwise do not run Step 3, and never run labeling from a tidy sweep: `wrap-up/verification-brief.md` needs the run's own inputs. Hold the PR for a human instead, and never as a silent no-op. Report `PR #{n} not armed — acceptance labeling not landed ({verify.json missing | acceptance-labeling: {result} | no run dir})` and recommend `/claude-tweaks:dispatch close-out`, which runs `_shared/pr-first-merge.md` Step 1 before it merges. So a record-linked PR whose run dir has no `verify.json`, and whose `Fixes` records carry no `demo:pending`, is held, not armed. The housekeeping-marker flavor (`<!-- tidy-housekeeping-pr -->` / `<!-- wrap-up-residue-pr -->`) skips this check: it links no record, so there is nothing to label.

  (b) Change the opening of the next paragraph from `If every gate still holds, run` to `If every gate still holds (and, for a record-linked PR, labeling has landed), run`. Leave the rest of that paragraph unchanged.

  (c) Replace the sentence `This action never touches Step 1 (Acceptance labeling) or Step 2 (Mark the PR ready) of \`_shared/pr-first-merge.md\` — by construction, item 9 only ever selects PRs that are already not draft and already green, so both preconditions already hold by the time this action runs.` with:

  > This action never runs Step 1 (Acceptance labeling) of `_shared/pr-first-merge.md` itself. It guards on it instead (above), holding a record-linked PR whose labeling never landed. It never touches Step 2 (Mark the PR ready): item 9 only ever selects PRs that are already not draft, so that precondition already holds by the time this action runs.

  Keep the `Step 2.5 (Merge-verification gate) is satisfied the same way: …` sentences that follow exactly as they are.

- [ ] **Step 4: Edit `plugin/skills/tidy/SKILL.md` Step 7.5.** Add one row to the verification template right after the `- [x] Resolved thread: …` row:

  `- [x] Held (not armed): PR #{n} — acceptance labeling not landed ({reason}); recommended \`/claude-tweaks:dispatch close-out\` (record-linked Arm ready PR, \`actions-github-issues.md\`)`

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/sweep-backstop.test.js tests/merge-verification-gate-conformance.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add tests/tidy-arm-ready-pr-acceptance-guard.test.js plugin/skills/tidy/actions-github-issues.md plugin/skills/tidy/SKILL.md
git commit -m "Guard tidy's Arm ready PR on acceptance labeling — hold record-linked PRs whose verify.json row never landed, refs #3877"
```

### Task 2: Name tidy as a caller in pr-first-merge Step 1 and record the skill-graph edge

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:40-42` (Step 1's last sentence)
- Modify: `docs/skill-graph.md` (`## tidy` table: append one row)
- Test: `tests/tidy-arm-ready-pr-acceptance-guard.test.js` (append)

**Interfaces:**
- Consumes: Task 1's guard paragraph and the test file's `read`/`slice` helpers.
- Produces: nothing downstream.

- [ ] **Step 1: Append failing tests** to `tests/tidy-arm-ready-pr-acceptance-guard.test.js`:
  - `pr-first-merge Step 1 names tidy's Arm ready PR as a caller that holds instead of labeling`. Slice `'## Step 1:'`..`'## Step 1.5'` of `plugin/skills/_shared/pr-first-merge.md` and match `/tidy's Arm ready PR holds rather than runs this step/`. Then also assert that this text sits inside `/Labeling has not landed when.*?reached this merge\./`. That keeps the existing negative control in `verify-json-acceptance-guard-conformance.test.js` valid.
  - `skill-graph records the tidy → dispatch/close-out.md edge`. Slice `docs/skill-graph.md` from `'## tidy'` to `'## visual-review'`, then match `/\| `dispatch\/close-out\.md` \| .*## Arm ready PR/`.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js`
  Expected: FAIL on the two new tests only.

- [ ] **Step 3: Edit pr-first-merge Step 1.** Change the tail `— \`dispatch/close-out.md\` step 3 also accepts live labels or brief comments — whichever caller reached this merge.` to:

  `— \`dispatch/close-out.md\` step 3 also accepts live labels or brief comments, and tidy's Arm ready PR holds rather than runs this step — whichever caller reached this merge.`

  The inserted clause contains none of the existing MERGE_PINS tokens and is kept short (about 57 bytes): the composed `merge` bundle that includes this file measures 52137 of the 52500-byte rail (plan-audit headroom).

- [ ] **Step 4: Append the skill-graph row** to the `## tidy` table:

  `| \`dispatch/close-out.md\` | \`actions-github-issues.md\`'s \`## Arm ready PR\` applies close-out step 3's acceptance-labeling landed rule (\`verify.json\`'s \`acceptance-labeling\` row) and live-state precheck before arming a record-linked PR, holding the PR for a human instead of running labeling from a sweep (#3877). |`

- [ ] **Step 5: Run to verify pass**

  Run: `node --test tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/skill-graph-dangling-pointer.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add tests/tidy-arm-ready-pr-acceptance-guard.test.js plugin/skills/_shared/pr-first-merge.md docs/skill-graph.md
git commit -m "Name tidy's Arm ready PR as a pr-first-merge Step 1 caller and record its close-out edge, refs #3877"
```

Waived AC4.1: `npm test` is a whole-suite gate, not a clause a task test can pin; Common Step 5 runs it through `verify.js`.

## Decision: no shared landed-check helper (spec Deliverable 4, "Consider")

Not built. The landed rule has two halves:
- **verify.json read:** local file read.
- **Live-state precheck:** `demo:pending` labels and trusted run comments, which needs `gh`.

A `verify-results.js`-backed CLI could cover only the first half. Every caller would still restate the second half, so drift would not go away. This plan treats `dispatch/close-out.md` step 3 as the single prose statement of the rule:
- tidy cites it and states only how it departs from it: hold instead of running Step 1, and use the live-state precheck when no run dir resolves.
- pr-first-merge Step 1 names both callers.
- The conformance suites pin the shared rule terms in all three files, which provides the mechanical anti-drift guard.
