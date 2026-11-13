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
// | fixture     | exit | signal  | test points in the TAP, and the `code:` key of each point's YAML block      | # pass | # fail |
// |-------------|------|---------|-----------------------------------------------------------------------------|--------|--------|
// | assert-fail | 1    | null    | `not ok 1 - adds two numbers`: 'ERR_ASSERTION', failureType 'testCodeFailure' | 0      | 1      |
// | nested-fail | 1    | null    | child `    not ok 1 - adds two numbers`: 'ERR_ASSERTION'; parent              | 0      | 1      |
// |             |      |         | `not ok 1 - widget`: 'ERR_TEST_FAILURE', failureType 'subtestsFailed'        |        |        |
// | syntax      | 1    | null    | `not ok 1 - syntax.test.js`: 'ERR_TEST_FAILURE', exitCode 1; the child's     | 0      | 1      |
// |             |      |         | stderr (the SyntaxError) folded into `# ` comment lines before the point      |        |        |
// | load-throw  | 1    | null    | `not ok 1 - load-throw.test.js`: 'ERR_TEST_FAILURE', exitCode 1; stderr       | 0      | 1      |
// |             |      |         | (Cannot find module) folded into `# ` comment lines                           |        |        |
// | no-test     | 0    | null    | `ok 1 - no-test.test.js`, no code key                                         | 1      | 0      |
// | pass        | 0    | null    | `ok 1 - adds two numbers`, no code key                                        | 1      | 0      |
// | hang        | null | SIGKILL | none; the TAP is `TAP version 13` alone, with no summary                     | -      | -      |
// | exit1       | 1    | null    | `not ok 1 - exit1.test.js`: 'ERR_TEST_FAILURE', exitCode 1                    | 0      | 1      |
// | fake-tap    | 1    | null    | its printed `not ok 1 - fake` and YAML lines folded into `# ` comment lines;  | 0      | 1      |
// |             |      |         | `not ok 1 - fake-tap.test.js`: 'ERR_TEST_FAILURE', exitCode 1                 |        |        |
//
// On v20.20.2 (CI) the same capture gives the same exits, points, code keys and summaries; the
// file-level point is named by the absolute path, and blocks carry no `type:` key.
//
// The classification rule (classifyEvidenceRun), stated for `node --test` only: `timedOut` →
// timeout. Otherwise parse the TAP: a test point is a line matching /^\s*(not ok|ok) \d+ - /
// outside a YAML block; its block is the `---` line right after it through the `...` line at the
// same indent, and the block carries ERR_TEST_FAILURE when a line at that indent is exactly
// `code: 'ERR_TEST_FAILURE'`. The summary is the last `# fail N` / `# pass N` at column 0.
//   reproduced   exit 1, summary fail >= 1, and some `not ok` point's block lacks ERR_TEST_FAILURE
//   load-failure exit 1, a summary, at least one `not ok` point, and each carries ERR_TEST_FAILURE
//   passed       exit 0, summary fail 0
//   unplaceable  anything else (a `not ok` point with no block counts toward neither of the first two)
// Only a test case that ran and failed reaches `reproduced`; a file that fails to load, exits on
// its own or prints TAP-shaped text gets one file-level point with ERR_TEST_FAILURE, and its
// output is folded into comments. The parse is one pass over the lines, with anchored per-line
// regexes only, because the evidence test controls part of the text.

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
const ERR_TEST_FAILURE = "code: 'ERR_TEST_FAILURE'";

// One pass over the TAP lines: the `not ok` points (each with whether it has a closed block and
// whether that block carries ERR_TEST_FAILURE) and the last column-0 pass/fail counts.
function parseTap(tap) {
  const failed = [];
  const counts = { pass: null, fail: null };
  let opened = null; // the point whose block may start on the next line
  let block = null; // { point, end, err }: the open block's closing line and its ERR_TEST_FAILURE line
  for (const raw of String(tap).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (block) {
      if (line === block.end) {
        block.point.closed = true;
        block = null;
      } else if (line === block.err) {
        block.point.err = true;
      }
      continue;
    }
    const prev = opened;
    opened = null;
    if (prev && line.endsWith('---') && line.slice(0, -3).trim() === '') {
      const indent = line.slice(0, -3);
      block = { point: prev, end: `${indent}...`, err: indent + ERR_TEST_FAILURE };
      continue;
    }
    const point = POINT_RE.exec(line);
    if (point) {
      opened = { closed: false, err: false };
      if (point[1] === 'not ok') failed.push(opened);
      continue;
    }
    const count = SUMMARY_RE.exec(line);
    if (count) counts[count[1]] = Number(count[2]);
  }
  return { failed, ...counts };
}

// Classify one evidence run. `signal` and `file` are part of the caller's record of the run;
// the rule reads only `code`, `timedOut` and `tap`.
function classifyEvidenceRun({ code, timedOut, tap }) {
  if (timedOut) return { verdict: 'timeout', fail: null, pass: null };
  const { failed, fail, pass } = parseTap(tap);
  const result = (verdict) => ({ verdict, fail, pass });
  if (fail === null) return result('unplaceable');
  if (code === 1 && fail >= 1 && failed.some((p) => p.closed && !p.err)) return result('reproduced');
  if (code === 1 && failed.length > 0 && failed.every((p) => p.closed && p.err)) return result('load-failure');
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
