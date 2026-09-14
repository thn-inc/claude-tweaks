// tests/hooks-bookkeeping-stamps-gate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const ctxLib = require('../plugin/bin/lib/hooks/context');

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

test('bookkeeping-stamps gate: no materialize commit yet -> allow (Common Step 1 still in progress)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: materialize commit landed, no run resolved -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: null, runState: null, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: multi-record materialize commit (spec-{slug}/work/{n}-spec.md) also counts as the materialize sentinel -> deny reachable', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('spec-991-995', 'work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'multi-record spec-{slug}/work/{n}-spec.md form must also be recognized as a landed materialize commit');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

// #2571: a multi-spec /flow run's per-spec skill invocations receive
// `$PIPELINE_RUN_DIR` = `{parent}/spec-{N}/` (flow/multi-spec.md's env-var
// table), NOT the parent directory — so `ctx.runDir` passed into this gate is
// the CHILD subdirectory, not the RUN_ID-shaped parent the two tests above
// exercise. Before the fix, `path.basename(childRunDir)` was `spec-991` (no
// ISO-timestamp prefix, never a real run id), so the pathspec built from it
// never matched the real committed path `{parent}/spec-991/work/991-spec.md`
// and the gate stayed permanently disarmed for every multi-spec run.
test('bookkeeping-stamps gate (#2571): a multi-spec per-spec runDir ({parent}/spec-{N}/) still recognizes this spec\'s own materialize commit -> deny reachable', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('spec-991', 'work', '991-spec.md'));
  const { run: parentRun } = mkRunDir(projectDir(), null, undefined);
  const childRunDir = path.join(parentRun, 'spec-991');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: childRunDir, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'a per-spec $PIPELINE_RUN_DIR must still recognize its own committed spec-{N}/work/{n}-spec.md as the materialize sentinel');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (#2571): a multi-spec per-spec runDir does NOT match a SIBLING spec\'s materialize commit', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  // Only spec-995 has materialized so far; this call is on behalf of spec-991.
  commitMaterializedSpec(wt, path.join('spec-995', 'work', '995-spec.md'));
  const { run: parentRun } = mkRunDir(projectDir(), null, undefined);
  const childRunDir = path.join(parentRun, 'spec-991');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: childRunDir, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(out, {}, 'spec-991\'s own gate must not arm off a sibling spec\'s materialize commit');
});

test('bookkeeping-stamps gate (#2571 unit): hasMaterializeCommit resolves a per-spec runDir against its parent\'s run id', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('spec-991', 'work', '991-spec.md'));
  const { run: parentRun } = mkRunDir(projectDir(), null, undefined);
  assert.strictEqual(pre.hasMaterializeCommit(wt, path.join(parentRun, 'spec-991')), true);
  assert.strictEqual(pre.hasMaterializeCommit(wt, path.join(parentRun, 'spec-995')), false);
});

test('bookkeeping-stamps gate (#2571 unit): a spec-{N}-shaped runDir with no run-id-shaped parent falls through unchanged (not misdetected as a multi-spec child)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  // Parent of ".../orphan/spec-991" is "orphan" — not RUN_ID_RE-shaped — so
  // the per-spec branch must not fire; falls through to the ordinary
  // single-record pathspec rooted at "spec-991" itself, which finds nothing
  // (no materialize commit landed anywhere in this fixture).
  const orphanParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-orphan-'));
  assert.strictEqual(pre.hasMaterializeCommit(wt, path.join(orphanParent, 'spec-991')), false);
});

test('bookkeeping-stamps gate: materialize commit landed, run resolved, no worktree stamp -> deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /record-worktree/);
  assert.match(spec.permissionDecisionReason, /IL-131/);
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-worktree'));
});

test('bookkeeping-stamps gate: same deny fires for a Bash git-commit call, not just Edit/Write', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  fs.writeFileSync(path.join(wt, 'other.txt'), 'x'); // staged content for the commit below
  execFileSync('git', ['-C', wt, 'add', 'other.txt']);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: bashInput('git commit -m "unrelated fix"', wt), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result for a Bash git-commit call too');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/);
});

test('bookkeeping-stamps gate: materialize commit landed, run dir resolved but run-state.json never written (record-worktree never ran) -> deny, not allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = projectDir();
  const run = path.join(project, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), '# Auto-Decision Log\n');
  // Deliberately no run-state.json -- mirrors bin/hooks.js's real wiring
  // (`runState = runDir ? ctxLib.readRunState(runDir) : null`), where a
  // resolved-but-uninitialized run dir yields runState === null, not {}.
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: null, cwd: wt });
  assert.ok(out.json, 'expected a deny result -- a landed materialize commit with no run-state.json at all must not be treated as "no run resolved"');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /record-worktree/);
  assert.match(spec.permissionDecisionReason, /IL-131/);
});

test('bookkeeping-stamps gate: materialize commit landed AND worktree stamp present -> allow (pr-first check runs but resolves local-merge, no origin remote on this fixture)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  // No origin remote on this fixture repo -> resolveIntegrationModel resolves
  // 'local-merge' (detectIntegrationModel's own fail-open first check), so the
  // PR-stamp branch (Task 3) never denies here even with runState.pr unset.
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt });
  assert.deepStrictEqual(out, {});
});

// #2526: the claim-stamp branch — mirrors the PR-stamp branch's own test
// shape immediately above/below. Runs strictly before the worktree-stamp
// check in source order, so every fixture below leaves `worktree` unset to
// isolate the claim branch's own verdict from the worktree branch's.
function writeGithubIssuesClaudeMd(wt) {
  fs.writeFileSync(path.join(wt, 'CLAUDE.md'), '# Fixture\n\nwork-backend: github-issues\nwork-types: labels\n');
}

test('bookkeeping-stamps gate (#2526): claim logged -> falls through past the claim branch to the next check (worktree deny), not a claim deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '# Auto-Decision Log\n\n## /flow\n- AUTO 00:00:00 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: git).\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected the NEXT check (worktree stamp, still unsatisfied) to deny');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/, 'must be the worktree deny, not a claim-log deny');
});

test('bookkeeping-stamps gate (#2526): claim missing after materialize -> deny, naming the missing record', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /Step 2\.8/);
  assert.match(spec.permissionDecisionReason, /#991/);
  assert.match(spec.permissionDecisionReason, /IL-131/);
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'claim-log'));
});

test('bookkeeping-stamps gate (#2526): decisions.md exists but names a DIFFERENT record\'s claim -> still deny (no cross-record false-satisfy)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '- AUTO 00:00:00 — Step 2.8: claimed #700 (bin/claim-targets.js, transport: git).\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /#991/);
});

test('bookkeeping-stamps gate (#2526): work-backend: local-files -> exempt unconditionally (falls through to the worktree deny, never a claim deny)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fs.writeFileSync(path.join(wt, 'CLAUDE.md'), '# Fixture\n\nwork-backend: local-files\n');
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/, 'must be the worktree deny, not a claim-log deny');
  assert.ok(!readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'claim-log'), 'local-files must never trip the claim-log deny');
});

test('bookkeeping-stamps gate (#2526): no CLAUDE.md at all (unconfigured work-backend) -> exempt unconditionally, same as local-files', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/, 'must be the worktree deny, not a claim-log deny');
});

