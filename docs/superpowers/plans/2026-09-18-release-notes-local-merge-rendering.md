# Plan: Release notes — local-merge rendering (#2581)

Source spec: GitHub issue #2581 ("Release notes: local-merge rendering"), blocked by and building
on #2580 (the `Release-Note:` authoring contract, merged into this run's shared branch).

## Goal

`local-merge` projects (`bin/release-local.js`) surface each merge commit's `Release-Note:`
trailer as a flat, plain-language bullet list — a new `### Highlights` block in the CHANGELOG
entry `changelog.js`'s `renderSection` already composes — via one new shared module,
`plugin/bin/lib/release-notes.js`, that a later sub-issue (pr-first post-publish) also reuses
unchanged.

## Non-Goals (per issue body)

- Grouping the rendered list under type-derived headings.
- The pr-first rendering path (separate sub-issue, reuses this module).
- Retroactive backfill for commits with no `releaseNote` — `renderReleaseNotes` silently skips them.

### Task 1: Create `plugin/bin/lib/release-notes.js` with `renderReleaseNotes` + `RELEASE_NOTE_FOOTER_RE`

Write `tests/bin-lib/release-notes.test.js` first (TDD — run to see it fail with `MODULE_NOT_FOUND`,
then implement):

- `renderReleaseNotes([])` → `null` (AC6)
- a whitespace-only `releaseNote` (`'   '`) is treated as absent — no bullet (AC7)
- a mix of commits with/without `releaseNote` → one `* {note}` line per non-empty-after-trim note,
  same order as input, zero lines for the rest (AC8)
- `RELEASE_NOTE_FOOTER_RE` is exported and matches `Release-Note: text` per its literal
  `/^Release-Note: ?(.*)$/m` shape (a direct regex-shape assertion, mirroring how
  `commits.test.js` doesn't re-test `BREAKING_FOOTER_RE` directly but this new shared constant
  needs its own pin since two other modules import it)

Implementation (per the issue's own Technical Approach sketch, refined with per-item `.trim()`):

```js
'use strict';
const RELEASE_NOTE_FOOTER_RE = /^Release-Note: ?(.*)$/m;

function renderReleaseNotes(commits) {
  const lines = commits
    .filter((c) => c.releaseNote && c.releaseNote.trim())
    .map((c) => `* ${c.releaseNote.trim()}`);
  return lines.length ? lines.join('\n') : null;
}

module.exports = { renderReleaseNotes, RELEASE_NOTE_FOOTER_RE };
```

**Files:**
- Create: `plugin/bin/lib/release-notes.js`
- Create: `tests/bin-lib/release-notes.test.js`

**Verify:** `node --test tests/bin-lib/release-notes.test.js` — all green.

### Task 2: Extend `commits.js`'s `parseCommit` with `Release-Note:` extraction (both branches)

Update `tests/bin-lib/release-local/commits.test.js` first:
- Update the existing `'parseCommit: type, scope, description'` test's `assert.deepStrictEqual`
  expected object to add `releaseNote: null` (it currently omits the field entirely — this test
  will fail once the field is added unless updated, since `deepStrictEqual` checks own-enumerable
  keys exactly)
- New: conventional path, `Release-Note: Fixed the thing.` footer → `releaseNote === 'Fixed the
  thing.'` (AC1)
- New: unconventional-subject path (mirroring the existing unconventional test's shape) with a
  `Release-Note:` footer → still extracted (AC2)
- New: multi-line `## Release Note`-derived footer (body has `Release-Note: First line.\nSecond
  line that should not appear.`) → `releaseNote === 'First line.'` only, since `/m` without `/s`
  stops the `.` capture at the line's own end (AC3)
- New: no `Release-Note:` footer at all → `releaseNote === null` (AC4) — already covered
  incidentally by every pre-existing test once the field defaults to `null`, but add one explicit
  case naming the AC
- New: combined footer — one body with both `BREAKING CHANGE:` and `Release-Note:` → both
  extracted independently, no cross-match (AC5)

Implementation — import `RELEASE_NOTE_FOOTER_RE` from `release-notes.js`, compute it alongside
`footer` (mirroring the existing single computation used in both branches), and add the field to
both return statements:

```js
const { RELEASE_NOTE_FOOTER_RE } = require('../release-notes');
// ...
const footer = BREAKING_FOOTER_RE.exec(body);
const releaseNoteFooter = RELEASE_NOTE_FOOTER_RE.exec(body);
const releaseNote = releaseNoteFooter ? releaseNoteFooter[1].trim() : null;
if (!m) {
  return { ..., releaseNote };
}
// ...
return { ..., releaseNote };
```

**Files:**
- Modify: `plugin/bin/lib/release-local/commits.js` (`parseCommit` — both branches; require line)
- Modify: `tests/bin-lib/release-local/commits.test.js` (update 1 existing test, add 5 new cases)

**Verify:** `node --test tests/bin-lib/release-local/commits.test.js` — all green (existing +
new cases).

### Task 3: Wire `changelog.js`'s `renderSection` to render `### Highlights`

Update `tests/bin-lib/release-local/changelog-fixture.test.js` first — add 3 new cases (the 4
existing byte-pinned fixture tests must stay green unmodified, since their commits carry no
`releaseNote` field and `renderReleaseNotes` treats `undefined` as absent):
- a commit set with a `releaseNote` AND a breaking commit → output contains `### Highlights`
  positioned after `### ⚠ BREAKING CHANGES` and before the first type-grouped section (AC9) —
  assert via `indexOf` ordering, not a full byte-pin (this is new behavior, not a captured
  release-please fixture)
- a commit set with a `releaseNote` but no breaking commit → `### Highlights` renders first (no
  breaking block precedes it) (AC10)
- a commit set with zero `releaseNote` values → no `### Highlights` substring anywhere in the
  output (AC11) — this is really re-confirming the 4 existing fixture tests' implicit behavior
  explicitly, as its own named AC-mapped case

Implementation:

```js
const { renderReleaseNotes } = require('../release-notes');
// ...
function renderSection({ version, previousTag, date, commits, repo }) {
  // ... existing heading/breaking/groups unchanged ...
  const notes = breaking.length ? `### ⚠ BREAKING CHANGES\n\n${breaking.map(note).join('')}\n` : '';
  const highlights = renderReleaseNotes(commits);
  const highlightsSection = highlights !== null ? `### Highlights\n\n${highlights}\n\n` : '';
  return `${heading}\n\n\n${notes}${highlightsSection}${groups.join('\n\n')}`;
}
```

**Files:**
- Modify: `plugin/bin/lib/release-local/changelog.js` (`renderSection`; require line)
- Modify: `tests/bin-lib/release-local/changelog-fixture.test.js` (add 3 new cases; 4 existing
  cases must stay byte-identical and green, unmodified)

**Verify:** `node --test tests/bin-lib/release-local/changelog-fixture.test.js` — all green (4
existing + 3 new).

## Full verification

`npm test` — full suite green, no regressions. Then `/claude-tweaks:simplify` and
`/claude-tweaks:review` per the standard pipeline.

## Key Files (issue's own list, unchanged)

- `plugin/bin/lib/release-notes.js` (new)
- `plugin/bin/lib/release-local/commits.js`
- `plugin/bin/lib/release-local/changelog.js`
- `tests/bin-lib/release-local/commits.test.js`
- `tests/bin-lib/release-local/changelog-fixture.test.js`
- `tests/bin-lib/release-notes.test.js` (new)
