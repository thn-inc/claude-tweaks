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
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { shellQuote } = require('./helpers/shell-quote');

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
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('AC: the same mkdir under the main checkout is allowed', () => {
  const main = gitRepo();
  const target = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, main), runDir: null, runState: null, cwd: main });
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
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
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
  const out = pre.run({ input: bashInput(`cp source.md ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
  assertDenied(out);
});

// --- #2282: this deny previously left no friction-event trace at all. A
// `session_id` on the input is required for stampAdHocRunDirForDenial to
// mint a run dir to log into (bin/lib/hooks/context.js) — the other tests
// above omit it deliberately (appendEvent(null, ...) is then a documented
// no-op), so these two are the only ones in this file that need it.

test('#2282: a denied mkdir logs a wd-guard-refusal event (reason: shadow-run-dir) to a stamped ad-hoc run dir', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', 'x');
  const input = { ...bashInput(`mkdir -p ${shellQuote(target)}`, wt), session_id: 'sess-2282-shadow' };
  const out = pre.run({ input, runDir: null, runState: null, cwd: wt });
  assertDenied(out);
  const pipelinesDir = path.join(main, '.claude-tweaks', 'pipelines');
  const adhocDirs = fs.readdirSync(pipelinesDir).filter((d) => d.endsWith('-adhoc-standalone'));
  assert.strictEqual(adhocDirs.length, 1, 'expected exactly one stamped ad-hoc run dir');
  const events = fs.readFileSync(path.join(pipelinesDir, adhocDirs[0], 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const hit = events.find((e) => e.type === 'wd-guard-refusal');
  assert.ok(hit, 'expected a wd-guard-refusal event, got: ' + JSON.stringify(events));
  assert.strictEqual(hit.reason, 'shadow-run-dir');
  assert.strictEqual(path.resolve(hit.path), path.resolve(target));
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
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
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
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
  assertAllowed(out);
});

test('#1778 AC: mkdir -p of {id}-tidy-standalone/staged, run dir absent, is allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-tidy-standalone', 'staged');
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
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
  const out = pre.run({ input: bashInput(`cp source.md ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt });
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

// --- #4303: past the shell scanner's cwd cap the walk has lost the cwd bash is in, and a target it
// resolves from there carries `lost: true` with its text as written (`rel`). Its directory is
// unknown, so a lost target whose text names a `.claude-tweaks/pipelines` segment is denied. The
// fixture: a main checkout with two linked worktrees side by side, the session's (`wt`) and another
// (`wt2`), as siblings in one parent or nested at `.claude/worktrees/{x,y}`. No policy file exists:
// this guard is unconditional. `groups(n)` is n groups `{ cd /tmp/ct-4303-nK; }`; no such directory
// exists, so every cd fails and bash stays where it started.
const groups =(n) => Array.from({ length: n }, (_, i) => `{ cd /tmp/ct-4303-n${i}; }; `).join('');
// The sibling-layout parents twoWorktrees4303 creates, removed once the file's tests have run.
const SIBLING_PARENTS_4303 = [];
after(() => { for (const dir of SIBLING_PARENTS_4303) fs.rmSync(dir, { recursive: true, force: true }); });
function twoWorktrees4303({ nested }) {
  const main = gitRepo();
  const parent = nested ? path.join(main, '.claude', 'worktrees') : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4303-sh-')));
  if (!nested) SIBLING_PARENTS_4303.push(parent);
  const wt = path.join(parent, nested ? 'x' : 'wt');
  const wt2 = path.join(parent, nested ? 'y' : 'wt2');
  for (const w of [wt, wt2]) fixtureGit(['-C', main, 'worktree', 'add', '-q', w]);
  fs.mkdirSync(path.join(wt, 'sub'));
  return { wt, wt2, name: path.basename(wt), name2: path.basename(wt2) };
}

// Bash 3.2 and 5, run from wt, create a shadow run dir for each (nested and sibling alike):
//   S2   wt/.claude-tweaks/pipelines/2026-x      S2g, S1, S1d, S3, S3s   wt2/.claude-tweaks/pipelines/2026-x
// Base d9aa6b82d denies each; an earlier revision of this branch clamped the `../` under the start
// (wt/wt/… or wt/wt2/…, inside no pipelines dir) and allowed each. In S3 and S3s the
// segment is spelled by the relative cds before the mkdir, which the lost cwd's trail keeps.
test('#4303: past the cwd cap, a relative shadow run dir named through `../` is denied', () => {
  for (const nested of [true, false]) {
    const { wt, name, name2 } = twoWorktrees4303({ nested });
    for (const [shape, command] of [
      ['S2', `${groups(16)}mkdir -p ../${name}/.claude-tweaks/pipelines/2026-x`],
      ['S2g', `${groups(16)}mkdir -p ../${name2}/.claude-tweaks/pipelines/2026-x`],
      ['S1', `${groups(20)}mkdir -p ../${name2}/.claude-tweaks/pipelines/2026-x`],
      ['S1d', `${groups(20)}cd sub; mkdir -p ../../${name2}/.claude-tweaks/pipelines/2026-x`],
      ['S3', `${groups(20)}cd ../${name2}/sub/../.claude-tweaks/pipelines && mkdir 2026-x`],
      ['S3s', `${groups(20)}cd ../${name2}; cd .claude-tweaks; { cd pipelines; }; mkdir 2026-x`],
    ]) {
      const out = pre.run({ input: bashInput(command, wt), runDir: null, runState: null, cwd: wt });
      assertDenied(out);
      assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /more ways than the hook's shell scanner follows/, `${shape} nested=${nested}`);
    }
  }
});

// #4303: an && chain of 16 cds (`cd /tmp/ct-4303-aK && …`, every aK present so each succeeds),
// then `cd wt/sub; mkdir -p ../../wt2/.claude-tweaks/pipelines/2026-x`: bash 3.2 and 5 create
// wt2/.claude-tweaks/pipelines/2026-x (nested and sibling alike). The list's end joins past the cap
// and drops the absolute `cd`. Base d9aa6b82d denies; earlier revisions of this branch allowed it.
// Skipped on win32: the command splices the native temp path.
test('#4303: past the cwd cap, a shadow run dir in another worktree after an && chain is denied', {
  skip: process.platform === 'win32' && 'win32: the command splices a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const chain = Array.from({ length: 16 }, (_, i) => `cd /tmp/ct-4303-a${i + 1} && `).join('');
  for (const nested of [true, false]) {
    const { wt, name2 } = twoWorktrees4303({ nested });
    assertDenied(pre.run({ input: bashInput(`${chain}cd ${wt}/sub; mkdir -p ../../${name2}/.claude-tweaks/pipelines/2026-x`, wt), runDir: null, runState: null, cwd: wt }));
  }
});

// #4303: the segment is matched ignoring case (deliberate fail-closed tradeoff): on a case-insensitive
// volume (APFS here), with wt2/.claude-tweaks/pipelines present, bash 3.2 and 5 create the run dir
// wt2/.claude-tweaks/pipelines/2026-x for `.Claude-Tweaks/Pipelines/2026-x`. Base d9aa6b82d denies;
// an earlier revision of this branch allowed it.
test('#4303: past the cwd cap, a lost shadow run dir is denied whatever the segment\'s case', () => {
  const { wt, name2 } = twoWorktrees4303({ nested: false });
  assertDenied(pre.run({ input: bashInput(`${groups(20)}mkdir -p ../${name2}/.Claude-Tweaks/Pipelines/2026-x`, wt), runDir: null, runState: null, cwd: wt }));
});

// #4303: a second collapse keeps the segment spelled before it. With
// wt2/.claude-tweaks/pipelines present, `G16 cd ../wt2/.claude-tweaks/pipelines; G16 mkdir 2026-x`
// (A2r; A2rw adds `&& echo x > 2026-x/decisions.md`): bash 3.2 and 5 create
// wt2/.claude-tweaks/pipelines/2026-x (and decisions.md in it), nested and sibling alike. An
// earlier revision of this branch restarted the lost cwd's trail at the second collapse and
// allowed both, as did base d9aa6b82d.
test('#4303: past a second cwd-cap collapse, a shadow run dir named before it is denied', () => {
  for (const nested of [true, false]) {
    const { wt, wt2, name2 } = twoWorktrees4303({ nested });
    fs.mkdirSync(path.join(wt2, '.claude-tweaks', 'pipelines'), { recursive: true });
    for (const [shape, tail] of [['A2r', 'mkdir 2026-x'], ['A2rw', 'mkdir 2026-x && echo x > 2026-x/decisions.md']]) {
      const out = pre.run({ input: bashInput(`${groups(16)}cd ../${name2}/.claude-tweaks/pipelines; ${groups(16)}${tail}`, wt), runDir: null, runState: null, cwd: wt });
      assertDenied(out);
      assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /more ways than the hook's shell scanner follows/, `${shape} nested=${nested}`);
    }
  }
});

// #4303: from a session cwd inside an existing run dir, wt/.claude-tweaks/pipelines/2026-old,
// `G16 mkdir ../2026-x` (every cd failing): bash 3.2 and 5 create the new run dir
// wt/.claude-tweaks/pipelines/2026-x, nested and sibling alike. Its text names no segment, and the
// lost cwd's stand-in clamped it under the start (2026-old/2026-x, no new run dir): earlier
// revisions of this branch allowed it. Base d9aa6b82d denies, reading it from the start; that
// reading (the scanner marks the target `reading: true`) is now checked as an ordinary target.
test('#4303: past the cwd cap, a run dir made beside the session\'s own run dir is denied by base\'s reading', () => {
  for (const nested of [true, false]) {
    const { wt } = twoWorktrees4303({ nested });
    const cwd = path.join(wt, '.claude-tweaks', 'pipelines', '2026-old');
    fs.mkdirSync(cwd, { recursive: true });
    const out = pre.run({ input: bashInput(`${groups(16)}mkdir ../2026-x`, cwd), runDir: null, runState: null, cwd });
    assertDenied(out);
    assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /a NEW pipeline run directory inside a linked worktree/, `nested=${nested}`);
  }
});

