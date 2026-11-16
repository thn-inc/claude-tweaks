// tests/hooks-archive-run-1452.test.js
//
// #1452: regression coverage for the two new behaviors landed in
// d90868a63 (plugin/bin/hooks.js + plugin/bin/lib/hooks/context.js), neither
// of which had a prior test:
//
//   1. `archive-run`'s new worktreeLocalFallback + tracked-work early-refusal
//      branch — a worktree-local-fallback-resolved run dir whose work/ is
//      git-tracked (or merely present) can never be `git -C mainRoot mv`ed,
//      so archive-run now detects this upfront and defers instead of running
//      a doomed mv and reporting the misleading generic 'git-mv-failed'.
//   2. `isLiveArchiveTwin()` — resolveRunArg's #280/#1183/#1299 twin check
//      for a worktree-local-fallback candidate now distinguishes a genuinely
//      completed archive twin from a stale 'archiving' claim stub
//      (archiveRunDir's own TTL-bounded lock, context.js's
//      ARCHIVE_CLAIM_TTL_MS) left behind by a prior failed archival attempt.
//      A stale stub must not permanently block every later retry.
//
// In-process (#5376): archive-run's script-entry smoke tests are in
// tests/archive-run-verb.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
// fallback adopts (mirrors hooks-worktree-local-fallback-disclosure.test.js).
function trappedInitializedRunDir(wt, runId) {
  const dir = path.join(wt, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  return dir;
}

test('#1452: archive-run defers (not git-mv-failed) when a worktree-local-fallback run dir has a tracked work/', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = trappedInitializedRunDir(wt, '2026-01-01T000000-worktree-local-work-1452');
  fs.writeFileSync(path.join(trapped, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.mkdirSync(path.join(trapped, 'work'), { recursive: true });
  fs.writeFileSync(path.join(trapped, 'work', '1452-spec.md'), '# spec\n');

  const result = await runHooks('archive-run', ['--run', trapped], wt);

  assert.match(result.stdout, /archival deferred/);
  assert.match(result.stdout, /git mv.*cannot move it across worktree boundaries/s);
  assert.doesNotMatch(result.stdout, /git-mv-failed/);
  // Deferred, not attempted-and-failed — the run dir must stay exactly in place.
  assert.ok(fs.existsSync(path.join(trapped, 'work', '1452-spec.md')));
});

test('#1452: archive-run does not defer a worktree-local-fallback run dir with no work/ (falls through to the normal path)', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = trappedInitializedRunDir(wt, '2026-01-01T000000-worktree-local-nowork-1452');
  fs.writeFileSync(path.join(trapped, 'run-state.json'), JSON.stringify({ status: 'clean' }));

  const result = await runHooks('archive-run', ['--run', trapped], wt);

  assert.doesNotMatch(result.stdout, /archival deferred/);
  // Falls through to the real archival attempt instead of the new #1452
  // early-refusal branch — proving hasTrackedWork (not some earlier gate)
  // is what test 1 above actually exercised. The real attempt then fails
  // for its own unrelated reason (this fixture's work/-less run dir isn't
  // git-tracked in the linked worktree either) — that failure mode isn't
  // what this test pins, only that it isn't the #1452 deferral.
  assert.match(result.stdout, /archival refused/);
});

// #5376 injected-value proof: fails when spec-status reads process.cwd() instead of the injected cwd
test('#1452: a stale "archiving" claim stub at the main-checkout archive twin does not block the worktree-local fallback', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-stale-twin-1452';
  const trapped = trappedInitializedRunDir(wt, runId);

  // Simulate a prior failed archival attempt: archiveRunDir's own claim stub,
  // written before the doomed git mv, now stale (well past the 5-minute TTL).
  const archiveTwin = path.join(main, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archiveTwin, { recursive: true });
  fs.writeFileSync(path.join(archiveTwin, 'run-state.json'), JSON.stringify({
    status: 'archiving',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }));

  const result = await runHooks('spec-status', ['--run', trapped], wt);

  // A genuine twin refuses with "not anchored under the main checkout" and
  // never prints the fallback disclosure. A stale claim must not read as a
  // twin, so the fallback is adopted instead.
  assert.doesNotMatch(result.stdout, /not anchored under the main checkout/);
  assert.match(result.stdout, /worktree-local fallback \(#280\)/i);
});

test('#1452: a fresh (non-stale) "archiving" claim stub at the main-checkout archive twin still blocks the worktree-local fallback', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-fresh-twin-1452';
  const trapped = trappedInitializedRunDir(wt, runId);

  const archiveTwin = path.join(main, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archiveTwin, { recursive: true });
  fs.writeFileSync(path.join(archiveTwin, 'run-state.json'), JSON.stringify({
    status: 'archiving',
    updatedAt: new Date().toISOString(),
  }));

  const result = await runHooks('spec-status', ['--run', trapped], wt);

  assert.match(result.stdout, /not anchored under the main checkout/);
  assert.doesNotMatch(result.stdout, /worktree-local fallback \(#280\)/i);
});
