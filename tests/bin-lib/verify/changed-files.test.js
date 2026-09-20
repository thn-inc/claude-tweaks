'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  changedFiles, resolveBase, usableAnchor, ChangedFilesError,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'changed-files.js'));

const FULL = '0123456789abcdef0123456789abcdef01234567';
const MB = 'fedcba9876543210fedcba9876543210fedcba98';
const CANON = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// A fake exec seam keyed by the joined git argv; a missing key throws like
// execFileSync does on a non-zero exit.
function fakeExec(table) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.join(' ');
    if (!(key in table)) { const e = new Error(`fake git: no entry for "${key}"`); e.status = 128; throw e; }
    const v = table[key];
    if (v instanceof Error) throw v;
    return v;
  };
  exec.calls = calls;
  return exec;
}

test('changedFiles unions the committed diff (-z) and the working tree (-z), mapping renames to the new path, deletions to the old, and surviving a C-quotable path (#1922)', () => {
  const diffZ = ['M', 'src/a.js', 'R100', 'old/b.js', 'new/b.js', 'D', 'gone.js', 'A', 'src/café.js', ''].join('\0');
  const statusZ = [' M src/a.js', '?? scratch.txt', 'R  y.js', 'x.js', ' D removed.js', ''].join('\0');
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: diffZ,
    'status --porcelain -z --untracked-files=all': statusZ,
  });
  const r = changedFiles({ base: FULL, execImpl: exec });
  assert.strictEqual(r.base, FULL);
  assert.deepStrictEqual(r.files, ['gone.js', 'new/b.js', 'removed.js', 'scratch.txt', 'src/a.js', 'src/café.js', 'y.js']);
});

test('changedFiles with a clean tree and no commits since base is an empty set, not an error', () => {
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: '',
    'status --porcelain -z --untracked-files=all': '',
  });
  assert.deepStrictEqual(changedFiles({ base: FULL, execImpl: exec }), { base: FULL, files: [] });
});

test('changedFiles reports each file in a new untracked directory individually, not the directory (finding 8)', () => {
  const statusZ = ['?? new/x.js', '?? new/y.js', ''].join('\0');
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: '',
    'status --porcelain -z --untracked-files=all': statusZ,
  });
  const r = changedFiles({ base: FULL, execImpl: exec });
  assert.deepStrictEqual(r.files, ['new/x.js', 'new/y.js']);
});

test('resolveBase returns the canonical rev-parse of the stamp fullSha when it is an ancestor of HEAD (AC3 case 1, finding 11)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
  });
  assert.strictEqual(resolveBase({ stamp: { sha: 'x', fullSha: FULL }, integrationBranch: 'main', execImpl: exec }), CANON);
});

test('resolveBase falls back to the integration-branch merge-base when the stamp anchor is not an ancestor (rewritten history) or no stamp exists (AC3 case 2)', () => {
  const noAncestor = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: new Error('exit 1'),
    'rev-parse --verify --quiet refs/remotes/origin/main': 'abc\n',
    'merge-base --end-of-options origin/main HEAD': `${MB}\n`,
  });
  assert.strictEqual(resolveBase({ stamp: { sha: 'x', fullSha: FULL }, integrationBranch: 'main', execImpl: noAncestor }), MB);
  const noStamp = fakeExec({
    'rev-parse --verify --quiet refs/remotes/origin/main': 'abc\n',
    'merge-base --end-of-options origin/main HEAD': `${MB}\n`,
  });
  assert.strictEqual(resolveBase({ stamp: null, integrationBranch: 'main', execImpl: noStamp }), MB);
  const bareLocal = fakeExec({
    'rev-parse --verify --quiet refs/remotes/origin/main': new Error('no such ref'),
    'merge-base --end-of-options main HEAD': `${MB}\n`,
  });
  assert.strictEqual(resolveBase({ stamp: null, integrationBranch: 'main', execImpl: bareLocal }), MB);
});

