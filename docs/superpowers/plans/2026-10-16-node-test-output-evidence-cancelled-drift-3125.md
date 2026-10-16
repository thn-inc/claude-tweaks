# node-test-output-evidence Cancelled-Count Drift Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.claude/skills/node-test-output-evidence/SKILL.md` describe how `adjudicate()` actually treats a cancelled test: tolerated in the full run (entries must equal `ℹ fail` + `ℹ cancelled`), zero-cancelled required only in each isolated single-file rerun.

**Architecture:** Prose-only correction of one project skill file (maintainer-side, not plugin payload). Two regions change: the "Reconcile the failing list against an independent count" subsection and the Decision Framework table rows that restate the same rule. No code changes; `plugin/bin/lib/verify/baseline.js` is the source of truth and is not touched.

**Tech Stack:** Markdown; `node --test` for the existing verify suites (regression check only).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T062614-record-3125/work/3125-spec.md` (record #3125)

## Global Constraints

- Edit only `.claude/skills/node-test-output-evidence/SKILL.md`; do not touch `plugin/bin/lib/verify/*.js`.
- Surgical: edit in place, keep surrounding sections byte-identical.
- Commit message style: `{Verb} {what} — {detail}`, referencing `refs #3125` (never `closes`/`fixes`).

## Review Focus

- The full-run rule must stay spec-scoped: `baseline.js:234-245` only reconciles entries against `fail + cancelled` for the **spec** family; TAP full runs have no cancelled check. The prose must not claim a TAP full-run cancelled reconciliation.
- The isolated-rerun rule (`accountedFamily`, `baseline.js:157-166`) applies to both the base-side run and the isolated HEAD run (call sites `baseline.js:295`, `341`, `358`) — the prose must say "isolated single-file rerun", not only "HEAD rerun".
- The Decision Framework row for spec entries must name `ℹ fail` + `ℹ cancelled`, otherwise the table contradicts the corrected subsection.
- The runner-level `ℹ Error:` / timeout-diagnostic "no evidence" rule is checked inside `accountedFamily` / `conclusiveOnly`, i.e. on the single-file logs — the corrected row must scope it there, not to the full run.
- "A pass is never reached" must not survive anywhere in the file.

---

### Task 1: Correct the cancelled-count rule in the Key Patterns subsection and Decision Framework

**Files:**
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md:37-46` (Reconcile subsection)
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md:57-58` (Decision Framework rows)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by code.

- [ ] **Step 1: Write the failing content check**

Save as a scratch check (not committed) and run it:

```bash
node -e "const t=require('fs').readFileSync('.claude/skills/node-test-output-evidence/SKILL.md','utf8');const bad=[t.includes('a pass is never reached'),t.includes('so a full run containing one is never adjudicated'),!t.includes('plus its \`ℹ cancelled\` count'),!t.includes('(\`accountedFamily\`)'),!t.includes('Spec entries ≠ \`ℹ fail N\` + \`ℹ cancelled N\`')];console.log(JSON.stringify(bad));process.exit(bad.some(Boolean)?1:0)"
```

- [ ] **Step 2: Run it to verify it fails**

Run: the command above.
Expected: FAIL (exit 1), printing `[true,true,true,true,true]`.

- [ ] **Step 3: Replace the Reconcile subsection body (lines 39-46)**

Replace this exact text:

```
An extracted list of failures cannot report that it missed one. `adjudicate` refuses to classify unless:

- the spec `test at` entries (`specEntryCount`) add up to the summary's `ℹ fail N`;
- every failing entry or TAP `not ok` block names a test file (`countUnmatchedFailures` returns 0);
- the summary counts parse at all, because a truncated log has none;
- `ℹ cancelled` (spec) or `# cancelled` (TAP) reads 0 in a single-file log.

The listing and `ℹ fail` do not count the same things. A cancelled test, for example one that timed out, is listed but not counted, so a full run containing one is never adjudicated. That outcome is fail-closed, and a pass is never reached. A diagnostic that says the test timed out or was cancelled (`INCONCLUSIVE_RE`) means the test did not finish, which proves nothing about whether it fails.
```

with:

```
An extracted list of failures cannot report that it missed one. `adjudicate` refuses to classify the full run unless:

- the spec `test at` entries (`specEntryCount`) add up to the summary's `ℹ fail N` plus its `ℹ cancelled` count;
- every failing entry or TAP `not ok` block names a test file (`countUnmatchedFailures` returns 0);
- the summary counts parse at all, because a truncated log has none.

The listing and `ℹ fail` do not count the same things — a cancelled test, for example one that timed out, is listed but not counted, so the full run's entries must reconcile against `ℹ fail` plus `ℹ cancelled`, not `ℹ fail` alone. A cancelled test does not by itself block adjudication of the full run: it is held to the usual per-file evidence (it fails at base, or shows its own pass in isolation). Only that isolated single-file rerun must itself show `ℹ cancelled`/`# cancelled` at 0 (`accountedFamily`) to count as evidence — a rerun that times out or cancels proves nothing and that file stays unclassified. A diagnostic that says the test timed out or was cancelled (`INCONCLUSIVE_RE`) means the test did not finish, which proves nothing about whether it fails.
```

- [ ] **Step 4: Replace the two Decision Framework rows (lines 57-58)**

Replace:

```
| Spec entries ≠ `ℹ fail N`, or a failing entry naming no test file | An undercount. Refuse |
| A non-zero cancelled count, a timeout diagnostic, or a runner-level `ℹ Error:` | Did not finish, or failed outside any test. No evidence |
```

with:

```
| Spec entries ≠ `ℹ fail N` + `ℹ cancelled N`, or a failing entry naming no test file | An undercount. Refuse |
| A non-zero cancelled count in the full run | Not a refusal by itself. Each cancelled test is held to the per-file evidence: it fails at base, or shows its own pass in isolation |
| In an isolated single-file rerun: a non-zero cancelled count, a timeout diagnostic, or a runner-level `ℹ Error:` | Did not finish, or failed outside any test. No evidence — that file stays unclassified |
```

- [ ] **Step 5: Run the content check to verify it passes**

Run: the Step 1 command.
Expected: PASS (exit 0), printing `[false,false,false,false,false]`.

- [ ] **Step 6: Regression-run the suites the skill cites**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS (no code changed; confirms the cited behavior still holds).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/node-test-output-evidence/SKILL.md
git commit -m "Correct node-test-output-evidence cancelled-count rule — full run tolerates cancelled, only isolated reruns require zero (refs #3125)"
```
