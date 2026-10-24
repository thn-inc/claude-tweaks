// Wrap-up pack concurrency budget (#1930) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// gatherPack runs its probes concurrently, so the slowed probes (200 ms each) must finish under 600 ms.
// Nine slowed calls make a serial run take 1.8 s; two of them are chained, so the concurrent ideal is
// about 400 ms. Two timings share that one budget on the same run: `wall` is measured by the test,
// `pack.durationMs` by gatherPack itself. The scan misses the second (its known limit 1), but it
// flakes under the same load, so it moves with `wall` (Deliverable 3 of #3939). Lives outside tests/
// because a wall-clock assertion flakes under sibling-suite load; the deterministic half (the probes
// overlap, counted in flight) stays in tests/bin-lib/wrap-up/pack.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { gatherPack } = require('../plugin/bin/lib/wrap-up/pack.js');

// A fixture run dir: run-state.json (pr + worktree), one materialized header, config.yml.
function fixtureRunDir({ withPr = true, records = [1535] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-'));
  const state = { worktree: '/w/tree', status: 'active', sessionId: 's' };
  if (withPr) state.pr = { number: 1901, url: 'https://x/pull/1901', branch: 'b' };
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, 'config.yml'), 'ceremony-profile: standard\n');
  fs.mkdirSync(path.join(dir, 'work'));
  for (const n of records) fs.writeFileSync(path.join(dir, 'work', `${n}-spec.md`), `---\nrecord: ${n}\nsurface: backend\n---\n# ${n}\n`);
  return dir;
}

const DEFAULT_POLICY = { 'integration-branch': 'main', 'work-links': 'native' };
const policyFake = (map) => (keys) => Object.fromEntries(keys.map((k) => [k, map[k] || '']));

// work-backend is read from the worktree's CLAUDE.md, not policy.yml (#1930
// review E1). The fixture worktrees are synthetic paths, so the readFile fake
// answers CLAUDE.md itself and delegates everything else to the real fs.
// `null` stands for an absent CLAUDE.md.
function readFileFake(claudeMd) {
  return (p) => {
    if (path.basename(p) !== 'CLAUDE.md') return fs.readFileSync(p, 'utf8');
    if (claudeMd === null) { const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e; }
    return claudeMd;
  };
}

// Fake deps: every probe succeeds; `git` answers merge-base; module probes
// return the real shapes their production counterparts return.
function okDeps(overrides = {}) {
  return {
    now: () => Date.now(),
    git: (args) => (args[0] === 'merge-base' ? 'abc123\n' : args[0] === 'rev-parse' ? 'refs/remotes/origin/main\n' : ''),
    resolvePolicy: policyFake(DEFAULT_POLICY),
    computeBlastRadius: () => ({ mergeBase: 'abc123', config: {}, summary: { files: 3 } }),
    readClaimBlob: () => ({ content: JSON.stringify({ runId: 'r', sessionId: 's' }), failure: null, absent: false, via: 'git' }),
    classifyClaimBlob: () => ({ state: 'live', reclaimable: false }),
    queryRecords: () => [],
    readRecord: () => ({ facets: { closed: true } }),
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('residue.js')) {
        assert.ok(args.includes('--no-suite'), 'the pack never re-runs the suite');
        return { stdout: JSON.stringify({ suite: { ran: false, reason: 'skipped via --no-suite', findings: [] } }), stderr: '' };
      }
      if (cmd === 'node' && String(args[0]).endsWith('wrap-up-state.js')) return { stdout: JSON.stringify({ state: { isRepo: true, branch: 'b' }, ops: [], since: 'abc123', sinceDate: '2026-09-05T00:00:00Z', rendered: 'Branch b\n' }), stderr: '' };
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      if (cmd === 'node' && String(args[0]).endsWith('pr-checks.js')) return { stdout: JSON.stringify({ state: 'green', failing: [], pending: [] }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'pr') return { stdout: JSON.stringify({ state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN', headRefOid: 'deadbee', statusCheckRollup: [], reviewDecision: null }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ labels: [{ name: 'ready' }, { name: 'auto:merge' }] }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') return { stdout: JSON.stringify([{ number: 1600, title: 'Dependent', body: '' }]), stderr: '' };
      throw new Error(`unexpected execFile ${cmd} ${args.join(' ')}`);
    },
    readFile: readFileFake('# Fixture\n\nwork-backend: github-issues\nwork-types: labels\n'),
    readdir: (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []),
    ...overrides,
  };
}

test('gatherPack runs the probes concurrently — eight 200 ms probes finish well under 2 s (#1930 AC4)', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const slow = okDeps({
    execFile: async (cmd, args) => { await sleep(200); return okDeps().execFile(cmd, args); },
    computeBlastRadius: async () => { await sleep(200); return { summary: {} }; },
    readClaimBlob: async () => { await sleep(200); return { content: null, failure: null, absent: true }; },
  });
  const t0 = Date.now();
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: slow });
  const wall = Date.now() - t0;
  assert.ok(wall < 600, `wall ${wall} ms`);
  assert.ok(pack.durationMs < 600, `pack.durationMs ${pack.durationMs}`);
});
