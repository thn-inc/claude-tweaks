'use strict';

// #2719: Step 5's pre-write reverify must tell a concurrent grant that agreed with this
// run's own grant-check verdict apart from one that diverged. Each assertion is paired with
// a go-red probe against the pre-change text it replaces [IL-105].
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const refineMode = fs.readFileSync(path.join(DIR, 'refine-mode.md'), 'utf8');
const closing = fs.readFileSync(path.join(DIR, 'refine-closing-summary.md'), 'utf8');

// Pre-change sentences this record rewrites — used only as go-red probes.
const PRE_PROJECTION = "projected as: `ready` ↔ `facets.stage === 'ready'`, `auto:build` ↔ `facets.grants.build`, `bot:in-progress` ↔ `facets.bot.inProgress`.";
const PRE_GRANT_ROW = 'A grant row whose live labels lost `ready`, or a flag-back row whose live labels gained';
const PRE_TEMPLATES = 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.\nFAILED {time}';

function pinned(text, pattern, pre, message) {
  assert.match(text, pattern, message);
  assert.doesNotMatch(pre, pattern, 'pattern must not match the pre-change text (proves it can go red)');
}

test('reverify projection includes auto:merge', () => {
  pinned(refineMode, /`auto:merge` ↔ `facets\.grants\.merge`/, PRE_PROJECTION,
    'refine-mode.md Step 5 projection must include auto:merge ↔ facets.grants.merge');
});

test('a grant row that gained a concurrent grant is invalidated and routed to the comparison rule', () => {
  pinned(refineMode, /grant row whose live labels lost `ready` or gained `auto:build`\/`auto:merge`/, PRE_GRANT_ROW,
    'refine-mode.md must invalidate a grant row whose live labels gained auto:build/auto:merge');
  pinned(refineMode, /refine-closing-summary\.md`'s Concurrent-grant comparison/, PRE_GRANT_ROW,
    'refine-mode.md must point at refine-closing-summary.md\'s Concurrent-grant comparison');
});

test('closing summary carries distinguishable agreed and DIVERGED skip templates', () => {
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(concurrent grant agreed: /, PRE_TEMPLATES,
    'agreed-form skip template missing');
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(concurrent grant DIVERGED: live \{live grant\}, this run discarded RECOMMEND_MERGE=\{true\|false\} — \{grant-check RATIONALE\}\)/, PRE_TEMPLATES,
    'DIVERGED-form skip template must name the discarded RECOMMEND_MERGE value and its rationale');
});

test('comparison rule judges against the computed verdict, not the hold-merge override', () => {
  pinned(closing, /\*\*Concurrent-grant comparison \(#2719\)\.\*\*[\s\S]{0,900}this run's own `RECOMMEND_MERGE` verdict[\s\S]{0,300}not the session-wide "Grant auto:build only, hold merge" override/, PRE_TEMPLATES,
    'comparison rule must judge agreement against RECOMMEND_MERGE, not the hold-merge override');
});

test('non-grant skips keep the generic line', () => {
  pinned(closing, /\*\*Concurrent-grant comparison \(#2719\)\.\*\*[\s\S]{0,1600}any other reason[\s\S]{0,200}keeps the generic line/, PRE_TEMPLATES,
    'comparison rule must keep the generic skip line for non-grant reasons');
});

test('every divergence of one sweep is findable with one grep', () => {
  pinned(closing, /grep 'concurrent grant DIVERGED' \{run-dir\}\/decisions\.md/, PRE_TEMPLATES,
    'comparison rule must name the grep that finds every divergence');
});
