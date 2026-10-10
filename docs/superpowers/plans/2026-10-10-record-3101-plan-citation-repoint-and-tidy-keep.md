# Plan Citation Repoint + /tidy Keep-While-Cited Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every repo citation of a deleted `docs/superpowers/plans/*.md` file carries its deletion commit, and `/tidy` never deletes a plan that a repo file still cites.

**Architecture:** Two independent prose/comment changes, each pinned by one `node --test` conformance case in a single new test file. Task 1 annotates the three unannotated dangling citations (ADR 0021:43, `store.js:43`/`:72`) and adds a repo-scan invariant test. Task 2 adds a citation check to `/tidy`'s Step 4 plan audit (`scan-procedures.md`) and to Step 6's pre-delete re-verify (`step-6-auto.md`), with a prose-conformance test.

**Tech Stack:** Markdown skill prose, CommonJS comments, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T190327-spec-3101-3102-3103-3104/spec-3101/work/3101-spec.md`

## Global Constraints

- Any `plugin/skills/**/*.md` file stays under the 46080-byte (45 KB) ceiling, measured LF-normalized. `step-6-auto.md` is at 45113 B LF, so its addition must stay under ~250 B.
- Deletion-annotation convention already used repo-wide: `` (deleted `{8-char sha}`) `` after the path.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- A citation already annotated in a different existing style (`, deleted \`sha\``, `— deleted (sha)`, an annotation wrapped onto the next line) must not fail the invariant test. Pinned by Task 1's regex that accepts `deleted` followed by a hex sha on the citation line or the next line.
- Test fixtures in `tests/` use synthetic plan paths (`2099-01-01-some-topic.md`, `a.md`), which are not citations. The invariant scan excludes `tests/` (Task 1).
- The citation grep must exclude `docs/superpowers/plans/` itself and `.claude-tweaks/`, or every plan cites itself and every run dir's materialized spec counts (Task 2 prose; Task 1 scan roots).
- A tidy Keep for a cited plan must name the citing file, so a human can repoint or delete it deliberately (Task 2 prose + test).
- Matching on basename, not full path, also catches citations written relative to `plans/`. Task 2 prose says basename.

---

### Task 1: Annotate the dangling citations + repo invariant test

**Files:**
- Modify: `docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md:43`
- Modify: `plugin/bin/lib/declined-learning/store.js:42-73`
- Test: `tests/plan-citations-resolve.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/plan-citations-resolve.test.js` (Task 2 appends one test to it).

- [ ] **Step 1: Write the failing test**

Create `tests/plan-citations-resolve.test.js`:

```js
// tests/plan-citations-resolve.test.js — #3101.
//
// A repo file outside docs/superpowers/plans/ that names a docs/superpowers/plans/*.md path must
// either name a plan that exists or annotate the citation with the commit that deleted it
// (`(deleted \`{sha}\`)` and its existing variants, on the citation line or the next one). #3097's
// tidy sweep deleted two cited plans and left store.js and ADR 0021 pointing at nothing.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// tests/ is excluded: its plan paths are synthetic fixture data, not citations.
const SCAN_ROOTS = ['plugin', 'docs', path.join('.claude', 'skills')];
const SKIP_DIRS = new Set([path.join('docs', 'superpowers', 'plans'), 'node_modules']);
const CITATION = /docs\/superpowers\/plans\/[A-Za-z0-9._-]+\.md/g;
const DELETED = /deleted[^0-9a-f\n]{0,20}[0-9a-f]{7,40}/;

function walk(rel, out) {
  if (SKIP_DIRS.has(rel)) return;
  let entries;
  try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const child = path.join(rel, e.name);
    if (e.isDirectory()) walk(child, out);
    else if (/\.(md|js|ya?ml)$/.test(e.name)) out.push(child);
  }
}

function danglingCitations() {
  const files = [];
  for (const r of SCAN_ROOTS) walk(r, files);
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.md')) files.push(f);
  const dangling = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CITATION)) {
        if (fs.existsSync(path.join(ROOT, m[0]))) continue;
        if (DELETED.test(line.slice(m.index)) || DELETED.test(lines[i + 1] || '')) continue;
        dangling.push(`${f}:${i + 1} ${m[0]}`);
      }
    });
  }
  return dangling;
}

