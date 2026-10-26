// Flow preflight concurrency budget (#1931) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// gatherPreflight runs its three subprocess probes concurrently, so three 150 ms probes must finish
// under 600 ms, a margin a serial run (450 ms of sleeps) nearly fits. Lives outside tests/ because a
// wall-clock assertion flakes under sibling-suite load; the deterministic half (the probes overlap,
// counted in flight) stays in tests/bin-lib/flow/preflight.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gatherPreflight } = require('../plugin/bin/lib/flow/preflight');

// A fake main checkout with one run dir under .claude-tweaks/pipelines/.
function mainRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-preflight-'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

const STAMP = JSON.stringify({ present: true, sha: 'abc', head: 'abc', dirty: false, scope: 'full', fullSha: 'abc', match: true, verifiedHead: true });
const CHANGED = JSON.stringify({ base: 'abc', files: ['src/a.js'] });
const PR_BODY = 'intro\n<!-- phases-start -->\n- [x] build\n- [x] test\n- [ ] review\n- [ ] polish\n- [ ] wrap-up\n<!-- phases-end -->\ntail';

function deps(fx, overrides = {}, calls = null) {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    git: (args) => (args[0] === 'ls-tree' ? 'x/work/7-spec.md\0' : 'feat-branch\n'),
    execFile: (cmd, args, opts) => {
      if (calls) calls.push({ cmd, args, opts });
      if (cmd === 'gh') return JSON.stringify({ state: 'OPEN', isDraft: true, body: PR_BODY });
      if (args.includes('--stamp-status')) return STAMP;
      if (args.includes('--changed-files')) return CHANGED;
      throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
    },
    checkResumeFreshness: () => ({ safe: true, verdict: 'not-interrupted' }),
    checkStagedInventory: () => ({ checked: 2, missing: [] }),
    readRunState: (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8')); } catch { return null; } },
    resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, k === 'integration-branch' ? { value: 'main', source: 'default' } : { value: `v-${k}`, source: 'policy' }])),
    resolveTarget: ({ runDir }) => (fs.existsSync(runDir) ? { ok: true, dir: fs.realpathSync(runDir) } : { ok: false, reason: 'missing' }),
    now: () => Date.parse('2026-09-06T12:00:00Z'),
    ...overrides,
  };
}

function seedCase1(fx) {
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto\nceremony-profile: standard\nscope-creep: add-to-plan\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', pr: { number: 1901, branch: 'feat-branch' } }));
  fs.mkdirSync(path.join(fx.runDir, 'work'));
  fs.writeFileSync(path.join(fx.runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
}

test('one probe throwing degrades only its field, and the probes run concurrently (#1931)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const slow = (v) => new Promise((r) => setTimeout(() => r(v), 150));
  const d = deps(fx, {
    checkResumeFreshness: () => { throw new Error('probe exploded'); },
    execFile: (cmd, args) => { if (cmd === 'gh') return JSON.stringify({ state: 'OPEN', isDraft: true, body: PR_BODY }); return args.includes('--stamp-status') ? STAMP : CHANGED; },
  });
  const t0 = Date.now();
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: { ...d, execFileAsync: async (cmd, args) => slow(d.execFile(cmd, args)) } });
  assert.strictEqual(pack.freshness.ok, false);
  assert.match(pack.freshness.error, /probe exploded/);
  assert.strictEqual(pack.pr.ok, true);
  assert.ok(Date.now() - t0 < 600, 'three 150 ms subprocess probes overlap');
});