test('bookkeeping-stamps gate (#2526): a provably foreign-owned run warns instead of denying on the claim branch', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, 'owner-session');
  const out = pre.run({
    input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'caller-session' },
    runDir: run,
    runState: { status: 'active', sessionId: 'owner-session' },
    cwd: wt,
  });
  assert.ok(!out.json || !out.json.hookSpecificOutput, 'a foreign-owned run must not be denied at the claim branch');
  assert.match(out.json.systemMessage, /different session/);
  assert.ok(readEvents(run).some((e) => e.type === 'wd-foreign-session' && e.stamp === 'claim-log'));
});

test('bookkeeping-stamps gate (#2526): a multi-record run — every record needs its own claim line, one missing still denies naming only that one', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('spec-991-995', 'work', '991-spec.md'));
  // Materialize the second record's spec file directly (no separate commit
  // needed — hasMaterializeCommit only needs ONE committed work/ file to arm;
  // getMaterializedRecordNumbers reads the live tree, uncommitted is fine).
  const dir995 = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'spec-991-995', 'work');
  fs.mkdirSync(dir995, { recursive: true });
  fs.writeFileSync(path.join(dir995, '995-spec.md'), '---\nrecord: 995\n---\nbody\n');
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '- AUTO 00:00:00 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: git).\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  const reason = out.json.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /#995/, 'must name the still-missing record');
  assert.doesNotMatch(reason, /#991/, 'must not name the already-claimed record');
});

// (#2636) The claim-log branch sat AFTER the function's own
// `runState.worktree && (runState.pr || runState.prExempt)` short-circuit —
// both of which are stamped early in any real run, well before the claim-log
// branch's own `hasMaterializeCommit` precondition can ever be true. Once
// both were set, that short-circuit returned `{}` on every subsequent call
// and the claim-log branch became unreachable dead code. This is the real
// post-stamp steady state (AC1): worktree AND pr already set.
test('bookkeeping-stamps gate (#2636): worktree+pr already stamped (real post-stamp steady state) + a genuinely missing claim -> still denied, not short-circuited away', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active', worktree: wt, pr: { number: 1, url: 'https://x' } },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny result — the claim-log branch must still be reachable');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /Step 2\.8/);
  assert.match(spec.permissionDecisionReason, /#991/);
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'claim-log'));
});

// Same post-stamp steady state, but via `prExempt` (a local-merge run) rather
// than a real `pr` object — the short-circuit's other allowed path to the
// PR half of its condition must be gated on `claimExempt` too.
test('bookkeeping-stamps gate (#2636): worktree stamped + prExempt (local-merge steady state) + a genuinely missing claim -> still denied', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active', worktree: wt, prExempt: true },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny result — the claim-log branch must still be reachable');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'claim-log'));
});

// AC1's positive control: once claimExempt IS set (a prior call already
// resolved the claim branch cleanly), the short-circuit correctly skips
// straight past every stamp check with no deny at all.
test('bookkeeping-stamps gate (#2636): worktree+pr+claimExempt all set -> short-circuits to allow, no deny of any kind', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: {
      status: 'active', worktree: wt, pr: { number: 1, url: 'https://x' }, claimExempt: true,
    },
    cwd: wt,
  });
  assert.ok(!out.json || !out.json.hookSpecificOutput, 'fully-stamped run must allow with no deny');
});

// (#2636) hasLoggedClaim's regex only matched a single-target
// "Step 2.8: claimed #{n}" line. A real multi-record `/flow` run's actual
// Step 2.8 log line is a batch summary instead — confirmed against
// pipeline run 2026-09-20T002426-record-1235's own decisions.md — with no
// per-number substring at all, so every record in a multi-record run would
// misclassify as missing-claim even when the batch call genuinely claimed
// all of them (AC2).
test('bookkeeping-stamps gate (#2636): a multi-record run whose decisions.md carries only the real batch-claim line -> every target recognized as claimed, no deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('spec-991-995', 'work', '991-spec.md'));
  const dir995 = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'spec-991-995', 'work');
  fs.mkdirSync(dir995, { recursive: true });
  fs.writeFileSync(path.join(dir995, '995-spec.md'), '---\nrecord: 995\n---\nbody\n');
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run ${RUN_ID} (claim-targets.js exit 0). Reversibility: high.\n`,
  );
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result — but from the NEXT check (worktree stamp), not the claim branch');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/, 'must be the worktree deny, not a claim-log deny');
  assert.ok(!readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'claim-log'), 'the batch line must satisfy every record number — no claim-log deny');
});

test('bookkeeping-stamps gate (#2636): the batch-claim line alone does not satisfy an UNRELATED run\'s claim check (still scoped to this run\'s own decisions.md, no cross-run false-satisfy)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  // No decisions.md at all for THIS run -- hasLoggedClaim must fail closed
  // (missing file -> false), not accidentally match some other run's batch line.
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /Step 2\.8/);
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /#991/);
});

test('bookkeeping-stamps gate: main checkout (not a linked worktree) -> allow regardless of stamps', () => {
  const main = gitRepo();
  commitMaterializedSpec(main, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(main, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: main });
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: worktree stamped, resolveIntegrationModel stubbed to pr-first, no PR recorded -> deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny result once integration-model resolves pr-first with no PR recorded');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /record-pr|PR-early/);
  assert.match(spec.permissionDecisionReason, /IL-131/);
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-pr'));
});

test('bookkeeping-stamps gate (#989): worktree stamped, pr-first stubbed, a push establishing a not-yet-tracked branch, Step 1\'s no-match line already logged -> allow (pr-early-run-lifecycle.md Step 2 itself, not yet deniable)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const branch = execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  // #1800: the #989 exemption now additionally requires Step 1's outcome line
  // for THIS branch in decisions.md — seed it, same as a real run's Step 1
  // would before ever reaching Step 2's push.
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `## /build\n- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${branch}; creating. Reversibility: n/a.\n`,
  );
  // No `origin` remote configured at all on this fixture, and this branch has
  // never been pushed -> `@{u}` fails -> hasNoUpstreamYet is true. Without
  // the #989 fix this exact call — the run's own first publish push, made
  // before any PR can exist to record — is denied by the same gate that is
  // supposed to make Step 6 non-skippable, a chicken-and-egg regression that
  // makes Step 6 structurally impossible to ever complete.
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wt), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {}, 'the initial publish push must not be denied — it is the prerequisite record-pr cannot exist without');
});

