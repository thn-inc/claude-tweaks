'use strict';
// Fixture tests for plugin/bin/lib/release-notes-publish.js (#2582). Every
// test runs against fake `gh`/`git` fns keyed on their joined argv — never a
// real subprocess, a real GitHub release, or a real `git push` (AC5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('../helpers/read-skill');
const { runCliSync, spawnCli } = require('../helpers/run-cli');
const { STUB_SKIP } = require('../helpers/path-stub');
const { committedRepo, cleanGitEnv } = require('../helpers/git-fixtures');
const { _resetGhHostCache } = require('../../plugin/bin/lib/repo-resolve.js');
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

test('parseReleaseNotesFromLog: extracts the Release-Note: footers per commit, [] for commits without one', () => {
  const raw = logOf(['feat: a\n\nRelease-Note: Added the thing.', 'fix: b\n\nno footer']);
  const out = parseReleaseNotesFromLog(raw);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0].releaseNotes, ['Added the thing.']);
  assert.deepStrictEqual(out[1].releaseNotes, []);
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

test('AC7: the module imports extractReleaseNotes rather than declaring a second copy of the pattern', () => {
  const src = readText(path.join(__dirname, '../../plugin/bin/lib/release-notes-publish.js'));
  assert.match(src, /require\(['"]\.\/release-notes['"]\)/);
  assert.match(src, /extractReleaseNotes/);
  assert.ok(!/\/\^?Release-Note:/.test(src), 'expected no second Release-Note: regex literal — import extractReleaseNotes instead');
});

test('AC8: the module imports and calls renderReleaseNotes rather than reimplementing its filter/map/join logic', () => {
  const src = readText(path.join(__dirname, '../../plugin/bin/lib/release-notes-publish.js'));
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
  const wf = readText(path.join(__dirname, '../../.github/workflows/mirror-marketplace.yml'));
  const runAt = wf.indexOf('node plugin/bin/release-notes-publish.js');
  assert.ok(runAt > 0, 'expected the workflow to run release-notes-publish.js');
  const checkoutAt = wf.lastIndexOf('uses: actions/checkout@', runAt);
  assert.ok(checkoutAt > 0, 'expected a checkout step before the release-notes-publish run');
  const checkoutStep = wf.slice(checkoutAt, wf.indexOf('- uses:', checkoutAt + 1));
  assert.match(checkoutStep, /^\s+ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/m);
});

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

// --- the script entry (#5386). The real-process tests use only --help and a bad
// argument, which exit before any gh or git call; the in-process test fakes both. ---
const CLI = path.join(__dirname, '..', '..', 'plugin', 'bin', 'release-notes-publish.js');
const CLI_USAGE = 'usage: release-notes-publish.js [--root <dir>]\nexit 0 applied/no-op; 1 a gh/git call failed';

// Proves the script's exit code and stdout through a real process.
test('AC5.1 AC7.1: --help exits 0 and prints the usage', () => {
  const res = spawnCli(CLI, ['--help'], { env: { PATH: process.env.PATH } });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stdout, `${CLI_USAGE}\n`);
  assert.strictEqual(res.stderr, '');
});

// Proves the script's exit code and stderr through a real process.
test('AC7.1: an unknown argument exits 2 with the usage on stderr', () => {
  const res = spawnCli(CLI, ['--bogus'], { env: { PATH: process.env.PATH } });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, `unknown argument: --bogus\n${CLI_USAGE}\n`);
});

test('AC8.1: a relative --root resolves against deps.cwd() for file reads and gh/git cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rnp-'));
  try {
    const env = { MARKER: '1', HOME: tmp, USERPROFILE: tmp };
    const seen = { gh: [], git: [], reads: [], writes: [] };
    const gh = (args, input, opts) => {
      seen.gh.push(opts);
      opts.stderr(`gh-stderr-probe ${seen.gh.length}\n`); // lands in the run's injected collector only
      const key = args.join(' ');
      if (key.startsWith('release list')) return JSON.stringify([{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }, { tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' }]);
      if (key.startsWith('release view')) return 'Auto-generated release-please body.';
      if (key.startsWith('release edit')) return '';
      throw new Error(`unexpected gh: ${key}`);
    };
    const git = (args, opts) => {
      seen.git.push(opts);
      if (args[0] === 'log') return logOf(['feat: a\n\nRelease-Note: Added the thing.']);
      return '';
    };
    const readFile = (abs) => { seen.reads.push(abs); return '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n'; };
    const writeFile = (abs) => { seen.writes.push(abs); };
    const res = runCliSync(CLI, ['--root', 'repo'], { cwd: tmp, env, deps: { gh, git, readFile, writeFile } });
    const root = path.join(tmp, 'repo');
    assert.strictEqual(res.code, 0, res.stderr);
    assert.ok(seen.gh.length > 0 && seen.git.length > 0);
    for (const o of [...seen.gh, ...seen.git]) {
      assert.strictEqual(o.cwd, root);
      assert.deepStrictEqual(o.env, env);
    }
    // gh's host and config lookups read the injected home and stderr, not the process's.
    for (const o of seen.gh) {
      assert.strictEqual(o.homeDir(), tmp);
    }
    // The stderr handed to gh is the run's own collector: each probe written in the gh fake landed in res.stderr.
    for (let i = 1; i <= seen.gh.length; i++) assert.ok(res.stderr.includes(`gh-stderr-probe ${i}\n`), res.stderr);
    assert.deepStrictEqual(seen.reads, [path.join(root, 'CHANGELOG.md')]);
    assert.deepStrictEqual(seen.writes, [path.join(root, 'CHANGELOG.md')]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A deleted working directory: process.cwd() throws ENOENT. An absolute --root never needs it.
test('an absolute --root works when deps.cwd() throws (deleted cwd)', () => {
  const root = path.join(os.tmpdir(), 'rnp-absolute-root');
  const seen = [];
  const deletedCwd = () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); };
  const gh = (args, input, opts) => {
    seen.push(opts.cwd);
    if (args.join(' ').startsWith('release list')) return JSON.stringify([{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }]);
    throw new Error(`unexpected gh: ${args.join(' ')}`);
  };
  const git = (args) => { throw new Error(`unexpected git: ${args.join(' ')}`); };
  const fail = () => { throw new Error('unexpected file access'); };
  const res = runCliSync(CLI, ['--root', root], { deps: { cwd: deletedCwd, gh, git, readFile: fail, writeFile: fail } });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.deepStrictEqual(seen, [root]);
});

// --- the real gh and git seams (#5386). The gh child is a stub script on an injected PATH only;
// the real `gh` is never started. ---
const ENTRY = require(CLI);
const GHE_HOST = 'ghe.example.test';

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A `gh` script in its own directory, for an injected-only PATH (installStub would edit process.env.PATH).
function ghStubDir(body) {
  const dir = tmpDir('rnp-gh-stub-');
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a denial simulation
  return dir;
}

// Proves each hand-off of the injected context on realDeps.gh's path: the origin read runs with
// the injected env (GIT_DIR only there: repo A has no remote, repo B has the GHE origin), the
// hosts.yml lookup uses the injected homeDir, the host note goes to the injected stderr, and the
// gh child gets the injected env (the stub resolves only through its PATH).
test('realDeps.gh: the origin probe, hosts.yml lookup and host note use the injected env, homeDir and stderr', { skip: STUB_SKIP }, () => {
  const a = committedRepo({ prefix: 'rnp-a-' });
  const b = committedRepo({ prefix: 'rnp-b-' });
  const home = tmpDir('rnp-home-');
  const stub = ghStubDir('printf %s "$GH_HOST"');
  try {
    b.git('remote', 'add', 'origin', `https://${GHE_HOST}/o/r.git`);
    fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
    const env = { ...cleanGitEnv(), PATH: stub + path.delimiter + process.env.PATH, GIT_DIR: path.join(b.dir, '.git') };
    for (const k of ['GH_HOST', 'GH_REPO', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME']) delete env[k];
    const notes = [];

    _resetGhHostCache();
    const out = ENTRY.realDeps.gh(['release', 'list'], undefined, { cwd: a.dir, env, stderr: (t) => notes.push(t), homeDir: () => home });

    assert.strictEqual(out, GHE_HOST);
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0], new RegExp(GHE_HOST));
  } finally {
    _resetGhHostCache();
    for (const d of [a.dir, b.dir, home, stub]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// Proves realDeps.git starts its child with the injected env: the author identity exists only there.
test('realDeps.git: the child runs with the injected env', () => {
  const a = committedRepo({ prefix: 'rnp-git-' });
  try {
    const env = { ...cleanGitEnv(), GIT_AUTHOR_NAME: 'Injected Author', GIT_AUTHOR_EMAIL: 'injected@example.test' };
    const out = ENTRY.realDeps.git(['var', 'GIT_AUTHOR_IDENT'], { cwd: a.dir, env });
    assert.match(out, /^Injected Author <injected@example\.test> /);
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
  }
});

// Proves the script entry through a real process on a success input that reaches gh: the stub
// answers `release list` with one release, so the run is a no-op that exits 0.
test('AC5.1: the script reaches gh and exits 0 on fewer than 2 releases', { skip: STUB_SKIP }, () => {
  const cwd = tmpDir('rnp-script-');
  const stub = ghStubDir(`printf '%s' '[{"tagName":"v1.0.0","publishedAt":"2026-01-01T00:00:00Z"}]'`);
  try {
    const env = { PATH: stub + path.delimiter + process.env.PATH, HOME: cwd, USERPROFILE: cwd };
    const res = spawnCli(CLI, [], { env, cwd });
    assert.strictEqual(res.code, 0, res.stderr);
    assert.strictEqual(res.stdout, 'release-notes-publish: fewer than 2 published releases — no-op\n');
    assert.strictEqual(res.stderr, '');
  } finally {
    for (const d of [cwd, stub]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// --- the bounded CHANGELOG.md (`changelog-max-releases`, #5563). The key is read through the lib's
// own deps.readPolicy; the trim rides the Highlights commit, or makes its own when there is none. ---
const { parseChangelogVersions, parseChangelogFooter } = require('../../plugin/bin/lib/changelog.js');

const TIP = 'a'.repeat(40);
const FOUR_SECTIONS = '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n\n## 1.2.0 (2026-09-01)\n\n### Bug Fixes\n\n* b\n\n## 1.1.0 (2026-08-01)\n\n### Features\n\n* c\n\n## 1.0.0 (2026-07-01)\n\n### Features\n\n* d\n';
const TRIM_GIT = {
  'rev-parse HEAD': `${TIP}\n`,
  'rev-parse --verify --quiet --end-of-options refs/remotes/origin/main^{commit}': `${TIP}\n`,
  [`merge-base --is-ancestor --end-of-options ${TIP} refs/remotes/origin/main`]: '',
  'remote get-url origin': 'https://github.com/o/r.git\n',
  'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
};

// makeDeps plus the policy file, a readPolicy over it, and the git answers a trim asks for.
function trimDeps(o = {}) {
  const { deps, state } = makeDeps({ changelog: FOUR_SECTIONS, ...o, files: { ...(o.policy !== undefined ? { '.claude-tweaks/policy.yml': o.policy } : {}), ...(o.files || {}) } });
  const base = deps.git;
  const answers = { ...TRIM_GIT, ...(o.gitAnswers || {}) };
  deps.git = (args) => {
    const key = args.join(' ');
    if (key in answers) {
      state.git.push(key);
      if (answers[key] instanceof Error) throw answers[key];
      return answers[key];
    }
    return base(args);
  };
  deps.readPolicy = o.readPolicy || (() => { const v = state.files['.claude-tweaks/policy.yml']; return v === undefined ? null : v; });
  return { deps, state };
}

test('AC2.1 (publish): with the key 0 or absent the written CHANGELOG is byte-identical to the base behavior', () => {
  // The base commit's output, spelled out: the Highlights block closes the newest entry, nothing else moves.
  const expected = '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n\n### Highlights\n* Added the thing.\n* Fixed the other thing.\n\n## 1.2.0 (2026-09-01)\n\n### Bug Fixes\n\n* b\n\n## 1.1.0 (2026-08-01)\n\n### Features\n\n* c\n\n## 1.0.0 (2026-07-01)\n\n### Features\n\n* d\n';
  for (const policy of ['changelog-max-releases: 0\n', undefined]) {
    const { deps, state } = trimDeps({ policy });
    assert.strictEqual(run([], deps), 0, state.err);
    assert.strictEqual(state.files['CHANGELOG.md'], expected);
    assert.ok(!state.git.some((k) => k.startsWith('rev-parse') || k.startsWith('symbolic-ref') || k.startsWith('merge-base') || k.startsWith('remote')), state.git.join('\n'));
  }
  const { deps: noPolicyDep, state } = trimDeps({});
  delete noPolicyDep.readPolicy;
  assert.strictEqual(run([], noPolicyDep), 0, state.err);
  assert.strictEqual(state.files['CHANGELOG.md'], expected);
});

test('AC2.1 (publish): with the key 0 the early exits read no CHANGELOG and make no git call beyond today\'s', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 0\n', releases: [{ tagName: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z' }] });
  deps.readFile = () => { throw new Error('unexpected read'); };
  assert.strictEqual(run([], deps), 0, state.err);
  assert.deepStrictEqual(state.git, []);
  assert.strictEqual(state.out, 'release-notes-publish: fewer than 2 published releases — no-op\n');
});

test('AC3.1 (publish): key 2 and four sections → one commit holding the Highlights block, two sections and the footer', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n' });
  assert.strictEqual(run([], deps), 0, state.err);
  const written = state.files['CHANGELOG.md'];
  assert.deepStrictEqual(parseChangelogVersions(written).map((s) => s.version), ['1.3.0', '1.2.0']);
  assert.ok(written.includes('### Highlights\n* Added the thing.\n* Fixed the other thing.'), written);
  const footer = parseChangelogFooter(written);
  assert.ok(footer, written);
  assert.strictEqual(footer.sha, TIP);
  assert.strictEqual(state.git.filter((k) => k.startsWith('commit ')).length, 1);
  assert.deepStrictEqual(state.git.slice(-3), ['add CHANGELOG.md', 'commit -m docs(changelog): append Highlights for v1.3.0', 'push']);
  assert.strictEqual(state.writes.length, 1);
});

test('AC4.1 (publish): trimChangelog stubbed to throw → Highlights still committed, file untrimmed, one failure line, exit 0', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n' });
  deps.trimChangelog = () => { throw new Error('boom'); };
  assert.strictEqual(run([], deps), 0, state.err);
  const written = state.files['CHANGELOG.md'];
  assert.strictEqual(written, applyToChangelogEntry(FOUR_SECTIONS, '* Added the thing.\n* Fixed the other thing.'));
  assert.strictEqual(parseChangelogFooter(written), null);
  assert.strictEqual(state.err, 'changelog trim: failed (boom); file left untrimmed\n');
  assert.ok(state.git.includes('commit -m docs(changelog): append Highlights for v1.3.0'));
});

test('AC12.2: the Highlights writer over a footer-bearing file leaves the footer byte-identical and last', () => {
  const footer = `## Older releases\n\nFull file up to v1.1.0: commit ${TIP}\n\nNewest release removed: v1.1.0\n\n- [CHANGELOG.md at ${TIP.slice(0, 12)}](https://github.com/o/r/blob/${TIP}/CHANGELOG.md)\n`;
  const text = `# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Features\n\n* a thing\n\n${footer}`;
  const out = applyToChangelogEntry(text, '* Added the thing.');
  assert.ok(out.endsWith(footer), out);
  assert.strictEqual(parseChangelogFooter(out).index, out.length - footer.length);
  assert.ok(out.includes('### Highlights\n* Added the thing.'));
  // a footer with no entry above it is never the "first entry"
  assert.strictEqual(applyToChangelogEntry(`# Changelog\n\n${footer}`, '* x'), null);
});

test('AC13.1: key 2 with no Release-Note: trailers still trims and commits with the trim-only subject', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', commitBodies: ['fix: a\n\nno footer'] });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.match(state.out, /no Release-Note: trailers/);
  assert.match(state.out, /no Highlights to write; committed a trim of CHANGELOG\.md to the newest 2 releases\n$/);
  assert.deepStrictEqual(parseChangelogVersions(state.files['CHANGELOG.md']).map((s) => s.version), ['1.3.0', '1.2.0']);
  assert.ok(!state.files['CHANGELOG.md'].includes('### Highlights'));
  assert.ok(state.git.includes('commit -m chore: trim CHANGELOG.md to the newest 2 releases'), state.git.join('\n'));
  assert.strictEqual(state.git[state.git.length - 1], 'push');
});

test('key 2 with fewer than 2 published releases still trims with the trim-only subject', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', releases: [{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }] });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.ok(!state.git.some((k) => k.startsWith('log --first-parent')));
  assert.ok(state.git.includes('commit -m chore: trim CHANGELOG.md to the newest 2 releases'));
});

test('AC13.2: a policy.yml that exists and cannot be read is not trimmed and prints the unreadable line', () => {
  const { deps, state } = trimDeps({ readPolicy: () => { throw new Error('EACCES: permission denied'); }, commitBodies: ['fix: a\n\nno footer'] });
  assert.strictEqual(run([], deps), 0);
  assert.match(state.err, /^changelog trim: policy unreadable \(EACCES: permission denied\); not trimmed\n$/);
  assert.ok(!state.git.some((k) => k.startsWith('commit ')));
  assert.deepStrictEqual(state.writes, []);
  assert.ok(!state.git.some((k) => k.startsWith('rev-parse') || k.startsWith('symbolic-ref')));
});

test('AC14.2 (publish): a tip that is not an ancestor of the default branch is not trimmed and prints the failure line', () => {
  const notAncestor = Object.assign(new Error('exit 1'), { status: 1 });
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', gitAnswers: { [`merge-base --is-ancestor --end-of-options ${TIP} refs/remotes/origin/main`]: notAncestor } });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.match(state.err, /^changelog trim: failed \(.*not an ancestor of refs\/remotes\/origin\/main\); file left untrimmed\n$/);
  assert.strictEqual(parseChangelogFooter(state.files['CHANGELOG.md']), null);
  assert.ok(state.files['CHANGELOG.md'].includes('### Highlights'));
  assert.ok(state.git.includes('commit -m docs(changelog): append Highlights for v1.3.0'));
});

test('the default branch is integration-branch, then origin/HEAD, then main', () => {
  const ancestor = (branch) => `merge-base --is-ancestor --end-of-options ${TIP} refs/remotes/origin/${branch}`;
  const verify = (branch) => `rev-parse --verify --quiet --end-of-options refs/remotes/origin/${branch}^{commit}`;
  const cases = [
    { policy: 'changelog-max-releases: 2\nintegration-branch: develop\n', branch: 'develop', answers: {} },
    { policy: 'changelog-max-releases: 2\n', branch: 'trunk', answers: { 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/trunk\n' } },
    { policy: 'changelog-max-releases: 2\n', branch: 'main', answers: { 'symbolic-ref --short refs/remotes/origin/HEAD': Object.assign(new Error('no ref'), { status: 128 }) } },
  ];
  for (const c of cases) {
    const { deps, state } = trimDeps({ policy: c.policy, gitAnswers: { ...c.answers, [verify(c.branch)]: `${TIP}\n`, [ancestor(c.branch)]: '' } });
    assert.strictEqual(run([], deps), 0, state.err);
    assert.ok(state.git.includes(ancestor(c.branch)), `${c.branch}: ${state.git.join('\n')}`);
    assert.ok(parseChangelogFooter(state.files['CHANGELOG.md']), c.branch);
  }
});

test('the ancestor check falls back to the local branch ref when origin/{branch} does not resolve', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', gitAnswers: {
    'rev-parse --verify --quiet --end-of-options refs/remotes/origin/main^{commit}': Object.assign(new Error('x'), { status: 1 }),
    'rev-parse --verify --quiet --end-of-options refs/heads/main^{commit}': `${TIP}\n`,
    [`merge-base --is-ancestor --end-of-options ${TIP} refs/heads/main`]: '',
  } });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.ok(parseChangelogFooter(state.files['CHANGELOG.md']));
});

