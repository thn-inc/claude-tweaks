'use strict';
// #2764: pins that the wrap-up skill prose routes every
// verify-expectations.json write a worktree-isolated session can reach
// through bin/set-verify-expectations.js, and executes the one fenced
// snippet that names it (docs/skill-authoring.md's "Executable snippets in
// skill prose" — extract and run).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugin');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
const CLI_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR"';

test('the multi-spec defer protocol writes the deferred shape through the sanctioned writer', () => {
  const appendix = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
  assert.ok(
    appendix.includes(`${CLI_CALL} --deferred design-caches,worktree,ephemeral-server,claim-release,run-dir-archival`),
    'step 4 must name the CLI call with all five deferred items',
  );
});

test('the Review Console names the sanctioned writer for its non-finish-console writes', () => {
  const consoleDoc = read('plugin', 'skills', 'wrap-up', 'review-console.md');
  const calls = consoleDoc.split(CLI_CALL).length - 1;
  assert.ok(calls >= 2, `expected the CLI call in step 11 and in the nothing-to-review fast path, found ${calls}`);
  assert.ok(consoleDoc.includes(`${CLI_CALL} --file`), 'step 11 must name the --file form for memory/upstream');
});

test('pipeline-run-dir.md registers the fourth sanctioned writer in both places it lists the family', () => {
  const doc = read('plugin', 'skills', '_shared', 'pipeline-run-dir.md');
  const mentions = doc.split('bin/set-verify-expectations.js').length - 1;
  assert.ok(mentions >= 2, `expected the tool-level pinning paragraph and the Sanctioned-write CLIs bullet to name it, found ${mentions}`);
});

test('no wrap-up skill file still hand-writes verify-expectations.json with fs.writeFileSync', () => {
  const dir = path.join(PLUGIN, 'skills', 'wrap-up');
  const offenders = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => {
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      return body.includes('fs.writeFileSync(') && body.includes('verify-expectations.json');
    });
  assert.deepEqual(offenders, []);
});

test('the Oversight-floor gate snippet in verification-brief.md runs and records the exemption', () => {
  const doc = read('plugin', 'skills', 'wrap-up', 'verification-brief.md');
  const m = /Record the exemption \(#2383\)[\s\S]*?```bash\n([\s\S]*?)```/.exec(doc);
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  const snippet = m[1].trim();
  assert.ok(snippet.includes(`${CLI_CALL} --oversight-exempt {N}`), `unexpected snippet: ${snippet}`);

  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'vexp-conf-'));
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(runDir, 'verify-expectations.json'), JSON.stringify({ version: 1, memory: [], upstream: [], oversightExempt: [7] }));

  const command = snippet.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN).split('{N}').join('42');
  execFileSync('/bin/sh', ['-c', command], { cwd: main, env: { ...process.env, PIPELINE_RUN_DIR: runDir }, encoding: 'utf8' });

  const data = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepEqual(data.oversightExempt, [7, 42]);
  assert.deepEqual(data.memory, []);
});
