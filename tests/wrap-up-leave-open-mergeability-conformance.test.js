'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');
// #3483: a pr-first run whose console resolves leave-open never reaches the merge path, so
// wrap-up's last phase-exit push owns a DIRTY PR there. These pins keep the prose on its ACs.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const EXEC = read('plugin', 'skills', 'wrap-up', 'execution-and-verification.md');
const GIT_DISCIPLINE = read('plugin', 'skills', '_shared', 'git-discipline.md');
const WRAP_SUMMARY = read('plugin', 'skills', 'wrap-up', 'summary-template.md');
const FLOW_SUMMARY = read('plugin', 'skills', 'flow', 'summary-template.md');
const HEADING = '**Leave-open mergeability re-check';

function flatten(text) {
  return text.replace(/\s+/g, ' ');
}

// Returns an assertion that `flatText` contains a needle, naming the pin that failed.
function pinsIn(flatText) {
  return (needle, msg) => assert.ok(flatText.includes(needle), `${msg}: missing ${JSON.stringify(needle)}`);
}

// Go-red controls: a mutation that changes nothing would prove nothing.
function assertMutated(original, mutated) {
  assert.ok(mutated !== original, 'the control must actually mutate the text');
  return mutated;
}

function leaveOpenParagraph(text) {
  const start = text.indexOf(HEADING);
  assert.ok(start !== -1, `"${HEADING}" paragraph not found`);
  const phaseExit = text.indexOf('**Phase exit (`worktree` mode, `integration-model: pr-first`):**');
  const verify = text.indexOf('### Verify execution');
  assert.ok(phaseExit !== -1 && phaseExit < start && start < verify,
    'the paragraph sits after the Phase exit paragraph and before ### Verify execution');
  return flatten(text.slice(start, verify));
}

function assertLeaveOpenParagraph(text) {
  const p = leaveOpenParagraph(text);
  const has = pinsIn(p);
  // Triggers and exclusions.
  has("`merge.resolution` reads `leave-open`", 'trigger: console.json leave-open');
  has('"Approve all, leave PR open"', 'trigger: attended leave-open choice');
  has('`merged`, `armed`, or the merge path\'s own `pending-review` skips this paragraph', 'exclusion: merge-path outcomes');
  // One read, reused.
  has('`pr-merge-state.js --phase wrap-up`', 'reuses the post-push read');
  has('never a second read', 'reads once');
  // Late read: an `unknown` (or an exit 3 from an already-archived run dir) at the post-push read
  // takes one read of its own, late in the step, against the run dir where it now lives.
  has('unless it printed `unknown`', 'late read: only an unknown (or exit 3) triggers a read of its own');
  has('exited 3 because cleanup item 8', 'late read: an archived run dir is named as the exit-3 cause');
  has('take one read of its own, as the last call of this execution step', 'late read: one read, placed last');
  has('before the Verify execution section', 'late read: placed before Verify execution');
  has('`node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "{run-dir}" --phase wrap-up`', 'late read: the command');
  has('`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` once item 8 archived it', 'late read: archive-aware --run');
  has('A late `unknown` is not read again', 'late read: AC3.1 still one log line');
  has('log-decision.js" --run "{run-dir}"', 'late read: the log lands in the same run dir');
  // AC1.1 — clean auto-merge: commit pushed, decisions line names the sha.
  has("Catch-up steps 1-5", 'AC1.1: runs the shared catch-up');
  has('`DIRTY → merged main as {after short}`', 'AC1.1: decisions line names the merge sha');
  // AC2.1 — conflict: git auto-merge only, files listed before abort, decisions line names files.
  has('Step 4 never resolves a conflict', 'AC2.1: no conflict resolution');
  const list = p.indexOf('diff --name-only --diff-filter=U');
  const abort = p.indexOf('merge --abort');
  assert.ok(list !== -1 && abort !== -1 && list < abort, 'AC2.1: conflicting paths are listed before merge --abort');
  has('`DIRTY — conflict in {files}`', 'AC2.1: decisions line names the conflicting files');
  has('and skip step 5', 'AC2.1: a conflicted merge never reaches the push');
  // The two other DIRTY outcomes, each its own logged line.
  has('`DIRTY → nothing to merge (forge state stale)`', 'DIRTY outcome: a merge that brought in nothing');
  has('`DIRTY — not caught up ({reason})`', 'DIRTY outcome: a catch-up that could not run');
  // AC3.1 — any other read: one log line, nothing else.
  has('log `mergeability: {mergeStateStatus}`', 'AC3.1: CLEAN/BLOCKED/UNKNOWN log one line');
  has('nothing else changes', 'AC3.1: nothing beyond the one log line');
  has('(`read-failed`, `gh-absent`, `no-pr`)', 'AC3.1: a failed read logs its state, never clean');
  has('or `exit 2`/`exit 3` when the read printed nothing', 'AC3.1: an exit 2/3 logs the exit code as the outcome');
  // The log command.
  has('--step "Leave-open mergeability re-check"', 'log step name');
  has('mergeability: {outcome}', 'log text shape');
  has('--text-file', 'log text: git-supplied text goes through --text-file');
  has("`_shared/auto-decision-log.md`'s Text from git or a user", 'cites the canonical procedure');
  assert.doesNotMatch(p, /escape any/i, 'log text: no hand-escape instruction remains');
}

