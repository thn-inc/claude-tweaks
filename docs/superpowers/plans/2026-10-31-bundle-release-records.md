# Bundled-merge release reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A release lists every record a bundled merge shipped, carries each bundled record's own release note, and leaves out notes that say there is no user-visible change.

**Architecture:** The merge composer writes one `Release-Note:` line per bundled record (lowest number first) in the existing Release-Note paragraph. One shared extractor in `release-notes.js` reads every `Release-Note:` line; parsed commits carry `releaseNotes: string[]` plus whole-line `Fixes #N`/`Refs #N` numbers (`fixes`/`refs`), which the release preflight pack passes through. The renderer drops `No user-visible change` notes and exact duplicates; the release console and bookkeeping prose derive the shipped set from `Fixes` lines, falling back to the `(#N)` suffix.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T120302-record-4634/work/4634-spec.md`

**Scope keywords:** RELEASE_NOTE_FOOTER_RE, releaseNote, renderReleaseNotes, parseReleaseNotesFromLog, parseCommit, Records shipped, shipped set

## Global Constraints

- A single-record merge composes a byte-identical title and body to today (`compose-subject.js 10` → `{"title":"fix: Bundle lowest (#10)","body":"Lowest record.\n\nRelease-Note: Added the lowest thing.\n\nFixes #10"}` — captured from the pre-change composer).
- `Release-Note:` lines stay in their own paragraph before the `Fixes`/`Refs` footer paragraph; the `Fixes` lines stay in their own paragraph (release-please parses them).
- Filter rule: drop, case-insensitively, any note *starting with* `No user-visible change` (after trimming). A note that mentions the phrase later is kept.
- Shipped-set rule: a commit with any `Fixes` or `Refs` line ships its `Fixes` numbers; a commit with neither keeps the `(#N)` suffix rule; a `Refs` record is never booked.
- No backfill of old records or old Releases.
- Never test against a live release (#2582); all tests use fakes.
- Zero new dependencies; `node --test` only.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4634` — never `closes`/`fixes`.

## Review Focus

1. A note carrying leading whitespace before `No user-visible change` — trim first, then filter (Task 2 test `AC5.1`).
2. A CRLF commit body (`Fixes #10\r\n`) — the whole-line `Fixes`/`Refs` read still matches (Task 3 test).
3. A body line that only contains `Fixes #13 and more`, a lowercase `fixes #14`, or `See Refs #15` — not whole-line matches, never read as shipped/kept-open (Task 3 test).
4. A kept-open (`Refs`) record's release note still renders — its code shipped (Task 1 test `AC1.2`).
5. A `Refs` number that another commit in the same range ships via `Fixes` is booked and not listed under `Kept open (not booked)` (Task 4 prose pin).

---

### Task 1: Composer — one `Release-Note:` line per bundled record

**Files:**
- Modify: `plugin/bin/lib/release/subject.js` (header comment lines 9-10, `composeSubject` signature comment line 55, release-note validation lines 75-76, inline comment + push lines 103-108)
- Modify: `plugin/bin/lib/compose-subject.js` (header comment lines 10-14, `releaseNote` derivation line 336, `composeSubject` call line 380)
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md` (step 1 Action line 33 "never aggregated across a bundle"; step 3 Action line 47 — add "one `Release-Note:` line per record"; append an `Updated during build of #4634` history line)
- Modify: `docs/plugin-structure.md` line 64 (`releaseNote (## Release Note …)` → one note per record)
- Test: `tests/bin-lib/release/subject.test.js`, `tests/bin-lib/compose-subject.test.js`

**Interfaces:**
- Produces: `composeSubject({ ..., releaseNote: string | string[] })` — a string is one note (unchanged output); an array is one note per record, lowest number first, each trimmed. Writes one `Release-Note: {note}` line per note, joined by `\n` into the single existing paragraph. An empty array, or any entry that is not a non-empty string after trimming, throws `ComposeSubjectError` with the existing message `releaseNote must be a non-empty string for #${number}`.
- `compose-subject.js` passes `releaseNote: records.map((r) => releaseNoteOf(r.body))` (records are already in ascending number order).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/release/subject.test.js`:

```js
test('releaseNote array: one Release-Note line per entry, in order, in one paragraph before the Fixes paragraph', () => {
  const { body } = composeSubject({ type: 'feature', title: 'Add X', number: 42, releaseNote: ['Added X.', '  Fixed Y.  '], fixes: [42, 43] });
  assert.equal(body, 'Release-Note: Added X.\nRelease-Note: Fixed Y.\n\nFixes #42\nFixes #43');
});

test('releaseNote array: an empty array or a blank entry throws naming the record number', () => {
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: [] }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: ['Ok.', '  '] }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: ['Ok.', 7] }), /releaseNote must be a non-empty string[^]*#42/);
});
```

In `tests/bin-lib/compose-subject.test.js`, add to `RECORDS`:

```js
10: { number: 10, title: 'Bundle lowest', body: '## Overview\n\nLowest record.\n\n## Release Note\n\nAdded the lowest thing.\n', labels: [{ name: 'type:bug' }], issueType: null },
11: { number: 11, title: 'Bundle middle', body: '## Overview\n\nMiddle record.\n\n## Release Note\n\nFixed the middle thing.\n', labels: [{ name: 'type:task' }], issueType: null },
12: { number: 12, title: 'Bundle top', body: '## Overview\n\nTop record.\n\n## Release Note\n\nChanged the top thing.\n', labels: [{ name: 'type:task' }], issueType: null },
```

and these tests:

```js
const BUNDLE_NOTES = 'Release-Note: Added the lowest thing.\nRelease-Note: Fixed the middle thing.\nRelease-Note: Changed the top thing.';