test('bookkeeping-stamps gate (#1800): worktree stamped, pr-first stubbed, a push establishing a not-yet-tracked branch, NO Step 1 line in decisions.md -> deny naming Step 1', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const branch = execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  // No decisions.md written at all -- Step 1 never ran (or never logged),
  // reproducing #903's exact gap: the #989 exemption alone would let this
  // push straight through with no record of whether Step 1's `gh pr list`
  // reuse/reopen check ever happened.
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wt), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny result — no Step 1 outcome line for this branch in decisions.md');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /Step 1/);
  assert.match(spec.permissionDecisionReason, /gh pr list --head/);
  assert.ok(readEvents(run).some((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-pr-step1'));
});

test('bookkeeping-stamps gate (#1800 review finding): a Step 1 line logged for a DIFFERENT, longer branch that has THIS branch as a strict prefix does NOT satisfy the precondition -> still deny', () => {
  // Regression coverage for a review-time finding on #1800 itself: the
  // original `hasLoggedPrEarlyStep1` regex anchored the branch name's
  // right-hand side with a plain `\b`, which fires on ANY word/non-word
  // transition -- including the hyphen that starts a `-retry` suffix. A
  // Step 1 line logged for `{branch}-retry` would therefore spuriously
  // satisfy branch `{branch}`'s own precondition, defeating the "keep it
  // attempt-specific" guarantee this file's Gotchas section calls for.
  const main = gitRepo();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-wtparent-'));
  const wt = path.join(parent, 'wt');
  const branch = `wt-branch-${path.basename(parent)}`;
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', branch]);
  const wtReal = fs.realpathSync(wt);
  commitMaterializedSpec(wtReal, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wtReal, undefined);
  // Seed a Step 1 line for a DIFFERENT branch (`{branch}-retry`) that has
  // THIS branch as a strict prefix -- never for `{branch}` itself.
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `## /build\n- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${branch}-retry; creating. Reversibility: n/a.\n`,
  );
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wtReal), runDir: run, runState: { status: 'active', worktree: wtReal }, cwd: wtReal },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny -- the logged line names a different (longer) branch, not this one');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /Step 1/);
});

// Review finding (3f, #1800): #989's own test above seeds only the no-match
// log-line shape; the other two shapes `hasLoggedPrEarlyStep1` also accepts
// (reuse-open, reopen) had no coverage at all -- a regex break isolated to
// either alternative would pass the whole suite. One minimal allow-case per
// remaining shape closes that gap.
test('bookkeeping-stamps gate (#1800): Step 1\'s reuse-open line satisfies the #989 exemption precondition -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const branch = execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `## /build\n- AUTO 09:00:00 — PR-early run lifecycle: reusing open PR #42 for ${branch}. Reversibility: high.\n`,
  );
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wt), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {}, 'a logged reuse-open line for this branch must satisfy the precondition');
});

test('bookkeeping-stamps gate (#1800): Step 1\'s reopen line satisfies the #989 exemption precondition -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const branch = execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `## /build\n- AUTO 09:00:00 — PR-early run lifecycle: reopened PR #42 for ${branch} (retry). Reversibility: high.\n`,
  );
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wt), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {}, 'a logged reopen line for this branch must satisfy the precondition');
});

test('bookkeeping-stamps gate (#1860): a worktree branch created via `-b {branch} origin/main` (worktree.baseRef: fresh\'s own form) inherits tracking to origin/main before any push -> still allow the first publish push', () => {
  const main = gitRepo();
  // Give `main` a real self-remote so `origin/main` exists as an actual
  // remote-tracking ref -- reproducing what `worktree.baseRef: fresh`
  // (EnterWorktree's default, used for every pipeline worktree this plugin
  // creates) actually does: `git worktree add -b {branch} {path} origin/main`.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-bare-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['-C', main, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', main, 'push', '-q', 'origin', 'HEAD:refs/heads/main']);
  execFileSync('git', ['-C', main, 'fetch', '-q', 'origin']);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-wtparent-'));
  const wt = path.join(parent, 'wt');
  const branchName = `wt-branch-${path.basename(parent)}`;
  // Branching FROM the remote-tracking ref (not from local HEAD, unlike
  // `linkedWorktreeOf` above) is what triggers git's `branch.autoSetupMerge`
  // default and inherits tracking to origin/main immediately -- before this
  // branch has ever been pushed under its own name.
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', branchName, 'origin/main']);
  const wtReal = fs.realpathSync(wt);
  commitMaterializedSpec(wtReal, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wtReal, undefined);
  // Fixture sanity: @{u} must resolve successfully here (to origin/main), NOT
  // fail with a git error -- the pre-#1860 bug required a git-error exit to
  // recognize "never pushed", which this exact, common worktree-creation form
  // never produces.
  const upstream = execFileSync(
    'git', ['-C', wtReal, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { encoding: 'utf8' },
  ).trim();
  assert.strictEqual(upstream, 'origin/main', 'fixture sanity: @{u} must resolve (inherited), not fail, to reproduce #1860');
  // #1800: seed Step 1's no-match line for this branch, same as #989's test above.
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    `## /build\n- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${branchName}; creating. Reversibility: n/a.\n`,
  );
  const out = pre.run(
    { input: bashInput(`git push origin ${branchName}`, wtReal), runDir: run, runState: { status: 'active', worktree: wtReal }, cwd: wtReal },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(
    out, {},
    'the initial publish push must not be denied even though @{u} resolves -- it resolves to origin/main (inherited from the branch-off point), not this branch\'s own remote ref',
  );
});

test('bookkeeping-stamps gate (#989): worktree stamped, pr-first stubbed, a push of an ALREADY-tracked branch with no PR recorded -> still deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  execFileSync('git', ['remote', 'add', 'origin', main], { cwd: wt });
  const branch = execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  // Establish the upstream for real (a genuine first push succeeding, exactly
  // what the test above allows) — this is Step 2 having already run once for
  // this branch. `gh pr create` (Step 3) never followed it: no PR recorded,
  // no degrade logged. A second push here must not be silently exempted too —
  // that would reopen exactly the "keep pushing forever, never open the PR"
  // gap IL-131 exists to close, only shifted from Edit/commit onto push.
  execFileSync('git', ['-C', wt, 'push', '-u', 'origin', branch], { stdio: 'ignore' });
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const out = pre.run(
    { input: bashInput(`git push origin ${branch}`, wt), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'a push of an already-tracked branch with no PR recorded and no degrade logged must still deny');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-pr|PR-early/);
});

test('bookkeeping-stamps gate: worktree stamped, pr-first stubbed, degrade already logged in decisions.md -> allow (graceful degrade)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    '## /build\n- AUTO 09:00:00 — PR-early run lifecycle: push of wt-branch to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n',
  );
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: worktree stamped, resolveIntegrationModel stubbed to local-merge, no PR recorded -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'local-merge' },
  );
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: through pre.run() with the real (unstubbed) resolveIntegrationModel — a fixture repo with no gh-backed remote resolves local-merge, PR branch never denies', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('bookkeeping-stamps gate: worktree stamped AND pr recorded -> allow regardless of integration-model', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined, { pr: { number: 991, url: 'https://github.com/example/example/pull/991' } });
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt, pr: { number: 991, url: 'x' } }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {});
});

// hasLoggedPrDegrade has no ctx of its own (just a runDir), so it is exercised
// here exclusively through its one observable effect on checkBookkeepingStampsGate's
// pr-first branch, reached via pre.run() rather than by calling the helper
// directly (record #1268). Three cases:
//   - matching FAILED line -> allow: 'bookkeeping-stamps gate: worktree stamped,
//     pr-first stubbed, degrade already logged in decisions.md -> allow (graceful
//     degrade)' above already covers this exactly (hasLoggedPrDegrade's true case).
//   - decisions.md exists but has no matching line -> deny: this test.
//   - decisions.md does not exist at all -> deny: 'bookkeeping-stamps gate:
//     worktree stamped, resolveIntegrationModel stubbed to pr-first, no PR
//     recorded -> deny' above already covers this (no decisions.md is ever
//     written in that fixture) — hasLoggedPrDegrade's other false case.
test('bookkeeping-stamps gate: decisions.md exists but has no matching PR-early degrade line -> still deny (hasLoggedPrDegrade false case)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '## /build\n- AUTO 14:32:14 — unrelated entry.\n');
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny result — decisions.md exists but has no PR-early degrade line');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-pr|PR-early/);
});

