// tests/dispatch-per-record-groups-prose.test.js — #3278.
//
// Prose-conformance: dispatch/SKILL.md describes per-record groups (one record, or one fast-lane
// bundle) and the non-removing `neighbour-in-flight` exclusion, not the retired transitive
// "whole file-overlap group" selection. Siblings: tests/dispatch-named-form-exclusion-reasons.test.js
// (the removing reasons the named forms report) and the queue-pull behaviour tests under
// tests/bin-lib/dispatch/.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const QUEUE_PULL = readText(path.join(DISPATCH, 'queue-pull-script.md'));
const REPORT_PATH = path.join(DISPATCH, 'neighbour-in-flight-report.md');

function line(anchor) {
  const found = SKILL.split('\n').find((l) => l.startsWith(anchor));
  assert.ok(found, `${anchor} not found in dispatch/SKILL.md -- anchor out of sync with the live file`);
  return found;
}

test('AC5.2: the #N bullet prints the neighbour-in-flight report line and dispatches anyway', () => {
  const single = line('**`#N`** — direct.');
  assert.ok(single.includes('neighbour-in-flight-report.md'), '#N bullet must cite neighbour-in-flight-report.md');
  assert.ok(single.includes('dispatch anyway'), '#N bullet must say the record still dispatches');
});

test('AC5.2: the #N,#M bullet prints the report line and still dispatches a neighbour-in-flight record', () => {
  const list = line('**`#N[,#M,#O...]`**');
  assert.ok(list.includes('`neighbour-in-flight`'), '#N,#M bullet must name the neighbour-in-flight entry');
  assert.ok(list.includes('still dispatches'), '#N,#M bullet must say the record still dispatches');
});

test('AC8.2: dispatch/SKILL.md never says a record pulls its whole file-overlap group', () => {
  assert.ok(!SKILL.includes('whole file-overlap group'), 'dispatch/SKILL.md still carries "whole file-overlap group"');
  assert.ok(!SKILL.includes('overlap partners would race'), 'the Anti-Patterns row still describes overlap partners');
});

test('a group is one record or one fast-lane bundle, fixed by Step 2 and re-derived nowhere', () => {
  assert.ok(SKILL.includes('one record, or one fast-lane bundle'), 'Step 4 must state what a group is');
  assert.ok(SKILL.includes('buildDispatchGroups'), 'Step 4 must name the grouping function');
  assert.ok(SKILL.includes('re-derives nothing'), 'Step 4 must keep the re-derives-nothing rule');
  assert.ok(!SKILL.includes('groupByFileOverlap'), 'groupByFileOverlap is no longer the queue-pull primitive');
});

test('the bare-drain Loop excludes neighbour-in-flight groups', () => {
  const loop = line('Loop: run the `next` ranking below');
  assert.ok(loop.includes('neighbour-in-flight'), 'the drain Loop must name neighbour-in-flight groups as excluded');
});

test('neighbour-in-flight-report.md exists, mirrors the other Step 3 reports, and is cited from SKILL.md Step 3', () => {
  assert.ok(fs.existsSync(REPORT_PATH), 'neighbour-in-flight-report.md is missing');
  const report = readText(REPORT_PATH);
  assert.ok(report.startsWith('# Dispatch Step 3 — Neighbour-in-Flight Report'), 'report header out of shape');
  assert.ok(report.includes('Referenced by `skills/dispatch/SKILL.md` Step 3'), 'report must carry a Referenced-by line');
  assert.ok(report.includes("`reason: 'neighbour-in-flight'`"), 'report must filter dispatch-exclusions.json to its reason');
  assert.ok(report.includes('waits — direct neighbour(s) in flight'), 'report must carry the per-record line');
  assert.ok(report.includes('bare drain skips it this firing'), 'report line must say bare drain skips it');
  const step3 = SKILL.slice(SKILL.indexOf('### Step 3'), SKILL.indexOf('### Step 4'));
  assert.ok(step3.includes('**Neighbour-in-flight report (refs #3278).**'), 'SKILL.md Step 3 must carry the report pointer');
  assert.ok(step3.includes('`neighbour-in-flight-report.md`'), 'SKILL.md Step 3 pointer must name the file');
});

test('oversized-group-report.md says a group over the guard needs a bundle cap above it (#3278)', () => {
  const oversized = readText(path.join(DISPATCH, 'oversized-group-report.md'));
  assert.ok(
    oversized.includes('`dispatch-fastlane-bundle-cap` is set above `dispatch-group-size-guard`'),
    'oversized-group-report.md must explain when the report can still fire',
  );
});

const SHARED = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin').split(path.sep).join('/');

test('AC8.1: issue-claims Group claiming says groups are single records or fast-lane bundles and all-members claiming applies to bundles', () => {
  const claims = readText(path.join(SHARED, 'issue-claims.md'));
  const start = claims.indexOf('### Group claiming');
  assert.ok(start >= 0, 'issue-claims.md lost its "### Group claiming" heading');
  const end = claims.indexOf('**Post-write verification', start);
  assert.ok(end > start, 'issue-claims.md lost the "**Post-write verification" anchor after Group claiming');
  const section = claims.slice(start, end);
  assert.match(section, /single records? or (?:a |one )?fast-lane bundles?/i, 'Group claiming must say a group is a single record or a fast-lane bundle');
  assert.match(section, /fast-lane bundle/, 'Group claiming must say all-members claiming applies to a fast-lane bundle');
  assert.ok(section.includes('neighbour-in-flight'), 'Group claiming must name the neighbour-in-flight guard for cross-group overlap');
});

