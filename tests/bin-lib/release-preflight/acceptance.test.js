'use strict';
// AC 1, 2, 8 against a real repo through the real CLI: a v1.2.0 tag and one
// feat: commit on main, read from refs/heads/main (no origin) under both
// engines; gh is absent from PATH so the GitHub fields degrade (AC 3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures.js');

const CLI = path.join(__dirname, '../../../plugin/bin/release-preflight.js');
// `gh` has to be genuinely unfindable, and a PATH assembled from git's and
// node's own directories does not achieve that: on Homebrew macOS `git` and
// `gh` share /opt/homebrew/bin, so gh was found and spawned for real and the
// assertions passed only because the fixture has no origin (F1). Instead,
// symlink the real git and the running node into one empty scratch directory
// and make that the WHOLE PATH — git and node resolve, gh is ENOENT.
function ghAbsentBinDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-preflight-bin-'));
  fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(dir, 'git'));
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  return dir;
}
const BIN_DIR = ghAbsentBinDir();
const ENV = { ...process.env, PATH: BIN_DIR, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

function fixture(engine, { feat = true } = {}) {
  const root = gitRepo();
  fixtureGit(['-C', root, 'branch', '-M', 'main']);
  fixtureGit(['-C', root, 'tag', '-a', 'v1.2.0', '-m', 'v1.2.0'], { env: ENV });
  if (feat) fixtureGit(['-C', root, 'commit', '-q', '--allow-empty', '-m', 'feat: one'], { env: ENV });
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `integration-model: ${engine}\n`);
  return root;
}

function pack(root) {
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-1');
  const out = execFileSync('node', [CLI, '--run', runDir], { cwd: root, encoding: 'utf8', env: ENV });
  return { stdout: JSON.parse(out), file: JSON.parse(fs.readFileSync(path.join(runDir, 'release-preflight.json'), 'utf8')) };
}

test('AC 1: one feat since v1.2.0 → proposedVersion 1.3.0 minor, unreleased lists the feat, read from refs/heads/main', () => {
  const { file } = pack(fixture('pr-first'));
  assert.strictEqual(file.tipRef, 'refs/heads/main');
  assert.strictEqual(file.lastTag.value.version, '1.2.0');
  assert.strictEqual(file.proposedVersion.value.version, '1.3.0');
  assert.strictEqual(file.proposedVersion.value.part, 'minor');
  assert.strictEqual(file.unreleased.value.commits.length, 1);
  assert.strictEqual(file.unreleased.value.commits[0].type, 'feat');
  assert.strictEqual(file.ciTip.ok, false, 'no gh on PATH: ciTip degrades');
  // The degradation must come from `gh` being absent, not from the fixture
  // happening to have no origin — those are different failures (F1).
  assert.match(file.ciTip.error, /ENOENT|not found|spawn gh/i);
  assert.strictEqual(file.engine.ok, true);
});

test('AC 2: nothing since the tag → unreleased empty, proposedVersion degrades, exit 0', () => {
  const { file } = pack(fixture('pr-first', { feat: false }));
  assert.deepStrictEqual(file.unreleased.value.commits, []);
  assert.strictEqual(file.proposedVersion.ok, false);
  assert.match(file.proposedVersion.error, /nothing to release/);
});

test('AC 8: local-merge yields the same unreleased/proposedVersion shape; releasePr none, ciTip n/a', () => {
  const { file } = pack(fixture('local-merge'));
  assert.strictEqual(file.proposedVersion.value.version, '1.3.0');
  assert.strictEqual(file.unreleased.value.commits[0].type, 'feat');
  assert.strictEqual(file.releasePr.value, 'none');
  assert.strictEqual(file.ciTip.value, 'n/a');
  assert.strictEqual(file.hook.value, false);
});
