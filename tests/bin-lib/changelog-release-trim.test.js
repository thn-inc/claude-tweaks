'use strict';
// prepareTrim (#5563): key read, tip-ancestry check, origin links, never throws.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareTrim } = require('../../plugin/bin/lib/changelog-release-trim');
const { parseChangelogFooter, parseChangelogVersions } = require('../../plugin/bin/lib/changelog');
const { fixtureGit, cleanGitEnv } = require('../helpers/git-fixtures');

const SHA = 'a'.repeat(40);
const REFS = ['refs/remotes/origin/main', 'refs/heads/main'];

function section(v) { return `## v${v} — 2026-01-01\n\n* change ${v}\n\n`; }
function file(versions) { return `# Changelog\n\n${versions.map(section).join('')}`.replace(/\n+$/, '\n'); }

// A fake git recording calls; `overrides` maps "arg0 arg1" prefixes to a value or an Error.
function fakeGit(overrides = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const key = args.join(' ');
    for (const [prefix, v] of Object.entries(overrides)) {
      if (key.startsWith(prefix)) { if (v instanceof Error) throw v; return v; }
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `${SHA}\n`;
    if (args[0] === 'rev-parse') return `${'b'.repeat(40)}\n`;
    if (args[0] === 'remote') return 'https://github.com/o/r.git\n';
    return '';
  };
  git.calls = calls;
  return git;
}
function sink() { const s = { out: '', write: (x) => { s.out += x; } }; return s; }
const policy = (n) => () => `changelog-max-releases: ${n}\n`;

test('key 0 or absent: returns null and makes no git call', () => {
  for (const readPolicy of [() => null, policy(0)]) {
    const git = fakeGit(); const err = sink();
    assert.strictEqual(prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy, git, ancestorRefs: REFS, stderr: err.write }), null);
    assert.strictEqual(git.calls.length, 0);
    assert.strictEqual(err.out, '');
  }
});

test('AC13.2 (helper): an unreadable policy prints the unreadable line and returns null', () => {
  const git = fakeGit(); const err = sink();
  const r = prepareTrim({
    text: null, readPolicy: () => { throw new Error('EISDIR: illegal operation on a directory'); }, git, ancestorRefs: REFS, stderr: err.write,
  });
  assert.strictEqual(r, null);
  assert.strictEqual(err.out, 'changelog trim: policy unreadable (EISDIR: illegal operation on a directory); not trimmed\n');
  assert.strictEqual(git.calls.length, 0);
});

test('trims through the injected git: returns text, count and removed versions', () => {
  const git = fakeGit(); const err = sink();
  const r = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(2), git, ancestorRefs: REFS, stderr: err.write });
  assert.deepStrictEqual(r.removed, ['1.0.0']);
  assert.strictEqual(r.count, 2);
  const footer = parseChangelogFooter(r.text);
  assert.strictEqual(footer.sha, SHA);
  assert.strictEqual(footer.repoUrl, 'https://github.com/o/r');
  assert.strictEqual(err.out, '');
});

test('within the bound returns null silently', () => {
  const err = sink();
  assert.strictEqual(prepareTrim({ text: file(['1.0.1', '1.0.0']), readPolicy: policy(5), git: fakeGit(), ancestorRefs: REFS, stderr: err.write }), null);
  assert.strictEqual(err.out, '');
});

test('the first ancestorRefs entry that resolves is the default ref; a failing one is skipped', () => {
  const git = fakeGit({ 'rev-parse --verify --quiet --end-of-options refs/remotes/origin/main': new Error('no') });
  const err = sink();
  prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git, ancestorRefs: REFS, stderr: err.write });
  const ancestry = git.calls.find((c) => c[0] === 'merge-base');
  assert.deepStrictEqual(ancestry, ['merge-base', '--is-ancestor', '--end-of-options', SHA, 'refs/heads/main']);
});

test('no resolvable default ref: not trimmed, failure line names the candidates', () => {
  const git = fakeGit({ 'rev-parse --verify': new Error('no') }); const err = sink();
  assert.strictEqual(prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git, ancestorRefs: REFS, stderr: err.write }), null);
  assert.match(err.out, /^changelog trim: failed \(no default branch ref among refs\/remotes\/origin\/main, refs\/heads\/main\); file left untrimmed\n$/);
});

test('AC14.1 (helper): a HEAD that is not an ancestor of the default branch is not trimmed and prints the failure line', () => {
  const git = fakeGit({ 'merge-base': Object.assign(new Error('exit 1'), { status: 1 }) }); const err = sink();
  const r = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git, ancestorRefs: ['refs/heads/main'], stderr: err.write });
  assert.strictEqual(r, null);
  assert.match(err.out, /^changelog trim: failed \(.* is not an ancestor of refs\/heads\/main\); file left untrimmed\n$/);
});