test('a push that throws on the trim-only path: exit 0, one failure line, the file and index restored', () => {
  // both trim-only exits: no trailers, and a single published release
  for (const o of [{ commitBodies: ['fix: a\n\nno footer'] }, { releases: [{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }] }]) {
    const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', ...o });
    const base = deps.git;
    deps.git = (args) => {
      const key = args.join(' ');
      if (key === 'push') { state.git.push(key); throw new Error('rejected: non-fast-forward\nhint: pull first'); }
      if (key === 'reset --soft HEAD~1') { state.git.push(key); return ''; }
      return base(args);
    };
    assert.strictEqual(run([], deps), 0);
    assert.strictEqual(state.err, 'changelog trim: failed (rejected: non-fast-forward); file left untrimmed\n');
    assert.strictEqual(state.files['CHANGELOG.md'], FOUR_SECTIONS);
    // the commit is undone before the file is restored, and the restored file is re-staged
    assert.ok(state.git.indexOf('reset --soft HEAD~1') > state.git.indexOf('push'), state.git.join('\n'));
    assert.strictEqual(state.git[state.git.length - 1], 'add CHANGELOG.md');
    assert.ok(!/committed CHANGELOG/.test(state.out), state.out);
  }
});

test('a push that throws on the Highlights path still fails the run, as before the key existed', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n' });
  const base = deps.git;
  deps.git = (args) => { if (args.join(' ') === 'push') throw new Error('rejected: non-fast-forward'); return base(args); };
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /rejected: non-fast-forward/);
});

