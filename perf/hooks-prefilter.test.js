// Bash hook prefilter skip-path budget (#3074) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// hooks.json registers ONE unconditional Bash handler per tool-use event, so
// EVERY Bash tool call now spawns `sh bin/hooks.sh` -> `exec node bin/hooks.js`
// twice (pre + post; the launcher #5392 finds node, then execs hooks.js). What keeps
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

const { findOnPath } = require('../tests/helpers/path-stub');

const SH = findOnPath('sh');
// The spelling every registration uses: the launcher path always ends in /bin/hooks.sh.
const LAUNCHER = path.join(__dirname, '..', 'plugin') + '/bin/hooks.sh';
const hookOpts = (input) => ({
  input, cwd: REPO, env: { ...process.env, PIPELINE_RUN_DIR: '' }, stdio: ['pipe', 'pipe', 'pipe'],
});

// The control stays bare node, so both assertions below include the launcher's cost.
const runControl = () => execFileSync('node', ['-e', ''], { cwd: REPO });
// What a registration spawns: sh -> exec node hooks.js.
const runHook = (input) => execFileSync(SH, [LAUNCHER, 'pre-tool-use'], hookOpts(input));
// hooks.js without the launcher; reported only, so a breach shows the launcher's share.
const runDirect = (input) => execFileSync('node', [HOOKS, 'pre-tool-use'], hookOpts(input));

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
  // Through the launcher (#5392; measured once, separate run; macOS darwin, Node v26.13.1, idle, best of 15):
  // control 26.4ms, skip 35.6ms, full 51.5ms, direct (node hooks.js, no launcher)
  // 33.2ms, so the launcher's own share is ~2.4ms and skipCost 9.2 < fullCost 25.1 / 2.
  assert.ok(SH, 'sh not found on PATH: the launcher timing spawns sh bin/hooks.sh');
  let control = Infinity;
  let skip = Infinity;
  let full = Infinity;
  let direct = Infinity;
  for (let i = 0; i < 15; i += 1) {
    control = Math.min(control, time(runControl));
    skip = Math.min(skip, time(() => runHook(SKIP_PAYLOAD)));
    full = Math.min(full, time(() => runHook(FULL_PAYLOAD)));
    direct = Math.min(direct, time(() => runDirect(SKIP_PAYLOAD)));
  }
  const skipCost = skip - control;
  const fullCost = full - control;
  const launcherShare = `launcher share (skip - direct) ${(skip - direct).toFixed(1)}ms; control ${control.toFixed(1)}ms, direct ${direct.toFixed(1)}ms`;
  assert.ok(
    skipCost < fullCost / 2,
    `skip path cost ${skipCost.toFixed(1)}ms is not under half the full path cost ${fullCost.toFixed(1)}ms `
    + `- the early exit may no longer be skipping the heavy requires (${launcherShare})`,
  );
  assert.ok(skipCost < 60, `skip path cost ${skipCost.toFixed(1)}ms above bare Node exceeds the 60ms ceiling (${launcherShare})`);
});
