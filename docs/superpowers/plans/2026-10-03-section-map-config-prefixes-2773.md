# SECTION_MAP config-prefix coverage + honest shadow-dup reason (#2773) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two defects in `plugin/bin/lib/console/resolve.js`'s `SECTION_MAP` — the curation engine's own `wrap-up-claude-md-`/`wrap-up-adr-` staged prefixes are unmapped (falling through to `pending — unmapped-prefix` at `unattended` instead of `Configuration updates`), and a `.shadow-dup` file is always reported as a duplicate even when it's actually a divergent, separately-recovered proposal.

**Architecture:** Add one new `SECTION_MAP` row routing `wrap-up-claude-md-`/`wrap-up-adr-` to `SECTIONS.CONFIG`. Move the `.shadow-dup` check out of the data-driven `SECTION_MAP` table into a dedicated early branch in `classifyStagedItem` that takes a third `siblingText` argument (the anchor file's own content) and reports `shadow-dup-duplicate` or `shadow-dup-divergent` by byte comparison, falling back to the existing `shadow-dup-collision` reason when no anchor is readable. Wire `stagedItems()` to look up each shadow-dup file's anchor text from the same run's `staged/` snapshot. Add a mechanized conformance test that walks every `bin/lib/wrap-up/registry.js` row whose own judge `.md` file documents a literal `staged/{prefix}-{n}` naming convention and asserts `SECTION_MAP` recognizes it — so a future registry row that documents a convention but forgets to add it to `SECTION_MAP` fails the suite instead of silently going inert at `unattended`. Document the `wrap-up-claude-md-{n}.md`/`wrap-up-adr-{n}.md` conventions in `claude-md-curation.md`/`adr-curation.md` so that new test's scan actually finds them (today neither file names its own staged-file pattern anywhere in the repo).

**Tech Stack:** Node.js (`node --test`), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-03T120516-record-2773/work/2773-spec.md` (materialized from GitHub issue #2773)

## Global Constraints

- Match the surrounding code style exactly (resolve.js's existing comment density and regex-table idiom).
- Do not touch any other `SECTION_MAP` row, `SECTION_STANCES` entry, or unrelated producer prefix — scope is exactly the two defects named in the spec.
- Every new/changed assertion in `tests/bin-lib/console/resolve.test.js` must use `node --test` (no new test framework).

## Review Focus

- A `.shadow-dup` file whose anchor was never staged in the same run (already executed/removed) must still classify as `shadow-dup-collision`, never crash or misreport `shadow-dup-duplicate`/`shadow-dup-divergent` from a `null`/`undefined` comparison.
- `readSnapshot`'s staged-file text-reading condition must be extended to cover `.shadow-dup`/`.shadow-dup-{n}`-suffixed filenames — today it only reads `.patch`/`.md`, so a shadow-dup file's own `text` is always `null` regardless of this fix; the comparison is meaningless without this.
- The new mechanized audit test must not fail on a registry row whose judge file documents no literal `staged/{prefix}-{n}` convention (e.g. `docs`, `journeys`, `references`) — absence of a discoverable convention is not a failure, only a discovered-but-unmapped prefix is.
- `SECTION_MAP.length > 10` (an existing assertion) must still hold after removing one row (shadow-dup) and adding one row (config) — net zero change in row count, same as before.
- The existing `wrap-up-memory-1.md.shadow-dup` / `review-2.patch.shadow-dup-2` direct `classifyStagedItem` calls (no third argument) must keep returning `shadow-dup-collision` — backward compatible for callers that don't supply sibling text.

---

### Task 1: SECTION_MAP config-prefix row + honest shadow-dup classification + coverage test

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js`
- Modify: `plugin/skills/wrap-up/claude-md-curation.md`
- Modify: `plugin/skills/wrap-up/adr-curation.md`
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Produces: `classifyStagedItem(filename, text, siblingText)` — `siblingText` is a new, optional third parameter (undefined-safe; existing two-argument callers are unaffected). Returns `{ section, reason? }` exactly as before.
- Produces: `module.exports.ENGINE_ROW_SECTIONS` — newly exported (was private before), `{ skills, docs, journeys, 'claude-md', 'decision-records', references }` mapping registry row id to its `SECTIONS.*` value.

- [ ] **Step 1: Write the failing tests**

Open `tests/bin-lib/console/resolve.test.js`. First, update the import line (currently line 9) to also pull `ENGINE_ROW_SECTIONS`:

```js
const { classifyStagedItem, resolveAll, SECTION_STANCES, SECTION_MAP, ENGINE_ROW_SECTIONS } = require(MOD);
```

Add a `ROOT` constant near the top (after the existing `MOD` constant) for locating the registry module and the judge `.md` files from the test:

```js
const ROOT = path.join(__dirname, '..', '..', '..');
```

In the `EVERY_SECTION` object (the literal object a few lines below, currently ending with `'mystery-9.md': 'unmapped',`), add two entries right after the `'wrap-up-doc-1.md': 'doc',` line:

```js
  'wrap-up-claude-md-1.md': 'claude-md',
  'wrap-up-adr-1.md': 'adr',
```

In the first test (`'classifyStagedItem maps every known prefix...'`), in the `expect` object, add a line right after the existing `'wrap-up-doc-1.md': 'Documentation updates', 'tidy-doc-1.md': 'Documentation updates',` line:

```js
    'wrap-up-claude-md-1.md': 'Configuration updates', 'wrap-up-adr-1.md': 'Configuration updates',
```

In the second test (`'resolveAll resolves one item per section...'`), add two assertions right after the existing `assert.strictEqual(by['wrap-up-doc-1.md'].resolution, 'approve');` line, pinning AC1's exact "approve, not pending" outcome end-to-end through `resolveAll`:

```js
  assert.strictEqual(by['wrap-up-claude-md-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-adr-1.md'].resolution, 'approve');
```

Immediately after that same test's closing `});`, insert two new tests:

```js
test('a .shadow-dup file is classified duplicate when byte-identical to its anchor, divergent otherwise, and falls back to shadow-dup-collision with no anchor to compare (#2773)', () => {
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-1.md.shadow-dup', 'same text', 'same text'),
    { section: 'Pending review', reason: 'shadow-dup-duplicate' },
  );
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-2.md.shadow-dup', 'shadow text', 'anchor text'),
    { section: 'Pending review', reason: 'shadow-dup-divergent' },
  );
  // No sibling supplied at all — the pre-existing conservative fallback,
  // unchanged for callers that don't (or can't) supply anchor text.
  assert.deepStrictEqual(
    classifyStagedItem('wrap-up-memory-1.md.shadow-dup', 'x'),
    { section: 'Pending review', reason: 'shadow-dup-collision' },
  );
  assert.deepStrictEqual(
    classifyStagedItem('review-2.patch.shadow-dup-2'),
    { section: 'Pending review', reason: 'shadow-dup-collision' },
  );

  // End-to-end via resolveAll: one byte-identical pair, one divergent pair,
  // in the same run — two distinguishable reasons, same resolution.
  const runDir = fixture({
    staged: {
      'build-deviation-1.md': 'identical content',
      'build-deviation-1.md.shadow-dup': 'identical content',
      'build-deviation-2.md': 'original content',
      'build-deviation-2.md.shadow-dup': 'different content — recovered from a clobbering write',
    },
    headers: [7],
  });
  const r = resolveAll({ runDir, policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['build-deviation-1.md.shadow-dup'].reason, 'shadow-dup-duplicate');
  assert.strictEqual(by['build-deviation-2.md.shadow-dup'].reason, 'shadow-dup-divergent');
  assert.strictEqual(by['build-deviation-1.md.shadow-dup'].resolution, 'pending');
  assert.strictEqual(by['build-deviation-2.md.shadow-dup'].resolution, 'pending');
  // The anchors themselves are unaffected — still plain Pending review items.
  assert.strictEqual(by['build-deviation-1.md'].resolution, 'apply');
});

test('every registry row whose own judge file documents a literal staged/{prefix}-{n} naming convention resolves through SECTION_MAP, into that row\'s own ENGINE_ROW_SECTIONS section when one exists (#2773)', () => {
  const { REGISTRY } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'registry'));
  const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills', 'wrap-up');
  const PREFIX_RE = /staged\/([a-zA-Z][a-zA-Z0-9-]*-)\{[nN]\}/;
  let checked = 0;
  for (const row of REGISTRY) {
    const judgeText = fs.readFileSync(path.join(SKILLS_DIR, row.judge), 'utf8');
    const m = PREFIX_RE.exec(judgeText);
    if (!m) continue; // this row's judge documents no standalone staged-file naming convention — nothing to audit for it
    checked += 1;
    const prefix = m[1];
    const result = classifyStagedItem(`${prefix}1.md`);
    assert.notStrictEqual(result.reason, 'unmapped-prefix', `${row.id}'s documented prefix "${prefix}" has no SECTION_MAP row`);
    const expectedSection = ENGINE_ROW_SECTIONS[row.id];
    if (expectedSection) {
      assert.strictEqual(result.section, expectedSection, `${row.id}'s staged prefix "${prefix}" must classify into its own ENGINE_ROW_SECTIONS section`);
    }
  }
  assert.ok(checked >= 3, 'expected at least skills/memory/upstream to document a literal convention in their own judge files — the scan itself may be broken if this is 0');
});
```

- [ ] **Step 2: Run the new/changed tests and confirm the expected failures**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — the `expect` map assertion fails on `'wrap-up-claude-md-1.md'`/`'wrap-up-adr-1.md'` (both currently classify as `Pending review`/`unmapped-prefix`, not `Configuration updates`); the new shadow-dup test fails because `classifyStagedItem` doesn't yet accept a third argument and both fixture pairs report `shadow-dup-collision` instead of `shadow-dup-duplicate`/`shadow-dup-divergent`; the new registry-audit test fails with `ENGINE_ROW_SECTIONS` being `undefined` (not yet exported) and/or the `claude-md`/`decision-records` rows' prefixes not yet discoverable in their judge files (no literal convention documented there yet).

- [ ] **Step 3: Document the two staged-file naming conventions the audit test scans for**

In `plugin/skills/wrap-up/claude-md-curation.md`, find this sentence (search for `stagePath` is the `staged/` file holding the full proposal, and `action` is `staged`.`):

