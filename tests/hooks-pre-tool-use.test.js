// tests/hooks-pre-tool-use.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  return fs.realpathSync(dir);
}
function mkRun(worktree, sessionId) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1run-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  const state = worktree ? { status: 'active', worktree } : { status: 'active' };
  if (sessionId !== undefined) state.sessionId = sessionId;
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { run, state };
}
// Multi-run helpers: several run dirs living under the SAME project, so
// listRunDirs(ctx.cwd) can see siblings — mirrors two parallel /flow
// terminals sharing one main checkout.
function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1proj-'));
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines'), { recursive: true });
  return dir;
}
function mkRunAt(project, name, worktree) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  const state = { status: 'active', worktree };
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { run, state };
}
// #861: a REAL main checkout + a REAL linked worktree of it (not two
// independent gitRepo() dirs) — needed by every "wrong checkout, still
// in-project" E1 test below, now that the gate distinguishes "wrong location
// WITHIN this project" (still denied) from "an entirely unrelated repo"
// (allowed) via wtDetect.mainCheckoutRoot(). Two independent gitRepo() dirs
// have no shared main-checkout root, so they now read as two different
// projects — which is exactly the OUT-of-project scenario, not the
// wrong-checkout-of-THIS-project scenario most of these tests intend.
function mainAndWorktree() {
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  return { main, wt };
}
const bashInput = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('commit in the assigned worktree is allowed', () => {
  const wt = gitRepo();
  const { run, state } = mkRun(wt);
  const out = pre.run({ input: bashInput('git commit -m "x"', wt), runDir: run, runState: state, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('commit in the main checkout is still denied with corrective reason', () => {
  const { main, wt } = mainAndWorktree();
  const { run, state } = mkRun(wt);
  const out = pre.run({ input: bashInput('git commit -m "x"', main), runDir: run, runState: state, cwd: main });
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, new RegExp(esc(wt)));
  assert.match(spec.permissionDecisionReason, /git -C/);
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"wd-deny"/);
});

test('commit in an out-of-repo scratch git repo is allowed (#861)', () => {
  // The over-match this record fixes: a probe subagent committing a scratch
  // fixture repo entirely OUTSIDE this project (not the main checkout, not
  // any known worktree) must not be denied — the gate's purpose is keeping
  // THIS repo's edits in the worktree, not policing unrelated repositories.
  const { wt } = mainAndWorktree();
  const scratch = gitRepo(); // an unrelated repo — no shared main checkout with wt
  const { run, state } = mkRun(wt);
  const out = pre.run({ input: bashInput('git commit -m "x"', scratch), runDir: run, runState: state, cwd: scratch });
  assert.deepStrictEqual(out, {});
});

test('wrong-checkout commit from a FOREIGN session is allowed with a warn and logs wd-foreign-session', () => {
  const { main, wt } = mainAndWorktree();
  const { run, state } = mkRun(wt, 'owner-session');
  const input = { ...bashInput('git commit -m "x"', main), session_id: 'bystander-session' };
  const out = pre.run({ input, runDir: run, runState: state, cwd: main });
  assert.ok(!(out.json && out.json.hookSpecificOutput), 'foreign-session commit must not be denied');
  assert.match(out.json.systemMessage, /allowing this commit/);
  assert.match(out.json.systemMessage, new RegExp(esc(wt)));
  assert.match(out.json.systemMessage, /2026-07-01T090000-spec-1/);
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"wd-foreign-session"/);
  assert.doesNotMatch(events, /"type":"wd-deny"/);
});

test('wrong-checkout commit from the OWNING session is still denied', () => {
  const { main, wt } = mainAndWorktree();
  const { run, state } = mkRun(wt, 'owner-session');
  const input = { ...bashInput('git commit -m "x"', main), session_id: 'owner-session' };
  const out = pre.run({ input, runDir: run, runState: state, cwd: main });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"wd-deny"/);
});

test('missing or malformed session identity on either side falls back to deny (status quo)', () => {
  // Legacy run-state (no recorded owner), caller id present.
  const { main: legacyMain, wt: legacyWt } = mainAndWorktree();
  const legacy = mkRun(legacyWt);
  const legacyOut = pre.run({
    input: { ...bashInput('git commit -m "x"', legacyMain), session_id: 'bystander-session' },
    runDir: legacy.run, runState: legacy.state, cwd: legacyMain,
  });
  assert.strictEqual(legacyOut.json.hookSpecificOutput.permissionDecision, 'deny');

  // Owner recorded, caller id absent from hook input.
  const { main: noCallerMain, wt: noCallerWt } = mainAndWorktree();
  const noCaller = mkRun(noCallerWt, 'owner-session');
  const noCallerOut = pre.run({
    input: bashInput('git commit -m "x"', noCallerMain),
    runDir: noCaller.run, runState: noCaller.state, cwd: noCallerMain,
  });
  assert.strictEqual(noCallerOut.json.hookSpecificOutput.permissionDecision, 'deny');

  // Corrupt owner (non-string) never counts as identity.
  const { main: corruptMain, wt: corruptWt } = mainAndWorktree();
  const corrupt = mkRun(corruptWt, { nested: true });
  const corruptOut = pre.run({
    input: { ...bashInput('git commit -m "x"', corruptMain), session_id: 'bystander-session' },
    runDir: corrupt.run, runState: corrupt.state, cwd: corruptMain,
  });
  assert.strictEqual(corruptOut.json.hookSpecificOutput.permissionDecision, 'deny');
});

// #1563 / #1099: this gate's own ownership check now runs through
// classifyOwnership (#1098) instead of the old raw `owner && caller &&
// owner !== caller` comparison — the explicit decision this test was
// originally pinned to force (see its prior revision's comment, preserved in
// git history). The scenario in "missing or malformed session identity...
// falls back to deny" above uses the MAIN checkout as the caller's cwd, which
// classifyOwnership classifies 'indeterminate' there (its own
// !isLinkedWorktree check) — that scenario is unaffected by this change.
// THIS test puts the caller in a genuinely different LINKED worktree (not
// main, not the run's own assigned worktree) — the case where
// classifyOwnership's binding comparison alone proves 'foreign' regardless of
// session id (#1098's semantics table: "equal or either missing | recorded,
// exists | inside a different live worktree | foreign"). This is the intended
// broadening #1099 exists to ship, not a silent regression: the same
// worktree-binding proof `resolveRun`'s fallback arm has used since #1410 now
// applies uniformly at this gate too.
test('#1563/#1099: commit from a genuinely different LIVE worktree, run has no recorded owner, is foreign-allowed (with systemMessage) — with and without a caller session_id', () => {
  const { main, wt: assignedWt } = mainAndWorktree();
  const callerWt = linkedWorktreeOf(main); // a second, genuinely different live worktree of the same repo
  const { run, state } = mkRun(assignedWt); // no sessionId recorded

  const withoutSessionId = pre.run({
    input: bashInput('git commit -m "x"', callerWt), runDir: run, runState: state, cwd: callerWt,
  });
  assert.strictEqual(withoutSessionId.json.hookSpecificOutput, undefined);
  assert.ok(withoutSessionId.json.systemMessage && withoutSessionId.json.systemMessage.includes('different session'));

  const withSessionId = pre.run({
    input: { ...bashInput('git commit -m "x"', callerWt), session_id: 'caller-session' },
    runDir: run, runState: state, cwd: callerWt,
  });
  assert.strictEqual(withSessionId.json.hookSpecificOutput, undefined);
  assert.ok(withSessionId.json.systemMessage && withSessionId.json.systemMessage.includes('different session'));
});

