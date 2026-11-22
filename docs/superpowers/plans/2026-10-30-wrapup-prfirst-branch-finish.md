# Wrap-up pr-first Branch Finish After the Last Tree Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `integration-model: pr-first`, run wrap-up's one branch finish (merge or leave-open) after the execution step's last tree-changing action, commit and phase-exit push, and before cleanup item 4's worktree removal — instead of at the Review Console's "On approval" step 13.

**Architecture:** Skill-prose change only. `review-console.md` step 13 keeps cleanup item 2 (ledger delete + commit) and loses its push and merge. `execution-and-verification.md` gains a `pr-first` ordering paragraph that splits the cleanup list around a new **Branch finish** paragraph (items 1/3/5 → apply list → commit → phase-exit push → Branch finish → items 4/6/7/8 → leave-open re-check → Verify execution). Console-applied apply-list entries become confirm-only under `pr-first`. `/flow`'s multi-spec Shared teardown step 0 gains the design-cache delete (item 3), which today no step performs. Conformance tests pin the order.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites reading prose via `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000501-record-3813/work/3813-spec.md` (re-materialized for the resumed run; the earlier attempt's copy is `.claude-tweaks/pipelines/2026-10-30T152231-record-3813/work/3813-spec.md`)

**Scope keywords:** step 13, pr-first-merge.md, Branch finish

## Global Constraints

- `local-merge` and `current-branch` behavior is unchanged: their cleanup pass, apply list, commit and phase exit keep today's order.
- One finish point on every path: reached when the execution step reports "No actions to execute" and when the console took the empty-console fast path; never zero, never two (the auto-merge short-circuit, which merges itself and bypasses the execution step, and `MULTISPEC_REVIEW_DEFER=1`, whose parent finishes, skip it).
- Item 2's delete-ledger keeps "after the ledger's last writers (console steps 7 and 11), before the merge".
- Item 8 (run-dir archival) stays last of the cleanup items; items 4, 6, 7 read `$RUN_DIR`.
- The leave-open re-check keeps reusing `phase-exit.js`'s `mergeState` (one read); its existing test pins (`tests/wrap-up-leave-open-mergeability-conformance.test.js`) stay green, including the line-break-sensitive `'take one read\nof its own, as the last call'` and `' — or never printed\none: '` substrings.
- `plugin/skills/flow/multispec-review-console.md` is 51235 bytes against `RAIL_BYTES` 52500 (`plugin/bin/lib/skill-audit/budgets.js`); Task 3's addition must stay under ~600 bytes net.
- Skill references in actionable text use `/claude-tweaks:{skill}`; commit subjects `{Verb} {what} — {detail}` with `refs #3813`.

## Review Focus

- Override at the console (not Approve all): before this change no merge ran under `pr-first`; the Branch finish must keep it that way (merge only on "Approve all + merge" / `merge.resolution: merge`). Pinned in Task 1's test.
- A phase-exit push that did not land (`push.state` not `pushed`) must skip the merge, never merge a head lacking the execution commit. Pinned in Task 1's test.
- Empty-console fast path with a worktree: no merge decision exists, so the finish resolves leave-open. Pinned in Task 1's test.
- The auto-merge short-circuit path must not reach a second finish. Pinned in Task 1's test (Branch finish names it as a skip).
- Multi-spec: design caches deleted before the shared merge, in the same commit/push as the ledger, even when the ledger delete reported something other than `deleted`. Pinned in Task 3's test.

## Ordering-fix location check (plan-authoring-checks.md)

The merge (`_shared/pr-first-merge.md`, `gh pr merge`) executes today at `review-console.md` "On approval" step 13. After this change it executes at `execution-and-verification.md`'s Branch finish. Readers/writers between the new tree-changing actions and the merge: the apply-list edits (Reference repairs, Genre convention resolution, unblocked `[doc]` rows), cleanup items 1/3/5, the execution commit, `phase-exit.js --phase wrap-up` (needs the un-archived run dir — item 8 now runs after it), and `pr-first-merge.md` Step 1 acceptance labeling (idempotent; the execution step's Acceptance labeling bullet now lands first). After the merge: items 4 (Section C reads the merge outcome and the `pr` stamp), 6, 7 (release reason from the outcome), 8, the leave-open re-check (archive-aware already), Verify execution. Sibling site stating the same rule: `flow/multispec-review-console.md` Shared teardown (step 0 tree writes and push → step 2 merge → step 6 worktree removal) — matched by Task 3.

