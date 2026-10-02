'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// End-to-end coverage for #2545: `validate-findings` must record the
// health-state cursor locally only (zero remote pushes), and the new
// `push-cursor` subcommand must be the single point that ships whatever was
// locally accumulated, in exactly one `git push`. Exercised against a REAL
// local bare repo standing in for `origin` — no gh/network credentials
// needed, the same technique tests/bin-lib/harness-health/durable-integration.test.js
// and cli-validate-findings.test.js's seedDurableRuns already use.

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health.js');

function tmpRepoWithOrigin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-push-cursor-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-push-cursor-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
  return { root, bareDir };
}

function remoteHealthStateSha(bareDir) {
  const out = execFileSync('git', ['ls-remote', bareDir, 'health-state'], { encoding: 'utf8' });
  const line = out.trim();
  return line ? line.split(/\s+/)[0] : null;
}

function runValidateFindings(root, extraArgs = []) {
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([]));
  return spawnSync('node', [CLI, 'validate-findings', findingsFile, '--root', root, ...extraArgs], { encoding: 'utf8' });
}

function runPushCursor(root) {
  return spawnSync('node', [CLI, 'push-cursor', '--root', root], { encoding: 'utf8' });
}

function cursorsAtRemote(bareDir) {
  const out = execFileSync('git', ['--git-dir', bareDir, 'show', 'health-state:harness-health/cursors.json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('validate-findings records the cursor locally and pushes nothing to origin', () => {
  const { root, bareDir } = tmpRepoWithOrigin();

  const result = runValidateFindings(root, ['--target', 'skill-a', '--kind', 'skill']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(remoteHealthStateSha(bareDir), null, 'origin must carry no health-state branch at all after a local-only write');
});

test('N sequential validate-findings calls in one row produce zero remote pushes, verified by an unchanged (absent) ref across all N calls', () => {
  const { root, bareDir } = tmpRepoWithOrigin();

  for (const skill of ['skill-a', 'skill-b', 'skill-c']) {
    const result = runValidateFindings(root, ['--target', skill, '--kind', 'skill']);
    assert.strictEqual(result.status, 0, `stderr for ${skill}: ${result.stderr}`);
    assert.strictEqual(remoteHealthStateSha(bareDir), null, `origin ref must stay absent after recording ${skill}`);
  }
});

test('push-cursor against nothing locally recorded is a successful no-op', () => {
  const { root, bareDir } = tmpRepoWithOrigin();

  const result = runPushCursor(root);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.deepStrictEqual(JSON.parse(result.stdout), { pushed: false });
  assert.strictEqual(remoteHealthStateSha(bareDir), null);
});

test('push-cursor ships every locally-accumulated skill in exactly one remote push, carrying all of their cursor data', () => {
  const { root, bareDir } = tmpRepoWithOrigin();

  for (const skill of ['skill-a', 'skill-b', 'skill-c']) {
    const result = runValidateFindings(root, ['--target', skill, '--kind', 'skill']);
    assert.strictEqual(result.status, 0, `stderr for ${skill}: ${result.stderr}`);
  }
  assert.strictEqual(remoteHealthStateSha(bareDir), null, 'precondition: nothing pushed yet');

  const pushResult = runPushCursor(root);
  assert.strictEqual(pushResult.status, 0, `stderr: ${pushResult.stderr}`);
  assert.deepStrictEqual(JSON.parse(pushResult.stdout), { pushed: true });

  const shaAfterPush = remoteHealthStateSha(bareDir);
  assert.ok(shaAfterPush, 'origin must now carry a health-state ref — the one push advanced it from absent to present');

  const cursors = cursorsAtRemote(bareDir);
  for (const skill of ['skill-a', 'skill-b', 'skill-c']) {
    assert.ok(cursors[`skill:${skill}`], `pushed cursors.json must carry ${skill}'s cursor from its local recording`);
    assert.strictEqual(typeof cursors[`skill:${skill}`].lastAuditedMs, 'number');
  }
});

test('a second push-cursor call after one already landed advances the ref again only when something new was recorded locally', () => {
  const { root, bareDir } = tmpRepoWithOrigin();

  runValidateFindings(root, ['--target', 'skill-a', '--kind', 'skill']);
  const first = runPushCursor(root);
  assert.strictEqual(first.status, 0, `stderr: ${first.stderr}`);
  const shaAfterFirstPush = remoteHealthStateSha(bareDir);
  assert.ok(shaAfterFirstPush);

  // Nothing recorded locally since the first push landed — push-cursor must
  // report a clean no-op rather than attempting a redundant push.
  const second = runPushCursor(root);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.deepStrictEqual(JSON.parse(second.stdout), { pushed: false });
  assert.strictEqual(remoteHealthStateSha(bareDir), shaAfterFirstPush, 'ref must not move on a no-op push');

  // A further skill recorded locally, then pushed, must ship in ITS OWN
  // single push (ref advances exactly once more), still carrying skill-a's
  // earlier-pushed cursor alongside the new one.
  runValidateFindings(root, ['--target', 'skill-b', '--kind', 'skill']);
  const third = runPushCursor(root);
  assert.strictEqual(third.status, 0, `stderr: ${third.stderr}`);
  assert.deepStrictEqual(JSON.parse(third.stdout), { pushed: true });
  assert.notStrictEqual(remoteHealthStateSha(bareDir), shaAfterFirstPush, 'ref must advance for the new push');

  const cursors = cursorsAtRemote(bareDir);
  assert.ok(cursors['skill:skill-a'], 'earlier-pushed cursor must survive a later, separate push');
  assert.ok(cursors['skill:skill-b']);
});