// #4303: a lost target whose text names no pipelines segment is not this guard's concern (bash 3.2
// and 5 create wt2/build), and with no worktree-always policy no other gate denies it, as at every
// version.
test('#4303: past the cwd cap, a lost target that names no pipelines segment is not denied by the shadow guard', () => {
  const { wt, name2 } = twoWorktrees4303({ nested: false });
  assertAllowed(pre.run({ input: bashInput(`${groups(20)}mkdir -p ../${name2}/build`, wt), runDir: null, runState: null, cwd: wt }));
});

// #4303: the guard skips git for a candidate whose real path names no `.claude-tweaks/pipelines`
// segment, so the segment is read off the real path, through any link, never the text. With wt2/p a
// link to wt2/.claude-tweaks/pipelines, `mkdir -p wt2/p/2026-x`: bash 3.2 and 5 create the run dir
// wt2/.claude-tweaks/pipelines/2026-x (nested and sibling alike), and base d9aa6b82d denies it
// too. Skipped on win32: a symlink there needs a privilege, and the
// command splices the native temp path.
test('#4303: a new run dir made through a link into a linked worktree\'s pipelines dir is denied', {
  skip: process.platform === 'win32' && 'win32: symlink creation needs a privilege, and the command splices a native temp path',
}, () => {
  for (const nested of [true, false]) {
    const { wt, wt2 } = twoWorktrees4303({ nested });
    fs.mkdirSync(path.join(wt2, '.claude-tweaks', 'pipelines'), { recursive: true });
    fs.symlinkSync(path.join(wt2, '.claude-tweaks', 'pipelines'), path.join(wt2, 'p'));
    const out = pre.run({ input: bashInput(`mkdir -p ${wt2}/p/2026-x`, wt), runDir: null, runState: null, cwd: wt });
    assertDenied(out);
    assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /a NEW pipeline run directory inside a linked worktree/, `nested=${nested}`);
  }
});

