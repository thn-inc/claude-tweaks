// tests/dispatch-named-form-exclusion-reasons.test.js — #3084.
//
// Anchored prose-conformance: dispatch/SKILL.md's `#N` and `#N[,#M,#O...]` bullets must explain a
// record missing from dispatch-groups.json by EVERY reason queue-pull-script.md removes candidates
// for — not only `open-pr`. Before #3084 both bullets filtered dispatch-exclusions.json to
// `reason: 'open-pr'`, so a record #3073's not-spec-shaped pass dropped was misreported as having an
// open PR (or not explained at all). Sibling: tests/dispatch-not-spec-shaped-exclusion-fixture.test.js
// (the queue-pull pass itself).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const OPEN_PR_REPORT = readText(path.join(DISPATCH, 'open-pr-exclusion-report.md'));
const BLOCKED_REPORT = readText(path.join(DISPATCH, 'blocked-exclusion-report.md'));

const QUEUE_PULL = readText(path.join(DISPATCH, 'queue-pull-script.md'));
const NOT_SPEC_SHAPED_REPORT = readText(path.join(DISPATCH, 'not-spec-shaped-exclusion-report.md'));

// Every reason queue-pull-script.md's passes drop a candidate from dispatch-groups.json for, read from
// its own `- \`reason: '...'\`` bullets (#3087): a bullet whose entries stay IN dispatch-groups.json
// (today `oversized`) is not a removing reason. A reason added to the script is checked here unedited.
const REMOVING_REASONS = QUEUE_PULL.split('\n')
  .map((line) => ({ line, m: line.match(/^- `reason: '([a-z-]+)'`/) }))
  .filter(({ m }) => m)
  .filter(({ line }) => !line.includes('stay IN `dispatch-groups.json`'))
  .map(({ m }) => m[1]);

test('REMOVING_REASONS is derived from queue-pull-script.md, non-empty, and excludes oversized (#3087)', () => {
  assert.ok(REMOVING_REASONS.length >= 5, `derived only ${JSON.stringify(REMOVING_REASONS)} -- the bullet pattern no longer matches queue-pull-script.md`);
  assert.ok(REMOVING_REASONS.includes('not-spec-shaped'));
  assert.ok(!REMOVING_REASONS.includes('oversized'), 'oversized groups stay in dispatch-groups.json; it is not a removing reason');
});

function bullet(anchor) {
  const line = SKILL.split('\n').find((l) => l.startsWith(anchor));
  assert.ok(line, `${anchor} bullet not found in dispatch/SKILL.md -- anchor out of sync with the live file`);
  return line;
}

const SINGLE = bullet('**`#N`** — direct.');
const LIST = bullet('**`#N[,#M,#O...]`**');

test('dispatch #N names every removing exclusion reason and reports not-spec-shaped with its own remedy, never as an open PR (#3084 AC1)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(SINGLE.includes(`\`${reason}\``), `#N bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(SINGLE.includes('not-spec-shaped-exclusion-report.md'), '#N bullet must cite the not-spec-shaped report for its line and remedy');
  assert.ok(SINGLE.includes('never as an open PR'), '#N bullet must rule out the open-PR misreport explicitly');
  assert.ok(!SINGLE.includes("filtered to `reason: 'open-pr'`"), '#N bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(SINGLE.includes('and stop'), '#N bullet must still stop after reporting the reason');
  assert.match(SINGLE, /no entry at all/, '#N bullet must say what to report when no exclusion entry names the record');
});

test('blocked-exclusion-report.md renders the target-missing line the #N form points at (#3084)', () => {
  assert.ok(BLOCKED_REPORT.includes("`reason: 'target-missing'`"), 'blocked-exclusion-report.md does not read target-missing entries');
  assert.ok(BLOCKED_REPORT.includes('no longer exists at the integration tip'), 'blocked-exclusion-report.md has no target-missing report line');
});

test('dispatch #N,#M reports a not-spec-shaped member in notFound by name and keeps the rest of the list (#3084 AC2)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(LIST.includes(`\`${reason}\``), `#N,#M bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(!LIST.includes("filtered to `reason: 'open-pr'`"), '#N,#M bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(LIST.includes('do not abort the rest of the named set'), '#N,#M bullet must still proceed with the rest of the list');
  assert.ok(LIST.includes('named as the `#N` bullet above names it'), '#N,#M bullet must defer its reason lines to the #N bullet');
});