## Waivers

Waived AC3.1: after half only (record Decision Q1, Reading B). The "before" evidence is gathered at build time and quoted in the PR body (Task 6). The "after" check needs a released build carrying this change; it is carried by the follow-up measurement record #4644 (filed by this record's earlier attempt; Task 6 corrects its stale version bound rather than filing a duplicate). This record closes when its PR merges.
Waived _shared/pr-first-merge.md: read only — its procedure moves call site, its text is unchanged.

## Resume amendment (2026-11-16, run 2026-11-16T000501-record-3813)

Tasks 1-4 landed in the earlier attempt (528c06c2d, 480a77ac7, 265dd8b28, 9cc6c0334) and were carried through the main catch-up merge 6dce842fe. The record body has since gained two plan-review Decisions; Tasks 5 and 6 implement them. Tasks 1-4 are not re-run.

---

### Task 5: Reword the auto-merge short-circuit's item-2 note (record Decision Q2, Reading B)

**Files:**
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (the `**Ledger deletion (\`cleanup-procedures.md\` item 2) — before the merge (#939).**` paragraph's second sentence, lines ~140-142)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (canonical table row 2's Procedure cell: "and, under `pr-first`, push before the merge" — step 13 pushes nothing since Task 1)
- Test: `tests/wrap-up-branch-finish-after-execution.test.js` (add two pins + their go-red controls)

- [ ] **Step 1: Write the failing test (covers Deliverable 4 as decided)** — add `assertShortCircuitItem2Placement(text)` that, on the whitespace-normalized `wrap-up/auto-merge-short-circuit.md`, takes the `**Ledger deletion (` paragraph and asserts it (a) no longer contains `which is where item 2 (Open items ledger) normally runs`, (b) names `review-console.md` "On approval" step 13 (the Ledger close-out) as where item 2 runs under `pr-first` in `worktree` mode, and (c) names Phase 4's execution step as where item 2 runs otherwise (`local-merge`, and `current-branch` mode — matching `execution-and-verification.md`'s ordering paragraph: "Under `local-merge`, and in `current-branch` mode, the cleanup pass runs whole, here"). Also add `assertItem2RowPush(text)` on `wrap-up/cleanup-procedures.md`'s table row 2 (the line starting `| 2 | Open items ledger |`): it no longer contains `under \`pr-first\`, push before the merge`, and names the execution step's phase-exit push as what carries the commit before the Branch finish. Live text passes; go-red controls: re-inserting each old phrase throws.
- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/wrap-up-branch-finish-after-execution.test.js`
Expected: FAIL after Step 1 (old "normally runs" sentence still present)

- [ ] **Step 3: Edit the two notes** — e.g. "This branch bypasses both places item 2 (Open items ledger) normally runs — `review-console.md`'s "On approval" step 13 (Ledger close-out) under `pr-first` in `worktree` mode, Phase 4's execution step otherwise (`local-merge`, `current-branch` mode) — so re-implement it here, ...", and row 2's "and, under `pr-first`, push before the merge" → "and, under `pr-first`, let the execution step's phase-exit push carry it before the Branch finish". Keep the rest of each paragraph/row byte-identical. Run `grep -rn "normally runs" tests/` first and keep any existing pin on this paragraph green.
- [ ] **Step 4: Run** `node --test tests/wrap-up-branch-finish-after-execution.test.js tests/wrap-up-ledger-delete-before-merge.test.js` and any test file that greps `auto-merge-short-circuit.md` (`git grep -l "auto-merge-short-circuit" tests/`) — Expected: PASS
- [ ] **Step 5: Commit** — `Name both item-2 placements in the auto-merge short-circuit note — refs #3813`

### Task 6: AC3 evidence (record Decision Q1, Reading B) — orchestrator-run, no code

No repository file changes; run by the orchestrating session, not an implementer subagent (forge writes only).

