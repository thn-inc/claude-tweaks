# CRLF-safe '\n\n' paragraph searches in prose tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched

**Goal:** No test under `tests/` searches a raw `fs.readFileSync` of a tracked markdown file for `'\n\n'`. Every such read goes through `readText()`, and each changed suite carries a CRLF case.

**Architecture:** Each of the nine suites keeps its extractor logic byte-for-byte. Only its read changes, from `fs.readFileSync(p, 'utf8')` to `readText(p)` from `tests/helpers/read-skill.js`. A new helper, `crlfCheckoutRead(absPath)`, in the same helper file writes the file's LF text back out with CRLF endings to a temp file and reads it through `readText()`. That is what a `core.autocrlf=true` Windows checkout hands a suite. Each suite's CRLF case asserts three things on that read: the raw bytes hold no LF paragraph break, the normalized text equals the LF read, and the suite's own paragraph extractor still finds its region.

**Tech Stack:** Node 18+, `node:test`, `node:assert`, `node:fs`, `node:os`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T005534-record-3574/work/3574-spec.md`

## Global Constraints

- Route the read through `tests/helpers/read-skill.js`'s `readText()`. Leave the extractor logic unchanged.
- Build each CRLF case from the LF text with `.replace(/\n/g, '\r\n')`, never from a raw read. On a CRLF checkout a raw read gives `\r\r\n` (#3523).
- Remove or skip no test. Every pre-existing test in a changed file must still run and pass.
- Intermediate commit messages cite `refs #3574`, never `closes`/`fixes`.

## Review Focus

- A suite still reads the same file raw at a second call site: the swap must cover every read in the file that feeds a `'\n\n'` search, not just the line the issue names (e.g. `ephemeral-server-handoff-conformance` reads `TASK_PROMPT` raw in four tests).
- A `\r\r\n` CRLF input, which would come from replacing on a raw read: the CRLF case asserts `!raw.includes('\r\r\n')`.
- A temp file left behind: `crlfCheckoutRead` removes its temp dir in a `finally` before returning.
- A changed read that alters a byte-sensitive assertion (a length or byte count) in the same file. On an LF checkout `readText` returns the identical string, so nothing changes on macOS/Linux. Verify by running the whole file, not only the new test.

Sites (verified at HEAD `22084625`): the grep `grep -rnE "(split|indexOf|lastIndexOf|includes)\((/[^/]*\\\\n\\\\n|['\"\`]\\\\n\\\\n)" tests` returns 33 lines. All except the 10 below read through `readText()`, normalize `\r\n` inline, or search generated text (`hooks-session-start` hook output, `bin-lib/release/subject` composer output).

---

### Task 1: `crlfCheckoutRead` helper + claim-mcp, multi-agent, review-vacuity suites

**Files:**
- Modify: `tests/helpers/read-skill.js`
- Modify: `tests/claim-mcp-projection-conformance.test.js:12` (the `read` arrow → `readText`)
- Modify: `tests/multi-agent-coordination.test.js:10-12` (`readSkillFile` body → `readText(...)`)
- Modify: `tests/review-vacuity-evidence-conformance.test.js:12-78` (the three raw reads at lines 12, 13 and 78 → `readText`)

**Interfaces:**
- Produces: `crlfCheckoutRead(absPath: string): { raw: string, text: string }` exported from `tests/helpers/read-skill.js` beside `readText`. `raw` is `readText(absPath).replace(/\n/g, '\r\n')`. The helper writes it to `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-crlf-'))/<basename>`. `text` is `readText(<that temp file>)`. The temp dir is removed (`fs.rmSync(dir, { recursive: true, force: true })`) in a `finally` before returning.

- [ ] **Step 1: Write the failing CRLF tests**

In each of the three suites, add one test. `FILE` is that suite's searched file:
- claim-mcp: `path.join(ROOT, 'plugin/skills/flow/claim-targets.md')`
- multi-agent: `path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-routing.md')`
- review-vacuity: `path.join(REVIEW, 'step3-routing.md')`

