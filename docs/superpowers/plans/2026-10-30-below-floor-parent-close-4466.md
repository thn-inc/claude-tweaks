# Below-Floor Parent Close Implementation Plan (#4466)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A decomposition parent whose last sub-issue closes below the oversight floor gets closed, after that merge lands, with a comment listing each sub-issue and its closing PR. Tidy surfaces any parent the close missed.

**Architecture:** `wrap-up/verification-brief-parent-gate.md` gets one canonical `## Close the parent below the floor` section. It has two callers:
- **`github-issues`:** a new post-merge step, `_shared/pr-first-merge-post-merge.md` Step 4.0b, which every pr-first `merged` outcome reaches. Dispatch close-out step 7 and wrap-up `merge` mode step 3 also cite it.
- **`local-files`:** the sub-issue-side `exceeds: false` branch writes the parent record's closure in-branch, so the closure lands with the run's merge.

The pre-merge sub-issue-side callers never close a `github-issues` parent.

Supporting changes:
- **Backstop:** tidy's `parent-gate` backstop scans on both drivers emit below-floor due parents. The existing `Open parent gate` action's re-verified `exceeds: false` branch closes them.
- **Acceptance gap:** `needsBackstop` gains an `isParent` field, so neither driver's `acceptance-gap` scope flags a decomposition parent.
- **Verify:** `engine-verify`'s below-floor skip now names the post-merge close.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS (`plugin/bin/lib/issues/acceptance.js`, `plugin/bin/lib/wrap-up/engine-verify.js`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T045550-spec-4469-4466/spec-4466/work/4466-spec.md` (record #4466)

Scope keywords: closes cleanly, ever closes a parent, never closes the parent, below oversight floor

## Global Constraints