test('AC1.1/AC2.1/AC3.1: execution-and-verification.md carries the leave-open mergeability re-check', () => {
  assertLeaveOpenParagraph(EXEC);
});

test('go-red control: swapping the log call back to a double-quoted --text makes the shared assertion throw', () => {
  const start = EXEC.indexOf(HEADING);
  const verify = EXEC.indexOf('### Verify execution');
  const paragraph = EXEC.slice(start, verify);
  const mutated = assertMutated(EXEC, EXEC.slice(0, start) + paragraph.split('--text-file').join('--text') + EXEC.slice(verify));
  assert.throws(() => assertLeaveOpenParagraph(mutated), /--text-file/);
});

test('go-red control: dropping the files-before-abort listing makes the shared assertion throw', () => {
  const mutated = assertMutated(EXEC, EXEC.replace('diff --name-only --diff-filter=U', 'diff --stat'));
  assert.throws(() => assertLeaveOpenParagraph(mutated), /AC2\.1/);
});

test('go-red control: a re-check that never reads late, or reads the archived-away path, makes the shared assertion throw', () => {
  const noLateRead = assertMutated(EXEC, EXEC.replace('take one read\nof its own, as the last call', 'reuse it anyway\nas the last call'));
  assert.throws(() => assertLeaveOpenParagraph(noLateRead), /late read: one read, placed last/);
  const staleRun = assertMutated(EXEC, EXEC.replace('--run "{run-dir}" --phase wrap-up', '--run "$PIPELINE_RUN_DIR" --phase wrap-up'));
  assert.throws(() => assertLeaveOpenParagraph(staleRun), /late read: the command/);
});

function assertGitDisciplineException(text) {
  const has = pinsIn(flatten(text));
  has('no catch-up runs there, in any mode — the merge path (`_shared/pr-first-merge.md`) owns a conflict from there', 'merge path keeps wrap-up exit');
  has("`wrap-up/execution-and-verification.md`'s Leave-open mergeability re-check takes it, in every mode — only git's own auto-merge runs",
    'modes: the wrap-up-exit bullet names the leave-open exception in every mode');
  has('The one exception is an `unknown` at wrap-up\'s exit under a leave-open Review Console', 'late read: the never-re-read bullet names its one exception');
  has("At wrap-up's exit, pass `--run` the archive path (`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/`",
    'archived run: the wrap-up-exit read names the archive path, so it does not exit 3');
  has('`interactive` and `hybrid` never run this merge themselves — they only surface the commands (except wrap-up\'s Leave-open mergeability re-check',
    'modes: the interactive/hybrid rule excepts the leave-open re-check');
}

test('git-discipline.md names the leave-open exception at wrap-up exit and keeps the merge-path rule', () => {
  assertGitDisciplineException(GIT_DISCIPLINE);
});

test('go-red control: dropping the never-re-read exception makes the git-discipline assertion throw', () => {
  const mutated = assertMutated(GIT_DISCIPLINE, GIT_DISCIPLINE.replace('The one exception is an `unknown` at', 'An `unknown` at'));
  assert.throws(() => assertGitDisciplineException(mutated), /late read: the never-re-read bullet/);
});

