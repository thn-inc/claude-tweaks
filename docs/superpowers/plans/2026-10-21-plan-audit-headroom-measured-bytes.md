# Plan-audit headroom measured bytes (#3459) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `headroomCheck` measures each governed `.md` file the way the Read rail does (CRLF-normalized, `when:` marker lines stripped) instead of with raw `fs.statSync().size`.

**Architecture:** Reuse `context-cost.js`'s `measuredBytes(file)`, the function `rail.js`'s `measureSkills`/`measureSubFiles` already go through, in place of the `statSync` call. Return shape of `headroomCheck` is unchanged (`breaches: [{file, bytes}]`, `nearCeiling: [{file, bytes, headroom}]`); only the number in `bytes` changes for files that carry markers or CRLF.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T104358-record-3459/work/3459-spec.md` (materialized from GitHub issue #3459)

Premise-refs: plugin/bin/lib/plan-audit/checks.js
Premise-refs: plugin/bin/lib/skill-audit/context-cost.js
Premise-refs: plugin/bin/lib/skill-audit/rail.js
Premise-refs: plugin/bin/lib/compose-context/compose.js

## Global Constraints

- Reuse `context-cost.js`'s measurement; never re-implement marker stripping or CRLF normalization in `checks.js`.
- The rail value is `RAIL_BYTES` from `plugin/bin/lib/skill-audit/budgets.js` (52,500 B) — never a literal in the test or the code.
- `headroomCheck`'s return shape stays as-is (no new keys) — plan-audit's JSON-envelope consumers read it.

## Review Focus

1. A governed file with a malformed `when:` marker — `measuredBytes` returns the CRLF-normalized, unstripped byte count plus `markerError` and never throws; `headroomCheck` must still report a breach on that count, not drop the file. Covered by the AC2-style raw path (unstripped count is the fallback); no extra test — the fallback lives in `context-cost.js` and is already tested there.
2. A plan entry naming a governed path that does not exist — `readFileSync` throws `ENOENT` inside `measuredBytes`; the existing `try/catch … continue` must still swallow it (Check A reports missing paths). Existing test `headroomCheck ignores Create entries` plus the unchanged catch keep this; verify the catch still wraps the new call.
3. Existing all-`x`, newline-free fixtures — measured bytes equal raw bytes, so every existing headroom test's exact `bytes`/`headroom` assertions stay green unchanged.

Verified (sole caller): `grep -rn "headroomCheck(" plugin/` → only `plugin/bin/plan-audit.js` and the definition; signature is unchanged so no caller edit.

---

### Task 1: Measure headroom with the rail's marker-stripped, CRLF-normalized bytes

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js:11` (import) and `:495-521` (`headroomCheck` comment + measurement)
- Test: `tests/bin-lib/plan-audit/checks.test.js` (headroom section, after the `#3310` test ending near line 784)

**Interfaces:**
- Consumes: `measuredBytes(file: string) -> { bytes: number, markerError?: string }` from `plugin/bin/lib/skill-audit/context-cost.js` (already exported).
- Produces: nothing new — `headroomCheck(entries, repoRoot, deps)` keeps its signature and return shape.

- [ ] **Step 1: Write the failing tests**

Add after the `#3310` test in `tests/bin-lib/plan-audit/checks.test.js`, reusing the file's existing `makeTmpRepo()` and `fs`/`path` imports:

```js
// #3459 — headroomCheck measures like the Read rail (context-cost.js's
// measuredBytes): `when:` marker lines stripped, CRLF normalized to LF.
const MARKER_PAIR = '<!-- when: mode=auto -->\n<!-- /when -->\n';

function headroomFor(content) {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/demo/measured.md';
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  try {
    return { raw: fs.statSync(abs).size, result: headroomCheck([{ type: 'Modify', path: rel }], repo) };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('AC1.1: a file RAIL_BYTES + 100 raw, carrying > 100 B of when-marker lines, reports no breach (#3459)', () => {
  const markers = MARKER_PAIR.repeat(4);
  assert.ok(Buffer.byteLength(markers) > 100);
  const { raw, result } = headroomFor(markers + 'x'.repeat(RAIL_BYTES + 100 - Buffer.byteLength(markers)));
  assert.strictEqual(raw, RAIL_BYTES + 100);
  assert.deepStrictEqual(result.breaches, []);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nearCeiling[0].bytes, RAIL_BYTES + 100 - Buffer.byteLength(markers));
});

test('AC2.1: the same file with its marker lines removed, padded to stay over RAIL_BYTES, still breaches (#3459)', () => {
  const { result } = headroomFor('x'.repeat(RAIL_BYTES + 100));
  assert.strictEqual(result.breaches.length, 1);
  assert.strictEqual(result.breaches[0].bytes, RAIL_BYTES + 100);
  assert.strictEqual(result.ok, false);
});

test('AC3.1: a CRLF copy of a file at exactly RAIL_BYTES LF bytes reports no breach (#3459)', () => {
  let lf = ('x'.repeat(99) + '\n').repeat(Math.floor(RAIL_BYTES / 100));
  lf += 'x'.repeat(RAIL_BYTES - Buffer.byteLength(lf));
  assert.strictEqual(Buffer.byteLength(lf), RAIL_BYTES);
  const { raw, result } = headroomFor(lf.replace(/\n/g, '\r\n'));
  assert.ok(raw > RAIL_BYTES, 'CRLF fixture must be over the rail raw');
  assert.deepStrictEqual(result.breaches, []);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nearCeiling[0].bytes, RAIL_BYTES);
});
```

(AC4.1 — `npm test` passes — is Step 4's full-suite run, not a unit test.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3459" tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL — AC1.1 and AC3.1 fail (raw `statSync` size reports a breach: `breaches` has one entry); AC2.1 passes (control — marker-free, LF-only content measures the same either way).

- [ ] **Step 3: Implement in `plugin/bin/lib/plan-audit/checks.js`**

- Line 11: extend the existing destructure to `const { composedBytesReport, measuredBytes } = require('../skill-audit/context-cost');`
- In `headroomCheck`, replace `bytes = fs.statSync(abs).size;` with `bytes = measuredBytes(abs).bytes;` — keep it inside the existing `try { … } catch { continue; }` so a missing path is still skipped.
- Add one sentence to the comment block directly above `headroomCheck` (line 495-497): per-file bytes come from `context-cost.js`'s `measuredBytes` — CRLF-normalized, `when:` marker lines stripped — the same measurement the Read rail (`rail.js`) uses, so plan-audit never stops on a file the `rail:` tests would pass (#3459).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS (all headroom tests, old and new).

Then the full suite (AC4.1), run centrally by `/build` Common Step 5 via the verification runner (output to a `.txt` file in the session scratchpad, never `/tmp` or a `.log` path).
Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "Measure plan-audit headroom like the Read rail — marker-stripped, CRLF-normalized bytes

refs #3459"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (reuse `context-cost.js` measurement) → Step 3; Deliverable 2 (marker fixture + CRLF variant) → Step 1. AC1.1, AC2.1, AC3.1 → Step 1 test names; AC4.1 → Step 4 full suite.
- **Inline self-consistency:** fixtures run against `measuredTextBytes` in a scratch script before finalizing — AC1 measured 52,440 (no breach), AC2 52,600 (breach), AC3 raw 53,025 / measured 52,500 (no breach).
- **Return shape:** unchanged; no consumer edits needed.
- **Placeholders:** none.