```
Each collected item becomes one payload finding: `kind` is the harness-health finding kind (`patch`), `targetPath` is `CLAUDE.md` or the rule file, `summary` is the `— {…}` half written as a reader would say it, `stagePath` is the `staged/` file holding the full proposal, and `action` is `staged`.
```

Replace with (appending a clause naming the literal filename):

```
Each collected item becomes one payload finding: `kind` is the harness-health finding kind (`patch`), `targetPath` is `CLAUDE.md` or the rule file, `summary` is the `— {…}` half written as a reader would say it, `stagePath` is the `staged/` file holding the full proposal — named `staged/wrap-up-claude-md-{n}.md` — and `action` is `staged`.
```

In `plugin/skills/wrap-up/adr-curation.md`, find this sentence:

```
Each collected item becomes one payload finding with `action: "staged"`: `targetPath` is the resolved ADR path (or `docs/decisions/` for the convention row), `summary` is the decision title (or the `{plugin form} vs {found form}` comparison), and `stagePath` is the `staged/` file holding the full proposal.
```

Replace with:

```
Each collected item becomes one payload finding with `action: "staged"`: `targetPath` is the resolved ADR path (or `docs/decisions/` for the convention row), `summary` is the decision title (or the `{plugin form} vs {found form}` comparison), and `stagePath` is the `staged/` file holding the full proposal, named `staged/wrap-up-adr-{n}.md`.
```