test('a throwing remote get-url means no origin: footer has the sha and no link', () => {
  const git = fakeGit({ 'remote get-url': new Error('no such remote') }); const err = sink();
  const r = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git, ancestorRefs: REFS, stderr: err.write });
  assert.strictEqual(parseChangelogFooter(r.text).sha, SHA);
  assert.ok(!r.text.includes(']('));
  assert.strictEqual(err.out, '');
});

test('a non-GitHub origin yields no links', () => {
  const git = fakeGit({ 'remote get-url': 'git@example.com:o/r.git\n' });
  const r = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git, ancestorRefs: REFS, stderr: () => {} });
  assert.strictEqual(parseChangelogFooter(r.text).repoUrl, null);
});

test('AC4 (helper): a trim function that throws leaves the text untrimmed and prints one failure line', () => {
  const err = sink();
  const r = prepareTrim({
    text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git: fakeGit(), ancestorRefs: REFS, stderr: err.write, trim: () => { throw new Error('boom'); },
  });
  assert.strictEqual(r, null);
  assert.strictEqual(err.out, 'changelog trim: failed (boom); file left untrimmed\n');
});

test('a throwing git read of HEAD is a failure line, never a throw', () => {
  const err = sink();
  const r = prepareTrim({
    text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git: fakeGit({ 'rev-parse HEAD': new Error('not a repo') }), ancestorRefs: REFS, stderr: err.write,
  });
  assert.strictEqual(r, null);
  assert.strictEqual(err.out, 'changelog trim: failed (not a repo); file left untrimmed\n');
});

test('within the bound: no git call and no line, even when git would fail', () => {
  const calls = []; const err = sink();
  const git = (args) => { calls.push(args); throw new Error('git must not run'); };
  assert.strictEqual(prepareTrim({ text: file(['1.0.1', '1.0.0']), readPolicy: policy(2), git, ancestorRefs: REFS, stderr: err.write }), null);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(err.out, '');
});

test('a footer-bearing file at the bound is within the bound (footer is not a section)', () => {
  const git = () => { throw new Error('git must not run'); };
  const err = sink();
  const trimmed = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(2), git: fakeGit(), ancestorRefs: REFS, stderr: () => {} });
  assert.strictEqual(prepareTrim({ text: trimmed.text, readPolicy: policy(2), git, ancestorRefs: REFS, stderr: err.write }), null);
  assert.strictEqual(err.out, '');
});

test('a multi-line git error prints one failure line carrying only its first line', () => {
  const err = sink();
  const e = new Error('Command failed: git rev-parse HEAD\nfatal: not a git repository');
  const r = prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git: fakeGit({ 'rev-parse HEAD': e }), ancestorRefs: REFS, stderr: err.write });
  assert.strictEqual(r, null);
  assert.strictEqual(err.out, 'changelog trim: failed (Command failed: git rev-parse HEAD); file left untrimmed\n');
});

test('a multi-line unreadable-policy reason prints one line', () => {
  const err = sink();
  prepareTrim({ text: null, readPolicy: () => { throw new Error('EACCES: denied\nsecond line'); }, git: fakeGit(), ancestorRefs: REFS, stderr: err.write });
  assert.strictEqual(err.out, 'changelog trim: policy unreadable (EACCES: denied); not trimmed\n');
});

test('a merge-base failure other than status 1 keeps its own message and is not reported as "not an ancestor"', () => {
  const err = sink();
  const e = Object.assign(new Error('Command failed: git merge-base\nfatal: Not a valid commit name'), { status: 128 });
  prepareTrim({ text: file(['1.0.2', '1.0.1', '1.0.0']), readPolicy: policy(1), git: fakeGit({ 'merge-base': e }), ancestorRefs: REFS, stderr: err.write });
  assert.strictEqual(err.out, 'changelog trim: failed (Command failed: git merge-base); file left untrimmed\n');
  assert.ok(!/not an ancestor/.test(err.out));
});

// ---- real git ----