test('no file outside docs/superpowers/plans/ cites a deleted plan without its deletion commit (#3101 AC1)', () => {
  assert.deepEqual(danglingCitations(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-citations-resolve.test.js`
Expected: FAIL listing `docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md:43` and `plugin/bin/lib/declined-learning/store.js:43` / `:72`.

- [ ] **Step 3: Annotate the citations**

`docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md:43`: change
`` implementation plan (`docs/superpowers/plans/2026-10-03-visual-plan-evaluate-prototype.md`) were ``
to
`` implementation plan (`docs/superpowers/plans/2026-10-03-visual-plan-evaluate-prototype.md`, deleted `a3ddd1cb`) were ``
(the plan blob's last commit is `a3ddd1cb^`).

`plugin/bin/lib/declined-learning/store.js:42-44`: replace
```
// here. Full reasoning: docs/superpowers/plans/2026-09-18-declined-learning-subject-sanitization.md's
// "Decision" section (this plan is deleted once #1400 ships and closes, per this repo's specs/
// close-out convention — this comment is the durable copy).
```
with
```
// here. This comment is the durable copy of the "Decision" section in
// docs/superpowers/plans/2026-09-18-declined-learning-subject-sanitization.md (deleted `a3ddd1cb`).
```

`plugin/bin/lib/declined-learning/store.js:70-73`: replace
```
// the content can be read as instructions rather than data. See "Decision" in
// docs/superpowers/plans/2026-09-18-declined-learning-subject-sanitization.md for the full
// risk-tolerance decision and why this fix stays scoped to this store.
```
with
```
// the content can be read as instructions rather than data. This file's header carries the full
// risk-tolerance decision and why this fix stays scoped to this store.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plan-citations-resolve.test.js tests/bin-lib/declined-learning`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/plan-citations-resolve.test.js docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md plugin/bin/lib/declined-learning/store.js
git commit -m "Annotate the plan citations #3097 left dangling — store.js and ADR 0021 now name the deleting commit (#3101)"
```

### Task 2: /tidy keeps a plan a repo file still cites

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md` (Step 4: Audit Execution Plans, after the plan table at line ~49)
- Modify: `plugin/skills/tidy/step-6-auto.md:43` (the auto-apply Delete row's re-verify list)
- Test: `tests/plan-citations-resolve.test.js` (append)

**Interfaces:**
- Consumes: the test file from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/plan-citations-resolve.test.js`:

```js
const TIDY = path.join(ROOT, 'plugin', 'skills', 'tidy');
const read = (f) => fs.readFileSync(path.join(TIDY, f), 'utf8').replace(/\r\n/g, '\n');

test('/tidy keeps a plan a repo file still cites, naming the citing file, at scan and at pre-delete re-verify (#3101 AC2)', () => {
  const scan = read('scan-procedures.md');
  const step4 = scan.slice(scan.indexOf('## Step 4: Audit Execution Plans'), scan.indexOf('Also glob `docs/plans/*-ledger.md`'));
  assert.match(step4, /basename/, 'Step 4 must grep for the plan basename');
  assert.match(step4, /excluding `docs\/superpowers\/plans\/` and `\.claude-tweaks\/`/);
  assert.match(step4, /Keep \(cited by \{file\}\)/, 'Step 4 must name the citing file in its Keep');
  const auto = read('step-6-auto.md');
  const row = auto.split('\n').find((l) => l.startsWith('| **Delete** (marked-as-specified design docs'));
  assert.ok(row, 'step-6-auto.md auto-apply Delete row not found');
  assert.match(row, /no repo file cites the plan's basename/, 'pre-delete re-verify must re-run the citation grep');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-citations-resolve.test.js`
Expected: FAIL on the `#3101 AC2` test ("Step 4 must grep for the plan basename").

- [ ] **Step 3: Add the citation check**

In `plugin/skills/tidy/scan-procedures.md`, directly after the Step 4 plan table's `→ Collect each as: \`[plan] {filename} — {recommendation}\`` line, insert:

```markdown

**Citation check before any plan Delete (#3101).** A plan a repo file still cites is not orphaned, whatever the table above concluded. Grep the repo for the plan's basename, excluding `docs/superpowers/plans/` and `.claude-tweaks/`: any hit makes the recommendation `Keep (cited by {file})`, naming every citing file, so a human repoints the citation (append its deletion commit, `` (deleted `{sha}`) ``) or deletes it deliberately. A record body naming the plan does not count here. That is the open-record check, and this check reads repo files only.
```

In `plugin/skills/tidy/step-6-auto.md:43`, change the re-verify clause `the plan's related spec is still complete;` to `the plan's related spec is still complete and no repo file cites the plan's basename (`scan-procedures.md` Step 4's citation check);`.

- [ ] **Step 4: Run test to verify it passes, and check the ceiling**

Run: `node --test tests/plan-citations-resolve.test.js tests/tidy-subfile-table-completeness.test.js`
Expected: PASS
Run: `tr -d '\r' < plugin/skills/tidy/step-6-auto.md | wc -c` — expected under 46080.

- [ ] **Step 5: Commit**

```bash
git add tests/plan-citations-resolve.test.js plugin/skills/tidy/scan-procedures.md plugin/skills/tidy/step-6-auto.md
git commit -m "Keep a plan a repo file still cites in /tidy — scan and pre-delete re-verify grep for its basename (#3101)"
```