- **Closing-comment marker heading,** byte-identical in every task: `## Closed below the oversight floor`.
- **Sub-issue listing line,** exactly `- #{n} {title} — closed by PR #{pr}`, with `{pr}` read from `closedByPullRequestsReferences`. A sub-issue with no PR reference is listed as `- #{n} {title}` with no suffix. Never a merge SHA (plan-review decision, 2026-10-30). Under `local-files` the line is `- {id} {title}` (no PR data exists).
- **`github-issues` close sequence:** post the comment first (`gh issue comment $PARENT_NUM --body-file …`), then `gh issue close $PARENT_NUM --reason completed`.
- **`local-files` close sequence:** append the section to the parent body with `writeRecord`, then `closeRecord(parentPath)` (`plugin/bin/lib/issues/local-store.js`).
- **Idempotence:** a parent already `CLOSED` (`facets.closed` under `local-files`) is a no-op. A trusted comment (`_shared/pr-run-comments.md`'s Trusted authors) already carrying the heading means close only, with no second comment. The `local-files` equivalent is a body already holding the heading.
- **No acceptance labels:** the below-floor close never writes `demo:pending`, `demo:approved` or `demo:changes-requested`, and never composes a Verification Brief.
- **Close timing:** a `github-issues` parent is never closed by a pre-merge caller (wrap-up Phase 4, wrap-up's auto-merge short-circuit, dispatch's group auto-merge gate).
- **Comment-body temp file:** session-scoped `parent-close-comment.md`, via `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value parent-close-comment.md`. Never `/tmp`.
- **Byte caps:**
  - `plugin/skills/tidy/step-6-auto.md` is 48,934 bytes; after Task 3, `wc -c` must stay under 49,400.
  - `plugin/skills/_shared/github-pr-scan-acceptance.md` is 46,268 bytes; after Tasks 1 and 3 it must stay at or below 47,200 (`RAIL_BYTES` is 52,500).
- **Commits:** subject `{Verb} {what} — refs #4466`, never `closes`/`fixes`, ending with the line `Claude-Session: https://claude.ai/code/session_017vXcAdzjXoYPckYwSbBNA3`. Run git as `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-4469-4466" …`, one plain command per call. Never `git stash`.
- **Scope and edit discipline:** commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- **Test runs:** targeted suites only (`node --test <file>`). The full suite runs centrally.
- **Prose-conformance rules,** quoted from `.claude/skills/skill-prose-conformance-tests/SKILL.md`, its Project Conventions:
  - "Anchor on a literal token the skill already uses … never a paraphrase."
  - "copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "Apply the whitespace-collapsed control scan to **both** directions … absence assertions need it more than presence ones." Every absence assertion here (`closes cleanly`, `never closes the parent`, `nothing else in the system ever closes a parent`) runs over `s.replace(/\s+/g, ' ')`.
  - "Prove the assertion can go red before trusting its green."

## Review Focus

1. **The merge never lands** (`armed` that never merges, or `pending-review`). Expected: the parent stays open. Step 4.0b runs only on outcome `merged`, and tidy's backstop surfaces the parent once every sub-issue really is closed. Pinned in Task 2's prose test: Step 4.0b names `merged` only, and the `exceeds: false` bullet says pre-merge callers never close a `github-issues` parent.
2. **Running the close twice** (close-out after an earlier Step 4.0b, or a tidy approval after Step 4.0b). Expected: one comment, one close. Pinned in Task 2: the prose names both idempotence checks, already `CLOSED` and a trusted heading comment.
3. **Unscored sibling** (a sub-issue with no `risk:*`). Expected: `maxRiskTier` is `undefined`, the parent fails closed to `exceeds: true`, and it is never closed silently. Pinned in Task 3's scan-execution tests: an unscored due parent prints the above-floor row.
4. **A just-merged sub-issue still reads `OPEN`** (GitHub closes it about 2 s after `mergedAt`). Expected: Step 4.0b passes the merge's closing records as `$CLOSING_SUB_ISSUES`, so the Self-inclusion rule counts them `CLOSED`. Pinned in Task 2: the Self-inclusion table gains a Step 4.0b row.
5. **An untrusted comment carrying the marker heading.** Expected: it does not count as the listing comment, and the parent still gets a comment of its own. Pinned in Task 2: the close section cites Trusted authors.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, AC1, AC2 (post-merge close, both drivers) | Task 2 |
| Deliverable 2 (comment format, PR references) | Task 2 |
| Deliverable 3, AC3 (tidy parent-gate Close row) | Task 3 |
| Deliverable 4, AC4 (acceptance-gap excludes parents) | Task 1 |
| Deliverable 5, AC5 (idempotent close) | Task 2 |
| Deliverable 6 (engine-verify tests, journey doc) | Task 4 |

---

### Task 1: `needsBackstop` excludes decomposition parents

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/acceptance.js`. In `needsBackstop(record)`, after the `hasParent` line, add `if (record.isParent === true) return false;` with a one-line comment (a decomposition parent's acceptance is the parent gate's, never an acceptance-gap row).
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, the `acceptance-gap` `needsBackstop({…})` call. Add `isParent: parseRecordFacets(r.labels).isParentIssue,` (`parseRecordFacets` is already required in that block). Add one sentence beside the `hasParent` prose, near "`needsBackstop`'s `hasParent` field exists precisely to suppress it", saying that `isParent` likewise keeps a parent closed below the floor (#4466) out of this scope.
- Modify: `plugin/skills/tidy/step-1-records.md`, Shape 8's `needsBackstop({…})` call. Add `isParent: r.facets.isParentIssue === true,`.
- Test: `tests/bin-lib/issues/acceptance.test.js` (append) and `tests/below-floor-parent-close-conformance.test.js` (create).

**Interfaces:**
- Produces: `needsBackstop({ state, labels, hasParent, isParent, stateReason })`. `isParent: true` returns `false`, and absent means no change in behavior.

- [ ] **Step 1: Write the failing tests.**
  - In `acceptance.test.js`, add test `needsBackstop excludes a decomposition parent`. It asserts:
    - `needsBackstop({ state: 'CLOSED', labels: [], isParent: true })` is `false`;
    - `needsBackstop({ state: 'CLOSED', labels: [], isParent: false })` is `true`;
    - `needsBackstop({ state: 'CLOSED', labels: [] })` is `true`.
  - Create `tests/below-floor-parent-close-conformance.test.js` (style: `tests/acceptance-scan-server-filter.test.js`, `readText` from `tests/helpers/read-skill.js`) with test `AC4: both acceptance-gap scans pass isParent to needsBackstop`. It asserts:
    - the GitHub fence matches `/isParent: parseRecordFacets\(r\.labels\)\.isParentIssue,/`;
    - Shape 8 matches `/isParent: r\.facets\.isParentIssue === true,/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/acceptance.test.js tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL (`isParent: true` returns `true`; patterns not found)

- [ ] **Step 3: Implement** the three edits above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/acceptance.test.js tests/below-floor-parent-close-conformance.test.js tests/acceptance-scan-server-filter.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the four files: `Exclude decomposition parents from the acceptance-gap backstop — refs #4466`

---

### Task 2: Close a below-floor parent after the merge lands

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`
  - **`## Enumerate the parent's sub-issues` fetch:** `gh issue view {n} --json state,labels` becomes `state,labels,title,closedByPullRequestsReferences`.
  - **`**exceeds: false**` bullet in `## Evaluate the gate`:** replace "the parent closes cleanly: no `demo:pending`, no brief, same as …" with:
    - the literal "no `demo:pending`, no brief" (`tests/try-it-contract-conformance.test.js:170` pins it);
    - sub-issue-side entry: under `github-issues` the parent stays open, because this run's merge has not landed, and `_shared/pr-first-merge-post-merge.md`'s Step 4.0b closes it after the merge (`/claude-tweaks:tidy`'s `parent-gate` backstop catches a merge that closes outside a session). Under `local-files`, run **Close the parent below the floor** now, because the record write lands with the run's merge;
    - parent-side entry (`/claude-tweaks:tidy`): run **Close the parent below the floor**;
    - keep the Try-it walkthrough sentence. The parent-side entry still carries no walkthrough.
  - **New `## Close the parent below the floor` section,** between `## Evaluate the gate` and `## Compose the parent brief`:
    1. Idempotence, per Global Constraints, reading `gh issue view $PARENT_NUM --json state,comments`. Untrusted heading comments are named in a skip notice.
    2. Body: the heading; one sentence naming the highest sub-issue `risk:{maxTier}` and the resolved `risk-floor`, saying no Verification Brief or `demo:pending` sign-off is owed; then one listing line per enumerated sub-issue (Global Constraints). A `$CLOSING_SUB_ISSUES` member whose `closedByPullRequestsReferences` is still empty uses the run's `run-state.json` `pr` number.
    3. Write the body to `parent-close-comment.md`, then comment, then close.
    4. Partial state: report exactly which call failed, and never fall back to the no-parent path. A rerun's idempotence check, or tidy's backstop, finishes it.
    5. `local-files`: the same, through `writeRecord` then `closeRecord(parentPath)`, with `parentPath` resolved as **Apply the gate** resolves it.
  - **Self-inclusion caller table:** add the row `` `_shared/pr-first-merge-post-merge.md` Step 4.0b `` with the merged PR's closing records.
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md`. Add `### Step 4.0b: Close below-floor parents (#4466)` between Step 4.0 and Step 4.1. It applies only under `work-backend: github-issues`.
  - **Inputs:** take `$CLOSING_SUB_ISSUES` from the merged PR's own closing records, `gh pr view {pr} --json closingIssuesReferences --jq '[.closingIssuesReferences[].number]'` (probe-run on PR #4529 → `[4369]`), minus any record Step 4.0 reopened. It does not come from a run-dir fact pack: a multi-spec merge runs against the parent run dir, which has no per-spec pack.
  - **Per record with a resolvable parent:** run the Parent-Gate Procedure from **Resolve the parent** through **Evaluate the gate**, and on `due` with `exceeds: false` run **Close the parent below the floor**. Every other outcome is a no-op.
  - **Logging:** log one `decisions.md` line per parent closed.
  - **Failure:** a failing `gh` call is reported in the closing summary, never a stop.
- Modify: `plugin/skills/dispatch/close-out.md` step 7 ("First run `_shared/pr-first-merge-post-merge.md`'s Step 4.0, …") and `plugin/skills/wrap-up/merge-mode.md` step 3 ("run Step 4.0 (…), then Step 4.1"): each now runs Step 4.0 and then Step 4.0b. Keep the substring `` pr-first-merge-post-merge.md`'s Step 4.0 `` / `` Step 4.0 (`_shared/pr-first-merge-post-merge.md`), then Step 4.1 `` that `tests/closing-links-prose-conformance.test.js` pins.
- Modify: `plugin/skills/demo/SKILL.md:264`. The "nothing else in the system ever closes a parent" clause now names the Parent-Gate Procedure's **Close the parent below the floor** as the closer below the floor, and keeps /demo's Approve as the only close for a parent above it.
- Test: `tests/below-floor-parent-close-conformance.test.js` (append).

**Interfaces:**
- Consumes: Task 1 — none.
- Produces: the section name `## Close the parent below the floor`, the heading `## Closed below the oversight floor`, and the step `### Step 4.0b: Close below-floor parents (#4466)`. Task 3 cites the section, and Task 4 cites Step 4.0b.

- [ ] **Step 1: Write the failing tests** (names prefixed `AC1:`/`AC2:`/`AC5:`):
  - **`exceeds: false` slice:** `between(gate, '**`exceeds: false`**', '**`exceeds: true`**')` does not match `/closes cleanly/`. It matches `/Step 4\.0b/`, `/\*\*Close the parent below the floor\*\*/`, and the kept Try-it pins `/end-to-end variant/` and `/Parent-side entry/`.
  - **Close section** (`between(gate, '## Close the parent below the floor', '## Compose the parent brief')`):
    - it includes `## Closed below the oversight floor` and `closed by PR #{pr}`, states the no-SHA rule (matches `/never[^.]*merge SHA/i`), and does not include `mergeCommit`;
    - in index order, `gh issue comment $PARENT_NUM --body-file` comes before `gh issue close $PARENT_NUM --reason completed`, and `writeRecord(parentPath` comes before `closeRecord(parentPath)`;
    - it matches `/already `CLOSED`/`, `/Trusted authors/` and `/which call failed/`.
  - **Post-merge step:**
    - `pr-first-merge-post-merge.md` has `### Step 4.0b` between `### Step 4.0` and `### Step 4.1`;
    - its body names `closingIssuesReferences`, `**Close the parent below the floor**` and `merged`;
    - `close-out.md` step 7 and `merge-mode.md` step 3 each include `Step 4.0b`;
    - the gate's Self-inclusion table includes `Step 4.0b`.
  - **Demo claim:** `demo/SKILL.md` does not match `/nothing else in the system ever closes a parent/` and matches `/Close the parent below the floor/`.
  - **Go-red control:** read `git show 1ab4e17d9:plugin/skills/wrap-up/verification-brief-parent-gate.md` (`execFileSync`, guarded by try/catch as `tests/tidy-needs-worklist-rule.test.js` does) and assert its `exceeds: false` slice matches `/closes cleanly/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL (`## Close the parent below the floor` not found)

- [ ] **Step 3: Write the prose** in the five files above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/closing-links-prose-conformance.test.js tests/try-it-contract-conformance.test.js tests/comment-trust-conformance.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js tests/fetch-sub-issues-prose-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the six files: `Close below-floor decomposition parents after the merge lands — refs #4466`

---

### Task 3: Tidy's parent-gate backstop surfaces stranded below-floor parents

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, the `parent-gate` oversight pre-filter `node -e` block.
  - Filter to `due` first, then print one of two rows: the existing row when `exceeds`, or otherwise `'[parent-gate] #' + f.number + ': ' + f.title + ' — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)'`.
  - Prose before the block: below-floor due parents are now surfaced as the Close-row backstop, not filtered out.
  - The "Un-gated parents recommend…" paragraph: approving a below-floor row closes the parent through `wrap-up/verification-brief-parent-gate.md`'s **Close the parent below the floor**, with no `/claude-tweaks:demo` step.
- Modify: `plugin/skills/tidy/step-1-records.md`, Shape 7.
  - The prose "Both backstop shapes below (this one and Shape 8) filter out below-floor candidates" now applies to Shape 8 only.
  - The `node -e` block gets the same restructure, keeping `.filter((f) => !f.needsDefinition)` byte-identical (`tests/tidy-needs-worklist-rule.test.js` pins it), with the local row `f.path + '\t[parent-gate] ' + f.id + ': ' + f.title + ' — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)'`.
  - The `→ Collect each as:` line gets the below-floor form.
- Modify: `plugin/skills/tidy/actions-github-issues.md` and `plugin/skills/tidy/actions-local-files.md`, `## Open parent gate`: a re-verified `due` gate below the floor runs **Close the parent below the floor** instead of composing a brief. It stays staged.
- Modify: `plugin/skills/tidy/SKILL.md`, the Action Vocabulary `Open parent gate` row. "never closes the parent" becomes "closes the parent only below the oversight floor (no brief owed)".
- Modify: `plugin/skills/tidy/scan-procedures.md`. Add the below-floor collect line beside the line-268 one.
- Modify: `plugin/skills/tidy/step-6-auto.md`, the `| **Open parent gate** (` row. Add one clause: below the oversight floor the action closes the parent with a sub-issue-listing comment (`closeRecord` under `local-files`), staged for the same reasons. Stay within the byte cap.
- Test: `tests/below-floor-parent-close-conformance.test.js` (append).

**Interfaces:**
- Consumes: Task 2's `## Close the parent below the floor`.
- Produces: the two row texts above.

- [ ] **Step 1: Write the failing tests** (names prefixed `AC3:`).
  - **Extraction:** extract each scan's `node -e "…"` block with the `extractNodeScripts` regex from `tests/help-acceptance-queue-local-files.test.js`, substitute `${CLAUDE_PLUGIN_ROOT}` with the repo's `plugin` path, and run it with `execFileSync('node', ['-e', script, '--', 'high'])`.
  - **GitHub scan** (`$GATES` substituted with a temp JSON file), three due parents with every sub-issue `CLOSED` and no parent labels:
    - `risk:medium` sub-issues print the below-floor row;
    - `risk:high` prints the existing `Open parent gate, then /claude-tweaks:demo` row;
    - one sub-issue with no `risk:*` prints the above-floor row.
  - **Shape 7:** run in a temp cwd with a `specs/` store built through `local-store.js`'s `writeRecord`/`closeRecord`, with the same three cases.
  - **Prose pins:**
    - tidy `SKILL.md` does not include `never closes the parent`;
    - both action files include `Close the parent below the floor`;
    - the `step-6-auto.md` row includes `closeRecord`;
    - `wc -c` of `step-6-auto.md` is under 49400, and of `github-pr-scan-acceptance.md` at or below 47200.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL (the below-floor parent prints nothing)

- [ ] **Step 3: Edit the seven files** above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/tidy-needs-worklist-rule.test.js tests/comment-trust-conformance.test.js tests/sweep-backstop.test.js tests/help-acceptance-queue-local-files.test.js tests/acceptance-scan-server-filter.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the eight files: `Surface stranded below-floor parents in tidy's parent-gate backstop — refs #4466`

---

### Task 4: engine-verify names the post-merge close

**Role:** mechanical

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:909`: `skipped.push(\`parent #${target} below oversight floor\`)` becomes `` `parent #${target} below oversight floor — closes after the merge lands (Step 4.0b)` ``. Update the #3222 comment above `registerCheck('acceptance-labeling', …)` to match.
- Modify: `tests/bin-lib/wrap-up/engine-verify.test.js:1813` and `:1894`: the assertions become `/parent #898 below oversight floor — closes after the merge lands \(Step 4\.0b\)/`.
- Modify: `docs/journeys/verify-wrap-ups-closure-checklist-900.md`: add one `Updated for #4466` bullet after the line-86 `#3222` note, saying a below-floor parent's `acceptance-labeling` skip names the post-merge close (Step 4.0b).

- [ ] **Step 1: Edit the two test assertions** as above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern "below the oversight floor|invalid risk-floor" tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL (detail is still the bare `parent #898 below oversight floor`)

- [ ] **Step 3: Implement** the `engine-verify.js` string, the comment, and the journey bullet.

- [ ] **Step 4: Run the file**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the three files: `Name the post-merge parent close in the below-floor verify skip — refs #4466`
