# Release Reviewed-Tip Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:release` (pr-first) never merges its release PR when `origin/{branch}` has moved since the tip Step 3 reviewed. It reviews the delta first, or holds the release.

**Architecture:** Step 3's review marker line always records the reviewed tip sha. Immediately before the merge, `execute.md` fetches and compares `origin/{branch}` against the last recorded `reviewed tip`. On a move it:
1. brings `$RUN_ROOT` to the new tip;
2. runs a delta review `/claude-tweaks:review base:{reviewed-tip}` under Step 3's classification and the existing `review: blocking` gate;
3. returns to the PR-check gate.

A move count above the new `release-tip-moves` policy value (default 2) stops the run `HELD`.

**Tech Stack:** Markdown skill prose, `plugin/bin/lib/policy-schema.js`, and `node --test` conformance suites using the extract-and-run fixture form.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T103516-spec-3898-4012-4041/spec-4041/work/4041-spec.md`

Scope keywords: reviewed tip, release-tip-moves, integration branch kept moving

## Global Constraints

- pr-first only. local-merge's `release-local.js` tags the reviewed local tree, and its push is ancestry-checked, so a moved origin is refused rather than shipped unreviewed (logged at build).
- `--dry-run` merges nothing and runs no comparison.
- The bound is a policy value. The key is `release-tip-moves`, type `integer`, default `2`, category `merge-safety`, tier `advanced`.
- The HELD reason is the literal `integration branch kept moving`.
- Step 5 cites the recorded sha and never re-derives it from git.
- Do not break `tests/release-review-tree-check-conformance.test.js`. The marker line's optional `{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}` clause stays byte-identical.
- Byte budget: SKILL.md is 47,783 B and execute.md 36,515 B, against RAIL_BYTES 52,500. Keep SKILL.md under 49,500 B, which leaves headroom for siblings.

## Review Focus

1. **The `--as` path pushes its own `Release-As:` commit, which moves `origin/{branch}`.** Without a rule, every `--as` run would see a move. Rule: once the push lands, advance the reviewed tip to that commit, but only when its parent (`{sha}^`) is the current reviewed tip. Pinned in Task 2's prose facts.
2. **A fetch failure at comparison time must not read as "moved" or "unmoved".** The fence reports git's stderr, and the outcome is `failed`. Pinned in Task 2's fixture row.
3. **No `reviewed tip` line exists**, for example in a run dir from an older build. Do not merge: the outcome is `failed`, reason `no reviewed tip recorded`. Pinned as a prose fact.
4. **The release PR re-renders after main moves.** After a clean delta review, re-enter at the PR-check gate, never directly at the merge. Pinned as a prose fact.
5. **Move counting must survive context compaction.** Count the `Step 5: origin/{branch} moved` lines in this run's `decisions.md`; never rely on an in-memory counter. Pinned as a prose fact.

---

### Task 1: `release-tip-moves` policy key

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (after the `release-train` row, line 228)
- Modify: `plugin/skills/_shared/policy-schema.md` (after the `release-train` row, line 229)
- Create: `tests/release-reviewed-tip-conformance.test.js`

**Interfaces:**
- Produces: policy key `release-tip-moves`, read in Task 2 with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "{run-dir}" --values release-tip-moves`.

