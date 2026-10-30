// tests/acceptance-scan-server-filter.test.js
//
// Conformance for #4469: the `acceptance-gap` scope in _shared/github-pr-scan-acceptance.md
// fetches closed records through `gh issue list --search`, so the 30-day window and the
// disposition / not-planned / duplicate exclusions are applied by GitHub rather than by a
// newest-first `--limit` cut. The prose is the contract (an agent runs these fences), so the
// live file is read. Every positive claim is asserted twice: it matches the live scope, and it
// does NOT match the frozen excerpt of the bytes the change replaced (PRE_CHANGE_*), so a
// pattern that passes vacuously goes red here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { dispositionState } = require('../plugin/bin/lib/issues/acceptance');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

// The text from `startHeading` up to (not including) `endHeading`, or to the end of the text when
// `endHeading` is null. Throws when either anchor is missing so a renamed heading is a loud
// failure rather than an empty slice that every negative assertion passes over.
function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `heading not found: ${startHeading}`);
  if (endHeading === null) return text.slice(start);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `end heading not found after "${startHeading}": ${endHeading}`);
  return text.slice(start, end);
}

// A claim is pinned when the pattern matches the live text and does not match the frozen
// pre-change excerpt that carries the same anchor but lacks the pinned thing.
function assertClaimPinned(live, frozen, pattern, msg) {
  assert.ok(pattern.test(live), `${msg} — pattern must match the live text: ${pattern}`);
  assert.ok(!pattern.test(frozen), `${msg} — pattern must NOT match the frozen pre-change excerpt: ${pattern}`);
}

// The closed-record fetch exactly as it read before #4469 (github-pr-scan-acceptance.md, the
// acceptance-gap scope): an unfiltered newest-first fetch and the exact-equality truncation test.
const PRE_CHANGE_GAP_FETCH = String.raw`LIMIT="{resolved-limit}"
gh issue list --state closed --limit "$LIMIT" \
  --json number,title,state,labels,closedAt,stateReason \
  > "$RAW"
node -e "
  const fs = require('fs');
  const raw = require('$RAW');
  const LIMIT = $LIMIT;
  if (raw.length === LIMIT) {
`;

// The trust-table.md parenthetical as it read before #4469.
const PRE_CHANGE_TRUST = `(\`acceptance-gap\`'s own *closed-record* fetch is bounded by the same \`{resolved-limit}\` and
carries the same truncation-warning discipline — a 30-day window does not bound it, per that
file's "Fetch limit" section — not a separate hardcoded cap.)`;

const LIVE = read('_shared/github-pr-scan-acceptance.md');
const GAP = section(LIVE, '## Scope: `acceptance-gap`', '## Scope: `parent-gate`');

// The closed-record fetch fence: from its `gh issue list --state closed` line to the closing fence.
function closedFetchBlock(gap) {
  const start = gap.indexOf('gh issue list --state closed');
  assert.ok(start !== -1, 'the acceptance-gap scope must contain a `gh issue list --state closed` fetch');
  const end = gap.indexOf('\n```', start);
  assert.ok(end !== -1, 'the closed-record fetch fence must be closed');
  return gap.slice(start, end);
}

// The `--search "…"` argument of the closed-record fetch, unescaped quotes left as written.
function closedSearchString(gap) {
  const m = /gh issue list --state closed[^\n]*\\\n\s+--search "((?:[^"\\]|\\.)*)"/.exec(gap);
  assert.ok(m, 'the closed-record fetch must carry a --search "…" argument on the line after --limit');
  return m[1];
}

// Offsets of every `gh issue list --state closed` in `text` with no `--search` within 120 chars.
function closedFetchesWithoutSearch(text) {
  return [...text.matchAll(/gh issue list --state closed/g)]
    .filter((m) => !text.slice(m.index, m.index + 120).includes('--search'))
    .map((m) => m.index);
}

const hasPositiveReason = (search) => /(?<!-)reason:/.test(search);
const hasOversightFloor = (search) => /label:(risk|size):/.test(search);

test('the frozen excerpt carries the anchors the discrimination checks rely on', () => {
  assert.ok(PRE_CHANGE_GAP_FETCH.includes('gh issue list --state closed --limit "$LIMIT" \\\n'));
  assert.ok(PRE_CHANGE_GAP_FETCH.includes('  if (raw.length === LIMIT) {'));
  assert.ok(!PRE_CHANGE_GAP_FETCH.includes('--search'));
});

