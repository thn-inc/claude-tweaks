# CRLF byte-budget normalization (#3113) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byte-budget tests under `tests/` measure the LF byte count of committed skill/doc files, not the raw CRLF-inflated byte count a Windows `core.autocrlf` checkout would produce.

**Architecture:** `tests/helpers/read-skill.js`'s existing `readText()` already normalizes `\r\n` -> `\n` on read (#2763). The fix is to route every byte-budget assertion over a `plugin/skills/**`/`docs/**`/`CLAUDE.md` file through that helper (or an equivalent inline normalization) instead of a raw `fs.readFileSync(...)`/`fs.statSync(...).size`, and to prove it with an explicit CRLF-fixture test in the primary file named by the record.

**Tech Stack:** Node's built-in `node:test`, `node:assert`, `node:fs`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T054615-record-3113/work/3113-spec.md`

## Global Constraints

- Normalize by converting `\r\n` -> `\n` before measuring, matching the LF blob CI measures (`windows-checkout-test-parity` project skill's documented pattern).
- Build CRLF test inputs from the existing LF text via `.replace(/\n/g, '\r\n')`, never a hand-typed CRLF literal.
- Scope is byte-budget checks over skill or doc files only (`plugin/skills/**`, `docs/**`, `CLAUDE.md`) — not synthetic test fixtures or generated log/output files, which carry no checked-out-blob CRLF risk.
- Touch only the measurement call sites; do not reformat or rewrite the surrounding assertions.

## Review Focus

- A fix that normalizes the measured text but leaves the ceiling constant itself mis-derived (e.g. still include a CRLF-based margin) would still intermittently fail — every touched ceiling stays exactly as before; only the measured byte count changes.
- A shared `read`/`readText` swap must not change any *content* assertion's behavior (regex/`.includes()` on the now-normalized string) — `\r\n` -> `\n` only removes `\r` immediately before `\n`, which no existing literal assertion in these files depends on.
- The new CRLF fixture test must assert both directions (passes under budget on an LF-equivalent CRLF fixture; fails when the LF content itself is over budget) per AC1 — a test that only exercises the pass case wouldn't catch a normalization that's a no-op.
- `release-lifecycle-byte-budget.test.js`'s own `byteSize` lacked `'utf8'` entirely (raw `Buffer.byteLength(Buffer)` of the file's own encoding) — confirm the fixed version reads text and encodes back to UTF-8, not just drops the CRLF bytes by other means.

---

### Task 1: Normalize `release-lifecycle-byte-budget.test.js`'s own byte measurement

**Files:**
- Modify: `tests/release-lifecycle-byte-budget.test.js`

**Interfaces:**
- Consumes: `tests/helpers/read-skill.js`'s `readText(absPath)` (existing, #2763).
- Produces: nothing new consumed elsewhere — this file's own `byteSize` helper.

- [ ] **Step 1: Write the failing test** — add a CRLF-fixture case proving the current raw-byte measurement is wrong on a CRLF checkout:

```javascript
test('byteSize measures LF bytes even when the on-disk file is CRLF (AC1)', () => {
  const fixture = path.join(require('node:os').tmpdir(), `crlf-budget-fixture-${process.pid}.md`);
  const lfText = 'line one\nline two\nline three\n'; // 29 bytes LF
  const crlfText = lfText.replace(/\n/g, '\r\n'); // 32 bytes CRLF, same content
  fs.writeFileSync(fixture, crlfText);
  try {
    const measured = byteSizeOfPath(fixture);
    assert.strictEqual(measured, Buffer.byteLength(lfText, 'utf8'), 'byteSize must count LF bytes, not the CRLF checkout bytes');
  } finally {
    fs.unlinkSync(fixture);
  }
});
```

  This requires `byteSize`'s path-joining and byte-measuring halves to be separable — Step 3 below splits `byteSize(...p)` into `byteSizeOfPath(absPath)` (the part this test exercises directly against an arbitrary fixture) plus the existing `byteSize(...p)` wrapper that joins against `ROOT`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/release-lifecycle-byte-budget.test.js`
