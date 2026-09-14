'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRelease, guardReleasableTree, pushAfterAncestryCheck } = require('../../../plugin/bin/lib/release/run.js');

const manifest = (v) => JSON.stringify({ name: 'claude-tweaks', version: v, description: 'Desc' }, null, 2);
const CHANGELOG = '# Changelog\n\nProse.\n\n## v6.70.1 — Prior\n\nBody.\n';

function makeDeps(overrides = {}) {
  const state = {
    files: {
      'plugin/.claude-plugin/plugin.json': manifest('6.70.1'),
      'CHANGELOG.md': CHANGELOG,
    },
    gitCalls: [], writes: [], appended: [], ghCalls: [],
    staged: overrides.staged, // lazily read below
    branch: overrides.branch || 'main',
    dirty: overrides.dirty || '',
    ancestorOk: overrides.ancestorOk !== false,
    headSha: overrides.headSha || 'cafebabecafebabecafebabecafebabecafebabe',
  };
  const deps = {
    repoRoot: '/repo',
    readFile: (p) => state.files[p],
    writeFile: (p, text) => { state.writes.push(p); state.files[p] = text; },
    appendShipped: (root, v, date) => { state.appended.push(`${v}@${date}`); return true; },
    git: (args) => {
      const key = args.join(' ');
      state.gitCalls.push(key);
      if (key === 'branch --show-current') return state.branch + '\n';
      if (key === 'status --porcelain --untracked-files=no') return state.dirty;
      if (key.startsWith('fetch')) return '';
      if (key.startsWith('show origin/main:')) return manifest('6.70.1');
      if (key.startsWith('show main:')) return manifest('6.70.1');
      if (key.startsWith('worktree list')) return 'worktree /repo\nbranch refs/heads/main\n';
      // unnamed-records gate: no bump history and nothing materialized by default —
      // a no-op gate that leaves every existing precheck/compose/push test unaffected.
      // `overrides.bumpSha` (a root-commit bump at v6.70.1, matching the manifest/
      // CHANGELOG fixtures above) lets a gate-specific test opt into a real bump history.
      if (key.startsWith('cat-file -e main:')) return '';
      if (key.startsWith('log --format=%H --topo-order main --')) return overrides.bumpSha || '';
      if (overrides.bumpSha && key === `show ${overrides.bumpSha}:plugin/.claude-plugin/plugin.json`) return manifest('6.70.1');
      if (overrides.bumpSha && key.startsWith(`show ${overrides.bumpSha}^:`)) {
        throw new Error(`fatal: path 'plugin/.claude-plugin/plugin.json' does not exist in '${overrides.bumpSha}^'`);
      }
      if (key.startsWith('diff --name-status')) return overrides.gateDiff || '';
      if (key.startsWith('add ')) return '';
      if (key === 'diff --cached --name-only') {
        return (state.staged || ['plugin/.claude-plugin/plugin.json', 'CHANGELOG.md', 'docs/shipped-versions.tsv']).join('\n');
      }
      if (key.startsWith('commit')) return '';
      if (key === 'rev-parse HEAD') return `${state.headSha}\n`;
      if (key.startsWith('merge-base --is-ancestor')) {
        if (!state.ancestorOk) throw new Error('not an ancestor');
        return '';
      }
      if (key.startsWith('push')) return '';
      throw new Error(`unexpected git: ${key}`);
    },
    gh: (args) => {
      state.ghCalls.push(args.join(' '));
      if (args.join(' ').includes('PUT')) return '{}';
      return JSON.stringify({
        content: Buffer.from(JSON.stringify({ metadata: { version: '2.4.0' }, plugins: [{ name: 'claude-tweaks', version: '6.70.1', description: 'Old' }] })).toString('base64'),
        sha: 'sha1',
      });
    },
    listPlanFiles: () => [],
  };
  return { deps, state };
}

test('dry-run composes but writes nothing', () => {
  const { deps, state } = makeDeps();
  const out = runRelease(deps, { part: 'minor', summary: 'S', date: '2026-08-08', dryRun: true, log: () => {} });
  assert.strictEqual(out.version, '6.71.0');
  assert.strictEqual(out.pushed, false);
  assert.deepStrictEqual(state.writes, []);
  assert.deepStrictEqual(state.appended, []);
  assert.ok(!state.gitCalls.some((c) => c.startsWith('push')));
  assert.deepStrictEqual(state.ghCalls, []);
});