test('a write that throws on the trim-only path: exit 0, one failure line', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', commitBodies: ['fix: a\n\nno footer'] });
  deps.writeFile = () => { throw new Error('EROFS: read-only file system'); };
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.err, 'changelog trim: failed (EROFS: read-only file system); file left untrimmed\n');
});

test('a trim-only push that throws and a restore that also throws: the line says the restore failed, not "untrimmed"', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', commitBodies: ['fix: a\n\nno footer'] });
  const base = deps.git;
  deps.git = (args) => {
    const key = args.join(' ');
    if (key === 'push') throw new Error('rejected: non-fast-forward');
    if (key === 'reset --soft HEAD~1') throw new Error('index.lock exists');
    return base(args);
  };
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.err, 'changelog trim: failed (rejected: non-fast-forward); the restore also failed, CHANGELOG.md and the index may still hold the trimmed file\n');
});

test('an unreadable policy with a Highlights block: Highlights committed, unreadable line printed, exit 0', () => {
  const { deps, state } = trimDeps({ readPolicy: () => { throw new Error('EACCES: permission denied'); } });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.err, 'changelog trim: policy unreadable (EACCES: permission denied); not trimmed\n');
  assert.ok(state.git.includes('commit -m docs(changelog): append Highlights for v1.3.0'));
  assert.strictEqual(parseChangelogFooter(state.files['CHANGELOG.md']), null);
  assert.ok(state.files['CHANGELOG.md'].includes('### Highlights'));
});

