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
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { readText } = require('./helpers/read-skill');
const { sessionTmpRoot } = require('../plugin/bin/lib/session-tmp');
const { dispositionState, needsBackstop } = require('../plugin/bin/lib/issues/acceptance');

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

// The closed-record fetch as it read before the #4598 date-slice split: one server-filtered
// `closed:>=$SINCE` fetch, its node block, and the whole-fetch `raw.length >= CAP` warning. Copied
// verbatim from the live fence (github-pr-scan-acceptance.md, acceptance-gap) before the split.
const PRE_CHANGE_SLICED_FETCH = String.raw`gh issue list --state closed --limit "$LIMIT" \
  --search "closed:>=$SINCE -reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending" \
  --json number,title,state,labels,closedAt,stateReason \
  > "$RAW"
node -e "
  const fs = require('fs');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(process.env.SINCE || '') || new Date(process.env.SINCE) > new Date(Date.now() - 30 * 864e5)) throw new Error('SINCE is not a YYYY-MM-DD date over 30 days back — the since-date placeholder was not substituted or was resolved wrong; an empty date returns zero rows, a later one drops records.');
  const raw = require('$RAW');
  const LIMIT = $LIMIT;
  const CAP = Math.min(LIMIT, 1000);
  if (raw.length >= CAP) {
    console.error('WARNING: the server-filtered closed-record fetch returned ' + raw.length + ' records, reaching its cap of ' + CAP + ' (the smaller of backlog-fetch-limit and the 1000-result search ceiling) — records past it are invisible to this scope. Below 1000, raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run; at 1000 or above, the 30-day undisposed set itself reaches or exceeds the search ceiling and this scope cannot be complete.');
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync('$CLOSED', JSON.stringify(raw.filter((r) => r.closedAt > cutoff)));
"`;

// The `--search` exclusions every closed-record slice shares (needsBackstop's dispositions, in both
// acceptance-label spellings, and reasons).
const EXCLUSIONS = '-reason:\\"not planned\\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending';

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

// The `--search "…"` argument of every closed-record fetch (one per date slice), in file order,
// unescaped quotes left as written.
function closedSearchStrings(gap) {
  const found = [...gap.matchAll(/gh issue list --state closed[^\n]*\\\n\s+--search "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.ok(found.length > 0, 'the closed-record fetch must carry a --search "…" argument on the line after --limit');
  return found;
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
    PRE_CHANGE_SLICED_FETCH,
    /gh issue list --state closed --limit "\$LIMIT" \\\n\s+--search "closed:\$SINCE\.\.\$MID -reason:\\"not planned\\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending"/,
    'the older date slice must narrow on the server through --search'
  );
  assertClaimPinned(
    GAP,
    PRE_CHANGE_SLICED_FETCH,
    /gh issue list --state closed --limit "\$LIMIT" \\\n\s+--search "closed:>\$MID -reason:\\"not planned\\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending"/,
    'the newer date slice must narrow on the server through --search'
  );
  assert.deepEqual(
    closedSearchStrings(GAP),
    [`closed:$SINCE..$MID ${EXCLUSIONS}`, `closed:>$MID ${EXCLUSIONS}`],
    'the closed-record fetch must be exactly the two date slices, each carrying the shared exclusions'
  );
  const occurrences = [...GAP.matchAll(/gh issue list --state closed/g)];
  assert.equal(occurrences.length, 2, 'the scope must issue exactly one fetch per date slice');
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
  const dispositionLabels = ['accept:approved', 'accept:changes-requested', 'accept:pending', 'demo:approved', 'demo:changes-requested', 'demo:pending'];
  for (const search of closedSearchStrings(GAP)) {
    const negated = [...search.matchAll(/-label:(\S+?)(?=\s|$)/g)].map((m) => m[1]).sort();
    assert.deepEqual(negated, dispositionLabels, `every slice negates exactly the dispositions: ${search}`);
  }
  for (const label of dispositionLabels) {
    assert.notEqual(dispositionState([label]), 'none', `${label} must be a disposition label recognised by dispositionState`);
  }
});

test('never filters on a positive reason', () => {
  for (const search of closedSearchStrings(GAP)) {
    assert.ok(!hasPositiveReason(search), `a positive reason: qualifier would drop null-stateReason records: ${search}`);
    // The negated forms are what keep a null stateReason in; guard that they are really there.
    assert.ok(/-reason:\\"not planned\\"/.test(search) && /-reason:duplicate/.test(search), `negated reasons missing: ${search}`);
  }
  // Controls: the predicate rejects a positive reason and accepts the negated forms.
  assert.ok(hasPositiveReason('closed:>=$SINCE reason:completed'));
  assert.ok(hasPositiveReason('-reason:duplicate reason:completed'));
  assert.ok(!hasPositiveReason('-reason:duplicate -reason:\\"not planned\\"'));
});

test('negated reasons are exactly needsBackstop exclusions', () => {
  const negatedBySlice = closedSearchStrings(GAP).map((search) =>
    [...search.matchAll(/-reason:(?:\\"([^\\]+)\\"|(\S+))/g)]
      .map((m) => (m[1] || m[2]).toUpperCase().replace(/ /g, '_')).sort()
  );
  for (const reasons of negatedBySlice) {
    assert.deepEqual(reasons, ['DUPLICATE', 'NOT_PLANNED'], 'every slice excludes exactly the not-planned and duplicate reasons');
  }
  for (const stateReason of negatedBySlice[0]) {
    assert.equal(needsBackstop({ state: 'CLOSED', stateReason, labels: [] }), false, `${stateReason} must be a reason needsBackstop excludes`);
  }
  // Control: a completed closure with no disposition is a gap, so the check above can fail.
  assert.equal(needsBackstop({ state: 'CLOSED', stateReason: 'COMPLETED', labels: [] }), true);
});