// AC1 dual case: the caller's OWN cwd (ctx.cwd — where the session stands,
// not the git command's -C target) inside the recorded (assigned) worktree
// still classifies 'mine' and denies, even with no sessionId recorded —
// proving the broadening above is scoped to a genuine cross-worktree
// mismatch, not a general loosening. Uses `git -C {elsewhereWt}` so the
// command's own TARGET differs from `assigned` (reaching the ownership
// check at all requires that mismatch), while the session's own cwd
// (classifyOwnership's second input) stays inside `assignedWt`.
test('#1099 AC1 dual case: session cwd inside the assigned worktree still denies (classifies mine) even when the git target differs, with no sessionId', () => {
  const { main, wt: assignedWt } = mainAndWorktree();
  const elsewhereWt = linkedWorktreeOf(main); // a second, genuinely different live worktree of the same repo
  const { run, state } = mkRun(assignedWt); // no sessionId recorded
  const out = pre.run({
    input: bashInput(`git -C ${elsewhereWt} commit -m "x"`, assignedWt),
    runDir: run, runState: state, cwd: assignedWt,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('git -C into the assigned worktree from elsewhere is allowed', () => {
  const wt = gitRepo();
  const other = gitRepo();
  const { run, state } = mkRun(wt);
  const out = pre.run({ input: bashInput(`git -C ${wt} commit -m "x"`, other), runDir: run, runState: state, cwd: other });
  assert.deepStrictEqual(out, {});
});

test('push mismatch logs but never denies', () => {
  const { main, wt } = mainAndWorktree();
  const { run, state } = mkRun(wt);
  const out = pre.run({ input: bashInput('git push origin main', main), runDir: run, runState: state, cwd: main });
  assert.deepStrictEqual(out, {});
  const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"wd-push-mismatch"/);
});

test('ambiguity allows: no worktree assigned, non-repo dir, non-Bash tool, no run dir', () => {
  const wt = gitRepo();
  const { run, state } = mkRun(null);
  assert.deepStrictEqual(pre.run({ input: bashInput('git commit -m "x"', wt), runDir: run, runState: state, cwd: wt }), {});
  const assigned = mkRun(wt);
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-nonrepo-'));
  assert.deepStrictEqual(pre.run({ input: bashInput('git commit -m "x"', nonRepo), runDir: assigned.run, runState: assigned.state, cwd: nonRepo }), {});
  assert.deepStrictEqual(pre.run({ input: { tool_name: 'Edit', tool_input: {}, cwd: wt }, runDir: assigned.run, runState: assigned.state, cwd: wt }), {});
  assert.deepStrictEqual(pre.run({ input: bashInput('git commit -m "x"', wt), runDir: null, runState: null, cwd: wt }), {});
});

test('two live runs: commit in the OLDER run\'s own worktree is allowed even when the resolved run is the NEWER one, and logs wd-ambiguous on the resolved run', () => {
  const project = tmpProject();
  const olderWt = gitRepo();
  const newerWt = gitRepo();
  mkRunAt(project, '2026-07-01T090000-spec-1', olderWt); // older, non-terminal, NOT the resolved run
  const newer = mkRunAt(project, '2026-07-02T090000-spec-2', newerWt); // resolved run

  const out = pre.run({
    input: bashInput(`git -C ${olderWt} commit -m "x"`, project),
    runDir: newer.run,
    runState: newer.state,
    cwd: project,
  });
  assert.deepStrictEqual(out, {});
  const events = fs.readFileSync(path.join(newer.run, 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"wd-ambiguous"/);
  assert.match(events, new RegExp(esc(olderWt)));
});

test('three concurrent live runs: a commit in THIS run\'s own assigned worktree never logs wd-ambiguous, even with multiple unrelated sibling worktrees registered as live candidates (#1329)', () => {
  const project = tmpProject();
  const main = gitRepoWithCommit();
  const ownWt = linkedWorktreeOf(main);
  const siblingWtA = linkedWorktreeOf(main);
  const siblingWtB = linkedWorktreeOf(main);
  // Two unrelated concurrent sibling runs registered BEFORE the resolved
  // run, and the resolved run's own worktree is a real, resolvable exact
  // match for the target — the exact-match short-circuit (actual ===
  // assigned) must win over the otherWorktrees ambiguous-match branch for
  // every target in this command, regardless of how many other live
  // worktrees exist to potentially (mis)match against.
  mkRunAt(project, '2026-07-01T090000-spec-1', siblingWtA);
  mkRunAt(project, '2026-07-02T090000-spec-2', siblingWtB);
  const own = mkRunAt(project, '2026-07-03T090000-spec-3', ownWt);

  const out = pre.run({
    input: bashInput(`git -C ${ownWt} commit -m "x"`, project),
    runDir: own.run,
    runState: own.state,
    cwd: project,
  });
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(own.run, 'events.jsonl')), 'no wd-ambiguous (or any) event should be logged for a genuine exact match');
});

test('two live runs: commit in a THIRD repo matching neither worktree is still denied, reason mentions both worktrees', () => {
  const project = tmpProject();
  // thirdRepo = the shared main checkout itself: a THIRD checkout of the SAME
  // project (still in-scope for this gate), distinct from thirdRepo being a
  // genuinely unrelated repo (which #861 now allows — covered by its own
  // test above).
  const main = gitRepoWithCommit();
  const olderWt = linkedWorktreeOf(main);
  const newerWt = linkedWorktreeOf(main);
  const thirdRepo = main;
  mkRunAt(project, '2026-07-01T090000-spec-1', olderWt);
  const newer = mkRunAt(project, '2026-07-02T090000-spec-2', newerWt);

  const out = pre.run({
    input: bashInput(`git -C ${thirdRepo} commit -m "x"`, project),
    runDir: newer.run,
    runState: newer.state,
    cwd: project,
  });
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, new RegExp(esc(newerWt)));
  assert.match(spec.permissionDecisionReason, new RegExp(esc(olderWt)));
});

test('two live runs: a push mismatch matching another live worktree is not logged at all', () => {
  const project = tmpProject();
  const olderWt = gitRepo();
  const newerWt = gitRepo();
  mkRunAt(project, '2026-07-01T090000-spec-1', olderWt);
  const newer = mkRunAt(project, '2026-07-02T090000-spec-2', newerWt);

  const out = pre.run({
    input: bashInput(`git -C ${olderWt} push origin main`, project),
    runDir: newer.run,
    runState: newer.state,
    cwd: project,
  });
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(newer.run, 'events.jsonl')));
});

test('deny reason substitutes CLAUDE_PLUGIN_ROOT when set, else keeps the literal placeholder', () => {
  const { main, wt } = mainAndWorktree();
  const orig = process.env.CLAUDE_PLUGIN_ROOT;

  try {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const { run: run1, state: state1 } = mkRun(wt);
    const withoutEnv = pre.run({ input: bashInput('git commit -m "x"', main), runDir: run1, runState: state1, cwd: main });
    assert.match(withoutEnv.json.hookSpecificOutput.permissionDecisionReason, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js/);

    process.env.CLAUDE_PLUGIN_ROOT = '/opt/claude-tweaks';
    const { run: run2, state: state2 } = mkRun(wt);
    const withEnv = pre.run({ input: bashInput('git commit -m "x"', main), runDir: run2, runState: state2, cwd: main });
    assert.match(withEnv.json.hookSpecificOutput.permissionDecisionReason, /\/opt\/claude-tweaks\/bin\/hooks\.js/);
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = orig;
  }
});