// The text reaches prepareTrim (a string with zero parsable sections) only when a Highlights block is
// applied to a `## ` heading the version parser does not count, so the unreadable line must not
// depend on the section count.
test('an unreadable policy over a CHANGELOG with no release sections still prints the unreadable line, exit 0', () => {
  const { deps, state } = trimDeps({ readPolicy: () => { throw new Error('EACCES: permission denied'); }, changelog: '# Changelog\n\n## Unreleased\n\n* soon\n' });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.err, 'changelog trim: policy unreadable (EACCES: permission denied); not trimmed\n');
  assert.ok(state.files['CHANGELOG.md'].includes('### Highlights'));
  assert.ok(state.git.includes('commit -m docs(changelog): append Highlights for v1.3.0'));
});

test('within the bound no git call is made and no branch is resolved', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 9\n', commitBodies: ['fix: a\n\nno footer'] });
  const base = deps.git;
  const trimCalls = [];
  deps.git = (args) => { if (['symbolic-ref', 'branch', 'rev-parse', 'merge-base', 'remote'].includes(args[0])) { trimCalls.push(args[0]); throw new Error(`unexpected ${args[0]}`); } return base(args); };
  assert.strictEqual(run([], deps), 0);
  // the branch lookup swallows its own git errors, so the calls themselves are the evidence
  assert.deepStrictEqual(trimCalls, []);
  assert.strictEqual(state.err, '');
  assert.deepStrictEqual(state.writes, []);
});

