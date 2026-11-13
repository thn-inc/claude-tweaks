# Settle 3 digest findings in flow (#4812) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the three below-floor `flow` findings promoted from digest #1426: two test gaps in `pr-early-open.js`'s rebind path, and one restatement in `flow/worktree-merge.md`.

**Architecture:** Tasks 1 and 2 add tests only, both in `tests/bin-lib/flow/pr-early-open.test.js`. They change no behavior: `rebind()` already wraps `writeBody()` in its degrade `try`, and the code and doc log strings already agree today. The tests make both facts fail loudly if they stop holding. Task 3 replaces one restating paragraph in `plugin/skills/flow/worktree-merge.md` with a pointer.

**Tech Stack:** Node 18+, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191928-record-4812/work/4812-spec.md` (materialized from GitHub issue #4812)

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix, ending `refs #4812` (never `closes`/`fixes`).
- Scope: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `prose-code-twin-pin` (`.claude/skills/prose-code-twin-pin/SKILL.md`), verbatim, for Task 2: "A test asserting each side's literals separately, never one against the other, is the citation-sweep shape the second row above rejects: a changed phase row or delimiter on either side leaves both suites green." and "The fix is one assertion: call the exported composer with the invocation's own placeholders (…), replace its `HH:MM:SS` with the prose's `{time}`, and `assert.strictEqual` the two."
- Governing skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), verbatim, for Task 2's go-red control: "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Reading live prose in Task 2 is legitimate: `_shared/pr-early-run-lifecycle.md`'s log templates are the declared contract that the MCP (gh-absent) path types by hand, so editing them on purpose is the intended response to a code change.
- No `plugin/bin/**` code changes. Neither finding is a code defect.
- `worktree-merge.md` is 17,592 B, far under `RAIL_BYTES` (52,500 B). Task 3 shrinks it.

## Review Focus

1. A rebind body-write failure on the **recorded** (Resume) reuse path, not only the listed-OPEN path. Both call `rebind(…, 'reused')`. Task 1 covers both.
2. The doc's SKIP templates wrap across lines with indentation. The extraction must collapse whitespace, or the comparison would silently match nothing. Task 2 asserts the exact template count (4) for that reason.
3. The `log-decision: ` infix and `- ` bullet that `formatEntry` adds but the doc templates omit. The normalization must strip exactly that and nothing else. Task 2's transform is a single anchored regex.
4. A doc template whose wording drifts while the code stays put, and the reverse. Task 2's control mutates the doc side; Task 2 Step 4 mutates the code side temporarily.
5. The `(see above)` back-reference in `worktree-merge.md`'s conflict branch (the `worktree-always` "Resolve now" paragraph). After Task 3 it must still land on a paragraph that names the gate and points to its canonical coverage list.

---

### Task 1: Pin that a reuse-path rebind body-write failure degrades

**Role:** integration

**Files:**
- Test: `tests/bin-lib/flow/pr-early-open.test.js`
- Waived `plugin/bin/lib/flow/pr-early-open.js`: read only. Step 3 edits it temporarily for the go-red probe and restores it with `git checkout -- plugin/bin/lib/flow/pr-early-open.js` in the same step. Nothing is committed to it.

**Interfaces:**
- Consumes: the file's existing `harness()`, `OPTS`, `RUN_ID`, `OTHER_RUN`, `bodyFor()`, `URL7`, `idx`, `isPush`, `openPrEarly`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the test.** Add it directly after the existing `'AC4.1: a failing gh pr edit on a reused PR logs the SKIP degrade…'` test:

```js
test('AC1.1: a reused-PR rebind whose body write fails its first-line check is a logged SKIP, never a stop, on either reuse path', async () => {
  const mismatchBody = (h) => {
    h.deps.writeBodyFile = (name, text) => {
      const p = path.join(h.bodyDir, name);
      fs.writeFileSync(p, text.replace(RUN_ID, '2026-01-01T000000-record-9'));
      return p;
    };
  };
  const listed = harness({ list: [{ number: 7, url: URL7, state: 'OPEN', body: bodyFor(OTHER_RUN) }] });
  mismatchBody(listed);
  assert.deepEqual(await openPrEarly(OPTS, listed.deps), { outcome: 'reused', number: 7, url: URL7 });
  const recorded = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'OPEN', url: URL7, body: bodyFor(OTHER_RUN) } });
  mismatchBody(recorded);
  assert.deepEqual(await openPrEarly(OPTS, recorded.deps), { outcome: 'reused', number: 9, url: URL7 });
  for (const [h, n] of [[listed, 7], [recorded, 9]]) {
    assert.equal(h.calls.find((c) => c[0] === 'gh' && c[2] === 'edit'), undefined, 'a refused body is never written to the PR');
    assert.ok(h.lines.some((l) => l.startsWith('- SKIP ') && l.includes(`rebind of reused PR #${n} failed (PR body first line is`)
      && l.includes(`until its body names run ${RUN_ID}`)), `SKIP line for #${n}`);
  }
  assert.deepEqual(listed.records, [{ number: 7, url: URL7 }]);
  assert.ok(listed.calls.findIndex((c) => c[0] === 'record') < listed.calls.findIndex(isPush), 'the listed path still records, then pushes');
});
```

- [ ] **Step 2: Run it.**

Run: `node --test --test-name-pattern="body write fails its first-line check" tests/bin-lib/flow/pr-early-open.test.js`
Expected: PASS. The code already degrades, and this test pins that.

- [ ] **Step 3: Prove it can go red.** In `rebind` in `plugin/bin/lib/flow/pr-early-open.js`, temporarily hoist the body write out of the `try`. Before the `try {`, add `const bodyPath = writeBody();` and use `bodyPath` in the `gh pr edit` argv. Re-run Step 2's command. Expected: FAIL (`openPrEarly` rejects with `/first line/`). Then restore the file with `git checkout -- plugin/bin/lib/flow/pr-early-open.js` and confirm `git status --porcelain plugin/bin` prints nothing. Quote the FAIL output in the report.

- [ ] **Step 4: Commit.**

```bash
git add tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Pin the reuse-path rebind body-write degrade — a first-line refusal on either reuse path logs SKIP, refs #4812"
```

---

### Task 2: Pin the rebind log strings, code against doc

**Role:** integration

**Files:**
- Test: `tests/bin-lib/flow/pr-early-open.test.js`
- Waived `plugin/skills/_shared/pr-early-run-lifecycle.md`: read only. Step 1's test reads its four rebind templates live.
- Waived `plugin/bin/lib/flow/pr-early-open.js`: read only. Step 4 edits it temporarily for the code-side go-red probe and restores it in the same step.

**Interfaces:**
- Consumes: the same harness helpers as Task 1. The `decisions` line shape for an adopted prior attempt is copied from the existing `'a failed rebind is a logged SKIP, never a stop'` test.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the test.** Add it after Task 1's test. These are the decisions it fixes:
  - Doc side. Read `plugin/skills/_shared/pr-early-run-lifecycle.md` and collapse `\s+` to one space. Extract every backticked span matching `/`((?:AUTO|SKIP) \{time\} — PR-early run lifecycle: (?:rebound|rebind of) (?:reused|reopened) PR [^`]*)`/g`. Exactly 4 are expected.
  - Code side. Collect the emitted rebind lines from four `openPrEarly` runs, every PR numbered 7:
    - reused, success: `list: [{ number: 7, url: URL7, state: 'OPEN', body: bodyFor(OTHER_RUN) }]`
    - reused, failure: the same, plus `edit: new Error('HTTP 422')`
    - reopened, success: `list: [{ number: 7, url: URL7, state: 'CLOSED' }]` with `decisions` = `- AUTO 10:00:00 — x: adopted prior attempt abc1234 from closed PR #7 for ${BRANCH}. Reversibility: high.\n`
    - reopened, failure: the same, plus `edit: new Error('HTTP 422')`
    
    From each run keep only the lines that include `rebound ` or `rebind of `.
  - Normalize each emitted line to template form with exactly these steps:
    1. `.replace(/^- (AUTO|SKIP) \d\d:\d\d:\d\d — log-decision: /, '$1 {time} — ')`
    2. `.split('#7').join('#{number}')`
    3. `.split(RUN_ID).join('{run-id}')`
    4. `.split('HTTP 422').join('{error}')`
  - Assertion helper `assertRebindTwins(docText, emitted)`. It extracts templates from `docText` and asserts `templates.length === 4`, message `'expected 4 rebind templates in pr-early-run-lifecycle.md'`. It then asserts `assert.deepEqual([...emitted].sort(), [...templates].sort(), 'rebind log lines drift between pr-early-open.js and pr-early-run-lifecycle.md')`.
  - Test name: `'AC1.1: the four rebind log lines pr-early-open.js writes equal pr-early-run-lifecycle.md\'s templates'`. It calls `assertRebindTwins(liveDoc, emitted)`.