test('live run: write → add → verify staged → commit → ancestor check → push → mirror, in order', () => {
  const { deps, state } = makeDeps();
  const out = runRelease(deps, { part: 'minor', summary: 'S', date: '2026-08-08', dryRun: false, log: () => {} });
  assert.strictEqual(out.pushed, true);
  assert.strictEqual(out.mirrored, true);
  assert.deepStrictEqual(state.writes, ['plugin/.claude-plugin/plugin.json', 'CHANGELOG.md']);
  assert.deepStrictEqual(state.appended, ['6.71.0@2026-08-08']);
  const order = ['diff --cached --name-only', 'commit', 'merge-base --is-ancestor', 'push'].map(
    (needle) => state.gitCalls.findIndex((c) => c.startsWith(needle)),
  );
  assert.ok(order.every((i, n) => i !== -1 && (n === 0 || i > order[n - 1])), `order violated: ${state.gitCalls.join(' | ')}`);
  assert.strictEqual(state.ghCalls.filter((c) => c.includes('PUT')).length, 1);
});

// The mirror can only pin what the release commit actually is, so the sha has to be
// read after the commit lands — a pre-commit read names the previous release.
test('the release commit sha is captured after the commit and pinned into the mirror', () => {
  const { deps, state } = makeDeps({ headSha: '0f1e2d3c4b5a69788796a5b4c3d2e1f001122334' });
  runRelease(deps, { part: 'minor', summary: 'S', date: '2026-08-08', dryRun: false, log: () => {} });
  const revParseIndex = state.gitCalls.indexOf('rev-parse HEAD');
  const commitIndex = state.gitCalls.findIndex((c) => c.startsWith('commit'));
  assert.ok(revParseIndex !== -1, `never read HEAD: ${state.gitCalls.join(' | ')}`);
  assert.ok(revParseIndex > commitIndex, 'HEAD must be read after the release commit lands');

  const put = state.ghCalls.find((c) => c.includes('PUT'));
  const contentArg = put.split(' ').find((a) => a.startsWith('content='));
  const written = JSON.parse(Buffer.from(contentArg.slice('content='.length), 'base64').toString('utf8'));
  assert.deepStrictEqual(written.plugins[0].source, {
    source: 'git-subdir',
    url: 'https://github.com/thomasholknielsen/claude-tweaks',
    path: 'plugin',
    sha: '0f1e2d3c4b5a69788796a5b4c3d2e1f001122334',
  });
  assert.ok(!('version' in written.plugins[0]));
});

test('refuses to run off main or with a dirty tree', () => {
  assert.throws(() => runRelease(makeDeps({ branch: 'feature' }).deps, { part: 'patch', summary: 'S', date: '2026-08-08', dryRun: true, log: () => {} }), /main/);
  assert.throws(() => runRelease(makeDeps({ dirty: ' M x.js' }).deps, { part: 'patch', summary: 'S', date: '2026-08-08', dryRun: true, log: () => {} }), /tracked modifications/i);
});

test('aborts before commit when the staged set is not exactly the release trio [IL-42]', () => {
  const { deps, state } = makeDeps({ staged: ['plugin/.claude-plugin/plugin.json', 'CHANGELOG.md', 'docs/shipped-versions.tsv', 'stray.js'] });
  assert.throws(() => runRelease(deps, { part: 'minor', summary: 'S', date: '2026-08-08', dryRun: false, log: () => {} }), /staged/i);
  assert.ok(!state.gitCalls.some((c) => c.startsWith('commit')), 'must not commit a stray index');
});

test('aborts before push when origin/main moved during compose', () => {
  const { deps, state } = makeDeps({ ancestorOk: false });
  assert.throws(() => runRelease(deps, { part: 'minor', summary: 'S', date: '2026-08-08', dryRun: false, log: () => {} }), /moved between pre-check and push[\s\S]*do NOT re-run/i);
  assert.ok(!state.gitCalls.some((c) => c.startsWith('push')), 'must not push over divergence');
});

// #768: refuse to bump while a merge since the last bump is unnamed in the
// summary/CHANGELOG — the prevention companion to `status`'s post-merge detection.
const UNNAMED_700 = 'A\t.claude-tweaks/pipelines/2026-08-01T000000-record-700/work/700-spec.md\n';