function gitRepoWithCommit() {
  const dir = gitRepo();
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return dir;
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

function withPolicy(repo, content) {
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), content);
}

test('worktree-required: policy off allows Edit/Write/NotebookEdit/commit in the main checkout', () => {
  const repo = gitRepoWithCommit();
  assert.deepStrictEqual(pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.txt') } }, runDir: null, runState: null, cwd: repo }), {});
  assert.deepStrictEqual(pre.run({ input: { tool_name: 'Write', tool_input: { file_path: path.join(repo, 'b.txt') } }, runDir: null, runState: null, cwd: repo }), {});
  assert.deepStrictEqual(pre.run({ input: { tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(repo, 'n.ipynb') } }, runDir: null, runState: null, cwd: repo }), {});
  assert.deepStrictEqual(pre.run({ input: bashInput('git commit -m "x"', repo), runDir: null, runState: null, cwd: repo }), {});
});

test('worktree-required: denies a covered Edit outside a worktree under the pre-#602 spelling worktree.always: true — the alias keeps un-migrated projects gated', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree.always: true\n');
  const out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.txt') } }, runDir: null, runState: null, cwd: repo });
  const spec = out.json.hookSpecificOutput;
  assert.strictEqual(spec.permissionDecision, 'deny');
  assert.match(spec.permissionDecisionReason, /worktree-always/);
  assert.match(spec.permissionDecisionReason, /using-git-worktrees/);
});

// ─── the indeterminate branch (#134) ───────────────────────────────────────
//
// `wtDetect.repoInfo` is looked up off the module object at call time, so
// replacing the property here reaches the real gate without a production seam.
test('worktree-required: an indeterminate repo status ALLOWS but says so out loud (#134)', () => {
  const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const real = wtDetect.repoInfo;
  wtDetect.repoInfo = () => ({ repoRoot: null, isLinkedWorktree: false, indeterminate: true });
  let out;
  try {
    out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.txt') } }, runDir: null, runState: null, cwd: repo });
  } finally {
    wtDetect.repoInfo = real;
  }
  // Allowed: CLAUDE.md's hooks contract is never-break-a-session, and denying
  // on a transient load spike would freeze unattended runs.
  assert.ok(!out.json || !out.json.hookSpecificOutput || out.json.hookSpecificOutput.permissionDecision !== 'deny',
    'an indeterminate git answer must not produce a deny');
  // But no longer silent — the whole defect in #134 was that a load spike and a
  // non-repo were byte-identical, so an enforcement gap left no trace at all.
  assert.match(out.json.systemMessage, /could not determine/i);
  // Says the CHECK could not run — not that a policy was skipped. Reaching this
  // branch proves only that a policy.yml exists somewhere up the chain, not that
  // worktree-always is on for this repo (that needs a repoRoot we never got).
  assert.match(out.json.systemMessage, /check could not run/);
  assert.doesNotMatch(out.json.systemMessage, /gate was NOT applied/,
    'must not assert a policy applied that may not exist');
  assert.strictEqual(out.exit, 0, 'every hook path exits 0, warnings included');
});

test('worktree-required: a DEFINITIVE non-repo answer allows silently, with no warning (#134)', () => {
  // The control that gives the test above its meaning. Both cases yield
  // repoRoot: null; only the indeterminate one warns. Without this, a blanket
  // "always warn on null" implementation would pass the assertion above while
  // spamming every non-git path in the project.
  const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const real = wtDetect.repoInfo;
  wtDetect.repoInfo = () => ({ repoRoot: null, isLinkedWorktree: false, indeterminate: false });
  let out;
  try {
    out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.txt') } }, runDir: null, runState: null, cwd: repo });
  } finally {
    wtDetect.repoInfo = real;
  }
  assert.ok(!out.json || !out.json.systemMessage,
    'git answering "not a repo" is a real answer — nothing to warn about');
});

test('worktree-required: policy on allows Edit inside a linked worktree', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'a.txt') } }, runDir: null, runState: null, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: policy on denies Write to a not-yet-existing file, and NotebookEdit, in the main checkout', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const writeOut = pre.run({ input: { tool_name: 'Write', tool_input: { file_path: path.join(repo, 'new', 'brand-new.txt') } }, runDir: null, runState: null, cwd: repo });
  assert.strictEqual(writeOut.json.hookSpecificOutput.permissionDecision, 'deny');
  const nbOut = pre.run({ input: { tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(repo, 'n.ipynb') } }, runDir: null, runState: null, cwd: repo });
  assert.strictEqual(nbOut.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('worktree-required: policy on denies a git commit in the main checkout even with NO pipeline run dir at all', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git commit -m "x"', repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('worktree-required: policy on denies a bare "git push" in the main checkout, not just "git commit" (finding regression)', () => {
  // checkWorktreeRequired's Bash-command target detection previously only
  // recognized gitTargets(...).find(t => t.action === 'commit'), never
  // 'push' — a `git push` with no accompanying `git commit` in the same
  // invocation never set targetPath, so the gate returned {} (allow)
  // unconditionally, contradicting both the deny message below and
  // CLAUDE.md's Hooks section, which both state the policy covers
  // "git commit/push".
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin main', repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny', 'a bare git push must be denied from a non-isolated checkout, same as git commit');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /worktree-always/);
});

test('worktree-required: policy on allows "git push" from inside a linked worktree', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({ input: bashInput('git push origin HEAD', wt), runDir: null, runState: null, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: policy is read from the EDIT TARGET\'s own repo, not the session cwd', () => {
  const policyRepo = gitRepoWithCommit();
  withPolicy(policyRepo, 'worktree-always: true\n');
  const otherRepo = gitRepoWithCommit(); // no policy
  const out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(otherRepo, 'a.txt') } }, runDir: null, runState: null, cwd: policyRepo });
  assert.deepStrictEqual(out, {});
});

