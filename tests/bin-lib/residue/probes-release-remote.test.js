// #3023: the release probe must read CHANGELOG.md from the integration
// branch's remote-tracking ref, not a stale local HEAD — real git fixtures.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeRelease } = require('../../../plugin/bin/lib/residue/probes/release');

const SCOPE = { ran: true, reason: null, base: 'a1b2c3d', headBranch: 'main', branches: [], worktrees: [] };

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Same shape as residue.js's runner(): full argv, trimmed stdout, null on any failure.
function runner(cwd) {
  return (argv) => {
    try {
      return execFileSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
}

// c1: bootstrap manifest 1.0.0 + CHANGELOG with 1.0.0, tagged v1.0.0.
// c2: tagged v1.1.0; `remoteChangelog` decides what c2's CHANGELOG holds
// (null deletes the file). Local `main` is reset back to c1, so HEAD is behind
// c2. `withRemoteRef` points refs/remotes/origin/main at c2.
function fixture({ remoteChangelog, withRemoteRef = true }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rel-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), '{".": "1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## v1.0.0 — first\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'c1');
  git(root, 'tag', 'v1.0.0');
  const c1 = git(root, 'rev-parse', 'HEAD');
  if (remoteChangelog === null) {
    git(root, 'rm', '-q', 'CHANGELOG.md');
  } else {
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), remoteChangelog);
    git(root, 'add', 'CHANGELOG.md');
  }
  git(root, 'commit', '-q', '--allow-empty', '-m', 'c2');
  git(root, 'tag', 'v1.1.0');
  const c2 = git(root, 'rev-parse', 'HEAD');
  if (withRemoteRef) git(root, 'update-ref', 'refs/remotes/origin/main', c2);
  git(root, 'reset', '-q', '--hard', c1);
  return root;
}

const WITH_HEADING = '# Changelog\n\n## [1.1.0](https://example.com/compare/v1.0.0...v1.1.0) (2026-10-01)\n\n## v1.0.0 — first\n';

test('#3023: a tag whose CHANGELOG heading exists only on the remote-tracking ref is not reported', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, []);
});

test('#3023: the remote-tracking ref is also used for a qualified integration branch (origin/main)', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'origin/main' });
  assert.deepStrictEqual(r.findings, []);
});

test('#3023: a heading genuinely missing on the remote-tracking ref is still reported', () => {
  const root = fixture({ remoteChangelog: '# Changelog\n\n## v1.0.0 — first\n' });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('origin/main')), JSON.stringify(r.findings));
});

test('#3023: with no remote-tracking ref the probe keeps today\'s HEAD behavior', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING, withRemoteRef: false });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('HEAD')), JSON.stringify(r.findings));
});

test('#3023: with no integrationBranch argument the probe keeps today\'s HEAD behavior', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root) });
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('HEAD')));
});

test('#3023: a remote ref that does not contain the newest tag falls back to HEAD', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  // Point origin/main back at c1 (contains v1.0.0 only) and tag a local-only
  // release commit whose CHANGELOG carries the 1.2.0 heading.
  const c1 = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', c1);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.0](https://example.com/c) (2026-10-02)\n\n## [1.1.0](https://example.com/c) (2026-10-01)\n\n## v1.0.0 — first\n');
  git(root, 'commit', '-q', '-am', 'local release');
  git(root, 'tag', 'v1.2.0');
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, [], 'HEAD carries every heading; the stale remote ref must not be read');
});

test('#3023: behind the remote with an unreadable remote CHANGELOG declines with a stated reason', () => {
  const root = fixture({ remoteChangelog: null });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, false);
  assert.strictEqual(r.reason, 'local integration branch is behind its remote — CHANGELOG check skipped');
  assert.deepStrictEqual(r.findings, []);
});

// #3023 fix-round-1 finding: no local v* tag exists at all (so `newestTag` is
// null), yet the remote-tracking ref carries a CHANGELOG heading no local
// tag will ever match. The remote ref must not be trusted when there is no
// local tag to check its ancestry against — read HEAD instead, same as
// pre-#3023 behavior, which reports no finding here.
test('#3023: no local tag at all declines to trust the remote ref and reads HEAD', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rel-notag-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), '{".": "1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'bootstrap, no tag');
  const c1 = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## v1.0.0 — first\n');
  git(root, 'commit', '-q', '-am', 'remote-only heading, still no tag');
  const c2 = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', c2);
  git(root, 'reset', '-q', '--hard', c1);
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, [], JSON.stringify(r.findings));
});
