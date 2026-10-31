# closing-links.js post-merge closing set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `closing-links.js --mode post-merge` prints the merge's same-repo closing set (minus what Step 4.0 handled) as `closingSet`, and `_shared/pr-first-merge-post-merge.md` Step 4.0b reads it instead of a hand-written `gh pr view … --jq`.

**Architecture:** The post-merge branch of `plugin/bin/closing-links.js` already holds `linked` (`sameRepoNumbers(pr.closingIssuesReferences, scope)`), `reopened`, `pendingClose` and `failed`. One derived array goes onto the four exit-0 post-merge envelopes. Step 4.0b's prose then names that field as `$CLOSING_SUB_ISSUES` after a PR merge and skips when it is absent; the no-PR local-merge path (`git log -1 --format=%B`) is unchanged.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T030421-record-4597/work/4597-spec.md` (record #4597)

## Global Constraints

- The new field is named `closingSet`; it is a sorted array of positive integers: `linked` minus every number in `reopened`, `pendingClose`, and each `failed[]` entry's `issue`.
- `closingSet` appears only on the four exit-0 post-merge actions (`reopen-failed`, `close-pending`, `reopened`, `nothing-closed`) — never on `not-merged`, `no-fixes-span`, `no-pr`, `gh-absent`, or pre-merge envelopes.
- After the change, `grep -F "closingIssuesReferences" plugin/skills/_shared/pr-first-merge-post-merge.md` matches nothing inside Step 4.0b. At base it matches lines 44 and 75, both inside Step 4.0b (absence-grep control, run at authoring time) — so line 44's prose mention must be reworded too, not only the jq fence.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #4597` (never `closes`/`fixes`).
- Scope discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `skill-prose-conformance-tests` (verbatim): "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."

## Review Focus

- A cross-repo `Fixes other/repo#N` whose N collides with nothing same-repo must not appear in `closingSet` (Task 1 test AC2.1).
- A `failed[]` record is an object `{issue, error[, stage]}` — the subtraction must use `.issue`, not the object (Task 1 failed-record test).
- A linked record already closed before the merge (`closedBefore`) stays in `closingSet` — over-subtraction would hold its parent open (Task 1 closedBefore test).
- An envelope without the field (`no-fixes-span`) must not carry an empty `closingSet: []`, which Step 4.0b would read as "nothing closed" instead of "skip" (Task 1 absence test).
- Step 4.0b must still read the no-PR local-merge path from `git log -1 --format=%B` (Task 2 keeps that literal pinned).

---

### Task 1: `closingSet` on the post-merge envelope

**Role:** integration

**Files:**
- Modify: `plugin/bin/closing-links.js` (header comment lines 24-38; post-merge `done({...})` at ~376)
- Modify: `docs/plugin-structure.md` (the `node plugin/bin/closing-links.js` line, ~186: the post-merge envelope field list)
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`
- Waived `plugin/bin/lib/flow/closing-links.js`: read only — `sameRepoNumbers` already produces `linked`; no change.

**Interfaces:**
- Produces: post-merge stdout JSON gains `closingSet: number[]` on the four exit-0 actions. Task 2's prose names it `closingSet[]`.

- [ ] **Step 1: Write the failing tests** (append after the existing post-merge tests, reusing `fixture`, `makeDeps`, `mergedView`, `body`, `sameRepoRef`, `PR_URL`, `MERGED_AT`, `CLOSED_AFTER`, `CLOSED_BEFORE`, `POST`)

```js
test('AC2.1: post-merge closingSet drops a cross-repo reference and a reopened record', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const crossRepo = { number: 4000, repository: { name: 'repo', owner: { login: 'other' } } };
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [], { closingIssuesReferences: [crossRepo, sameRepoRef(2724), sameRepoRef(3997)] })],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.closingSet, [3997]);
});

