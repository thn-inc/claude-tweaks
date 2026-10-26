'use strict';

// #3324: a flag-back row dropped for a gained auto:build must log whether that concurrent
// grant agreed with this run's own RECOMMEND_BUILD verdict, the same way the #2719 grant-row
// comparison does. Each assertion is proved able to go red [IL-105]: assertions on text this
// record rewrote are paired with the pre-change bytes of that same region (frozen below);
// assertions on prose this record added have no pre-change bytes, so they are paired with an
// in-memory mutation that removes only the pinned clause.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { computeClosingTally } = require('../plugin/bin/lib/closing-tally/closing-tally');
const { readText } = require('./helpers/read-skill');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const refineMode = readText(path.join(DIR, 'refine-mode.md'));
const closing = readText(path.join(DIR, 'refine-closing-summary.md'));

// Pre-change sentences this record rewrites — go-red controls for the two assertions that pin
// the rewritten region itself.
const PRE_REVERIFY = "A grant row dropped for a gained grant logs whether that concurrent grant agreed with this run's own verdict — `refine-closing-summary.md`'s Concurrent-grant comparison (#2719). Flag-back reverify checks labels only";
const PRE_TEMPLATES = 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.\n'
  + 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant agreed: live {live grant}, this run RECOMMEND_MERGE={true|false}); dropped without writing.\n'
  + 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_MERGE={true|false} — {grant-check RATIONALE}); dropped without writing.\n'
  + 'FAILED {time}';

// The added comparison paragraph, isolated so each pin is scoped to it and needs no proximity window.
const PARA = closing.split('\n\n').find((p) => p.startsWith('**Flag-back concurrent-grant comparison (#3324).**'));

function pinned(text, pattern, pre, message) {
  assert.match(text, pattern, message);
  assert.doesNotMatch(pre, pattern, 'pattern must not match the pre-change text (proves it can go red)');
}

// New prose has no pre-change bytes: prove the pin by deleting only its own clause from the live text.
function pinnedByMutation(text, pattern, clause, message) {
  assert.match(text, pattern, message);
  assert.ok(text.includes(clause), 'the clause to remove must exist in the live text');
  assert.doesNotMatch(text.replace(clause, ''), pattern, 'pattern must fail once its clause is removed (proves it can go red)');
}

test('the flag-back comparison paragraph exists in refine-closing-summary.md', () => {
  assert.ok(PARA, 'expected a paragraph opening with "**Flag-back concurrent-grant comparison (#3324).**"');
});

test('AC1.1: refine-mode.md routes a flag-back row that gained auto:build to the flag-back comparison', () => {
  pinned(refineMode, /A flag-back row dropped for a gained `auto:build` logs the same comparison against its own `RECOMMEND_BUILD` verdict — `refine-closing-summary\.md`'s Flag-back concurrent-grant comparison \(#3324\)/, PRE_REVERIFY,
    'refine-mode.md Step 5 must route a flag-back row that gained auto:build to the flag-back comparison');
});

test('AC1.1: closing summary carries distinguishable flag-back agreed and DIVERGED templates', () => {
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(flag-back concurrent grant agreed: live \{live grant\}, this run RECOMMEND_BUILD=true\); dropped without writing\./, PRE_TEMPLATES,
    'flag-back agreed-form skip template missing');
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(flag-back concurrent grant DIVERGED: live \{live grant\}, this run discarded RECOMMEND_BUILD=false — \{grant-check RATIONALE\}\); dropped without writing\./, PRE_TEMPLATES,
    'flag-back DIVERGED-form skip template must name the discarded RECOMMEND_BUILD value and its rationale');
});

test('AC1.1: flag-back comparison judges the RECOMMEND_BUILD verdict, not the flag-back reason', () => {
  pinnedByMutation(PARA, /against this run's own `RECOMMEND_BUILD` verdict for the row/, "against this run's own `RECOMMEND_BUILD` verdict for the row",
    'flag-back comparison must judge agreement against RECOMMEND_BUILD');
  pinnedByMutation(PARA, /the grant-check verdict itself, not the reason the row was flagged back/, 'the grant-check verdict itself, not the reason the row was flagged back',
    'flag-back comparison must say the verdict, not the flag-back reason, decides');
});