test('regression (IL-131 recurrence, records #118/#893): a build agent that materializes then edits code directly — no record-worktree, no record-pr — is denied on its very first code edit, not silently allowed through', () => {
  // Reproduces the exact trigger: build judged "already satisfied by prior
  // work," skipped straight from the materialize commit to editing
  // implementation code, never calling record-worktree or record-pr.
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '893-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined); // record-worktree never ran

  // The first tool call after materialize: an Edit to some already-satisfied
  // file, exactly the "nothing further to implement" shortcut IL-131 describes.
  const out = pre.run({
    input: editInput(path.join(wt, 'plugin', 'skills', 'build', 'SKILL.md')),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });

  assert.ok(out.json, 'expected the sweep-past-both-stamps case to be caught, not silently allowed');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/);

  // Simulate remediation: run record-worktree, retry the same edit.
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wt }));
  const retry = pre.run({
    input: editInput(path.join(wt, 'plugin', 'skills', 'build', 'SKILL.md')),
    runDir: run,
    runState: { status: 'active', worktree: wt },
    cwd: wt,
  });
  // No origin remote on this fixture -> local-merge, so the PR-stamp branch
  // never applies here; the edit is now allowed once the worktree stamp lands.
  assert.deepStrictEqual(retry, {});
});

// --- C1+C2: the materialize sentinel is scoped to THIS run's own id ---

test('bookkeeping-stamps gate (C2 discrimination): a DIFFERENT run-id\'s materialize commit does NOT satisfy this run\'s sentinel', () => {
  // Two runs each get their own worktree in production, but a sibling run's
  // committed spec can be reachable in the same history (a merge, a shared
  // base). The pathspec must be scoped to ctx.runDir's own basename, not to
  // "any {run-id}/work/*-spec.md anywhere" — otherwise the gate arms itself
  // off another run's bookkeeping and denies universally.
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '777-spec.md'), '2026-08-01T000000-record-777');
  const { run } = mkRunDir(projectDir(), null, undefined); // basename is RUN_ID, not the committed run
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(out, {}, 'another run\'s materialize commit must not arm this run\'s gate');
});

test('bookkeeping-stamps gate (C1/C2 discrimination): a legacy top-level work/{n}-spec.md commit does NOT satisfy the sentinel', () => {
  // ~100 of these exist in this repo's own history from before run-dir
  // anchoring. A repo-root-relative `work` pathspec would match every one of
  // them and arm the gate permanently on every branch.
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const legacy = path.join(wt, 'work', '499-spec.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'legacy\n');
  execFileSync('git', ['-C', wt, 'add', '-f', path.join('work', '499-spec.md')]);
  execFileSync('git', ['-C', wt, 'commit', '-m', 'legacy top-level spec', '-q']);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(out, {}, 'a pre-anchoring top-level work/ spec must not arm the gate');
});

test('bookkeeping-stamps gate: a non-work file committed inside this run\'s own run dir does NOT satisfy the sentinel', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const decisions = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'decisions.md');
  fs.mkdirSync(path.dirname(decisions), { recursive: true });
  fs.writeFileSync(decisions, '## /build\n');
  execFileSync('git', ['-C', wt, 'add', '-f', path.join('.claude-tweaks', 'pipelines', RUN_ID, 'decisions.md')]);
  execFileSync('git', ['-C', wt, 'commit', '-m', 'log', '-q']);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(out, {}, 'only work/{n}-spec.md (or spec-*/work/*) is the materialize sentinel');
});

// --- I1: ownership scoping (the deny's own remediation would corrupt a sibling run) ---

test('bookkeeping-stamps gate (I1): a provably foreign-owned run warns instead of denying', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, 'owner-session');
  const out = pre.run({
    input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'caller-session' },
    runDir: run,
    runState: { status: 'active', sessionId: 'owner-session' },
    cwd: wt,
  });
  assert.ok(!out.json || !out.json.hookSpecificOutput, 'a foreign-owned run must not be denied');
  assert.match(out.json.systemMessage, /different session/);
  assert.ok(readEvents(run).some((e) => e.type === 'wd-foreign-session' && e.stamp === 'record-worktree'));
});

test('bookkeeping-stamps gate (I1): identity missing on either side still denies (unprovable is not foreign)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, 'owner-session');
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')), // no session_id on the caller side
    runDir: run,
    runState: { status: 'active', sessionId: 'owner-session' },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I1): the pr-first branch warns instead of denying for a foreign-owned run', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, 'owner-session');
  const out = pre.run(
    {
      input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'caller-session' },
      runDir: run,
      runState: { status: 'active', worktree: wt, sessionId: 'owner-session' },
      cwd: wt,
    },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  // Through pre.run(), a collected allow-but-warn note surfaces as
  // json.systemMessage (run()'s own header comment) rather than a separately
  // returned warnings array — there is no permissionDecision, since the call
  // is allowed, but the warning text is still attached.
  assert.ok(!out.json || !out.json.hookSpecificOutput, 'a foreign-owned run must not be denied for a missing PR stamp');
  assert.match(out.json.systemMessage, /different session/);
});

// --- #1259: ctx.ownedRun strengthens the record-worktree branch specifically ---
//
// On the record-worktree branch, ctx.runState.worktree is provably unset —
// and sessionId is stamped together with worktree (record-worktree and
// post-tool-use.js's ad-hoc stamping both write them as a pair) — so
// ctx.runState.sessionId is almost always ALSO unset here, meaning
// isForeignSessionCall's owner-vs-caller comparison can essentially never
// fire on this branch (owner is empty). ctx.ownedRun (bin/hooks.js's own
// session-scoped resolveRun call, independent of this gate's session-agnostic
// ctx.runDir resolution) supplies the signal this branch has been missing: a
// live sibling session, mid-build in its OWN worktree with its OWN
// already-recorded run, calling into a DIFFERENT (unstamped) run this gate
// resolved via the newest-non-terminal fallback.

test('bookkeeping-stamps gate (#1259): a caller whose OWN resolved run differs from the run this gate would deny against warns instead of denying, even with no sessionId stamped on either side', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, null, undefined); // unstamped: no worktree, no sessionId
  const ownRun = path.join(project, '.claude-tweaks', 'pipelines', 'sibling-own-run');
  fs.mkdirSync(ownRun, { recursive: true });
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active' },
    ownedRun: { dir: ownRun, attribution: 'session' },
    cwd: wt,
  });
  assert.ok(!out.json || !out.json.hookSpecificOutput, 'a caller with its own distinct owned run must not be denied');
  assert.match(out.json.systemMessage, /different session/);
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.type === 'wd-foreign-session' && e.stamp === 'record-worktree'));
});

test('bookkeeping-stamps gate (#1259): ownedRun matching ctx.runDir (the ordinary single-session case) still denies', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, null, undefined);
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active' },
    ownedRun: { dir: run, attribution: 'session' }, // same run — this IS the caller's own work
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny — the caller owns exactly this run, nothing foreign about it');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (#1259): a distinct ownedRun does NOT loosen the PR-stamp branch — that guard is unchanged', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined); // worktree already stamped -> PR-stamp branch
  const ownRun = path.join(project, '.claude-tweaks', 'pipelines', 'sibling-own-run');
  fs.mkdirSync(ownRun, { recursive: true });
  const out = pre.run(
    {
      input: editInput(path.join(wt, 'src', 'x.js')),
      runDir: run,
      runState: { status: 'active', worktree: wt },
      ownedRun: { dir: ownRun, attribution: 'session' },
      cwd: wt,
    },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny — the PR-stamp branch must not consult ownedRun');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-pr|PR-early/);
});

