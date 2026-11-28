// tests/hooks-worktree-local-fallback-disclosure.test.js
//
// Review finding (whole-branch review, e90376a4..HEAD): resolveRunArg()'s
// #280 worktree-local-fallback disclosure (see
// tests/hooks-run-arg-anchoring.test.js's own #280 cases for record-worktree)
// was wired at only 1 of 7 call sites. CLI-level coverage that the other 6
// (record-pr, spec-status, close-run, teardown-run, archive-run,
// check-resume-freshness) now print the same disclosure line when --run
// resolves via the worktree-local fallback. In-process (#5376): close-run's and
// archive-run's script-entry smoke tests are in tests/archive-run-verb.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf, hookEnv } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');

const HOOKS_JS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

async function runHooks(cmd, args, cwd) {
  // #1270/#1130: neutralize any ambient PIPELINE_RUN_DIR (present in every
  // /flow-dispatched shell) so this call can't silently resolve against a
  // real run dir it never named.
  const r = await runCli(HOOKS_JS, [cmd, ...args], {
    cwd, env: hookEnv(),
  });
  return { code: r.code, stdout: r.stdout };
}

// A worktree-local run dir that's INITIALIZED (has a marker file) and has no
// main-checkout counterpart — the exact condition resolveRunArg's #280
// fallback adopts, per hooks-run-arg-anchoring.test.js.
function trappedInitializedRunDir(wt, runId) {
  const dir = path.join(wt, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  return dir;
}

const CASES = [
  { cmd: 'record-pr', extraArgs: (trapped) => ['--run', trapped, '5', 'https://example.com/pr/5'] },
  { cmd: 'spec-status', extraArgs: (trapped) => ['--run', trapped] },
  { cmd: 'close-run', extraArgs: (trapped) => ['--run', trapped] },
  { cmd: 'teardown-run', extraArgs: (trapped) => ['--run', trapped] },
  { cmd: 'archive-run', extraArgs: (trapped) => ['--run', trapped] },
  { cmd: 'check-resume-freshness', extraArgs: (trapped) => ['--run', trapped] },
];

for (const { cmd, extraArgs } of CASES) {
  // #5376 injected-value proof: fails when spec-status reads process.cwd() instead of the injected cwd (the spec-status case)
  test(`#280: ${cmd} discloses the worktree-local fallback`, async () => {
    const main = gitRepo();
    const wt = linkedWorktreeOf(main);
    const trapped = trappedInitializedRunDir(wt, `2026-01-01T000000-${cmd}-280`);
    const out = await runHooks(cmd, extraArgs(trapped), wt);
    assert.match(out.stdout, /worktree-local fallback \(#280\)/i);
  });
}