test('oversight floor is not in the search string', () => {
  for (const search of closedSearchStrings(GAP)) {
    assert.ok(!hasOversightFloor(search), `the oversight floor stays client-side: ${search}`);
  }
  // Controls: negated and positive risk/size qualifiers are both caught; a disposition label is not.
  assert.ok(hasOversightFloor('closed:>=$SINCE -label:risk:high'));
  assert.ok(hasOversightFloor('closed:>=$SINCE -label:size:small'));
  assert.ok(hasOversightFloor('label:risk:low'));
  assert.ok(!hasOversightFloor('-label:demo:approved'));
});

test('searched fetches warn at the search ceiling, per date slice', () => {
  assertClaimPinned(
    GAP,
    PRE_CHANGE_GAP_FETCH,
    /const CAP = Math\.min\(LIMIT, 1000\);/,
    'the closed-record warning must compare against min(LIMIT, 1000)'
  );
  // Each slice is compared against the cap on its own, in a loop over the slices, so the warning can
  // name the slice that reached it. The whole-fetch `raw.length >= CAP` test is gone: a comparison over
  // the combined rows cannot tell which slice is full.
  assertClaimPinned(
    GAP,
    PRE_CHANGE_SLICED_FETCH,
    /for \(const \[\w+, (\w+)\] of slices\) \{\s*if \(\1\.length >= CAP\)/,
    'each date slice must be compared against the cap on its own'
  );
  assert.ok(
    !closedFetchBlock(GAP).includes('raw.length === LIMIT'),
    'the exact-equality truncation test must be gone from the closed-record block'
  );
  assert.ok(!/raw\.length >= CAP/.test(GAP), 'the whole-fetch raw.length >= CAP comparison must be gone');
});

test('since-date is validated', () => {
  assertClaimPinned(GAP, PRE_CHANGE_GAP_FETCH, /SINCE="\{since-date\}"/, 'the fence must substitute {since-date} literally');
  assertClaimPinned(
    GAP,
    PRE_CHANGE_GAP_FETCH,
    /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(process\.env\.SINCE/,
    'the node block must validate SINCE as YYYY-MM-DD'
  );
  // The server window is one date wider than the client cutoff, on purpose: the timezone of GitHub's
  // `closed:` qualifier is unprobed, so a 31-day date keeps the server set a superset of the 30-day set.
  const oneLiner = 'new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)';
  const FROZEN_30_ONE_LINER = oneLiner.replace('- 31 *', '- 30 *');
  assert.notEqual(FROZEN_30_ONE_LINER, oneLiner);
  assert.ok(GAP.includes(oneLiner), 'the scope must name the 31-day one-liner that resolves {since-date}');
  assert.ok(!GAP.includes(FROZEN_30_ONE_LINER), 'the frozen 30-day one-liner must be gone');
  assert.ok(!PRE_CHANGE_GAP_FETCH.includes(oneLiner));
  // The client-side cutoff stays exactly 30 days.
  assert.ok(GAP.includes('const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();'), 'the client-side closedAt cutoff stays 30 days');
  assert.ok(!GAP.includes('const cutoff = new Date(Date.now() - 31'), 'the client-side cutoff must not widen');
  // The prose says the server date is wider on purpose.
  const widerSaid = /one\s+date\s+wider[\s\S]{0,160}on\s+purpose/;
  assert.ok(widerSaid.test(GAP), 'the scope must say the server date is one date wider than the client cutoff, on purpose');
  // Control: the replaced sentence as it read at 70cb1d3f1 carries the {since-date} anchor and the 30-day
  // one-liner but lacks the clause.
  const PRE_CHANGE_SINCE_SENTENCE = 'Resolve `{since-date}` first, as its own call, with `node -e "console.log(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))"` (cross-platform, no shell `date` variant needed), and substitute its `YYYY-MM-DD` output literally.';
  assert.ok(PRE_CHANGE_SINCE_SENTENCE.includes('{since-date}') && PRE_CHANGE_SINCE_SENTENCE.includes(FROZEN_30_ONE_LINER));
  assert.ok(!widerSaid.test(PRE_CHANGE_SINCE_SENTENCE));
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
  // The same guard-failure sentence covers the mid-date guard: a failing MID stops the scope with no rows too.
  const midStops = /mid-date[^\n]*throws[\s\S]{0,300}report\s+no\s+`\[acceptance-gap\]`\s+rows\s+at\s+all/;
  assertClaimPinned(GAP, PRE_CHANGE_GUARD_SENTENCE, midStops, 'the guard-failure sentence must cover the mid-date guard');
});

test('trust-table no longer says the window does not bound the closed fetch', () => {
  const live = read('_shared/trust-table.md');
  const parenthetical = (text) => {
    const m = /\(`acceptance-gap`'s own \*closed-record\* fetch[\s\S]*?hardcoded cap\.\)/.exec(text);
    assert.ok(m, 'the acceptance-gap closed-record parenthetical must be present');
    return m[0];
  };
  const STALE = 'a 30-day window does not bound it';
  assert.ok(!live.includes(STALE), 'trust-table.md must not say the 30-day window does not bound the closed fetch');
  assert.ok(parenthetical(live).includes('server'), 'the parenthetical must name the server-side bound');
  assert.ok(parenthetical(live).includes('still carries the same `{resolved-limit}`'), 'the parenthetical must keep the resolved-limit clause');
  // Discrimination: the same two checks run over the frozen parenthetical must come out the other way.
  assert.ok(PRE_CHANGE_TRUST.includes(STALE));
  assert.ok(!parenthetical(PRE_CHANGE_TRUST).includes('server'));
  // The server window is one date wider than the 30-day cutoff: the parenthetical must say so, not "its 30-day window".
  const wider = /bounded\s+server-side\s+by\s+its\s+date\s+window\s+\(one\s+date\s+wider\s+than\s+the\s+30-day\s+cutoff\)/;
  const PRE_CHANGE_TRUST_30 = "(`acceptance-gap`'s own *closed-record* fetch is bounded server-side by its 30-day window and\ndisposition filter, and still carries the same `{resolved-limit}` and truncation-warning\ndiscipline, per that file's \"Fetch limit\" section — not a separate hardcoded cap.)";
  assert.ok(wider.test(parenthetical(live)), 'the parenthetical must say the server window is one date wider than the 30-day cutoff');
  assert.ok(!parenthetical(live).includes('by its 30-day window'), 'the server-side 30-day wording must be gone');
  assert.ok(!wider.test(parenthetical(PRE_CHANGE_TRUST_30)) && parenthetical(PRE_CHANGE_TRUST_30).includes('server-side'));
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
    /if \(!\['', 'has:parent-issue'\]\.includes\(process\.env\.STATE_SEARCH\)\)/,
    'the node block must validate STATE_SEARCH against the two branch values'
  );
});

// A placeholder guard: the fence line naming the env var that throws.
const guardLine = (text, name) => text.split('\n').find((l) => l.includes(`process.env.${name}`) && l.includes('throw new Error')).trim();
const guardThrows = (line, env) => {
  try { new Function('process', line)({ env }); return false; } catch { return true; }
};

// The calendar round-trip clause each date guard gained (#4598): a value that parses to NaN,
// or that round-trips through toISOString to a different day (2026-02-30 -> 2026-03-02), is rejected.
const CAL_SINCE_TEXT = ' || Number.isNaN(Date.parse(process.env.SINCE)) || new Date(process.env.SINCE).toISOString().slice(0, 10) !== process.env.SINCE';
const CAL_SINCE_RE = /Number\.isNaN\(Date\.parse\(process\.env\.SINCE\)\) \|\| new Date\(process\.env\.SINCE\)\.toISOString\(\)\.slice\(0, 10\) !== process\.env\.SINCE/;
const CAL_MID_RE = /Number\.isNaN\(Date\.parse\(process\.env\.MID\)\) \|\| new Date\(process\.env\.MID\)\.toISOString\(\)\.slice\(0, 10\) !== process\.env\.MID/;

test('both placeholder guards throw on bad values and pass good ones', () => {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const since = guardLine(closedFetchBlock(GAP), 'SINCE');
  const frozenSince = guardLine(PRE_CHANGE_SLICED_FETCH, 'SINCE');
  assert.equal(guardThrows(since, { SINCE: day(31) }), false, 'the 31-day since-date must pass');
  for (const bad of ['', '{since-date}', day(0), day(29)]) assert.equal(guardThrows(since, { SINCE: bad }), true, `SINCE=${bad} must throw`);
  // Calendar-invalid values the pre-change guard passes: '2026-10-00' parses to NaN and '2026-02-30' parses to
  // 2026-03-02, and both are more than 30 days back or unparseable, so the old comparison lets them through.
  // The frozen pre-change line passing them proves only the calendar clause can reject them.
  for (const bad of ['2026-10-00', '2026-02-30']) {
    assert.equal(guardThrows(frozenSince, { SINCE: bad }), false, `the pre-change SINCE guard passes ${bad}, so the calendar clause is what rejects it`);
    assert.equal(guardThrows(since, { SINCE: bad }), true, `SINCE=${bad} must throw`);
  }
  assert.equal(guardThrows(since, { SINCE: '2026-02-28' }), false, 'a real calendar date more than 30 days back must still pass the SINCE guard');
  assertClaimPinned(since, frozenSince, CAL_SINCE_RE, 'the SINCE guard must carry the calendar round-trip clause');
  assert.equal(since.replace(CAL_SINCE_TEXT, ''), frozenSince, 'the SINCE guard differs from its pre-change line only by the calendar clause');
  const state = guardLine(PG, 'STATE_SEARCH');
  for (const good of ['', 'has:parent-issue']) assert.equal(guardThrows(state, { STATE_SEARCH: good }), false, `STATE_SEARCH=${good} must pass`);
  assert.equal(guardThrows(state, { STATE_SEARCH: '{state-map-search}' }), true);
  // Control: each guard with its polarity inverted comes out the other way on a good value.
  const invert = (line) => line.replace('if (!', 'if (');
  assert.equal(guardThrows(invert(since), { SINCE: day(31) }), true);
  assert.equal(guardThrows(invert(state), { STATE_SEARCH: '' }), true);
});

// ---- date-sliced closed-record fetch (#4598 slice split) --------------------------------------------

// The acceptance-gap "Record set" paragraph's opening sentences as they read before the slice split.
const PRE_CHANGE_RECORD_SET = `Record set: closed records from the last 30 days. The fetch applies the window and the disposition,
not-planned and duplicate exclusions server-side through \`--search\`; the client-side \`closedAt\``;

// The acceptance-gap guard-failure sentence as it read before the mid-date guard (before #4598):
// it names the since-date guard only.
const PRE_CHANGE_GUARD_SENTENCE = `When this block fails — the since-date guard throws, or a failed \`gh\` call leaves \`$RAW\` unreadable —
the scope stops: report no \`[acceptance-gap]\` rows at all and quote the error verbatim, as for an
exit-3 sub-issue fetch below. \`$CLOSED\` is emptied first, so a later block never reads a stale one.`;

// The per-slice warning lines: the console.error lines that name a closed-record slice.
const sliceWarnings = (text) => text.split('\n').filter((l) => l.includes('console.error') && /closed-record\s+slice/.test(l));
const sliceWarnParts = (line) => ({
  count: /returned\s+'\s*\+\s*rows\.length/.test(line),
  cap: /reaching\s+its\s+cap\s+of\s+'\s*\+\s*CAP/.test(line),
  range: /slice\s+'\s*\+\s*qualifier/.test(line),
  remedy: /raise\s+backlog-fetch-limit\s+in\s+\.claude-tweaks\/policy\.yml/.test(line),
  ceiling: /cannot\s+be\s+complete/.test(line),
});

test('the frozen sliced-fetch excerpt carries the anchors the discrimination checks rely on', () => {
  assert.ok(PRE_CHANGE_SLICED_FETCH.includes('--search "closed:>=$SINCE '));
  assert.ok(PRE_CHANGE_SLICED_FETCH.includes('  if (raw.length >= CAP) {'));
  assert.ok(!PRE_CHANGE_SLICED_FETCH.includes('$MID'), 'the frozen fence predates the mid-date placeholder');
  assert.ok(!PRE_CHANGE_SLICED_FETCH.includes('of slices'), 'the frozen fence has no loop over slices');
  assert.ok(!PRE_CHANGE_SLICED_FETCH.includes('byNumber'), 'the frozen fence has no number-keyed merge');
});

test('the closed-record fetch splits into an inclusive dated older slice and a newer slice', () => {
  // SINCE..MID is inclusive on both ends and >MID is strictly after: together they partition the
  // single closed:>=SINCE set (probed on this repo: 226 + 551 = 777).
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, /--search "closed:\$SINCE\.\.\$MID /, 'the older slice must be the inclusive closed:$SINCE..$MID range');
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, /--search "closed:>\$MID /, 'the newer slice must be closed:>$MID');
  // Each slice writes its own raw file, and each raw path resolves through session-tmp-resolve like $RAW.
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, /  > "\$RAW_OLD"\n/, 'the older slice must write its own raw file');
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, /  > "\$RAW_NEW"\n/, 'the newer slice must write its own raw file');
  assertClaimPinned(
    GAP,
    PRE_CHANGE_SLICED_FETCH,
    /RAW_OLD="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value tidy-closed-records-raw-old\.json\)"/,
    'the older raw path must resolve through session-tmp-resolve'
  );
  assertClaimPinned(
    GAP,
    PRE_CHANGE_SLICED_FETCH,
    /RAW_NEW="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value tidy-closed-records-raw-new\.json\)"/,
    'the newer raw path must resolve through session-tmp-resolve'
  );
  // The mid-date placeholder is substituted literally and exported, so the node block can read it.
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, /MID="\{mid-date\}"\nexport SINCE MID/, 'the fence must substitute {mid-date} literally and export it');
  // The split point resolves the same way as {since-date}, 15 days back instead of 31.
  const midOneLiner = 'new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)';
  assert.ok(GAP.includes(midOneLiner), 'the scope must name the 15-day one-liner that resolves {mid-date}');
  assert.ok(!PRE_CHANGE_SLICED_FETCH.includes(midOneLiner));
  assert.ok(!GAP.includes('closed:>=$SINCE'), 'the single closed:>=$SINCE fetch must be gone');
});