test('AC1.1: compose-subject 10,11,12 writes three Release-Note lines in number order, then the Fixes lines', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['12,10,11'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).body, `Lowest record.\n\n${BUNDLE_NOTES}\n\nFixes #10\nFixes #11\nFixes #12`);
});

test('AC1.2: with --keep-open 11 the body still has three notes, and #11\'s footer line is Refs #11', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10,11,12', '--keep-open', '11'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).body, `Lowest record.\n\n${BUNDLE_NOTES}\n\nFixes #10\nRefs #11\nFixes #12`);
});

test('AC2.1: compose-subject 10 output equals the pre-#4634 composer byte for byte', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10'], deps), 0, out.stderr);
  assert.equal(out.stdout, '{"title":"fix: Bundle lowest (#10)","body":"Lowest record.\\n\\nRelease-Note: Added the lowest thing.\\n\\nFixes #10"}\n');
});

test('AC3.1: a bundle where any record has an empty ## Release Note section still fails with the existing message', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10,11,2271'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2271 carry no non-empty "## Release Note" section/);
  assert.equal(out.stdout, '');
});
```

Flip the existing pins this change overturns on purpose (spec Gotcha: #2580 AC 3 flips):
- Test `bundle: releaseNote is derived from the subject record only …` (line ~94): rename to `bundle: every record's Release Note renders, lowest number first (#4634 flips #2580 AC 3)` and assert the body contains `Release-Note: Made merge subjects Conventional Commits shaped.\nRelease-Note: Made reconcile squash-aware.`
- Test `bundle: subject from the lowest number, one Fixes line per record ascending, tag paragraph` (line ~170): expected body becomes `'Makes the merge subject conventional.\n\n[auto-merge]\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\nRelease-Note: Made reconcile squash-aware.\n\nFixes #2251\nFixes #2252'`.
- Test `--keep-open absent: the body is byte-identical to the pre-#4199 composer …` (line ~798): rename to `--keep-open absent: every footer line is Fixes, JSON and --out-dir alike`, rename the constant to `NO_KEEP_OPEN_BODY`, and give it the two-note body above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js`
Expected: FAIL — `releaseNote array` tests throw `releaseNote must be a non-empty string` for the array input; `AC1.1`/`AC1.2` and the three flipped pins fail on missing `Release-Note: Fixed the middle thing.` lines. `AC2.1` and `AC3.1` PASS already (they pin today's behavior).

- [ ] **Step 3: Implement**

In `subject.js`, normalize `releaseNote` to a list (`typeof === 'string'` → `[releaseNote]`, an array as-is, anything else → `[]`), trim each, throw the existing usage error when the list is empty or any entry is blank/non-string, and replace the single `paragraphs.push` at line 108 with one push of `notes.map((n) => \`Release-Note: ${n}\`).join('\n')`. Rewrite the header comment (lines 9-10) and the inline comment (lines 103-107) to say one `Release-Note:` line per bundled record, each single-line by construction, read back by `release-notes.js`'s `extractReleaseNotes`. Update the signature comment to `releaseNote: string|string[]`.

In `compose-subject.js`, replace line 336 with `const releaseNotes = records.map((r) => releaseNoteOf(r.body));` and pass `releaseNote: releaseNotes`. Rewrite header lines 10-14: every record's `## Release Note` section, one per record, lowest number first (#4634 — replacing the old "never aggregated across a bundle" rule).

Update the journey and `docs/plugin-structure.md` line 64 per the Files block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release/subject.js plugin/bin/lib/compose-subject.js tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js docs/journeys/merge-a-record-with-a-conventional-subject-2251.md docs/plugin-structure.md
git commit -m "Compose one Release-Note line per bundled record — every bundle member's note reaches the commit, refs #4634"
```

---

### Task 2: Shared `Release-Note:` extractor and renderer filter

**Files:**
- Modify: `plugin/bin/lib/release-notes.js` (header comment; retire the `RELEASE_NOTE_FOOTER_RE` export — keep the pattern module-internal as a `/gm` regex; add `extractReleaseNotes`; rewrite `renderReleaseNotes`)
- Modify: `plugin/bin/lib/release-local/commits.js` (import line 12; `parseCommit` lines 55-58 and its return's `releaseNote` field → `releaseNotes`)
- Modify: `plugin/bin/lib/release-notes-publish.js` (import line 23; `parseReleaseNotesFromLog` lines 45-57 → `{ sha, releaseNotes }`; header exit-code comment line 19 and the zero-block stdout line 112 → `no Release-Note: trailers to render between …`)
- Modify: `docs/releasing.md` line 15 (every `Release-Note:` line — one per bundled record — drops `No user-visible change` notes and exact duplicates)
- Modify: `docs/plugin-structure.md` lines 31, 32, 243 (`RELEASE_NOTE_FOOTER_RE` → `extractReleaseNotes`; `releaseNote` → `releaseNotes`; renderer filter)
- Test: `tests/bin-lib/release-notes.test.js`, `tests/bin-lib/release-local/commits.test.js`, `tests/bin-lib/release-notes-publish.test.js`, `tests/bin-lib/release-local/changelog-fixture.test.js`

**Interfaces:**
- Produces: `extractReleaseNotes(body: string) -> string[]` — every line matching `^Release-Note: ?(.*)$` (multiline, global), trimmed, empty ones dropped, in body order; a non-string body → `[]`.
- Produces: `renderReleaseNotes(commits: Array<{ releaseNotes?: string[] }>) -> string | null` — flattens notes in commit order then note order, trims, drops empty notes, drops notes matching `/^no user-visible change/i`, drops exact duplicates (first occurrence kept), renders `* {note}` lines joined by `\n`; `null` when nothing remains. A commit with no `releaseNotes` array contributes nothing.
- Produces: parsed commits (`parseCommit`, `readCommits`, `conventionalHistory`) carry `releaseNotes: string[]` in place of `releaseNote: string|null`.
- Produces: `parseReleaseNotesFromLog(raw) -> Array<{ sha: string, releaseNotes: string[] }>`.
- Consumers of the parsed commit shape (Consumer-enumeration check): `release-local/changelog.js` `renderSection` (list-all, via `renderReleaseNotes` — no code change), `release-preflight/pack.js` (does not read the note — no change), `release-notes-publish.js` (own parser, migrated here).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/release-notes.test.js`, replace the two `RELEASE_NOTE_FOOTER_RE` tests and migrate the existing renderer tests from `{ releaseNote: x }` to `{ releaseNotes: [x] }` (`null` → `[]`). Add:

```js
const THREE = 'feat: x (#10)\n\nRelease-Note: One.\nRelease-Note:   Two.  \nRelease-Note: Three.\n\nFixes #10\nFixes #11\nFixes #12';

test('AC4.1: extractReleaseNotes returns every note from a three-note body, trimmed and in order', () => {
  assert.deepStrictEqual(extractReleaseNotes(THREE), ['One.', 'Two.', 'Three.']);
});

test('AC4.2: extractReleaseNotes returns [] from a body with none, and never matches a BREAKING CHANGE: footer', () => {
  assert.deepStrictEqual(extractReleaseNotes('just a body\n\nBREAKING CHANGE: x\n\nFixes #1'), []);
  assert.deepStrictEqual(extractReleaseNotes(undefined), []);
});

test('AC4.3: parseCommit and parseReleaseNotesFromLog both return all three notes for the same body', () => {
  assert.deepStrictEqual(parseCommit({ sha: 'a'.repeat(40), subject: 'feat: x (#10)', body: THREE }).releaseNotes, ['One.', 'Two.', 'Three.']);
  assert.deepStrictEqual(parseReleaseNotesFromLog(`${'a'.repeat(40)}\x1f${THREE}\x1e`)[0].releaseNotes, ['One.', 'Two.', 'Three.']);
});

test('AC5.1: renderReleaseNotes drops both No user-visible change forms (any case, after trimming) and keeps a note that mentions the phrase later', () => {
  const out = renderReleaseNotes([{ releaseNotes: ['No user-visible change.', 'No user-visible change: fixes Windows-only test failures.', '  no user-visible change — internal.', 'Added X; No user-visible change to Y.'] }]);
  assert.strictEqual(out, '* Added X; No user-visible change to Y.');
});

test('AC5.2: renderReleaseNotes collapses an exact duplicate to one bullet, across commits', () => {
  assert.strictEqual(renderReleaseNotes([{ releaseNotes: ['Added X.', 'Fixed Y.'] }, { releaseNotes: ['Added X.'] }]), '* Added X.\n* Fixed Y.');
});

test('AC5.3: renderReleaseNotes returns null when every note was dropped', () => {
  assert.strictEqual(renderReleaseNotes([{ releaseNotes: ['No user-visible change.'] }, { releaseNotes: [] }, {}]), null);
});

test('neither commits.js nor release-notes-publish.js restates the Release-Note: pattern — both import extractReleaseNotes', () => {
  for (const rel of ['plugin/bin/lib/release-local/commits.js', 'plugin/bin/lib/release-notes-publish.js']) {
    const src = readText(path.join(__dirname, '..', '..', rel));
    assert.match(src, /extractReleaseNotes/, rel);
    assert.ok(!/\/\^?Release-Note:/.test(src), `${rel} declares its own Release-Note: regex literal`);
  }
});
```

(`readText` from `../helpers/read-skill`; `parseCommit` from `../../plugin/bin/lib/release-local/commits.js`; `parseReleaseNotesFromLog` from `../../plugin/bin/lib/release-notes-publish.js`.)

In `tests/bin-lib/release-notes-publish.test.js`: replace the `AC7` import test's `RELEASE_NOTE_FOOTER_RE` assertions with `extractReleaseNotes` (or delete it — the test above now covers both modules); update the `parseReleaseNotesFromLog` test to `releaseNotes` arrays (`['Added the thing.']`, `[]`). Add:

```js
test('AC6.1: a three-record bundle in range applies a Highlights block holding all three notes to the Release body and the CHANGELOG entry', () => {
  const { deps, state } = makeDeps({ commitBodies: ['fix: bundle (#10)\n\nRelease-Note: Added A.\nRelease-Note: Fixed B.\nRelease-Note: Changed C.\n\nFixes #10\nFixes #11\nFixes #12'] });
  assert.strictEqual(run([], deps), 0, state.err);
  const block = '### Highlights\n* Added A.\n* Fixed B.\n* Changed C.';
  const edit = state.gh.find((c) => c.key.startsWith('release edit'));
  assert.ok(edit && edit.input.includes(block), JSON.stringify(state.gh));
  assert.ok(state.files['CHANGELOG.md'].includes(block), state.files['CHANGELOG.md']);
});

test('AC6.2: only No user-visible change notes in range is a no-op on both targets', () => {
  const { deps, state } = makeDeps({ commitBodies: ['chore: a (#10)\n\nRelease-Note: No user-visible change.\n\nFixes #10', 'chore: b (#11)\n\nRelease-Note: No user-visible change: internal.\n\nFixes #11'] });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.ok(!state.gh.some((c) => c.key.startsWith('release edit')), 'no Release edit');
  assert.deepStrictEqual(state.writes, []);
  assert.ok(!state.git.some((k) => k.startsWith('commit ')), 'no CHANGELOG commit');
});
```

(Check `makeDeps`'s return shape against the existing tests in that file and match it — `{ deps, state }` is assumed here; adapt the destructuring if it differs.)

In `tests/bin-lib/release-local/commits.test.js`: the `parseCommit: type, scope, description` deepStrictEqual drops `releaseNote: null` for `releaseNotes: []` (Task 3 adds `fixes`/`refs` to the same literal); every other `c.releaseNote` assertion becomes `c.releaseNotes` with an array (`['Fixed the thing.']`, `['Merged the branch.']`, `['First line.']`, `[]`, `['Renamed the config key.']`); rename the "no Release-Note footer" test to `… returns releaseNotes: []`.

In `tests/bin-lib/release-local/changelog-fixture.test.js`: `{ releaseNote: 'X' }` → `{ releaseNotes: ['X'] }` at lines 59-60 and 76; rename the three test titles' `releaseNote` → `releaseNotes`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/release-notes.test.js tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-notes-publish.test.js tests/bin-lib/release-local/changelog-fixture.test.js`
Expected: FAIL — `extractReleaseNotes is not a function`; `releaseNotes` undefined on parsed commits; AC5/AC6 bullets still include the filtered notes.

- [ ] **Step 3: Implement** per the Interfaces block. Rewrite `release-notes.js`'s header and remove the "Single-match … only yields the first Release-Note: line" comment; rewrite `commits.js`'s line 55 comment (each `Release-Note:` line is single-line by construction; a bundle carries one per record). Update `docs/releasing.md` and `docs/plugin-structure.md` per the Files block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/release-notes.test.js tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-notes-publish.test.js tests/bin-lib/release-local/changelog-fixture.test.js tests/bin-lib/release-local/changelog.test.js tests/bin-lib/release-local/acceptance.test.js tests/bin-lib/release-local/cli.test.js`
Expected: PASS, 0 failures.

Then the retirement sweep: `git grep -n -e RELEASE_NOTE_FOOTER_RE -e "releaseNote fields" -e "{sha, releaseNote}" -- plugin docs tests` — Expected: no output (history under `.claude-tweaks/pipelines/archive/` and `CHANGELOG.md` excluded by the pathspec).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release-notes.js plugin/bin/lib/release-local/commits.js plugin/bin/lib/release-notes-publish.js docs/releasing.md docs/plugin-structure.md tests/bin-lib/release-notes.test.js tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-notes-publish.test.js tests/bin-lib/release-local/changelog-fixture.test.js
git commit -m "Read every Release-Note line through one extractor — renderer drops no-user-visible-change notes and duplicates, refs #4634"
```

---

### Task 3: `Fixes`/`Refs` numbers on parsed commits and the `unreleased` probe

**Files:**
- Modify: `plugin/bin/lib/release-local/commits.js` (`parseCommit` — add `fixes`, `refs`)
- Modify: `plugin/bin/lib/release-preflight/pack.js` line 323 (`unreleased` map passes `fixes: c.fixes, refs: c.refs`)
- Modify: `plugin/skills/release/SKILL.md` line 101 (`unreleased` field list gains `fixes, refs`; file is 48,673 B against the 52,500 B rail — headroom ample)
- Test: `tests/bin-lib/release-local/commits.test.js`, `tests/bin-lib/release-preflight/pack.test.js`

**Interfaces:**
- Consumes: Task 2's `parseCommit` shape (`releaseNotes`).
- Produces: `parseCommit(...)` returns `fixes: number[]` and `refs: number[]` — whole-line matches of `^Fixes #(\d+)[ \t]*\r?$` and `^Refs #(\d+)[ \t]*\r?$` (multiline, global, case-sensitive), in body order. `parseFixesSpan` in `plugin/bin/lib/flow/closing-links.js` was checked and does not fit: it reads only between PR-body span markers, which a commit body never carries.
- Produces: `unreleased.value.commits[]` entries carry `fixes` and `refs` (both always arrays). Return-shape widening check: `tests/bin-lib/release-local/commits.test.js` line 8's deepStrictEqual is the only exact-literal assertion on the parsed shape; the pack tests assert per-field.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/release-local/commits.test.js`, extend line 8's expected literal with `fixes: [], refs: []`, and add:

```js
test('parseCommit reads whole-line Fixes #N and Refs #N into fixes and refs, in body order', () => {
  const c = parseCommit({ sha: 'k'.repeat(40), subject: 'fix: bundle (#10)', body: 'Release-Note: A.\n\nFixes #10\nRefs #11\nFixes #12' });
  assert.deepStrictEqual([c.fixes, c.refs], [[10, 12], [11]]);
});

test('parseCommit ignores Fixes/Refs that are not whole lines, and lowercase forms', () => {
  const c = parseCommit({ sha: 'l'.repeat(40), subject: 'fix: y', body: 'Fixes #13 and more\nfixes #14\nSee Refs #15\nrefs #16' });
  assert.deepStrictEqual([c.fixes, c.refs], [[], []]);
});

test('parseCommit reads Fixes/Refs lines from a CRLF body', () => {
  const c = parseCommit({ sha: 'm'.repeat(40), subject: 'fix: y', body: 'Release-Note: A.\r\n\r\nFixes #10\r\nRefs #11\r\n' });
  assert.deepStrictEqual([c.fixes, c.refs], [[10], [11]]);
});
```

In `tests/bin-lib/release-preflight/pack.test.js`, change `LOG` to take bodies — `const LOG = (subjects, bodies = []) => subjects.map((s, i) => \`${String(i).repeat(40)}\x1f${s}\x1f${bodies[i] || ''}\x1e\n\`).join('');` — and the mock's default branch to `LOG(o.subjects === undefined ? ['feat: a'] : o.subjects, o.bodies)`. Add:

```js
test('AC7.1: the unreleased probe returns fixes and refs for each commit — [10, 12] and [11] for a bundle with #11 kept open', async () => {
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ subjects: ['fix: bundle (#10)', 'chore: plain'], bodies: ['Release-Note: A.\n\nFixes #10\nRefs #11\nFixes #12', ''] }).deps });
  const [bundle] = pack.unreleased.value.commits;
  assert.deepStrictEqual([bundle.fixes, bundle.refs], [[10, 12], [11]]);
});

test('AC7.2: the unreleased probe returns two empty lists for a commit with neither line', async () => {
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ subjects: ['fix: bundle (#10)', 'chore: plain'], bodies: ['Fixes #10', ''] }).deps });
  const plain = pack.unreleased.value.commits[1];
  assert.deepStrictEqual([plain.fixes, plain.refs], [[], []]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-preflight/pack.test.js`
Expected: FAIL — `fixes`/`refs` are `undefined`.

- [ ] **Step 3: Implement** per the Interfaces block; update `SKILL.md` line 101's field list to `{sha, type, scope, breaking, breakingNote, subject, description, unconventional, fixes, refs}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-preflight/pack.test.js tests/bin-lib/release-preflight/acceptance.test.js tests/bin-lib/release-preflight/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release-local/commits.js plugin/bin/lib/release-preflight/pack.js plugin/skills/release/SKILL.md tests/bin-lib/release-local/commits.test.js tests/bin-lib/release-preflight/pack.test.js
git commit -m "Carry Fixes and Refs numbers on unreleased commits — the release reads every record a bundle shipped, refs #4634"
```

---

### Task 4: Shipped-set rule in the release console and bookkeeping prose

**Files:**
- Modify: `plugin/skills/release/console.md` line 20 (`Records shipped` row)
- Modify: `plugin/skills/release/bookkeeping.md` line 19 (Inputs: the shipped set) and line 94 (anti-pattern row: "resolved `(#N)` suffixes to records" → "resolved each commit's `Fixes` numbers and `(#N)` suffixes to records")
- Create: `tests/release-shipped-set-conformance.test.js`

Behavior-change prose sweep (run before editing; every hit is listed here): `git grep -n -i -e "per \`(#N)\` suffix" -e "distinct \`(#N)\` suffix" -e "resolved \`(#N)\` suffixes" -- plugin docs` → `console.md:20`, `bookkeeping.md:19`, `bookkeeping.md:94` (edited); `docs/journeys/release-a-version.md:32` (red flag about unattributed commits — still true, no change).

**Interfaces:**
- Consumes: Task 3's `unreleased.value.commits[].fixes` / `.refs`.

The three clause strings below are exact copy — both files carry all three verbatim (the test pins them in both):

- `CLAUSE_FIXES`: ``a commit carrying any `Fixes` or `Refs` line ships its `Fixes` numbers, so a bundle books every `Fixes` number``
- `CLAUSE_REFS`: ``a `Refs`-only commit books nothing, even when its `(#N)` suffix names that record``
- `CLAUSE_SUFFIX`: ``a commit carrying neither line ships its `(#N)` suffix``

Console row's opening, replacing "One line per `(#N)` suffix found in `unreleased.value.commits[].subject`, joined to that record's title and type.": "One line per record in the shipped set, joined to that record's title and type. The shipped set is built per commit in `unreleased.value.commits[]`, from its `fixes`/`refs` lists and its subject: {CLAUSE_FIXES}; {CLAUSE_REFS} — Step 7 closes what it books, and a `Refs` record was kept open on purpose (#4199); {CLAUSE_SUFFIX}." Later in the row: "Duplicate `(#N)` suffixes across commits collapse to one line." → "A number shipped by more than one commit collapses to one line."; the PR-payload drop sentence keeps applying to every number; "A commit subject carrying no `(#N)` suffix never drops out of this row" → "A commit that ships no number (neither line, no `(#N)` suffix) never drops out of this row"; add: "`Refs` numbers that nothing else in the range ships render on one nested `Kept open (not booked): #a, #b` line, never booked at Step 7."

Bookkeeping Inputs bullet's opening, replacing "one entry per distinct `(#N)` suffix in `unreleased.value.commits[].subject` (…), the same join Step 4's console row rendered, deduplicated across repeated suffixes,": "the same set Step 4's `Records shipped` row rendered (console.md), built per commit in `unreleased.value.commits[]` (`plugin/bin/lib/release-preflight/pack.js`): {CLAUSE_FIXES}; {CLAUSE_REFS}, because this step closes what it books; {CLAUSE_SUFFIX}. Deduplicated across commits,". Keep the "minus the `(#N)` suffixes Step 4 dropped as PR numbers" sentence, reworded to "minus the numbers Step 4 dropped as PR numbers". Its last sentence becomes "A commit that ships no number contributes no record here — …".

- [ ] **Step 1: Write the failing test** `tests/release-shipped-set-conformance.test.js`:

```js
'use strict';
// Pins #4634's shipped-set rule in the two release-skill files that apply it, with go-red controls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'release');
const CONSOLE = readText(path.join(DIR, 'console.md'));
const BOOKKEEPING = readText(path.join(DIR, 'bookkeeping.md'));
const CLAUSES = {
  fixes: 'a commit carrying any `Fixes` or `Refs` line ships its `Fixes` numbers, so a bundle books every `Fixes` number',
  refs: 'a `Refs`-only commit books nothing, even when its `(#N)` suffix names that record',
  suffix: 'a commit carrying neither line ships its `(#N)` suffix',
};

function assertShippedSetRule(text, label) {
  for (const [name, clause] of Object.entries(CLAUSES)) {
    assert.ok(text.includes(clause), `${label}: shipped-set clause "${name}" missing`);
  }
  assert.ok(!text.includes('One line per `(#N)` suffix'), `${label}: still states the suffix-only rule`);
  assert.ok(!text.includes('one entry per distinct `(#N)` suffix'), `${label}: still states the suffix-only rule`);
}

test('AC8.1: console.md states the shipped-set rule, all three cases', () => assertShippedSetRule(CONSOLE, 'console.md'));
test('AC8.1: bookkeeping.md states the shipped-set rule, all three cases', () => assertShippedSetRule(BOOKKEEPING, 'bookkeeping.md'));

test('AC8.2: console.md renders unbooked Refs numbers on one nested Kept open (not booked) line', () => {
  assert.ok(CONSOLE.includes('`Kept open (not booked): #a, #b`'));
});

test('go-red: dropping any one clause, or restoring the suffix-only rule, fails the assertion', () => {
  for (const [label, text] of [['console.md', CONSOLE], ['bookkeeping.md', BOOKKEEPING]]) {
    for (const clause of Object.values(CLAUSES)) {
      assert.throws(() => assertShippedSetRule(text.replace(clause, ''), label));
    }
    assert.throws(() => assertShippedSetRule(`${text}\nOne line per \`(#N)\` suffix`, label));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/release-shipped-set-conformance.test.js`
Expected: FAIL — clause "fixes" missing in both files.

- [ ] **Step 3: Edit `console.md` and `bookkeeping.md`** per the exact copy above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/release-shipped-set-conformance.test.js tests/release-reviewed-tip-conformance.test.js tests/release-skill-reference-form.test.js tests/release-run-dir-lifecycle-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/release/console.md plugin/skills/release/bookkeeping.md tests/release-shipped-set-conformance.test.js
git commit -m "Derive the release's shipped set from Fixes lines — a bundle books every record, a Refs record stays open, refs #4634"
```

---

### Task 5: Revert-proof evidence (AC9) — no commit

Controller-run scratch check, after Tasks 1-4. For each change, edit only that hunk back to its pre-#4634 form in the worktree file, run the named suite, then restore the committed content with `git show HEAD:{file} > {file}` (never `git stash`, never `git checkout`) and confirm `git diff --quiet -- {file}`. Record which new test fails:

| AC9 clause | Revert | Suite | Expected red test |
|---|---|---|---|
| AC9.1 composer | `subject.js` back to the single-note push | `tests/bin-lib/compose-subject.test.js` | `AC1.1` |
| AC9.1 extractor | `extractReleaseNotes` back to a single `exec` match | `tests/bin-lib/release-notes.test.js` | `AC4.1` |
| AC9.1 renderer filter | drop the `No user-visible change` filter | `tests/bin-lib/release-notes.test.js` | `AC5.1` |
| AC9.1 fixes/refs read | `parseCommit` without `fixes`/`refs` | `tests/bin-lib/release-preflight/pack.test.js` | `AC7.1` |

Evidence: `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, each run's output redirected to `$PIPELINE_RUN_DIR/evidence/ac9-{name}.txt`, then one `log-decision.js --status AUTO --step "AC evidence" --text-file {file}` entry naming `AC9`, the four reverts, and the red test each produced. Confirm `git status --porcelain` is clean afterwards.

Waived AC10.1: `npm test` passing is `/build` Common Step 5's runner verification (and `/test`'s), not a plan test step.
