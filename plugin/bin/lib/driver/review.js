'use strict';

// The pipeline driver's reviewer step (#5222): one read-only reviewer worker between `check`
// and `push`. A finding counts only when its evidence test file, written into the worktree and
// run by the driver with `node --test`, genuinely fails. This module holds the rules and the step.
//
// Named bounds:
//   MAX_FINDINGS               5       findings read from one reviewer result
//   EVIDENCE_PATH_MAX_CHARS    200     an evidence path's length
//   EVIDENCE_CONTENT_MAX_BYTES 65536   an evidence file's UTF-8 size
//   EVIDENCE_RUN_TIMEOUT_MS    45000   one evidence run's wall clock (below the 1-minute minimum
//                                      of express-driver-wall-clock-minutes)
//   EVENT_TEXT_MAX_CHARS       200     reviewer text in an event line or stop detail
//   DIFF_PROMPT_MAX_BYTES      100000  the diff quoted in the reviewer prompt
//
// Evidence runs (Task 0 capture). Each source in tests/bin-lib/driver/fixtures/review-evidence/
// was written to a temp dir as {name}.test.js and run there as
// `node --test --test-reporter=tap --test-reporter-destination={dir}/{name}.tap {name}.test.js`
// (`hang` killed, with its process group, after 3 s). process.version v22.23.2. The TAP of each
// run is frozen beside its source as {name}.tap, with the temp dir replaced by <DIR>.
//
// Each `not ok` point below lists the keys of its YAML block (at the block's own indent) that
// the rule reads: failureType, exitCode, type, plus the code key for reference.
//
// | fixture       | exit | signal  | test points in the TAP and their block keys                               | # pass | # fail |
// |---------------|------|---------|----------------------------------------------------------------------------|--------|--------|
// | assert-fail   | 1    | null    | `not ok 1 - adds two numbers`: failureType 'testCodeFailure',              | 0      | 1      |
// |               |      |         | code 'ERR_ASSERTION', type 'test', no exitCode                             |        |        |
// | nested-fail   | 1    | null    | child `    not ok 1 - adds two numbers`: 'testCodeFailure', 'ERR_ASSERTION'; | 0    | 1      |
// |               |      |         | parent `not ok 1 - widget`: 'subtestsFailed', 'ERR_TEST_FAILURE', 'suite'  |        |        |
// | throw-in-test | 1    | null    | `not ok 1 - reads a property of null`: 'testCodeFailure',                  | 0      | 1      |
// |               |      |         | code 'ERR_TEST_FAILURE', name 'TypeError', type 'test', no exitCode        |        |        |
// | nested-throw  | 1    | null    | child `    not ok 1 - reads a property of null`: 'testCodeFailure',        | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE', 'TypeError'; parent `not ok 1 - widget`: 'subtestsFailed', 'suite' |  |  |
// | hook-require  | 1    | null    | child `    not ok 1 - runs after setup`: failureType 'hookFailed',         | 0      | 1      |
// |               |      |         | code 'MODULE_NOT_FOUND'; parent `not ok 1 - widget`: 'subtestsFailed', 'suite' |    |        |
// | syntax        | 1    | null    | `not ok 1 - syntax.test.js`: 'testCodeFailure', exitCode 1, signal ~,      | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'; the child's stderr (SyntaxError) folded into `# ` lines |       |        |
// | load-throw    | 1    | null    | `not ok 1 - load-throw.test.js`: 'testCodeFailure', exitCode 1, signal ~,  | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'; stderr (Cannot find module) folded into `# ` lines     |        |        |
// | no-test       | 0    | null    | `ok 1 - no-test.test.js`                                                   | 1      | 0      |
// | pass          | 0    | null    | `ok 1 - adds two numbers`                                                  | 1      | 0      |
// | hang          | null | SIGKILL | none; the TAP is `TAP version 13` alone, with no summary                   | -      | -      |
// | exit1         | 1    | null    | `not ok 1 - exit1.test.js`: 'testCodeFailure', exitCode 1, signal ~,       | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'                                                          |        |        |
// | fake-tap      | 1    | null    | its printed `not ok 1 - fake` and YAML lines folded into `# ` lines;       | 0      | 1      |
// |               |      |         | `not ok 1 - fake-tap.test.js`: 'testCodeFailure', exitCode 1, signal ~     |        |        |
//
// On v20.20.2 (CI) the same capture gives the same exits, points, failureType/exitCode/code keys
// and summaries; the file-level point is named by the absolute path, and only suites carry `type:`.
// Probed on both versions (not frozen): an error's own exitCode, failureType or type property is
// not printed, so those keys come from the runner alone; a failing `before` hook gives fail 0; a
// throwing `describe` body gives a suite point with 'testCodeFailure' and fail 0; a failing
// `test.todo` gives `not ok … # TODO` and fail 0.
//
// The classification rule (classifyEvidenceRun), stated for `node --test` only: `timedOut` →
// timeout. Otherwise parse the TAP: a test point is a line matching /^\s*(not ok|ok) \d+ - /
// outside a YAML block; its block is the `---` line right after it through the `...` line at the
// same indent, and only keys at that indent are read. A file-level point (the runner's own, for a
// file that failed to load or exited on its own) is a `not ok` point whose block has an
// `exitCode:` key. A failed test case is a `not ok` point without a `# TODO` directive whose block
// has `failureType: 'testCodeFailure'` and neither an `exitCode:` key nor `type: 'suite'`. The
// summary is the last `# fail N` / `# pass N` at column 0.
//   reproduced   exit 1, summary fail >= 1, and at least one failed test case
//   load-failure exit 1, a summary, at least one `not ok` point (TODO aside), each a file-level point
//   passed       exit 0, summary fail 0
//   unplaceable  anything else (a point with no block has none of the keys; a block that never
//                closes hides the summary)
// The error class and the `code:` key are not read: a test case that throws a TypeError carries
// 'ERR_TEST_FAILURE' just as a file-level point does. A hook failure ('hookFailed') is not a test
// case. Text the evidence file prints is folded into `# ` comments. The parse is one pass over the
// lines, with anchored per-line regexes only, because the evidence test controls part of the text.