// --- #1798 Task 0: empirical premise check — does isForeignSessionCall's
// owner-vs-caller comparison genuinely fail to distinguish "the owning
// session, whose sessionId just never got recorded (env-var-propagation
// failure)" from "a foreign session" on the record-pr branch specifically?
//
// FINDING (recorded here per this record's own Task 0 convention, and in
// steps-and-gates... no, in pre-tool-use.js's own header — see that file):
// CONFIRMED at the code/fixture level — with runState.sessionId unset,
// isForeignSessionCall(ctx) returns false (not foreign) regardless of
// ctx.input.session_id's value, for BOTH a genuinely-owning caller AND a
// wholly foreign one; stampCheckOutcome's non-foreign branch always denies.
// This ambiguity is real. It does NOT, however, call for either of the
// record's own conditional-deliverable options:
//   (a) folding hasDistinctOwnedRun into the record-pr branch — refuted by
//       the pre-existing #1259 pin two tests above ("a distinct ownedRun
//       does NOT loosen the PR-stamp branch — that guard is unchanged",
//       deliberate, not an oversight) AND because in the true incident
//       shape ownedRun.dir already EQUALS ctx.runDir for a genuine owner
//       (the session resolves its own run to the very run being checked),
//       so hasDistinctOwnedRun stays false regardless — it would not have
//       changed this incident's outcome even if folded in.
//   (b) backfilling runState.sessionId mid-flight — even a safe version
//       (re-reading process.env.CLAUDE_CODE_SESSION_ID, never trusting an
//       unverified caller-claimed identity) does not change THIS call's own
//       outcome: if the backfilled owner now equals the caller, `owner !==
//       caller` is still false (not foreign), so stampCheckOutcome still
//       denies — the ambiguity was never actually the thing standing between
//       this call and an allow. The deny for an owning session that has not
//       yet completed Step 6 (opened the PR) is IL-131's own intended
//       behavior, not a bug: the gate exists specifically so this step
//       cannot be judged "already done" and skipped.
// The reporter's own three observed denials, followed by the stamp
// "eventually landing," are equally well explained by "the gate correctly
// held until Step 6 completed" as by "a false positive" — and the original
// events.jsonl excerpt (bare stamp + worktree, no session-id fields) cannot
// distinguish the two. That is exactly what Deliverable 2 below fixes: the
// next occurrence of this shape will show ownerSessionId:null on the denied
// event, immediately legible as "ambiguous-unset-owner," not requiring a
// fresh investigation. No behavior-changing conditional fix ships in this
// build — see this file's own bookkeeping-stamp-deny diagnostic fields
// instead (added by this same record).

test('#1798 Task 0: runState.sessionId unset + a covered call whose caller session_id matches this run\'s OWN resolved ownedRun (the genuine-owner shape) is still denied — isForeignSessionCall cannot rescue it', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined); // worktree stamped, sessionId genuinely never recorded
  const out = pre.run(
    {
      input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'genuine-owner-session' },
      runDir: run,
      runState: { status: 'active', worktree: wt },
      ownedRun: { dir: run, attribution: 'session' }, // this IS the caller's own run — the true incident shape
      cwd: wt,
    },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.ok(out.json, 'expected a deny — an unset owner cannot be proven to be this specific caller, and IL-131 denies until record-pr lands regardless');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

// --- #1798 Deliverable 2: bookkeeping-stamp-deny carries both compared
// session-id values, unconditional on Task 0's finding — this is what
// actually answers the reporter's own request: "log the reason so an
// owner-session false positive is diagnosable from events.jsonl" without
// needing a fresh investigation each time.

test('#1798: a bookkeeping-stamp-deny event on the record-pr branch carries ownerSessionId (null when never recorded) and callerSessionId', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  pre.run(
    {
      input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'caller-session-1' },
      runDir: run,
      runState: { status: 'active', worktree: wt },
      cwd: wt,
    },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  const denyEvent = readEvents(run).find((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-pr');
  assert.ok(denyEvent, 'expected a bookkeeping-stamp-deny event for record-pr');
  assert.strictEqual(denyEvent.ownerSessionId, null, 'never-recorded sessionId must read null, not undefined or missing');
  assert.strictEqual(denyEvent.callerSessionId, 'caller-session-1');
});

test('#1798: a bookkeeping-stamp-deny event on the record-worktree branch also carries both session-id fields', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, null, 'owner-session-42'); // no worktree stamped -> record-worktree branch
  pre.run({
    input: { ...editInput(path.join(wt, 'src', 'x.js')), session_id: 'owner-session-42' },
    runDir: run,
    runState: { status: 'active', sessionId: 'owner-session-42' },
    ownedRun: { dir: run, attribution: 'session' },
    cwd: wt,
  });
  const denyEvent = readEvents(run).find((e) => e.type === 'bookkeeping-stamp-deny' && e.stamp === 'record-worktree');
  assert.ok(denyEvent, 'expected a bookkeeping-stamp-deny event for record-worktree');
  assert.strictEqual(denyEvent.ownerSessionId, 'owner-session-42');
  assert.strictEqual(denyEvent.callerSessionId, 'owner-session-42');
});

// --- #1520: end-to-end reproduction of #815's build-phase gap ---
//
// #815's build landed a materialize commit and a second commit in its own
// worktree, but never called record-worktree — run-state.json was never
// written for that run at all. The bookkeeping-stamps gate above (armed
// since #991, well before #815 ran) should have denied that second commit
// outright, but its own `hasDistinctOwnedRun` escape hatch (#1259) read
// `ctx.ownedRun` from `resolveRun`'s pre-#1099 session-scoped arm, which
// matched purely on `sessionId` with no worktree-binding check — so an
// OLDER run this same session had already stamped elsewhere (a stale
// sibling, still `sessionId`-equal) was returned as this session's "own"
// run, made `ownedRun.dir !== ctx.runDir` true, and the gate treated the
// call as a different session's business and only warned. #1099 closed
// that gap in `resolveRun` itself (see the "same-session sibling
// worktrees" tests in hooks-run-attribution.test.js); this section proves
// the fix all the way through to the gate's actual verdict — the shape
// #815 needed, not just the unit-level resolveRun behavior.