test('open-pr-exclusion-report.md no longer says the named forms read only open-pr entries, and owns their open-PR line (#3084)', () => {
  assert.ok(
    !OPEN_PR_REPORT.includes("filtered to `reason: 'open-pr'`, to report the specific reason"),
    'open-pr-exclusion-report.md still describes the named forms as open-pr-only',
  );
  assert.ok(
    OPEN_PR_REPORT.includes('`#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes`'),
    'open-pr-exclusion-report.md must carry the per-record line the #N form renders for an open-PR exclusion',
  );
});

test('not-spec-shaped-exclusion-report.md routes a lone missing Release Note to /claude-tweaks:tidy and anything else to /claude-tweaks:specify #N (#3087)', () => {
  const start = NOT_SPEC_SHAPED_REPORT.indexOf('**Remedy selection:**');
  assert.notStrictEqual(start, -1, 'Remedy selection paragraph not found -- anchor out of sync with the live file');
  const rule = NOT_SPEC_SHAPED_REPORT.slice(start, NOT_SPEC_SHAPED_REPORT.indexOf('\n\n', start)).replace(/\s+/g, ' ');
  assert.match(rule, /when `missing` is exactly `\["Release Note"\]`, the remedy is `` `\/claude-tweaks:tidy` ``/);
  assert.match(rule, /Any other `missing` set .* gets `` `\/claude-tweaks:specify #\{number\}` ``/);
  assert.ok(NOT_SPEC_SHAPED_REPORT.includes('`#{number} excluded — not spec-shaped (missing: {missing, comma-joined}). Run {remedy}.`'),
    'the per-record line the remedy is spliced into is missing');
});

test('the #3084 journey names every removing exclusion reason, with a matching count (#3103)', () => {
  const journey = readText(path.join(__dirname, '..', 'docs', 'journeys', 'learn-why-a-named-record-wont-dispatch-3084.md'));
  const lines = journey.split('\n');
  const success = lines.find((l) => l.startsWith('**Success state:**'));
  const step1 = lines.find((l) => l.startsWith('- **Should understand:** A record can carry every grant'));
  assert.ok(success && step1, 'journey anchor lines not found -- anchor out of sync with the live file');
  const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const expectedCount = `${COUNT_WORDS[REMOVING_REASONS.length]} reasons`;
  assert.ok(step1.includes(`for ${expectedCount}`), `Step 1 must say "${expectedCount}"`);
  for (const reason of REMOVING_REASONS) {
    assert.ok(step1.includes(`\`${reason}\``), `journey Step 1 does not name the \`${reason}\` exclusion`);
    assert.ok(success.includes(`\`${reason}\``), `journey Success state does not name the \`${reason}\` exclusion`);
  }
});

