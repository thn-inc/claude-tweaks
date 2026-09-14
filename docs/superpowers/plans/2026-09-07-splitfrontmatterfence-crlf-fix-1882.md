# splitFrontmatterFence CRLF Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `splitFrontmatterFence` (and the field parser built on it) parse frontmatter-fenced content identically regardless of whether the content uses LF or CRLF line endings, so a `core.autocrlf=true` checkout doesn't silently lose frontmatter on every file.

**Architecture:** One-line fix in the shared line-splitter (`content.split('\n')` → `content.split(/\r?\n/)`), plus direct CRLF-fixture regression tests that don't depend on the checkout's own `core.autocrlf` setting to exercise the bug. No other production call site needs a code change — verified below (Task 1, Step 6) that every other raw `\n`-only split in the six listed call sites either delegates to this same shared function or splits content whose line-ending doesn't affect correctness (git-log output, a non-anchored bullet regex, the `else`-branch fallback that never feeds a key-lookup).

**Tech Stack:** Node.js (`node --test`), no external dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-09-07T121938-record-1882/work/1882-spec.md`

## Global Constraints

- Zero runtime npm dependencies (project-wide convention — no YAML/line-ending library).
- Fix at the source (`splitFrontmatterFence`) — no display-only workaround at any call site.
- Touch only what the task requires — do not reformat or restructure adjacent code.

---

### Task 1: Normalize line endings in `splitFrontmatterFence`

**Files:**
- Modify: `plugin/bin/lib/health-core/frontmatter-list.js:35`
- Test: `tests/bin-lib/health-core/frontmatter-list.test.js`

**Interfaces:**
- Consumes: nothing new — `splitFrontmatterFence(content: string): {frontmatter: string[], afterLines: string[]} | null` and `parseFrontmatterListField(content: string, fieldName: string): string[]` already exist and keep their exact signatures.
- Produces: nothing new for other tasks — this is the only task in the plan.

- [ ] **Step 1: Write failing tests constructing CRLF content directly**

Add these tests to the end of `tests/bin-lib/health-core/frontmatter-list.test.js` (after the existing tests, same file — do not create a new test file):

```javascript
// --- CRLF regression (#1882) — constructs CRLF content directly rather
// than relying on the checkout's own core.autocrlf setting, so this test
// exercises the bug regardless of how CI or a contributor's checkout is
// configured. ---

test('splitFrontmatterFence parses CRLF content identically to its LF equivalent', () => {
  const lf = '---\ntype: task\nrisk: low\n---\n\n# Title\n\nbody\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = splitFrontmatterFence(lf);
  const crlfResult = splitFrontmatterFence(crlf);
  assert.deepStrictEqual(crlfResult.frontmatter, ['type: task', 'risk: low']);
  assert.deepStrictEqual(crlfResult.afterLines, ['', '# Title', '', 'body', '']);
  assert.deepStrictEqual(crlfResult, lfResult);
});