test('closed-record fetch is server-filtered', () => {
  assertClaimPinned(
    GAP,
    PRE_CHANGE_GAP_FETCH,
    /gh issue list --state closed --limit "\$LIMIT" \\\n\s+--search "closed:>=\$SINCE -reason:\\"not planned\\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending"/,
    'the closed-record fetch must narrow on the server through --search'
  );
  const occurrences = [...GAP.matchAll(/gh issue list --state closed/g)];
  assert.ok(occurrences.length >= 1, 'the anchor `gh issue list --state closed` must be present in the scope');
  assert.deepEqual(closedFetchesWithoutSearch(GAP), [], 'every closed-record fetch must carry --search within 120 chars');
});

test('the unsearched-fetch detector rejects a fetch with no --search within 120 chars', () => {
  // Unfiltered: the frozen pre-change fence carries the anchor and no --search at all.
  assert.equal(closedFetchesWithoutSearch(PRE_CHANGE_GAP_FETCH).length, 1);
  // Anchor present, --search pushed past the window.
  const far = `gh issue list --state closed --limit "$LIMIT" \\\n  --json ${'x'.repeat(130)} \\\n  --search "closed:>=$SINCE"`;
  assert.equal(closedFetchesWithoutSearch(far).length, 1);
  // Control: the same fetch with --search on the next line is accepted.
  assert.equal(closedFetchesWithoutSearch('gh issue list --state closed --limit "$LIMIT" \\\n  --search "closed:>=$SINCE" \\\n  --json number').length, 0);
});

test('negated labels are exactly needsBackstop dispositions', () => {
  const search = closedSearchString(GAP);
  const negated = [...search.matchAll(/-label:(\S+?)(?=\s|$)/g)].map((m) => m[1]).sort();
  assert.deepEqual(negated, ['demo:approved', 'demo:changes-requested', 'demo:pending']);
  for (const label of negated) {
    assert.notEqual(dispositionState([label]), 'none', `${label} must be a disposition label recognised by dispositionState`);
  }
});

test('never filters on a positive reason', () => {
  const search = closedSearchString(GAP);
  assert.ok(!hasPositiveReason(search), `a positive reason: qualifier would drop null-stateReason records: ${search}`);
  // The negated forms are what keep a null stateReason in; guard that they are really there.
  assert.ok(/-reason:\\"not planned\\"/.test(search) && /-reason:duplicate/.test(search));
  // Controls: the predicate rejects a positive reason and accepts the negated forms.
  assert.ok(hasPositiveReason('closed:>=$SINCE reason:completed'));
  assert.ok(hasPositiveReason('-reason:duplicate reason:completed'));
  assert.ok(!hasPositiveReason('-reason:duplicate -reason:\\"not planned\\"'));
});

test('oversight floor is not in the search string', () => {
  const search = closedSearchString(GAP);
  assert.ok(!hasOversightFloor(search), `the oversight floor stays client-side: ${search}`);
  // Controls: negated and positive risk/size qualifiers are both caught; a disposition label is not.
  assert.ok(hasOversightFloor('closed:>=$SINCE -label:risk:high'));
  assert.ok(hasOversightFloor('closed:>=$SINCE -label:size:small'));
  assert.ok(hasOversightFloor('label:risk:low'));
  assert.ok(!hasOversightFloor('-label:demo:approved'));
});

test('searched fetches warn at the search ceiling', () => {
  assertClaimPinned(
    GAP,
    PRE_CHANGE_GAP_FETCH,
    /const CAP = Math\.min\(LIMIT, 1000\);\s*if \(raw\.length >= CAP\)/,
    'the closed-record warning must compare against min(LIMIT, 1000)'
  );
  assert.ok(
    !closedFetchBlock(GAP).includes('raw.length === LIMIT'),
    'the exact-equality truncation test must be gone from the closed-record block'
  );
});