- [ ] **Step 1: Write the failing test.** Create the suite with the header comment `// tests/release-reviewed-tip-conformance.test.js — pins #4041: …` (match the sibling suite's style), then add:

```js
test('release-tip-moves is an advanced merge-safety integer defaulting to 2', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'release-tip-moves');
  assert.ok(row, 'release-tip-moves missing from POLICY_KEYS');
  assert.equal(row.type, 'integer');
  assert.equal(row.default, 2);
  assert.equal(row.category, 'merge-safety');
  assert.equal(row.tier, 'advanced');
});
```

- [ ] **Step 2: Run it to verify it fails.**
Run: `node --test tests/release-reviewed-tip-conformance.test.js`
Expected: FAIL with "release-tip-moves missing from POLICY_KEYS".

- [ ] **Step 3: Add the schema row and its `policy-schema.md` twin.**
  - Schema row: a `summary` of at most 140 chars that does not contain the key. Suggested: "Caps how many times the integration branch may move between a release's review and its merge before the release is held."
  - Markdown row:
    - source: `policy.yml`;
    - consumer: `/claude-tweaks:release` Step 5 (`execute.md`'s reviewed-tip comparison, #4041);
    - default: `2`;
    - meaning: one sentence. Each move past Step 3's reviewed tip runs one delta review, and the move after the last allowed one holds the release `integration branch kept moving`. Not a Manifesto lever.

- [ ] **Step 4: Run the new suite and the schema suites.**
Run: `node --test tests/release-reviewed-tip-conformance.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js`
Expected: all pass. If a schema-coverage pin names a further registration site, add the row there too.

- [ ] **Step 5: Commit.** Stage the three files, with message `Add the release-tip-moves policy key — bound for release Step 5's reviewed-tip comparison (refs #4041)`.

### Task 2: Step 3 records the reviewed tip; Step 5 compares, delta-reviews or holds

**Files:**
- Modify: `plugin/skills/release/SKILL.md`. Make three edits:
  - Step 3 marker, line 178, plus the sentence after it.
  - Step 8 `HELD` bullet, line 263.
  - The `failed` bullet, line 265: add the Step 5 comparison failures.
- Modify: `plugin/skills/release/execute.md`. Make two edits:
  - Insert a new `**Reviewed-tip comparison — immediately before the merge.**` block between the PR-check gate's delta 5 (ending line 159) and `**Merge.**` (line 161).
  - In the `--as` block (lines 96–133), add the reviewed-tip advance after "Once the push lands".
- Modify: `plugin/skills/release/console.md:43`. "the only other `HELD` reason" becomes an enumeration of execute.md's Step 5 stops that merge nothing: the `gh`-absent Transport stop, delta 5's re-render to a major, and the reviewed-tip comparison's two stops.
- Test: `tests/release-reviewed-tip-conformance.test.js`

**Interfaces:**
- Consumes: `release-tip-moves` from Task 1.
- Produces these prose contracts:

1. **Marker line**, which must stay one line:

   ```
   AUTO {HH:MM:SS} — Step 3: whole-branch review starting, base {base}..{branch} at reviewed tip {tip-sha}; ## /review marker: {k} existing lines{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}. Reversibility: n/a (marker).
   ```

   `{tip-sha}` is the full 40-hex `git -C "$RUN_ROOT" rev-parse origin/{branch}`, read right after Step 3's check passes.

2. **Comparison fence** in execute.md. Exit 0 means unmoved:

   ```bash
   git -C "$RUN_ROOT" fetch origin {branch} \
     && [ "$(git -C "$RUN_ROOT" rev-parse origin/{branch})" = "{reviewed-tip}" ]
   ```

3. **Delta marker line:**

   ```
   AUTO {HH:MM:SS} — Step 5: origin/{branch} moved {reviewed-short} → {tip-short} ({n} commits) before the merge — move {m} of {bound}; delta review starting, base {reviewed-tip}..{branch} at reviewed tip {tip-sha}; ## /review marker: {k} existing lines. Reversibility: n/a (marker).
   ```

- [ ] **Step 1: Write the failing tests.**

  **Extract-and-run (AC1.1).** `comparisonFence(executeText)` finds the execute.md `bash` fence containing `rev-parse origin/{branch})" = "{reviewed-tip}"` and resolves `{branch}` to `main` and `{reviewed-tip}` to a sha. Run it with `spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work } })` against `originWithTwoClones` fixtures, using a `withFixture` helper like the sibling suite's. The reviewed tip is `git rev-parse origin/main` in `work` after a fetch. Each row is its own test:
  - unmoved → status 0;
  - moved (commit and push from `other`) → status non-zero and empty stderr;
  - a run-dir-only commit pushed to origin from `other` → non-zero, because any move counts and only a review can clear it;
  - a failed fetch (`git remote set-url origin {root}/missing.git` in `work`) → non-zero and non-empty stderr.

  **Go-red control (AC1.2).** Drop the `&& [ … ]` clause from the extracted fence. The "moved" row then returns 0. Assert the mutated fence returns 0 and the real one does not.

  **Prose facts.** Use a `FACTS` array of `[label, file, regex]`, each asserting exactly one match, with a discrimination proof: deleting each matched span from its text makes its regex miss. Facts, one regex each:
  - SKILL.md Step 3: the marker carries the unbraced `at reviewed tip {tip-sha};` and still carries `{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}`.
  - SKILL.md Step 3: `{tip-sha}` is defined as `rev-parse origin/{branch}` read after the check passes.
  - execute.md: the comparison reads the last `reviewed tip` line in `{run-dir}/decisions.md`, with the words "never re-derived". This covers AC2.1.
  - execute.md: there is no recorded tip → `failed`, reason `no reviewed tip recorded`.
  - execute.md: a failed fetch → `failed`, stderr verbatim.
  - execute.md: the move count is the number of `Step 5: origin/{branch} moved` lines in this run's `decisions.md`.
  - execute.md: `release-tip-moves` is read with `resolve-policy.js … --values release-tip-moves`.
  - execute.md: past the bound → `HELD`, reason `integration branch kept moving`, `release-held.md` staged via `stage-item.js`, listing the arrived commits with `git -C "$RUN_ROOT" log --first-parent --oneline {step3-tip}..origin/{branch}`, and suggesting holding merges. This covers AC3.1.
  - execute.md: the delta brings `$RUN_ROOT` to the tip with `git -C "$RUN_ROOT" pull --rebase origin {branch}`, then re-runs SKILL.md Step 3's review-tree check. The new tip's test gate is the review's own Step 1.5, run in that tree.
  - execute.md: the delta invokes `/claude-tweaks:review base:{reviewed-tip}` and classifies only the lines after its marker, by Step 3's table.
  - execute.md: a `review: blocking` delta → console.md's `review: blocking` gate (unchanged `--allow-blocking`/`--train` rules) → `HELD`.
  - execute.md: a clean or findings delta → re-enter at the PR-check gate.
  - execute.md `--as`: the reviewed tip advances to the `Release-As:` commit only when `{sha}^` equals the reviewed tip.
  - SKILL.md Step 8 `HELD` bullet names `integration branch kept moving`.
  - console.md no longer contains "the only other `HELD` reason".

  **Placement.** In execute.md, the `**Reviewed-tip comparison` block index is greater than the index of delta 5's `re-rendered to a major after the console` and less than `**Merge.**`'s index.

  **Byte guard.** `fs.statSync(SKILL).size < 49500`.

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `node --test tests/release-reviewed-tip-conformance.test.js`
Expected: FAIL. The comparison fence is not found ("extraction pattern is out of sync"), and the prose facts miss. Task 1's test still passes.

- [ ] **Step 3: Edit SKILL.md Step 3, execute.md and console.md** to the contracts above.
  - execute.md's new block holds, in order:
    1. the precondition that a recorded tip exists;
    2. the fence;
    3. the exit classification: 0 → log `AUTO … Step 5: origin/{branch} still at reviewed tip {short}; merging.` → Merge; stderr → `failed`; moved → steps 4–7;
    4. the bound check, which fires when move `m` would exceed `release-tip-moves`;
    5. the `pull --rebase` and Step 3 check re-run, where any failure is `failed` with Step 3's stop lines;
    6. the delta marker and review invocation;
    7. the verdict routing.
  - One closing sentence: the remaining window is the merge call itself.
  - Add the `--as` advance sentence and its log line: `AUTO … Step 5: reviewed tip advanced to this run's Release-As commit {short} (parent is the reviewed tip). Reversibility: n/a.`
  - Prose only, no new files.

- [ ] **Step 4: Run the tests to verify they pass, along with the sibling suites.**
Run: `node --test tests/release-reviewed-tip-conformance.test.js tests/release-review-tree-check-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js`
Expected: all pass.

- [ ] **Step 5: Commit.** Stage the four files, with message `Hold release merges until origin/{branch} matches the reviewed tip — delta review on a move, HELD past release-tip-moves (refs #4041)`.

### Full-suite gate (folded)

AC4.1's `npm test` is /build Common Step 5's runner, not a task step.