test('deny paths always carry exit: 0 — the deny signal is JSON permissionDecision, never the process exit code', () => {
  // Claude Code's PreToolUse deny is communicated entirely via
  // hookSpecificOutput.permissionDecision on stdout with exit 0; exit 2 is a
  // separate, stderr-only mechanism that would drop the custom
  // permissionDecisionReason built by this module. A future edit that adds a
  // non-zero exit to either deny path (worktree-required gate or wd-deny),
  // e.g. to chase CLAUDE.md's misleading "the only deliberate non-zero
  // outcome is the pre-tool-use deny" line, would break the corrective
  // reason message actually shown — this test guards against that.
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const gateOut = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.txt') } }, runDir: null, runState: null, cwd: repo });
  assert.strictEqual(gateOut.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(gateOut.exit, 0);

  const { main, wt } = mainAndWorktree();
  const { run, state } = mkRun(wt);
  const wdOut = pre.run({ input: bashInput('git commit -m "x"', main), runDir: run, runState: state, cwd: main });
  assert.strictEqual(wdOut.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(wdOut.exit, 0);
});

test('worktree-required: a policy file in an ancestor directory OUTSIDE the target repo does not leak in (repo-scoped, not filesystem-ancestor-scoped)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-ancestor-'));
  withPolicy(parent, 'worktree-always: true\n');
  const nestedRepo = path.join(parent, 'nested-repo');
  fs.mkdirSync(nestedRepo, { recursive: true });
  execFileSync('git', ['-C', nestedRepo, 'init', '-q']);
  execFileSync('git', ['-C', nestedRepo, 'commit', '--allow-empty', '-m', 'init', '-q']);
  const out = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: path.join(nestedRepo, 'a.txt') } }, runDir: null, runState: null, cwd: nestedRepo });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: policy on denies a non-git Bash file write in the main checkout (tee, cp, mv)', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const target = path.join(repo, 'a.txt');

  const tee = pre.run({ input: bashInput(`echo hi | tee ${target}`, repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(tee.json.hookSpecificOutput.permissionDecision, 'deny');

  const cp = pre.run({ input: bashInput(`cp source.txt ${target}`, repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(cp.json.hookSpecificOutput.permissionDecision, 'deny');

  const mv = pre.run({ input: bashInput(`mv source.txt ${target}`, repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(mv.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('worktree-required: a non-git Bash file write inside a linked worktree is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(repo);
  const target = path.join(wt, 'a.txt');
  const out = pre.run({ input: bashInput(`cp source.txt ${target}`, wt), runDir: null, runState: null, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: /dev/null is not treated as a file-write target', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('cp source.txt /dev/null', repo), runDir: null, runState: null, cwd: repo });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: a Bash command with no file-write shape at all (e.g. a plain read) is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('cat a.txt | grep foo', repo), runDir: null, runState: null, cwd: repo });
  assert.deepStrictEqual(out, {});
});

test('worktree-required: a compound Bash command checks EVERY git commit/push target, not just the first (finding regression)', () => {
  // checkWorktreeRequired previously took only gitTargets(...).find(...) —
  // the FIRST commit/push target in the command. A compliant first target
  // (no policy, or an isolated worktree) short-circuited enforcement for
  // every subsequent target in the same compound command.
  const compliant = gitRepoWithCommit(); // no policy.yml — first target, must not mask what follows
  const violating = gitRepoWithCommit();
  withPolicy(violating, 'worktree-always: true\n');
  const out = pre.run({
    input: bashInput(`git -C ${compliant} commit -q --allow-empty -m "a" && git -C ${violating} commit -q --allow-empty -m "b"`, compliant),
    runDir: null, runState: null, cwd: compliant,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
    'the second target violates worktree-always and must be caught even though the first target was compliant');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, new RegExp(esc(violating)));
});

test('worktree-required: a compound Bash command checks EVERY cp/mv/tee write target, not just the first (finding regression)', () => {
  const compliant = gitRepoWithCommit();
  const violating = gitRepoWithCommit();
  withPolicy(violating, 'worktree-always: true\n');
  const out = pre.run({
    input: bashInput(
      `cp source.txt ${path.join(compliant, 'a.txt')} && cp source.txt ${path.join(violating, 'b.txt')}`,
      compliant,
    ),
    runDir: null, runState: null, cwd: compliant,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
    'the second cp destination violates worktree-always and must be caught even though the first was compliant');
});

// --- .claude-tweaks/pipelines/ bookkeeping exemption (#138) ---
//
// /wrap-up must copy a run's gitignored audit state (config.yml, decisions.md,
// events.jsonl, staged/) from the worktree into the main checkout's archive
// BEFORE `git worktree remove` deletes it. That copy is a plain `cp` into the
// main checkout, which the gate denied — so every worktree-always project lost
// decisions.md on every run, silently, because a denied tool call mid-cleanup
// is not a hard stop.

function archivePathIn(repo, leaf) {
  return path.join(repo, '.claude-tweaks', 'pipelines', 'archive', 'run-1', leaf);
}

// The gate reads policy from the TARGET's repo, and a linked worktree only sees
// a committed policy.yml — so these fixtures commit it before branching.
function repoWithCommittedPolicy() {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  return repo;
}

test('worktree-required: a cp into the main checkout\'s .claude-tweaks/pipelines/ is ALLOWED from a worktree (#138)', () => {
  const repo = repoWithCommittedPolicy();
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({
    input: bashInput(`cp ${path.join(wt, 'decisions.md')} ${archivePathIn(repo, 'decisions.md')}`, wt),
    runDir: null, runState: null, cwd: wt,
  });
  assert.deepStrictEqual(out, {}, 'pipeline bookkeeping is not the project work this gate isolates');
});

test('worktree-required: a cp into any OTHER main-checkout path is still denied from the same worktree (#138)', () => {
  const repo = repoWithCommittedPolicy();
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({
    input: bashInput(`cp ${path.join(wt, 'x.js')} ${path.join(repo, 'src', 'x.js')}`, wt),
    runDir: null, runState: null, cwd: wt,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
    'the exemption must not widen into a general main-checkout write permit');
});

test('worktree-required: the exemption is a prefix on pipelines/, not on .claude-tweaks/ (#138)', () => {
  // A prefix test one segment too short would exempt every file under
  // .claude-tweaks/. policy.yml itself is now separately, deliberately exempt
  // (#537 — its own exact-path exemption, tested in
  // hooks-policy-exemption.test.js), so this uses a SIBLING file that no
  // exemption names: it must stay gated, proving the pipelines/ prefix does
  // not leak one segment up.
  const repo = repoWithCommittedPolicy();
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({
    input: { tool_name: 'Write', tool_input: { file_path: path.join(repo, '.claude-tweaks', 'other.yml') } },
    runDir: null, runState: null, cwd: wt,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
    '.claude-tweaks/other.yml is not under .claude-tweaks/pipelines/ and must stay gated');
});

test('worktree-required: git commit/push stay denied even when issued from inside .claude-tweaks/pipelines/ (#138)', () => {
  // gitTargets yields the command's working DIRECTORY, not a file. Applying the
  // path-prefix exemption to those targets would let any commit run from a cwd
  // under .claude-tweaks/pipelines/ — exactly the isolation being enforced.
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-08-06T000000-record-1');
  fs.mkdirSync(runDir, { recursive: true });
  for (const cmd of ['git commit -m "x"', 'git push origin main']) {
    const out = pre.run({ input: bashInput(cmd, runDir), runDir: null, runState: null, cwd: runDir });
    assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
      `${cmd} from inside a run dir must stay denied — the exemption covers file writes only`);
  }
});

test('worktree-required: a Write into the main checkout\'s run-dir archive is allowed, same as cp (#138)', () => {
  const repo = repoWithCommittedPolicy();
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({
    input: { tool_name: 'Write', tool_input: { file_path: archivePathIn(repo, 'config.yml') } },
    runDir: null, runState: null, cwd: wt,
  });
  assert.deepStrictEqual(out, {}, 'the exemption is about what the path IS, not which tool writes it');
});

test('isPipelineBookkeeping fails closed on anything it cannot prove (#138)', () => {
  const repo = '/tmp/some-repo';
  const good = path.join(repo, '.claude-tweaks', 'pipelines', 'run-1', 'decisions.md');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, good), true, 'the positive case must actually match');
  // Each of these must be false, or the gate opens on input it never proved.
  assert.strictEqual(pre.isPipelineBookkeeping(repo, '.claude-tweaks/pipelines/run-1/x'), false, 'relative path is unprovable');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, ''), false, 'empty path');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, null), false, 'null path');
  assert.strictEqual(pre.isPipelineBookkeeping(null, good), false, 'null repoRoot');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, path.join(repo, '.claude-tweaks', 'pipelines')), false,
    'the directory itself is not a write target under it');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, '/tmp/other-repo/.claude-tweaks/pipelines/run-1/x'), false,
    'another repo\'s pipelines dir is not this repo\'s bookkeeping');
  assert.strictEqual(pre.isPipelineBookkeeping(repo, path.join(repo, '.claude-tweaks', 'pipelines-evil', 'x')), false,
    'sibling directory sharing the prefix string must not match');
});

// --- named Bash write shapes beyond cp/mv/tee (#70) ---
//
// `sed -i /abs/path/in/main-checkout/file` used to reach the main checkout
// silently: hooks.json never spawned the hook for it, so fileWriteTargets was
// never consulted. The deny direction is the point — but so is NOT denying a
// read, since `sed -n` against the main checkout has to keep working.

function policedRepo() {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  return repo;
}
const decisionOf = (out) => (out.json ? out.json.hookSpecificOutput.permissionDecision : 'allow');

test('worktree-required: sed -i against the main checkout is denied (#70)', () => {
  const repo = policedRepo();
  for (const cmd of [
    `sed -i 's/x/y/' ${path.join(repo, 'a.js')}`,
    `sed -i.bak -e 's/x/y/' ${path.join(repo, 'a.js')}`,
    `sed -i '' -e 's/x/y/' ${path.join(repo, 'a.js')}`, // BSD: suffix is a separate arg
    `sed -ni 's/x/y/p' ${path.join(repo, 'a.js')}`, // bundled short flags
  ]) {
    const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
    assert.strictEqual(decisionOf(out), 'deny', `must deny: ${cmd}`);
  }
});

test('worktree-required: a READ-only sed against the main checkout stays allowed (#70)', () => {
  const repo = policedRepo();
  for (const cmd of [
    `sed -n '1,5p' ${path.join(repo, 'a.js')}`,
    `sed 's/x/y/' ${path.join(repo, 'a.js')}`,
    `sed -e 's/x/y/' ${path.join(repo, 'a.js')}`,
  ]) {
    const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
    assert.deepStrictEqual(out, {}, `must allow (no in-place flag): ${cmd}`);
  }
});

test('worktree-required: perl -i against the main checkout is denied, -I is not in-place (#70)', () => {
  const repo = policedRepo();
  const denied = pre.run({
    input: bashInput(`perl -pi -e 's/x/y/' ${path.join(repo, 'a.js')}`, '/tmp'),
    runDir: null, runState: null, cwd: '/tmp',
  });
  assert.strictEqual(decisionOf(denied), 'deny', 'perl -pi is an in-place edit');
  // -Idir contains an 'i' but is an include path, not --in-place. Treating it
  // as in-place would deny an ordinary read-only perl invocation.
  const allowed = pre.run({
    input: bashInput(`perl -Ilib -e 'print 1' ${path.join(repo, 'a.js')}`, '/tmp'),
    runDir: null, runState: null, cwd: '/tmp',
  });
  assert.deepStrictEqual(allowed, {}, 'perl -Ilib must not be read as in-place');
});

test('worktree-required: install/ln/truncate/dd against the main checkout are denied (#70)', () => {
  const repo = policedRepo();
  for (const cmd of [
    `install -m 644 /tmp/src ${path.join(repo, 'a.js')}`,
    `install -d ${path.join(repo, 'newdir')}`,
    `ln -sf /tmp/src ${path.join(repo, 'link.js')}`,
    `truncate -s 0 ${path.join(repo, 'a.js')}`,
    `dd if=/dev/zero of=${path.join(repo, 'a.js')}`,
  ]) {
    const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
    assert.strictEqual(decisionOf(out), 'deny', `must deny: ${cmd}`);
  }
});

test('worktree-required: the new shapes are allowed inside a worktree and under pipelines/ (#70)', () => {
  const repo = policedRepo();
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(repo);
  const inWorktree = pre.run({
    input: bashInput(`sed -i 's/x/y/' ${path.join(wt, 'a.js')}`, wt),
    runDir: null, runState: null, cwd: wt,
  });
  assert.deepStrictEqual(inWorktree, {}, 'editing inside the worktree is the whole point of the policy');
  // #138's exemption must apply to the new shapes too, not just cp/mv/tee.
  const inPipelines = pre.run({
    input: bashInput(`sed -i 's/x/y/' ${path.join(repo, '.claude-tweaks', 'pipelines', 'archive', 'r', 'decisions.md')}`, wt),
    runDir: null, runState: null, cwd: wt,
  });
  assert.deepStrictEqual(inPipelines, {}, 'pipeline bookkeeping stays exempt for every write shape');
});

test('worktree-required: an unprovable target on a new shape fabricates nothing (#70)', () => {
  // Fails closed the same direction as cp/mv/tee: a path this cannot resolve
  // yields no target rather than a guess. [IL-50] — "looks like its sibling"
  // is not "fails like its sibling".
  const repo = policedRepo();
  for (const cmd of [
    'sed -i \'s/x/y/\' "$SOME_VAR"',
    'sed -i \'s/x/y/\' ~/elsewhere.js',
    'truncate -s 0 "$F"',
    'dd if=/dev/zero of="$OUT"',
    'ln -sf /tmp/src "$DEST"',
  ]) {
    const out = pre.run({ input: bashInput(cmd, repo), runDir: null, runState: null, cwd: repo });
    assert.deepStrictEqual(out, {}, `must not fabricate a target from: ${cmd}`);
  }
});

test('worktree-required: a same-command shell variable resolving inside the repo is now denied (#630)', () => {
  const repo = policedRepo();
  const cmd = `WT=${repo}; sed -i 's/x/y/' "$WT/a.js"`;
  const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
  assert.strictEqual(decisionOf(out), 'deny', 'a same-command variable resolving inside the policed repo must now be provable and denied');
});

test('worktree-required: a same-command shell variable resolving outside the repo stays allowed (#630)', () => {
  policedRepo();
  const cmd = 'SP=/private/tmp/elsewhere; sed -i \'\' -e \'s/x/y/\' "$SP/file.md"';
  const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
  assert.deepStrictEqual(out, {}, 'a same-command variable resolving outside the repo must still be allowed — no regression for the originally-reported shape');
});

test('worktree-required: a single-quoted $NAME reference is never substituted, even when the variable resolves inside the repo — real bash does not expand it, so the gate correctly stays unresolvable/allow rather than fabricating a false-outside target (#630)', () => {
  const repo = policedRepo();
  const cmd = `WT=${repo}; sed -i '' -e 's/x/y/' '$WT/a.js'`;
  const out = pre.run({ input: bashInput(cmd, '/tmp'), runDir: null, runState: null, cwd: '/tmp' });
  assert.deepStrictEqual(out, {}, 'single-quoted $WT must never be treated as a variable reference — no target is fabricated either way');
});

test('worktree-required: an unexpanded glob still resolves against the cwd and is denied (#70)', () => {
  // Not a fabricated target: the hook sees the raw command string, and
  // `sed -i ... *.js` run from the main checkout really does write there.
  // The literal `repo/*.js` never exists, but repoInfo walks up to the
  // nearest existing directory, so the repo still resolves correctly.
  const repo = policedRepo();
  const out = pre.run({ input: bashInput("sed -i 's/x/y/' *.js", repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(decisionOf(out), 'deny', 'a glob rooted in the main checkout writes to the main checkout');
});

// --- gitignored-target exemption (#1395) ---
//
// A gitignored runtime config (a .env docker compose reads from the main
// checkout) is not the project work this gate exists to isolate. Covers both
// file-tool (Edit/Write) and Bash write-shape (cp/sed -i/tee) targets, per
// the issue's "keyed on exemptible, not fileTool" instruction.
//
// The issue also asked for a second, standalone "untracked, but NOT
// gitignored" branch (via `git ls-files --error-unmatch`). That branch was
// built during triage, then DELIBERATELY REVERTED — see isUntrackedOrIgnored's
// header comment in pre-tool-use.js for the full rationale — after it broke
// three existing security tests in tests/hooks-policy-exemption.test.js by
// blanket-exempting any existing-but-uncommitted file, including
// `.claude-tweaks/policy.yml` itself before its first commit (defeating both
// its Bash-write-shape gating and its symlink-swap identity defense) and
// ordinary real project content (CLAUDE.md) that simply had not been `git
// add`ed yet. Git has no signal that distinguishes those from a genuine
// deploy/scratch artifact. The tests below cover the gitignored branch that
// WAS implemented, plus regression guards proving the reverted branch stays
// reverted.

test('worktree-required: a gitignored write target is exempt (Edit/Write and cp/sed -i/tee)', () => {
  const repo = policedRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.env\n');
  const target = path.join(repo, 'deploy.env');

  assert.deepStrictEqual(
    pre.run({ input: { tool_name: 'Write', tool_input: { file_path: target } }, runDir: null, runState: null, cwd: repo }),
    {}, 'Write to a gitignored path must be exempt',
  );
  assert.deepStrictEqual(
    pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: target } }, runDir: null, runState: null, cwd: repo }),
    {}, 'Edit of a gitignored path must be exempt',
  );
  assert.deepStrictEqual(
    pre.run({ input: bashInput(`cp source.txt ${target}`, repo), runDir: null, runState: null, cwd: repo }),
    {}, 'cp writing a gitignored destination must be exempt',
  );
  assert.deepStrictEqual(
    pre.run({ input: bashInput(`sed -i 's/x/y/' ${target}`, repo), runDir: null, runState: null, cwd: repo }),
    {}, 'sed -i against a gitignored path must be exempt',
  );
  assert.deepStrictEqual(
    pre.run({ input: bashInput(`echo hi | tee ${target}`, repo), runDir: null, runState: null, cwd: repo }),
    {}, 'tee writing a gitignored path must be exempt',
  );
});

test('worktree-required: an EXISTING untracked-but-NOT-gitignored write target is still denied (reverted-branch regression guard, #1395)', () => {
  // An existing, never-`git add`ed scratch file that is NOT covered by any
  // .gitignore pattern must stay denied — proving the exemption really is
  // gitignored-only. See the block comment above for the full history: a
  // standalone untracked branch was built, then reverted, because it could
  // not be told apart from real uncommitted project content.
  const repo = policedRepo();
  const target = path.join(repo, 'scratch.txt');
  fs.writeFileSync(target, 'pre-existing, never git-added, not ignored');
  const out = pre.run({ input: bashInput(`cp source.txt ${target}`, repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(decisionOf(out), 'deny', 'untracked status alone must never exempt a write — only a gitignore match does');
});

test('worktree-required: a NOT-YET-EXISTING file write is still denied', () => {
  const repo = policedRepo();
  const target = path.join(repo, 'brand', 'new-file.js');
  const out = pre.run({ input: { tool_name: 'Write', tool_input: { file_path: target } }, runDir: null, runState: null, cwd: repo });
  assert.strictEqual(decisionOf(out), 'deny', 'a not-yet-existing, non-ignored file must stay denied');
});

test('worktree-required: a tracked, non-ignored path is STILL denied exactly as today — the exemption never widens for real repo-tracked writes', () => {
  const repo = policedRepo();
  const target = path.join(repo, 'tracked.js');
  fs.writeFileSync(target, 'x');
  execFileSync('git', ['-C', repo, 'add', 'tracked.js']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 't', '-q']);

  const editOut = pre.run({ input: { tool_name: 'Edit', tool_input: { file_path: target } }, runDir: null, runState: null, cwd: repo });
  assert.strictEqual(decisionOf(editOut), 'deny');
  const sedOut = pre.run({ input: bashInput(`sed -i 's/x/y/' ${target}`, repo), runDir: null, runState: null, cwd: repo });
  assert.strictEqual(decisionOf(sedOut), 'deny');
});

test('worktree-required: cp realfile.js .env — a tracked source alongside a gitignored destination resolves on the DESTINATION only (#1395 gotcha)', () => {
  const repo = policedRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
  const source = path.join(repo, 'realfile.js');
  fs.writeFileSync(source, 'x');
  execFileSync('git', ['-C', repo, 'add', 'realfile.js']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 't', '-q']);
  const dest = path.join(repo, '.env');
  const out = pre.run({ input: bashInput(`cp ${source} ${dest}`, repo), runDir: null, runState: null, cwd: repo });
  assert.deepStrictEqual(out, {}, 'cp only ever tracks the destination — a tracked source must not defeat the gitignored destination\'s exemption');
});

test('worktree-required: gitignored-target exemption is allowed inside a worktree too (no regression for the compliant case)', () => {
  const repo = policedRepo();
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(repo);
  const out = pre.run({ input: bashInput(`cp source.txt ${path.join(wt, 'a.js')}`, wt), runDir: null, runState: null, cwd: wt });
  assert.deepStrictEqual(out, {}, 'inside a worktree, everything is already allowed regardless of this exemption');
});

test('isUntrackedOrIgnored fails closed on anything it cannot prove, and is gitignored-only (#1395)', () => {
  const repo = gitRepoWithCommit();
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
  const ignored = path.join(repo, 'ignored.txt');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, ignored), true, 'the positive (gitignored) case must actually match');

  const existingUntrackedNotIgnored = path.join(repo, 'scratch.txt');
  fs.writeFileSync(existingUntrackedNotIgnored, 'x');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, existingUntrackedNotIgnored), false,
    'untracked alone (not gitignored) is never exempt — the reverted branch stays reverted');

  assert.strictEqual(pre.isUntrackedOrIgnored(repo, 'ignored.txt'), false, 'relative path is unprovable');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, ''), false, 'empty path');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, null), false, 'null path');
  assert.strictEqual(pre.isUntrackedOrIgnored(null, ignored), false, 'null repoRoot');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, path.join(repo, 'never', 'created.txt')), false,
    'a not-yet-existing, non-ignored path is never exempt');
  // A path resolving outside repoRoot is a real git failure (exit 128, with
  // stderr) for check-ignore — indeterminate, not a clean negative, so it
  // must fail closed rather than being read as "not ignored".
  const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-outside-'));
  fs.writeFileSync(path.join(outsideRepo, 'x.txt'), 'x');
  assert.strictEqual(pre.isUntrackedOrIgnored(repo, path.join(outsideRepo, 'x.txt')), false,
    'a path outside repoRoot is a git fatal error, not a clean negative — fails closed');
});

