'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  changedFiles, resolveBase, usableAnchor, mergeNarrowing, ChangedFilesError,
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

test('changedFiles unions the committed diff (-z) and the working tree (-z), mapping renames to both paths, deletions to the old, copies to the new, and surviving a C-quotable path (#1922)', () => {
  const diffZ = ['M', 'src/a.js', 'R100', 'old/b.js', 'new/b.js', 'D', 'gone.js', 'A', 'src/café.js', 'C75', 'tpl/c.js', 'copy/c.js', ''].join('\0');
  const statusZ = [' M src/a.js', '?? scratch.txt', 'R  y.js', 'x.js', ' D removed.js', ''].join('\0');
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: diffZ,
    '--no-optional-locks status --porcelain -z --untracked-files=all': statusZ,
  });
  const r = changedFiles({ base: FULL, execImpl: exec });
  assert.strictEqual(r.base, FULL);
  // A rename's source path is gone from HEAD exactly like a deletion, so it is
  // selected too (ledger #8, #3072 run); a copy's source is unchanged, so only
  // the new path is.
  assert.deepStrictEqual(r.files, ['copy/c.js', 'gone.js', 'new/b.js', 'old/b.js', 'removed.js', 'scratch.txt', 'src/a.js', 'src/café.js', 'x.js', 'y.js']);
});

test('changedFiles with a clean tree and no commits since base is an empty set, not an error', () => {
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: '',
    '--no-optional-locks status --porcelain -z --untracked-files=all': '',
  });
  assert.deepStrictEqual(changedFiles({ base: FULL, execImpl: exec }), { base: FULL, files: [] });
});

test('changedFiles reports each file in a new untracked directory individually, not the directory (finding 8)', () => {
  const statusZ = ['?? new/x.js', '?? new/y.js', ''].join('\0');
  const exec = fakeExec({
    [`diff --name-status -z --end-of-options ${FULL}..HEAD`]: '',
    '--no-optional-locks status --porcelain -z --untracked-files=all': statusZ,
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

// ── #3072: mergeNarrowing, against a real temp git repo ───────────────────

// integration branch `trunk`, feature branch `feat` cut from it; anchor = feat's
// tip at cut time. preBranchFiles (each [rel, content]) commit to trunk before
// the cut, so both branches start from them.
function mergeRepo(preBranchFiles = []) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-narrowing-')));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.email', 'verify-test@example.invalid');
  git('config', 'user.name', 'verify test');
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  };
  const commit = (rel, content, msg = `add ${rel}`) => { write(rel, content); git('add', rel); git('commit', '-q', '-m', msg); };
  commit('README.md', 'root');
  for (const [rel, content] of preBranchFiles) commit(rel, content);
  git('checkout', '-q', '-b', 'feat');
  const anchor = git('rev-parse', 'HEAD');
  const exec = (cmd, args, opts) => execFileSync(cmd, args, { ...opts, cwd: repo });
  return { repo, git, write, commit, anchor, exec };
}

function changedSince(r, base) {
  return changedFiles({ base, execImpl: r.exec }).files;
}

function mergeTrunkWith(r, files) {
  r.git('checkout', '-q', 'trunk');
  for (const [rel, content] of files) r.commit(rel, content);
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'trunk');
}

test('mergeNarrowing: anchor → integration-branch merge → own-work commit keeps only the own-work path (#3072)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b'], ['ui/c.js', 'c']]);
  r.commit('src/own.py', 'own');
  const files = changedSince(r, r.anchor);
  assert.deepStrictEqual(files, ['src/own.py', 'ui/a.js', 'ui/b.js', 'ui/c.js']);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.strictEqual(n.ref, 'trunk');
  assert.deepStrictEqual(n.files, ['src/own.py']);
  assert.deepStrictEqual(n.excluded, ['ui/a.js', 'ui/b.js', 'ui/c.js']);
});

test('mergeNarrowing: no merge after the anchor returns null — the set stays anchor..HEAD (#3072)', () => {
  const r = mergeRepo();
  r.commit('src/own.py', 'own');
  r.commit('ui/a.js', 'a');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: a merged-in path the branch then edited stays selected (#3072)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b']]);
  r.commit('ui/a.js', 'a — edited on the branch');
  const files = changedSince(r, r.anchor);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.deepStrictEqual(n.files, ['ui/a.js']);
  assert.deepStrictEqual(n.excluded, ['ui/b.js']);
});

test('mergeNarrowing: an uncommitted edit to a merge-identical path stays selected (#3072 Review Focus)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a'], ['ui/b.js', 'b']]);
  r.write('ui/b.js', 'b — uncommitted edit');
  const files = changedSince(r, r.anchor);
  const n = mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.deepStrictEqual(n.files, ['ui/b.js']);
  assert.deepStrictEqual(n.excluded, ['ui/a.js']);
});

test('mergeNarrowing: a merge of a non-integration branch after the anchor does not narrow (#3072 Review Focus)', () => {
  const r = mergeRepo();
  r.git('checkout', '-q', '-b', 'side', r.anchor);
  r.commit('lib/side.js', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: an unresolvable integration branch degrades to null, never a throw (#3072 Review Focus)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'no-such-branch', files, execImpl: r.exec }), null);
});

test('mergeNarrowing: a failing working-tree status read degrades to null, never a throw (#3072 review)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
  const files = changedSince(r, r.anchor);
  const statusFails = (cmd, args, opts) => {
    if (args[1] === 'status') { const e = new Error('index.lock: File exists'); e.status = 128; throw e; }
    return r.exec(cmd, args, opts);
  };
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: statusFails }), null);
});

