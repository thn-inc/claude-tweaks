'use strict';
// Fixture tests for plugin/bin/lib/release-notes-publish.js (#2582). Every
// test runs against fake `gh`/`git` fns keyed on their joined argv — never a
// real subprocess, a real GitHub release, or a real `git push` (AC5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  run, resolveTagPair, parseReleaseNotesFromLog, applyToReleaseBody, applyToChangelogEntry,
} = require('../../plugin/bin/lib/release-notes-publish.js');

const FIELD = '\x1f';
const RECORD = '\x1e';
const logOf = (bodies) => bodies.map((b, i) => `${String(i).repeat(40)}${FIELD}${b}${RECORD}`).join('');

function makeDeps(o = {}) {
  const state = {
    files: { 'CHANGELOG.md': o.changelog !== undefined ? o.changelog : '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n\n## 1.2.0 (2026-09-01)\n\n### Bug Fixes\n\n* another thing\n', ...(o.files || {}) },
    gh: [], git: [], writes: [], out: '', err: '',
  };
  const deps = {
    gh: (args, input) => {
      const key = args.join(' ');
      state.gh.push({ key, input });
      if (key === 'release list --json tagName,publishedAt --limit 2') return JSON.stringify(o.releases !== undefined ? o.releases : [{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }, { tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' }]);
      if (key === 'release view v1.3.0 --json body -q .body') return o.releaseBody !== undefined ? o.releaseBody : 'Auto-generated release-please body.';
      if (key.startsWith('release edit')) return '';
      throw new Error(`unexpected gh: ${key}`);
    },
    git: (args) => {
      const key = args.join(' ');
      state.git.push(key);
      if (key.startsWith('log --first-parent')) return logOf(o.commitBodies !== undefined ? o.commitBodies : ['feat: a\n\nRelease-Note: Added the thing.', 'fix: b\n\nno footer here', 'fix: c\n\nRelease-Note: Fixed the other thing.']);
      if (key === 'add CHANGELOG.md' || key.startsWith('commit ') || key === 'push') return '';
      throw new Error(`unexpected git: ${key}`);
    },
    readFile: (p) => (p in state.files ? state.files[p] : null),
    writeFile: (p, text) => { state.writes.push(p); state.files[p] = text; },
    stdout: (t) => { state.out += t; },
    stderr: (t) => { state.err += t; },
  };
  return { deps, state };
}

test('resolveTagPair: fewer than 2 releases is a no-op (null)', () => {
  assert.strictEqual(resolveTagPair([]), null);
  assert.strictEqual(resolveTagPair([{ tagName: 'v1.0.0', publishedAt: '2026-01-01' }]), null);
  assert.strictEqual(resolveTagPair(null), null);
});

test('resolveTagPair: orders by publishedAt, not array order or semver', () => {
  const releases = [
    { tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' },
    { tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' },
  ];
  assert.deepStrictEqual(resolveTagPair(releases), { previous: 'v1.2.0', current: 'v1.3.0' });
});

test('parseReleaseNotesFromLog: extracts a Release-Note: footer per commit, null for commits without one', () => {
  const raw = logOf(['feat: a\n\nRelease-Note: Added the thing.', 'fix: b\n\nno footer']);
  const out = parseReleaseNotesFromLog(raw);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].releaseNote, 'Added the thing.');
  assert.strictEqual(out[1].releaseNote, null);
});

test('applyToReleaseBody: null block is a no-op; otherwise appends Highlights without replacing existing content', () => {
  assert.strictEqual(applyToReleaseBody('existing body', null), null);
  const out = applyToReleaseBody('existing body', '* Added the thing.');
  assert.strictEqual(out, 'existing body\n\n### Highlights\n* Added the thing.');
});

test('applyToReleaseBody: a body that already contains the exact block is a no-op (idempotency)', () => {
  const body = 'existing body\n\n### Highlights\n* Added the thing.';
  assert.strictEqual(applyToReleaseBody(body, '* Added the thing.'), null);
});

test('applyToChangelogEntry: appends to the FIRST entry only (AC9), leaves later entries untouched', () => {
  const changelog = '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n\n## 1.2.0 (2026-09-01)\n\n### Bug Fixes\n\n* another thing\n';
  const out = applyToChangelogEntry(changelog, '* Added the thing.');
  assert.match(out, /## 1\.3\.0 \(2026-10-02\)\n\n### Features\n\n\* a thing\n\n### Highlights\n\* Added the thing\.\n\n## 1\.2\.0/);
  // the second entry is untouched
  assert.match(out, /## 1\.2\.0 \(2026-09-01\)\n\n### Bug Fixes\n\n\* another thing\n$/);
});

test('applyToChangelogEntry: already-contains-the-block entry is a no-op; no heading found is a no-op', () => {
  const alreadyApplied = '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Highlights\n* Added the thing.\n\n## 1.2.0 (2026-09-01)\n';
  assert.strictEqual(applyToChangelogEntry(alreadyApplied, '* Added the thing.'), null);
  assert.strictEqual(applyToChangelogEntry('# Changelog\n\nno version heading here\n', '* x'), null);
  assert.strictEqual(applyToChangelogEntry('anything', null), null);
});

test('AC1: a range with Release-Note: trailers renders the correct block and appends it to both targets, fetching current content first', () => {
  const { deps, state } = makeDeps();
  const code = run([], deps);
  assert.strictEqual(code, 0);
  assert.ok(state.gh.some((c) => c.key === 'release view v1.3.0 --json body -q .body'));
  const editCall = state.gh.find((c) => c.key.startsWith('release edit'));
  assert.ok(editCall);
  assert.strictEqual(editCall.input, 'Auto-generated release-please body.\n\n### Highlights\n* Added the thing.\n* Fixed the other thing.');
  assert.match(state.files['CHANGELOG.md'], /### Highlights\n\* Added the thing\.\n\* Fixed the other thing\./);
  assert.ok(state.writes.includes('CHANGELOG.md'));
  assert.ok(state.git.includes('add CHANGELOG.md'));
});

test('AC2: zero Release-Note: trailers in range is a no-op on both targets — no empty block, no edit call, no commit', () => {
  const { deps, state } = makeDeps({ commitBodies: ['fix: a\n\nno footer', 'chore: b\n\nalso no footer'] });
  const code = run([], deps);
  assert.strictEqual(code, 0);
  assert.ok(!state.gh.some((c) => c.key.startsWith('release edit')));
  assert.deepStrictEqual(state.writes, []);
  assert.match(state.out, /no Release-Note: trailers/);
});

test('AC3: fewer than 2 published releases is a no-op, identical to the zero-trailers case — no commit-range walk attempted', () => {
  const { deps, state } = makeDeps({ releases: [{ tagName: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z' }] });
  const code = run([], deps);
  assert.strictEqual(code, 0);
  assert.ok(!state.git.some((k) => k.startsWith('log --first-parent')));
  assert.ok(!state.gh.some((c) => c.key.startsWith('release edit')));
  assert.deepStrictEqual(state.writes, []);
});

test('AC4: a target that already carries the exact rendered block is skipped independently of the other', () => {
  const alreadyAppliedBody = 'Auto-generated release-please body.\n\n### Highlights\n* Added the thing.\n* Fixed the other thing.';
  const { deps, state } = makeDeps({ releaseBody: alreadyAppliedBody });
  const code = run([], deps);
  assert.strictEqual(code, 0);
  // release body already had it — no edit call
  assert.ok(!state.gh.some((c) => c.key.startsWith('release edit')));
  // CHANGELOG.md did not have it — still gets applied
  assert.ok(state.writes.includes('CHANGELOG.md'));
});

test('AC4 (other direction): CHANGELOG already carries the block, release body does not — only the body is updated', () => {
  const changelogWithBlock = '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Highlights\n* Added the thing.\n* Fixed the other thing.\n\n## 1.2.0 (2026-09-01)\n';
  const { deps, state } = makeDeps({ changelog: changelogWithBlock });
  const code = run([], deps);
  assert.strictEqual(code, 0);
  assert.ok(state.gh.some((c) => c.key.startsWith('release edit')));
  assert.deepStrictEqual(state.writes, []);
});

test('AC6: the commit-range walk uses git log --first-parent over the resolved tag pair', () => {
  const { deps, state } = makeDeps();
  run([], deps);
  assert.ok(state.git.some((k) => k.startsWith('log --first-parent') && k.includes('v1.2.0..v1.3.0')));
});

test('a gh/git failure is caught and reported as exit 1, never thrown', () => {
  const { deps, state } = makeDeps();
  deps.gh = () => { throw new Error('gh: rate limited'); };
  const code = run([], deps);
  assert.strictEqual(code, 1);
  assert.match(state.err, /rate limited/);
});

test('AC7: the module imports RELEASE_NOTE_FOOTER_RE rather than declaring a second copy of the pattern', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../plugin/bin/lib/release-notes-publish.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/release-notes['"]\)/);
  assert.match(src, /RELEASE_NOTE_FOOTER_RE/);
  // No second hand-typed Release-Note:-matching regex literal (release-notes.js's
  // own `/^Release-Note: ?(.*)$/m` pattern, re-declared here).
  assert.ok(!/\/\^?Release-Note:/.test(src), 'expected no second Release-Note: regex literal — import RELEASE_NOTE_FOOTER_RE instead');
});

test('AC8: the module imports and calls renderReleaseNotes rather than reimplementing its filter/map/join logic', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../plugin/bin/lib/release-notes-publish.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/release-notes['"]\)/);
  assert.match(src, /renderReleaseNotes\(commits\)/);
  // No second flat-list bullet-rendering implementation (release-notes.js's
  // own `* ${note}` bullet template, reimplemented here) — the module never
  // builds its own bullet string.
  assert.ok(!/`\*\s*\$\{/.test(src), 'expected no second bullet-template literal — reuse renderReleaseNotes instead');
});

// The step pushes its CHANGELOG commit with a bare `git push`, which the
// tests above fake — so nothing else would notice that a `release` event
// checks out the tag (detached HEAD) and the real push has no branch.
test('the workflow step that runs release-notes-publish checks out the default branch, not the detached release tag', () => {
  const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/mirror-marketplace.yml'), 'utf8');
  const runAt = wf.indexOf('node plugin/bin/release-notes-publish.js');
  assert.ok(runAt > 0, 'expected the workflow to run release-notes-publish.js');
  const checkoutAt = wf.lastIndexOf('uses: actions/checkout@', runAt);
  assert.ok(checkoutAt > 0, 'expected a checkout step before the release-notes-publish run');
  const checkoutStep = wf.slice(checkoutAt, wf.indexOf('- uses:', checkoutAt + 1));
  assert.match(checkoutStep, /^\s+ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/m);
});
