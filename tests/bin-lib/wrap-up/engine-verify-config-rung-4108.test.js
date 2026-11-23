const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolvedIssueNumbers } = require('../../../plugin/bin/lib/wrap-up/engine-verify');
const { resolveRecords } = require('../../../plugin/bin/lib/wrap-up/pack');

test('#4108 regression: a config-rung (express) run still falls back to verify-expectations issues', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-config-rung-'));
  const runDir = path.join(root, '2026-11-01T000000-express-41');
  fs.mkdirSync(runDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(runDir, 'config.yml'), 'integration-model: pr-first\nspec: 41\n');
    fs.writeFileSync(path.join(runDir, 'verify-expectations.json'), JSON.stringify({ version: 1, memory: [], upstream: [], issues: [41] }));
    const deps = { readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } }, readFile: (p) => fs.readFileSync(p, 'utf8') };
    assert.strictEqual(resolveRecords(deps, runDir, null).source, 'config', 'fixture must reach the config rung');
    // Before this change the config rung's empty closing set fell through to the
    // expectations file, so carrier-commit verified the express run's PR-body Fixes.
    assert.deepStrictEqual(resolvedIssueNumbers(runDir), [41]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
