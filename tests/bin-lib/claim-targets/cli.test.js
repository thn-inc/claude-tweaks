// tests/bin-lib/claim-targets/cli.test.js
// Wiring, not behavior — the claim-side twin of tests/bin-lib/release-claim/cli.test.js's
// `realDeps` test. Every test in claim-targets.test.js injects its own deps into `run()`,
// so a dropped or mis-wired dep in bin/claim-targets.js's own `realDeps` leaves that whole
// suite green while the real CLI degrades silently: without `gitRunner` every claim write
// falls back to the contents-API PUT — the rate-limited endpoint #787 moved the fleet's
// most-contended write off — and nothing fails, it just gets slower and more contended.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run, realDeps } = require('../../../plugin/bin/claim-targets');
const claimsGitCas = require('../../../plugin/bin/lib/issues/claims-git-cas');
const claimStore = require('../../../plugin/bin/lib/issues/claim-store');
const lib = require('../../../plugin/bin/lib/claim-targets/claim-targets');

test('realDeps wires the real git-CAS runner and the real claim-store ghApi', () => {
  assert.equal(realDeps.gitRunner, claimsGitCas.defaultRunner, 'gitRunner is claims-git-cas.js\'s defaultRunner export');
  assert.equal(realDeps.ghApi, claimStore.defaultGhApi, 'ghApi is claim-store.js\'s defaultGhApi export');
  assert.equal(typeof realDeps.gh, 'function', 'the generic throwing gh runner is wired too');
});

test('#5902: realDeps wires a stationEvent emitter beside gitRunner', () => {
  assert.equal(typeof realDeps.stationEvent, 'function', 'stationEvent is wired');
  assert.equal(realDeps.gitRunner, claimsGitCas.defaultRunner, 'gitRunner is still carried');
});

test('the CLI re-exports the library `run`, so realDeps is what the entry point actually passes', () => {
  assert.equal(run, lib.run);
});

// #5109: claim-targets keeps git-exec.js's loose unparseable-remote fallback on (stale-claim-pr.js
// turns it off). Through `run()` the two settings reach the same host, so this is the one place the
// choice shows: a cloud sandbox proxy origin, which the origin-host gate neither admits nor
// refuses, still gets a spec here, with the host an exported GH_HOST or github.com.
test('realDeps.gateOrigin gives a cloud sandbox proxy origin a spec, because the loose fallback is on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gate-origin-'));
  const cwd = process.cwd();
  const ghHost = process.env.GH_HOST;
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['remote', 'add', 'origin', 'http://local_proxy@127.0.0.1:43215/git/acme/widgets'],
      { cwd: dir, stdio: 'ignore', windowsHide: true });
    delete process.env.GH_HOST;
    process.chdir(dir);
    assert.deepEqual(realDeps.gateOrigin(), {
      spec: { host: 'github.com', owner: 'acme', repo: 'widgets' },
      refusal: null,
    });
  } finally {
    process.chdir(cwd);
    if (ghHost === undefined) delete process.env.GH_HOST; else process.env.GH_HOST = ghHost;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
