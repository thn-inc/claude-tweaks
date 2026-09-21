'use strict';
// tests/bin-lib/release-local/hardening.test.js — wrap-up fix wave (#2254,
// deferral-gate fix-now items, run ledger rows 48-53). Every new test the
// wave adds lives here, per the wave's own hard constraint: two staged
// review patches (review-1.patch, review-2.patch) must keep applying, so
// nothing here may touch the regions those patches own in release-local.js,
// cli.test.js, or manifest.js's applyVersion body.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommit } = require('../../../plugin/bin/lib/release-local/commits.js');
const { parseGitHubRemote } = require('../../../plugin/bin/lib/release-local/changelog.js');
const { run } = require('../../../plugin/bin/release-local.js');
const M = require('../../../plugin/bin/lib/release-local/manifest.js');

// W1 (row 48): an unconventional subject's empty BREAKING CHANGE: footer
// falls back to the subject, same as the conventional path's own fallback.
test('W1: parseCommit — an unconventional subject with an empty BREAKING CHANGE: footer falls back to the subject', () => {
  const out = parseCommit({ sha: 'f'.repeat(40), subject: 'Merge branch x', body: 'BREAKING CHANGE:' });
  assert.strictEqual(out.breaking, true);
  assert.strictEqual(out.breakingNote, 'Merge branch x');
  assert.strictEqual(out.unconventional, true);
});

// W2 (row 49): GitHub remote forms with userinfo and case-insensitive host.
test('W2: parseGitHubRemote — userinfo-prefixed https and a case-insensitive host; credentials never leak into url', () => {
  assert.deepStrictEqual(parseGitHubRemote('https://user@github.com/o/r'), { owner: 'o', repo: 'r', url: 'https://github.com/o/r' });
  assert.deepStrictEqual(parseGitHubRemote('https://x-access-token:TOKEN@github.com/o/r.git'), { owner: 'o', repo: 'r', url: 'https://github.com/o/r' });
  assert.deepStrictEqual(parseGitHubRemote('https://GitHub.COM/o/r'), { owner: 'o', repo: 'r', url: 'https://github.com/o/r' });
  // existing four forms still parse
  for (const u of ['https://github.com/o/r', 'https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git']) {
    assert.deepStrictEqual(parseGitHubRemote(u), { owner: 'o', repo: 'r', url: 'https://github.com/o/r' });
  }
  assert.strictEqual(parseGitHubRemote('https://gitlab.com/o/r'), null);
});

// W3 (row 50): a `release-hook` policy value spelling "disabled" reads as
// unset, never as a literal command to run. A minimal fake deps, in the
// shape of cli.test.js's own makeDeps — copied rather than imported, per the
// wave's hard constraint that cli.test.js stays untouched here.
function makeReleaseHookDeps({ policyRaw } = {}) {
  const state = {
    files: {
      'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'simple' } } }),
      '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n',
      'version.txt': '1.2.0\n',
      'CHANGELOG.md': '# Changelog\n',
      ...(policyRaw !== undefined ? { '.claude-tweaks/policy.yml': policyRaw } : {}),
    },
    git: [], writes: [], out: '', err: '', hooks: [],
  };
  const LOG = (subjects) => subjects.map((s, i) => `${String(i).repeat(40)}\x1f${s}\x1f\x1e\n`).join('');
  const deps = {
    git: (args) => {
      const key = args.join(' ');
      state.git.push(key);
      if (key === 'branch --show-current') return 'main\n';
      if (key === 'status --porcelain --untracked-files=no') return '';
      if (key === 'remote get-url origin') throw new Error('fatal: No such remote');
      if (key.startsWith('describe')) return 'v1.2.0\n';
      if (key.startsWith('log --first-parent')) return LOG(['fix: a']);
      if (key.startsWith('show ')) {
        const p = key.slice(key.indexOf(':') + 1);
        if (p in state.files) return state.files[p];
        throw new Error(`fatal: path '${p}' does not exist`);
      }
      if (key === 'worktree list --porcelain') return 'worktree /repo\nbranch refs/heads/main\n';
      if (key === 'tag -l v*') return 'v1.2.0\n';
      if (key.startsWith('add ') || key.startsWith('commit ') || key.startsWith('tag -a')) return '';
      throw new Error(`unexpected git: ${key}`);
    },
    readFile: (p) => (p in state.files ? state.files[p] : null),
    writeFile: (p, text) => { state.writes.push(p); state.files[p] = text; },
    listPlanFiles: () => [],
    runHook: (cmd) => { state.hooks.push(cmd); return 0; },
    today: () => '2026-09-12',
    stdout: (t) => { state.out += t; },
    stderr: (t) => { state.err += t; },
  };
  return { deps, state };
}