- [ ] **Step 4: Fix SECTION_MAP and classifyStagedItem in resolve.js**

In `plugin/bin/lib/console/resolve.js`, replace this block (the comment above `SECTION_MAP` through the end of the array, currently lines 33-59):

```js
// Ordered: first match wins. Keyed on the staged file's id prefix — the
// `--id <kind>-<n>` stage-item.js wrote, or the filename a skill names.
// Verified against every `staged/…` prefix the skill corpus names (#1932
// plan, decision 6). An unknown prefix is NOT in this table on purpose:
// classifyStagedItem maps it to Pending review with reason 'unmapped-prefix'
// so a new producer can never slip past the console. A row's optional third
// element is a classification reason: a matched item carrying one resolves to
// `pending` regardless of its section's stance.
const SECTION_MAP = [
  // A sweep-shadow collision copy — `bin/lib/hooks/sweep-shadow.js` names them
  // `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — is a duplicate of
  // some other staged file, not a proposal of its own. First row so it wins over
  // whatever prefix the copied name still carries; never auto-applied.
  [/\.shadow-dup(-\d+)?$/, SECTIONS.PENDING, 'shadow-dup-collision'],
  [/^review-unconfirmed-/, SECTIONS.LOW],
  [/^review-(contested|debate)-/, SECTIONS.CONTESTED],
  [/\.patch$/, SECTIONS.PENDING],
  [/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen)-/, SECTIONS.PENDING],
  [/^wrap-up-skill(-|\b)/, SECTIONS.SKILL],
  // release-backfill- retired #2257 (git describe --contains replaced the
  // staged-backfill mechanism entirely — nothing stages that prefix anymore).
  [/^(wrap-up-doc|tidy-doc)-/, SECTIONS.DOC],
  [/^(wrap-up-journey|journeys)(-|\b)/, SECTIONS.JOURNEY],
  [/^(reflect|digest-promotion|leftover|ledger-record|upstream-unfiled|red-team|specify-overlap|specify-redteam|flaky-allowlist|tidy|plan-retention|feedback-drafts)(-|\b)/, SECTIONS.QUEUE],
  [/^wrap-up-memory-/, SECTIONS.MEMORY],
  [/^wrap-up-upstream-/, SECTIONS.UPSTREAM],
];
```

with:

```js
// Ordered: first match wins. Keyed on the staged file's id prefix — the
// `--id <kind>-<n>` stage-item.js wrote, or the filename a skill names.
// Verified against every `staged/…` prefix the skill corpus names (#1932
// plan, decision 6). An unknown prefix is NOT in this table on purpose:
// classifyStagedItem maps it to Pending review with reason 'unmapped-prefix'
// so a new producer can never slip past the console. A row's optional third
// element is a classification reason: a matched item carrying one resolves to
// `pending` regardless of its section's stance.
//
// A sweep-shadow collision copy — `bin/lib/hooks/sweep-shadow.js` names them
// `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — is handled before
// this table is ever consulted (see SHADOW_DUP_RE below), not as a row here:
// classifying it needs the anchor file's own content, which no other row
// needs and which this table has no way to carry.
const SECTION_MAP = [
  [/^review-unconfirmed-/, SECTIONS.LOW],
  [/^review-(contested|debate)-/, SECTIONS.CONTESTED],
  [/\.patch$/, SECTIONS.PENDING],
  [/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen)-/, SECTIONS.PENDING],
  [/^wrap-up-skill(-|\b)/, SECTIONS.SKILL],
  // release-backfill- retired #2257 (git describe --contains replaced the
  // staged-backfill mechanism entirely — nothing stages that prefix anymore).
  [/^(wrap-up-doc|tidy-doc)-/, SECTIONS.DOC],
  // wrap-up-claude-md-/wrap-up-adr- (#2773): the curation engine's `claude-md`
  // and `decision-records` registry rows (bin/lib/wrap-up/registry.js) stage
  // their proposals under these prefixes — claude-md-curation.md and
  // adr-curation.md name the exact filenames. Routes to the same
  // SECTIONS.CONFIG the engine-row path (ENGINE_ROW_SECTIONS below) already
  // uses for an `applied` finding from either registry row.
  [/^(wrap-up-claude-md|wrap-up-adr)-/, SECTIONS.CONFIG],
  [/^(wrap-up-journey|journeys)(-|\b)/, SECTIONS.JOURNEY],
  [/^(reflect|digest-promotion|leftover|ledger-record|upstream-unfiled|red-team|specify-overlap|specify-redteam|flaky-allowlist|tidy|plan-retention|feedback-drafts)(-|\b)/, SECTIONS.QUEUE],
  [/^wrap-up-memory-/, SECTIONS.MEMORY],
  [/^wrap-up-upstream-/, SECTIONS.UPSTREAM],
];