```js
test('<suite subject>: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  // + the suite's own extractor on `text`, below
});
```

Per-suite extractor assertion, added at the comment:
- claim-mcp: `assert.match(paragraphStarting(text, '**Read back the \`bot:in-progress\` add (MCP, #3131).**'), /mergeLabelNames/);`
- multi-agent: `const at = text.indexOf('**Post-dispatch diff audit (mandatory).**'); assert.match(text.slice(at, text.indexOf('\n\n', at)), /post-fan-out (untracked-file )?sweep/i);`
- review-vacuity: `const auto = sectionOf(text, '## Auto mode (severity-based routing)'); assert.match(auto.slice(auto.indexOf('| **Low** |')).split('\n\n')[1], /test-removal override/);`

Each suite also imports `{ readText, crlfCheckoutRead }` from `./helpers/read-skill`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/claim-mcp-projection-conformance.test.js`
Expected: FAIL with `TypeError: crlfCheckoutRead is not a function`

- [ ] **Step 3: Implement `crlfCheckoutRead` and swap the three suites' reads to `readText`**

Add `const os = require('node:os'); const path = require('node:path');` to the helper and export both functions. Add a header-comment line naming #3574. In each suite, replace the raw `fs.readFileSync(<p>, 'utf8')` reads listed in Files with `readText(<p>)`. Drop the `fs` import only if nothing else in the file uses it.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/claim-mcp-projection-conformance.test.js tests/multi-agent-coordination.test.js tests/review-vacuity-evidence-conformance.test.js`
Expected: PASS, `# skipped 0`, `# fail 0`. The test count is the pre-change count + 1 per file.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/read-skill.js tests/claim-mcp-projection-conformance.test.js tests/multi-agent-coordination.test.js tests/review-vacuity-evidence-conformance.test.js
git commit -m "Route three prose suites' paragraph reads through readText — CRLF-safe '\n\n' search, refs #3574"
```

### Task 2: design-wrapper, working-approach, skill-load-report suites

**Files:**
- Modify: `tests/design-wrapper-review-surface-gate-prose.test.js:17-19` (`read` body → `readText(p)`)
- Modify: `tests/working-approach-scope-discipline.test.js:33` (`read` arrow → `readText`)
- Modify: `tests/skill-load-report-cli.test.js:214` (that one raw read → `readText`)

**Interfaces:**
- Consumes: `readText`, `crlfCheckoutRead` from Task 1 (`tests/helpers/read-skill.js`).

- [ ] **Step 1: Write the failing CRLF tests**

Add Task 1's CRLF test shape to each suite, with `FILE` and the extractor assertion below:
- design-wrapper: `FILE = REVIEW_MD`, extractor `assert.match(extractItem6Constraint(text), /^6\. The read-only constraint, verbatim:/);`
- working-approach: `FILE = path.join(ROOT, 'plugin/skills/build/SKILL.md')`, extractor: slice `### Common Step 2: Execute the Plan` to the next `\n### `, then `.slice(indexOf('**Scope and edit discipline (both strategies, every maturity):**')).split('\n\n')[0]`, and assert it includes `'in exactly these words'`.
- skill-load-report-cli: `FILE = path.join(__dirname, '..', 'plugin', 'skills', 'harness-health', 'SKILL.md')`, extractor: the same `start`/`fenceEnd`/`para` slice as the existing harness-health test, asserting `para.includes('top 10')`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/design-wrapper-review-surface-gate-prose.test.js`
Expected: FAIL with `TypeError: crlfCheckoutRead is not a function` (when run before Task 1 lands). After Task 1, the new tests pass on an LF checkout, because the CRLF case does not depend on the suite's own read. The read swap is proven by Step 4's whole-file run and by the Windows dispatch (AC3.1).

- [ ] **Step 3: Swap the three suites' reads to `readText`**

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/design-wrapper-review-surface-gate-prose.test.js tests/working-approach-scope-discipline.test.js tests/skill-load-report-cli.test.js`
Expected: PASS, `# skipped` unchanged from base (skill-load-report-cli carries pre-existing win32/root skips, which must not grow), `# fail 0`.