test('dispatch #N reports an unreadable dispatch-exclusions.json as reason-unknown, never as absent (#3104)', () => {
  assert.ok(SINGLE.includes('exclusions-unreadable-report.md'), '#N bullet must cite exclusions-unreadable-report.md for the unreadable case');
  const report = readText(path.join(DISPATCH, 'exclusions-unreadable-report.md'));
  assert.ok(report.includes('readExclusionsStatus'), 'the report must probe readExclusionsStatus, not readExclusions');
  assert.match(report, /reason unknown/, 'the report line must say the reason is unknown');
  assert.match(report, /never .*absent from this firing's queue/, 'the report must forbid the absent misreport');
  assert.ok(report.includes('Step 2'), 'the report must route the human to re-run the queue pull (Step 2)');
  const probe = report.split('\n').find((l) => l.includes('readExclusionsStatus') && l.trimStart().startsWith('node '));
  assert.ok(probe, 'the report must carry a one-line node probe');
});

// The report's probe must run in a fresh shell (Step 2 is its own Bash call, so `$DISPATCH_EXCLUSIONS` is
// empty by then, and an empty path reads as `absent`). Execute the shipped line itself, no shell.
test('the unreadable-exclusions probe self-resolves its path and tells unreadable from absent from ok when executed (#3104 AC1)', () => {
  const report = readText(path.join(DISPATCH, 'exclusions-unreadable-report.md'));
  assert.ok(!report.includes('$DISPATCH_EXCLUSIONS'), 'the probe must not depend on a shell variable that does not survive between Bash calls');
  const OPEN = 'node -e "';
  const CLOSE = '" "${CLAUDE_PLUGIN_ROOT}"';
  const fence = report.slice(report.indexOf('```bash\n') + 8, report.indexOf('\n```', report.indexOf('```bash\n')));
  const line = fence.split('\n').find((l) => l.startsWith(OPEN));
  assert.ok(line && line.endsWith(CLOSE), 'the bash fence must carry one `node -e "..." "${CLAUDE_PLUGIN_ROOT}"` probe line');
  const js = line.slice(OPEN.length, line.length - CLOSE.length);

  const id = `t3104-${process.pid}-${Date.now()}`;
  const file = sessionTmpPath(id, 'dispatch-exclusions.json');
  assert.ok(file, 'sessionTmpPath must accept the test session id');
  const root = path.dirname(file);
  const run = () => JSON.parse(execFileSync(process.execPath, ['-e', js, path.join(__dirname, '..', 'plugin')], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: id },
    encoding: 'utf8',
  }));
  try {
    fs.writeFileSync(file, '{ not json');
    const corrupt = run();
    assert.equal(corrupt.status, 'unreadable');
    assert.ok(typeof corrupt.error === 'string' && corrupt.error.length > 0, 'an unreadable status must carry an error string');
    assert.equal(corrupt.path, file);

    fs.rmSync(file);
    const absent = run();
    assert.equal(absent.status, 'absent');
    assert.equal(absent.path, file);

    fs.writeFileSync(file, '[]');
    const ok = run();
    assert.equal(ok.status, 'ok');
    assert.equal(ok.path, file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!fs.existsSync(root), 'test temp directory must be cleaned up');
});

test('the unreadable-exclusions report maps absent to the reason-unknown line, only ok to absent-from-queue (#3104 AC1)', () => {
  const report = readText(path.join(DISPATCH, 'exclusions-unreadable-report.md'));
  const lines = report.split('\n');
  const okBranch = lines.findIndex((l) => l.startsWith('- `status: "ok"`'));
  const unknownBranch = lines.findIndex((l) => l.startsWith('- `status: "absent"` or `status: "unreadable"`'));
  assert.ok(okBranch >= 0 && unknownBranch > okBranch, 'ok and absent/unreadable branches must be separate bullets');
  const okText = lines.slice(okBranch, unknownBranch).join(' ');
  assert.match(okText, /Report it as absent from this firing's queue/, 'only status ok is reported as absent from the queue');
  assert.ok(!/absent"/.test(okText), 'the ok branch must not also cover status absent');
  const unknownText = lines.slice(unknownBranch).join(' ').replace(/\s+/g, ' ');
  assert.match(unknownText, /exclusion reason unknown: this firing's dispatch-exclusions\.json at \{path\} \{could not be read \(\{error\}\) \| was not found\}/);
  assert.match(unknownText, /Step 2 always writes the file/, 'the report must say why absent is never nothing-excluded here');
  assert.match(report, /`#N,#M` member[\s\S]*the rest of\s+the list proceeds/, 'the entry condition must cover the list form');
  // #3104 review: a probe that fails outright (non-zero exit, no output, non-JSON) has ruled nothing out either.
  assert.match(unknownText, /The probe itself fails: .*the status probe failed .*Never fall back to "absent from this firing's queue"/,
    'a failed probe must route to the reason-unknown line, never to absent');
});

test('AC5.3: neighbour-in-flight is a queue-pull reason that is not removing (#3278)', () => {
  assert.ok(QUEUE_PULL.includes("- `reason: 'neighbour-in-flight'`"), 'queue-pull-script.md has no neighbour-in-flight reason bullet');
  assert.ok(!REMOVING_REASONS.includes('neighbour-in-flight'), 'neighbour-in-flight records stay in dispatch-groups.json');
});
