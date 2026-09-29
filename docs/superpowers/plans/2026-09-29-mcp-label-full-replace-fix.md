# MCP Label Full-Replace Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `gh`-absent MCP transport's claim-bootstrap and related label-add/remove call sites from silently wiping an issue's full label set via `mcp__github__issue_write`'s full-replace `labels` field.

**Architecture:** `issue_write`'s `labels` parameter replaces the whole array rather than merging, unlike `gh issue edit --add-label`/`--remove-label`, which are inherently additive/subtractive. The fix has two parts: (1) a small, pure, unit-tested helper (`mergeLabelNames`) that computes the correct full label array from a freshly-read current set plus an add/remove delta, and (2) documentation fixes at the one shared CRUD-mapping table and the three prose call sites that currently tell an agent to call `issue_write` (update mode) for a label edit with no warning that it must read-then-merge first. These are markdown prose files describing a procedure an LLM agent follows directly via MCP tool calls (no Node subprocess sees MCP tools — confirmed by `bin/materialize.js`'s own header and `bin/release-claim.js`'s), so the call-site fix is a documentation fix, not new orchestration code; the merge *logic* itself is the one piece worth centralizing and testing.

**Tech Stack:** Node.js (`node --test`, CommonJS, matching `plugin/bin/lib/issues/*.js`), Markdown skill files.

**Spec:** `/home/user/claude-tweaks/.claude/worktrees/record-2789/.claude-tweaks/pipelines/2026-09-29T151334-record-2789/work/2789-spec.md`

## Global Constraints

- Match the surrounding style: CommonJS `module.exports`, no external dependencies, pure functions, matching `plugin/bin/lib/issues/labels.js`'s validate-and-throw style.
- Every relationship/citation between skill files is stated once — do not restate the hazard prose at each call site; each site cites `_shared/github-write-transport.md`'s CRUD mapping and, where it performs the actual write, the new helper.
- Test files live under `tests/bin-lib/issues/` (unit) and `tests/` (prose-conformance), matching the existing sibling files' naming and structure exactly.
- Touch only the files this fix requires — do not restate or refactor unrelated CRUD-mapping rows.

## Review Focus

- A label name present in both `add` and `remove` for the same merge call — the helper must have a defined, tested precedent (remove wins) rather than producing an order-dependent result.
- An `add` name already present in `current` — must not produce a duplicate entry in the result.
- A `current` array containing a duplicate name already (a pre-existing malformed label list) — the helper must not crash, and should not manufacture a second duplicate.
- The warning text lives at the one shared CRUD-mapping file, but must actually be reachable from all three call sites that perform a label write on the MCP transport (claim-bootstrap, Settle's grant/`bot:*` removal, wrap-up Section E's release-claim label removal) — a citation-sweep test, not just eyeballing.
- The fix must not silently change the `gh`-CLI path's behavior (it was never broken) — every edit is scoped to the MCP-path prose only.

---

### Task 1: `mergeLabelNames` pure helper + unit tests

**Files:**
- Create: `plugin/bin/lib/issues/label-write.js`
- Test: `tests/bin-lib/issues/label-write.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: `mergeLabelNames(current, { add = [], remove = [] } = {})` — a pure function returning a new `string[]`: `current` with every name in `remove` dropped, then every name in `add` appended unless it is already present (post-removal) or itself named in `remove`. Exported alongside a `ensureLabelNameArray(value, argName)` guard that throws `TypeError` when `value` is not an array of non-empty strings. Later tasks (2-5, all documentation) reference this function by name and file path in prose; no other task calls it programmatically.

- [ ] **Step 1: Write the failing tests**

```js
// tests/bin-lib/issues/label-write.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLabelNames, ensureLabelNameArray } = require('../../../plugin/bin/lib/issues/label-write');

test('mergeLabelNames adds a new label onto an existing set, preserving every existing name', () => {
  const current = ['bug', 'ready', 'size:medium', 'auto:build'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['bug', 'ready', 'size:medium', 'auto:build', 'bot:in-progress']);
});

test('mergeLabelNames is a no-op add when the label is already present', () => {
  const current = ['ready', 'bot:in-progress'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['ready', 'bot:in-progress']);
});

test('mergeLabelNames removes a label while preserving every other one', () => {
  const current = ['ready', 'auto:merge', 'auto:merge-pending', 'risk:low'];
  const result = mergeLabelNames(current, { remove: ['auto:merge'] });
  assert.deepStrictEqual(result, ['ready', 'auto:merge-pending', 'risk:low']);
});