test('the closed-record fetch is described as two date slices in the record set and fetch-limit prose', () => {
  assertClaimPinned(GAP, PRE_CHANGE_RECORD_SET, /splits\s+that\s+window\s+into\s+two\s+date\s+slices/, 'the record-set paragraph must say the window is split into two date slices');
  assertClaimPinned(GAP, PRE_CHANGE_CLOSED_PARAGRAPH, /closed-record\s+fetch\s+is\s+split\s+into\s+two\s+date\s+slices/, 'the fetch-limit paragraph must say the closed-record fetch is split into two date slices');
});

test('the per-slice warning text names its slice range, row count, cap and remedy', () => {
  const lines = sliceWarnings(GAP);
  assert.equal(lines.length, 1, 'exactly one per-slice warning, run inside the loop over the slices');
  assert.deepEqual(sliceWarnParts(lines[0]), { count: true, cap: true, range: true, remedy: true, ceiling: true });
  // Controls: the frozen whole-fetch warning names neither the slice's range nor its own row count; a
  // bare cap is not enough; a rewrapped phrase still counts.
  const frozenWarning = PRE_CHANGE_SLICED_FETCH.split('\n').find((l) => l.includes('console.error'));
  assert.deepEqual(sliceWarnParts(frozenWarning), { count: false, cap: true, range: false, remedy: true, ceiling: true });
  assert.deepEqual(sliceWarnParts("console.error('WARNING: the closed-record slice ' + qualifier + ' returned ' + rows.length + ' records');"), { count: true, cap: false, range: true, remedy: false, ceiling: false });
  assert.equal(sliceWarnParts("console.error('the closed-record slice ' + qualifier + ' reaching its\n cap of ' + CAP);").cap, true);
});