- [ ] **Step 2: Add the go-red controls in the same test.** Each one is preceded by `assert.notEqual(mutated, liveDoc)`:
  - Reworded: `liveDoc.replace('phase-checklist updates will exit 4 until its body names run {run-id}. Reversibility: n/a.', 'phase-checklist updates will exit 4. Reversibility: n/a.')`. A non-global replace touches the first SKIP template only. Then `assert.throws(() => assertRebindTwins(mutated, emitted), { message: 'rebind log lines drift between pr-early-open.js and pr-early-run-lifecycle.md' })`. The doc wraps that phrase across a line break, so apply the replace to the whitespace-collapsed doc text, and pass collapsed text into the helper on both the live and the mutated calls. The helper's own collapse is idempotent.
  - Dropped: remove the first `AUTO {time} — PR-early run lifecycle: rebound reused PR #{number} to run {run-id}. Reversibility: high.` occurrence, then `assert.throws(…, { message: 'expected 4 rebind templates in pr-early-run-lifecycle.md' })`.

- [ ] **Step 3: Run it.**

Run: `node --test --test-name-pattern="four rebind log lines" tests/bin-lib/flow/pr-early-open.test.js`
Expected: PASS.

- [ ] **Step 4: Prove the code side can go red.** In `plugin/bin/lib/flow/pr-early-open.js`'s `rebind`, temporarily change `phase-checklist updates will exit 4` to `checklist updates will exit 4`. Re-run Step 3's command. Expected: FAIL with `rebind log lines drift`. Restore the file with `git checkout -- plugin/bin/lib/flow/pr-early-open.js` and confirm `git status --porcelain plugin/bin` prints nothing. Quote the FAIL output in the report.

- [ ] **Step 5: Run the whole file.**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js tests/dispatch-retry-prior-attempt-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit.**

```bash
git add tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Pin pr-early-open's rebind log lines against the lifecycle doc's templates — one comparison replaces two unrelated pins, refs #4812"
```

---

### Task 3: Stop worktree-merge.md restating the gate facts local-merge-sequence.md owns

**Role:** transcription

**Files:**
- Modify: `plugin/skills/flow/worktree-merge.md`. Replace the paragraph that starts `Two consequences for the sequence below, both stated in` (line 48), and only that paragraph.
- Waived `plugin/skills/_shared/local-merge-sequence.md`: read only in Step 1. Its "Why the order is load-bearing" section (lines 37-52) already states every gate fact the removed paragraph restated: `git merge` is not gated, `git push` and `git commit` are denied from the main checkout under `worktree-always`, and the push runs from a linked worktree as its own Bash call. Nothing needs adding there. If Step 1 finds one of those facts missing after all, add it to that section instead of keeping it in `worktree-merge.md`.

- [ ] **Step 1: Confirm the canonical home.** Run `grep -n -F 'never `git merge`' plugin/skills/_shared/local-merge-sequence.md` and `grep -n -F 'the push from' plugin/skills/_shared/local-merge-sequence.md`. Expected: one hit each, inside lines 44-52.

- [ ] **Step 2: Replace the paragraph.** The new paragraph, verbatim:

```markdown
What that gate means for the merge, the push and the commits in the sequence below is `_shared/local-merge-sequence.md`'s to state ("Why the order is load-bearing"); this file does not restate that either. The one consequence it routes on itself is a merge **conflict**: under `worktree-always`, a conflict cannot be resolved in the main checkout — see the conflict branch of the Merge Procedure below and `_shared/git-discipline.md`.
```

- [ ] **Step 3: Check that nothing pinned the old text.** Run `grep -rn -F 'Two consequences for the sequence below' tests plugin`. Expected: no output. Control: `git show HEAD:plugin/skills/flow/worktree-merge.md | grep -c -F 'Two consequences for the sequence below'` prints `1` on the pre-change commit. Then run `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/pr-first-merge.test.js tests/merge-subject-composer-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/below-floor-parent-close-conformance.test.js`. Expected: PASS, 0 failures.

- [ ] **Step 4: Commit.**

```bash
git add plugin/skills/flow/worktree-merge.md
git commit -m "Point worktree-merge.md at local-merge-sequence.md for the gate facts — drop the restatement its own line 46 disclaims, refs #4812"
```

---

## Acceptance criteria map

| Clause | Covered by |
|---|---|
| AC1.1 "Each deliverable is fixed, or closed out with its reason recorded on this record." | Deliverable 1: Task 1. Deliverable 2: Task 2. Deliverable 3: Task 3. All three are fixed, so none needs a closed-out reason. |
| AC2.1 "Each promoted entry line in #1426 carries this record's ref." | Already satisfied, observed live before planning. The three matching entry lines in #1426's comments each end `→ #4812`. Evidence: the controller's `decisions.md` `AC evidence` entry and `evidence/ac2-digest-refs.txt` in the run dir. No task. |

## Self-review

- **Spec coverage:** every Deliverable maps to one task, and both AC clauses are mapped above.
- **Placeholders:** none.
- **Proportion:** three small tasks for three findings. The code blocks are the tests and the replacement prose, which the spec's exact wording fixes.
