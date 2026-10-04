# Acceptance-Gap Backstop Excludes NOT_PLANNED/DUPLICATE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `needsBackstop` (and both of its callers' fetches) stop counting a closed record whose GitHub `stateReason` is `NOT_PLANNED` or `DUPLICATE` as an acceptance-gap — such a closure has nothing to accept.

**Architecture:** `needsBackstop` (`plugin/bin/lib/issues/acceptance.js`) gains a new early-return branch reading an optional `stateReason` field on its input record, checked before the existing `hasParent`/disposition logic. Its two callers — the `github-issues` acceptance-gap scope (`plugin/skills/_shared/github-pr-scan-acceptance.md`) and the `local-files` Shape 8 scan (`plugin/skills/tidy/step-1-records.md`) — are updated to supply that field: the `github-issues` side fetches GitHub's own `stateReason` via `gh issue list --json`; the `local-files` side has no native stateReason concept, so it derives `'NOT_PLANNED'` from the existing `facets.notPlanned` boolean (local-files' `not-planned: true` frontmatter already conflates wontfix/duplicate/absorbed into one flag per `_shared/work-record.md`'s lifecycle spine — there is no separate local-files DUPLICATE case to derive).

**Tech Stack:** Node.js (`node --test`), plain CommonJS modules, markdown skill files with embedded bash/node snippets (no build step — these run inline when a skill executes).

**Spec:** `.claude-tweaks/pipelines/2026-10-03T143327-record-2854/work/2854-spec.md` (materialized from GitHub issue #2854)

## Global Constraints

- Match the exact literal `stateReason` values GitHub's GraphQL/REST API returns: `NOT_PLANNED`, `DUPLICATE` (uppercase, underscore-separated) — `plugin/bin/lib/issues/trust.js:339` already reads `record.stateReason === 'NOT_PLANNED'` against live fetched data, confirming this exact casing.
- `needsBackstop`'s existing behavior for every other input combination must be unchanged — this is an additive early-return, not a restructuring.
- Do not reimplement the disposition taxonomy anywhere else; both callers continue to delegate classification entirely to `needsBackstop`.

## Review Focus

- A closed record with `stateReason: 'COMPLETED'` (the normal completed-merge case) and no `demo:*` label must still read as a gap — the new branch must not accidentally widen past the two named reasons.
- A closed record with `stateReason: 'NOT_PLANNED'` that already carries a `demo:approved` label must still report `false` (no regression via a different code path — the new early return and the existing disposition check must agree).
- `stateReason` absent entirely (a record fetched before this field was added to the `--json` flag, or any other caller of `needsBackstop` that never passes it) must preserve today's behavior exactly — `undefined` is not `'NOT_PLANNED'`/`'DUPLICATE'`.
- The local-files translation must only ever produce `'NOT_PLANNED'`, never `'DUPLICATE'` — `facets.notPlanned` has no sub-classification, so asserting it never maps to `'DUPLICATE'` pins that boundary.
- `hasParent` suppression must still take precedence/compose correctly alongside the new check — a NOT_PLANNED sub-issue must also return `false` (both reasons independently suppress it).

---

### Task 1: `needsBackstop` excludes NOT_PLANNED/DUPLICATE stateReason

**Files:**
- Modify: `plugin/bin/lib/issues/acceptance.js:88-93` (the `needsBackstop` function)
- Test: `tests/bin-lib/issues/acceptance.test.js`

**Interfaces:**
- Consumes: nothing new — pure function, no new imports.
- Produces: `needsBackstop(record)` now also reads `record.stateReason` (optional `string`, expected values `'NOT_PLANNED' | 'DUPLICATE' | 'COMPLETED' | 'REOPENED' | undefined`). Callers (Tasks 2 and 3) populate it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/issues/acceptance.test.js`, after the existing `'needsBackstop is unchanged when hasParent is absent or not literally true'` test (around line 110):

```javascript
test('needsBackstop excludes a NOT_PLANNED closure even with no disposition', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'NOT_PLANNED' }), false);
});

test('needsBackstop excludes a DUPLICATE closure even with no disposition', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'DUPLICATE' }), false);
});