test('AC8.2 (shared/help/docs): no prose says a record pulls its whole file-overlap group', () => {
  const files = [
    path.join(SHARED, 'issue-claims.md'),
    path.join(ROOT, 'plugin', 'skills', 'help', 'reference-card.md'),
    path.join(ROOT, 'docs', 'getting-started.md'),
    path.join(ROOT, 'README.md'),
  ];
  for (const file of files) {
    const text = readText(file);
    assert.ok(!text.includes('whole file-overlap group'), `${path.relative(ROOT, file)} still carries "whole file-overlap group"`);
  }
});

test('design-notes.md records the per-record decision and names the hub-exclusion, weakest-edge and bare-drain alternatives', () => {
  const notes = readText(path.join(DISPATCH, 'design-notes.md'));
  const heading = '## Why per-record groups, not transitive file-overlap groups';
  const start = notes.indexOf(heading);
  assert.ok(start >= 0, `design-notes.md is missing "${heading}"`);
  const next = notes.indexOf('\n## ', start + heading.length);
  const section = notes.slice(start, next === -1 ? undefined : next);
  for (const token of ['#1365', 'weakest', 'bare drain']) {
    assert.ok(section.includes(token), `the per-record decision section must name ${token}`);
  }
});

test('AC1.1: the neighbour-in-flight pass reads claims through createClaimReader (#3393)', () => {
  const start = QUEUE_PULL.indexOf('# #3278: neighbour-in-flight pass');
  assert.ok(start !== -1, 'neighbour-in-flight anchor must exist');
  const block = QUEUE_PULL.slice(start, QUEUE_PULL.indexOf('NEIGHBOUR_RC=$?', start));
  assert.match(block, /readClaimContent: createClaimReader\(\)\.read/);
  assert.doesNotMatch(block, /readClaimBlob\(/);
  assert.doesNotMatch(block, /'repo', 'view'/);
});

function neighbourHeredocCode() {
  const open = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF\n';
  const close = '\nNODE_EVAL_EOF\nNEIGHBOUR_RC';
  const start = QUEUE_PULL.indexOf(open);
  const end = QUEUE_PULL.indexOf(close, start);
  assert.ok(start !== -1 && end !== -1, 'neighbour-in-flight heredoc anchors must exist');
  return QUEUE_PULL.slice(start + open.length, end).split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_DIR);
}

// Runs the heredoc with PATH pointing at an empty dir, so gh and git are unavailable and nothing
// reaches the network. Returns the process result and the neighbour-in-flight exclusions written.
function runNeighbourPass(groups, inFlight) {
  const code = neighbourHeredocCode();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neighbour-pass-'));
  const groupsPath = path.join(dir, 'groups.json');
  const inFlightPath = path.join(dir, 'in-flight.json');
  const exclusionsPath = path.join(dir, 'exclusions.json');
  try {
    fs.writeFileSync(groupsPath, JSON.stringify(groups));
    fs.writeFileSync(inFlightPath, JSON.stringify(inFlight));
    const result = spawnSync(process.execPath, ['-e', code, groupsPath, inFlightPath, exclusionsPath], { encoding: 'utf8', env: { ...process.env, PATH: dir } });
    const exclusions = fs.existsSync(exclusionsPath) ? JSON.parse(fs.readFileSync(exclusionsPath, 'utf8')) : [];
    return { result, neighbourExclusions: exclusions.filter((e) => e.reason === 'neighbour-in-flight') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CANDIDATE_GROUPS = [[{ number: 1, body: '### Key Files\n\n- `a.js`\n', labels: [] }]];

test('AC2.1: the neighbour-in-flight heredoc runs offline and excludes nothing when no in-flight record neighbours a candidate (#3393)', () => {
  // No neighbour means no claim read.
  const { result, neighbourExclusions } = runNeighbourPass(CANDIDATE_GROUPS, []);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(neighbourExclusions, []);
});

test('AC1.1: the neighbour-in-flight heredoc reports a failed claim read and writes no exclusion when the repo slug is unresolved (#3393)', () => {
  // Candidate #1 and in-flight #2 share a Key File, so the pass reads #2's claim. With gh and git
  // unavailable the slug is unresolved and the git leg fails, so the read is a failure
  // (repo-slug-unresolved), never an absent claim, and #2 is treated as not in flight.
  const inFlight = [{ number: 2, body: '### Key Files\n\n- `a.js`\n', labels: [{ name: 'bot:in-progress' }] }];
  const { result, neighbourExclusions } = runNeighbourPass(CANDIDATE_GROUPS, inFlight);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /neighbour-in-flight claim read failed for #2/);
  assert.deepEqual(neighbourExclusions, []);
});

function poolFetchBlock() {
  const close = '\nfi\n';
  const start = QUEUE_PULL.indexOf('if ! gh issue list --label bot:in-progress');
  const end = QUEUE_PULL.indexOf(close, start);
  assert.ok(start !== -1 && end !== -1, 'neighbour-in-flight pool fetch anchors must exist');
  return QUEUE_PULL.slice(start, end + close.length);
}

test('a failed neighbour-in-flight pool fetch writes an empty pool and says so, so nothing is excluded (#3278)', () => {
  // PATH points at an empty dir, so gh is not found and the fetch fails.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neighbour-pool-'));
  const rawPath = path.join(dir, 'in-flight-raw.json');
  try {
    const result = spawnSync('/bin/sh', ['-c', poolFetchBlock()], { encoding: 'utf8', env: { PATH: dir, DISPATCH_IN_FLIGHT_RAW: rawPath } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(rawPath, 'utf8')), []);
    assert.match(result.stderr, /AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
