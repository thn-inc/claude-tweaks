// tests/hooks-bookkeeping-stamps-gate-claim-memo.test.js
// Split from hooks-bookkeeping-stamps-gate.test.js for CI shard balance: the
// materialize-sentinel and claim-stamp cases, plus the prExempt / degrade-memo cases.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { fakeGh } = require('./helpers/fake-gh');
const { STUB_SKIP } = require('./helpers/path-stub');
const { FORGE_DEGRADE_MEMO_TTL_MS } = require('../plugin/bin/lib/policy-schema');
const {
  gitRepo,
  linkedWorktreeOf,
  RUN_ID,
  commitMaterializedSpec,
  projectDir,
  readEvents,
  mkRunDir,
  editInput,
  bashInput,
  degradeMemoFixture,
  readRunState,
} = require('./helpers/bookkeeping-stamps-gate');

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

test('AC1.1 (#3012): a paraphrased claim line (flow: claimed issue #991 via MCP transport) -> falls through past the claim branch to the worktree deny, not a claim deny', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '# Auto-Decision Log\n\n## /flow\n- AUTO 06:31:43 — log-decision: flow: claimed issue #991 via MCP transport (gh CLI unavailable); tombstone reclaim from prior run. Reversibility: high.\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected the NEXT check (worktree stamp, still unsatisfied) to deny');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/, 'must be the worktree deny, not a claim-log deny');
});

test('AC1.1 (#3012): a negated paraphrase (… never itself claimed #991 …) -> still the claim deny naming #991', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  writeGithubIssuesClaudeMd(wt);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const { run } = mkRunDir(projectDir(), null, undefined);
  fs.writeFileSync(path.join(run, 'decisions.md'), '# Auto-Decision Log\n\n## /flow\n- AUTO 16:14:57 — log-decision: Wrap-up outcome: pending-review. Separately noted: this run never itself claimed #991 via claim-targets.js. Reversibility: n/a.\n');
  const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active' }, cwd: wt });
  assert.ok(out.json, 'expected a deny result');
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /Step 2\.8/);
  assert.match(spec.permissionDecisionReason, /#991/);
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

test('bookkeeping-stamps gate (#4578 Q5): a degraded detection never persists prExempt — the next call detects again (AC15.2)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    {
      // Guarded so a one-argument call cannot throw into the catch branch and pass for the wrong reason.
      resolveIntegrationModel: (root, o) => {
        if (o && typeof o.onDegrade === 'function') o.onDegrade({ reason: 'timeout', timeoutMs: 5000, attempts: 2 });
        return 'local-merge';
      },
    },
  );
  // Fail-open: a degraded detection is not provably pr-first, so this call allows.
  assert.deepStrictEqual(out, {});
  const persisted = JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
  assert.strictEqual(
    persisted.prExempt, undefined,
    'a degraded detection must never persist prExempt — a later call might detect pr-first and need to enforce',
  );
});

test('bookkeeping-stamps gate (#4578 Q5): the override receives an onDegrade callback; a clean local-merge still persists prExempt', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bsg-proj-'));
  const { run } = mkRunDir(project, wt, undefined);
  let got;
  const out = pre.run(
    { input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
    { resolveIntegrationModel: (root, o) => { got = o; return 'local-merge'; } },
  );
  assert.deepStrictEqual(out, {});
  assert.strictEqual(typeof (got && got.onDegrade), 'function', 'the override must receive { onDegrade } as its second argument');
  const persisted = JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
  assert.strictEqual(persisted.prExempt, true, 'a clean local-merge resolution still persists prExempt');
});

// --- #4830: the gate passes the run-scoped degrade memo TTL ---
//
// These drive the REAL resolver (no `resolveIntegrationModel` override) through the
// gate with a fake `gh`. The fixture's main repo gets an origin remote so detection
// reaches the `gh` probe instead of returning `local-merge` at the git-remote step.
// The gate hardcodes HOOK_FORGE_PROBE_TIMEOUT_MS (5 s), so a 'hang' detection (two
// attempts) takes ~10 s here by design.
// (degradeMemoFixture / readRunState live in helpers/bookkeeping-stamps-gate.js.)