test('bookkeeping-stamps gate (#1520, real resolveRun): a stale same-session sibling run in another worktree no longer defeats the record-worktree deny', () => {
  const main = gitRepo();
  const staleWt = linkedWorktreeOf(main); // a prior run's worktree, same session
  const wt = linkedWorktreeOf(main); // THIS run's worktree — the one under test
  const runId = '2026-08-26T215430-record-815';
  commitMaterializedSpec(wt, path.join('work', '815-spec.md'), runId);

  // The stale sibling: already fully stamped (worktree + sessionId), exactly
  // like a completed-or-abandoned earlier run from the same session — #815's
  // record-769 stand-in. Newer run-id than the current run, so a naive
  // newest-first guess would prefer it too. Run dirs are anchored to the MAIN
  // checkout (resolveRun resolves `wt`'s main checkout internally), so both
  // live under `main`, not an unrelated project dir.
  const staleRun = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-26T212441-record-769');
  fs.mkdirSync(staleRun, { recursive: true });
  fs.writeFileSync(path.join(staleRun, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: 'me', worktree: staleWt }));

  // THIS run: materialize commit landed (in `wt`), but record-worktree never
  // ran — no run-state.json at all, the exact #815 gap.
  const run = path.join(main, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), ''); // a real run dir, not an unadopted mint

  // Step 1: resolveRun must not be fooled by the stale sibling's sessionId
  // match — it must skip it (worktree-foreign) and land on THIS run via the
  // unowned/fallback arm.
  const ownedRun = ctxLib.resolveRun(wt, {}, 'me');
  assert.deepStrictEqual(ownedRun, { dir: run, attribution: 'fallback' });

  // Step 2: feeding that real resolution into the gate must deny — not warn
  // — proving #815's actual failure mode (a silently-allowed second commit
  // with no record-worktree ever called) is closed end-to-end.
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: null,
    ownedRun,
    cwd: wt,
  });
  assert.ok(out.json && out.json.hookSpecificOutput, 'expected a deny — must not fall through to the wd-foreign-session warn path');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/);
});

// --- I2: path and foreign-repo exemptions ---

test('bookkeeping-stamps gate (I2.1): an Edit to the run dir\'s own decisions.md is exempt — the deny\'s escape hatch must not be deniable', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  // Run dirs are anchored to the MAIN checkout, so decisions.md sits outside
  // the worktree being enforced — the exemption has to resolve the target's
  // own repo root, not assume the worktree's.
  const { run } = mkRunDir(main, null, undefined);
  const exempt = pre.run({ input: editInput(path.join(run, 'decisions.md')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.deepStrictEqual(exempt, {}, 'a write into .claude-tweaks/pipelines/ must not be denied by this gate');
  // Control: the same scenario with an ordinary code file still denies, so the
  // exemption above is the reason for the allow, not a broken fixture.
  const denied = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(denied.json && denied.json.hookSpecificOutput, 'control: a non-exempt target must still be denied');
  assert.strictEqual(denied.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I2.1): the PR-stamp deny message names bin/log-decision.js as the runnable escape hatch', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), wt, undefined);
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /bin\/log-decision\.js/);
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /--run "/);
});

test('bookkeeping-stamps gate (I2.2): a Bash git commit targeting an unrelated repository is not this run\'s business -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const foreign = gitRepo();
  fs.writeFileSync(path.join(foreign, 'a.txt'), 'x');
  execFileSync('git', ['-C', foreign, 'add', 'a.txt']);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: bashInput(`git -C ${foreign} commit -m "unrelated"`, wt),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.deepStrictEqual(out, {}, 'a commit into a foreign repo must not be denied by this run\'s bookkeeping gate');
});

test('bookkeeping-stamps gate (I2.2): one in-project git target is enough to keep the gate armed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const foreign = gitRepo();
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: bashInput(`git -C ${foreign} commit -m "unrelated" && git commit -m "ours"`, wt),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny — one target is this run\'s own worktree');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I2.3, #1678): an Edit to a path outside any git repo at all (a session scratchpad) is not this run\'s business -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  // A plain mkdtemp dir with no `git init` — provably outside any git repo,
  // the same shape as a Claude Code session scratchpad directory
  // (/private/tmp/claude-<uid>/<slug>/<session-id>/scratchpad/**).
  const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-scratch-'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(scratchpad, 'pr-body.md')),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.deepStrictEqual(out, {}, 'a Write whose target is outside any git repo must not be denied by this run\'s bookkeeping gate');
});

test('bookkeeping-stamps gate (I2.3, #1678): an Edit to a path inside an unrelated repository is not this run\'s business -> allow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const foreign = gitRepo();
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(foreign, 'notes.md')),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.deepStrictEqual(out, {}, 'a Write whose target is inside an unrelated repository must not be denied by this run\'s bookkeeping gate');
});

test('bookkeeping-stamps gate (I2.3, #1678): control — an Edit whose target is inside THIS run\'s own worktree still denies (scoping narrows, it does not disable, the gate)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny — the target is this run\'s own worktree, unchanged from existing behavior');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I2.3, #1678): an UNPROVABLE target answer (indeterminate: true) never exempts — fails closed, still denies', () => {
  // The single safety-critical property the whole file-tool scoping block
  // depends on: an unresolvable target answer must fall through to the
  // existing (denying) checks, exactly like a target inside this run's own
  // worktree — never be read as a definitive "not a repo"/"different repo"
  // exemption. Path-conditional stub: only the call for the file-tool
  // TARGET is forced indeterminate; every other wtDetect.repoInfo call
  // (including the one against ctx.cwd for the worktree/session-linkage
  // check) resolves for real.
  const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const targetPath = path.join(wt, 'src', 'x.js');
  const real = wtDetect.repoInfo;
  wtDetect.repoInfo = (p, ...rest) => {
    if (p === targetPath) return { repoRoot: null, isLinkedWorktree: false, indeterminate: true };
    return real(p, ...rest);
  };
  let out;
  try {
    out = pre.run({
      input: editInput(targetPath),
      runDir: run,
      runState: { status: 'active' },
      cwd: wt,
    });
  } finally {
    wtDetect.repoInfo = real;
  }
  assert.ok(out.json, 'expected a deny — an unprovable target must never be exempted by the new scoping check');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I2.3, #1678, review finding): the "provably not a repo at all" exemption fires even when this worktree\'s OWN mainCheckoutRoot transiently fails to resolve -> still allows', () => {
  // Regression for a review finding on #1678's own file-tool scoping fix: the
  // exemption for a target repoInfo already proved has no repo root at all
  // must not depend on `mainCheckoutRoot(wtRoot)` (a separate, unrelated
  // fs read) resolving successfully — an EACCES/ELOOP/EIO on the worktree's
  // own `.git` file must not turn a genuinely-outside-any-repo target
  // (the scratchpad case) into a deny.
  const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-scratch-'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  const realMainCheckoutRoot = wtDetect.mainCheckoutRoot;
  wtDetect.mainCheckoutRoot = (p, ...rest) => {
    if (p === wt) return null; // simulate the worktree's OWN mainCheckoutRoot failing to resolve
    return realMainCheckoutRoot(p, ...rest);
  };
  let out;
  try {
    out = pre.run({
      input: editInput(path.join(scratchpad, 'pr-body.md')),
      runDir: run,
      runState: { status: 'active' },
      cwd: wt,
    });
  } finally {
    wtDetect.mainCheckoutRoot = realMainCheckoutRoot;
  }
  assert.deepStrictEqual(out, {}, 'a target repoInfo already proved is not a repo at all must exempt unconditionally, even when this worktree\'s own mainCheckoutRoot fails to resolve');
});