// --- hasMaterializeCommit range bound (#1674) ---
//
// hasMaterializeCommit is exercised directly (exported, same precedent as
// isPipelineBookkeeping/isUntrackedOrIgnored above) rather than through
// pre.run(), since driving it through the full bookkeeping-stamps gate would
// require standing up run-state.json, stamp files, and integration-model
// resolution just to reach a single git-log call this function makes on its
// own. `hasMaterializeCommit` only ever reads `path.basename(runDir)`, so a
// runDir need not exist on disk — only its basename (the run id) matters.

const MATERIALIZE_RUN_ID = '2026-08-29T120000-spec-1674';

function runDirForId(id) {
  return path.join(os.tmpdir(), 'ct-e1-materialize-runs', id);
}

function currentBranch(repo) {
  return execFileSync('git', ['-C', repo, 'branch', '--show-current']).toString().trim();
}

// Commits `.claude-tweaks/policy.yml` with `integration-branch: {branch}` —
// linked worktrees only ever see a COMMITTED policy.yml (same reason
// repoWithCommittedPolicy() above commits it), so this must land before any
// worktree is branched off `repo`.
function commitIntegrationBranchPolicy(repo, branch) {
  withPolicy(repo, `integration-branch: ${branch}\n`);
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'policy', '-q']);
}

