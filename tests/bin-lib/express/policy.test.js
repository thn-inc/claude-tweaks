'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { STUB_SKIP } = require('../../helpers/path-stub');
const { fakeGh } = require('../../helpers/fake-gh');

const { defaultResolvePolicy } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'policy.js'));

// defaultResolvePolicy reads the repo root from the process cwd (its git seam passes no cwd),
// so the test runs from inside the fixture repo and restores the cwd afterwards.
test('defaultResolvePolicy hands the run config to computeDerivedDefaults: a merge-verification-only read under a run-pinned integration-model never spawns gh (#4578 AC13.1)', { skip: STUB_SKIP }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'express-policy-runpin-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', 'https://github.com/o/n.git');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-31T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'integration-model: local-merge\n');
  const KEY = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
  const savedEnv = process.env[KEY];
  const savedCwd = process.cwd();
  process.env[KEY] = '1000';
  const gh = fakeGh({ first: 'hang' });
  let calls;
  let resolved;
  try {
    process.chdir(root);
    resolved = defaultResolvePolicy(['merge-verification'], { runDir });
    calls = gh.count();
  } finally {
    process.chdir(savedCwd);
    gh.restore();
    if (savedEnv === undefined) delete process.env[KEY]; else process.env[KEY] = savedEnv;
  }
  assert.strictEqual(calls, 0, 'the run pin decides merge-verification before any forge detection');
  assert.strictEqual(resolved['merge-verification'].value, 'off');
});