test('mergeNarrowing: a failing anchor merge-base or pre-anchor diff degrades to null, never a throw (#3072)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
  const files = changedSince(r, r.anchor);
  const fail = () => { const e = new Error('fatal: bad object'); e.status = 128; throw e; };
  const mergeBaseFails = (cmd, args, opts) => (args[0] === 'merge-base' && !args.includes('--is-ancestor') ? fail() : r.exec(cmd, args, opts));
  const preAnchorDiffFails = (cmd, args, opts) => (args[0] === 'diff' && args[args.length - 1] === r.anchor ? fail() : r.exec(cmd, args, opts));
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: mergeBaseFails }), null);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: preAnchorDiffFails }), null);
  assert.ok(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), 'control: the same repo narrows when git succeeds');
});

test('mergeNarrowing: no anchor or no integration branch returns null without touching git (#3072)', () => {
  const boom = () => { throw new Error('git must not be called'); };
  assert.strictEqual(mergeNarrowing({ anchor: null, integrationBranch: 'trunk', files: ['a'], execImpl: boom }), null);
  assert.strictEqual(mergeNarrowing({ anchor: 'abc', integrationBranch: null, files: ['a'], execImpl: boom }), null);
});

// Whole-branch review Important 1 (#3072): default rename detection on the
// {ref}..HEAD diff pairs a deletion with an unrelated near-copy addition and
// --name-only then prints only the destination, hiding the deletion. Branch
// adds a near-copy of a trunk-only file (bar.js ~ foo.js) BEFORE the anchor,
// deletes foo.js AFTER the anchor, then merges trunk (which independently
// gained an unrelated file, so the merge is a real non-fast-forward commit).
// foo.js is absent at HEAD but present at trunk's tip, and must stay selected
// — it must never be swallowed by the bar.js rename pairing.
test('mergeNarrowing: a rename-paired deletion is not swallowed by default similarity detection (#3072 Important 1)', () => {
  const r = mergeRepo();
  const foo = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
  r.commit('foo.js', foo);
  r.git('checkout', '-q', 'trunk');
  r.git('merge', '-q', '--ff-only', 'feat');
  r.git('checkout', '-q', 'feat');
  r.commit('bar.js', `${foo}// bar tweak\n`);
  const anchor = r.git('rev-parse', 'HEAD');
  r.git('rm', '-q', 'foo.js');
  r.git('commit', '-q', '-m', 'drop foo.js');
  r.git('checkout', '-q', 'trunk');
  r.commit('trunk-extra.txt', 'trunk moved on\n');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'trunk');
  const files = changedSince(r, anchor);
  assert.ok(files.includes('foo.js'), `expected foo.js among changed files, got ${JSON.stringify(files)}`);
  const n = mergeNarrowing({ anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.ok(n, 'expected mergeNarrowing to engage (a real merge of trunk happened)');
  assert.ok(n.files.includes('foo.js'), `foo.js must stay selected, not paired away by the bar.js rename; files=${JSON.stringify(n.files)}`);
  assert.ok(!n.excluded.includes('foo.js'), `foo.js must not be excluded; excluded=${JSON.stringify(n.excluded)}`);
  assert.deepStrictEqual(n.excluded, ['trunk-extra.txt']);
});

// Whole-branch review Important 2 (#3072): a merge conflict resolved with
// `git checkout --theirs` makes HEAD's content byte-identical to {ref}'s tip
// even though the branch itself edited that file before the anchor. The file
// the branch's own verified code depends on must stay selected — trusting
// {ref}'s content here would silently verify the branch's code against a
// different version of a file it itself touched.
test('mergeNarrowing: a conflict resolved in the integration branch\'s favour keeps the branch\'s own pre-anchor edit selected (#3072 Important 2)', () => {
  const r = mergeRepo([['src/x.py', 'line1\nline2\nline3\n']]);
  r.commit('src/x.py', 'line1\nBRANCH-EDIT\nline3\n', 'feat edits x.py');
  const anchor = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', 'trunk');
  r.commit('src/x.py', 'line1\nTRUNK-EDIT\nline3\n', 'trunk edits x.py');
  r.git('checkout', '-q', 'feat');
  let conflicted = false;
  try {
    r.exec('git', ['merge', '-q', '--no-ff', 'trunk'], { encoding: 'utf8' });
  } catch {
    conflicted = true;
  }
  assert.ok(conflicted, 'expected a merge conflict on src/x.py');
  r.exec('git', ['checkout', '--theirs', 'src/x.py'], { encoding: 'utf8' });
  r.git('add', 'src/x.py');
  r.git('commit', '-q', '--no-edit');
  const files = changedSince(r, anchor);
  assert.ok(files.includes('src/x.py'), `expected src/x.py among changed files, got ${JSON.stringify(files)}`);
  const n = mergeNarrowing({ anchor, integrationBranch: 'trunk', files, execImpl: r.exec });
  assert.ok(n, 'expected mergeNarrowing to engage (a real merge of trunk happened)');
  assert.ok(n.files.includes('src/x.py'), `src/x.py must stay selected even though HEAD now matches trunk; files=${JSON.stringify(n.files)}`);
  assert.ok(!n.excluded.includes('src/x.py'), `src/x.py must not be excluded; excluded=${JSON.stringify(n.excluded)}`);
});