test('mergeLabelNames removing an absent label is a no-op', () => {
  const current = ['ready', 'risk:low'];
  const result = mergeLabelNames(current, { remove: ['bot:blocked'] });
  assert.deepStrictEqual(result, ['ready', 'risk:low']);
});

test('mergeLabelNames combines add and remove in one call', () => {
  const current = ['ready', 'bot:blocked'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'], remove: ['bot:blocked'] });
  assert.deepStrictEqual(result, ['ready', 'bot:in-progress']);
});

test('mergeLabelNames: a name in both add and remove is removed, not added (remove wins)', () => {
  const current = ['ready'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'], remove: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['ready']);
});

test('mergeLabelNames does not manufacture a duplicate when current already has one', () => {
  const current = ['ready', 'ready', 'risk:low'];
  const result = mergeLabelNames(current, { add: ['ready'] });
  assert.deepStrictEqual(result, ['ready', 'ready', 'risk:low']);
});

test('mergeLabelNames with no add/remove options returns an equal-valued copy, not the same array', () => {
  const current = ['ready', 'risk:low'];
  const result = mergeLabelNames(current);
  assert.deepStrictEqual(result, current);
  assert.notStrictEqual(result, current);
});

test('mergeLabelNames throws on a non-array current', () => {
  assert.throws(() => mergeLabelNames('not-an-array', { add: ['x'] }), TypeError);
});

test('mergeLabelNames throws on a non-array add/remove', () => {
  assert.throws(() => mergeLabelNames(['ready'], { add: 'x' }), TypeError);
  assert.throws(() => mergeLabelNames(['ready'], { remove: 'x' }), TypeError);
});

test('mergeLabelNames throws on a non-string entry in current/add/remove', () => {
  assert.throws(() => mergeLabelNames([1], {}), TypeError);
  assert.throws(() => mergeLabelNames(['ready'], { add: [null] }), TypeError);
});

test('ensureLabelNameArray returns the array unchanged when valid', () => {
  assert.deepStrictEqual(ensureLabelNameArray(['a', 'b'], 'current'), ['a', 'b']);
});

test('ensureLabelNameArray names the offending argument in its error message', () => {
  assert.throws(() => ensureLabelNameArray('nope', 'current'), /current/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/label-write.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/issues/label-write'"

- [ ] **Step 3: Write the implementation**

```js
// plugin/bin/lib/issues/label-write.js
// Pure: compute the correct full label-name array for a single-issue label write.
// Exists because mcp__github__issue_write's `labels` parameter REPLACES the full
// array rather than merging (unlike `gh issue edit --add-label`/`--remove-label`,
// which are inherently additive/subtractive) — see _shared/github-write-transport.md's
// CRUD mapping "Edit labels / body" row. A caller on the gh-absent MCP transport
// must read the issue's current labels, compute the desired full set with this
// function, and pass THAT array to issue_write — never a single-label array.
// #2789: a naive `labels: ["bot:in-progress"]` call wiped every other label on
// two live issues this way.
'use strict';

function ensureLabelNameArray(value, argName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${argName}: expected an array of label names (got ${typeof value})`);
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`${argName}: every entry must be a non-empty string (got ${JSON.stringify(entry)})`);
    }
  }
  return value;
}

// mergeLabelNames(current, { add, remove }) -> string[]
// `remove` is applied first, then `add` is appended for any name not already
// present post-removal — so a name listed in both `add` and `remove` ends up
// removed, never re-added (remove wins). Duplicate names already present in
// `current` are preserved as-is (never de-duplicated) since this function's
// job is computing the write payload, not repairing a pre-existing malformed
// label list.
function mergeLabelNames(current, { add = [], remove = [] } = {}) {
  ensureLabelNameArray(current, 'current');
  ensureLabelNameArray(add, 'add');
  ensureLabelNameArray(remove, 'remove');

  const removeSet = new Set(remove);
  const result = current.filter((name) => !removeSet.has(name));
  for (const name of add) {
    if (!removeSet.has(name) && !result.includes(name)) {
      result.push(name);
    }
  }
  return result;
}

