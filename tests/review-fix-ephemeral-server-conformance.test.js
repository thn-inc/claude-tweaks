// tests/review-fix-ephemeral-server-conformance.test.js — pins #3021: review's fix waves
// (which re-verify with /claude-tweaks:test, and a suite that builds the app swaps the build
// out from under the run's ephemeral server) stop the server before the wave builds, re-verify,
// and restart it once only when a browser step is still ahead; fix agents are told not to build.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const HEADING = '## Fix-wave server coordination (pipeline runs)';
const FIX_LINE = /FIX AGENT: do not run the project's test suites, builds, dev servers, or e2e runners — make the edits and report them; the dispatcher re-verifies\./;
const STOP = '**Stop before the wave builds.**';
const REVERIFY = '**Re-verify.**';
const RESTART = '**Restart lazily, at the next browser step.**';

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

// Cleanup is a `### ` section: slice to the next `### ` or `## ` heading.
function subsection(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const rest = text.slice(start + 1);
  const m = rest.search(/\n##+ /);
  return m === -1 ? text.slice(start) : text.slice(start, start + 1 + m);
}

function lineStarting(text, prefix) {
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `missing line starting: ${prefix}`);
  return line;
}

// Every step3-routing assertion lives here so the go-red controls run the identical code.
function assertRouting(text) {
  const sec = section(text, HEADING);
  for (const needle of [
    'ephemeral-server.txt',
    'git rev-parse --show-toplevel',
    'leave it alone',
    'wrap-up/cleanup-procedures-execution.md',
    "Section D's steps 2-4",
    'Never hand-roll a kill',
    'Ephemeral server start',
    'plain Bash redirect',
    '[IL-127]',
    'once per wave',
    'standalone review behaves exactly as before',
    'Step 6.7 item 4',
    // spaced worktree paths: the root is everything between the port and the trailing detached: token
    'everything between the port (the second field) and the trailing `detached:` token',
    'the path may contain spaces',
    // stop applies before every code-changing, re-verifying point
    'Step 4 (before invoking `/claude-tweaks:reflect`',
    'Step 5 (before invoking `/claude-tweaks:simplify`',
    "Step 6.7's routing wave",
    'Re-read the file at every point: a server stopped earlier stays stopped',
    "is stopped again before Step 6.7's wave",
    // an unparseable record is unprovable: leave it alone, never kill on a malformed pid/port
    'a pid or port that is not a positive integer',
    'is unprovable: log `SKIP`',
    'leave the file and every process alone',
    // stop failure degrades, never blocks
    'log `SKIP` via `log-decision.js`',
    "`_shared/auto-decision-log.md`'s degrade-trace rule",
    'a degrade, never a block',
    'finds the port still held after the kill',
    "keep the record, so wrap-up's Section D still sees it",
    'later browser results may reflect the replaced build',
    // lazy restart: the coordination itself starts nothing; the next browser step's detection does
    'Do not start a server in this coordination',
    'resolves its URL through `dev-url-detection.md`',
    "reuses a server a re-verify's own QA already started",
    'nothing is restarted',
  ]) {
    assert.ok(sec.includes(needle), `coordination section must include: ${needle}`);
  }

  const iStop = sec.indexOf(STOP);
  const iVerify = sec.indexOf(REVERIFY);
  const iRestart = sec.indexOf(RESTART);
  assert.ok(iStop > -1 && iVerify > -1 && iRestart > -1, 'all three step labels must be present');
  assert.ok(iStop < iVerify && iVerify < iRestart, 'order must be stop -> re-verify -> restart');
  assert.ok(!sec.includes('start a fresh one through'), 'the coordination must not itself start a server (lazy restart)');
  assert.ok(!sec.includes('third field'), 'the worktree root must not be parsed as the third field (paths may contain spaces)');

  assert.ok(
    text.indexOf('## Fix-wave server coordination') < text.indexOf('## Parallel fix dispatch'),
    'coordination section must sit before the parallel fix dispatch section',
  );
  assert.ok(
    lineStarting(text, 'If any findings are "Fix now"').includes('Fix-wave server coordination'),
    'the Fix-now paragraph must route through the coordination',
  );
  assert.ok(
    lineStarting(text, '- **AUTO**').includes('Fix-wave server coordination'),
    'the AUTO bullet must route through the coordination',
  );

  const par = section(text, '## Parallel fix dispatch');
  assert.ok(par.includes('Fix-wave server coordination'), 'parallel fix dispatch must cite the coordination');
  const fixIdx = par.search(FIX_LINE);
  assert.ok(fixIdx > -1, 'parallel fix dispatch must carry the verbatim FIX AGENT line');
  const tplIdx = par.indexOf('**Output template');
  assert.ok(tplIdx > -1, 'parallel fix dispatch must carry the Output template');
  assert.ok(fixIdx < tplIdx, 'the FIX AGENT line must sit outside (before) the Output template block');
}

