'use strict';
// tests/friction-main-checkout-denial-coverage.test.js — record #2543: "a
// gate denial incurred in the main checkout, before any pipeline run dir
// exists, is never logged." #2351 (PR #2374, already merged before this
// record was filed) added context.js's stampAdHocRunDirForDenial, keyed on
// whatever `git worktree list` resolves cwd to — the main checkout
// included, unlike the older EnterWorktree/worktree-only stampAdHocRunDir.
// This is the end-to-end confirmation record #2543 Deliverable 3 asked for:
// not just "the denial gets stamped somewhere" (tests/hooks-dispatcher.test.js
// already covers that half) and not just "a sibling run dir's events get
// unioned" (tests/friction-events-cli.test.js already covers that half with
// synthetic fixtures) — but the full round trip, both halves wired together,
// reproducing the record's own repro steps: a denial in the main checkout
// with no run dir owned yet, followed by a SEPARATE run dir created later in
// the same session, queried via the real friction-events.js CLI.
//
// This is a CONFIRMATORY test, not a red-to-green regression test: #2351's
// fix already shipped before this record was filed (confirmed by reading
// bin/lib/hooks/context.js's stampAdHocRunDirForDenial and its wiring into
// pre-tool-use.js's checkWorktreeRequired), so it is green from the moment
// it is added. Record #2543 closes citing this confirmation rather than
// shipping new production code — see its commit message for the full
// citation and the one remaining gap this record's own work closes
// (reflect/full-mode.md's Friction Lens section not yet documenting this
// mechanism, since it predates #2351 and still only described the
// EnterWorktree/worktree-only path).
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const FRICTION_EVENTS = path.join(__dirname, '..', 'plugin', 'bin', 'friction-events.js');

function runHook(args, { input = '', cwd, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      // CT_HOOKS_TEST_MODE deliberately UNSET (not '1') here — unlike
      // hooks-dispatcher.test.js's own runHook default, this test needs an
      // UNTAGGED gate-denial event, since friction-events.js's readEvents
      // drops test:true-tagged events by design (#1337) and a tagged event
      // would make this test pass vacuously (an empty result either way).
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '', ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function runFrictionEvents(args, { cwd } = {}) {
  const stdout = execFileSync('node', [FRICTION_EVENTS, ...args], { cwd, encoding: 'utf8' });
  return JSON.parse(stdout);
}

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-friction-mainchk-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  return fs.realpathSync(dir);
}

function writeWorktreeAlwaysPolicy(project) {
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
}

test('#2543: a main-checkout gate denial with no owned run dir is retrievable by a later run dir created in the same session', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);

  // Step 1 (record's repro step 1-2): the session works in the main
  // checkout, no pipeline run dir exists yet, and it trips a real gate
  // denial — this record used "git push origin develop" as its example;
  // a worktree-always Write-outside-worktree deny exercises the identical
  // ownedRun.dir === null / stampAdHocRunDirForDenial code path
  // (checkWorktreeRequired, pre-tool-use.js) without needing a real git
  // remote fixture.
  const target = path.join(project, 'a.txt');
  const denyResult = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target }, session_id: 'repro-session-2543' }),
    cwd: project,
  });
  assert.strictEqual(denyResult.code, 0);
  assert.match(denyResult.stdout, /"permissionDecision":"deny"/, 'the write must actually be denied for this repro to be meaningful');

  const pipelinesDir = path.join(project, '.claude-tweaks', 'pipelines');
  const preExistingRunDirs = fs.readdirSync(pipelinesDir);
  assert.strictEqual(preExistingRunDirs.length, 1, 'exactly one ad-hoc run dir should exist after the denial, before any wrap-up run');

  // Step 2 (record's repro step 3): later in the SAME session, a standalone
  // /claude-tweaks:wrap-up creates its own fresh run dir — a sibling of the
  // ad-hoc stamp, not the same directory.
  const laterRunDir = fs.mkdtempSync(path.join(pipelinesDir, '2026-10-02T000000-friction-repro-standalone-'));

  // Step 3 (record's repro step 4): the Friction lens's actual input command.
  const events = runFrictionEvents(['--run', laterRunDir, '--worktree', project]);

  const denialEvents = events.filter((e) => e.type === 'gate-denial');
  assert.strictEqual(denialEvents.length, 1, `expected the main-checkout denial to be retrievable from the later run dir; got: ${JSON.stringify(events)}`);
  assert.strictEqual(denialEvents[0]._source, 'adhoc');
  assert.strictEqual(denialEvents[0].tool, 'Write');
});

test('#2543 control: a frictionless session (no denial) still reports [] from the later run dir — nothing is manufactured', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  // No denial-producing call at all this time.
  const pipelinesDir = path.join(project, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(pipelinesDir, { recursive: true });
  const laterRunDir = fs.mkdtempSync(path.join(pipelinesDir, '2026-10-02T000000-friction-repro-standalone-'));

  const events = runFrictionEvents(['--run', laterRunDir, '--worktree', project]);
  assert.deepStrictEqual(events, []);
});