// Commits a materialize-commit-shaped spec file for `runId` into `repo`'s
// CURRENT branch — the sentinel hasMaterializeCommit's pathspec matches.
function commitMaterializeFile(repo, runId) {
  const rel = path.join('.claude-tweaks', 'pipelines', runId, 'work', '1-spec.md');
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'materialize', '-q']);
}

test('hasMaterializeCommit: AC1 — inherited history (materialize commit already merged into integration by an earlier run) must NOT arm the gate', () => {
  // The materialize commit lands on `main` (the integration branch) itself —
  // simulating an earlier attempt under the SAME run id whose commit already
  // shipped and merged — BEFORE the worktree branches off. The fresh worktree
  // therefore has zero commits beyond the integration branch: everything it
  // sees, including the materialize commit, is inherited, not its own.
  //
  // What this test does and does not pin: it proves bounded-vs-unbounded (it
  // fails against the pre-#1674 unbounded walk), but NOT the range *direction*.
  // Both agents of this record's lens-3f pair demonstrated that inverting the
  // range to `HEAD..{integration}` leaves this test green — the worktree branch
  // and the integration branch point at the same commit here, so both
  // directions are empty ranges. AC2 below is the test that actually pins
  // direction; an earlier version of this comment claimed the two were
  // symmetric, which was wrong.
  const main = gitRepoWithCommit();
  const branch = currentBranch(main);
  commitIntegrationBranchPolicy(main, branch);
  commitMaterializeFile(main, MATERIALIZE_RUN_ID);
  const wt = linkedWorktreeOf(main); // branches off main's CURRENT HEAD, which already includes the materialize commit
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), false,
    'a materialize commit inherited from the integration branch must not arm the gate — against the unbounded implementation this returns true, which is the bug');
});