test('the two slices merge number-keyed, before the closedAt cutoff', () => {
  const MERGE = /const byNumber = new Map\(slices\.flatMap\(\(\[, (\w+)\]\) => \1\)\.map\(\(r\) => \[r\.number, r\]\)\);/;
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, MERGE, 'the slices must merge into a Map keyed on number');
  // Behavioural: a record seen in both slices counts once, and the later slice's copy wins.
  const merge = GAP.split('\n').find((l) => MERGE.test(l));
  assert.ok(merge, 'the merge line must be present');
  const byNumber = new Function('slices', `${merge.trim()} return byNumber;`)([
    ['closed:older', [{ number: 1, closedAt: 'a' }, { number: 2, closedAt: 'a' }]],
    ['closed:newer', [{ number: 2, closedAt: 'b' }]],
  ]);
  assert.deepEqual([...byNumber.keys()], [1, 2], 'a record in both slices must appear once');
  assert.equal(byNumber.get(2).closedAt, 'b', 'the newer slice copy wins');
  // The merge runs before the 30-day cutoff, and the cutoff filters the merged set.
  assert.ok(
    GAP.indexOf('const byNumber = ') < GAP.indexOf('const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)'),
    'the merge must precede the closedAt cutoff'
  );
  assert.ok(GAP.includes('JSON.stringify([...byNumber.values()].filter((r) => r.closedAt > cutoff))'), 'the cutoff must filter the merged set');
});