test('bookkeeping-stamps gate (#4830 AC1): three covered calls inside the TTL run one detection (two gh attempts) — the memo skips the rest', { skip: STUB_SKIP }, () => {
  const { wt, project } = degradeMemoFixture();
  const { run } = mkRunDir(project, wt, undefined);
  const gh = fakeGh({ first: 'hang' });
  try {
    const input = editInput(path.join(wt, 'src', 'x.js'));
    // Call 1 detects: two hook-bounded attempts, both hang, so the detection degrades and stamps the memo.
    assert.deepStrictEqual(pre.run({ input, runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt }), {});
    assert.strictEqual(gh.count(), 2, 'call 1 spends the two bounded attempts');
    // Calls 2 and 3 load run-state.json from disk, as a fresh hook process would.
    assert.deepStrictEqual(pre.run({ input, runDir: run, runState: readRunState(run), cwd: wt }), {});
    assert.deepStrictEqual(pre.run({ input, runDir: run, runState: readRunState(run), cwd: wt }), {});
    assert.strictEqual(gh.count(), 2, 'calls 2 and 3 are inside the TTL — the memo skips the probe');
    const persisted = readRunState(run);
    assert.strictEqual(typeof persisted.forgeDegradedAt, 'number', 'the degrade stamp is persisted');
    assert.strictEqual(persisted.prExempt, undefined, 'a degraded or memoized detection never persists prExempt');
  } finally {
    gh.restore();
  }
});

test('bookkeeping-stamps gate (#4830 AC3): an expired memo plus a recovered gh clears the memo and persists prExempt', { skip: STUB_SKIP }, () => {
  const { wt, project } = degradeMemoFixture();
  const { run } = mkRunDir(project, wt, undefined, { forgeDegradedAt: Date.now() - 2 * FORGE_DEGRADE_MEMO_TTL_MS });
  // 'fail' is a definitive answer (exit 1, no timeout): detection resolves local-merge cleanly.
  const gh = fakeGh({ first: 'fail' });
  try {
    const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: readRunState(run), cwd: wt });
    assert.deepStrictEqual(out, {});
    assert.strictEqual(gh.count(), 1, 'the expired memo re-probes');
    const persisted = readRunState(run);
    assert.strictEqual(persisted.forgeDegradedAt, null, 'a clean detection clears the memo');
    assert.strictEqual(persisted.prExempt, true, 'a clean local-merge verdict persists prExempt');
  } finally {
    gh.restore();
  }
});

// The safety direction of Q5: once the memo expires and `gh` answers, a
// GitHub-backed run resolves pr-first again and the gate enforces. Red against
// the mutation `return model;` -> `return 'local-merge';` at the end of
// resolveRunPinnedIntegrationModel, which every 'fail'-mode recovery case misses.
test('bookkeeping-stamps gate (#4830): an expired memo plus a recovered gh resolving pr-first clears the memo and denies (enforcement returns)', { skip: STUB_SKIP }, () => {
  const { wt, project } = degradeMemoFixture();
  const { run } = mkRunDir(project, wt, undefined, { forgeDegradedAt: Date.now() - 2 * FORGE_DEGRADE_MEMO_TTL_MS });
  const gh = fakeGh({ first: 'ok' });
  try {
    const out = pre.run({ input: editInput(path.join(wt, 'src', 'x.js')), runDir: run, runState: readRunState(run), cwd: wt });
    assert.ok(out.json, 'expected a deny once the recovered detection resolves pr-first with no PR recorded');
    const spec = out.json.hookSpecificOutput;
    assert.strictEqual(spec.permissionDecision, 'deny');
    assert.match(spec.permissionDecisionReason, /record-pr|PR-early/);
    assert.strictEqual(gh.count(), 1, 'the expired memo re-probes once');
    const persisted = readRunState(run);
    assert.strictEqual(persisted.forgeDegradedAt, null, 'a clean detection clears the memo');
    assert.strictEqual(persisted.prExempt, undefined, 'a pr-first verdict never persists prExempt');
  } finally {
    gh.restore();
  }
});