function realRepo({ origin } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-trim-')));
  const env = cleanGitEnv();
  const git = (...args) => fixtureGit(['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  if (origin) git('remote', 'add', 'origin', origin);
  const read = () => fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
  const write = (t) => fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), t);
  const commit = (msg) => { git('add', '.'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const trim = (count) => prepareTrim({
    text: read(), readPolicy: policy(count), ancestorRefs: ['refs/heads/main'], stderr: (s) => { throw new Error(`unexpected stderr: ${s}`); },
    git: (args) => git(...args),
  });
  return { dir, git, read, write, commit, trim };
}

// Insert a newest section directly under the header, as prependSection does.
function addNewest(text, v) { return text.replace('# Changelog\n\n', `# Changelog\n\n${section(v)}`); }

test('AC8.1: the footer commit is the same string after a second and a third trim', () => {
  const r = realRepo({ origin: 'https://github.com/o/r.git' });
  try {
    r.write(file(['1.0.5', '1.0.4', '1.0.3', '1.0.2', '1.0.1', '1.0.0']));
    const s1 = r.commit('c1');
    const t1 = r.trim(4);
    assert.deepStrictEqual(t1.removed, ['1.0.1', '1.0.0']);
    r.write(t1.text); r.commit('trim 1');
    const first = parseChangelogFooter(r.read()).sha;
    assert.strictEqual(first, s1);

    r.write(addNewest(r.read(), '1.0.6')); r.commit('c2');
    const t2 = r.trim(4);
    assert.deepStrictEqual(t2.removed, ['1.0.2']);
    r.write(t2.text); r.commit('trim 2');

    r.write(addNewest(r.read(), '1.0.7')); r.commit('c3');
    const t3 = r.trim(4);
    assert.deepStrictEqual(t3.removed, ['1.0.3']);
    r.write(t3.text); r.commit('trim 3');

    const final = parseChangelogFooter(r.read());
    assert.strictEqual(final.sha, first);
    assert.strictEqual(final.newestRemoved, '1.0.3');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('AC8.2: a fixture repository with no origin gets a footer with the sha and no link', () => {
  const r = realRepo();
  try {
    r.write(file(['1.0.2', '1.0.1', '1.0.0']));
    const s = r.commit('c1');
    const t = r.trim(2);
    const footer = parseChangelogFooter(t.text);
    assert.strictEqual(footer.sha, s);
    assert.strictEqual(footer.repoUrl, null);
    assert.ok(!t.text.includes(']('));
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('AC14.1: real git, a HEAD off the default branch is not trimmed', () => {
  const r = realRepo();
  try {
    r.write(file(['1.0.2', '1.0.1', '1.0.0']));
    r.commit('c1');
    r.git('checkout', '-q', '-b', 'side');
    r.write(addNewest(r.read(), '1.0.3'));
    r.commit('side commit');
    let out = '';
    const res = prepareTrim({
      text: r.read(), readPolicy: policy(1), ancestorRefs: ['refs/heads/main'], stderr: (s) => { out += s; }, git: (args) => r.git(...args),
    });
    assert.strictEqual(res, null);
    assert.match(out, /is not an ancestor of refs\/heads\/main\); file left untrimmed\n$/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('AC9.1 AC9.2: trimmed twice, a version removed by the second trim is absent at the footer commit and present at its own tag', () => {
  const r = realRepo({ origin: 'https://github.com/o/r.git' });
  try {
    r.write(file(['1.0.1', '1.0.0']));
    r.commit('release 1.0.0 and 1.0.1');
    r.git('tag', 'v1.0.1');
    const t1 = r.trim(1);
    assert.deepStrictEqual(t1.removed, ['1.0.0']);
    const sha = r.git('rev-parse', 'HEAD');
    r.write(t1.text); r.commit('trim 1');
    assert.strictEqual(parseChangelogFooter(r.read()).sha, sha);

    r.write(addNewest(r.read(), '1.0.2')); r.commit('release 1.0.2');
    r.git('tag', 'v1.0.2');
    r.write(addNewest(r.read(), '1.0.3')); r.commit('release 1.0.3');
    r.git('tag', 'v1.0.3');
    const t2 = r.trim(1);
    assert.ok(t2.removed.includes('1.0.2'), 'trim 2 removes 1.0.2');
    r.write(t2.text); r.commit('trim 2');

    const footerSha = parseChangelogFooter(r.read()).sha;
    assert.strictEqual(footerSha, sha);
    const versionsAt = (rev) => parseChangelogVersions(r.git('show', `${rev}:CHANGELOG.md`)).map((e) => e.version);
    assert.ok(!versionsAt(footerSha).includes('1.0.2'), 'absent at the footer commit');
    assert.ok(versionsAt('v1.0.2').includes('1.0.2'), 'present at its own tag');
    assert.ok(!parseChangelogVersions(r.read()).map((e) => e.version).includes('1.0.2'), 'absent at HEAD');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});
