# tidy Step 7.5: skip the scratch worktree for an all-forge-API approved set (#3339) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `/claude-tweaks:tidy` Step 7.5's scratch-worktree provisioning on the approved Step 7 set holding at least one working-tree write, citing `_shared/worktree-setup.md`'s forge-API-only carve-out.

**Architecture:** Prose-only change to one skill sub-file (`plugin/skills/tidy/step-7-5-worktree-always.md`): one new gating paragraph plus two conditioning clauses on existing sentences, plus three one-clause mirror updates (tidy `SKILL.md`, `scan-execution.md`, `docs/skill-graph.md`). One conformance test pins the condition and the citation.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T193747-record-3339/work/3339-spec.md` (materialized from GitHub issue #3339)

## Global Constraints

- Cite `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" — never restate the carve-out's qualifying list (gitignored paths, ref-only writes, session temp files).
- Provisioning for any set with a local write, and for `work-backend: local-files`, stays exactly as today.
- Every phrase pinned by `tests/sweep-backstop.test.js` lines 343-365 and `tests/worktree-forge-api-carve-out.test.js` lines 100-105 must still match after the edit (edit additively; do not reword pinned sentences).
- Size: `step-7-5-worktree-always.md` is 8,530 B against the 52,500 B `RAIL_BYTES` rail; the edit adds ~1.3 KB, leaving ~42.7 KB headroom.

## Review Focus

- A Release Note fill under `github-issues` writes a snapshot file — it must classify as forge-API (snapshot lands in the run dir, a gate-exempt path), not as a working-tree write.
- A "Mark as specified" action under `github-issues` edits a tracked design doc — it must classify as a working-tree write even though the backend is `github-issues`.
- Cross-action housekeeping (`git worktree remove`, `git branch -d`) — must not by itself force a worktree (git metadata only; the gate does not intercept these per `_shared/policy-schema-coverage.md`).
- The all-forge path must also skip the commit and the `pr-first` PR/arming — there is nothing to commit, so no PR may be opened.
- `--dry-run` and `worktree-always`-off skips remain intact alongside the new skip.

The first four are pinned by the Task 1 test's `working-tree write` / `record-file` / `Status: specified` / `skip the commit` assertions; the fifth by keeping the existing skip sentence (`Skip this entirely when`) and extending it.

---

### Task 1: Gate Step 7.5 provisioning on a working-tree write

**Files:**
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (new paragraph after the `---` rule at line 9; conditioning clause in line 11's provisioning sentence; line 20's skip sentence)
- Modify: `plugin/skills/tidy/SKILL.md:205` (stub) and `:242` (Component-Skill Contract "One exception" sentence)
- Modify: `plugin/skills/tidy/scan-execution.md:10`
- Modify: `docs/skill-graph.md:598` (tidy → `_shared/worktree-setup.md` edge row)
- Test: `tests/worktree-forge-api-carve-out.test.js`

**Interfaces:**
- Consumes: the existing `skill(...parts)`, `note(text, label)`, and `CITE` helpers in `tests/worktree-forge-api-carve-out.test.js`.
- Produces: `assertStep75Gate(text)` (test-local function), called by both the positive test and the go-red control.

- [ ] **Step 1: Write the failing test** — append to `tests/worktree-forge-api-carve-out.test.js`:

```js
function assertStep75Gate(text) {
  const n = note(text, 'tidy/step-7-5-worktree-always.md');
  assert.match(n, /worktree-setup\.md/, 'must cite the canonical carve-out file');
  assert.match(n, /working-tree write/, 'must name the working-tree-write condition');
  assert.match(n, /record-file/, 'record-file edits count as working-tree writes');
  assert.match(n, /docs\/REGISTRY\.md/, 'REGISTRY.md Fix-now edits count as working-tree writes');
  assert.match(n, /Status: specified/, 'a design-doc stamp counts even under github-issues');
  assert.match(n, /provision no worktree/, 'all-forge set provisions nothing');
  assert.match(n, /skip the commit/, 'all-forge set makes no commit and opens no PR');
  assert.match(n, /local-files/, 'local-files provisioning unchanged');
  assert.match(text, /resolves `true` and the approved Step 7 set holds at least one working-tree write/,
    'the provisioning sentence itself must carry the condition');
}

test('AC1.1 AC2.1 AC3.1: tidy step-7-5 gates provisioning on a working-tree write and cites the carve-out', () => {
  assertStep75Gate(skill('tidy', 'step-7-5-worktree-always.md'));
});

test('go-red: dropping the provisioning condition fails the Step 7.5 gate assertions', () => {
  const text = skill('tidy', 'step-7-5-worktree-always.md')
    .replace(' and the approved Step 7 set holds at least one working-tree write', '');
  assert.throws(() => assertStep75Gate(text));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/worktree-forge-api-carve-out.test.js`