test('post-merge closingSet drops pendingClose and failed records', () => {
  const span = ['Fixes #3997', 'Refs #2724 — deferred: a', 'Refs #2725 — deferred: b'];
  const a = fixture({ pr: { number: 7 } });
  const pending = makeDeps(a.main, {
    prReads: [mergedView(body({ span }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }], 2725: [{ state: 'OPEN', closedAt: null }] },
  });
  assert.equal(run(['--run', a.runDir, ...POST, '--settle-ms', '0'], pending.deps), 0);
  assert.deepEqual(pending.json().pendingClose, [2725]);
  assert.deepEqual(pending.json().closingSet, [2724, 3997]);

  const b = fixture({ pr: { number: 7 } });
  const failed = makeDeps(b.main, {
    prReads: [mergedView(body({ span }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
    issueThrows: { 2725: true },
  });
  assert.equal(run(['--run', b.runDir, ...POST, '--settle-ms', '0'], failed.deps), 0);
  assert.deepEqual(failed.json().failed.map((f) => f.issue), [2725]);
  assert.deepEqual(failed.json().closingSet, [2724, 3997]);
});

test('post-merge closingSet keeps a linked record closed before the merge', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.closedBefore, [2724]);
  assert.deepEqual(j.closingSet, [2724, 3997]);
});

test('post-merge no-fixes-span carries no closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const noSpan = '<!-- claude-tweaks-run: 2026-10-25T000001-record-4199 -->\nNo span.\n';
  const h = makeDeps(main, { prReads: [mergedView(noSpan, [3997])] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  assert.deepEqual(h.json(), { action: 'no-fixes-span', pr: 7 });
});
```

Guard discrimination: deleting the `reopened` subtraction reds the AC2.1 test; deleting `pendingClose` or `failed` reds the respective half of the second test; subtracting `closedBefore` reds the third. (The fourth already passes at base — it pins the absence, not new behavior.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js`
Expected: FAIL — the three `closingSet` assertions get `undefined`.

- [ ] **Step 3: Implement** in `plugin/bin/closing-links.js`'s post-merge tail, before `return done({...})`: build a `Set` of `reopened`, `pendingClose` and `failed.map((f) => f.issue)`, set `closingSet = linked.filter((x) => !handled.has(x))` (`linked` is already sorted and unique), and add `closingSet` to the `done({...})` envelope after `closedBefore`. Update the header comment's post-merge "Prints {…}" list to include `closingSet` with one sentence: the same-repo closing records minus reopened, failed and pendingClose — Step 4.0b's `$CLOSING_SUB_ISSUES` (`skills/_shared/pr-first-merge-post-merge.md`). In `docs/plugin-structure.md`'s `closing-links.js` line, change the post-merge envelope to `{action, pr, candidates, willClose, reopened, failed, stillOpen, pendingClose, closedBefore, closingSet}` and add after it: `(`closingSet`: the same-repo closing records minus reopened, pendingClose and failed — `_shared/pr-first-merge-post-merge.md` Step 4.0b's `$CLOSING_SUB_ISSUES`)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/bin-lib/flow/closing-links.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/closing-links.js docs/plugin-structure.md tests/bin-lib/flow/closing-links-cli.test.js
git commit -m "Emit closingSet from closing-links.js post-merge — same-repo closing records minus reopened, failed and pendingClose, refs #4597"
```

### Task 2: Step 4.0b reads `closingSet[]`

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (Step 4.0b, lines ~41-86; 16,994 B now, rail 52,500 B — headroom ample, the edit shrinks the file)
- Modify: `tests/below-floor-parent-close-conformance.test.js` (tests at ~225 and ~313 pin the old read)
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md` (line 43 names `closingIssuesReferences` as Step 4.0b's read)
- No-change (classified): `plugin/skills/wrap-up/verification-brief-parent-gate.md` line 66 "or the whole step, when the call reads Step 4.0b's own input" — reworded in the final-review fix wave to "when the call is Step 4.0b's default-branch check" (the default-branch `gh repo view` gate is the only whole-step `gh` call left); line 219's table row "the merge's closing records" is unchanged wording.

**Interfaces:**
- Consumes: Task 1's `closingSet: number[]` on Step 4.0's exit-0 post-merge output.

- [ ] **Step 1: Update the conformance tests**

In the test at ~225 (`reads the merge's closing records`), remove `'closingIssuesReferences'` and `'gh pr view {pr-number} --repo {owner}/{repo} --json closingIssuesReferences'` from the literal list and add `'`closingSet[]`'`. In the test at ~313, replace the jq-pin `assert.ok(raw.includes(`--jq '[…]'`))` and the `'the unfiltered number read is gone'` assertion with:

```js
// The pre-change read (#4466) that #4597 replaced with Step 4.0's closingSet[].
const PRE_CHANGE_STEP_40B_READ = `  Otherwise, after a PR merge, read the PR's same-repo closing records. Like \`sameRepoNumbers\`
  (\`bin/lib/flow/closing-links.js\`), the filter drops a reference to another repository, whose
  \`Fixes other/repo#N\` would otherwise read as this repo's #N:

  \`\`\`bash
  gh pr view {pr-number} --repo {owner}/{repo} --json closingIssuesReferences --jq '[.closingIssuesReferences[] | select((.repository.owner.login // "" | ascii_downcase) == ("{owner}" | ascii_downcase) and (.repository.name // "" | ascii_downcase) == ("{repo}" | ascii_downcase)) | .number]'
  \`\`\`
`;
const CLOSING_SET_READ = "After a PR merge, the set is Step 4.0's `closingSet[]`, which only an exit-0 `post-merge` action carries (`reopen-failed`, `close-pending`, `reopened` or `nothing-closed`)";
assert.ok(!raw.includes('closingIssuesReferences'), 'AC1.1: Step 4.0b no longer reads closingIssuesReferences itself');
assert.ok(PRE_CHANGE_STEP_40B_READ.includes('closingIssuesReferences'), 'AC1.1 go-red: the pre-change read carries the literal');
assert.ok(body.includes(CLOSING_SET_READ), 'Step 4.0b reads closingSet[] from Step 4.0');
assert.ok(!collapse(PRE_CHANGE_STEP_40B_READ).includes(CLOSING_SET_READ), 'go-red: the pre-change read never names closingSet[]');
assert.ok(body.includes('When `closingSet[]` is absent'), 'Step 4.0b skips when the field is absent');
```

Change the existing `'which only an exit-0 `post-merge` action carries (…)'` assertion's literal to stay a substring of `CLOSING_SET_READ` (it already is — keep it), and keep `'skip this step entirely, never subtracting nothing, and log it'` and `'--status SKIP --step "pr-first-merge Step 4.0b (skipped)"'`. Keep `'git log -1 --format=%B'` in the ~225 list.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL — `AC1.1: Step 4.0b no longer reads closingIssuesReferences itself`.

- [ ] **Step 3: Rewrite Step 4.0b's prose** in `plugin/skills/_shared/pr-first-merge-post-merge.md`:

1. Line ~43-44: `GitHub closes \`Fixes #N\` records and \`closingIssuesReferences\` only on the default branch` → `GitHub closes \`Fixes #N\` records and a PR's other closing links only on the default branch`.
2. In the `$CLOSING_SUB_ISSUES` bullet, keep its first four sentences (through `it waits on the hand reopen.`) verbatim. Replace from `After a PR merge, the subtraction needs those lists, …` through the end of the `gh pr view … --jq` fence with:

```markdown
  After a PR merge, the set is Step 4.0's `closingSet[]`, which only an exit-0 `post-merge` action
  carries (`reopen-failed`, `close-pending`, `reopened` or `nothing-closed`): the PR's same-repo
  closing records (`sameRepoNumbers`, `bin/lib/flow/closing-links.js`, which drops a
  `Fixes other/repo#N` that would otherwise read as this repo's #N) minus those three lists, already
  subtracted. When `closingSet[]` is absent — a non-zero exit, `not-merged`, `no-fixes-span`,
  `no-pr`, `gh-absent`, or no parseable output — skip this step entirely, never subtracting nothing,
  and log it (after exit 3, name it in the closing summary instead); tidy's `parent-gate` backstop
  recovers those parents:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --step "pr-first-merge Step 4.0b (skipped)" --reversibility n/a --text "condition: Step 4.0 returned {result}, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them"
  ```

  Otherwise, after a PR merge, use `closingSet[]` as printed; never re-read the PR's links here.
```

The local-merge paragraph (`After a no-PR local merge, read the \`Fixes #{n}\` lines …` and its `git log -1 --format=%B {merge-sha}` fence) and everything after it stay unchanged.

3. In `docs/journeys/close-a-below-floor-decomposition-parent-4466.md` line 43, replace `the PR's \`closingIssuesReferences\`` with `Step 4.0's \`closing-links.js --mode post-merge\` \`closingSet\``.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: PASS, 0 failures. Then `grep -n -F "closingIssuesReferences" plugin/skills/_shared/pr-first-merge-post-merge.md` prints nothing (exit 1).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge-post-merge.md tests/below-floor-parent-close-conformance.test.js docs/journeys/close-a-below-floor-decomposition-parent-4466.md
git commit -m "Read Step 4.0b's closing set from closing-links.js post-merge — drop the hand-written closingIssuesReferences jq, refs #4597"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (new JSON field + unit tests) | Task 1 |
| Deliverable 2 (Step 4.0b reads it, skips when absent) | Task 2 |
| AC1.1 (grep no longer matches in Step 4.0b) | Task 2 Step 1/4 |
| AC2.1 (cross-repo and reopened both missing) | Task 1 Step 1 |