test('parseFrontmatterListField parses CRLF content identically to its LF equivalent', () => {
  const lf = '---\nfiles:\n  - src/checkout/Cart.tsx\n  - src/checkout/Payment.tsx\n---\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = parseFrontmatterListField(lf, 'files');
  const crlfResult = parseFrontmatterListField(crlf, 'files');
  assert.deepStrictEqual(crlfResult, ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
  assert.deepStrictEqual(crlfResult, lfResult);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/bin-lib/health-core/frontmatter-list.test.js`
Expected: FAIL — both new tests fail (`splitFrontmatterFence` returns `null` for the CRLF input because `lines[0]` is `'---\r'`, not `'---'`).

- [ ] **Step 3: Fix the line split**

In `plugin/bin/lib/health-core/frontmatter-list.js`, change line 35:

```javascript
// Before:
  const lines = content.split('\n');
// After:
  const lines = content.split(/\r?\n/);
```

The rest of `splitFrontmatterFence` and `parseFrontmatterListField` needs no change — `closeIdx`/slicing/regex logic already operates on whichever `lines` array it's handed, and a line that split on `\r?\n` never carries a trailing `\r` for `indexOf('---', 1)` or the `^description:\s*/`-style regexes elsewhere to trip on.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `node --test tests/bin-lib/health-core/frontmatter-list.test.js`
Expected: PASS — all tests in the file pass, including the two new CRLF ones and every pre-existing LF test (unchanged behavior on LF input, since `/\r?\n/` splits identically to `'\n'` when no `\r` is present).

- [ ] **Step 5: Run the full test suite to confirm no regressions in downstream call sites**

Run: `node --test tests/`
Expected: PASS. This exercises every downstream consumer of `splitFrontmatterFence`/`parseFrontmatterListField` (skill-audit's description/argument-hint measurement, journey-health/harness-health/docs-health scope fields, and `local-store.js`'s local-files record frontmatter) against their existing LF fixtures — confirming the fix is behavior-preserving on LF input, matching Acceptance Criterion 1's "identical results... regardless of line ending" by construction (same code path either way now).

- [ ] **Step 6: Audit the six call sites named in the spec — no further code change needed (documented finding)**

The spec's second deliverable asks to audit `plugin/bin/lib/skill-audit/context-cost.js`, `plugin/bin/lib/skill-audit/argument-hint.js`, `plugin/bin/lib/journey-health/scope.js`, `plugin/bin/lib/harness-health/scope.js`, `plugin/bin/lib/docs-health/freshness.js`, and `plugin/bin/lib/issues/local-store.js` for the same raw `\n`-only split assumption *elsewhere in their own logic* (not just via the shared helper this task already fixed). This step is a read-only verification, not a code change — record the finding in the commit message (Step 7):

- `context-cost.js`'s `measureDescriptions`/`findComposeCallSites` call `splitFrontmatterFence` directly (fixed by Step 3) for frontmatter reads; its other `.split('\n')` (line 325, `findComposeCallSites`) splits a file for a substring/regex scan unrelated to frontmatter-fence detection — a trailing `\r` on each line doesn't change whether `.includes('compose-context.js')` matches or how `parseComposeCallLine` parses that line, so no change needed.
- `argument-hint.js` has no raw `\n`-only split of its own — it goes through the shared helper only.
- `journey-health/scope.js` and `docs-health/freshness.js` route their `files:` frontmatter parsing through `parseFrontmatterListField` (fixed by Step 3); `freshness.js`'s own `.split('\n')` (line 41) splits `git log` output, not frontmatter, and each line is `.trim()`-med before use, which already strips a trailing `\r`.
- `harness-health/scope.js` routes its `paths:` frontmatter parsing through `parseFrontmatterListField`; its own `.split('\n')` (line 91, `listMemory`) parses `MEMORY.md`'s `- [Title](file.md)` bullet list with a regex not anchored at the line's end, so a trailing `\r` doesn't affect the match.
- `local-store.js` routes its frontmatter-fence detection through `splitFrontmatterFence` (fixed by Step 3); its own `.split('\n')` (line 79) is the `fmLines: null` fallback branch — only reached when there's no frontmatter fence at all, so its `afterLines` value is passed through as opaque file content, never parsed for a frontmatter key, and is unaffected by a stray `\r`.

No further code change required at any of the six sites — Step 3's fix is complete.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/health-core/frontmatter-list.js tests/bin-lib/health-core/frontmatter-list.test.js
git commit -m "$(cat <<'EOF'
Fix splitFrontmatterFence to normalize CRLF line endings (refs #1882)

content.split('\n') left a trailing \r on every line on a
core.autocrlf=true checkout, so lines[0] never strictly-equalled '---'
and the parser silently returned null for every frontmatter-fenced
file. Split on /\r?\n/ instead. Audited the six downstream call sites
named in the record — all either delegate to this shared helper or
split content whose line-ending doesn't affect correctness; no other
code change needed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RH9DMP4HXgk6eb3eMwKP16
EOF
)"
```