Expected: FAIL — `tidy/step-7-5-worktree-always.md must cite "Forge-API-only invocations need no worktree"`

- [ ] **Step 3: Implement the prose**

(a) In `step-7-5-worktree-always.md`, insert this paragraph (exact copy) between the `---` rule and the `**Under \`worktree-always: true\`:**` paragraph, as its own paragraph (blank line on each side, no internal blank lines — `note()` slices on `\n\n`):

```markdown
**Provision only for a working-tree write (#3339).** A working-tree write is an approved Step 7 action that creates, edits, or deletes a tracked file — a record-file delete/edit, a design doc's `Status: specified` stamp, a `docs/REGISTRY.md` Fix-now edit — anything the tidy-up commit would carry. When the approved set holds none, `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" carve-out covers the whole of Step 7: run it and Step 7.5's verification checklist from the main checkout, provision no worktree, and skip the commit, the `pr-first` PR, and its arming below — there is nothing to commit. Under `work-backend: github-issues` that is the all-`gh` case (stale-issue closes, label edits, a Release Note fill whose snapshot lands in the run dir); the cross-action housekeeping's worktree and branch removals touch only git metadata the gate does not intercept, so they never count. The run dir's audit files then stay uncommitted at `$RUN_ROOT`, exactly as when `worktree-always` is off. Any set with even one working-tree write provisions exactly as below, and so does every `work-backend: local-files` run — each of its Step 7 mutations is a tracked-file edit.
```

(b) Same file, line 11: replace `and if it resolves \`true\`, provision a scratch worktree` with `and if it resolves \`true\` and the approved Step 7 set holds at least one working-tree write (the paragraph above), provision a scratch worktree`.

(c) Same file, line 20: replace `Skip this entirely when \`worktree-always\` isn't set, or when \`--dry-run\` was passed (Step 7 never mutates or commits in that case).` with `Skip this entirely when \`worktree-always\` isn't set, when \`--dry-run\` was passed (Step 7 never mutates or commits in that case), or when the approved set holds no working-tree write (the first paragraph above).`

(d) `tidy/SKILL.md:205`: replace `the tidy-up commit under \`worktree-always: true\`: provisioning,` with `the tidy-up commit under \`worktree-always: true\`: provisioning (only when the approved set holds a working-tree write),`.

(e) `tidy/SKILL.md:242`: replace `under \`worktree-always: true\`, Step 7.5 sets up a scratch worktree` with `under \`worktree-always: true\`, when Step 7's approved set holds a working-tree write, Step 7.5 sets up a scratch worktree`.

(f) `tidy/scan-execution.md:10`: replace `is Step 7.5's, for Step 7's mutations.` with `is Step 7.5's, and only when Step 7's approved set holds a working-tree write.`

(g) `docs/skill-graph.md:598`: replace `Step 7.5's scratch worktree remains the only one \`/tidy\` provisions, for Step 7's mutations.` with `Step 7.5's scratch worktree remains the only one \`/tidy\` provisions, and \`step-7-5-worktree-always.md\` cites the same carve-out to skip it when Step 7's approved set holds no working-tree write (#3339).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/worktree-forge-api-carve-out.test.js tests/sweep-backstop.test.js`
Expected: PASS (all tests, including the two new ones and the existing pins)

Then prove discrimination: temporarily delete the new paragraph's citation sentence, re-run `node --test tests/worktree-forge-api-carve-out.test.js` — the AC test must FAIL — then restore it (`git diff` shows only the intended edits).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/scan-execution.md docs/skill-graph.md tests/worktree-forge-api-carve-out.test.js
git commit -m "Gate tidy Step 7.5's scratch worktree on a working-tree write — refs #3339"
```

---

## Spec coverage

| Spec item | Covered by |
|---|---|
| Deliverable 1 (gate on working-tree write; all-forge set runs from main checkout citing the carve-out) | Task 1 Step 3 (a)(b)(c); test asserts `working-tree write`, `provision no worktree`, citation |
| Deliverable 2 (unchanged for local-write sets and local-files) | Task 1 Step 3 (a) last sentence; test asserts `local-files` |
| AC1.1 (all-gh run creates no worktree) | `AC1.1 AC2.1 AC3.1` test (`provision no worktree`) |
| AC2.1 (local-write set still provisions as today) | same test (`record-file`, `docs/REGISTRY.md`, conditioned sentence) |
| AC3.1 (conformance test pins condition + citation) | same test + go-red control |

## Self-review

- Spec coverage: every Deliverable and AC clause maps to Task 1 (table above).
- Placeholders: none.
- Proportion: one task, prose-sized; code blocks are the exact copy the spec's citation rule fixes and the test assertions.
