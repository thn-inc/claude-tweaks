'use strict';
// tests/build-sdd-final-review-capture.test.js — pins #3386: /build's subagent-strategy
// dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent" branch) directs
// /superpowers:subagent-driven-development to persist its final whole-branch review to
// `$PIPELINE_RUN_DIR/sdd-final-review.md` before its Finish step deletes the plan's SDD workspace,
// so the review evidence feeding #3381's double-review measurement survives the workspace delete.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { sessionTmpRoot } = require('../plugin/bin/lib/session-tmp');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

const RESOLVE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_FINAL_REVIEW=sdd-final-review-{run-id}.md';
const WRITE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-final-review.md --file "{review-path}"';
const SECTION_END = '**Standing AC-forwarding verification (#496).**';
const SECTION = DISPATCH.slice(
  DISPATCH.indexOf("**Persist SDD's final whole-branch review before Finish (#3386):**"),
  DISPATCH.indexOf(SECTION_END)
);

test('AC1.1: the capture resolves a session-scratch path and persists through the sanctioned writer, never a direct run-dir Write', () => {
  assert.match(DISPATCH, /\*\*Persist SDD's final whole-branch review before Finish \(#3386\):\*\*/);
  assert.ok(SECTION.includes(RESOLVE_CMD), 'resolves a session-scratch path for the review');
  assert.ok(SECTION.includes(WRITE_CMD), 'persists the review through the sanctioned writer');
  assert.ok(SECTION.includes('`{run-id}` is `basename "$PIPELINE_RUN_DIR"`'), '{run-id} is defined inline');
  assert.ok(SECTION.includes('never an Edit/Write straight to the run directory'), 'forbids a direct run-dir Edit/Write');
  assert.ok(!SECTION.includes('eval "$(node'), 'no eval: a variable set in one Bash call does not survive into the next');
  assert.match(SECTION, /before deleting the plan's workspace/);
});

// #3496: the harness refuses a direct Edit/Write to the run directory from a worktree-isolated
// session, so the capture's writer command must work as written from a worktree cwd. Extract it
// from the live prose and run it, as the #496 suite does for its sample.
test('AC1.1: the dispatch.md capture commands run from a worktree cwd and land sdd-final-review.md in the run dir', { skip: process.platform === 'win32' && 'runs dispatch.md commands through POSIX /bin/sh' }, () => {
  const cmds = [...SECTION.matchAll(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/write-run-artifact\.js"[^`]*)`/g)].map((m) => m[1]);
  assert.equal(cmds.length, 1, 'exactly the write command');
  assert.ok(cmds[0].endsWith('--file "{review-path}"'));

  const runId = '2026-10-19T090000-record-3496';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sddfinal-'));
  const sessionId = `sddfinal-${path.basename(root)}`;
  const sessionRoot = sessionTmpRoot(sessionId);
  try {
    const main = path.join(root, 'main');
    const runDir = path.join(main, '.claude-tweaks', 'pipelines', runId);
    const worktree = path.join(main, '.claude', 'worktrees', 'dispatch-record-3496');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(path.join(main, '.git'));
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/dispatch-record-3496\n');
    const env = { ...process.env, PIPELINE_RUN_DIR: runDir, CLAUDE_CODE_SESSION_ID: sessionId };
    const plugin = path.join(ROOT, 'plugin');
    const sh = (cmd) => execFileSync('/bin/sh', ['-c', cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, plugin)], { cwd: worktree, env, encoding: 'utf8' });

    // Step 1 of the documented flow: resolve the session-scratch path (no eval) and parse the printed literal.
    const printed = sh(RESOLVE_CMD.replace('{run-id}', path.basename(runDir)));
    const m = printed.match(/^SDD_FINAL_REVIEW=("[^"\n]+")$/m);
    assert.ok(m, `resolve prints SDD_FINAL_REVIEW="<path>": ${printed}`);
    const reviewPath = JSON.parse(m[1]);
    assert.ok(reviewPath.endsWith(`sdd-final-review-${runId}.md`));

    // Step 2: the Write tool puts the review at that literal path.
    const body = 'FINAL-REVIEW-BODY: the final reviewer findings with their severities\n';
    fs.writeFileSync(reviewPath, body);

    // Step 3: persist via the writer, {review-path} substituted with the literal (a separate shell, no inherited variable).
    sh(cmds[0].replace('{review-path}', reviewPath));
    assert.equal(fs.readFileSync(path.join(runDir, 'sdd-final-review.md'), 'utf8'), body);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (sessionRoot) fs.rmSync(sessionRoot, { recursive: true, force: true });
  }
});

test('AC2.1: the captured/absent decisions line keys on the run-dir file\'s presence, and a writer failure never blocks Finish', () => {
  assert.match(SECTION, /A non-zero exit from the writer never blocks Finish/);
  assert.ok(SECTION.includes('`AUTO … — SDD final review captured to sdd-final-review.md` when the file exists'));
  assert.ok(SECTION.includes('`SKIP … — SDD final review dispatched but sdd-final-review.md absent` when it does not'));
});

// The four-item check, factored out so the doctored control can run the real assertion on mutated text.
function assertFourItems(text) {
  assert.match(text, /the final reviewer's findings verbatim with their severities/);
  assert.match(text, /the reviewed commit SHA \(HEAD when the final review's package was built\) and that package's base commit/);
  assert.match(text, /the fix wave's commit range \(`FIX_BASE\.\.HEAD`, both ends written as commit SHAs\), or "no fix wave"/);
  assert.match(text, /the scoped re-review's per-finding verdicts verbatim, or "no re-review" when there was no fix wave/);
}

test('dispatch.md: the capture names the four items (#3386 AC1)', () => {
  assertFourItems(DISPATCH);
});

test('dispatch.md: nothing is written for standalone /build or a skipped whole-branch review (#3386 AC2)', () => {
  assert.match(DISPATCH, /Write nothing for a standalone `\/build` \(no `\$PIPELINE_RUN_DIR`\) or when the whole-branch review was skipped/);
});

test('dispatch.md: a dispatched final review leaves a captured-or-absent decisions.md line on SDD return', () => {
  assert.match(DISPATCH, /When SDD returns, if its final whole-branch review was dispatched, log one non-blocking line under `## \/build` in `\$PIPELINE_RUN_DIR\/decisions\.md`/);
  assert.match(DISPATCH, /`AUTO … — SDD final review captured to sdd-final-review\.md` when the file exists/);
  assert.match(DISPATCH, /`SKIP … — SDD final review dispatched but sdd-final-review\.md absent` when it does not/);
});

test('dispatch.md: the capture is evidence, not a gate', () => {
  assert.match(DISPATCH, /nothing blocks on its absence/);
});

test('doctored control: removing the reviewed-commit item turns the AC1 assertion red (#3386 AC3)', () => {
  const doctored = DISPATCH.replace(/the reviewed commit SHA \(HEAD when the final review's package was built\) and that package's base commit; /, '');
  assert.notEqual(doctored, DISPATCH, 'the doctoring replace did not hit — the control is vacuous');
  assert.throws(() => assertFourItems(doctored), assert.AssertionError);
});
