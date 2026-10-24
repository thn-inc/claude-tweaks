# sddRulingDeferralReason Leaf Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `reconcile/console-execute.js` (and so every SessionStart reconcile pass) from loading `wrap-up/pack.js` just to reach one header parser.

**Architecture:** Move `SDD_RULING_REASONS` and `sddRulingDeferralReason` out of `plugin/bin/lib/console/resolve.js` into a new leaf module `plugin/bin/lib/console/sdd-ruling.js` whose only dependency is `DEFER_REASONS` from `../issues/record`. `resolve.js` imports both from the leaf and keeps re-exporting them (two test files import them from `resolve`); `reconcile/console-execute.js` imports from the leaf directly.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T190552-record-4060/work/4060-spec.md`

## Global Constraints

- The leaf module's only `require` is `const { DEFER_REASONS } = require('../issues/record');`.
- `SDD_RULING_REASONS` values stay byte-identical: `NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason'`, `UNCLASSIFIED: 'sdd-ruling-unclassified'`, `UNREADABLE: 'sdd-ruling-unreadable'`, frozen.
- `console/resolve.js` keeps `SDD_RULING_REASONS` and `sddRulingDeferralReason` in its `module.exports` (callers: `tests/bin-lib/console/resolve.test.js:10`, `tests/build-sdd-ruling-deferral-gate.test.js:11`).

## Review Focus

- Identity: `require('console/resolve').SDD_RULING_REASONS` must be the same frozen object as the leaf's (a copy would let the two drift) — pinned in Task 1's test.
- A transitive path: some other require in `console-execute.js` or `reconcile/index.js` could still pull in `wrap-up/pack` — Task 1's test loads `reconcile/index.js` (the real hook entry), not just `console-execute.js`.
- Module-cache leakage: an in-process `require.cache` check is polluted by earlier tests in the same file that already loaded `pack.js` — the test spawns a fresh `node` process.
- The parser's behavior must be unchanged — the existing `resolve.test.js` #4049/#3880 cases and `build-sdd-ruling-deferral-gate.test.js` run unmodified.

---

### Task 1: Leaf module and the load-graph pin

**Files:**
- Create: `plugin/bin/lib/console/sdd-ruling.js`
- Modify: `plugin/bin/lib/console/resolve.js:230-269` (remove the definitions, require from the leaf; keep both names in `module.exports` at :818)
- Modify: `plugin/bin/lib/reconcile/console-execute.js:24-37` (header comment names `console/sdd-ruling.js`; require from `'../console/sdd-ruling'`)
- Test: `tests/console-execute.test.js`

**Interfaces:**
- Produces: `plugin/bin/lib/console/sdd-ruling.js` exporting `{ SDD_RULING_REASONS, sddRulingDeferralReason }` — `sddRulingDeferralReason(text: string|null|undefined) => string|null`, moved verbatim with its #3880/#4049 comment block (including the "Prose twin: wrap-up/review-console-appendix.md's sdd-ruling-* bullet" line).

- [ ] **Step 1: Write the failing tests** (append to `tests/console-execute.test.js`)

```js
test('AC1.1 AC2.1: loading reconcile/index.js in a fresh process does not load wrap-up/pack.js (#4060)', () => {
  const code = "require(process.argv[1]); console.log(JSON.stringify(Object.keys(require.cache).filter((k) => /[\\\\/]wrap-up[\\\\/]pack\\.js$/.test(k))));";
  const out = execFileSync(process.execPath, ['-e', code, path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js')], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out.trim()), []);
});

test('sdd-ruling leaf: resolve.js re-exports the same objects (#4060)', () => {
  const leaf = require('../plugin/bin/lib/console/sdd-ruling');
  const resolve = require('../plugin/bin/lib/console/resolve');
  assert.strictEqual(resolve.SDD_RULING_REASONS, leaf.SDD_RULING_REASONS);
  assert.strictEqual(resolve.sddRulingDeferralReason, leaf.sddRulingDeferralReason);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="4060" tests/console-execute.test.js`
Expected: FAIL — the first test's array lists `.../wrap-up/pack.js`; the second throws `Cannot find module '../plugin/bin/lib/console/sdd-ruling'`.

- [ ] **Step 3: Implement** — create the leaf (`'use strict'`, header comment `// bin/lib/console/sdd-ruling.js — ...` naming #4060 as the reason it is a leaf), move the two definitions, switch both importers.

- [ ] **Step 4: Run to verify they pass, plus the existing consumers**

Run: `node --test tests/console-execute.test.js tests/bin-lib/console/resolve.test.js tests/build-sdd-ruling-deferral-gate.test.js`
Expected: PASS, 0 failures.

Run: `node -e "require('./plugin/bin/lib/reconcile/console-execute'); console.log(Object.keys(require.cache).some(k => k.includes('wrap-up/pack')))"`
Expected: `false` (AC1.1).

- [ ] **Step 5: Go-red check** — temporarily restore `require('../console/resolve')` in `console-execute.js`, re-run the first test, confirm FAIL, restore the leaf require (AC2.1's "goes red with the old require restored").

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/console/sdd-ruling.js plugin/bin/lib/console/resolve.js plugin/bin/lib/reconcile/console-execute.js tests/console-execute.test.js
git commit -m "Move sddRulingDeferralReason into a console/sdd-ruling.js leaf — reconcile stops loading wrap-up/pack (refs #4060)"
```

AC3.1 (`npm test` passes) is covered by `/build` Common Step 5's full-suite verification.