test('the policy is read once per run, whatever the number of consumers', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n' });
  let reads = 0;
  const inner = deps.readPolicy;
  deps.readPolicy = () => { reads += 1; return inner(); };
  assert.strictEqual(run([], deps), 0, state.err);
  assert.strictEqual(reads, 1);
});

test('the default branch falls back to the checked-out branch before main', () => {
  const noHead = Object.assign(new Error('no ref'), { status: 128 });
  const verify = 'rev-parse --verify --quiet --end-of-options refs/remotes/origin/work^{commit}';
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', gitAnswers: {
    'symbolic-ref --short refs/remotes/origin/HEAD': noHead,
    'branch --show-current': 'work\n',
    [verify]: `${TIP}\n`,
    [`merge-base --is-ancestor --end-of-options ${TIP} refs/remotes/origin/work`]: '',
  } });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.ok(state.git.includes(verify), state.git.join('\n'));
  assert.ok(parseChangelogFooter(state.files['CHANGELOG.md']));
  // an empty answer (detached HEAD) skips to main
  const detached = trimDeps({ policy: 'changelog-max-releases: 2\n', gitAnswers: { 'symbolic-ref --short refs/remotes/origin/HEAD': noHead, 'branch --show-current': '\n' } });
  assert.strictEqual(run([], detached.deps), 0, detached.state.err);
  assert.ok(detached.state.git.some((k) => k.endsWith('refs/remotes/origin/main^{commit}')), detached.state.git.join('\n'));
});