test('W3: release-hook: false (and off/none/null, case-insensitive) reads as unset — no hook runs; an ordinary command still runs', () => {
  for (const spelling of ['false', 'off', 'none', 'null', 'FALSE', 'Off']) {
    const { deps, state } = makeReleaseHookDeps({ policyRaw: `release-hook: ${spelling}\n` });
    assert.strictEqual(run([], deps), 0, spelling);
    assert.match(state.out, /hook: no hook configured/, spelling);
    assert.deepStrictEqual(state.hooks, [], spelling);
  }
  const { deps, state } = makeReleaseHookDeps({ policyRaw: 'release-hook: npm run deploy\n' });
  assert.strictEqual(run([], deps), 0);
  assert.match(state.out, /hook: npm run deploy/);
  assert.deepStrictEqual(state.hooks, ['npm run deploy']);
});

// W4 (row 51): the dry-run plan's `manifest:` line names only the files a
// live run would actually write — a present target whose text carries no
// version token is never listed (applyVersion refuses it instead of
// writing it).
test('W4: manifest.plannedWrites — a present, tokenless target is omitted from the planned-write list', () => {
  const node = M.resolveTargets({ releaseType: 'node', extraFiles: [] });
  const store = { '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n', 'package.json': '{\n  "name": "x"\n}\n' };
  const read = (p) => (p in store ? store[p] : null);
  assert.deepStrictEqual(M.plannedWrites(node, '1.3.0', read), ['.release-please-manifest.json']);
  // an ordinary bump: both present-and-tokened targets are listed
  const ok = { '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n', 'package.json': '{\n  "name": "x",\n  "version": "1.2.0"\n}\n' };
  assert.deepStrictEqual(M.plannedWrites(node, '1.3.0', (p) => (p in ok ? ok[p] : null)), ['.release-please-manifest.json', 'package.json']);
  // a create target that does not yet exist is still planned (it would be created)
  const simple = M.resolveTargets({ releaseType: 'simple', extraFiles: [] });
  assert.deepStrictEqual(M.plannedWrites(simple, '0.2.0', () => null), ['version.txt']);
});

test('W4: release-local --dry-run — a stack manifest present without a version token is omitted from the manifest: line', () => {
  const { deps, state } = makeReleaseHookDeps();
  deps.readFile = ((orig) => (p) => (p === 'release-please-config.json'
    ? JSON.stringify({ packages: { '.': { 'release-type': 'node' } } })
    : p === 'package.json' ? '{\n  "name": "x"\n}\n' : orig(p)))(deps.readFile);
  assert.strictEqual(run(['--dry-run'], deps), 0);
  const manifestLine = state.out.split('\n').find((l) => l.startsWith('manifest: '));
  assert.ok(manifestLine, state.out);
  assert.ok(!manifestLine.includes('package.json'), manifestLine);
  assert.ok(manifestLine.includes('.release-please-manifest.json'), manifestLine);
});

// W5 (row 52): `.claude-tweaks/policy.yml` is read once per run and its raw
// text threaded to both policyValue call sites — no behaviour change, just
// one fewer readFile call for a policy the run already needs once.
test('W5: release-local reads .claude-tweaks/policy.yml exactly once per run, and both levers still resolve from it', () => {
  const { deps, state } = makeReleaseHookDeps({ policyRaw: 'release-hook: npm run deploy\nintegration-branch: main\n' });
  let policyReads = 0;
  deps.readFile = ((orig) => (p) => { if (p === '.claude-tweaks/policy.yml') policyReads += 1; return orig(p); })(deps.readFile);
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(policyReads, 1);
  assert.deepStrictEqual(state.hooks, ['npm run deploy']);
});