function assertVerdictRule(text) {
  const flat = flatten(text);
  const start = flat.indexOf('**Leave-open mergeability (#3483).**');
  const state = flat.indexOf('### State');
  assert.ok(start !== -1 && start < state, 'AC2.1: the Verdict rule sits before ### State');
  const rule = flat.slice(start, state);
  assert.ok(rule.includes('`blocked — conflict with main in {files}`'), 'AC2.1: conflict Verdict wording');
  assert.ok(rule.includes('never "everything shipped"'), 'AC2.1: never everything shipped');
  assert.ok(rule.includes('`decisions.md` line'), 'AC2.1: read from the decisions line, never memory');
  assert.ok(rule.includes('`DIRTY → nothing to merge (forge state stale)` reads as caught up'), 'Verdict: a stale-forge outcome reads as caught up');
  assert.ok(rule.includes('"mergeability not re-checked"'), 'Verdict: a leave-open run with no mergeability line is named');
  assert.ok(rule.includes('`blocked — PR conflicts with main, not caught up ({reason})`'), 'Verdict: a catch-up that could not run reads blocked');
  assert.ok(rule.includes('`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/decisions.md` once cleanup item 8 archived the run'),
    'Verdict: the outcome line is read from the archive path once cleanup item 8 ran');
}

function assertResumeRow(text) {
  const flat = flatten(text);
  const row = '— resume to re-offer the merge decision, PR #{n} {is ready | is blocked} — mergeability: {outcome}';
  const first = flat.indexOf(row);
  assert.ok(first !== -1, 'AC1.2: the Next Actions resume row names the mergeability outcome');
  assert.ok(flat.indexOf(row, first + 1) !== -1, 'AC1.2: the Resume-to-merge row restatement names it too');
  const para = flat.slice(flat.indexOf('**Resume-to-merge row.**'));
  assert.ok(para.length < flat.length, 'AC1.2: the Resume-to-merge row paragraph exists');
  assert.ok(para.includes('Leave-open mergeability re-check'), 'AC1.2: the row cites its producer');
  assert.ok(para.includes('`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/decisions.md`'), 'AC1.2: the row reads the possibly archived decisions.md');
  assert.ok(para.includes('DIRTY → merged main as {sha}'), 'AC1.2: the row names the merge');
  assert.ok(para.includes('`is blocked` replaces `is ready` when that outcome is `DIRTY — conflict in {files}` or `DIRTY — not caught up ({reason})`'),
    'AC2.1: a conflict or a failed catch-up flips the row to blocked');
  assert.ok(para.includes('only when it starts with `DIRTY`'), 'AC3.1: the suffix carries the outcome only for a DIRTY outcome');
  assert.ok(para.includes('any other outcome (`CLEAN`, `BLOCKED`, `UNKNOWN`, a failed read)'), 'AC3.1: any other outcome is named');
  assert.ok(para.includes('drops the ` — mergeability: {outcome}` suffix'), 'AC3.1: any other outcome drops the suffix');
}

test('AC2.1: wrap-up Verdict reads blocked on a leave-open conflict', () => {
  assertVerdictRule(WRAP_SUMMARY);
});

test('AC1.2: flow summary resume-to-merge row names the mergeability outcome', () => {
  assertResumeRow(FLOW_SUMMARY);
});

test('go-red control: an unnamed resume row or a softened Verdict makes the shared assertions throw', () => {
  const row = assertMutated(FLOW_SUMMARY, FLOW_SUMMARY.split('{is ready | is blocked} — mergeability: {outcome}').join('is ready'));
  assert.throws(() => assertResumeRow(row), /AC1\.2/);
  const undirty = assertMutated(FLOW_SUMMARY, FLOW_SUMMARY.replace('only when it starts with `DIRTY`', 'for every outcome'));
  assert.throws(() => assertResumeRow(undirty), /AC3\.1/);
  const verdict = assertMutated(WRAP_SUMMARY, WRAP_SUMMARY.replace('never "everything shipped"', 'usually not "everything shipped"'));
  assert.throws(() => assertVerdictRule(verdict), /AC2\.1/);
});
