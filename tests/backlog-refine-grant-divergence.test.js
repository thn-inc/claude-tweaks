'use strict';

// #2719: Step 5's pre-write reverify must tell a concurrent grant that agreed with this
// run's own grant-check verdict apart from one that diverged. Each assertion is paired with
// a go-red probe against the pre-change text it replaces [IL-105].
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const refineMode = readText(path.join(DIR, 'refine-mode.md'));
const closing = readText(path.join(DIR, 'refine-closing-summary.md'));

// Pre-change sentences this record rewrites — used only as go-red probes.
const PRE_PROJECTION = "projected as: `ready` ↔ `facets.stage === 'ready'`, `auto:build` ↔ `facets.grants.build`, `bot:in-progress` ↔ `facets.bot.inProgress`.";
const PRE_GRANT_ROW = 'A grant row whose live labels lost `ready`, or a flag-back row whose live labels gained';
const PRE_TEMPLATES = 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.\nFAILED {time}';

// #2719 fix-wave: pre-fix-wave sentences from the Concurrent-grant comparison paragraph and
// the Concurrency paragraph, as they stood at bb2a7ed34 — used only as go-red probes below.
const PRE_FIXWAVE_COMPARISON = '**Concurrent-grant comparison (#2719).** When Step 5\'s pre-write reverify drops a grant row because the record\'s live labels gained `auto:build` and/or `auto:merge` since Step 1, compare that live grant (`{live grant}`: `auto:build`, `auto:build + auto:merge`, or `auto:merge` alone) against this run\'s own `RECOMMEND_MERGE` verdict for the row before logging — the grant-check verdict itself, not the session-wide "Grant auto:build only, hold merge" override, which changes only what this run would have written. It **agreed** when live carries `auto:build` and live `auto:merge` presence equals `RECOMMEND_MERGE`; anything else **diverged**. Log the matching line above: the DIVERGED form carries this run\'s discarded `RECOMMEND_MERGE` value and its grant-check RATIONALE verbatim, so a reader of `decisions.md` sees two independent judgments disagreed instead of assuming they repeated each other. A grant row skipped for any other reason (lost `ready`, a live-state fetch failure) keeps the generic line, as does every non-grant row. Both forms count as `skipped`. Every divergence of one sweep is listed by `grep \'concurrent grant DIVERGED\' {run-dir}/decisions.md`, and the closing summary\'s per-skip lines (item 3) carry the same text.';
const PRE_FIXWAVE_CONCURRENCY = 'Two humans running `/claude-tweaks:backlog refine` at the same time is safe by construction — every label add is idempotent, so two overlapping grants just repeat the same write.';

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
  pinned(closing, /\*\*Concurrent-grant comparison \(#2719\)\.\*\*[\s\S]{0,1900}any other reason[\s\S]{0,200}keeps the generic line/, PRE_TEMPLATES,
    'comparison rule must keep the generic skip line for non-grant reasons');
});

test('every divergence of one sweep is findable with one grep, paste-ready', () => {
  pinned(closing, /grep 'concurrent grant DIVERGED' "\$PIPELINE_RUN_DIR\/decisions\.md"/, PRE_FIXWAVE_COMPARISON,
    'comparison rule must name the paste-ready grep ($PIPELINE_RUN_DIR, not a {run-dir} placeholder) that finds every divergence');
});

// Important 1 (fix wave): the headless grant chain (refine-headless.md's Grant rows) writes
// auto:build + auto:merge-pending, never auto:merge directly, and parseRecordFacets (bin/lib/
// issues/record.js) never maps auto:merge-pending to facets.grants.merge — so the agreement
// rule must treat live auto:merge-pending as merge-present too, not just auto:merge.
test('auto:merge-pending counts as merge-present in the concurrent-grant comparison', () => {
  pinned(closing, /auto:merge`\/`auto:merge-pending` alone[\s\S]{0,400}writes `auto:build` \+ `auto:merge-pending`, never `auto:merge` directly, so both count as merge-present here/,
    PRE_FIXWAVE_COMPARISON,
    'comparison rule must state that auto:merge-pending counts as merge-present alongside auto:merge');
  pinned(closing, /`auto:build \+ auto:merge-pending`/, PRE_FIXWAVE_COMPARISON,
    'the {live grant} enumeration must include auto:build + auto:merge-pending');
  pinned(closing, /live `auto:merge`-or-`auto:merge-pending` presence equals `RECOMMEND_MERGE`/, PRE_FIXWAVE_COMPARISON,
    'the agreement test itself must check auto:merge OR auto:merge-pending presence, not auto:merge alone');
});

// Important 2 (fix wave): re-authorize (bot:blocked) rows are grant rows but Step 3 (refine-mode.md
// ~222-224) skips grant-check for them entirely, so they carry no RECOMMEND_MERGE/RATIONALE to
// compare — the comparison rule must not call these "agreed"/"DIVERGED".
test('a re-authorize row with no grant-check verdict keeps the generic skip line, never agreed/DIVERGED', () => {
  pinned(closing, /A re-authorize row \(`bot:blocked`; Step 3 skips its grant-check call entirely, so no `RECOMMEND_MERGE`\/RATIONALE exists to compare\) keeps the generic skip line instead/,
    PRE_FIXWAVE_COMPARISON,
    'comparison rule must carve out re-authorize rows as having no verdict to compare');
  pinned(closing, /`concurrent grant: live \{live grant\}; re-authorize row, no grant-check verdict to compare`/,
    PRE_FIXWAVE_COMPARISON,
    'the re-authorize row\'s {what changed} text must name the gained grant without claiming agreement/divergence');
});

// Minor 4 (fix wave): the comparison is this run's verdict vs. the other actor's *write*
// (a hold-merge choice or human override can write auto:build only without disagreeing with
// RECOMMEND_MERGE), not a claim that two independent judgments were computed and disagreed.
test('rationale is scoped to the live grant differing from this run\'s verdict, not an overclaimed judgment comparison', () => {
  pinned(closing, /sees the live grant differs from this run's own verdict instead of assuming they repeated each other/,
    PRE_FIXWAVE_COMPARISON,
    'comparison rule must not claim two independent judgments disagreed');
  pinned(closing, /this compares this run's verdict against the other actor's \*write\*, not necessarily its own verdict \(a concurrent hold-merge choice or human override writes `auto:build` only\)/,
    PRE_FIXWAVE_COMPARISON,
    'comparison rule must name the write-vs-verdict limitation');
});

// Minor 3 (fix wave): refine-mode.md's Concurrency paragraph's "idempotent, repeat the same
// write" sentence predates this record's drop-and-log behavior for a grant row invalidated by
// a concurrent write; it must point at the Concurrent-grant comparison instead.
test('Concurrency paragraph describes drop-and-log, not stale idempotent-repeat reasoning', () => {
  pinned(refineMode, /a grant that lands before this run's own write is dropped and logged per `refine-closing-summary\.md`'s Concurrent-grant comparison \(#2719\)/,
    PRE_FIXWAVE_CONCURRENCY,
    'Concurrency paragraph must describe the drop-and-log behavior, citing the Concurrent-grant comparison');
  assert.doesNotMatch(refineMode, /every label add is idempotent, so two overlapping grants just repeat the same write/,
    'stale idempotent-repeat sentence must be removed');
});