test('publish: no Highlights and nothing to trim → no commit, no push', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', commitBodies: ['fix: a\n\nno footer'], changelog: '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n* a\n\n## 1.2.0 (2026-09-01)\n\n* b\n' });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.deepStrictEqual(state.writes, []);
  assert.ok(!state.git.some((k) => k.startsWith('commit ') || k === 'push'));
  assert.strictEqual(state.err, '');
});

test('publish: Highlights already present and nothing to trim → skipped line, no commit, no push', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 5\n', changelog: '# Changelog\n\n## 1.3.0 (2026-10-02)\n\n### Highlights\n* Added the thing.\n* Fixed the other thing.\n\n## 1.2.0 (2026-09-01)\n' });
  assert.strictEqual(run([], deps), 0, state.err);
  assert.match(state.out, /already carries the rendered block/);
  assert.ok(!state.git.some((k) => k.startsWith('commit ') || k === 'push'));
});

test('a CHANGELOG read that throws on a trim-only path is a failure line, not an exit-code change', () => {
  const { deps, state } = trimDeps({ policy: 'changelog-max-releases: 2\n', commitBodies: ['fix: a\n\nno footer'] });
  deps.readFile = () => { throw new Error('EIO'); };
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.err, 'changelog trim: failed (EIO); file left untrimmed\n');
});

