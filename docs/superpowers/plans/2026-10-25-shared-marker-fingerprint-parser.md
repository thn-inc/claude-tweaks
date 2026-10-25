# Shared Marker-Fingerprint Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two copies of the `<!-- {prefix}: (\S+?) -->` extraction loop in `health-core/digest.js` and `health-core/materiality-digest.js` with one shared `parseMarkerFingerprints(text, prefix)` in `health-core/fingerprint.js`.

**Architecture:** `fingerprint.js` gains one pure function; `parseDigestFingerprints(body)` and `parseMaterialityFingerprints(text)` keep their names and exports and become one-line wrappers passing their own prefix constant. No caller outside these two modules changes.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T083602-record-4182/work/4182-spec.md`

Scope keywords: parseDigestFingerprints, parseMaterialityFingerprints, parseMarkerFingerprints

## Global Constraints

- No user-visible change (spec Release Note: "No user-visible change.").
- Exported names `parseDigestFingerprints` (digest.js) and `parseMaterialityFingerprints` (materiality-digest.js) stay exported, as thin wrappers.
- Marker shape is exactly `<!-- {prefix}: {fp} -->` with `{fp}` = `\S+?`, global — unchanged from both current copies.
- Prefix constants unchanged: `DIGEST_MARKER_PREFIX = 'digest-fingerprint'`, `MATERIALITY_MARKER_PREFIX = 'materiality-fingerprint'`.

## Review Focus

- `null`/`undefined`/empty text → `[]` (both current copies coerce via `String(x || '')`); pinned in Task 1 Step 1.
- Non-string text (e.g. a number) must not throw — coerced via `String()`; pinned in Task 1 Step 1.
- Two markers on one line, plus a marker carrying a trailing `→ {id}` suffix after it (materiality's promoted-entry shape) → every fp extracted, in order; pinned in Task 1 Step 1.
- Repeated calls must not leak `g`-regex `lastIndex` state between calls (use `matchAll`, as materiality-digest.js already does); pinned by calling twice in Task 1 Step 1.
- A prefix containing regex metacharacters must match literally (escape the prefix) — today's two prefixes have none, but the helper is now general; pinned in Task 1 Step 1.

---

### Task 1: Shared `parseMarkerFingerprints` and the two wrappers

**Files:**
- Modify: `plugin/bin/lib/health-core/fingerprint.js`
- Modify: `plugin/bin/lib/health-core/digest.js:66-75` (`parseDigestFingerprints`)
- Modify: `plugin/bin/lib/health-core/materiality-digest.js:47-58` (`parseMaterialityFingerprints` and its comment)
- Test: `tests/bin-lib/health-core/fingerprint.test.js`
- Verify (unchanged): `tests/bin-lib/health-core/digest.test.js`, `tests/bin-lib/health-core/materiality-digest.test.js`
- Verify (unchanged consumer): `plugin/bin/lib/console/backfill-dispose.js` and `tests/bin-lib/console/backfill-dispose.test.js` — call `parseMaterialityFingerprints` through the kept wrapper (`git grep -n parseMaterialityFingerprints -- plugin tests` lists these plus the two health-core modules and their tests; `parseDigestFingerprints` has no caller outside `digest.js` and `digest.test.js`), so no edit

**Interfaces:**
- Produces: `parseMarkerFingerprints(text: any, prefix: string) => string[]`, exported from `plugin/bin/lib/health-core/fingerprint.js` alongside `normalizeText`, `fingerprintFromBasis`, `createFingerprint`.
- Consumes: nothing new. `digest.js` gains `require('./fingerprint')`; `materiality-digest.js` already requires it (add `parseMarkerFingerprints` to its destructure).

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/health-core/fingerprint.test.js`, and add `parseMarkerFingerprints` to the existing top-of-file destructure:

```js
test('AC2.1: parseMarkerFingerprints extracts digest-fingerprint markers', () => {
  const body = '- [ ] **a** <!-- digest-fingerprint: fp-1 -->\n- [ ] **b** <!-- digest-fingerprint: fp-2 -->';
  assert.deepStrictEqual(parseMarkerFingerprints(body, 'digest-fingerprint'), ['fp-1', 'fp-2']);
});

test('AC2.1: parseMarkerFingerprints extracts materiality-fingerprint markers, ignoring trailing suffixes and other prefixes', () => {
  const text = '- [x] f <!-- materiality-fingerprint: materiality-aaaa1111 --> → #12\n- [y] g <!-- materiality-fingerprint: materiality-bbbb2222 --> <!-- digest-fingerprint: other -->';
  assert.deepStrictEqual(parseMarkerFingerprints(text, 'materiality-fingerprint'), ['materiality-aaaa1111', 'materiality-bbbb2222']);
});

test('AC2.1: parseMarkerFingerprints returns [] for a body with no marker, and for null/undefined/empty', () => {
  assert.deepStrictEqual(parseMarkerFingerprints('plain body, no markers', 'digest-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(null, 'digest-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(undefined, 'materiality-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints('', 'materiality-fingerprint'), []);
  assert.deepStrictEqual(parseMarkerFingerprints(42, 'digest-fingerprint'), []);
});

test('parseMarkerFingerprints is stateless across calls', () => {
  const body = '<!-- digest-fingerprint: x -->';
  assert.deepStrictEqual(parseMarkerFingerprints(body, 'digest-fingerprint'), ['x']);
  assert.deepStrictEqual(parseMarkerFingerprints(body, 'digest-fingerprint'), ['x']);
});

test('parseMarkerFingerprints matches the prefix literally (regex metacharacters escaped)', () => {
  assert.deepStrictEqual(parseMarkerFingerprints('<!-- a.b: one --> <!-- aXb: two -->', 'a.b'), ['one']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/health-core/fingerprint.test.js`
Expected: FAIL with "parseMarkerFingerprints is not a function"

- [ ] **Step 3: Implement `parseMarkerFingerprints(text, prefix)` in `plugin/bin/lib/health-core/fingerprint.js` and export it**

Build `new RegExp(`<!-- ${escaped}: (\\S+?) -->`, 'g')` where `escaped` is `prefix` with regex metacharacters escaped; return `[...String(text || '').matchAll(re)].map((m) => m[1])`. Move materiality-digest.js's matchAll-vs-exec comment (lines 52-54) onto this function.

- [ ] **Step 4: Replace both bodies with wrappers**

- `digest.js`: add `const { parseMarkerFingerprints } = require('./fingerprint');` after `'use strict';`; `parseDigestFingerprints(body)` becomes `return parseMarkerFingerprints(body, DIGEST_MARKER_PREFIX);`. Keep its marker-shape comment.
- `materiality-digest.js`: add `parseMarkerFingerprints` to the existing `require('./fingerprint')` destructure; `parseMaterialityFingerprints(text)` becomes `return parseMarkerFingerprints(text, MATERIALITY_MARKER_PREFIX);`. Keep its promoted/expired comment; drop only the moved matchAll sentence.
- Both `module.exports` lists unchanged.

- [ ] **Step 5: Run the new and existing suites to verify they pass (AC1.1)**

Run: `node --test tests/bin-lib/health-core/fingerprint.test.js tests/bin-lib/health-core/digest.test.js tests/bin-lib/health-core/materiality-digest.test.js tests/bin-lib/console/backfill-dispose.test.js`
Expected: PASS, `ℹ fail 0` — AC1.1: both modules return the same fingerprints as before on the existing fixtures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/health-core/fingerprint.js plugin/bin/lib/health-core/digest.js plugin/bin/lib/health-core/materiality-digest.js tests/bin-lib/health-core/fingerprint.test.js
git commit -m "Share one marker-fingerprint parser across health-core digests — parseMarkerFingerprints in fingerprint.js, refs #4182"
```