// `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — bin/lib/hooks/
// sweep-shadow.js's name for a collision copy when the preferred destination
// was already taken. Checked before SECTION_MAP so it always wins over
// whatever prefix the copied name still carries; never auto-applied. A
// `.shadow-dup` file is not always a duplicate of its anchor (#2773) — a
// clobbering write can leave two real, different proposals behind — so
// classifyStagedItem compares the shadow copy's own text against its
// anchor's (when both are readable) instead of guessing: byte-identical
// reports `shadow-dup-duplicate`, anything else reports
// `shadow-dup-divergent`. `siblingText` absent (no anchor found, or its
// content couldn't be read) falls back to the conservative
// `shadow-dup-collision` — "can't tell" is a distinct outcome from
// "confirmed a duplicate," never guessed as one.
const SHADOW_DUP_RE = /\.shadow-dup(-\d+)?$/;
```

Next, replace the `classifyStagedItem` function:

```js
function classifyStagedItem(filename, text) {
  for (const [re, section, reason] of SECTION_MAP) {
    if (!re.test(filename)) continue;
    if (section === SECTIONS.QUEUE && !reason) {
      const category = parseCategory(text);
      if (category && category.toLowerCase() !== 'tangential') {
        return { section: SECTIONS.PENDING, reason: `non-tangential-category:${category}` };
      }
    }
    return reason ? { section, reason } : { section };
  }
  return { section: SECTIONS.PENDING, reason: 'unmapped-prefix' };
}
```

with:

```js
function classifyStagedItem(filename, text, siblingText) {
  if (SHADOW_DUP_RE.test(filename)) {
    if (siblingText === undefined || siblingText === null) {
      return { section: SECTIONS.PENDING, reason: 'shadow-dup-collision' };
    }
    return { section: SECTIONS.PENDING, reason: text === siblingText ? 'shadow-dup-duplicate' : 'shadow-dup-divergent' };
  }
  for (const [re, section, reason] of SECTION_MAP) {
    if (!re.test(filename)) continue;
    if (section === SECTIONS.QUEUE && !reason) {
      const category = parseCategory(text);
      if (category && category.toLowerCase() !== 'tangential') {
        return { section: SECTIONS.PENDING, reason: `non-tangential-category:${category}` };
      }
    }
    return reason ? { section, reason } : { section };
  }
  return { section: SECTIONS.PENDING, reason: 'unmapped-prefix' };
}
```

Next, in `readSnapshot`, replace the `staged` mapping line:

```js
  const staged = deps.readdir(stagedDir).filter((n) => !n.startsWith('.')).sort().map((name) => ({
    name,
    path: path.join(stagedDir, name),
    text: (name.endsWith('.patch') || name.endsWith('.md')) ? readText(deps, path.join(stagedDir, name)) : null,
  }));