// --- #3769: the injected fsImpl reaches every probe in shadowPipelineRunDir ---
// The fake models a case-insensitive volume whose canonical spelling of the
// worktree (`WT`) differs from the real one (`wt`). The pipelines root, the
// target and the existence probe must all resolve through it: leave any one on
// the real fs and the relative-path comparison (or the probe) disagrees.
const { caseInsensitiveFs } = require('./helpers/case-insensitive-fs');
const POSIX_ONLY = process.platform === 'win32' && 'posix-only case-insensitive fake: path.resolve/join rewrite its literal paths on win32';

function shadowFixture3769(extraEntries = {}) {
  const wt = linkedWorktreeOf(gitRepo());
  const canon = path.join(path.dirname(wt), path.basename(wt).toUpperCase());
  const pipelines = path.join(canon, '.claude-tweaks', 'pipelines');
  const fsImpl = caseInsensitiveFs({
    [canon]: 'dir',
    [path.join(canon, '.claude-tweaks')]: 'dir',
    [pipelines]: 'dir',
    ...Object.fromEntries(Object.entries(extraEntries).map(([rel, kind]) => [path.join(pipelines, rel), kind])),
  });
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-5');
  return { wt, fsImpl, target };
}

test('#3769: a NEW run directory is still denied when every probe resolves through an injected case-insensitive fsImpl', { skip: POSIX_ONLY }, () => {
  const { wt, fsImpl, target } = shadowFixture3769();
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt }, { fsImpl });
  assertDenied(out);
});

test('#3769: a run directory that exists only on the injected fsImpl counts as existing (allowed)', { skip: POSIX_ONLY }, () => {
  const { wt, fsImpl, target } = shadowFixture3769({ '2026-01-01T000000-spec-5': 'dir' });
  const out = pre.run({ input: bashInput(`mkdir -p ${shellQuote(target)}`, wt), runDir: null, runState: null, cwd: wt }, { fsImpl });
  assertAllowed(out);
});