test('since-date is validated', () => {
  assertClaimPinned(GAP, PRE_CHANGE_GAP_FETCH, /SINCE="\{since-date\}"/, 'the fence must substitute {since-date} literally');
  assertClaimPinned(
    GAP,
    PRE_CHANGE_GAP_FETCH,
    /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(process\.env\.SINCE/,
    'the node block must validate SINCE as YYYY-MM-DD'
  );
  const oneLiner = 'new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)';
  assert.ok(GAP.includes(oneLiner), 'the scope must name the one-liner that resolves {since-date}');
  assert.ok(!PRE_CHANGE_GAP_FETCH.includes(oneLiner));
});

test('since-date guard failure stops the scope', () => {
  const stops = /since-date[^\n]*throws[\s\S]{0,300}report\s+no\s+`\[acceptance-gap\]`\s+rows\s+at\s+all/;
  const sentence = 'When the since-date guard throws, the scope stops: ';
  const outcome = 'report no `[acceptance-gap]` rows at all and quote the error verbatim.';
  // The control carries the anchor and the outcome sentence, with the sentence pushed past 300 chars.
  const FAR_CONTROL = `${sentence}${'filler words '.repeat(30)}${outcome}`;
  assert.ok(FAR_CONTROL.indexOf(outcome) - sentence.length > 300);
  assertClaimPinned(GAP, FAR_CONTROL, stops, 'a failing since-date guard must stop the scope with no rows');
  assert.ok(!stops.test(PRE_CHANGE_GAP_FETCH));
  // Control for the control: the same sentences adjacent do match, so the window is what rejects the far one.
  assert.ok(stops.test(`${sentence}${outcome}`));
});

test('trust-table no longer says the window does not bound the closed fetch', () => {
  const live = read('_shared/trust-table.md');
  const parenthetical = (text) => {
    const m = /\(`acceptance-gap`'s own \*closed-record\* fetch[\s\S]*?\)/.exec(text);
    assert.ok(m, 'the acceptance-gap closed-record parenthetical must be present');
    return m[0];
  };
  const STALE = 'a 30-day window does not bound it';
  assert.ok(!live.includes(STALE), 'trust-table.md must not say the 30-day window does not bound the closed fetch');
  assert.ok(parenthetical(live).includes('server'), 'the parenthetical must name the server-side bound');
  // Discrimination: the same two checks run over the frozen parenthetical must come out the other way.
  assert.ok(PRE_CHANGE_TRUST.includes(STALE));
  assert.ok(!parenthetical(PRE_CHANGE_TRUST).includes('server'));
});

// ---- parent-gate state map (#4469 Task 2) ----------------------------------------------------

const PG = section(LIVE, '## Scope: `parent-gate`', null);

// The parent-gate bytes the change replaced, in their pre-change order: the old `### Fetch limit`
// heading, the unsearched state-map call, the exact-equality warning test, and the old
// `### \`work-links\` resolution` heading (which sat below the Fetch-limit section).
const PRE_CHANGE_PG = [
  '### Fetch limit',
  'gh issue list --state all --json number,state,labels --limit "$LIMIT" \\',
  '  if (states.length === LIMIT) {',
  '### `work-links` resolution',
].join('\n');

const WORK_LINKS_HEADING = '### `work-links` resolution';
const FETCH_LIMIT_HEADING = '### Fetch limit';

// True when both ordering anchors are present and `work-links` resolves before the state-map fetch.
function workLinksFirst(text) {
  const wl = text.indexOf(WORK_LINKS_HEADING);
  const fl = text.indexOf(FETCH_LIMIT_HEADING);
  return wl !== -1 && fl !== -1 && wl < fl;
}

// True when some `{state-map-search}` placeholder has both branch values named within `radius` chars.
function namesBothValuesNearPlaceholder(text, radius) {
  return [...text.matchAll(/\{state-map-search\}/g)].some((m) => {
    const window = text.slice(Math.max(0, m.index - radius), m.index + radius);
    return window.includes('has:parent-issue') && window.includes('body-text');
  });
}

test('the frozen parent-gate excerpt carries the anchors the discrimination checks rely on', () => {
  assert.ok(PRE_CHANGE_PG.includes(FETCH_LIMIT_HEADING) && PRE_CHANGE_PG.includes(WORK_LINKS_HEADING));
  assert.ok(PRE_CHANGE_PG.includes('  if (states.length === LIMIT) {'));
  assert.ok(!PRE_CHANGE_PG.includes('STATE_SEARCH') && !PRE_CHANGE_PG.includes('--search'));
});

test('state map search is branch-resolved', () => {
  assertClaimPinned(PG, PRE_CHANGE_PG, /STATE_SEARCH='\{state-map-search\}'/, 'the fence must substitute {state-map-search} literally');
  assertClaimPinned(PG, PRE_CHANGE_PG, /export STATE_SEARCH/, 'the fence must export STATE_SEARCH for the node block');
  assertClaimPinned(
    PG,
    PRE_CHANGE_PG,
    /gh issue list --state all --search "\$STATE_SEARCH" --json number,state,labels --limit "\$LIMIT"/,
    'the state-map call must carry the resolved search'
  );
  assert.ok(namesBothValuesNearPlaceholder(PG, 400), 'the prose must name has:parent-issue and body-text within 400 chars of {state-map-search}');
  // Controls: the anchor with the values pushed past the window, the values without the anchor, and the adjacent form.
  const far = `{state-map-search}${' filler'.repeat(80)} has:parent-issue body-text`;
  assert.ok(!namesBothValuesNearPlaceholder(far, 400));
  assert.ok(!namesBothValuesNearPlaceholder('has:parent-issue body-text', 400));
  assert.ok(!namesBothValuesNearPlaceholder('{state-map-search} has:parent-issue only', 400));
  assert.ok(namesBothValuesNearPlaceholder('{state-map-search} has:parent-issue or body-text', 400));
});

test('work-links resolved before the state-map fetch', () => {
  assert.ok(workLinksFirst(PG), 'the work-links resolution must sit above the Fetch limit section');
  assert.ok(!workLinksFirst(PRE_CHANGE_PG), 'the frozen excerpt carries both anchors in the pre-change order');
  // Control for the predicate: a missing anchor is not "ordered".
  assert.ok(!workLinksFirst(WORK_LINKS_HEADING));
  assert.ok(workLinksFirst(`${WORK_LINKS_HEADING}\n${FETCH_LIMIT_HEADING}`));
});

test('state-map warning honours the search ceiling', () => {
  assertClaimPinned(
    PG,
    PRE_CHANGE_PG,
    /const STATE_CAP = process\.env\.STATE_SEARCH \? Math\.min\(LIMIT, 1000\) : LIMIT;\s*if \(states\.length >= STATE_CAP\)/,
    'the state-map warning must compare against the search ceiling only for a searched map'
  );
  assert.ok(!PG.includes('states.length === LIMIT'), 'the exact-equality state-map test must be gone');
});

// The three things the state-map warning must name: the cap value, the default-to-OPEN consequence,
// and that raising backlog-fetch-limit past 1000 does not help a searched map.
const warningParts = (line) => ({
  cap: /reaching\s+the\s+state-map\s+cap\s+of\s+'\s*\+\s*STATE_CAP/.test(line),
  open: /defaults\s+to\s+OPEN/.test(line),
  ceiling: /raising\s+it\s+past\s+1000\s+does\s+not\s+help\s+a\s+searched\s+map/.test(line),
});

// The state-map warning's `console.error(…)` line, found by its distinguishing phrase.
function stateMapWarningLine(text) {
  const line = text.split('\n').find((l) => l.includes('console.error') && l.includes('issue states'));
  assert.ok(line, 'the state-map warning line must be present');
  return line;
}

// The warning as it read before #4469: it named the default-to-OPEN consequence and nothing else of the three.
const PRE_CHANGE_STATE_WARNING = "    console.error('WARNING: fetched exactly ' + states.length + ' issue states (the configured backlog-fetch-limit) — every sub-issue beyond this cap defaults to OPEN, so any parent containing one reads incomplete and this backstop silently never fires for it. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete.');";

test('state-map warning names the cap, the default-to-OPEN consequence and the ceiling', () => {
  assert.deepEqual(warningParts(stateMapWarningLine(PG)), { cap: true, open: true, ceiling: true });
  // Controls: the pre-change warning names only the consequence; a stripped message names none of them.
  assert.deepEqual(warningParts(stateMapWarningLine(PRE_CHANGE_STATE_WARNING)), { cap: false, open: true, ceiling: false });
  assert.deepEqual(warningParts("console.error('WARNING: fetched ' + states.length + ' issue states');"), { cap: false, open: false, ceiling: false });
  // Whitespace tolerance: a rewrapped phrase still counts.
  assert.equal(warningParts('raising it past 1000\n  does not help a searched map').ceiling, true);
});

test('state-map search is validated', () => {
  assertClaimPinned(
    PG,
    PRE_CHANGE_PG,
    /\['', 'has:parent-issue'\]\.includes\(process\.env\.STATE_SEARCH\)/,
    'the node block must validate STATE_SEARCH against the two branch values'
  );
});

test('state-map guard failure stops the scope', () => {
  const stops = /state-map-search[^\n]*throws[\s\S]{0,300}report\s+no\s+`\[parent-gate\]`\s+rows\s+at\s+all/;
  const sentence = 'When the state-map-search guard throws, the scope stops: ';
  const outcome = 'report no `[parent-gate]` rows at all and quote the error verbatim.';
  // The control carries the anchor and the outcome sentence, with the sentence pushed past 300 chars.
  const FAR_CONTROL = `${sentence}${'filler words '.repeat(30)}${outcome}`;
  assert.ok(FAR_CONTROL.indexOf(outcome) - sentence.length > 300);
  assertClaimPinned(PG, FAR_CONTROL, stops, 'a failing state-map-search guard must stop the scope with no rows');
  assert.ok(!stops.test(PRE_CHANGE_PG));
  // Control for the control: the same sentences adjacent do match, so the window is what rejects the far one.
  assert.ok(stops.test(`${sentence}${outcome}`));
});