module.exports = { mergeLabelNames, ensureLabelNameArray };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/label-write.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/label-write.js tests/bin-lib/issues/label-write.test.js
git commit -m "Add mergeLabelNames helper for MCP-transport label writes — refs #2789"
```

---

### Task 2: Warn about `issue_write`'s full-replace behavior at the shared CRUD mapping

**Files:**
- Modify: `plugin/skills/_shared/github-write-transport.md`
- Create: `tests/github-write-transport-label-merge-conformance.test.js`

**Interfaces:**
- Consumes: `plugin/bin/lib/issues/label-write.js`'s `mergeLabelNames` (Task 1) — referenced by name and path in the new prose, not called from this task.
- Produces: an explicit warning paragraph and read-then-merge snippet in `github-write-transport.md`, anchored by a stable heading (`### Full-replace hazard`) that Tasks 3-5's citations point at by name, and a literal sentence fragment (`labels field is a full replacement, never a merge`) that this task's own conformance test and Tasks 3-5's each pin.

- [ ] **Step 1: Write the failing conformance test**

```js
// tests/github-write-transport-label-merge-conformance.test.js
// Pins the full-replace warning plugin/skills/_shared/github-write-transport.md's
// CRUD mapping carries for issue_write's `labels` field (#2789), and that each of
// the three MCP-transport label-write call sites cites it rather than restating it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const TRANSPORT = read('plugin/skills/_shared/github-write-transport.md');
const HAZARD_HEADING = '### Full-replace hazard';
const HAZARD_SENTENCE = 'labels field is a full replacement, never a merge';

test('github-write-transport.md carries the full-replace hazard heading', () => {
  assert.ok(TRANSPORT.includes(HAZARD_HEADING), HAZARD_HEADING);
});

test('github-write-transport.md states the full-replace hazard in the CRUD mapping section', () => {
  assert.ok(TRANSPORT.includes(HAZARD_SENTENCE), HAZARD_SENTENCE);
});

test('github-write-transport.md names the mergeLabelNames helper and its path', () => {
  assert.ok(TRANSPORT.includes('bin/lib/issues/label-write.js'));
  assert.ok(TRANSPORT.includes('mergeLabelNames'));
});

test('github-write-transport.md\'s hazard section shows a read-then-merge-then-write shape', () => {
  assert.ok(TRANSPORT.includes('issue_read') && TRANSPORT.includes('get_labels'));
  assert.ok(TRANSPORT.includes('issue_write'));
});

const CITING_FILES = [
  'plugin/skills/_shared/issue-claims.md',
  'plugin/skills/dispatch/settle-and-merge.md',
  'plugin/skills/wrap-up/cleanup-procedures-execution.md',
];

for (const rel of CITING_FILES) {
  test(`${rel} cites github-write-transport.md's full-replace hazard`, () => {
    const content = read(rel);
    assert.ok(
      content.includes('Full-replace hazard') || content.includes('full-replace'),
      `expected ${rel} to reference the full-replace hazard`
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/github-write-transport-label-merge-conformance.test.js`
Expected: FAIL — `github-write-transport.md carries the full-replace hazard heading` and every other assertion fail (text not present yet)

- [ ] **Step 3: Add the hazard section to `github-write-transport.md`**

Insert a new subsection immediately after the `## CRUD mapping` table (after its final row, before the "**Pull requests are not covered...**" paragraph):

```markdown
### Full-replace hazard

**`issue_write`'s `labels` field is a full replacement, never a merge — unlike `gh issue edit
--add-label`/`--remove-label`, which are inherently additive/subtractive.** A call passing
`labels: ["bot:in-progress"]` does not add that one label — it sets the issue's ENTIRE label
set to exactly that one-element array, silently deleting every other label the issue carried
(#2789: this wiped `risk:*`/`size:*`/`priority:*`/`ceremony:*`/`type:*`/`shaped:*` categorization
off two live issues in production). This applies to every `issue_write` call in `update` mode
that includes a `labels` parameter, regardless of how many labels are changing.

**The fix is always read-then-merge-then-write, never a bare single- or few-label array:**

1. Read the issue's current labels — `issue_read` (`get_labels` method), or the `labels` field
   already on a fresh `issue_read` (`get` method) response.
2. Compute the full desired array with `mergeLabelNames` (`bin/lib/issues/label-write.js`):
   ```bash
   node -e "const {mergeLabelNames}=require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/label-write.js');
     console.log(JSON.stringify(mergeLabelNames(\$CURRENT_LABELS_JSON, {add: [...], remove: [...]})))"
   ```
3. Pass that COMPLETE array to `issue_write` — never a single-label or delta-only array.

Never assume a `labels` array read earlier in the same call chain is still fresh — a genuine
read-immediately-before-write is required, since a concurrent label change between the earlier
read and this write would otherwise be silently reverted by the stale array.
```

- [ ] **Step 4: Run test to verify Task 2's own assertions pass (the three citation tests still fail — expected until Tasks 3-5)**

Run: `node --test tests/github-write-transport-label-merge-conformance.test.js`
Expected: the 4 `github-write-transport.md ...` tests PASS; the 3 `cites github-write-transport.md's full-replace hazard` tests still FAIL (Tasks 3-5 not yet done)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-write-transport.md tests/github-write-transport-label-merge-conformance.test.js
git commit -m "Document issue_write's full-replace label hazard in the CRUD mapping — refs #2789"
```

---

### Task 3: Fix claim-bootstrap's `bot:in-progress` add (`_shared/issue-claims.md`)

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md`

**Interfaces:**
- Consumes: Task 2's `### Full-replace hazard` section (cited, not restated).
- Produces: an explicit MCP-transport instruction under "The bot:in-progress label" section's **Added** bullet, so Task 2's conformance test's citation check for this file passes.

- [ ] **Step 1: Locate and edit the "Added" bullet**

In `plugin/skills/_shared/issue-claims.md`, under `## The bot:in-progress label`, the existing text reads:

```markdown
- **Added** alongside claim acquisition — bootstrap-then-add, the same check-then-create
  pattern every label in this codebase uses (see `_shared/label-bootstrap.md` for the
  canonical snippet and the full work-record `LABELS_JSON`; `/dispatch` is the
  claim-acquiring consumer).
```

**Size-headroom note (measured at plan-authoring time):** `issue-claims.md` is at 43,700 bytes
against the ~46,080-byte governed-corpus ceiling (2,380 bytes headroom) — `/build`'s Common Step
1.5 plan-audit flags this file `nearCeiling`. The replacement bullet below adds ~400 bytes
(measured), landing the file at ~44,100 bytes — still comfortably under the ceiling, but keep
this bullet exactly this size; do not expand it further without re-measuring.

Replace it with:

```markdown
- **Added** alongside claim acquisition — bootstrap-then-add, the same check-then-create
  pattern every label in this codebase uses (see `_shared/label-bootstrap.md` for the
  canonical snippet and the full work-record `LABELS_JSON`; `/dispatch` is the
  claim-acquiring consumer). **MCP transport (`gh` absent):** `issue_write`'s `labels` field
  is a full replacement, not a merge — see `_shared/github-write-transport.md`'s Full-replace
  hazard section. Read current labels first (`issue_read`, `get_labels`), merge via
  `mergeLabelNames` (`bin/lib/issues/label-write.js`, `add: ['bot:in-progress']`), and write
  that full array — never `labels: ['bot:in-progress']` alone.
```

- [ ] **Step 2: Run the Task 2 conformance test to verify this file's citation now passes**

Run: `node --test tests/github-write-transport-label-merge-conformance.test.js`
Expected: `plugin/skills/_shared/issue-claims.md cites github-write-transport.md's full-replace hazard` PASSES; the other two citation tests still FAIL

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md
git commit -m "Fix claim-bootstrap's MCP-transport bot:in-progress add to read-then-merge — refs #2789"
```

---

### Task 4: Fix Settle's grant-removal/`bot:*` label edits (`dispatch/settle-and-merge.md`)

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md`

**Interfaces:**
- Consumes: Task 2's `### Full-replace hazard` section (cited, not restated).
- Produces: the "MCP path, file-wide" paragraph updated to name the hazard explicitly, so Task 2's conformance test's citation check for this file passes.

- [ ] **Step 1: Edit the "MCP path, file-wide" paragraph**

In `plugin/skills/dispatch/settle-and-merge.md`, the existing paragraph (right after the file's opening notes, before `## Step 6: Settle`) reads:

```markdown
**MCP path, file-wide.** Every label read/edit and comment operation in this file that isn't called out individually below (e.g. the `gh issue view --json labels` / `gh issue edit --remove-label` pair in Settle step 3, and the failure-comment post in step 5) uses the standard CRUD mapping from `_shared/github-write-transport.md`: `issue_write` (update mode) for label edits, `add_issue_comment` for comments, `issue_read` for reads. The one call site with special MCP-path handling — the retry-ceiling comment fetch (step 4 below) — already has its own dedicated note.
```

**Size-headroom warning (measured at plan-authoring time — read before editing):**
`settle-and-merge.md` is at 45,339 bytes against the ~46,080-byte governed-corpus ceiling — only
**741 bytes of headroom**, the tightest of any file this plan touches. The replacement paragraph
below is deliberately trimmed to add ~467 bytes (measured against the exact old/new paragraph
text), landing at ~45,806 bytes — still under the ceiling, but with almost no margin left. **Use
the replacement text exactly as given below — do not add further prose to this paragraph.** If a
future change needs more room here, split this file first (a separate, scoped follow-up) rather
than pushing this paragraph over the ceiling.

Replace it with:

```markdown
**MCP path, file-wide.** Every label read/edit and comment operation in this file that isn't called out individually below (e.g. the `gh issue view --json labels` / `gh issue edit --remove-label` pair in Settle step 3, and the failure-comment post in step 5) uses the standard CRUD mapping from `_shared/github-write-transport.md`: `issue_write` (update mode) for label edits, `add_issue_comment` for comments, `issue_read` for reads. **On the MCP transport, `issue_write`'s `labels` field is a full replacement, not a merge — see that file's Full-replace hazard section:** every label edit in this file (step 3's `auto:merge`/`auto:merge-pending` removal, `bot:in-progress` removal via `release-claim.js`'s MCP fallback) reads current labels first and merges via `mergeLabelNames` (`bin/lib/issues/label-write.js`) before writing — the `gh`-CLI form needs no merge, being inherently subtractive. The one call site with special MCP-path handling — the retry-ceiling comment fetch (step 4 below) — already has its own dedicated note.
```

- [ ] **Step 2: Run the Task 2 conformance test to verify this file's citation now passes**

Run: `node --test tests/github-write-transport-label-merge-conformance.test.js`
Expected: `plugin/skills/dispatch/settle-and-merge.md cites github-write-transport.md's full-replace hazard` PASSES; the wrap-up citation test still FAILS

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md
git commit -m "Fix Settle's MCP-transport label edits to read-then-merge — refs #2789"
```

---

### Task 5: Fix wrap-up Section E's release-claim label removal (`wrap-up/cleanup-procedures-execution.md`)

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md`

**Interfaces:**
- Consumes: Task 2's `### Full-replace hazard` section (cited, not restated).
- Produces: step 4's gh-absent fallback note updated to name the hazard explicitly, so Task 2's conformance test's citation check for this file passes (closing the full sweep of all three known call sites named in the spec's Deliverable 1).

- [ ] **Step 1: Edit step 4's gh-absent fallback sentence**

In `plugin/skills/wrap-up/cleanup-procedures-execution.md`, step 4's existing closing sentence reads:

```markdown
   (set `REMOVE_GRANTS=1` per step 6's rule.) The CLI wraps `gh` only — in a `gh`-absent environment
   run the same read-classify-write over the MCP tools per `_shared/github-write-transport.md`;
   the MCP path stays the documented fallback rather than a second mode of the CLI.
```

Replace it with:

```markdown
   (set `REMOVE_GRANTS=1` per step 6's rule.) The CLI wraps `gh` only — in a `gh`-absent environment
   run the same read-classify-write over the MCP tools per `_shared/github-write-transport.md`;
   the MCP path stays the documented fallback rather than a second mode of the CLI. **The grant
   removals (step 6) and `bot:in-progress`/`parked` label edits (step 7) this CLI performs are
   label writes** — on the MCP transport, `issue_write`'s `labels` field is a full replacement,
   not a merge (`_shared/github-write-transport.md`'s Full-replace hazard section): read the
   issue's current labels first (`issue_read`, `get_labels`), compute the full desired array with
   `mergeLabelNames` (`bin/lib/issues/label-write.js`), and pass that complete array to
   `issue_write` — never a single- or few-label array. The `gh`-CLI form each step already
   documents (`gh issue edit --remove-label`/`--add-label`) needs no such merge; this applies to
   the MCP fallback specifically.
```

- [ ] **Step 2: Run the full conformance test to verify all three citations now pass**

Run: `node --test tests/github-write-transport-label-merge-conformance.test.js`
Expected: PASS (all tests, including all three citation tests)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution.md
git commit -m "Fix wrap-up Section E's MCP-transport label writes to read-then-merge — refs #2789"
```
