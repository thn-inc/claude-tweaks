const { test } = require('node:test');
const assert = require('node:assert');
const { probeSuite } = require('../../../plugin/bin/lib/residue/probes/suite');
const { probeRelease } = require('../../../plugin/bin/lib/residue/probes/release');

const SCOPE = { ran: true, reason: null, base: 'a1b2c3d', headBranch: 'worktree-feat', branches: [], worktrees: [] };

test('a failing suite is reported as blast-radius residue', () => {
  const { findings, ran } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout: '# fail 1\nnot ok 3 - heading unique' }) });
  assert.strictEqual(ran, true);
  assert.strictEqual(findings[0].kind, 'suite');
  assert.strictEqual(findings[0].scope, 'blast-radius', 'a red suite at close time is this run\'s own concern regardless of who caused it');
});

test('a suite with more than 5 failing lines signals the cap instead of silently dropping the rest', () => {
  const stdout = ['# fail 8', ...Array.from({ length: 8 }, (_, i) => `not ok ${i + 1} - case ${i + 1}`)].join('\n');
  const { findings } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout }) });
  assert.match(findings[0].evidence, /\(\+3 more\)$/, `expected a +3 more cap signal, got ${JSON.stringify(findings[0].evidence)}`);
});

test('a suite with 5 or fewer failing lines carries no cap signal', () => {
  const stdout = ['# fail 3', 'not ok 1 - a', 'not ok 2 - b', 'not ok 3 - c'].join('\n');
  const { findings } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout }) });
  assert.ok(!findings[0].evidence.includes('more'), `expected no cap signal, got ${JSON.stringify(findings[0].evidence)}`);
});

test('a passing suite produces no findings', () => {
  assert.deepStrictEqual(probeSuite({ scope: SCOPE, run: () => ({ code: 0, stdout: '# pass 8' }) }).findings, []);
});

test('an unrunnable suite does not run, rather than reporting green', () => {
  const r = probeSuite({ scope: SCOPE, run: () => null });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /could not run/);
});

test('a timed-out suite does not run, rather than reporting green', () => {
  const r = probeSuite({ scope: SCOPE, run: () => ({ code: null, stdout: '', timedOut: true }) });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /timed out/);
});

test('a buffer-overflowed suite run does not run, rather than reporting a fabricated failure', () => {
  const r = probeSuite({ scope: SCOPE, run: () => ({ code: null, stdout: '', bufferOverflowed: true }) });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /capture buffer/);
});

// #2257 generalized probeRelease off the `manifest.name === 'claude-tweaks'`
// gate to a project-agnostic tag/CHANGELOG check anchored on the version
// `.release-please-manifest.json` held at the commit that introduced it —
// see tests/bin-lib/residue/probes/release-generalized.test.js for the full
// fixture-driven coverage (non-claude-tweaks project, AC5). These three
// smoke tests just pin the "no manifest in history" degrade at this call
// site, which every project without release-please hits, including this repo
// today.
function releaseRun(argv) {
  const joined = argv.join(' ');
  if (joined.includes('log --diff-filter=A')) return null;
  return null;
}

test('the release probe is inert when release-please was never bootstrapped', () => {
  const r = probeRelease({ scope: SCOPE, run: releaseRun });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /not applicable/);
});
