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
const crypto = require('node:crypto');
const { readText } = require('./helpers/read-skill');
const { PASSES, makeContext, runPasses } = require('../plugin/bin/lib/dispatch/queue-pull');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
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

// #5230: the neighbour-in-flight pass is the queue-pull module's (plugin/bin/lib/dispatch/
// queue-pull.js), run alone here on the gh transport: `pool` answers its one `gh issue list` call
// (null fails it) and `claim(n)` the claim reads, which go through deps.createClaimReader. Returns
// the stderr, the pool file it wrote, the neighbour-in-flight entries and the claims it read.
// An unexpected call is recorded and asserted after the pass: the pass catches a throw from `run`
// as a failed fetch, so an assertion thrown inside it would never fail the test.
function runNeighbourPass(t, groups, pool, claim = () => ({ content: null })) {
  const errs = [];
  const read = [];
  const unexpected = [];
  const ctx = makeContext({ sessionId: `per-record-neighbour-${crypto.randomBytes(6).toString('hex')}` }, {
    stderr: (s) => errs.push(s),
    run: (cmd, args) => {
      if (cmd !== 'gh' || args[0] !== 'issue' || args[1] !== 'list' || args[3] !== 'bot:in-progress') {
        unexpected.push(`${cmd} ${args.join(' ')}`);
        throw new Error(`unexpected call ${cmd} ${args.join(' ')}`);
      }
      if (pool === null) throw Object.assign(new Error('gh: not found'), { stdout: '' });
      return JSON.stringify(pool);
    },
    createClaimReader: () => ({ read: (n) => { read.push(n); return claim(n); } }),
  });
  t.after(() => fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true }));
  fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify(groups));
  fs.writeFileSync(ctx.paths['dispatch-exclusions.json'], '[]');
  runPasses(PASSES.filter((p) => p.id === 'neighbour-in-flight'), ctx);
  assert.deepEqual(unexpected, [], 'the neighbour-in-flight pass made a call other than its one gh issue list');
  return {
    stderr: errs.join(''),
    raw: JSON.parse(fs.readFileSync(ctx.paths['dispatch-in-flight-raw.json'], 'utf8')),
    neighbourExclusions: JSON.parse(fs.readFileSync(ctx.paths['dispatch-exclusions.json'], 'utf8')).filter((e) => e.reason === 'neighbour-in-flight'),
    read,
  };
}

const CANDIDATE_GROUPS = [[{ number: 1, body: '### Key Files\n\n- `a.js`\n', labels: [] }]];
const IN_FLIGHT_NEIGHBOUR = [{ number: 2, body: '### Key Files\n\n- `a.js`\n', labels: [{ name: 'bot:in-progress' }] }];

test('AC2.1: the neighbour-in-flight pass reads no claim and excludes nothing when no in-flight record neighbours a candidate (#3393)', (t) => {
  const { neighbourExclusions, read } = runNeighbourPass(t, CANDIDATE_GROUPS, []);
  assert.deepEqual(read, [], 'no neighbour means no claim read');
  assert.deepEqual(neighbourExclusions, []);
});

test('AC1.1: the neighbour-in-flight pass reads a neighbour\'s claim through createClaimReader, and a failed read is reported and excludes nothing (#3393)', (t) => {
  // Candidate #1 and in-flight #2 share a Key File, so the pass reads #2's claim. A failed read is
  // never an absent claim: #2 is reported and treated as not in flight.
  const { stderr, neighbourExclusions, read } = runNeighbourPass(t, CANDIDATE_GROUPS, IN_FLIGHT_NEIGHBOUR, () => ({ failure: 'repo-slug-unresolved' }));
  assert.deepEqual(read, [2]);
  assert.match(stderr, /neighbour-in-flight claim read failed for #2/);
  assert.deepEqual(neighbourExclusions, []);
});

test('a failed neighbour-in-flight pool fetch writes an empty pool and says so, so nothing is excluded (#3278)', (t) => {
  const { stderr, raw, neighbourExclusions, read } = runNeighbourPass(t, CANDIDATE_GROUPS, null);
  assert.deepEqual(raw, []);
  assert.match(stderr, /AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull/);
  assert.deepEqual(neighbourExclusions, []);
  assert.deepEqual(read, []);
});
