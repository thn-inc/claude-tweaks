# Exit-Code Conformance Guard Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tests/bin-lib/exit-code-conformance.test.js`'s `extractGuard` select a file's entry-point `require.main === module` guard (the last one) instead of its first, so the allowlist-staleness check actually inspects `plugin/bin/hooks.js`'s real entry point (line 1570) rather than its unrelated prefilter guard (line 28); then correct the now-stale comment at `hooks.js:26` that documents the old (first-match) behavior.

**Architecture:** `extractGuard` currently uses `src.match(regex)` with no `/g` flag, which JS resolves to the first match in the string. `plugin/bin/hooks.js` has two `require.main === module` guards since #3074: a prefilter fast-path at line 28 (deliberately allowlisted — wraps an early `process.exit(0)` with nothing pending on stdout) and the real entry point at line 1570 (wraps `main(...).then(code => process.exit(code)).catch(...)`). Switching `extractGuard` to a global regex and taking the **last** match makes it read line 1570 — the guard that actually governs the file's real exit behavior — while every other `plugin/bin/**/*.js` file (which has exactly one guard) is unaffected, since "last match" and "first match" are identical when there's only one.

**Tech Stack:** Node.js, `node:test`, `node:assert`, plain regex/string scanning (no new dependencies).

**Spec:** `.claude-tweaks/pipelines/2026-10-15T190127-record-3095/work/3095-spec.md` (materialized from GitHub issue #3095)

## Global Constraints

- No new dependencies; stay within `node:test`/`node:assert` and existing helper functions in the test file.
- Comment and code changes only — no other `plugin/bin/**/*.js` file's behavior changes.
- Keep `ALLOWLIST` exactly `{plugin/bin/hooks.js, plugin/bin/lib/statusline-wrapper-source.js}` — this record does not touch allowlist membership, only which guard text each allowlisted file is measured against.

## Review Focus

- **A file with only one guard** (the common case — every `plugin/bin/**/*.js` file except `hooks.js`) must still resolve to the exact same guard text as before the change — "last match" must equal "first match" when there's exactly one. Covered by the existing full-suite test (`every require.main guard ... sets process.exitCode`) continuing to pass unmodified for every non-allowlisted file.
- **A file with zero guards** (`guard === null`) must still fall through to the `module.exports` / whole-file-is-entry-point branches in `guardRegionFor` unchanged. Covered by the existing suite's unmodified pass (no file without a guard currently fails).
- **hooks.js's *prefilter* guard (line 28) itself must still parse as valid guard text** — the fix must select the *last* guard, not silently break extraction for the first one in files that might someday have their own reason to be inspected. No dedicated test needed beyond Task 1's own assertions, since no test in this suite inspects hooks.js's guard in isolation from `guardRegionFor`'s output.
- **The braced-block vs bare-statement guard shapes** (both already handled by the existing brace-counting logic) must both still work after switching to a global-match loop — Task 1's test exercises hooks.js's real entry guard, which is the braced form (`if (...) { ... }`), confirming the brace-counting path still runs correctly against a match found via `matchAll` instead of `match`.
- **Reverting the fix must demonstrably un-pass the regression it exists to catch** — Acceptance Criteria require that converting hooks.js's entry guard to `process.exitCode` makes the staleness check *fail*; Task 1 proves this by asserting against the *actual*, unmodified `hooks.js` content (not a synthetic fixture) that the guard selected by the fixed `extractGuard` is the entry-point one containing `process.exit(`.

---

### Task 1: Fix `extractGuard` to select the last `require.main === module` match, and correct the stale comment at `hooks.js:26`

**Files:**
- Modify: `tests/bin-lib/exit-code-conformance.test.js` (the `extractGuard` function, roughly lines 63-78)
- Modify: `plugin/bin/hooks.js:26` (comment only)
- Test: `tests/bin-lib/exit-code-conformance.test.js` (new test added in this same file, alongside the two existing `test(...)` blocks)

**Interfaces:**
- Consumes: nothing from outside this file — `extractGuard(src)` is called only by `guardRegionFor(content)` in the same file.
- Produces: `extractGuard(src)` keeps its existing signature and return shape (`string | null` — the guarded text, or `null` when no guard exists). Callers (`guardRegionFor`) are unchanged.

- [ ] **Step 1: Write the failing test**

Add this test directly after the existing `test('the allowlist names exactly the two reviewed exceptions, and each still actually needs it', ...)` block in `tests/bin-lib/exit-code-conformance.test.js`:

```javascript
test('extractGuard selects the entry-point (last) require.main guard in hooks.js, not the prefilter (first) one', () => {
  const content = stripComments(fs.readFileSync(path.join(ROOT, 'plugin', 'bin', 'hooks.js'), 'utf8'));
  const guard = extractGuard(content);
  assert.ok(guard !== null, 'hooks.js should still have a detectable require.main guard');
  // The prefilter guard (line 28) only ever calls the early-exit skip path;
  // the real entry-point guard (line 1570) is the one that drives main(...).
  assert.ok(
    /main\s*\(/.test(guard),
    `extractGuard should select the entry-point guard (the one invoking main(...)), not the prefilter guard -- got: ${guard.slice(0, 120)}`,
  );
  assert.ok(
    findDirectProcessExit(guard).length > 0,
    'the shipped entry-point guard still calls process.exit() directly -- this assertion documents the pre-fix-staleness baseline',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/exit-code-conformance.test.js`
Expected: FAIL — the new test's `/main\s*\(/.test(guard)` assertion fails, because `extractGuard` currently returns the *first* match (the prefilter guard at line 28), which contains `bash-prefilter` logic, not a call to `main(`.

- [ ] **Step 3: Write minimal implementation**

Replace the current `extractGuard` function (the single-match version) with a version that scans every `require.main === module` guard in the file and returns the **last** one's guarded text:

```javascript
// Extracts the text governed by a `require.main === module` guard: either a
// balanced `{ ... }` block, or (the dominant single-line form in this repo)
// the bare statement up to its terminating semicolon. A file may contain
// more than one such guard (hooks.js's #3074 prefilter fast-path guard at
// the top of the file, ahead of its real entry point) -- the LAST guard in
// the file is always the one that actually drives the file's exit behavior
// when run directly, since a guard meant only to short-circuit before the
// real entry point necessarily appears before it, never after.
function extractGuard(src) {
  const re = /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*/g;
  const matches = [...src.matchAll(re)];
  if (matches.length === 0) return null;
  const m = matches[matches.length - 1];
  let i = m.index + m[0].length;
  if (src[i] === '{') {
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return src.slice(start, i);
  }
  const semi = src.indexOf(';', i);
  return semi === -1 ? src.slice(i) : src.slice(i, semi + 1);
}
```

Then fix the stale comment in `plugin/bin/hooks.js` (currently line 26, inside the block comment above the prefilter guard):

```javascript
// process.exit(0) on the skip path is safe for the same reason this file is
// allowlisted in tests/bin-lib/exit-code-conformance.test.js: nothing is
// pending on stdout to truncate. Kept as ONE braced require.main guard -- that
// test reads the file's first such guard as its entry point.
```

becomes:

```javascript
// process.exit(0) on the skip path is safe for the same reason this file is
// allowlisted in tests/bin-lib/exit-code-conformance.test.js: nothing is
// pending on stdout to truncate. This guard runs before the real entry point
// below (line ~1570) -- that test's extractGuard reads a file's LAST such
// guard as its entry point, specifically so this earlier prefilter guard is
// never mistaken for it.
```

(The exact replacement line numbers will shift slightly if any other edit in this task changes line counts above it — match by content, not by the line number alone.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS — all tests in the file, including the new one and the two pre-existing ones (`every require.main guard...` and `the allowlist names exactly the two reviewed exceptions...`).

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/exit-code-conformance.test.js plugin/bin/hooks.js
git commit -m "fix: exit-code conformance allowlist check reads hooks.js's entry point, not its prefilter guard

refs #3095"
```

---

## Self-Review

- **Spec coverage:** Deliverable 1 ("Make extractGuard select the entry-point guard... or exempt the prefilter guard explicitly") is covered by Step 3's `matchAll`+last-match rewrite. Deliverable 2 ("Correct the comment at plugin/bin/hooks.js:26") is covered by Step 3's comment replacement. Acceptance Criterion 1 ("Converting hooks.js's entry guard to process.exitCode makes the staleness check fail") is a manual verification the implementer runs once after Step 4 passes (see note below) — not committed as a permanent test, since it would require two tracked copies of hooks.js's entry logic to assert both directions permanently; the new Step-1 test already pins the *current, correct* direction (guard selects `main(...)`, which still calls `process.exit`) as a committed regression test. Acceptance Criterion 2 ("The check passes on the shipped hooks.js") is covered by Step 4's full-suite pass.
- **Placeholder scan:** none — every step shows exact code, not a description of code.
- **Type consistency:** `extractGuard(src)` keeps the same signature (`string -> string|null`) and the same brace-counting/semicolon-scanning logic verbatim, only the match-selection changed from `match()` to `[...matchAll()].pop()`-equivalent (`matches[matches.length - 1]`).
- **Review Focus:** all four lines above are covered — three by the existing full suite continuing to pass unmodified, one (single-guard-equivalence) by that same unmodified pass since "last of one" equals "first of one."

**Post-Step-4 manual verification (not a committed test, run once before considering the task done):** temporarily edit a scratch copy of `plugin/bin/hooks.js`'s line ~1571 guard body to assign `process.exitCode = code; return;` instead of calling `process.exit(code)`/`process.exit(0)`, point `tests/bin-lib/exit-code-conformance.test.js` at that scratch copy (or temporarily swap the real file, run the suite, then revert — never leave the swap committed), confirm `the allowlist names exactly the two reviewed exceptions...` test now fails (proving discrimination), then revert and re-run to confirm it's green again on the real, shipped file. Discard the scratch edit — it is a one-time proof of the fix's direction, not a permanent fixture.