const MAX_FINDINGS = 5;
const EVIDENCE_PATH_MAX_CHARS = 200;
const EVIDENCE_CONTENT_MAX_BYTES = 65536;
const EVIDENCE_RUN_TIMEOUT_MS = 45000;
const EVENT_TEXT_MAX_CHARS = 200;
const DIFF_PROMPT_MAX_BYTES = 100000;

// The test-command shapes the classification rule covers, keyed on the driver's testCommand.
// Any other command discards every finding.
const EVIDENCE_COMMANDS = Object.freeze({
  'npm test': (rel, dest) => ['--test', '--test-reporter=tap', `--test-reporter-destination=${dest}`, rel],
});

// The argument list (for deps.execPath, no shell) that runs one evidence file, or null when the
// rule does not cover testCommand.
function evidenceArgs(testCommand, rel, dest) {
  if (typeof testCommand !== 'string' || !Object.hasOwn(EVIDENCE_COMMANDS, testCommand)) return null;
  return EVIDENCE_COMMANDS[testCommand](rel, dest);
}

const POINT_RE = /^\s*(not ok|ok) \d+ - /;
const SUMMARY_RE = /^# (pass|fail) (\d+)$/;

// One pass over the TAP lines: the `not ok` points other than TODO ones (each with which of the
// rule's keys its block holds) and the last column-0 pass/fail counts. A block that never closes
// runs to the end and hides the summary, so such a run is unplaceable whatever its keys.
function parseTap(tap) {
  const failed = [];
  const counts = { pass: null, fail: null };
  let opened = null; // the point whose block may start on the next line
  let block = null; // { point, indent, end }: the open block and its closing line
  for (const raw of String(tap).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (block) {
      const p = block.point;
      const key = line.startsWith(block.indent) ? line.slice(block.indent.length) : null;
      if (line === block.end) block = null;
      else if (key === "failureType: 'testCodeFailure'") p.testCode = true;
      else if (key === "type: 'suite'") p.suite = true;
      else if (key !== null && key.startsWith('exitCode:')) p.fileLevel = true;
      continue;
    }
    const prev = opened;
    opened = null;
    if (prev && line.endsWith('---') && line.slice(0, -3).trim() === '') {
      const indent = line.slice(0, -3);
      block = { point: prev, indent, end: `${indent}...` };
      continue;
    }
    const point = POINT_RE.exec(line);
    if (point) {
      opened = { testCode: false, suite: false, fileLevel: false };
      // Node escapes a `#` in a test name as `\#`, so ` # TODO` is the directive.
      if (point[1] === 'not ok' && !line.includes(' # TODO')) failed.push(opened);
      continue;
    }
    const count = SUMMARY_RE.exec(line);
    if (count) counts[count[1]] = Number(count[2]);
  }
  return { failed, ...counts };
}

const isFailedTestCase = (p) => p.testCode && !p.fileLevel && !p.suite;
const isFileLevel = (p) => p.fileLevel;

// Classify one evidence run. Callers may pass more fields (the supervised run's outcome); the
// rule reads only `code`, `timedOut` and `tap`.
function classifyEvidenceRun({ code, timedOut, tap }) {
  if (timedOut) return { verdict: 'timeout', fail: null, pass: null };
  const { failed, fail, pass } = parseTap(tap);
  const result = (verdict) => ({ verdict, fail, pass });
  if (fail === null) return result('unplaceable');
  if (code === 1 && fail >= 1 && failed.some(isFailedTestCase)) return result('reproduced');
  if (code === 1 && failed.length > 0 && failed.every(isFileLevel)) return result('load-failure');
  if (code === 0 && fail === 0) return result('passed');
  return result('unplaceable');
}

module.exports = {
  MAX_FINDINGS,
  EVIDENCE_PATH_MAX_CHARS,
  EVIDENCE_CONTENT_MAX_BYTES,
  EVIDENCE_RUN_TIMEOUT_MS,
  EVENT_TEXT_MAX_CHARS,
  DIFF_PROMPT_MAX_BYTES,
  EVIDENCE_COMMANDS,
  evidenceArgs,
  classifyEvidenceRun,
};