// ---- the whole closed-record fence, extracted and run (#4598) -----------------------------------------
//
// docs/skill-authoring.md's "Executable snippets" rule: a fenced bash block a skill tells an agent to run is
// bound to a test that executes it. The tests above pin the fence's text and run single lines of it; this one
// extracts the whole fence from the live scope and runs it against fixtures, so the slice wiring, the
// per-slice cap and the number-keyed merge are exercised as the agent would run them.

const PLUGIN_DIR = path.join(__dirname, '..', 'plugin');
const forwardSlashes = (p) => p.split(path.sep).join('/');
const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const dateOnly = (d) => d.toISOString().slice(0, 10);
const FENCE_SINCE = dateOnly(daysAgo(31));
const FENCE_MID = dateOnly(daysAgo(15));

// The acceptance-gap closed-record bash fence, from its RAW_OLD resolution line to the closing fence.
function closedRecordFence(gap) {
  const m = /```bash\n(RAW_OLD=[\s\S]*?)\n```/.exec(gap);
  assert.ok(m, 'the acceptance-gap scope must carry a bash fence opening with RAW_OLD= — extraction pattern is out of sync with the doc');
  return m[1];
}

// Runs the extracted fence with its placeholders substituted. `gh` becomes a shell function serving one
// fixture per slice (the newer slice is the one whose --search starts `closed:>`), so no network is touched
// and no PATH shim is needed. Returns the exit status, stderr and the $CLOSED file's parsed rows ('' when emptied, null when absent).
function runClosedFence({ older, newer, limit = 1000, since = FENCE_SINCE, mid = FENCE_MID }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-fence-'));
  const sessionId = `acceptance-fence-${path.basename(dir)}`;
  try {
    const oldFile = path.join(dir, 'older.json');
    const newFile = path.join(dir, 'newer.json');
    fs.writeFileSync(oldFile, JSON.stringify(older));
    fs.writeFileSync(newFile, JSON.stringify(newer));
    const fence = closedRecordFence(GAP)
      .replace('{resolved-limit}', String(limit))
      .replace('{since-date}', since)
      .replace('{mid-date}', mid);
    const script = `gh() { case "$*" in *'closed:>'*) cat "$FAKE_NEW" ;; *) cat "$FAKE_OLD" ;; esac; }\n${fence}`;
    const run = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: forwardSlashes(PLUGIN_DIR), CLAUDE_CODE_SESSION_ID: sessionId, FAKE_OLD: forwardSlashes(oldFile), FAKE_NEW: forwardSlashes(newFile) },
    });
    let closed = null;
    try {
      const text = fs.readFileSync(path.join(sessionTmpRoot(sessionId), 'tidy-closed-records.json'), 'utf8');
      closed = text === '' ? '' : JSON.parse(text);
    } catch { closed = null; }
    return { status: run.status, stderr: run.stderr, closed };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sessionTmpRoot(sessionId), { recursive: true, force: true });
  }
}

const row = (number, closedDaysAgo, extra = {}) => ({ number, title: `r${number}`, state: 'CLOSED', labels: [], closedAt: daysAgo(closedDaysAgo).toISOString(), stateReason: 'COMPLETED', ...extra });
const sliceWarningLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('WARNING: the closed-record slice'));

test('the extracted closed-record fence merges both slices number-keyed and applies the 30-day cutoff', () => {
  const run = runClosedFence({
    // #1 closed 30.5 days ago: inside the server window (31 days) but outside the client cutoff (30 days).
    // #3 appears in both slices; the newer slice's copy carries a different title and must win.
    older: [row(1, 30.5), row(2, 20), row(3, 16, { title: 'older-copy' })],
    newer: [row(3, 16, { title: 'newer-copy' }), row(4, 5)],
  });
  assert.equal(run.status, 0, `the fence must run clean: ${run.stderr}`);
  assert.equal(run.stderr, '', 'no slice reached its cap, so nothing may warn');
  assert.deepEqual(run.closed.map((r) => r.number).sort((a, b) => a - b), [2, 3, 4], 'the cutoff drops #1, and #3 (in both slices) counts once');
  assert.equal(run.closed.find((r) => r.number === 3).title, 'newer-copy', 'the newer slice copy wins');
});

test('the extracted closed-record fence warns per slice at the cap, naming the slice that reached it', () => {
  const rows = (from, count, closedDaysAgo) => Array.from({ length: count }, (_, i) => row(from + i, closedDaysAgo));
  const onlyWarning = (run) => {
    const lines = sliceWarningLines(run.stderr);
    assert.equal(lines.length, 1, 'only the slice at its cap warns');
    return lines[0];
  };
  // Boundary at the search ceiling: 999 rows is silent, 1000 warns; the merged total (1999) never warns on its own.
  const quiet = runClosedFence({ older: rows(1, 999, 20), newer: rows(5000, 999, 5) });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.deepEqual(sliceWarningLines(quiet.stderr), [], 'two slices under the cap must not warn, however large their sum');
  assert.equal(quiet.closed.length, 1998, 'both full slices survive the merge');
  const newerWarning = onlyWarning(runClosedFence({ older: rows(1, 999, 20), newer: rows(5000, 1000, 5) }));
  assert.ok(newerWarning.includes(`closed:>${FENCE_MID} returned 1000 records, reaching its cap of 1000`), `the warning must name the newer slice: ${newerWarning}`);
  const olderWarning = onlyWarning(runClosedFence({ older: rows(1, 1000, 20), newer: rows(5000, 999, 5) }));
  assert.ok(olderWarning.includes(`closed:${FENCE_SINCE}..${FENCE_MID} returned 1000 records, reaching its cap of 1000`), `the warning must name the older slice: ${olderWarning}`);
  // A limit below the search ceiling is the cap: three rows reach a limit of 3.
  const lowWarning = onlyWarning(runClosedFence({ limit: 3, older: rows(1, 3, 20), newer: rows(5000, 2, 5) }));
  assert.ok(lowWarning.includes('returned 3 records, reaching its cap of 3'), lowWarning);
});