test('hasMaterializeCommit: AC2 — regression guard: a worktree carrying its OWN unmerged materialize commit still arms the gate (#991)', () => {
  // The materialize commit lands on the WORKTREE's own branch, strictly after
  // it branches off `main` — inside `{integration}..HEAD`, never merged back.
  // This is the opposite direction from AC1 and is what must stay true.
  const main = gitRepoWithCommit();
  const branch = currentBranch(main);
  commitIntegrationBranchPolicy(main, branch);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, MATERIALIZE_RUN_ID);
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), true,
    'a materialize commit unique to this worktree (record #991\'s original fix) must still arm the gate');
});

test('hasMaterializeCommit: AC3 — an unresolvable integration branch falls back to the unbounded walk, keeping the gate armed', () => {
  // No policy.yml (no integration-branch key) and no origin remote (no
  // origin/HEAD) — resolveIntegrationBranch's two sources both come up empty,
  // so it returns null. Reuses AC2's own-commit setup so the only variable is
  // whether an integration branch resolves.
  //
  // #1674's AC3 originally specified `false` here, reading "fail open" as
  // "never a false denial". That is the wrong direction for THIS function:
  // `false` means the IL-131 gate is not armed, and the gate is a protection,
  // not an alarm. Returning `false` disabled it for every repo without a
  // resolvable integration branch — every no-remote / `local-merge` project —
  // and turned 20 pre-existing gate tests red, which is what surfaced it.
  // The unbounded fallback is exactly the pre-#1674 behavior, so it is
  // strictly non-regressive, and it forfeits nothing #1674 set out to fix:
  // the false positive #1674 targets needs a materialize commit merged INTO
  // an integration branch, which cannot exist when none does.
  const main = gitRepoWithCommit(); // no policy.yml committed
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, MATERIALIZE_RUN_ID);
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), true,
    'with no integration branch to bound against, the check must fall back to the unbounded walk and stay armed — never silently disable IL-131');
});

test('hasMaterializeCommit: the unresolvable-integration fallback still RUNS the pathspec check, rather than arming unconditionally', () => {
  // The review's lens-3f pair proved AC3 above could not tell the intended
  // fallback (re-run the same git log unbounded) from a degenerate one
  // (`if (!integration) return true`) — injecting the degenerate form left all
  // three AC tests green, and only the separate bookkeeping-stamps-gate suite
  // caught it. This is the missing half: same unresolvable-integration repo,
  // but NO materialize commit anywhere. An unconditional arm returns true here;
  // a real pathspec check returns false.
  const main = gitRepoWithCommit(); // no policy.yml, no origin -> integration unresolvable
  const wt = linkedWorktreeOf(main);
  const runDir = runDirForId(MATERIALIZE_RUN_ID); // nothing ever committed for it
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), false,
    'the fallback must still be a real pathspec query — arming unconditionally would deny every covered call in any no-origin repo');
});

test('hasMaterializeCommit: a resolvable-but-nonexistent integration-branch policy value falls back instead of disarming the gate', () => {
  // `policy.readIntegrationBranch` returns the raw `integration-branch:` value
  // with no ref-existence check, so a stale/renamed/mistyped key yields a
  // truthy name for which `git log {bogus}..HEAD` exits 128. Before this
  // guard, the blanket `if (failure) return false` collapsed that into "gate
  // not armed" — disarming IL-131 on a config typo. Found by both agents of
  // the review's lens-3c pair.
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  // The policy file must live in the WORKTREE, not the main checkout:
  // hasMaterializeCommit is called with the worktree root, linkedWorktreeOf
  // places that outside the main checkout, and readIntegrationBranch walks up
  // from the path it is given. Writing it to `main` instead made this test
  // pass for the wrong reason — integration resolved `null` (the AC3 path)
  // rather than the bogus name — which a mutation probe caught.
  fs.mkdirSync(path.join(wt, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'policy.yml'), 'integration-branch: no-such-branch-here\n');
  commitMaterializeFile(wt, MATERIALIZE_RUN_ID);
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), true,
    'a bad integration-branch value must fall back to the unbounded walk, not silently disarm the gate');
});

// --- hasMaterializeCommit's third resolution source (#1688) ---
//
// #1674's own AC3 fixture (no policy.yml, no origin remote) is reused below,
// but with the materialize commit placed on `main` BEFORE the worktree
// branches off it -- AC1's inherited-history shape, not AC3's own-commit
// shape -- to reproduce #1688's exact reported bug: a no-remote repo still
// has a real local integration branch, merely an unresolvable one, so the
// pre-#1688 unbounded fallback armed the gate against history the worktree
// never made.
//
// The branch is renamed explicitly to 'main' rather than trusting the host's
// `init.defaultBranch` (this machine's own default is 'master') -- the probe
// itself tries both 'main' and 'master', but the test must be deterministic
// regardless of which default a given machine or CI runner ships.
function repoOnLocalMain() {
  const dir = gitRepoWithCommit();
  execFileSync('git', ['-C', dir, 'branch', '-M', 'main']);
  return dir;
}

test('hasMaterializeCommit: #1688 AC1 — a no-remote repo\'s inherited materialize commit is NOT armed once a local main/master probe can bound the range', () => {
  const main = repoOnLocalMain();
  commitMaterializeFile(main, MATERIALIZE_RUN_ID); // lands on `main` itself -- inherited, not the worktree's own
  const wt = linkedWorktreeOf(main); // branches off main's HEAD, which already includes the materialize commit
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), false,
    'a no-remote repo\'s inherited materialize commit must not arm the gate once the local main/master probe resolves a bound — #1688');
});

