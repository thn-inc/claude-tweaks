'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveConditions } = require('../../../plugin/bin/lib/compose-context/resolve-conditions');

// Fixture: a fake main checkout (repoRoot) and a run dir under it. Files are
// written only when the test needs them, so "absent" cases are real absences.
function fixture({ policy, config, claudeMd } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-rc-'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  if (policy != null) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  if (config != null) fs.writeFileSync(path.join(runDir, 'config.yml'), config);
  if (claudeMd != null) fs.writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd);
  return { root, runDir };
}

const ghPresent = (cmd) => { if (cmd !== 'gh') throw new Error('unexpected ' + cmd); return 'gh version 2.0.0\n'; };
const ghAbsent = (cmd) => {
  if (cmd !== 'gh') throw new Error('unexpected ' + cmd);
  const e = new Error('spawnSync gh ENOENT'); e.code = 'ENOENT'; throw e;
};

test('fully-resolved run: every key resolves from config.yml/policy.yml/CLAUDE.md and gh presence; unresolved is empty', () => {
  const { root, runDir } = fixture({
    policy: 'autonomy: unattended\nworktree-always: true\n',
    config: 'mode: auto\nintegration-model: pr-first\n',
    claudeMd: '# x\n\nwork-backend: github-issues\nwork-types: labels\n',
  });
  const calls = [];
  const { conditions, unresolved } = resolveConditions({ runDir, repoRoot: root }, {
    execFileSync: (cmd, args) => { calls.push([cmd, ...args]); return ghPresent(cmd); },
  });
  assert.deepEqual(conditions, {
    'integration-model': 'pr-first', mode: 'auto', attendance: 'headless',
    transport: 'gh', 'worktree-policy': 'always', 'work-backend': 'github-issues',
  });
  assert.deepEqual(unresolved, []);
  assert.deepEqual(calls, [['gh', '--version']]);
});

test('standalone run with no config.yml and no policy.yml: every policy-derived key is unresolved, transport still resolves', () => {
  const { root, runDir } = fixture();
  const { conditions, unresolved } = resolveConditions({ runDir, repoRoot: root }, {
    execFileSync: ghAbsent,
  });
  assert.deepEqual(conditions, {
    'integration-model': 'unresolved', mode: 'unresolved', attendance: 'unresolved',
    transport: 'mcp', 'worktree-policy': 'unresolved', 'work-backend': 'unresolved',
  });
  assert.deepEqual(unresolved, ['integration-model', 'mode', 'attendance', 'worktree-policy', 'work-backend']);
});

test('config.yml present but with no mode: line resolves mode unresolved; an off-vocabulary mode also resolves unresolved', () => {
  const a = fixture({ config: 'scope-creep: add-to-plan\n' });
  assert.equal(resolveConditions({ runDir: a.runDir, repoRoot: a.root }, { execFileSync: ghPresent }).conditions.mode, 'unresolved');
  const b = fixture({ config: 'mode: turbo\n' });
  assert.equal(resolveConditions({ runDir: b.runDir, repoRoot: b.root }, { execFileSync: ghPresent }).conditions.mode, 'unresolved');
});

test('attendance: autonomy supervised/trusted -> attended, unattended -> headless; policy.yml sets it, config.yml overrides it', () => {
  const p = fixture({ policy: 'autonomy: trusted\n' });
  assert.equal(resolveConditions({ runDir: p.runDir, repoRoot: p.root }, { execFileSync: ghPresent }).conditions.attendance, 'attended');
  const o = fixture({ policy: 'autonomy: trusted\n', config: 'autonomy: unattended\n' });
  assert.equal(resolveConditions({ runDir: o.runDir, repoRoot: o.root }, { execFileSync: ghPresent }).conditions.attendance, 'headless');
});

test('worktree-policy: worktree-always true -> always, false -> optional, unset -> unresolved', () => {
  const t = fixture({ policy: 'worktree-always: true\n' });
  assert.equal(resolveConditions({ runDir: t.runDir, repoRoot: t.root }, { execFileSync: ghPresent }).conditions['worktree-policy'], 'always');
  const f = fixture({ policy: 'worktree-always: false\n' });
  assert.equal(resolveConditions({ runDir: f.runDir, repoRoot: f.root }, { execFileSync: ghPresent }).conditions['worktree-policy'], 'optional');
});

test('integration-model: policy.yml pin resolves without any shell-out beyond gh --version', () => {
  const pinned = fixture({ policy: 'integration-model: local-merge\n' });
  const calls = [];
  const result = resolveConditions({ runDir: pinned.runDir, repoRoot: pinned.root }, {
    execFileSync: (cmd, args) => { calls.push(cmd); return ghPresent(cmd); },
  });
  assert.equal(result.conditions['integration-model'], 'local-merge');
  assert.deepEqual(calls, ['gh']);
});

test('integration-model: a config.yml pin wins over a policy.yml pin', () => {
  const { root, runDir } = fixture({
    policy: 'integration-model: local-merge\n',
    config: 'integration-model: pr-first\n',
  });
  assert.equal(resolveConditions({ runDir, repoRoot: root }, { execFileSync: ghPresent }).conditions['integration-model'], 'pr-first');
});

test('work-backend reads the CLAUDE.md line at repoRoot (never the run dir), and a missing or off-vocabulary line is unresolved', () => {
  const ok = fixture({ claudeMd: 'work-backend: local-files\n' });
  assert.equal(resolveConditions({ runDir: ok.runDir, repoRoot: ok.root }, { execFileSync: ghPresent }).conditions['work-backend'], 'local-files');
  const bad = fixture({ claudeMd: 'work-backend: postgres\n' });
  assert.equal(resolveConditions({ runDir: bad.runDir, repoRoot: bad.root }, { execFileSync: ghPresent }).conditions['work-backend'], 'unresolved');
});

test('work-backend is read via parseFlatLines, so a trailing comment on the line still resolves', () => {
  const { root, runDir } = fixture({ claudeMd: 'work-backend: github-issues # default\n' });
  assert.equal(resolveConditions({ runDir, repoRoot: root }, { execFileSync: ghPresent }).conditions['work-backend'], 'github-issues');
});

test('an unreadable-but-present file is a real error surfaced to the caller, not silently read as unresolved', () => {
  const { root, runDir } = fixture({ policy: 'autonomy: trusted\n' });
  const policyPath = path.join(root, '.claude-tweaks', 'policy.yml');
  const readFile = (p, enc) => {
    if (p === policyPath) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
    return fs.readFileSync(p, enc);
  };
  assert.throws(
    () => resolveConditions({ runDir, repoRoot: root }, {
      readFile,
      execFileSync: ghPresent,
    }),
    (err) => err.code === 'EACCES',
  );
});

test('transport is the only shell-out and it is the injected execFileSync — no other command is spawned', () => {
  const { root, runDir } = fixture({ policy: 'autonomy: supervised\nworktree-always: false\n', config: 'mode: hybrid\nintegration-model: pr-first\n', claudeMd: 'work-backend: github-issues\n' });
  const calls = [];
  resolveConditions({ runDir, repoRoot: root }, {
    execFileSync: (cmd, args) => { calls.push(cmd); if (cmd !== 'gh') throw new Error('unexpected ' + cmd); return 'gh version 2\n'; },
  });
  assert.deepEqual(calls, ['gh']);
});