```

with:

```js
  const staged = deps.readdir(stagedDir).filter((n) => !n.startsWith('.')).sort().map((name) => ({
    name,
    path: path.join(stagedDir, name),
    text: (name.endsWith('.patch') || name.endsWith('.md') || SHADOW_DUP_RE.test(name)) ? readText(deps, path.join(stagedDir, name)) : null,
  }));
```

Next, replace the `stagedItems` function:

```js
function stagedItems(snapshot) {
  // Refusal is a decisions.md fact about the item, not a fact about its name —
  // so it is decided before SECTION_MAP ever runs and outranks every stance.
  const refused = refusedStagedNames(snapshot.decisions);
  return snapshot.staged.map((s) => {
    if (refused.has(s.name)) return { id: s.name, section: SECTIONS.REFUSED, ...SECTION_STANCES[SECTIONS.REFUSED] };
    const { section, reason } = classifyStagedItem(s.name, s.text);
    if (reason) return { id: s.name, section, resolution: 'pending', reason };
    const stance = SECTION_STANCES[section];
    if (s.name.endsWith('.patch')) {
      const check = snapshot.patchChecks[s.name] || { ok: false, error: 'not checked' };
      if (!check.ok) {
        const inv = parseInvariant(s.text);
        return { id: s.name, section, resolution: 'stale', reason: `git apply --check failed (${check.error || 'unknown'}) — re-derive from Invariant: ${inv || '(no Invariant: line)'}` };
      }
    }
    return { id: s.name, section, resolution: stance.resolution, reason: stance.reason };
  });
}
```

with:

```js
function stagedItems(snapshot) {
  // Refusal is a decisions.md fact about the item, not a fact about its name —
  // so it is decided before SECTION_MAP ever runs and outranks every stance.
  const refused = refusedStagedNames(snapshot.decisions);
  // Anchor lookup for the shadow-dup divergence check: `{preferred}.shadow-dup`
  // compares against `{preferred}`'s own text, when that anchor is also a
  // staged item in this same snapshot.
  const textByName = new Map(snapshot.staged.map((s) => [s.name, s.text]));
  return snapshot.staged.map((s) => {
    if (refused.has(s.name)) return { id: s.name, section: SECTIONS.REFUSED, ...SECTION_STANCES[SECTIONS.REFUSED] };
    const anchorMatch = /^(.*)\.shadow-dup(?:-\d+)?$/.exec(s.name);
    const siblingText = anchorMatch && textByName.has(anchorMatch[1]) ? textByName.get(anchorMatch[1]) : undefined;
    const { section, reason } = classifyStagedItem(s.name, s.text, siblingText);
    if (reason) return { id: s.name, section, resolution: 'pending', reason };
    const stance = SECTION_STANCES[section];
    if (s.name.endsWith('.patch')) {
      const check = snapshot.patchChecks[s.name] || { ok: false, error: 'not checked' };
      if (!check.ok) {
        const inv = parseInvariant(s.text);
        return { id: s.name, section, resolution: 'stale', reason: `git apply --check failed (${check.error || 'unknown'}) — re-derive from Invariant: ${inv || '(no Invariant: line)'}` };
      }
    }
    return { id: s.name, section, resolution: stance.resolution, reason: stance.reason };
  });
}
```

Finally, update `module.exports` at the bottom of the file:

```js
module.exports = { SECTIONS, SECTION_MAP, SECTION_STANCES, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable, drainOverlapHoldPrs };
```

to:

```js
module.exports = { SECTIONS, SECTION_MAP, SECTION_STANCES, ENGINE_ROW_SECTIONS, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable, drainOverlapHoldPrs };
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS — all tests in the file, including the two new ones.

Also run the two other existing test files that import this module, to confirm nothing else regressed:

Run: `node --test tests/resolve-console.test.js tests/console-resolve-conformance.test.js tests/hooks-resolve-console.test.js tests/console-autoresolve-drain-overlap-carveout.test.js tests/console-autoresolve-ungranted-member-carveout.test.js tests/console-autoresolve-needs-human-carveout.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/skills/wrap-up/claude-md-curation.md plugin/skills/wrap-up/adr-curation.md tests/bin-lib/console/resolve.test.js
git commit -m "fix: map wrap-up-claude-md-/wrap-up-adr- in SECTION_MAP, report honest shadow-dup duplicate-vs-divergent

refs #2773"
```