test('bookkeeping-stamps gate (I2.3, #1678, review finding): a symlink located outside any repo whose TARGET resolves inside this run\'s own worktree is NOT exempted -> still denies', () => {
  // Regression for a review finding (security, lens 3b) on #1678's own
  // file-tool scoping fix: the "provably not a repo at all" exemption must
  // resolve a symlink AT THE LEAF before asking where the target lives --
  // otherwise a symlink whose own location sits outside any repo (a session
  // scratchpad) but whose target resolves inside the protected worktree
  // would bypass this gate entirely, even though the write's real bytes
  // land inside the worktree the gate exists to protect.
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const realFile = path.join(wt, 'src', 'x.js');
  fs.mkdirSync(path.dirname(realFile), { recursive: true });
  fs.writeFileSync(realFile, 'existing content\n');
  const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-scratch-'));
  const link = path.join(scratchpad, 'link.js');
  fs.symlinkSync(realFile, link);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(link),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny — a symlink located outside any repo but pointing INTO this run\'s own worktree must not bypass the gate');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('bookkeeping-stamps gate (I2.3, #1678, review finding): a dangling symlink located outside any repo is unprovable -> fails closed, still denies', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-scratch-'));
  const link = path.join(scratchpad, 'dangling-link.js');
  fs.symlinkSync(path.join(scratchpad, 'nothing-here.js'), link);
  const { run } = mkRunDir(projectDir(), null, undefined);
  const out = pre.run({
    input: editInput(link),
    runDir: run,
    runState: { status: 'active' },
    cwd: wt,
  });
  assert.ok(out.json, 'expected a deny — a dangling symlink is unprovable and must fail closed');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

// --- I3: integration-model comes from the run's own pin, not a fresh detection ---

test('bookkeeping-stamps gate (I3): the run\'s config.yml pin is read — pinned pr-first denies even with no forge detectable', () => {
  // The fixture repo has no origin remote, so fresh forge detection can only
  // ever return local-merge. A deny here proves the {runDir}/config.yml
  // overlay is actually consulted.
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(main, wt, undefined);
  fs.writeFileSync(path.join(run, 'config.yml'), 'integration-model: pr-first\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt });
  assert.ok(out.json, 'expected a deny once the run pins pr-first');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /pr-first/);
});

test('bookkeeping-stamps gate (I3): the run\'s pin beats policy.yml — pinned local-merge is never denied for a missing PR', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  const { run } = mkRunDir(main, wt, undefined);
  fs.writeFileSync(path.join(run, 'config.yml'), 'integration-model: local-merge\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt });
  assert.deepStrictEqual(out, {}, 'a run pinned local-merge must never be denied for a PR it will never have');
});

test('bookkeeping-stamps gate (I3): with no run pin, policy.yml still wins over fresh detection', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  const { run } = mkRunDir(main, wt, undefined); // no config.yml
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt });
  assert.ok(out.json, 'expected a deny — policy.yml pins pr-first and nothing overrides it');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

// --- I5: both stamps present short-circuits before any git/gh spawn ---

// Routed through pre.run() (record #1268), which means every call here pays
// for the OTHER gates runInner runs ahead of checkBookkeepingStampsGate
// (checkPipelineShadowGuard in particular resolves repoInfo unconditionally,
// spawning git once regardless of what this gate would do) — so "zero total
// spawns" is no longer the right assertion once bypassing the dispatcher is
// off the table. What's still provable, and still the actual guarantee this
// gate makes, is that checkBookkeepingStampsGate's own short-circuit
// (runState.worktree && runState.pr) adds NO spawns beyond pre.run()'s own
// baseline dispatch overhead — measured with no run resolved at all, so
// checkBookkeepingStampsGate's `if (!ctx.runDir || !ctx.runState) return {};`
// fires first and every spawn counted is provably from the OTHER gates. The
// control case (worktree stamped, PR stamp missing) forces this gate to
// actually spawn (hasMaterializeCommit + resolveRunPinnedIntegrationModel),
// proving the comparison is live rather than trivially zero everywhere.
test('bookkeeping-stamps gate (I5): both stamps present adds no repo-inspection spawns beyond pre.run()\'s own baseline dispatch', () => {
  const cp = require('child_process');
  const original = cp.execFileSync;
  function withSpawnCount(fn) {
    let calls = 0;
    cp.execFileSync = function (...args) {
      if (args[0] === 'git' || args[0] === 'gh') calls += 1;
      return original.apply(this, args);
    };
    let out;
    try { out = fn(); } finally { cp.execFileSync = original; }
    return { out, calls };
  }

  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));

  const baseline = withSpawnCount(() => pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: null, runState: null, cwd: wt }));
  assert.deepStrictEqual(baseline.out, {});

  // (#2636) All three stamps (worktree, pr, claimExempt) must be present for
  // the fast path to apply — worktree+pr alone is no longer sufficient once
  // the claim-log branch is reachable in this steady state too.
  const { run } = mkRunDir(project, wt, undefined, { pr: { number: 1 }, claimExempt: true });
  const shortCircuit = withSpawnCount(() => pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: {
      status: 'active', worktree: wt, pr: { number: 1 }, claimExempt: true,
    },
    cwd: wt,
  }));
  assert.deepStrictEqual(shortCircuit.out, {});
  assert.strictEqual(
    shortCircuit.calls, baseline.calls,
    'all three stamps present must add zero repo-inspection spawns beyond pre.run()\'s own baseline dispatch',
  );

  // Control: worktree stamped but PR missing forces real inspection
  // (hasMaterializeCommit + resolveRunPinnedIntegrationModel) — strictly more
  // spawns than baseline, proving baseline isn't already saturated.
  const { run: controlRun } = mkRunDir(project, wt, undefined);
  const control = withSpawnCount(() => pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: controlRun,
    runState: { status: 'active', worktree: wt },
    cwd: wt,
  }));
  assert.ok(
    control.calls > baseline.calls,
    `expected the missing-PR-stamp control to spawn more than the baseline (${baseline.calls}), got ${control.calls}`,
  );
});

// --- #1258: I5's fast path extended to the local-merge / degrade-logged
// steady state, via a persisted `runState.prExempt` verdict ---

// Shared spawn-counting helper (mirrors the I5 test's own local closure
// above — kept duplicated rather than hoisted, matching this file's existing
// per-test convention).
function withSpawnCount(fn) {
  const cp = require('child_process');
  const original = cp.execFileSync;
  let calls = 0;
  cp.execFileSync = function (...args) {
    if (args[0] === 'git' || args[0] === 'gh') calls += 1;
    return original.apply(this, args);
  };
  let out;
  try { out = fn(); } finally { cp.execFileSync = original; }
  return { out, calls };
}

test('bookkeeping-stamps gate (#1258): local-merge steady state — first resolution persists prExempt, a later call short-circuits like a fully-stamped pr-first run', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));

  const baseline = withSpawnCount(() => pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: null, runState: null, cwd: wt }));
  assert.deepStrictEqual(baseline.out, {});

  // First covered call after the worktree stamp: no origin remote on this
  // fixture -> real (unstubbed) resolveIntegrationModel resolves
  // 'local-merge' -> allow, and this is the call that must persist
  // `prExempt: true` onto run-state.json. Expected to spawn more than
  // baseline, same as the I5 test's own "missing-PR-stamp control" above —
  // proving this call is not already trivially at the fast path.
  const { run } = mkRunDir(project, wt, undefined);
  const first = withSpawnCount(() => pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'active', worktree: wt },
    cwd: wt,
  }));
  assert.deepStrictEqual(first.out, {});
  assert.ok(
    first.calls > baseline.calls,
    `expected the first local-merge resolution to spawn more than baseline (${baseline.calls}), got ${first.calls}`,
  );
  const persisted = JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
  assert.strictEqual(persisted.prExempt, true, 'first resolution must persist prExempt onto run-state.json');
  // (#2636) No CLAUDE.md at all in this fixture -> the claim-log branch's
  // work-backend read resolves null (unconfigured), which is exempt
  // unconditionally -> this same first call also persists claimExempt.
  assert.strictEqual(persisted.claimExempt, true, 'first resolution must also persist claimExempt (unconfigured work-backend is exempt)');

  // Steady state: a later call reads the persisted prExempt/claimExempt (as
  // production code would, via ctx.runState freshly loaded from
  // run-state.json on each fresh hook process) and must add zero spawns
  // beyond pre.run()'s own baseline dispatch — the exact guarantee the AC
  // requires: no worse than a fully-stamped pr-first run's steady state.
  const steadyState = withSpawnCount(() => pre.run({
    input: editInput(path.join(wt, 'src', 'x.js')),
    runDir: run,
    runState: {
      status: 'active', worktree: wt, prExempt: true, claimExempt: true,
    },
    cwd: wt,
  }));
  assert.deepStrictEqual(steadyState.out, {});
  assert.strictEqual(
    steadyState.calls, baseline.calls,
    'a local-merge run\'s steady state (worktree stamped, prExempt persisted) must add zero repo-inspection ' +
    'spawns beyond pre.run()\'s own baseline dispatch',
  );
});

