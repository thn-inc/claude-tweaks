# SDD-ruling `sdd-ruling-unreadable` reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the SDD-ruling deferral gate folding "the staged file could not be read" into `sdd-ruling-unclassified`; name it `sdd-ruling-unreadable` (with a cause on the reconciler path) at both trigger points, still withheld.

**Architecture:** `sddRulingDeferralReason(text)` stays a pure header classifier. The two callers that know a read was attempted decide `UNREADABLE` before calling it: `console/resolve.js`'s `stagedItems` (via a new `readError` flag `readSnapshot` sets) and `reconcile/console-execute.js`'s `decideConsoleExecute` (via a new `ctx.rulingReadErrors` map that `readRulingTexts` now returns alongside the texts). The reconciler's read stops using path-guard's `resolveWithin` (which returns one `null` for a missing leaf and an escaping one) and calls `canonicalRealpath`/`resolveLeaf`/`isAncestorOrSelf` directly to tell the causes apart.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T110929-spec-4049/work/4049-spec.md`

## Global Constraints

- `SDD_RULING_REASONS.NO_DEFER_REASON` stays `'sdd-ruling-deferral-no-defer-reason'` and `UNCLASSIFIED` stays `'sdd-ruling-unclassified'`; the new member is exactly `UNREADABLE: 'sdd-ruling-unreadable'`.
- The four reconciler causes are exactly the strings `no-staged-path`, `path-rejected`, `not-found`, `read-failed`.
- `sddRulingDeferralReason(null)` / `(undefined)` keep returning `'sdd-ruling-unclassified'`.
- `plugin/bin/lib/path-guard/index.js` is read only — `resolveWithin`'s `string|null` contract does not change.
- Fail closed: every input that withholds a ruling row today still withholds it. Nothing that is a gap today stops being a gap.
- No reason value is renamed or removed; `detail` is an optional, additive key on a `rulingGateGaps` element. Not a breaking change.
- Never write the literal placeholder tokens the spec-shaped-body check scans for in authored prose.

## Review Focus

- A ruling row whose `stagedPath` points through a **directory symlink to a nonexistent file outside the run dir** (`linked/missing.md`, `linked` → outside): `resolveLeaf` reports `missing`, so it lands as `not-found`, not `path-rejected`. Expected and acceptable — the file does not exist, the row is withheld either way. Pinned in Task 2's detect test so a later "fix" cannot silently flip it to a non-gap.
- An item id that is an inherited `Object.prototype` key (`'constructor'`, `'__proto__'`): `decideConsoleExecute` must look the id up with an own-property check (or accept only a string value), or a ruling row named `constructor` reads `Object.prototype.constructor` as a cause. Pinned in Task 2.
- A staged `sdd-ruling-*` name `readSnapshot` never reads (a non-`.md` extension, e.g. `sdd-ruling-1.txt`): its `text` is `null` by construction, not because a read failed — it must stay `sdd-ruling-unclassified`. Pinned in Task 1.
- `ctx.rulingReadErrors` passed with no `ctx.rulingTexts`: the legacy guard (no `rulingTexts` → `rulingGateGaps: []`) keeps keying on `rulingTexts` alone. Pinned in Task 2.
- The run dir itself failing to canonicalize (deleted mid-scan): `read-failed`, never `path-rejected` and never a non-gap. Covered by the implementation note in Task 2 Step 3; no fs fixture can delete the run dir between `readConsoleJson` and the ruling read without racing, so it is stated, not tested.

---

### Task 1: Console-resolve path — `UNREADABLE` reason and the `readError` flag

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:215-224` (`SDD_RULING_REASONS`), `:309-317` (`readSnapshot`'s staged map), `:440-443` (`stagedItems`' `sdd-ruling-` branch)
- Test: `tests/bin-lib/console/resolve.test.js:821-826` (update) and new tests after `:826`

**Interfaces:**
- Produces: `SDD_RULING_REASONS.UNREADABLE === 'sdd-ruling-unreadable'` (exported from `plugin/bin/lib/console/resolve.js`; Task 2 imports it). `readSnapshot`'s `staged[]` entries gain `readError: boolean` — `true` only when a read was attempted (`.patch` / `.md` / shadow-dup name) and `deps.readFile` threw.

- [ ] **Step 1: Write the failing tests**

Replace the `SDD_RULING_REASONS` deep-equal line inside the existing test `'sddRulingDeferralReason: unreadable text is unclassified, and Defers: matches case-insensitively (#3880)'` and rename that test, then add two tests after it:

```js
test('AC1.1 AC2.1: SDD_RULING_REASONS gains UNREADABLE; sddRulingDeferralReason(null|undefined) stays unclassified (#4049)', () => {
  assert.strictEqual(sddRulingDeferralReason(null), 'sdd-ruling-unclassified');
  assert.strictEqual(sddRulingDeferralReason(undefined), 'sdd-ruling-unclassified');
  assert.strictEqual(sddRulingDeferralReason('Defers: YES\nDefer-reason: blocked-dependency\n\nx'), null);
  assert.deepStrictEqual(SDD_RULING_REASONS, {
    NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason',
    UNCLASSIFIED: 'sdd-ruling-unclassified',
    UNREADABLE: 'sdd-ruling-unreadable',
  });
});

test('AC6.1 AC2.2: an sdd-ruling-*.md whose read throws resolves pending — sdd-ruling-unreadable, even when its content would ratify (#4049)', () => {
  const runDir = fixture({ staged: { 'sdd-ruling-1.md': RULING('Defers: no\n') }, headers: [7] });
  const failing = deps({
    readFile: (p) => {
      if (path.basename(p) === 'sdd-ruling-1.md') { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
      return fs.readFileSync(p, 'utf8');
    },
  });
  const item = resolveAll({ runDir, policy: 'console-auto', deps: failing }).items.find((i) => i.id === 'sdd-ruling-1.md');
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-unreadable');
});

test('AC6.2: control — a readable ruling with no Defers: line, and an sdd-ruling-* name readSnapshot never reads, both stay unclassified (#4049)', () => {
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('')).reason, 'sdd-ruling-unclassified');
  const item = resolveStaged('sdd-ruling-1.txt', RULING('Defers: no\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-unclassified');
});
```

The `AC6.2` test is a control (it passes before and after) — the orthogonal case proving a non-attempted read is not reclassified. The two tests above it are the behavior tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 — `AC1.1 AC2.1` fails the deep-equal (no `UNREADABLE` key); `AC6.1 AC2.2` fails with `'sdd-ruling-unclassified' !== 'sdd-ruling-unreadable'`. `AC6.2` passes.

- [ ] **Step 3: Implement**

