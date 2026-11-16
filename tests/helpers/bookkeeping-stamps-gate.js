// tests/helpers/bookkeeping-stamps-gate.js
// Fixtures shared by the tests/hooks-bookkeeping-stamps-gate*.test.js parts.
// Not a test file (no .test.js suffix), so node --test never runs it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

// Every test's run dir basename AND every materialize commit's path segment.
// The sentinel is scoped to the run's own id (whole-branch review C1+C2), so a
// mismatch between these two would make a test assert the wrong thing.
const RUN_ID = '2026-08-22T061958-record-991';

// Commits at the CANONICAL materialize write location — `{run-dir}/work/{n}-spec.md`,
// where `{run-dir}` is `.claude-tweaks/pipelines/{run-id}` (flow/materialize.md;
// in worktree mode, the worktree-local mirror of that same relative path).
// `tailPath` is the run-dir-relative tail: `work/{n}-spec.md` for a single-record
// run, `spec-{slug}/work/{n}-spec.md` for the multi-record shape.
function commitMaterializedSpec(wt, tailPath, runId = RUN_ID) {
  const relPath = path.join('.claude-tweaks', 'pipelines', runId, tailPath);
  const abs = path.join(wt, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '---\nrecord: 1\n---\nbody\n');
  execFileSync('git', ['-C', wt, 'add', '-f', relPath]);
  execFileSync('git', ['-C', wt, 'commit', '-m', 'Materialize spec', '-q']);
}

// A throwaway stand-in for the MAIN checkout that a run dir is anchored to —
// deliberately not the fixture git repo, so a test that anchors the run dir
// outside the worktree it enforces in says so by passing `main` instead.
function projectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
}

// appendEvent flattens `data` onto the event object (see context.js's
// appendEvent and tests/hooks-dispatcher.test.js's events[0].tool/path
// precedent) — there is no nested `.data` key, unlike the brief's literal
// text for the assertions below.
function readEvents(run) {
  return fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function mkRunDir(project, worktree, sessionId, extra) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(run, { recursive: true });
  const state = { status: 'active', ...(worktree ? { worktree } : {}), ...(sessionId !== undefined ? { sessionId } : {}), ...extra };
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { run, state };
}

const editInput = (filePath) => ({ tool_name: 'Edit', tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' } });
const bashInput = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

// #4830 fixture: the fixture's main repo gets an origin remote so detection
// reaches the `gh` probe instead of returning `local-merge` at the git-remote step.
function degradeMemoFixture() {
  const main = gitRepo();
  execFileSync('git', ['-C', main, 'remote', 'add', 'origin', 'https://github.com/o/n.git']);
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  return { wt, project };
}
const readRunState = (run) => JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));

module.exports = {
  degradeMemoFixture,
  readRunState,
  gitRepo,
  linkedWorktreeOf,
  RUN_ID,
  commitMaterializedSpec,
  projectDir,
  readEvents,
  mkRunDir,
  editInput,
  bashInput,
};