test('bookkeeping-stamps gate (#1258): pr-first with degrade already logged also persists prExempt', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  fs.writeFileSync(
    path.join(run, 'decisions.md'),
    '## /build\n- AUTO 09:00:00 — PR-early run lifecycle: push of wt-branch to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n',
  );
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => 'pr-first' },
  );
  assert.deepStrictEqual(out, {});
  const persisted = JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
  assert.strictEqual(persisted.prExempt, true, 'a graceful-degrade allow must also persist prExempt — the degrade line is permanent (append-only)');
});

test('bookkeeping-stamps gate (#1258): a caught model-resolution exception never persists prExempt — a transient failure is not a provable verdict', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: () => { throw new Error('transient gh failure'); } },
  );
  // Fail-open: an unresolvable model is not provably pr-first, so this call allows.
  assert.deepStrictEqual(out, {});
  const persisted = JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
  assert.strictEqual(
    persisted.prExempt, undefined,
    'a caught resolution exception must never persist prExempt — a later call might resolve pr-first and need to enforce',
  );
});

// --- #1460: an unrelated dangling run must not deny a fresh scratch worktree ---
//
// _shared/scratch-worktree.md's throwaway checkouts (used by /tidy, /wrap-up's
// residue sweep, /init) never call materialize or record-worktree for
// themselves — they have no run-state.json of their own. When such a worktree's
// first Edit/Write resolves ctx.runDir to some OTHER, unrelated non-terminal run
// (bin/hooks.js's resolveRunDir has no session-id filtering and picks the newest
// non-terminal run repo-wide), a dangling run whose materialize commit landed
// elsewhere but was never followed by record-worktree must not have its
// missing-worktree-stamp deny fire against this unrelated scratch worktree.
//
// A fixture where the victim commit sits on a branch that never merges anywhere
// (e.g. an unmerged PR) can't actually exercise this: that commit is simply
// unreachable from any other worktree's HEAD regardless of hasMaterializeCommit's
// range bound, so a naive version of this test would pass identically whether
// or not #1674's fix exists — proving nothing (confirmed empirically: forcing
// hasMaterializeCommit's `integration` bound to null and re-running such a
// fixture left the assertion green). #1460's own cited reproduction — run
// 2026-08-23T204821-record-361, PR #1339 — did not stay unmerged: `gh pr view
// 1339` shows `state: MERGED` (2026-08-25) into `main`, even though that run's
// own run-state.json was left `status: interrupted` with no worktree ever
// recorded. So this fixture merges the victim's materialize commit into `main`
// before branching the scratch worktree — the one topology that actually puts
// the commit in a later worktree's inherited history, which is exactly the
// precondition hasMaterializeCommit's #1674 range-bound (`{integration}..HEAD`,
// this worktree's own unique commits only) exists to exclude. Verified by
// reverting that bound locally (forcing the unbounded pre-#1674 walk) against
// this exact fixture: the gate arms (hasMaterializeCommit returns true) — so
// this fixture, unlike the disconnected-branch version, genuinely regresses if
// the bound is ever removed.
test('bookkeeping-stamps gate (#1460): an unrelated dangling run (materialize commit merged into main via an already-closed PR, no worktree recorded) does not deny a fresh scratch worktree', () => {
  const main = gitRepo();

  // The dangling run's OWN worktree — a genuine prior /build attempt whose
  // materialize commit landed here.
  const victimWt = linkedWorktreeOf(main);
  const runId = '2026-08-23T204821-record-361';
  commitMaterializedSpec(victimWt, path.join('work', '361-spec.md'), runId);

  // Merge that commit into `main`, simulating PR #1339's real, confirmed merge
  // — this is what puts it into every LATER worktree's inherited history.
  const victimBranch = execFileSync('git', ['-C', victimWt, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', main, 'merge', '--no-ff', victimBranch, '-m', 'Merge PR #1339', '-q']);

  // The dangling run dir: materialize commit landed and merged (per victimWt
  // above), but record-worktree never ran — no `worktree`/`sessionId` field at
  // all, the exact "interrupted, no worktree ever recorded" shape #1460
  // describes, matching run-361's real state despite PR #1339 having merged.
  const project = projectDir();
  const run = path.join(project, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'interrupted' }));

  // A separate scratch worktree, freshly branched from main's CURRENT
  // (post-merge) tip — has made zero commits of its own, but its HEAD now
  // contains victimWt's materialize commit via ordinary ancestry, the same as
  // any real worktree created after that PR merged.
  const scratchWt = linkedWorktreeOf(main);

  const out = pre.run({
    input: editInput(path.join(scratchWt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'interrupted' },
    cwd: scratchWt,
  });
  assert.deepStrictEqual(
    out, {},
    'a scratch worktree with no commits of its own must not be denied on account of an unrelated dangling run\'s inherited materialize commit',
  );
});

// Control for the test above: the SAME dangling-run shape (materialize landed,
// no worktree recorded) still denies when the calling worktree IS the one the
// materialize commit actually landed in — proving the allow above comes from
// "this worktree never touched that run," not from a broken fixture or a
// gate that stopped enforcing the record-worktree stamp altogether. This is
// the AC2 case (genuine /build worktree missing its own stamp must still be
// denied) exercised with THIS test's own fixture shape rather than reusing the
// file's line-97 test's fixture — the record-worktree deny AC2 already asks
// for is already covered there, but this control keeps the #1460 scenario's
// own fixtures self-verifying, the same pairing the file's existing I2.1 test
// (line 615) uses.
test('bookkeeping-stamps gate (#1460 control): the same dangling-run shape still denies when the calling worktree IS the one that materialized it', () => {
  const main = gitRepo();
  const ownWt = linkedWorktreeOf(main);
  const runId = '2026-08-23T204821-record-361';
  commitMaterializedSpec(ownWt, path.join('work', '361-spec.md'), runId);

  const project = projectDir();
  const run = path.join(project, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'interrupted' }));

  const out = pre.run({
    input: editInput(path.join(ownWt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'interrupted' },
    cwd: ownWt,
  });
  assert.ok(out.json && out.json.hookSpecificOutput, 'control: the worktree that actually materialized this run must still be denied for its missing worktree stamp');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/);
});