// W6 (row 53): spliceToml's next-section boundary matches a real TOML table
// header (`^[...]` closed on the same line), not any column-0 `[` — a
// multi-line array continuation that itself starts a line with `[` (a
// nested-array element) no longer truncates the section early.
test("W6: spliceToml — a classifiers = [ array whose continuation lines start at column 0 with '[' does not end the section before version", () => {
  const text = [
    '[project]',
    'name = "x"',
    'classifiers = [',
    '[',
    '"Foo",',
    '],',
    ']',
    'version = "1.2.0"',
    '',
  ].join('\n');
  const out = M.spliceVersion('toml', text, '1.3.0', { sections: ['project'] });
  assert.strictEqual(out.found, true);
  assert.strictEqual(out.previous, '1.2.0');
  assert.match(out.text, /version = "1\.3\.0"\n$/);
  // a real next-section header still ends the section where it should
  const withNextSection = `${text}[tool.poetry]\nversion = "9.9.9"\n`;
  const out2 = M.spliceVersion('toml', withNextSection, '1.3.0', { sections: ['project'] });
  assert.strictEqual(out2.found, true);
  assert.strictEqual(out2.previous, '1.2.0');
});

// W6: the `text` kind no longer routes through spliceMatch's artificial
// empty-group call — same behavior via a direct regex exec + slice.
test('W6: spliceVersion text — direct-regex path preserves existing bump/no-token/absent behavior', () => {
  assert.deepStrictEqual(M.spliceVersion('text', '1.2.0\n', '1.3.0'), { text: '1.3.0\n', found: true, previous: '1.2.0' });
  assert.deepStrictEqual(M.spliceVersion('text', 'unreleased\n', '1.3.0'), { text: 'unreleased\n', found: false, previous: null });
});

// W7 (row 63): the text kind's byte shape matches release-please's `simple`
// strategy — DefaultUpdater.updateContent returns `this.version + '\n'`
// unconditionally, so version.txt's WHOLE content becomes the version plus
// one newline, discarding whatever else was there when a token is found (or
// the file is absent/created), and staying untouched when no token exists.
test('W7: spliceVersion text — version.txt byte shape matches release-please\'s DefaultUpdater (version + one newline)', () => {
  assert.deepStrictEqual(M.spliceVersion('text', null, '0.2.0'), { text: '0.2.0\n', found: false, previous: null });
  assert.deepStrictEqual(M.spliceVersion('text', '0.1.0', '0.2.0'), { text: '0.2.0\n', found: true, previous: '0.1.0' });
  assert.deepStrictEqual(M.spliceVersion('text', '0.1.0\n', '0.2.0'), { text: '0.2.0\n', found: true, previous: '0.1.0' });
  assert.deepStrictEqual(M.spliceVersion('text', 'unreleased\n', '0.2.0'), { text: 'unreleased\n', found: false, previous: null });
});

test('W7: applyVersion (simple release-type) — version.txt created, bumped from either newline shape, or refused when tokenless and present', () => {
  const simple = M.resolveTargets({ releaseType: 'simple', extraFiles: [] });
  const created = {};
  M.applyVersion(simple, '0.2.0', (p) => (p in created ? created[p] : null), (p, text) => { created[p] = text; });
  assert.strictEqual(created['version.txt'], '0.2.0\n');
  const noNewline = { 'version.txt': '0.1.0' };
  M.applyVersion(simple, '0.2.0', (p) => (p in noNewline ? noNewline[p] : null), (p, text) => { noNewline[p] = text; });
  assert.strictEqual(noNewline['version.txt'], '0.2.0\n');
  const withNewline = { 'version.txt': '0.1.0\n' };
  M.applyVersion(simple, '0.2.0', (p) => (p in withNewline ? withNewline[p] : null), (p, text) => { withNewline[p] = text; });
  assert.strictEqual(withNewline['version.txt'], '0.2.0\n');
  // no token at all: refused before any write (run ledger row 67), the file stays exactly as it was
  const tokenless = { 'version.txt': 'unreleased\n' };
  const writes = [];
  assert.throws(() => M.applyVersion(simple, '0.2.0', (p) => (p in tokenless ? tokenless[p] : null), (p, text) => { writes.push(p); tokenless[p] = text; }), /version\.txt exists but carries no version token/);
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(tokenless['version.txt'], 'unreleased\n');
});