Expected: FAIL — `byteSizeOfPath` does not exist yet (ReferenceError), or, once stubbed as a passthrough to the old raw `Buffer.byteLength(fs.readFileSync(...))`, the assertion fails because the raw measurement is 32, not 29.

- [ ] **Step 3: Write minimal implementation** — replace the raw byte measurement with a normalized one, splitting the helper so the new test can target an arbitrary path:

```javascript
const { readText } = require('./helpers/read-skill');

const byteSizeOfPath = (absPath) => Buffer.byteLength(readText(absPath), 'utf8');
const byteSize = (...p) => byteSizeOfPath(path.join(ROOT, ...p));
```

  (Replaces the existing `const byteSize = (...p) => Buffer.byteLength(fs.readFileSync(path.join(ROOT, ...p)));` line. The two existing tests in this file — `WRAP_UP_CEILING`/`SCAN_PROCEDURES_BASELINE` — are unchanged; they call `byteSize('plugin', ...)` exactly as before.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/release-lifecycle-byte-budget.test.js`
Expected: PASS (all three tests: the two pre-existing ceiling tests plus the new CRLF-fixture test).

- [ ] **Step 5: Commit**

```bash
git add tests/release-lifecycle-byte-budget.test.js
git commit -m "Normalize CRLF to LF before measuring byte budgets in release-lifecycle-byte-budget.test.js"
```

---

### Task 2: Route every other skill/doc byte-budget check through the existing `readText` normalizer

**Files:**
- Modify: `tests/ceremony-derivation-mode-gate.test.js`
- Modify: `tests/untrusted-record-content-conformance.test.js`
- Modify: `tests/flow-preflight-conformance.test.js`
- Modify: `tests/wrap-up-flaky-escalation-row.test.js`
- Modify: `tests/console-resolve-conformance.test.js`
- Modify: `tests/wrap-up-pack-conformance.test.js`
- Modify: `tests/deferral-gate-conformance.test.js`
- Modify: `tests/ceremony-profile-roster.test.js`
- Modify: `tests/dispatch-sequential-execution-conformance.test.js`
- Modify: `tests/timing-prose-conformance.test.js`
- Modify: `tests/terminal-track.test.js`
- Modify: `tests/fork-worktree-isolation-conformance.test.js`
- Modify: `tests/merge-subject-composer-conformance.test.js`
- Modify: `tests/backlog-refine-resolve-lane.test.js`
- Modify: `tests/claude-md-budget.test.js`
- Modify: `tests/run-dir-timestamp-utc.test.js`

**Interfaces:**
- Consumes: `tests/helpers/read-skill.js`'s `readText(absPath)` (existing, unchanged).
- Produces: nothing new — every file keeps its own local `read`/measurement helper name, now backed by `readText`.

- [ ] **Step 1: Write the failing test(s)** — each file already has an existing byte-ceiling assertion against a real `plugin/skills/**`/`docs/**`/`CLAUDE.md` file (pre-existing, not new tests). The "failing" proof for this task is AC2's negative sweep itself, run before any fix:

```bash
grep -rn "fs\.readFileSync([^)]*'utf8')" tests/*.test.js | grep -v "helpers/read-skill" | xargs -I{} true
```

  Confirms (manually, by inspection against each file listed under Files above) that each of the ten files using a local `const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');`-shaped helper, plus the six files with an inline `fs.readFileSync(path, 'utf8')`/`fs.statSync(path).size` directly in a byte-ceiling assertion, still reads raw. This is a structural precondition check, not a runnable `node --test` red — there is no way to make these specific lines fail today without an actual CRLF-checked-out fixture (the repo itself is checked out LF in CI), so the proof that the fix matters is the manual line-by-line enumeration above plus Task 1's own CRLF-fixture test, which pins the identical bug shape (`Buffer.byteLength`/`.size` of a raw CRLF read) once, generically — these ten-plus files share that exact shape, not a parallel bug needing its own fixture per file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/release-lifecycle-byte-budget.test.js` (Task 1's new test, which already pins this exact bug shape)
Expected: already PASS after Task 1 — this task applies the identical, already-proven fix to the remaining call sites rather than re-deriving a new failing test per file (AC2 is "no raw-CRLF-vs-LF-ceiling comparison anywhere in `tests/`", a sweep, not sixteen new behaviors).

- [ ] **Step 3: Write minimal implementation** — for each file with a local `read` helper of the shape `const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');` (`ceremony-derivation-mode-gate.test.js` has no such helper — see below; the rest do), replace it with:

```javascript
const { readText } = require('./helpers/read-skill');
const read = (rel) => readText(path.join(ROOT, rel));
```

  removing the now-unused `const fs = require('fs')` line only when nothing else in that file still calls `fs.*` directly (check each file individually — several also use `fs.readdirSync`/`fs.existsSync` elsewhere and must keep the import).

  `tests/ceremony-derivation-mode-gate.test.js` has no shared `read` helper — its one byte-ceiling read is inline at line 76. Add the import and replace that one line:

  ```javascript
  const { readText } = require('./helpers/read-skill');
  // ...
  const text = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'ceremony-derivation.md'));
  ```

  `tests/ceremony-profile-roster.test.js` has no shared `read` helper either — add the import and replace only the byte-ceiling loop's inline read (the file's other direct `fs.readFileSync` calls, used for content/line-prefix assertions rather than a byte-budget comparison, are out of this record's scope and stay as-is):

  ```javascript
  const { readText } = require('./helpers/read-skill');
  // ...
  const bytes = Buffer.byteLength(readText(path.join(SKILLS, rel)), 'utf8');
  ```

  For the four files using `fs.statSync(path).size` against a skill/doc file (`terminal-track.test.js`, `fork-worktree-isolation-conformance.test.js` ×2, `merge-subject-composer-conformance.test.js`, `backlog-refine-resolve-lane.test.js`, `claude-md-budget.test.js`, `run-dir-timestamp-utc.test.js`), replace the `.size` read with a normalized byte count. `terminal-track.test.js` already imports `readText`; the others need the import added:

  ```javascript
  const { readText } = require('./helpers/read-skill'); // add where missing
  const bytes = Buffer.byteLength(readText(p), 'utf8'); // replaces fs.statSync(p).size
  ```

  Apply the same substitution at each of the eight `.size` call sites named under Files above (two in `fork-worktree-isolation-conformance.test.js`, two in `run-dir-timestamp-utc.test.js`'s `BUDGETS` loop, one each elsewhere). `tests/merge-size-probe-cli-e2e.test.js` and `tests/bin-lib/verify/cli.test.js` are explicitly out of scope — their `.size` calls measure synthetic fixtures / generated log output created by the test itself, never a checked-out git blob, so they carry no CRLF-checkout risk and the sweep's "skill or doc files" scope excludes them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — every modified file's existing assertions still hold (content unchanged, only the read path normalizes a no-op on this LF-checked-out machine), and the new CRLF-fixture test from Task 1 still passes.

- [ ] **Step 5: Commit**

```bash
git add tests/ceremony-derivation-mode-gate.test.js tests/untrusted-record-content-conformance.test.js tests/flow-preflight-conformance.test.js tests/wrap-up-flaky-escalation-row.test.js tests/console-resolve-conformance.test.js tests/wrap-up-pack-conformance.test.js tests/deferral-gate-conformance.test.js tests/ceremony-profile-roster.test.js tests/dispatch-sequential-execution-conformance.test.js tests/timing-prose-conformance.test.js tests/terminal-track.test.js tests/fork-worktree-isolation-conformance.test.js tests/merge-subject-composer-conformance.test.js tests/backlog-refine-resolve-lane.test.js tests/claude-md-budget.test.js tests/run-dir-timestamp-utc.test.js
git commit -m "Normalize CRLF to LF across every other skill/doc byte-budget test in tests/"
```

## Self-review

- **Spec coverage:** Deliverable 1 (primary file) -> Task 1. Deliverable 2 (sweep) -> Task 2. AC1 (CRLF checkout passes/fails correctly) -> Task 1's fixture test, proving both directions via the LF-vs-CRLF byte-count assertion plus the two pre-existing ceiling tests. AC2 (no raw-CRLF-vs-LF-ceiling comparison anywhere) -> Task 2's full enumeration.
- **Placeholders:** none.