- [ ] **Step 5: Commit** (`refs #3574`)

### Task 3: ephemeral-server, flow-manifesto, try-it suites + sweep

**Files:**
- Modify: `tests/ephemeral-server-handoff-conformance.test.js` (every `fs.readFileSync(<md>, 'utf8')`: lines 30, 36, 46, 59, 70, 82, 92, 103, 111, 122, 129 → `readText`)
- Modify: `tests/flow-manifesto-ceremony-fallback-conformance.test.js:20` (`read` arrow → `readText`)
- Modify: `tests/try-it-contract-conformance.test.js:11` (`read` arrow → `readText`; line 43's `FIELD_LINE` probe searches no `'\n\n'` and stays as is)

**Interfaces:**
- Consumes: `readText`, `crlfCheckoutRead` from Task 1.

- [ ] **Step 1: Write the failing CRLF tests**

Use Task 1's shape:
- ephemeral: one test looping over `[TASK_PROMPT, path.join(PLUGIN, 'skills', '_shared', 'dev-url-detection.md')]`. Extractors: for TASK_PROMPT, `fencedBlocks(text)[1]` sliced from `'Ephemeral dev server liveness'` to its `indexOf('\n\n', …)` and asserted non-empty and not running to end of block. For dev-url-detection, the `'- **Windows:**'` slice to `indexOf('\n\n', idx)`, asserted to match `/stopped as a tree, not a leader-only kill/` and `!== -1` on the end index.
- flow-manifesto: `FILE = path.join(ROOT, MANIFESTO)`. Extractor: `collapse(text.slice(text.indexOf(LEAD), text.indexOf('\n\n', text.indexOf(LEAD))))` matches `/\*\*Ceremony profile computation\.\*\*/` and is shorter than `collapse(text)`.
- try-it: `FILE = path.join(SKILLS, 'wrap-up/verification-brief-parent-gate.md')`. Extractor: `paragraphAt(text, '**Return to the Try it post').text` includes `` '`incomplete`' ``.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/flow-manifesto-ceremony-fallback-conformance.test.js`
Expected: FAIL with `TypeError: crlfCheckoutRead is not a function` (before Task 1 lands).

- [ ] **Step 3: Swap the reads to `readText`**

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/ephemeral-server-handoff-conformance.test.js tests/flow-manifesto-ceremony-fallback-conformance.test.js tests/try-it-contract-conformance.test.js`
Expected: PASS, `# skipped 0`, `# fail 0`.

- [ ] **Step 5: AC1.1 sweep**

Run the Sites grep above. For every hit, confirm that its searched variable comes from `readText`, an inline `.replace(/\r\n/g, '\n')`, or generated text. Expected: no hit reads raw. Paste the grep output into the task report. It goes in the PR body at the test phase.

- [ ] **Step 6: Commit** (`refs #3574`)

## Spec coverage

| Clause | Covered by |
|---|---|
| Deliverable 1 (route through `readText`) | Tasks 1-3, Step 3 |
| Deliverable 2 (CRLF case per changed test) | Tasks 1-3, Step 1 |
| AC1.1 (sweep grep, recorded in PR body) | Task 3 Step 5; PR body at /test |
| AC2.1 (passes on macOS/Linux, nothing skipped or removed) | Tasks 1-3, Step 4 |
| Deliverable 3, AC3.1/AC3.2 (`windows-regression.yml` on the branch) | Waived AC3.1: operational, not a test step. Dispatched at the test phase after the branch is pushed. Waived AC3.2: a statement about evidence, satisfied by AC3.1's real run |
| AC4.1 (`npm test`) | /build Common Step 5 and /test |