test('AC1.1: a no-verdict flag-back row keeps the generic skip line, never agreed/DIVERGED', () => {
  const clause = '`concurrent grant: live {live grant}; flag-back row, no grant-check verdict to compare`';
  pinnedByMutation(PARA, /`concurrent grant: live \{live grant\}; flag-back row, no grant-check verdict to compare`/, clause,
    'a flag-back row with no grant-check verdict must name its {what changed} without claiming agreement or divergence');
});

test('AC1.1: other flag-back skips keep the generic line', () => {
  const clause = 'A flag-back row that gained `risk:*`/`size:*`/`bot:in-progress` without `auto:build`, or that hit a live-state fetch failure, keeps the generic line.';
  pinnedByMutation(PARA, /gained `risk:\*`\/`size:\*`\/`bot:in-progress` without `auto:build`, or that hit a live-state fetch failure, keeps the generic line/, clause,
    'flag-back rows that gained no auto:build must keep the generic skip line');
});

test('AC2.1: one grep finds every flag-back divergence, and only those', () => {
  pinnedByMutation(PARA, /grep 'flag-back concurrent grant DIVERGED' "\$PIPELINE_RUN_DIR\/decisions\.md"/, 'grep \'flag-back concurrent grant DIVERGED\' "$PIPELINE_RUN_DIR/decisions.md"',
    'comparison rule must name the paste-ready grep for flag-back divergences');

  const lines = closing.split('\n').filter((l) => l.includes('concurrent grant') && l.startsWith('AUTO {time}'));
  assert.equal(lines.length, 4, 'expected 2 grant-row and 2 flag-back concurrent-grant template lines');

  const filled = lines.map((l) => l
    .replace(/\{time\}/g, '10:00:01')
    .replace(/\{n\}/g, '7')
    .replace(/\{live grant\}/g, 'auto:build')
    .replace(/\{grant-check RATIONALE\}/g, 'narrow fix'));

  const flagBackDiverged = filled.filter((l) => l.includes('flag-back concurrent grant DIVERGED'));
  assert.equal(flagBackDiverged.length, 1, 'exactly one line is the flag-back DIVERGED form');

  const anyDiverged = filled.filter((l) => l.includes('concurrent grant DIVERGED'));
  assert.equal(anyDiverged.length, 2, 'both DIVERGED forms match the shared grep pattern');

  const { counts, unclassified } = computeClosingTally('## /backlog\n' + filled.map((l) => '- ' + l).join('\n') + '\n');
  assert.equal(counts.skipped, 4);
  assert.deepEqual(unclassified, []);
});

// A needs-scoring row is always RECOMMEND_BUILD: false (refine-lanes.md's
// flag back (needs scoring) rows), so it can never be a true-verdict flag-back example.
test('AC1.1: the flag-back paragraph says a needs-scoring row always carries RECOMMEND_BUILD false', () => {
  const clause = 'a needs-scoring row always carries `RECOMMEND_BUILD: false`';
  pinnedByMutation(PARA, /a needs-scoring row always carries `RECOMMEND_BUILD: false`/, clause,
    'the flag-back paragraph must state that a needs-scoring row always carries RECOMMEND_BUILD false');
});

// A re-authorize (bot:blocked) row a human flags back in Step 4 was never
// grant-checked (Step 3 skips it), so it has no verdict and must keep the generic line.
test('AC1.1: the no-verdict carve-out names a human-flagged re-authorize row', () => {
  const clause = 'a re-authorize (`bot:blocked`) row a human flagged back in Step 4';
  pinnedByMutation(PARA, /a re-authorize \(`bot:blocked`\) row a human flagged back in Step 4/, clause,
    'the no-verdict carve-out must name a re-authorize (bot:blocked) row a human flagged back in Step 4');
});
