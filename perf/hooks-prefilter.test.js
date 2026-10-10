// Bash hook prefilter skip-path budget (#3074) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// hooks.json registers ONE unconditional Bash handler per tool-use event, so
// EVERY Bash tool call now spawns bin/hooks.js twice (pre + post). What keeps
// that affordable is the skip path: bash-prefilter.js decides before
// bin/hooks.js's heavy requires load. This pins that the skip path stays a thin
// layer over bare Node startup. Lives outside tests/ for the same reason
// perf/statusline-render.test.js does (wall-clock under sibling-suite load).
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.resolve(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-perf-prefilter-'));
// A fresh, non-policy git repo: the full-path payload (`git commit -m x`) makes the
// hook evaluate the commit, but nothing is committed. Never the claude-tweaks repo.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-perf-prefilter-repo-'));
execFileSync('git', ['init', '-q', REPO]);

after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.rmSync(REPO, { recursive: true, force: true });
});

const payload = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO });
const SKIP_PAYLOAD = payload('echo hi');
const FULL_PAYLOAD = payload('git commit -m x');

const runControl = () => execFileSync('node', ['-e', ''], { cwd: REPO });
const runHook = (input) => execFileSync('node', [HOOKS, 'pre-tool-use'], {
  input, cwd: REPO, env: { ...process.env, PIPELINE_RUN_DIR: '' }, stdio: ['pipe', 'pipe', 'pipe'],
});

const time = (fn) => {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

test('bin/hooks.js skip path is a thin layer: well under the full path, under an absolute ceiling', () => {
  // Budget basis (machine-specific: 16-core Windows box, Node 24, idle, best of 30):
  // bare `node -e ""` 54.8ms, skip path (`echo hi`) 57.8ms, full path (`git commit -m x`,
  // heavy requires + policy load) 106.5ms. So the skip path's own share is ~3ms and
  // the full path's is ~52ms. Absolute milliseconds drift with load, so the
  // discriminating assertion is the RATIO skipCost < fullCost / 2, which is
  // load-independent: each attempt runs an interleaved control/skip/full triplet, so
  // drift hits all three alike, and each series keeps its minimum over 15 attempts (a
  // min of per-attempt differences would let one slow control sample go negative). If the
  // early exit is disabled, skip pays the heavy requires too and skip ~ full, which
  // fails the ratio. The absolute ceiling (60ms) only catches a gross regression.
  let control = Infinity;
  let skip = Infinity;
  let full = Infinity;
  for (let i = 0; i < 15; i += 1) {
    control = Math.min(control, time(runControl));
    skip = Math.min(skip, time(() => runHook(SKIP_PAYLOAD)));
    full = Math.min(full, time(() => runHook(FULL_PAYLOAD)));
  }
  const skipCost = skip - control;
  const fullCost = full - control;
  assert.ok(
    skipCost < fullCost / 2,
    `skip path cost ${skipCost.toFixed(1)}ms is not under half the full path cost ${fullCost.toFixed(1)}ms `
    + '- the early exit may no longer be skipping the heavy requires',
  );
  assert.ok(skipCost < 60, `skip path cost ${skipCost.toFixed(1)}ms above bare Node exceeds the 60ms ceiling`);
});