test('CLI: readPolicy defaults to {root}/.claude-tweaks/policy.yml and a missing file reads as null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rnp-policy-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rnp-nopolicy-'));
  try {
    fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
    fs.writeFileSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), 'changelog-max-releases: 2\n');
    const git = (args) => {
      if (args[0] === 'log') return logOf(['fix: a\n\nno footer']);
      return TRIM_GIT[args.join(' ')] || '';
    };
    const gh = (args) => {
      if (args.join(' ').startsWith('release list')) return JSON.stringify([{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }, { tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' }]);
      throw new Error('unexpected gh');
    };
    const writes = {};
    const res = runCliSync(CLI, ['--root', tmp], { env: { PATH: process.env.PATH }, deps: { gh, git, readFile: () => FOUR_SECTIONS, writeFile: (abs, text) => { writes[abs] = text; } } });
    assert.strictEqual(res.code, 0, res.stderr);
    assert.deepStrictEqual(parseChangelogVersions(writes[path.join(tmp, 'CHANGELOG.md')]).map((s) => s.version), ['1.3.0', '1.2.0']);
    // no policy.yml under this root: the key reads as 0, nothing is trimmed
    const writes2 = {};
    const res2 = runCliSync(CLI, ['--root', bare], { env: { PATH: process.env.PATH }, deps: { gh, git, readFile: () => FOUR_SECTIONS, writeFile: (abs, text) => { writes2[abs] = text; } } });
    assert.strictEqual(res2.code, 0, res2.stderr);
    assert.strictEqual(res2.stderr, '');
    assert.deepStrictEqual(writes2, {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('CLI: a policy.yml that exists but cannot be read prints the unreadable line and does not trim (the default reader rethrows non-ENOENT)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rnp-unreadable-'));
  try {
    // a directory where the file should be: readFileSync fails with EISDIR, which is not ENOENT
    fs.mkdirSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), { recursive: true });
    const git = (args) => {
      if (args[0] === 'log') return logOf(['fix: a\n\nno footer']);
      return TRIM_GIT[args.join(' ')] || '';
    };
    const gh = (args) => {
      if (args.join(' ').startsWith('release list')) return JSON.stringify([{ tagName: 'v1.3.0', publishedAt: '2026-10-02T00:00:00Z' }, { tagName: 'v1.2.0', publishedAt: '2026-09-01T00:00:00Z' }]);
      throw new Error('unexpected gh');
    };
    const writes = {};
    const res = runCliSync(CLI, ['--root', tmp], { env: { PATH: process.env.PATH }, deps: { gh, git, readFile: () => FOUR_SECTIONS, writeFile: (abs, text) => { writes[abs] = text; } } });
    assert.strictEqual(res.code, 0, res.stderr);
    assert.match(res.stderr, /^changelog trim: policy unreadable \(EISDIR[^)]*\); not trimmed\n$/);
    assert.deepStrictEqual(writes, {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