const routing = () => read('review', 'step3-routing.md');

test('AC1.2, AC3.2: step3-routing.md carries the stop → re-verify → restart section, reached from every fix path', () => {
  assertRouting(routing());
});

test("AC3.1: the fix-agent prompt line is verbatim and worded like #3001's READ-ONLY REVIEW line", () => {
  const text = routing();
  const line = text.split('\n').find((l) => FIX_LINE.test(l));
  assert.ok(line, 'the FIX AGENT line must be present');
  assert.doesNotMatch(line, /READ-ONLY REVIEW/);
  const core = read('_shared', 'subagent-dispatch-core.md');
  assert.match(core, /never run the project's test suites, builds, dev servers, or e2e runners/);
  const ITEMS = 'test suites, builds, dev servers, or e2e runners';
  const readOnlyLine = core.split('\n').find((l) => l.includes('READ-ONLY REVIEW:'));
  assert.ok(readOnlyLine, 'the READ-ONLY REVIEW line must be present');
  assert.ok(readOnlyLine.includes(ITEMS), 'READ-ONLY REVIEW line carries the shared item order');
  assert.ok(line.includes(ITEMS), 'FIX AGENT line carries the same item order as the READ-ONLY REVIEW line');
  assert.ok(
    !section(core, '## Read-only Reviewer Discipline').includes('FIX AGENT'),
    'the read-only reviewer rule and the fix-agent rule stay separate',
  );
});

test('AC1.1: code-mode-steps.md applies the coordination stop before Step 4 reflect, Step 5 simplify, and Step 6.7 routing', () => {
  const cms = read('review', 'code-mode-steps.md');
  const reflectLine = lineStarting(cms, 'In a pipeline run, before invoking `/claude-tweaks:reflect`');
  assert.ok(reflectLine.includes('step 1 of `step3-routing.md`\'s Fix-wave server coordination'), 'Step 4 must apply coordination step 1 before reflect');
  const simplifyLine = lineStarting(cms, 'In a pipeline run, before invoking `/claude-tweaks:simplify`');
  assert.ok(simplifyLine.includes('step 1 of `step3-routing.md`\'s Fix-wave server coordination'), 'Step 5 must apply coordination step 1 before simplify');
  // Each sentence sits in its own step's section (Step 4 before Step 5 before Step 6.7).
  assert.ok(cms.indexOf(reflectLine) > cms.indexOf('## Step 4:') && cms.indexOf(reflectLine) < cms.indexOf('## Step 5:'));
  assert.ok(cms.indexOf(simplifyLine) > cms.indexOf('## Step 5:') && cms.indexOf(simplifyLine) < cms.indexOf('## Step 6:'));
  const s67 = section(cms, '## Step 6.7');
  const s67Line = s67.split('\n').find((l) => l.includes('Fix-wave server coordination'));
  assert.ok(s67Line, 'Step 6.7 must cite the coordination');
  assert.ok(s67Line.includes('step 1 stops the run\'s ephemeral server before the wave'), 'Step 6.7 must apply the stop before the wave');
  assert.ok(s67Line.includes('through its own `dev-url-detection.md` resolution'), "Step 6.7 item 4's QA re-run must restart lazily via detection");
});

test('AC1.2: dev-url-detection.md Cleanup names the rebuild exception and points at the review step', () => {
  const dud = read('_shared', 'dev-url-detection.md');
  const cleanup = subsection(dud, '### Cleanup');
  assert.ok(cleanup.includes('rebuilds the served app'));
  assert.ok(cleanup.includes('review/step3-routing.md'));
  assert.ok(cleanup.includes('the next browser step restarts it through this procedure'));
  // The review -> dev-url-detection edge is stated once in docs/skill-graph.md (checked below); the
  // header and consumer list keep their original transitive-only wording, which is still true.
  const header = dud.slice(0, dud.indexOf('## When This Runs'));
  assert.ok(!header.includes('Fix-wave server coordination'), 'the header must not restate the graph edge');
});

test('docs/skill-graph.md ## review records the coordination edges', () => {
  const graph = readText(path.join(__dirname, '..', 'docs', 'skill-graph.md'));
  const rev = section(graph, '\n## review\n');
  const wrapRow = rev.split('\n').find((l) => l.startsWith('| `/wrap-up` | Runs after `/review` passes'));
  assert.ok(wrapRow && wrapRow.includes('Fix-wave server coordination') && wrapRow.includes('Section D steps 2-4'));
  const dudRow = rev.split('\n').find((l) => l.startsWith('| `_shared/dev-url-detection.md` |'));
  assert.ok(dudRow && dudRow.includes('step3-routing.md') && dudRow.includes('next browser step restarts it'));
});

test('AC2.1: Section D still stops whatever ephemeral-server.txt currently names', () => {
  const exec = read('wrap-up', 'cleanup-procedures-execution.md');
  assert.ok(exec.includes('read whatever it currently names'));
  assert.ok(exec.includes('Confirm the port is free, then delete `ephemeral-server.txt`'));
});

test('AC4.1: the coordination is a no-op without a run dir', () => {
  assert.ok(section(routing(), HEADING).includes('no run directory or no server record'));
});

// Waived AC5.1: npm test passing is verified by Common Step 5's full run, not a unit test.

test('go-red: removing the coordination section fails the routing assertions', () => {
  const text = routing();
  const start = text.indexOf('## Fix-wave server coordination');
  const end = text.indexOf('## Parallel fix dispatch');
  assert.ok(start > -1 && end > start);
  assert.throws(() => assertRouting(text.slice(0, start) + text.slice(end)), assert.AssertionError);
});

test('go-red: swapping the stop and restart labels fails the routing assertions', () => {
  const text = routing();
  const swapped = text
    .replace(STOP, '@@PLACEHOLDER@@')
    .replace(RESTART, STOP)
    .replace('@@PLACEHOLDER@@', RESTART);
  assert.notEqual(swapped, text);
  assert.throws(() => assertRouting(swapped), assert.AssertionError);
});

test('go-red: removing the FIX AGENT line fails the routing assertions', () => {
  const text = routing();
  const mutated = text
    .split('\n')
    .filter((l) => !l.includes('FIX AGENT:'))
    .join('\n');
  assert.notEqual(mutated, text);
  assert.throws(() => assertRouting(mutated), assert.AssertionError);
});

test('go-red: reverting to a third-field worktree-root parse fails the routing assertions', () => {
  const text = routing();
  const mutated = text.replace(
    'everything between the port (the second field) and the trailing `detached:` token, since the path may contain spaces',
    'third field (worktree root)',
  );
  assert.notEqual(mutated, text);
  assert.throws(() => assertRouting(mutated), assert.AssertionError);
});

test('go-red: dropping the unparseable-record guard fails the routing assertions', () => {
  const text = routing();
  const mutated = text.replace(' is unprovable: log `SKIP`', ' is fine: log `SKIP`');
  assert.notEqual(mutated, text);
  assert.throws(() => assertRouting(mutated), assert.AssertionError);
});

test('go-red: an eager start added beside the lazy-restart sentence trips the negative guard', () => {
  const text = routing();
  const sentence = 'Do not start a server in this coordination';
  const mutated = text.replace(sentence, `${sentence}. Then start a fresh one through dev-url-detection.md`);
  assert.notEqual(mutated, text);
  assert.throws(() => assertRouting(mutated), /must not itself start a server/);
});

test('go-red: making the coordination start a server itself fails the routing assertions', () => {
  const text = routing();
  const mutated = text.replace('Do not start a server in this coordination', 'Start a fresh one through dev-url-detection.md');
  assert.notEqual(mutated, text);
  assert.throws(() => assertRouting(mutated), assert.AssertionError);
});