- Add `UNREADABLE: 'sdd-ruling-unreadable',` to the frozen `SDD_RULING_REASONS` object, and one comment line above it: `UNREADABLE` is decided by the callers that attempted the read (`stagedItems` here, `decideConsoleExecute` in `reconcile/console-execute.js`), never by `sddRulingDeferralReason`, which only ever sees text (#4049).
- In `readSnapshot`, replace the inline `text: … ? readText(…) : null` with a per-entry read that records whether an attempted read threw: entries for `.patch` / `.md` / shadow-dup names call `deps.readFile` in a `try`, setting `text` on success and `readError: true` on a throw; every other entry gets `text: null, readError: false`. Keep `readText` (other callers use it).
- In `stagedItems`' `if (/^sdd-ruling-/.test(s.name))` branch: `const r = s.readError ? SDD_RULING_REASONS.UNREADABLE : sddRulingDeferralReason(s.text);` — the rest of the branch unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (whole file — the existing `#3880` ruling tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Name a failed staged-file read sdd-ruling-unreadable on the console-resolve path — #4049"
```

---

### Task 2: Reconciler path — report why the read failed, emit `{ reason: 'sdd-ruling-unreadable', detail }`

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js:37-38` (requires), `:217-245` (`readRulingTexts`, `readInsideRunDir` and their comment), `:262-272` (`decideConsoleExecute`'s ctx doc comment), `:350-361` (ruling-gap loop), `:432-433` (`consoleExecuteDetect`'s `ctx.rulingTexts` assignment)
- Test: `tests/console-execute.test.js:550-560`, `:603-679` (update) and new tests in the `#3880: rulingGateGaps` block

**Interfaces:**
- Consumes: `SDD_RULING_REASONS.UNREADABLE` from Task 1 (`require('../console/resolve')`); `canonicalRealpath(p)`, `resolveLeaf(p)` → `{state: 'resolved', path} | {state: 'dangling'} | {state: 'missing', code} | {state: 'unreadable', code}`, `isAncestorOrSelf(ancestor, candidate)` from `plugin/bin/lib/path-guard` (all already exported).
- Produces: `readRulingTexts(runDir, items, opts = {}) -> { texts: {[itemId]: string}, errors: {[itemId]: 'no-staged-path'|'path-rejected'|'not-found'|'read-failed'} }` — `opts` (`{ fsImpl, realpath }`, threaded to path-guard's `canonicalRealpath`/`resolveLeaf`) was added in the final-review fix wave (52a8a97ec) as a test seam for the `read-failed` branches; production callers pass nothing (architecture alignment: Beneficial) (ruling rows only; each ruling id lands in exactly one of the two maps). `decideConsoleExecute`'s `ctx` gains `rulingReadErrors?: {[itemId]: cause}`. A `rulingGateGaps` element is `{ id, reason }` or, for an unreadable row, `{ id, reason: 'sdd-ruling-unreadable', detail: cause }`.

- [ ] **Step 1: Write the failing tests**

Update the existing tests (assertions shown are the full new expected values):

```js
// 'decideConsoleExecute: a null / missing ruling text is a gap (sdd-ruling-unclassified), fails closed' — unchanged assertions; it is the
// pure-function control: no ctx.rulingReadErrors, so a null or absent text stays unclassified with no detail key.

// 'consoleExecuteDetect: reads each ruling row's staged file …' — rename to start 'AC3.1 AC3.3:' and expect:
assert.deepStrictEqual(result.ready[0].rulingGateGaps, [
  { id: 'staged-2', reason: 'sdd-ruling-deferral-no-defer-reason' },
  { id: 'staged-4', reason: 'sdd-ruling-unreadable', detail: 'not-found' },
  { id: 'staged-5', reason: 'sdd-ruling-unreadable', detail: 'no-staged-path' },
]);

// 'consoleExecuteDetect: a stagedPath that escapes the run dir (../, absolute, non-string) …' — rename to start 'AC3.1 AC3.2:' and expect:
assert.deepStrictEqual(result.ready[0].rulingGateGaps, [
  { id: 'staged-1', reason: 'sdd-ruling-unreadable', detail: 'path-rejected' },
  { id: 'staged-2', reason: 'sdd-ruling-unreadable', detail: 'path-rejected' },
  { id: 'staged-3', reason: 'sdd-ruling-unreadable', detail: 'path-rejected' },
  { id: 'staged-4', reason: 'sdd-ruling-unreadable', detail: 'no-staged-path' },
]);

// 'readRulingTexts: …' — rename to 'readRulingTexts: reads only ruling rows, and names why each unreadable stagedPath failed (no platform skip …)' and expect:
assert.deepStrictEqual(readRulingTexts(runDir, [/* same seven items */]), {
  texts: { ok: RULING_TEXT_DEFERS_NO },
  errors: { none: 'no-staged-path', empty: 'no-staged-path', dotdot: 'path-rejected', abs: 'path-rejected', num: 'no-staged-path' },
});
assert.deepStrictEqual(readRulingTexts(runDir, undefined), { texts: {}, errors: {} });

// 'consoleExecuteDetect: a stagedPath symlink (leaf or directory segment) pointing outside the run dir …' — rename to start 'AC3.2:' and expect:
assert.deepStrictEqual(result.ready[0].rulingGateGaps, [
  { id: 'staged-1', reason: 'sdd-ruling-unreadable', detail: 'path-rejected' },
  { id: 'staged-2', reason: 'sdd-ruling-unreadable', detail: 'path-rejected' },
]);
```

Add these new tests after the symlink test:

```js
test('AC3.3 AC3.4: a dangling symlink and a dir-symlinked missing file are not-found; a directory at the path is read-failed (#4049)', { skip: process.platform === 'win32' }, async () => {
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-unread-')));
  const items = [
    { id: 'staged-1', kind: 'staged', summary: 'dangling', isRulingRow: true, stagedPath: 'staged/sdd-ruling-1.md' },
    { id: 'staged-2', kind: 'staged', summary: 'dir link, missing leaf', isRulingRow: true, stagedPath: 'linked/missing.md' },
    { id: 'staged-3', kind: 'staged', summary: 'directory', isRulingRow: true, stagedPath: 'staged/sdd-ruling-3.md' },
  ];
  const { dir, runDir } = makeRulingRepo(items, {});
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.symlinkSync(path.join(runDir, 'staged', 'gone.md'), path.join(runDir, 'staged', 'sdd-ruling-1.md'));
  fs.symlinkSync(outside, path.join(runDir, 'linked'));
  fs.mkdirSync(path.join(runDir, 'staged', 'sdd-ruling-3.md'));
  const result = await detectWithFakePr(dir, { comments: tickedComment(items.map((i) => i.id)), body: '' });
  assert.strictEqual(result.ready.length, 1, JSON.stringify(result));
  assert.deepStrictEqual(result.ready[0].rulingGateGaps, [
    { id: 'staged-1', reason: 'sdd-ruling-unreadable', detail: 'not-found' },
    { id: 'staged-2', reason: 'sdd-ruling-unreadable', detail: 'not-found' },
    { id: 'staged-3', reason: 'sdd-ruling-unreadable', detail: 'read-failed' },
  ]);
});

test('AC4.1 AC5.1: a read error wins over the text; a readable no-Defers ruling stays unclassified with no detail key; every unreadable row is a gap (#4049)', () => {
  const cj = rulingConsoleJson([
    { id: 'staged-1', kind: 'staged', summary: 'r', isRulingRow: true },
    { id: 'staged-2', kind: 'staged', summary: 'r', isRulingRow: true },
    { id: 'staged-3', kind: 'staged', summary: 'r', isRulingRow: true },
    { id: 'constructor', kind: 'staged', summary: 'r', isRulingRow: true },
  ]);
  const result = decideConsoleExecute(cj, tickedComment(['staged-1', 'staged-2', 'staged-3', 'constructor']), Date.now(), {
    rulingTexts: { 'staged-1': RULING_TEXT_DEFERS_NO, 'staged-3': 'Title: r\nKind: sdd-ruling\n\nbody\n', constructor: RULING_TEXT_DEFERS_NO },
    rulingReadErrors: { 'staged-2': 'read-failed' },
  });
  assert.strictEqual(result.action, 'ready');
  assert.deepStrictEqual(result.rulingGateGaps, [
    { id: 'staged-2', reason: 'sdd-ruling-unreadable', detail: 'read-failed' },
    { id: 'staged-3', reason: 'sdd-ruling-unclassified' },
  ]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.rulingGateGaps[1], 'detail'), false);
});

test('decideConsoleExecute: ctx.rulingReadErrors without ctx.rulingTexts keeps the legacy no-gate shape (#4049 control)', () => {
  const cj = rulingConsoleJson([{ id: 'staged-1', kind: 'staged', summary: 'r', isRulingRow: true }]);
  const result = decideConsoleExecute(cj, tickedComment(['staged-1']), Date.now(), { rulingReadErrors: { 'staged-1': 'not-found' } });
  assert.deepStrictEqual(result.rulingGateGaps, []);
});
```

`AC5.1`'s "not floor-clearing, console stays pending" half is prose-enforced: a ruling row named in `rulingGateGaps` is withheld per `_shared/console-execution.md`'s Third narrower exception, already pinned by `tests/build-sdd-ruling-deferral-gate.test.js`'s `'and a ruling row named in \`rulingGateGaps\`'` assertion. The code-level signal is gap membership, which the test above asserts for the unreadable row.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-execute.test.js`
Expected: FAIL after Step 1 — the detect tests report `reason: 'sdd-ruling-unclassified'` with no `detail`; `readRulingTexts` returns a flat map, not `{ texts, errors }`; `AC4.1 AC5.1` reports `staged-2` as `sdd-ruling-deferral…`/no gap. The legacy-shape control passes.

- [ ] **Step 3: Implement**

- Requires: `const { sddRulingDeferralReason, SDD_RULING_REASONS } = require('../console/resolve');` and `const { canonicalRealpath, resolveLeaf, isAncestorOrSelf } = require('../path-guard');` (drop `resolveWithin` — this file is its only importer here; check with a grep before removing).
- `readInsideRunDir(base, rel) -> { text: string } | { error: cause }`, in this order:

  | Condition | Result |
  |---|---|
  | `rel` not a string, or `''` | `{ error: 'no-staged-path' }` |
  | `path.isAbsolute(rel)`, or a `..` segment (`rel.split(/[\\/]/)`) | `{ error: 'path-rejected' }` |
  | `canonicalRealpath(base) === null` | `{ error: 'read-failed' }` |
  | `resolveLeaf(path.resolve(base, rel))` state `missing` or `dangling` | `{ error: 'not-found' }` |
  | state `unreadable` | `{ error: 'read-failed' }` |
  | resolved, but `!isAncestorOrSelf(rootReal, leaf.path)` | `{ error: 'path-rejected' }` |
  | `fs.readFileSync(leaf.path, 'utf8')` throws | `{ error: 'read-failed' }` |
  | otherwise | `{ text }` |

  Keep the existing IL-161 comment (symlinks in every segment are followed) next to the containment check.
- `readRulingTexts(runDir, items)` returns `{ texts, errors }`, filling one of the two per ruling item from `readInsideRunDir`. Rewrite its `#3880` comment to name the four causes and that a failure now reads as `sdd-ruling-unreadable` (#4049).
- `consoleExecuteDetect`: `const { texts, errors } = readRulingTexts(c.dir, c.consoleJson.items); ctx.rulingTexts = texts; ctx.rulingReadErrors = errors;`.
- `decideConsoleExecute`'s ruling loop (still inside the `if (ctx.rulingTexts && typeof ctx.rulingTexts === 'object')` guard): read `ctx.rulingReadErrors` as an object or `{}`; when it has an **own** property for `item.id` with a string value, push `{ id: item.id, reason: SDD_RULING_REASONS.UNREADABLE, detail }` and continue; otherwise the existing `sddRulingDeferralReason(ctx.rulingTexts[item.id])` path, unchanged (a missing id still reads unclassified — #4048's subject, out of scope). Update the ctx doc comment to add `rulingReadErrors?: {[itemId]: 'no-staged-path'|'path-rejected'|'not-found'|'read-failed'}` and the element shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/console-execute.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/console-execute.js tests/console-execute.test.js
git commit -m "Report why a ruling's staged file could not be read on the reconciler path — #4049"
```

---

### Task 3: Prose twins, journeys, and the appendix pin

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:48-49`, `:104-108`
- Modify: `plugin/skills/_shared/console-execution.md:199`, `:223`
- Modify: `docs/journeys/route-an-sdd-deferral-ruling-through-the-fix-now-gate-3880.md:50`
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md:33`
- Modify: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md:39` (scope addition — enumerates the pending reasons, found by the pin grep; not in the spec's Key Files)
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md:48` (scope addition, same reason)
- Test: `tests/build-sdd-ruling-deferral-gate.test.js:45-49`

**Interfaces:**
- Consumes: `SDD_RULING_REASONS` (three members after Task 1) — the gate test's every-reason loop requires `pending — sdd-ruling-unreadable` in the appendix.

Byte headroom (rail 52,500 B): `review-console-appendix.md` 14,066 B, `console-execution.md` 19,535 B — both grow by under 500 B.

- [ ] **Step 1: Write the failing test**

In `tests/build-sdd-ruling-deferral-gate.test.js`, test `'console prose: the appendix withholds a Defer-reason-bearing Defers: no, a duplicate Defers line, and names the reconciler path'`, replace the `'line, more than one, a value other than \`yes\`/\`no\`, or an unreadable file resolves'` assertion with two, and rename the test to start `AC7.1:`:

```js
assert.match(APPENDIX, ws('line, more than one, or a value other than `yes`/`no` resolves'));
assert.match(APPENDIX, ws('a staged file that cannot be read at all resolves `pending — sdd-ruling-unreadable`'));
assert.doesNotMatch(APPENDIX, /or an unreadable file resolves/);
```

Add to the `'reconciler prose: console-execution.md states the third exception …'` test:

```js
assert.match(EXECUTION, ws('`rulingGateGaps` (`[{ id, reason, detail? }]`'));
assert.match(EXECUTION, ws('`{reason}` reads `sdd-ruling-unreadable ({detail})`'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-sdd-ruling-deferral-gate.test.js`
Expected: FAIL — the new appendix and execution literals are absent, and (after Task 1) the every-reason loop fails on `pending — sdd-ruling-unreadable`.

- [ ] **Step 3: Edit the prose**

`review-console-appendix.md:48-49` — the lead-in becomes:
`` `sdd-ruling-*` item whose staged header does not show it safe lands as ``
`` `pending — sdd-ruling-deferral-no-defer-reason`, `pending — sdd-ruling-unclassified`, or `pending — sdd-ruling-unreadable` (the ``

`review-console-appendix.md:104-108` — from `valid reason resolves` through `(`_shared/console-execution.md`).` becomes (keep the two-space bullet indent and wrap near the file's width):

> valid reason resolves `pending — sdd-ruling-deferral-no-defer-reason`; a header with no `Defers:` line, more than one, or a value other than `yes`/`no` resolves `pending — sdd-ruling-unclassified`, since the console cannot tell whether it defers; a staged file that cannot be read at all resolves `pending — sdd-ruling-unreadable` (the reconciler's gap names why: `no-staged-path`, `path-rejected`, `not-found`, or `read-failed`). None is ever auto-ratified, and the reconciler's `consoleAutoResolve` path withholds the same rows (`_shared/console-execution.md`).

`console-execution.md:199` — `` `rulingGateGaps` (`[{ id, reason }]`, `` → `` `rulingGateGaps` (`[{ id, reason, detail? }]`, ``.

`console-execution.md:223` — keep the log-line template byte-identical (pinned); append one sentence after it on the same paragraph: ``When the gap carries a `detail` — an `sdd-ruling-unreadable` row, whose staged file could not be read — `{reason}` reads `sdd-ruling-unreadable ({detail})`.``

Journeys (each a one-line edit to an existing bullet):
- `…-3880.md:50` — `` `pending — sdd-ruling-unclassified` means no `Defers:` line, more than one, or a value other than yes/no. This also covers a ruling staged before #3880. `pending — sdd-ruling-unreadable` means the staged file could not be read at all — no `stagedPath`, a path rejected for leaving the run dir, a missing file, or a failed read (#4049). ``
- `…-3370.md:33` — `` `sdd-ruling-deferral-no-defer-reason` / `sdd-ruling-unclassified`, #3880 `` → `` `sdd-ruling-deferral-no-defer-reason` / `sdd-ruling-unclassified` / `sdd-ruling-unreadable`, #3880, #4049 ``
- `…-3401.md:39` — `` the deferral gate's `sdd-ruling-deferral-no-defer-reason` and `sdd-ruling-unclassified` (#3880) `` → `` the deferral gate's `sdd-ruling-deferral-no-defer-reason`, `sdd-ruling-unclassified` (#3880) and `sdd-ruling-unreadable` (#4049) ``
- `…-1932.md:48` — `` (`sdd-ruling-deferral-no-defer-reason` / `sdd-ruling-unclassified`) `` → `` (`sdd-ruling-deferral-no-defer-reason` / `sdd-ruling-unclassified` / `sdd-ruling-unreadable`) ``

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/build-sdd-ruling-deferral-gate.test.js tests/bin-lib/console/resolve.test.js tests/console-execute.test.js`
Expected: PASS.

Pin sweep (three forms, per the renumbering-completeness rule — the reason set grew from two to three):
- `node /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1e46c43-ff67-4a2b-876f-2b0c29819ab0/scratchpad/pin-grep.js "$PWD" "sdd-ruling-unclassified" "an unreadable file"` — every remaining `sdd-ruling-unclassified` hit under `plugin/` or `docs/journeys/` either also names `sdd-ruling-unreadable` on the same line or is a header-classification statement; no hit pairs "unclassified" with "unreadable file".
- the same script with `"two pending"` `"both reasons"` `"Neither is ever"` — no cardinal-count restatement of the reason set survives.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/review-console-appendix.md plugin/skills/_shared/console-execution.md docs/journeys/route-an-sdd-deferral-ruling-through-the-fix-now-gate-3880.md docs/journeys/review-what-an-unattended-console-left-open-3370.md docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md docs/journeys/resolve-the-unattended-console-in-one-process-1932.md tests/build-sdd-ruling-deferral-gate.test.js
git commit -m "State sdd-ruling-unreadable in the console prose twins and journeys — #4049"
```

---

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 `AC1.1 AC2.1` |
| AC2.1, AC2.2 | Task 1 `AC1.1 AC2.1` (null/undefined stay unclassified); `AC6.1 AC2.2` (caller decides UNREADABLE) |
| AC3.1–AC3.4 | Task 2 detect tests (`AC3.1 AC3.3`, `AC3.1 AC3.2`, `AC3.2`, `AC3.3 AC3.4`) |
| AC4.1 | Task 2 `AC4.1 AC5.1` |
| AC5.1 | Task 2 `AC4.1 AC5.1` (gap membership) + the existing prose pin in `build-sdd-ruling-deferral-gate.test.js` |
| AC6.1, AC6.2 | Task 1 `AC6.1 AC2.2`, `AC6.2` |
| AC7.1 | Task 3 |
| AC8.1 | Each behavior test's Step 2 runs red before Step 3; controls (`AC6.2`, the legacy-shape test, the unchanged null-text test) are exempt by construction — they pin what must not change |
| AC9.1 | Common Step 5 (full suite) |