- [ ] **Step 1:** Gather the "before" evidence: one real pre-fix `pr-first` single-record run (2026-10-20 or later) whose console merged the PR and whose Phase 4 execution step then committed or pushed on the merged branch — quote the PR's commit list (`gh pr view {N} --json commits,mergeCommit`) and the post-merge commit. If no qualifying run exists, say so in the PR body with the closest candidates; the decision rule's parked measurement record then carries both halves.
- [ ] **Step 2:** Correct #4644's version bound ("6.158.0 or later" is wrong — 6.170.0 does not carry this fix): name "the first release whose changelog includes PR #4641" instead, in its Deliverables and Gotchas. When Step 1 found no qualifying run, also add the before check to #4644's Deliverables (a pre-fix `pr-first` run's PR commit list showing a commit after the merge), quoting the closest candidate Step 1 found.
- [ ] **Step 3:** Record both in the PR body's notes (`### Decisions taken`), naming #4644 as the after-check record.

---

### Task 1: Move the pr-first branch finish into the execution step

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md` (step 6 sentence; step 13; Auto-resolution paragraph's "merge half" sentence; Empty-console fast path)
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (new ordering paragraph after line 7; new Branch finish paragraph between Phase exit and Leave-open re-check; leave-open clause "— item 8 runs before this step's commit and push —")
- Modify: `plugin/skills/wrap-up/SKILL.md` ("Execute approved actions" No-actions skip)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (row 4 Procedure ref; Item 2 paragraph; new "split around the branch finish" sentence)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 3, keep the FYI line text)
- Modify: `plugin/skills/wrap-up/merge-mode.md` (step 1's "exactly as `review-console.md` step 13 does")
- Modify: `tests/wrap-up-ledger-delete-before-merge.test.js`
- Create: `tests/wrap-up-branch-finish-after-execution.test.js`

**Interfaces:**
- Produces: the paragraph heading `**Branch finish (\`worktree\` mode, \`integration-model: pr-first\`, #3813).**` in `execution-and-verification.md`; the ordering paragraph heading `**\`integration-model: pr-first\` in \`worktree\` mode — one finish point after the last tree writer (#3813).**`. Task 2 and Task 4 cite "the execution step's Branch finish".

- [ ] **Step 1: Write the failing test (covers AC1.1, AC1.2, AC4.1)** `tests/wrap-up-branch-finish-after-execution.test.js` with an exported-in-file `assertFinishAfterLastWriter(execText, consoleText)` that:
  - finds the ordering paragraph and asserts it names, in this order: `items 1, 3 and 5`, `apply list`, `commit`, `phase-exit push`, `Branch finish`, `items 4, 6, 7 and 8`;
  - asserts file order: the Reference repairs bullet, the Genre convention resolution bullet, `Commit with a message summarizing the wrap-up actions`, the `**Phase exit` paragraph, the Branch finish paragraph, the `**Leave-open mergeability re-check` paragraph, `### Verify execution`;
  - asserts the Branch finish paragraph contains `runs \`_shared/pr-first-merge.md\`'s procedure`, `push.state`, `never merge a remote head that lacks`, `MULTISPEC_REVIEW_DEFER=1`, `auto-merge short-circuit`, `Override`, `empty-console fast path`, and `items 4, 6, 7 and 8`;
  - asserts `review-console.md`'s On approval step 13 (between `13. **` and `14. `) does not contain `pr-first-merge.md` or `push the branch`, and still contains `delete-ledger`;
  - tests: live text passes; go-red controls — (a) the pre-fix review-console step 13 (merge text re-inserted) fails, (b) moving the Branch finish paragraph ahead of the Commit sentence fails, (c) dropping `push.state` fails.
  Also a test that `SKILL.md`'s Execute approved actions paragraph contains `still read the file for its Branch finish`, and that `cleanup-procedures-execution.md` Section C step 3 names `execution-and-verification.md`'s Branch finish and no longer contains `"On approval" step 13 ran`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/wrap-up-branch-finish-after-execution.test.js`
Expected: FAIL (ordering paragraph not found)

- [ ] **Step 3: Edit the prose** per the Files list and Architecture: step 13 becomes `**Ledger close-out (\`pr-first\`, #3595, #3813).**` (item 2 delete + commit only, ends naming the execution step's Branch finish as the push and merge point); step 14 text unchanged; Branch finish routes merge only on "Approve all + merge" / `console.json` `merge.resolution` `merge` and only when `phase-exit.js` printed `push.state` `pushed`, otherwise lands on `pending-review` with one `SKIP` line; composed `merge` bundle command moves verbatim from step 13.

- [ ] **Step 4: Update `tests/wrap-up-ledger-delete-before-merge.test.js`** — step 13 now carries delete-ledger and commit, no push and no merge; the merge mark moves to `execution-and-verification.md`'s Branch finish, after its commit. Go-red controls retarget the same marks.

- [ ] **Step 5: Run both tests and the neighbors**

Run: `node --test tests/wrap-up-branch-finish-after-execution.test.js tests/wrap-up-ledger-delete-before-merge.test.js tests/wrap-up-leave-open-mergeability-conformance.test.js tests/wrap-up-phase4-report-order-conformance.test.js tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit** — `Move wrap-up's pr-first branch finish after the execution step's commit — refs #3813`

### Task 2: Console-applied apply-list entries confirm-only under pr-first

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (bullets Documentation, CLAUDE.md/rules, New docs, Docs-health restructural filings, Decision records, Skill updates)
- Test: `tests/wrap-up-branch-finish-after-execution.test.js` (add tests)

- [ ] **Step 1: Write the failing test (covers AC2.1)** — for each of the six bullet prefixes (`- **Documentation**`, `- **CLAUDE.md, rules**`, `- **New docs from missing-doc detection**`, `- **Docs-health restructural filings**`, `- **Decision records (ADRs)**`, `- **Skill updates**`) the bullet text contains `**\`pr-first\`: confirm-only**`; Reference repairs and Genre convention resolution bullets do not. Go-red: stripping the marker from one bullet fails.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-branch-finish-after-execution.test.js`
Expected: FAIL (confirm-only marker missing)

- [ ] **Step 3: Append the marker sentence** to each of the six bullets naming the console step that applied it (2 skills, 3 docs/D1/D2, 5 CLAUDE.md/rules/ADRs); New docs keeps applying a `[doc]` row the console left for an unanswered convention row.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `Make console-applied wrap-up entries confirm-only under pr-first — refs #3813`

### Task 3: Multi-spec Shared teardown deletes design caches before the merge

**Files:**
- Modify: `plugin/skills/flow/multispec-review-console.md` (Shared teardown step 0)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (deferred-list bullet for item 3)
- Test: `tests/wrap-up-branch-finish-after-execution.test.js` (add tests)

- [ ] **Step 1: Write the failing test** — Shared teardown step 0 contains `Section A` and `item 3`, positioned before `2. **Finish the shared branch.**`; the commit/push sentence covers the caches when the ledger was not deleted; `cleanup-procedures.md`'s item 3 deferred bullet names `Shared teardown step 0`. File stays under `RAIL_BYTES`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-branch-finish-after-execution.test.js`
Expected: FAIL (Shared teardown step 0 lacks Section A)

- [ ] **Step 3: Edit** step 0 (one or two sentences) and the bullet.
- [ ] **Step 4: Run** `node --test tests/wrap-up-branch-finish-after-execution.test.js tests/multispec-ledger-deletion-order.test.js` — Expected: PASS
- [ ] **Step 5: Commit** — `Delete multi-spec design caches before the shared merge — refs #3813`

### Task 4: Sync docs and the appendix

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (Reference repairs row: applied by the execution step "before its Branch finish")
- Modify: `docs/skill-graph.md` line 433 (ledger edge: committed at step 13, pushed by the execution step's phase-exit push ahead of its Branch finish)
- Modify: `docs/journeys/close-out-only-this-runs-ledger-3566.md` step 5 + Origin line

- [ ] **Step 1: Edit** the three files.
- [ ] **Step 2: Run the full test suite to verify (covers AC5.1)**

Run: `npm test`
Expected: PASS (`ℹ fail 0`)
- [ ] **Step 3: Commit** — `Sync wrap-up branch-finish docs — refs #3813`