test('unnamed-records gate: live run aborts before writing anything, naming the record [AC1]', () => {
  const { deps, state } = makeDeps({ gateDiff: UNNAMED_700, bumpSha: 'bump1' });
  assert.throws(
    () => runRelease(deps, { part: 'minor', summary: 'unrelated', date: '2026-08-08', dryRun: false, log: () => {} }),
    /release gate: unnamed merges since v6\.70\.1: #700/,
  );
  assert.deepStrictEqual(state.writes, [], 'must write nothing when the gate aborts');
  assert.ok(!state.gitCalls.some((c) => c.startsWith('commit')), 'must not commit when the gate aborts');
});

test('unnamed-records gate: naming the record in the summary lets the release proceed [AC2]', () => {
  const { deps, state } = makeDeps({ gateDiff: UNNAMED_700, bumpSha: 'bump1' });
  const out = runRelease(deps, { part: 'minor', summary: 'Ships #700', date: '2026-08-08', dryRun: false, log: () => {} });
  assert.strictEqual(out.pushed, true);
  assert.deepStrictEqual(state.appended, ['6.71.0@2026-08-08']);
});

test('unnamed-records gate: --dry-run reports the unnamed set without aborting or writing [AC3]', () => {
  const { deps, state } = makeDeps({ gateDiff: UNNAMED_700, bumpSha: 'bump1' });
  const logs = [];
  const out = runRelease(deps, { part: 'minor', summary: 'unrelated', date: '2026-08-08', dryRun: true, log: (m) => logs.push(m) });
  assert.strictEqual(out.version, '6.71.0');
  assert.deepStrictEqual(state.writes, []);
  assert.ok(logs.some((l) => l.includes('[dry-run] release gate:') && l.includes('#700')), logs.join(' | '));
});

test('unnamed-records gate: --allow-unnamed proceeds and records the override in the commit message', () => {
  const { deps, state } = makeDeps({ gateDiff: UNNAMED_700, bumpSha: 'bump1' });
  const out = runRelease(deps, { part: 'minor', summary: 'unrelated', date: '2026-08-08', dryRun: false, allowUnnamed: [700], log: () => {} });
  assert.strictEqual(out.pushed, true);
  const commitCall = state.gitCalls.find((c) => c.startsWith('commit'));
  assert.ok(commitCall.includes('allow-unnamed: #700'), commitCall);
});

test('guardReleasableTree: branch and clean-tree checks, parameterized by branch', () => {
  const calls = [];
  const deps = { git: (a) => { calls.push(a.join(' ')); return a[0] === 'branch' ? 'develop\n' : ''; } };
  assert.throws(() => guardReleasableTree(deps, { branch: 'main' }), /releases run from main; current branch is "develop"/);
  guardReleasableTree(deps, { branch: 'develop' });
  const dirty = { git: (a) => (a[0] === 'branch' ? 'main\n' : ' M x.js\n') };
  assert.throws(() => guardReleasableTree(dirty, { branch: 'main' }), /tracked modifications/);
});

test('pushAfterAncestryCheck: fetch → ancestry → push of every ref; divergence throws the caller\'s message and pushes nothing', () => {
  const calls = [];
  const ok = { git: (a) => { calls.push(a.join(' ')); return ''; } };
  pushAfterAncestryCheck(ok, { branch: 'main', refs: ['main', 'v1.3.0'], onDiverged: 'moved' });
  assert.deepStrictEqual(calls, ['fetch origin main', 'merge-base --is-ancestor origin/main HEAD', 'push origin main v1.3.0']);
  const diverged = { git: (a) => { if (a[0] === 'merge-base') throw new Error('no'); calls.push(`d:${a[0]}`); return ''; } };
  assert.throws(() => pushAfterAncestryCheck(diverged, { branch: 'main', refs: ['main'], onDiverged: 'origin moved — recover by hand' }), /origin moved — recover by hand/);
  assert.ok(!calls.includes('d:push'));
});

// #2254 F6: a branch that is not on origin yet has no origin/<branch> to fetch or
// compare against — the fetch would die with "couldn't find remote ref".
test('pushAfterAncestryCheck: remoteBranchExists:false pushes without the fetch or the ancestry check', () => {
  const calls = [];
  const deps = { git: (a) => { calls.push(a.join(' ')); return ''; } };
  pushAfterAncestryCheck(deps, { branch: 'main', refs: ['main', 'v1.3.0'], remoteBranchExists: false, onDiverged: 'moved' });
  assert.deepStrictEqual(calls, ['push origin main v1.3.0']);
});