test('the extracted closed-record fence stops with an empty output file when a date guard throws', () => {
  const fixtures = { older: [row(2, 20)], newer: [row(4, 5)] };
  const bad = runClosedFence({ ...fixtures, mid: dateOnly(daysAgo(40)) });
  assert.notEqual(bad.status, 0, 'a mid-date earlier than since-date must fail the fence');
  assert.match(bad.stderr, /MID is not a YYYY-MM-DD date later than SINCE/);
  assert.equal(bad.closed, '', 'the output file is emptied first and never written after a guard throws');
  // Control: the same run with a good mid-date succeeds, so the failure above comes from the guard.
  const good = runClosedFence(fixtures);
  assert.equal(good.status, 0, good.stderr);
});

test('the mid-date guard throws on bad values and passes a good one, and both date guards run before the slices are built', () => {
  const day = (n) => dateOnly(daysAgo(n));
  const block = closedFetchBlock(GAP);
  const since = guardLine(block, 'SINCE');
  const mid = guardLine(block, 'MID');
  const slicesAt = block.indexOf('const slices = [');
  assert.ok(slicesAt !== -1, 'the slices array must be present');
  assert.ok(block.indexOf(since) < slicesAt && block.indexOf(mid) < slicesAt, 'both date guards must run before the slice labels read SINCE and MID');
  const env = (m) => ({ SINCE: day(31), MID: m });
  assert.equal(guardThrows(mid, env(day(15))), false, 'a 15-day MID inside a 31-day SINCE must pass');
  for (const bad of ['', '{mid-date}', '2026-13-45', day(31), day(40), day(0), day(-1)]) {
    assert.equal(guardThrows(mid, env(bad)), true, `MID=${bad} must throw`);
  }
  // Calendar-invalid values that lie strictly between a fixed SINCE (2025-01-01) and today, so the only clause
  // that can reject them is the calendar one. Under the day(31) env above, 2026-02-30 would fail the lexical
  // SINCE bound instead, so these run under their own env.
  const calEnv = (m) => ({ SINCE: '2025-01-01', MID: m });
  for (const bad of ['2026-10-00', '2026-02-30']) {
    assert.equal(guardThrows(mid, calEnv(bad)), true, `MID=${bad} must throw`);
  }
  // Controls: the valid round-trip of 2026-02-30 and a 15-day MID pass under the same env, and the calendar
  // clause is pinned on the live MID line.
  assert.equal(guardThrows(mid, calEnv('2026-03-02')), false, '2026-03-02, the valid round-trip of 2026-02-30, must pass');
  assert.equal(guardThrows(mid, calEnv(day(15))), false, 'a 15-day MID must pass under the fixed SINCE');
  assertClaimPinned(GAP, PRE_CHANGE_SLICED_FETCH, CAL_MID_RE, 'the MID guard must carry the calendar round-trip clause');
  // Control: the polarity-inverted guard comes out the other way on the good value.
  const invert = (line) => line.replace('if (!', 'if (');
  assert.equal(guardThrows(invert(mid), env(day(15))), true);
});

