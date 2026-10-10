'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/dream-scan');

// Mirrors tests/bin-lib/stage-item/cli.test.js's fixture shape exactly —
// dream-scan.js reuses the same anchoring contract (stage-item's
// resolveTarget), so the same main/runDir/shadow layout exercises it here.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamcli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-03T000000-dream-standalone');
  const shadow = path.join(main, '.claude', 'worktrees', 'dream', '.claude-tweaks', 'pipelines', '2026-10-03T000000-dream-standalone');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'dream', '.git'), 'gitdir: ../../../.git/worktrees/dream\n');
  return { main, runDir, shadow };
}

function fakeDeps(cwd, overrides = {}) {
  const out = []; const err = []; const decisions = [];
  const deps = {
    cwd: () => cwd,
    mainRoot: undefined,
    now: () => Date.parse('2026-10-03T12:00:00Z'),
    configDir: () => '/unused-in-these-tests',
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    writeFileSync: (p, c) => fs.writeFileSync(p, c),
    writeStagedItem: require('../../../plugin/bin/lib/stage-item/write').writeStagedItem,
    resolveStageTarget: require('../../../plugin/bin/lib/stage-item/write').resolveTarget,
    logDecision: (argv) => { decisions.push(argv); return 0; },
    runScan: () => ({
      scannedFiles: 0, findings: [], groups: [], qualifying: [],
    }),
    ...overrides,
  };
  return {
    deps, out, err, decisions,
  };
}

function fakeGroup(sessionIds, n = 1) {
  return {
    signature: `Bash:git:error ${n}`,
    toolName: 'Bash',
    commandVerb: 'git',
    items: sessionIds.map((sid) => ({
      sessionId: sid, timestamp: '2026-10-01T00:00:00Z', command: 'git stash pop', errorExcerpt: 'error: conflict',
    })),
    sessionIds: new Set(sessionIds),
  };
}

test('cli: --min-sessions below the floor is a malformed invocation (exit 2), nothing written', () => {
  const { main, runDir } = fixture();
  const { deps } = fakeDeps(main);
  const code = run(['--run-dir', runDir, '--min-sessions', '1'], deps);
  assert.equal(code, 2);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'report.md')), false);
});

test('cli: --run-dir missing is refused (exit 3)', () => {
  const { main, runDir } = fixture();
  const { deps } = fakeDeps(main);
  const code = run(['--run-dir', path.join(runDir, 'does-not-exist')], deps);
  assert.equal(code, 3);
});

test('cli: --run-dir resolving to a worktree-local shadow is refused (exit 3), nothing written', () => {
  const { shadow } = fixture();
  const { deps } = fakeDeps(path.dirname(shadow));
  const code = run(['--run-dir', shadow], deps);
  assert.equal(code, 3);
  assert.equal(fs.existsSync(path.join(shadow, 'staged')), false);
});

test('cli: zero qualifying groups stages nothing but still writes a report.md (exit 0)', () => {
  const { main, runDir } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run-dir', runDir], deps);
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
  const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  assert.ok(/no repeating cross-session pattern/i.test(report));
  assert.ok(out.join('').includes('0 proposal(s) staged'));
});

test('cli: a qualifying group is staged, logged, and reported (exit 0)', () => {
  const { main, runDir } = fixture();
  const group = fakeGroup(['sess-a', 'sess-b']);
  const { deps, decisions } = fakeDeps(main, {
    runScan: () => ({
      scannedFiles: 2, findings: [], groups: [group], qualifying: [group],
    }),
  });
  const code = run(['--run-dir', runDir], deps);
  assert.equal(code, 0);

  const stagedFile = path.join(runDir, 'staged', 'dream-proposal-1.md');
  assert.ok(fs.existsSync(stagedFile));
  const content = fs.readFileSync(stagedFile, 'utf8');
  assert.ok(content.includes('sess-a'));
  assert.ok(content.includes('sess-b'));

  const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  assert.ok(report.includes('dream-proposal-1'));

  assert.equal(decisions.length, 1);
  assert.ok(decisions[0].includes('STAGED'));
  assert.ok(decisions[0].some((a) => typeof a === 'string' && a.includes('sess-a')));
});

test('cli: two qualifying groups in the same run allocate distinct staged ids (no clobber)', () => {
  const { main, runDir } = fixture();
  const g1 = fakeGroup(['sess-a', 'sess-b'], 1);
  const g2 = fakeGroup(['sess-c', 'sess-d'], 2);
  const { deps } = fakeDeps(main, {
    runScan: () => ({
      scannedFiles: 4, findings: [], groups: [g1, g2], qualifying: [g1, g2],
    }),
  });
  const code = run(['--run-dir', runDir], deps);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'dream-proposal-1.md')));
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'dream-proposal-2.md')));
});

test('cli: --max-proposals caps how many qualifying groups get staged', () => {
  const { main, runDir } = fixture();
  const g1 = fakeGroup(['sess-a', 'sess-b'], 1);
  const g2 = fakeGroup(['sess-c', 'sess-d'], 2);
  const { deps } = fakeDeps(main, {
    runScan: () => ({
      scannedFiles: 4, findings: [], groups: [g1, g2], qualifying: [g1, g2],
    }),
  });
  const code = run(['--run-dir', runDir, '--max-proposals', '1'], deps);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(runDir, 'staged', 'dream-proposal-1.md')));
  assert.equal(fs.existsSync(path.join(runDir, 'staged', 'dream-proposal-2.md')), false);
});