test('resolveBase with requireNonDegenerate skips a stamp anchor that equals current HEAD and falls through to the integration branch (#2486)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
    'rev-parse --verify HEAD': `${FULL}\n`,
    'rev-parse --verify --quiet refs/remotes/origin/main': 'abc\n',
    'merge-base --end-of-options origin/main HEAD': `${MB}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, MB);
});

test('resolveBase without requireNonDegenerate keeps returning the HEAD-equal stamp anchor unchanged (--scope semantics untouched, #2486)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    execImpl: exec,
  });
  assert.strictEqual(result, FULL);
  assert.ok(!exec.calls.some((c) => c[0] === 'git' && c[1] === 'rev-parse' && c[2] === '--verify' && c[3] === 'HEAD'));
});

test('resolveBase with requireNonDegenerate but no integrationBranch still returns the HEAD-equal anchor (nothing to fall through to)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${FULL}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, FULL);
});

test('resolveBase with requireNonDegenerate does not skip a stamp anchor that differs from HEAD (genuine incremental case unaffected)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
    'rev-parse --verify HEAD': `${MB}\n`,
  });
  const result = resolveBase({
    stamp: { sha: 'x', fullSha: FULL },
    integrationBranch: 'main',
    requireNonDegenerate: true,
    execImpl: exec,
  });
  assert.strictEqual(result, CANON);
});

test('resolveBase throws when no explicit base, no usable stamp anchor, and no --integration-branch is given — no inline default-branch resolver (finding 9)', () => {
  const exec = fakeExec({});
  assert.throws(() => resolveBase({ stamp: null, execImpl: exec }), ChangedFilesError);
  assert.ok(!exec.calls.some((c) => c.includes('symbolic-ref')));
});

test('resolveBase throws ChangedFilesError when the integration branch is given but resolves to nothing — never an empty set (AC3 case 3)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: new Error('exit 1'),
    'rev-parse --verify --quiet refs/remotes/origin/main': new Error('no'),
    'merge-base --end-of-options main HEAD': new Error('fatal: not a valid object name'),
  });
  assert.throws(() => resolveBase({ stamp: { sha: 'x', fullSha: FULL }, integrationBranch: 'main', execImpl: exec }), ChangedFilesError);
});

test('resolveBase verifies an explicit base as a commit and never consults the stamp', () => {
  const exec = fakeExec({ [`rev-parse --verify --end-of-options ${MB}^{commit}`]: `${MB}\n` });
  assert.strictEqual(resolveBase({ stamp: { sha: 'x', fullSha: FULL }, base: MB, integrationBranch: 'main', execImpl: exec }), MB);
  assert.ok(!exec.calls.some((c) => c.includes('--is-ancestor')));
  const bad = fakeExec({ 'rev-parse --verify --end-of-options nope^{commit}': new Error('fatal') });
  assert.throws(() => resolveBase({ stamp: null, base: 'nope', execImpl: bad }), ChangedFilesError);
});

test('resolveBase uses stamp.sha as the anchor for a legacy stamp that carries no fullSha, canonicalized via rev-parse (finding 11)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
  });
  assert.strictEqual(resolveBase({ stamp: { sha: FULL, scope: 'full', legacy: true }, integrationBranch: 'main', execImpl: exec }), CANON);
});

// #1922 re-review NEW-1: usableAnchor is the exact "is this anchor still
// usable" test resolveBase's anchor-first path and bin/verify.js's
// --base-vs-anchor conflict check both need — pinned standalone so the two
// call sites can never silently diverge.
test('usableAnchor returns the canonical sha when the stamp anchor is an ancestor of HEAD', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
  });
  assert.strictEqual(usableAnchor({ stamp: { sha: 'x', fullSha: FULL }, execImpl: exec }), CANON);
});

test('usableAnchor returns null when the anchor is not an ancestor of HEAD (a rewritten/rebased history)', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: new Error('exit 1'),
  });
  assert.strictEqual(usableAnchor({ stamp: { sha: 'x', fullSha: FULL }, execImpl: exec }), null);
});

test('usableAnchor returns null when there is no stamp at all', () => {
  assert.strictEqual(usableAnchor({ stamp: null, execImpl: fakeExec({}) }), null);
});

test('usableAnchor falls back to stamp.sha for a legacy stamp with no fullSha', () => {
  const exec = fakeExec({
    [`merge-base --is-ancestor --end-of-options ${FULL} HEAD`]: '',
    [`rev-parse --verify --end-of-options ${FULL}^{commit}`]: `${CANON}\n`,
  });
  assert.strictEqual(usableAnchor({ stamp: { sha: FULL, scope: 'full', legacy: true }, execImpl: exec }), CANON);
});

// #1922 review finding (medium): a dash-prefixed anchor from the JSON stamp
// must not be parsed as a git flag — --end-of-options guards the untrusted
// anchor the same way every other git call in this file does.
test('usableAnchor guards a dash-prefixed anchor with --end-of-options so it cannot be parsed as a flag', () => {
  const exec = fakeExec({
    'merge-base --is-ancestor --end-of-options --bogus HEAD': new Error('exit 1'),
  });
  assert.strictEqual(usableAnchor({ stamp: { sha: 'x', fullSha: '--bogus' }, execImpl: exec }), null);
  const call = exec.calls.find((c) => c.includes('--is-ancestor'));
  const idx = call.indexOf('--is-ancestor');
  assert.strictEqual(call[idx + 1], '--end-of-options');
});