test('an empty searched state map warns', () => {
  const warns = /if \(process\.env\.STATE_SEARCH && !states\.length && parents\.length\)\s*\{\s*console\.error\('WARNING: the searched state map is empty/;
  assertClaimPinned(PG, PRE_CHANGE_PG, warns, 'a 0-row searched state map with parents present must warn');
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

// ---- label-filtered parent fetches (#4469 Task 3) ---------------------------------------------

// The three exact-equality parent-fetch tests as they read before #4469, in file order.
const PRE_CHANGE_PARENT_WARN = [
  '  if (fetched.some((f) => f.length === LIMIT)) {',
  '  if (fetched.some((f) => f.length === Number(process.env.FETCH_LIMIT))) {',
  '  if (fetched.some((f) => f.length === LIMIT)) {',
].join('\n');

const PARENT_CEILING_TEST = /if \(fetched\.some\(\(f\) => f\.length >= Math\.min\((?:LIMIT|Number\(process\.env\.FETCH_LIMIT\)), 1000\)\)\)/g;

test('label-filtered parent fetches warn at the search ceiling', () => {
  assert.equal((LIVE.match(PARENT_CEILING_TEST) || []).length, 3, 'all three parent-fetch warnings compare against min(limit, 1000)');
  assert.equal(PRE_CHANGE_PARENT_WARN.match(PARENT_CEILING_TEST), null, 'the frozen lines carry none of the ceiling comparisons');
  for (const stale of ['f.length === LIMIT', 'f.length === Number(process.env.FETCH_LIMIT)']) {
    assert.ok(!LIVE.includes(stale), `the exact-equality test must be gone: ${stale}`);
    assert.ok(PRE_CHANGE_PARENT_WARN.includes(stale), `the frozen lines must carry the anchor: ${stale}`);
  }
  // Control: a `>` slip is not the ceiling comparison.
  assert.equal('if (fetched.some((f) => f.length > Math.min(LIMIT, 1000)))'.match(PARENT_CEILING_TEST), null);
});

// The predicate expressions as shipped: the text inside `fetched.some((f) => …)`, one per live site, in
// file order. Extraction is deliberately shape-agnostic (no `>=` / `Math.min` in the pattern), so a slipped
// operator or constant in any one site is still extracted and judged by the table rather than skipped.
const PARENT_CEILING_EXPR = /if \(fetched\.some\(\(f\) => (.+?)\)\) \{/g;
const ceilingExprs = (text) => [...text.matchAll(PARENT_CEILING_EXPR)].map((m) => m[1]);
// Evaluates an extracted predicate for `rows` fetched rows under `limit` (both the LIMIT and the env form).
const evalCeiling = (expr, limit, rows) =>
  new Function('f', 'LIMIT', 'process', `return ${expr};`)({ length: rows }, limit, { env: { FETCH_LIMIT: String(limit) } });
const CEILING_TABLE = [
  [1500, 1000, true, 'limit above 1000, ceiling reached'],
  [1000, 743, false, 'under the cap stays silent'],
  [500, 500, true, 'limit below 1000, limit reached'],
  [500, 499, false, 'one under the cap stays silent'],
];
// The rows a predicate gets wrong, named `limit/rows (description)`.
const ceilingMisses = (expr) =>
  CEILING_TABLE.filter(([limit, rows, want]) => evalCeiling(expr, limit, rows) !== want).map(([limit, rows, , why]) => `${limit}/${rows} (${why})`);
// `text` with the `n`th (0-based) occurrence of `needle` replaced.
function mutateNth(text, needle, n, replacement) {
  let at = -1;
  for (let i = 0; i <= n; i++) {
    at = text.indexOf(needle, at + 1);
    assert.ok(at !== -1, `occurrence ${n} of ${needle} not found`);
  }
  return text.slice(0, at) + replacement + text.slice(at + needle.length);
}

test('ceiling arithmetic', () => {
  const exprs = ceilingExprs(LIVE);
  assert.equal(exprs.length, 3, 'all three parent-fetch predicates are extracted and evaluated, none de-duplicated');
  for (const expr of exprs) assert.deepEqual(ceilingMisses(expr), [], `the shipped predicate must satisfy the table: ${expr}`);
  // Go-red controls on the predicate: a `>` slip and a 1000 -> 100 slip each miss named rows.
  for (const expr of exprs) {
    const slipped = expr.replace('>=', '>');
    assert.notEqual(slipped, expr);
    assert.deepEqual(ceilingMisses(slipped).map((m) => m.split(' ')[0]), ['1500/1000', '500/500']);
    const lowered = expr.replace('1000', '100');
    assert.notEqual(lowered, expr);
    assert.deepEqual(ceilingMisses(lowered).map((m) => m.split(' ')[0]), ['1000/743', '500/499']);
  }
  // Go-red controls on the extraction: the same table run over the whole live file with ONE site mutated
  // must find a table miss in exactly that site, whichever of the three sites and whichever mutation.
  for (let site = 0; site < 3; site++) {
    for (const [needle, replacement] of [['>= Math.min(', '> Math.min('], ['1000))) {', '100))) {']]) {
      const exprsM = ceilingExprs(mutateNth(LIVE, needle, site, replacement));
      assert.equal(exprsM.length, 3);
      const missed = exprsM.map((e) => ceilingMisses(e).length > 0);
      assert.deepEqual(missed, [0, 1, 2].map((i) => i === site), `mutating ${needle} in site ${site} must miss table rows in that site only`);
    }
  }
  // The frozen exact-equality predicates fail the table too (they are not the ceiling comparison).
  const frozen = ceilingExprs(PRE_CHANGE_PARENT_WARN);
  assert.equal(frozen.length, 3);
  for (const expr of frozen) assert.notDeepEqual(ceilingMisses(expr), [], `the frozen predicate must miss rows: ${expr}`);
});

// The parent-fetch warning lines (the `console.error` calls naming "a parent fetch") and what each must say.
const parentWarnings = (text) => text.split('\n').filter((l) => l.includes('console.error') && /a\s+parent\s+fetch/.test(l));
const parentWarnParts = (line) => ({
  cap: /reached\s+its\s+cap\s+of\s+'\s*\+/.test(line),
  ceiling: /1000-result\s+ceiling/.test(line),
  futile: /raising\s+it\s+past\s+1000\s+does\s+not\s+help/.test(line),
});
const PRE_CHANGE_PARENT_MESSAGE = "    console.error('WARNING: a parent fetch returned exactly ' + LIMIT + ' records (the configured backlog-fetch-limit) — older parents were dropped and are invisible to this scope entirely.');";

test('parent-fetch warnings name the cap and the label-filtered ceiling', () => {
  const lines = parentWarnings(LIVE);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.deepEqual(parentWarnParts(line), { cap: true, ceiling: true, futile: true });
  // Controls: the pre-change message names none; a bare cap without the ceiling is caught; rewrapping is tolerated.
  assert.deepEqual(parentWarnParts(PRE_CHANGE_PARENT_MESSAGE), { cap: false, ceiling: false, futile: false });
  assert.deepEqual(parentWarnParts("console.error('a parent fetch reached its cap of ' + CAP);"), { cap: true, ceiling: false, futile: false });
  assert.deepEqual(parentWarnParts("reached its\n cap of ' + CAP 1000-result\n ceiling raising it past\n 1000 does not help"), { cap: true, ceiling: true, futile: true });
});

// The parent-fetch half of the acceptance-gap "Fetch limit" paragraph as it read before #4469.
const PRE_CHANGE_PARENT_PARAGRAPH = `narrowed set. The parent fetches share the same
exposure for a different reason — they are \`--state all\` over the repo's entire history, and
\`gh issue list\` returns newest-first, so a fixed cap drops the **oldest** parents first. Those are
precisely the parents whose sub-issues have already closed, so truncation silently re-floods this
scope with exactly the rows the filter exists to remove.`;

test('fetch-limit paragraph says a label-filtered list is capped at 1000 whatever --limit says', () => {
  const says = /parent\s+fetches[\s\S]{0,700}label-filtered[\s\S]{0,120}capped\s+at\s+1000[\s\S]{0,160}backlog-fetch-limit`?\s+past\s+1000/;
  assertClaimPinned(GAP, PRE_CHANGE_PARENT_PARAGRAPH, says, 'the parent-fetch half must state the 1000 ceiling');
  // Control: the ceiling without the backlog-fetch-limit consequence is not enough.
  assert.ok(!says.test('parent fetches share the same exposure. A label-filtered list is capped at 1000 by GitHub.'));
});

test('state-map absence names both causes and keeps the OPEN default', () => {
  const absent = (text) => {
    const m = /absent\s+from\s+the\s+state\s+map[\s\S]{0,400}?defaults\s+to\s+`OPEN`/.exec(text);
    assert.ok(m, 'the absent-from-state-map sentence must be present');
    return m[0];
  };
  const bothCauses = (s) => /truncat/.test(s) && /search\s+index\s+lag/.test(s);
  assert.equal(bothCauses(absent(PG)), true);
  // Controls: the pre-change sentence names truncation only; the lag alone is not both; rewrapping is tolerated.
  const pre = 'number absent from the state map (the fetch above truncated before reaching it — the warning\nabove fires when that is possible) defaults to `OPEN`, the fail-safe direction';
  assert.equal(bothCauses(absent(pre)), false);
  assert.equal(bothCauses(absent('absent from the state map (search index lagged) defaults to `OPEN`')), false);
  assert.equal(bothCauses('truncated, or the search\n index lagged'), true);
});

// ---- final-review fixes (#4469) ----------------------------------------------------------------

const SUBSTITUTION_RULE = 'Substitute `{state-map-search}`:';
const STATE_FENCE_LINE = "STATE_SEARCH='{state-map-search}'";

// True when the substitution rule precedes the state-map fence and no other fence sits between them
// (the only backtick fence after the rule is the state-map fence's own opening).
function ruleSitsAboveItsFence(text) {
  const rule = text.indexOf(SUBSTITUTION_RULE);
  const line = text.indexOf(STATE_FENCE_LINE);
  if (rule === -1 || line === -1 || rule > line) return false;
  const opening = text.lastIndexOf('```bash', line);
  return opening > rule && (text.slice(rule, opening).match(/```/g) || []).length === 0;
}

test('the {state-map-search} substitution rule is explained before the fence it governs', () => {
  assert.ok(ruleSitsAboveItsFence(PG), 'the rule must sit above the parent-gate state-map fence, with no other fence between');
  // Controls: the same two anchors in the pre-move order (fence first, rule after), and a rule separated by another fence.
  const preMove = `\`\`\`bash\n${STATE_FENCE_LINE}\n\`\`\`\n\n${SUBSTITUTION_RULE} has:parent-issue under native.`;
  assert.ok(!ruleSitsAboveItsFence(preMove));
  assert.ok(ruleSitsAboveItsFence(`${SUBSTITUTION_RULE} x\n\n\`\`\`bash\n${STATE_FENCE_LINE}\n\`\`\``));
  assert.ok(!ruleSitsAboveItsFence(`${SUBSTITUTION_RULE} x\n\n\`\`\`bash\nother\n\`\`\`\n\n\`\`\`bash\n${STATE_FENCE_LINE}\n\`\`\``));
  // The guard-failure sentence still follows the fence.
  assert.ok(PG.indexOf('the state-map-search guard throws') > PG.indexOf(STATE_FENCE_LINE));
});

// The closed-record half of the acceptance-gap "Fetch limit" paragraph as it read before the final review.
const PRE_CHANGE_CLOSED_PARAGRAPH = `closed records first — exactly the quiet-failure a backstop scope must never have, so the cap (the
smaller of the limit and GitHub search's 1000-result ceiling) and its warning still apply to the
narrowed set. The parent fetches share the same`;

test('the closed-record fetch names search-index lag as an unwarned, self-correcting gap', () => {
  const lag = /closed-record\s+fetch\s+is\s+a\s+search\s+too[\s\S]{0,200}index\s+lag[\s\S]{0,120}unwarned/;
  assertClaimPinned(GAP, PRE_CHANGE_CLOSED_PARAGRAPH, lag, 'the closed-record fetch must name the search-index lag');
  // Control: the lag named without the closed-record anchor is not enough.
  assert.ok(!lag.test('the state map may miss a just-linked sub-issue while the search index lags — unwarned'));
});

// ---- accept:* read sites (#4610 expand step) ---------------------------------------------------

test('the acceptance-queue lists records carrying either pending spelling', () => {
  const QUEUE = section(LIVE, '## Scope: `acceptance-queue`', '## Scope: `acceptance-gap`');
  const query = 'gh issue list --search "label:demo:pending,accept:pending" --state all --json number,title --limit 200';
  assert.ok(QUEUE.includes(query), 'the queue query must read both pending spellings in one search');
  // The single-spelling form it replaced is gone.
  assert.ok(!QUEUE.includes('gh issue list --label demo:pending'));
});

test('the acceptance-queue names its search-index lag as an unwarned, self-correcting gap', () => {
  const QUEUE = section(LIVE, '## Scope: `acceptance-queue`', '## Scope: `acceptance-gap`');
  assert.match(QUEUE, /query\s+is\s+a\s+search[\s\S]{0,120}index\s+lags[\s\S]{0,40}unwarned[\s\S]{0,40}next\s+run/);
});

