// tests/hooks-pipeline-shadow-guard.test.js
//
// #692: the pipeline-shadow guard in pre-tool-use.js — denies a Bash/Write/
// Edit/NotebookEdit call whose target would CREATE a new `.claude-tweaks/
// pipelines/` run directory inside a linked worktree instead of the main
// checkout ([IL-127]'s shape). Unlike the worktree-always gate
// (checkWorktreeRequired), this guard is unconditional: it is not gated on
// `worktree-always` policy, because pipeline run-dir anchoring is a
// plugin-architecture invariant, not a project opt-in.
//
// Deliberately NOT flagged: a write into a run directory that ALREADY EXISTS
// in the worktree — the pre-anchoring shape wrap-up/cleanup-procedures.md
// Section C step 3.5's transitional guard still tolerates (sunset
// 2026-11-07). Only a brand-new creation is denied.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');

const bashInput = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const editInput = (filePath) => ({ tool_name: 'Edit', tool_input: { file_path: filePath } });
const writeInput = (filePath) => ({ tool_name: 'Write', tool_input: { file_path: filePath } });

function assertDenied(out) {
  assert.strictEqual(
    out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision,
    'deny',
    'expected a deny, but got: ' + JSON.stringify(out),
  );
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /resolve-run-dir/);
}

function assertAllowed(out) {
  assert.deepStrictEqual(out, {}, 'expected no deny, but got: ' + JSON.stringify(out));
}

test('AC: mkdir <worktree>/.claude-tweaks/pipelines/x is denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', 'x');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('AC: the same mkdir under the main checkout is allowed', () => {
  const main = gitRepo();
  const target = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, main), runDir: null, runState: null, cwd: main });
  assertAllowed(out);
});

test('a Write into a NEW run directory inside a linked worktree is denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-1', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('an Edit into a NEW run directory inside a linked worktree is denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-2', 'staged', 'review-1.patch');
  const out = pre.run({ input: editInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('a write into a run directory that ALREADY EXISTS in the worktree (pre-anchoring, tolerated) is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const existingRunDir = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-3');
  fs.mkdirSync(existingRunDir, { recursive: true });
  const target = path.join(existingRunDir, 'events.jsonl');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('mkdir of a NEW subdirectory inside an already-existing (pre-anchoring) run directory is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const existingRunDir = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-4');
  fs.mkdirSync(existingRunDir, { recursive: true });
  const target = path.join(existingRunDir, 'staged');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('a write inside the MAIN checkout\'s own pipelines dir (correctly anchored, from a worktree session via absolute path) is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(main, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-5', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('a cp write shape creating a new pipelines run dir file inside a linked worktree is denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-6', 'decisions.md');
  const out = pre.run({ input: bashInput(`cp source.md "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('an unrelated Write inside a linked worktree (outside .claude-tweaks/pipelines/) is unaffected', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, 'src', 'index.js');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

// #959: the one documented worktree-local exception — work/{n}-spec.md — must
// be reachable via a normal Write/Bash mkdir even though the run-id directory
// does not exist yet in the worktree. Before this fix these five cases were
// all denied identically to the "NEW run directory" tests above.

test('#959 AC: a Write of a NEW work/{n}-spec.md into a worktree with no existing run dir is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-959', 'work', '959-spec.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#959 AC: mkdir -p of the work/ directory itself, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-959', 'work');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#959 AC: the multi-record spec-{N}/work/{n}-spec.md shape is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-959-960', 'spec-959', 'work', '959-spec.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#959 negative control: a NEW run dir file named work/notes.md (not {n}-spec.md) is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-959b', 'work', 'notes.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('#959 negative control: a NEW run dir file one level below work/ (work/sub/959-spec.md) is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-959c', 'work', 'sub', '959-spec.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('#959 negative control: a NEW run dir file elsewhere (decisions.md) is still denied even though work/ is exempt', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-959d', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

// #1493/#1494: the second documented worktree-local exception — a
// `*-tidy-standalone*`/`*-sweep-standalone*` run's decisions.md/report.md/
// staged/** must be reachable via a normal Write/Bash mkdir/cp even though
// the run-id directory does not exist yet in the worktree, mirroring
// tidy/step-7-5-worktree-always.md's pr-first mirror-then-commit procedure.

test('#1778 AC: mkdir -p of {id}-sweep-standalone/staged, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-sweep-standalone', 'staged');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 AC: mkdir -p of {id}-tidy-standalone/staged, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-tidy-standalone', 'staged');
  const out = pre.run({ input: bashInput(`mkdir -p "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 AC: a Write of {id}-sweep-standalone/decisions.md, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-sweep-standalone', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 AC: a cp of report.md into {id}-sweep-standalone, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-sweep-standalone', 'report.md');
  const out = pre.run({ input: bashInput(`cp source.md "${target}"`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 AC: a Write under staged/ ({id}-tidy-standalone/staged/tidy-close-issue-1.md), run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-tidy-standalone', 'staged', 'tidy-close-issue-1.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 negative control: config.yml inside a NEW {id}-sweep-standalone run dir is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-sweep-standalone', 'config.yml');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('#1778 negative control: context/records.json inside a NEW {id}-sweep-standalone run dir is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-sweep-standalone', 'context', 'records.json');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('#1778 negative control: decisions.md under a plain non-standalone run dir name is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-42', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

test('#1778 negative control: a standalone-named directory nested under spec-*/ is still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-multi', 'spec-1-sweep-standalone', 'decisions.md');
  const out = pre.run({ input: writeInput(target), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});