test('hasMaterializeCommit: #1688 AC2 regression guard — the local default-branch probe still arms the gate for the worktree\'s own unmerged commit', () => {
  const main = repoOnLocalMain();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, MATERIALIZE_RUN_ID); // on the worktree's own branch, never merged into main
  const runDir = runDirForId(MATERIALIZE_RUN_ID);
  assert.strictEqual(pre.hasMaterializeCommit(wt, runDir), true,
    'the local default-branch probe must not disarm the gate for a worktree\'s own genuinely-unmerged materialize commit');
});

// #1501: the #989 exemption's repro-resistant failure needs a byte-for-byte
// diff between a real hook invocation and a synthetic replay to pin down —
// this is the debug-capture instrumentation added for that, not a fix for
// the failure itself (unreproducible from static analysis; see the record's
// Investigation Findings).
test('CT_HOOKS_DEBUG_CAPTURE: unset by default, no file is written', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-capture-'));
  const captureFile = path.join(scratch, 'capture.jsonl');
  delete process.env.CT_HOOKS_DEBUG_CAPTURE;
  pre.run({ input: bashInput('ls', scratch), cwd: scratch });
  assert.strictEqual(fs.existsSync(captureFile), false, 'no CT_HOOKS_DEBUG_CAPTURE set -> no capture file written');
});

test('CT_HOOKS_DEBUG_CAPTURE: when set, appends one JSON line per call with input/cwd/runDir/runState/ownedRun', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-capture-'));
  const captureFile = path.join(scratch, 'capture.jsonl');
  const { run, state } = mkRun(scratch, 'sess-1');
  process.env.CT_HOOKS_DEBUG_CAPTURE = captureFile;
  try {
    pre.run({
      input: bashInput('git push origin feature-x', scratch), cwd: scratch, runDir: run, runState: state, ownedRun: { dir: run },
    });
    pre.run({ input: bashInput('ls', scratch), cwd: scratch });
  } finally {
    delete process.env.CT_HOOKS_DEBUG_CAPTURE;
  }
  const lines = fs.readFileSync(captureFile, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2, 'one capture line per pre.run() call, including calls with no runDir');
  const first = JSON.parse(lines[0]);
  assert.strictEqual(first.input.tool_name, 'Bash');
  assert.match(first.input.tool_input.command, /git push origin feature-x/);
  assert.strictEqual(first.cwd, scratch);
  assert.strictEqual(first.runDir, run);
  assert.strictEqual(first.runState.sessionId, 'sess-1');
  assert.deepStrictEqual(first.ownedRun, { dir: run });
  assert.ok(first.at, 'each line carries a capture timestamp');
  const second = JSON.parse(lines[1]);
  assert.strictEqual(second.runDir, undefined, 'a call with no runDir captures it as absent, not fabricated');
});

test('CT_HOOKS_DEBUG_CAPTURE: an unwritable target never breaks the real gate call', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-capture-'));
  process.env.CT_HOOKS_DEBUG_CAPTURE = path.join(scratch, 'no-such-parent-dir', 'capture.jsonl');
  try {
    assert.doesNotThrow(() => pre.run({ input: bashInput('ls', scratch), cwd: scratch }));
  } finally {
    delete process.env.CT_HOOKS_DEBUG_CAPTURE;
  }
});

// #1967: git-stash worktree-hazard warn — the stash stack is repository-wide,
// shared by every linked worktree of the same main checkout, so a bare
// `git stash`/`git stash pop` from a linked worktree can push onto or pop a
// SIBLING worktree's stash entry (the #1864 review call did exactly this).
// Warn only, never deny, and needs no active pipeline run — runDir/runState
// are both null in every case below.
test('#1967: bare `git stash` from a linked worktree emits the warning line', () => {
  const { wt } = mainAndWorktree();
  const out = pre.run({ input: bashInput('git stash', wt), runDir: null, runState: null, cwd: wt });
  assert.ok(!(out.json && out.json.hookSpecificOutput), 'must warn, never deny');
  assert.match(out.json.systemMessage, /git stash is repository-wide/);
  assert.match(out.json.systemMessage, /SIBLING worktree/);
});

test('#1967: `git stash pop` from a linked worktree emits the warning line', () => {
  const { wt } = mainAndWorktree();
  const out = pre.run({ input: bashInput('git stash pop', wt), runDir: null, runState: null, cwd: wt });
  assert.match(out.json.systemMessage, /git stash is repository-wide/);
});

test('#1967: `git stash` from the main checkout (not a linked worktree) is silent', () => {
  const { main } = mainAndWorktree();
  const out = pre.run({ input: bashInput('git stash', main), runDir: null, runState: null, cwd: main });
  assert.deepStrictEqual(out, {});
});

test('#1967: read-only `git stash list`/`git stash show` from a linked worktree is silent', () => {
  const { wt } = mainAndWorktree();
  assert.deepStrictEqual(pre.run({ input: bashInput('git stash list', wt), runDir: null, runState: null, cwd: wt }), {});
  assert.deepStrictEqual(pre.run({ input: bashInput('git stash show', wt), runDir: null, runState: null, cwd: wt }), {});
});

test('#1967: an unrelated git command from a linked worktree is silent', () => {
  const { wt } = mainAndWorktree();
  assert.deepStrictEqual(pre.run({ input: bashInput('git status', wt), runDir: null, runState: null, cwd: wt }), {});
});

// #2065: the guard widened to every explicit stack-mutating spelling, not
// just bare `stash`/`stash pop` — `stash push` (with or without `-u`/`-m`),
// the flag-first bare forms, and `stash save` all push onto the same
// repository-wide stack the bare form does.
test('#2065: `git stash push -m "wip"` and `git stash push -u` from a linked worktree emit the same warning bare `git stash` produces', () => {
  const { wt } = mainAndWorktree();
  const bare = pre.run({ input: bashInput('git stash', wt), runDir: null, runState: null, cwd: wt });
  const pushM = pre.run({ input: bashInput('git stash push -m "wip"', wt), runDir: null, runState: null, cwd: wt });
  const pushU = pre.run({ input: bashInput('git stash push -u', wt), runDir: null, runState: null, cwd: wt });
  assert.strictEqual(pushM.json.systemMessage, bare.json.systemMessage);
  assert.strictEqual(pushU.json.systemMessage, bare.json.systemMessage);
});

test('#2065: `git stash -u`, `git stash -m "wip"`, and `git stash save wip` from a linked worktree also warn', () => {
  const { wt } = mainAndWorktree();
  for (const cmd of ['git stash -u', 'git stash -m "wip"', 'git stash save wip']) {
    const out = pre.run({ input: bashInput(cmd, wt), runDir: null, runState: null, cwd: wt });
    assert.match(out.json.systemMessage, /git stash is repository-wide/, `expected a warning for: ${cmd}`);
  }
});

test('#2065: `git stash apply` and `git stash drop` from a linked worktree stay silent', () => {
  const { wt } = mainAndWorktree();
  assert.deepStrictEqual(pre.run({ input: bashInput('git stash apply', wt), runDir: null, runState: null, cwd: wt }), {});
  assert.deepStrictEqual(pre.run({ input: bashInput('git stash drop', wt), runDir: null, runState: null, cwd: wt }), {});
});