test('needsBackstop still fires for a COMPLETED closure with no disposition', () => {
  // A normal completed-merge closure must not be swept up by the new branch.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'COMPLETED' }), true);
});

test('needsBackstop is unchanged when stateReason is absent', () => {
  // undefined must not be confused with 'NOT_PLANNED'/'DUPLICATE' — every existing
  // caller that has never passed this field must see identical behavior.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [] }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: ['demo:approved'] }), false);
});

test('needsBackstop returns false for NOT_PLANNED even when already dispositioned', () => {
  // The two suppression paths (stateReason and disposition) must agree, not conflict.
  assert.equal(
    needsBackstop({ state: 'CLOSED', labels: ['demo:approved'], stateReason: 'NOT_PLANNED' }),
    false,
  );
});

test('needsBackstop suppresses a NOT_PLANNED sub-issue too (both reasons compose)', () => {
  assert.equal(
    needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'NOT_PLANNED', hasParent: true }),
    false,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: FAIL — the two new NOT_PLANNED/DUPLICATE-exclusion tests and the already-dispositioned/sub-issue-compose test report `true` instead of the expected `false` (today's `needsBackstop` has no `stateReason` branch, so a closed record with no `demo:*` label and `hasParent` not `true` always returns `true` regardless of `stateReason`). The COMPLETED and absent-stateReason tests pass already (asserted here only as a regression guard, not as the task's new coverage).

- [ ] **Step 3: Implement the minimal fix**

Edit `plugin/bin/lib/issues/acceptance.js`'s `needsBackstop` function (lines 88-93):

```javascript
function needsBackstop(record) {
  if (!record || record.state !== 'CLOSED') return false;
  // A not-planned or duplicate closure has nothing to accept — it is not a gap at all.
  if (record.stateReason === 'NOT_PLANNED' || record.stateReason === 'DUPLICATE') return false;
  // A decomposed sub-issue's acceptance lives on its parent issue, not on itself.
  if (record.hasParent === true) return false;
  return dispositionState(record.labels) === 'none';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/acceptance.js tests/bin-lib/issues/acceptance.test.js
git commit -m "fix: needsBackstop excludes NOT_PLANNED/DUPLICATE closures"
```

---

### Task 2: `github-issues` acceptance-gap scope passes `stateReason` through

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md` (the closed-record fetch and the `needsBackstop` call site)

**Interfaces:**
- Consumes: `needsBackstop(record)` from Task 1 — now reads `record.stateReason`.
- Produces: nothing new for later tasks (this is the terminal `github-issues` call site).

- [ ] **Step 1: Confirm current behavior (no stateReason field fetched)**

Run: `grep -n 'number,title,state,labels,closedAt' plugin/skills/_shared/github-pr-scan-acceptance.md`
Expected: FAIL to find `stateReason` anywhere on that line — confirms the field is not fetched today. (One matching line, without `stateReason` in it.)

- [ ] **Step 2: Add `stateReason` to the closed-record fetch**

In `plugin/skills/_shared/github-pr-scan-acceptance.md`, find:

```bash
gh issue list --state closed --limit "$LIMIT" \
  --json number,title,state,labels,closedAt \
  > "$RAW"
```

Replace with:

```bash
gh issue list --state closed --limit "$LIMIT" \
  --json number,title,state,labels,closedAt,stateReason \
  > "$RAW"
```

- [ ] **Step 3: Pass `stateReason` through to the `needsBackstop` call**

Find:

```javascript
  const gaps = records
    .map(r => ({ ...r, labels: r.labels.map(l => l.name), hasParent: subIssues.has(r.number) }))
    .filter(r => exceedsOversightFloor(parseRecordFacets(r.labels), { riskFloor, sizeFloor }).exceeds)
    .filter(r => needsBackstop({ state: 'CLOSED', labels: r.labels, hasParent: r.hasParent }));
```

Replace with:

```javascript
  const gaps = records
    .map(r => ({ ...r, labels: r.labels.map(l => l.name), hasParent: subIssues.has(r.number) }))
    .filter(r => exceedsOversightFloor(parseRecordFacets(r.labels), { riskFloor, sizeFloor }).exceeds)
    .filter(r => needsBackstop({
      state: 'CLOSED',
      labels: r.labels,
      hasParent: r.hasParent,
      stateReason: r.stateReason,
    }));
```

- [ ] **Step 4: Verify the edits landed**

Run: `grep -n 'number,title,state,labels,closedAt,stateReason' plugin/skills/_shared/github-pr-scan-acceptance.md && grep -n 'stateReason: r.stateReason' plugin/skills/_shared/github-pr-scan-acceptance.md`
Expected: PASS — both greps print exactly one matching line each.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan-acceptance.md
git commit -m "fix: acceptance-gap scope fetches and forwards stateReason"
```

---

### Task 3: `local-files` Shape 8 derives and passes `stateReason` through

**Files:**
- Modify: `plugin/skills/tidy/step-1-records.md` (Shape 8's `needsBackstop` call site)

**Interfaces:**
- Consumes: `needsBackstop(record)` from Task 1 — now reads `record.stateReason`.
- Produces: nothing new for later tasks (this is the terminal `local-files` call site).

- [ ] **Step 1: Confirm current behavior (no stateReason translation)**

Run: `grep -n "hasParent: r.facets.parent !== null" plugin/skills/tidy/step-1-records.md`
Expected: FAIL to find a `stateReason:` field on the same `needsBackstop({...})` call — confirms today's call passes only `state`/`labels`/`hasParent`. (One matching line, with no `stateReason` key in the surrounding object literal.)

- [ ] **Step 2: Derive `stateReason` from `facets.notPlanned` and pass it through**

In `plugin/skills/tidy/step-1-records.md`, find:

```javascript
    .filter((r) => needsBackstop({
      state: r.facets.closed ? 'CLOSED' : 'OPEN',
      labels: r.facets.acceptance ? ['demo:' + r.facets.acceptance] : [],
      hasParent: r.facets.parent !== null,
    }))
```

Replace with:

```javascript
    .filter((r) => needsBackstop({
      state: r.facets.closed ? 'CLOSED' : 'OPEN',
      labels: r.facets.acceptance ? ['demo:' + r.facets.acceptance] : [],
      hasParent: r.facets.parent !== null,
      // local-files has no native stateReason — facets.notPlanned already conflates
      // wontfix/duplicate/absorbed into one flag (_shared/work-record.md's lifecycle
      // spine), so it maps onto NOT_PLANNED only; there is no local-files DUPLICATE case.
      stateReason: r.facets.notPlanned ? 'NOT_PLANNED' : undefined,
    }))
```

- [ ] **Step 3: Verify the edit landed**

Run: `grep -n "r.facets.notPlanned ? 'NOT_PLANNED' : undefined" plugin/skills/tidy/step-1-records.md`
Expected: PASS — prints exactly one matching line.

- [ ] **Step 4: Add one explanatory sentence to Shape 8's prose**

Immediately after the existing paragraph beginning "Classification is entirely `needsBackstop`'s..." (around line 324-329 — ends "...and `facets.parent !== null` → `hasParent`."), add a new paragraph:

```markdown
`facets.notPlanned` → `stateReason: 'NOT_PLANNED'` is the same translation, added so a
record closed not-planned (wontfix, duplicate, or absorbed — `_shared/work-record.md`'s
lifecycle spine conflates all three into this one flag on this driver) is excluded from this
shape exactly as its `github-issues` counterpart excludes a `NOT_PLANNED`/`DUPLICATE`
`stateReason`. There is no separate local-files translation for `DUPLICATE` — this driver
has no sub-classification of not-planned closures to translate into it.
```

- [ ] **Step 5: Verify the prose landed**

Run: `grep -n "excluded from this" plugin/skills/tidy/step-1-records.md`
Expected: PASS — prints exactly one matching line.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/tidy/step-1-records.md
git commit -m "fix: local-files Shape 8 derives stateReason from facets.notPlanned"
```

---

## Verification

After all three tasks land, run the full acceptance test file once more plus the full suite per CLAUDE.md:

```bash
node --test tests/bin-lib/issues/acceptance.test.js
npm test
```

Both must pass with zero failures before this plan is considered done.
