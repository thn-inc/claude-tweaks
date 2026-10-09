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

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.resolve(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-perf-prefilter-'));
const SKIP_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: SANDBOX });

const runControl = () => execFileSync('node', ['-e', ''], { cwd: SANDBOX });
const runSkip = () => execFileSync('node', [HOOKS, 'pre-tool-use'], {
  input: SKIP_PAYLOAD, cwd: SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' },
});

function bestOf(attempts, fn) {
  let best = Infinity;
  for (let i = 0; i < attempts; i += 1) {
    const start = Date.now();
    fn();
    best = Math.min(best, Date.now() - start);
  }
  return best;
}

test('bin/hooks.js skip path stays under 30ms above bare-Node startup', () => {
  // Budget basis, measured idle (16-core Windows box, Node 24, best/median of 30):
  // bare `node -e ""` 54.8/73.4ms, skip path (`echo hi`) 57.8/90.1ms, so the skip
  // path's own share is ~3ms best (~17ms median). The full path (`git commit -m x`,
  // heavy requires + policy load) is 106.5/134.2ms, i.e. ~52ms above bare Node.
  // 30ms is ~10x the skip share and sits below the full path's ~52ms, so a
  // regression that makes the skip path pay the heavy requires fails here.
  // Verified to discriminate: replacing the early-exit with `if (false)` in
  // bin/hooks.js fails this assertion (35, 37, 42ms above control over three runs;
  // the margin over 30ms is modest). The first budget, 60ms, was lowered to 30ms
  // because the full path's best-case ~52ms overhead left it too close to pass.
  const control = bestOf(10, runControl);
  const skip = bestOf(10, runSkip);
  const cost = skip - control;
  assert.ok(cost < 30, `skip path cost ${cost}ms above bare Node (${skip}ms absolute, ${control}ms control)`);
});
