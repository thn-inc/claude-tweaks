'use strict';
// tests/pre-review-catchup-conformance.test.js — #4304: pins the prose that wires
// bin/pre-review-catchup.js into /build's SDD dispatch (the call-site facts of
// build/dispatch.md's catch-up instruction), the _shared procedure file that is the single
// home of the per-outcome routing and posture, and the registries naming the CLI. The CLI's
// own behavior is tests/bin-lib/pre-review-catchup's.
//
// Live prose is read here legitimately: updating these sentences is the intended
// response to a change in the contract they state (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { OUTCOMES } = require('../plugin/bin/lib/worktree/pre-review-catchup');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const DISPATCH = read('plugin/skills/build/dispatch.md');
// Read inside the tests that use it: a missing file then fails that test alone, not the whole suite.
const readShared = () => read('plugin/skills/_shared/pre-review-catchup.md');
const BUILD_WORKTREE_SETUP = read('plugin/skills/build/worktree-setup.md');
const PLUGIN_STRUCTURE = read('docs/plugin-structure.md');

const CLI_MARKER = 'bin/pre-review-catchup.js';
const SKIP_PATH_MARKER = 'Single-task fast-lane skip (#1926';
const REVIEW_RETURN_MARKER = 'After the final code review completes — or, on the skip path';

// Every marker must exist before positions are compared: indexOf's -1 is below every
// real position, so a reworded marker would otherwise leave the pin green.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// Slice from `start` to `end`, both asserted, so a missing end cannot widen the region to the rest of the file.
function region(text, start, end, what) {
  const from = text.indexOf(start);
  assert.notStrictEqual(from, -1, `marker missing: ${start}`);
  const to = text.indexOf(end, from);
  assert.notStrictEqual(to, -1, `marker missing after the ${what}: ${end}`);
  return text.slice(from, to);
}

// The catch-up instruction itself: from its bold label to the return marker.
const SPAN_START = '**Pre-review catch-up (#4304';
const catchupSpan = (text) => region(text, SPAN_START, REVIEW_RETURN_MARKER, 'catch-up instruction');
// The shared procedure: Scope through Outcomes and the repair paragraph, not the Anti-patterns table.
const SHARED_END = '\n## Anti-patterns';
const sharedProcedure = (text) => region(text, '## Scope', SHARED_END, 'shared procedure');

// A facts list is checked over one region; `missing` returns the names of the absent facts.
// `anchors` names the outcome tokens a fact's own match depends on, so a control that removes
// that token expects the fact to go with it.
const missingFacts = (facts, extract) => (text) => {
  const s = extract(text);
  return facts.filter((f) => !f.has(s)).map((f) => f.name);
};
const lostWith = (facts, fact) => facts.filter((x) => x === fact || (fact.token && (x.anchors || []).includes(fact.token))).map((x) => x.name);

// The call-site facts dispatch.md's catch-up instruction keeps: everything else is cited.
const SKIP_LINE = '— Pre-review catch-up: condition:';
const CITE = "per `_shared/pre-review-catchup.md`'s `## Outcomes`";
const DISPATCH_FACTS = [
  // R7: current-branch is the one SKIP; parallel-wave members run the catch-up.
  { name: 'current-branch is the only skip', has: (s) => s.includes('current-branch strategy → fallback: no pre-review catch-up') && s.split(SKIP_LINE).length === 2 },
  { name: 'wave members run it', has: (s) => s.includes('a `MULTISPEC_PARALLEL_WAVE=1` wave member runs it in its own worktree') },
  { name: 'runs the CLI with --run from the worktree root', has: (s) => s.includes('run `node "${CLAUDE_PLUGIN_ROOT}/bin/pre-review-catchup.js" --integration-branch {integration-branch} --run "$PIPELINE_RUN_DIR"` from the worktree root, omitting `--run` for a standalone `/build`') },
  { name: 'call-site rule', has: (s) => s.includes("Resolve `{integration-branch}` at this call site through `_shared/integration-branch.md`'s canonical ladder, never carried from Common Step 1") },
  { name: 'skip path has no review package', has: (s) => s.includes('`merged` there means re-running the suite (with its one fix dispatch on a failure) and nothing more') },
  { name: 'routes per the shared Outcomes', has: (s) => s.includes(CITE) },
  { name: 'any non-null reviewBase is the package base', has: (s) => s.includes("Whatever the outcome, a non-null `reviewBase` is the review package's base commit; SDD's own base") && s.includes('is used only when `reviewBase` is null') },
  { name: 'the controller never fixes code', has: (s) => s.includes('The controller never fixes code itself (SDD\'s own rule): every repair is one implementer dispatch') },
  { name: 'conflict-resolved line uses --text-file', has: (s) => /resolved in \{sha\}\. Reversibility: n\/a\.` with `log-decision\.js --text-file`/.test(s) },
  { name: 'an unrepaired tree returns as a HARD-GATE', has: (s) => s.includes('stop SDD before the review with the merge state intact and return here') && s.includes('fails the HARD-GATE') },
];
const missingDispatchFacts = missingFacts(DISPATCH_FACTS, catchupSpan);

// The routing facts the shared procedure owns: scope, every OUTCOMES token, each outcome's
// posture, the repair dispatch, the exit-code rule and the caller's log entries.
const row = (s, o) => s.split('\n').find((l) => l.startsWith(`| \`${o}\` |`)) || '';
const OUTCOME_FACTS = OUTCOMES.map((o) => ({ name: `outcome ${o}`, token: `\`${o}\``, has: (s) => s.includes(`\`${o}\``) }));
const SHARED_FACTS = [
  { name: 'current-branch is the only skip', has: (s) => s.includes('that is the only skip') },
  { name: 'wave members run it', has: (s) => s.includes('Every worktree-strategy build runs it, including a `MULTISPEC_PARALLEL_WAVE=1` wave member') },
  { name: 'call-site rule', has: (s) => s.includes('It is never carried from Common Step 1') },
  { name: 'any non-null reviewBase is the package base', has: (s) => s.includes("Whatever the outcome, a non-null `reviewBase` is the review package's base commit") && s.includes("is used only when `reviewBase` is null and the outcome's row names no other base") },
  { name: 'merged route names reviewBase', anchors: ['`merged`'], has: (s) => row(s, 'merged').includes("build the review package on the JSON's `reviewBase`") },
  { name: 'merged re-runs the suite, failures through the repair dispatch', anchors: ['`merged`'], has: (s) => row(s, 'merged').includes('Re-run the full suite on the merged tree (a failure goes through the repair dispatch below, then the suite re-runs)') },
  { name: 'no-overlap route names reviewBase', anchors: ['`no-overlap`'], has: (s) => row(s, 'no-overlap').includes("build the review package on the JSON's `reviewBase`") },
  { name: 'fetch-failed route names reviewBase', anchors: ['`fetch-failed`'], has: (s) => row(s, 'fetch-failed').includes('Build the review package on `reviewBase` when it is non-null') },
  { name: 'conflict stops before review', anchors: ['`conflict`'], has: (s) => row(s, 'conflict').includes('Stop: never review the pre-merge tree') },
  { name: 'conflict is never aborted past', anchors: ['`conflict`'], has: (s) => row(s, 'conflict').includes('never reset, discard, or `git merge --abort` past it') },
  { name: 'conflict package base', anchors: ['`conflict`'], has: (s) => row(s, 'conflict').includes('re-run the full suite, and only then build the review package on `git merge-base HEAD origin/{integration-branch}`') },
  { name: 'resolved-but-uncommitted resume is committed by the dispatch', anchors: ['`conflict`'], has: (s) => row(s, 'conflict').includes('`merge-in-progress`') && row(s, 'conflict').includes('an empty `conflictFiles` means resolved but not yet committed: the same implementer dispatch commits the merge') },
  { name: '{files} has a source on a resumed run', anchors: ['`conflict`'], has: (s) => row(s, 'conflict').includes('`conflictFiles` of the run that first returned `conflict` with a non-empty list, or `resolved before resume` when that output is gone') },
  { name: 'windows-longpath is not the fail-open path', anchors: ['`windows-longpath`'], has: (s) => row(s, 'windows-longpath').includes('never the fail-open path') },
  { name: 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check', anchors: ['`windows-longpath`'], has: (s) => row(s, 'windows-longpath').includes('`git clean -f -d -- {leftover paths}`') && row(s, 'windows-longpath').includes("because the CLI's dirty-tree pre-check guaranteed no uncommitted tracked changes") },
  { name: 'dirty-tree is never committed blindly', anchors: ['`dirty-tree`'], has: (s) => row(s, 'dirty-tree').includes('never committed blindly') && /build's own uncommitted work[^|]*anything else is a HARD-GATE stop/.test(row(s, 'dirty-tree')) },
  { name: 'a repair is one implementer dispatch, never the controller', has: (s) => s.includes("is one implementer dispatch at the plan's implementer tier, never a controller-side fix") },
  { name: 'the repair dispatch gets both merge sides', has: (s) => s.includes("the merge's two sides (`{before}` and `origin/{integration-branch}`)") },
  { name: 'an unrepaired tree is a HARD-GATE stop', has: (s) => s.includes('A repair that does not leave a committed green tree is a HARD-GATE stop with the merge state intact') },
  { name: 'non-zero exit rule', has: (s) => s.includes('neither is skipped past') && s.includes('Never move or delete untracked files to get past one') },
  { name: 'second non-zero exit stops', has: (s) => s.includes('a second non-zero exit is a HARD-GATE stop') },
  { name: 'each non-zero exit is the caller\'s rule-(a) entry', has: (s) => s.includes("Each non-zero exit, the first and the second, is the caller's to log (rule (a)") && s.includes('`SKIP {time} — Pre-review catch-up: condition: the CLI exited {n} ({stderr line})') && s.includes('`log-decision.js --status SKIP --section "/build" --step "Pre-review catch-up" --text-file`') },
  { name: 'logged:false hand-logs entry through --entries', has: (s) => s.includes("hand-log the JSON's `entry`") && s.includes('never `line` itself') && s.includes('PRC_ENTRY=pre-review-catchup-entry.json') && s.includes('log-decision.js --run "$PIPELINE_RUN_DIR" --entries "{that path}"') },
  ...OUTCOME_FACTS,
];
const missingSharedFacts = missingFacts(SHARED_FACTS, sharedProcedure);

const swapAll = (text, from, to) => {
  const out = text.split(from).join(to);
  assert.notEqual(out, text, `control matched nothing: ${from}`);
  return out;
};

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `heading missing: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

// The ## Outcomes table's first-column tokens: the rows after its separator line.
function outcomeTableTokens(text) {
  const lines = section(text, '## Outcomes').split('\n');
  const sep = lines.findIndex((l) => /^\|-+\|/.test(l));
  assert.notStrictEqual(sep, -1, '## Outcomes table separator not found');
  const rows = [];
  for (const l of lines.slice(sep + 1)) {
    if (!l.startsWith('|')) break;
    const m = /^\| `([^`]+)` \|/.exec(l);
    assert.ok(m, `## Outcomes row without a backticked outcome: ${l}`);
    rows.push(m[1]);
  }
  assert.ok(rows.length > 0, '## Outcomes table has no rows');
  return rows;
}

test('AC1.1: dispatch.md runs the catch-up before the whole-branch review', () => {
  requireOrder(DISPATCH, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]);
});

test('AC1.1 control: the order helper goes red when the catch-up sentence moves below the return marker', () => {
  const at = DISPATCH.indexOf(CLI_MARKER);
  assert.notStrictEqual(at, -1, 'CLI marker missing from the live text');
  const swapped = DISPATCH.replace(CLI_MARKER, 'bin/other.js') + `\n${CLI_MARKER}`;
  assert.notEqual(swapped, DISPATCH);
  assert.throws(() => requireOrder(swapped, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /must come after/);
  const absent = DISPATCH.replace(CLI_MARKER, 'bin/other.js');
  assert.notEqual(absent, DISPATCH);
  assert.throws(() => requireOrder(absent, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /marker missing/);
});

test('AC1.2: the review package base comes from reviewBase', () => {
  assert.ok(DISPATCH.includes('reviewBase'), 'dispatch.md must route the review base through the CLI JSON reviewBase');
});

test('scope: dispatch.md routes {integration-branch} through the canonical ladder', () => {
  // The scope facts themselves ('current-branch is the only skip', 'wave members run it',
  // 'call-site rule') are pinned in both DISPATCH_FACTS and SHARED_FACTS below.
  assert.ok(DISPATCH.includes('_shared/integration-branch.md'), 'dispatch.md must route {integration-branch} through the canonical ladder');
});

test('call site: the catch-up instruction states the call-site wiring and cites the shared Outcomes', () => {
  assert.deepEqual(missingDispatchFacts(DISPATCH), []);
});

test('call-site control: each fact goes red alone when only it is removed from the text', () => {
  const textControls = [
    ['current-branch strategy → fallback', 'current-branch strategy → fallback-x', 'current-branch is the only skip'],
    ['a `MULTISPEC_PARALLEL_WAVE=1` wave member runs it', 'a `MULTISPEC_PARALLEL_WAVE=1` wave member skips it', 'wave members run it'],
    ['--integration-branch {integration-branch} --run "$PIPELINE_RUN_DIR"` from the worktree root', '--integration-branch {integration-branch}` from the worktree root', 'runs the CLI with --run from the worktree root'],
    ['never carried from Common Step 1', 'carried from Common Step 1', 'call-site rule'],
    ['there means re-running the suite (with its one fix dispatch on a failure) and nothing more', 'there means building the package', 'skip path has no review package'],
    [CITE, 'per its own routes', 'routes per the shared Outcomes'],
    ['Whatever the outcome, a non-null `reviewBase`', 'After `merged`, a non-null `reviewBase`', 'any non-null reviewBase is the package base'],
    ['The controller never fixes code itself', 'The controller fixes code itself', 'the controller never fixes code'],
    ['with `log-decision.js --text-file`', 'with `log-decision.js --text`', 'conflict-resolved line uses --text-file'],
    ['stop SDD before the review with the merge state intact and return here', 'continue SDD into the review', 'an unrepaired tree returns as a HARD-GATE'],
  ];
  for (const [from, to, name] of textControls) assert.deepEqual(missingDispatchFacts(swapAll(DISPATCH, from, to)), [name], from);
  // A second catch-up SKIP line (the retired wave-member skip) breaks the only-skip fact alone.
  const secondSkip = DISPATCH.replace(SPAN_START, `${SPAN_START} \`SKIP {time} ${SKIP_LINE} parallel-wave member\``);
  assert.deepEqual(missingDispatchFacts(secondSkip), ['current-branch is the only skip']);
  // A citation that only appears outside the catch-up span (before its label) must not satisfy the pin.
  const outside = swapAll(DISPATCH, CITE, 'per its own routes').replace(SPAN_START, `${CITE}\n${SPAN_START}`);
  assert.ok(outside.includes(CITE));
  assert.deepEqual(missingDispatchFacts(outside), ['routes per the shared Outcomes']);
  // The end anchor is asserted, not assumed.
  assert.throws(() => catchupSpan(DISPATCH.replace(REVIEW_RETURN_MARKER, 'x')), /marker missing after/);
});

test('call site: dispatch.md no longer claims the controller owes no line beyond the conflict line', () => {
  // A non-zero exit is the caller's rule-(a) entry (auto-decision-log.md), owned by the shared file.
  const claimsNoCallerLine = (text) => /controller adds none/.test(catchupSpan(text));
  assert.equal(claimsNoCallerLine(DISPATCH), false);
  const retired = DISPATCH.replace(CITE, `${CITE}. The CLI logs its own line, so the controller adds none beyond the conflict-resolution line`);
  assert.notEqual(retired, DISPATCH);
  assert.equal(claimsNoCallerLine(retired), true);
});

test('shared procedure: the single home of every outcome route, the repair dispatch and the exit-code rule', () => {
  assert.deepEqual(missingSharedFacts(readShared()), []);
});

test('shared-procedure control: each fact goes red alone when only it is removed from the text', () => {
  const SHARED = readShared();
  const textControls = [
    ['that is the only skip', 'that is one skip', 'current-branch is the only skip'],
    ['including a `MULTISPEC_PARALLEL_WAVE=1` wave member', 'except a `MULTISPEC_PARALLEL_WAVE=1` wave member', 'wave members run it'],
    ['It is never carried from Common Step 1', 'It is carried from Common Step 1', 'call-site rule'],
    ['Whatever the outcome, a non-null `reviewBase`', 'After a merge, a non-null `reviewBase`', 'any non-null reviewBase is the package base'],
    ["build the review package on the JSON's `reviewBase`, so the reviewer", "build the review package on the JSON's base, so the reviewer", 'merged route names reviewBase'],
    ['Re-run the full suite on the merged tree', 'Skip the suite on the merged tree', 'merged re-runs the suite, failures through the repair dispatch'],
    ["build the review package on the JSON's `reviewBase` (the merge base", "build the review package on the JSON's base (the merge base", 'no-overlap route names reviewBase'],
    ['Build the review package on `reviewBase` when it is non-null', "Build the review package on SDD's base", 'fetch-failed route names reviewBase'],
    ['Stop: never review the pre-merge tree', 'Review the pre-merge tree', 'conflict stops before review'],
    ['never reset, discard, or `git merge --abort` past it', 'abort it if needed', 'conflict is never aborted past'],
    ['build the review package on `git merge-base HEAD origin/{integration-branch}`', "build the review package on SDD's base", 'conflict package base'],
    ['the same implementer dispatch commits the merge', 'the controller commits the merge', 'resolved-but-uncommitted resume is committed by the dispatch'],
    ['(`reason` `merge-in-progress`)', '(a resumed merge)', 'resolved-but-uncommitted resume is committed by the dispatch'],
    ['or `resolved before resume` when that output is gone', 'or nothing when that output is gone', '{files} has a source on a resumed run'],
    ['never the fail-open path', 'the fail-open path', 'windows-longpath is not the fail-open path'],
    ["because the CLI's dirty-tree pre-check guaranteed", 'because it is fine and guaranteed', 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check'],
    ['anything else is a HARD-GATE stop surfaced to the human', 'anything else is committed too', 'dirty-tree is never committed blindly'],
    ['never a controller-side fix', 'or a controller-side fix', 'a repair is one implementer dispatch, never the controller'],
    ['(`{before}` and `origin/{integration-branch}`)', '(both sides)', 'the repair dispatch gets both merge sides'],
    ['committed green tree is a HARD-GATE stop', 'committed green tree is retried', 'an unrepaired tree is a HARD-GATE stop'],
    ['neither is skipped past', 'either may be skipped', 'non-zero exit rule'],
    ['Never move or delete untracked files to get past one', 'Move untracked files out of the way', 'non-zero exit rule'],
    ['a second non-zero exit is a HARD-GATE stop', 'a second non-zero exit is retried', 'second non-zero exit stops'],
    ["is the caller's to log (rule (a)", 'is not logged (rule (a)', "each non-zero exit is the caller's rule-(a) entry"],
    ['--step "Pre-review catch-up" --text-file`', '--step "Pre-review catch-up" --text "{text}"`', "each non-zero exit is the caller's rule-(a) entry"],
    ["hand-log the JSON's `entry`", "hand-log the JSON's `line`", 'logged:false hand-logs entry through --entries'],
  ];
  for (const [from, to, name] of textControls) assert.deepEqual(missingSharedFacts(swapAll(SHARED, from, to)), [name], from);
  for (const f of OUTCOME_FACTS) {
    assert.deepEqual(missingSharedFacts(swapAll(SHARED, f.token, 'OUTCOME')), lostWith(SHARED_FACTS, f), f.token);
  }
  assert.deepEqual(lostWith(SHARED_FACTS, OUTCOME_FACTS.find((f) => f.token === '`no-overlap`')), ['no-overlap route names reviewBase', 'outcome no-overlap']);
  // Deleting the whole windows-longpath row loses all three of its facts.
  const wlpRow = /^\| `windows-longpath` \|.*\n/m;
  assert.ok(wlpRow.test(SHARED), 'the windows-longpath row shape changed — update this control');
  assert.deepEqual(
    missingSharedFacts(SHARED.replace(wlpRow, '')),
    ['windows-longpath is not the fail-open path', 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check', 'outcome windows-longpath'],
  );
  // A token that only appears outside the procedure (in the Anti-patterns table) must not satisfy the pin.
  const keptOnlyOutside = `${swapAll(SHARED, '`windows-longpath`', 'WLP')}| \`windows-longpath\` | outside the procedure |\n`;
  assert.ok(keptOnlyOutside.indexOf('`windows-longpath`') > keptOnlyOutside.indexOf(SHARED_END));
  assert.ok(missingSharedFacts(keptOnlyOutside).includes('outcome windows-longpath'));
  // The end anchor is asserted, not assumed.
  assert.throws(() => sharedProcedure(SHARED.replace(SHARED_END, '\n## Other')), /marker missing after/);
});

test('AC3.1: a conflict stops before review', () => {
  const conflictRow = row(sharedProcedure(readShared()), 'conflict');
  assert.ok(conflictRow.includes('Stop: never review the pre-merge tree'), 'the shared conflict row must stop before review');
});

test('shared file and naming', () => {
  const SHARED = readShared();
  assert.ok(/^# Pre-review Catch-up$/m.test(SHARED), 'shared file title');
  assert.ok(/^## Outcomes$/m.test(SHARED), 'shared file needs an ## Outcomes heading');
  const stepFour = BUILD_WORKTREE_SETUP.split('\n').find((l) => l.startsWith('4. **Catch up with the integration branch**'));
  assert.ok(stepFour, 'build/worktree-setup.md step 4 paragraph not found');
  assert.ok(stepFour.includes('_shared/pre-review-catchup.md'), 'step 4 must name the shared file');
});

test('every outcome is documented', () => {
  assert.equal(OUTCOMES.length, 7, 'OUTCOMES roster size changed — document the new outcome and bump this literal');
  assert.deepEqual(outcomeTableTokens(readShared()).sort(), [...OUTCOMES].sort(), '_shared/pre-review-catchup.md ## Outcomes table rows must name exactly OUTCOMES');
  const cliLine = PLUGIN_STRUCTURE.split('\n').find((l) => l.startsWith('node plugin/bin/pre-review-catchup.js '));
  assert.ok(cliLine, 'docs/plugin-structure.md needs a pre-review-catchup.js line');
  for (const outcome of OUTCOMES) {
    assert.ok(cliLine.includes(outcome), `docs/plugin-structure.md CLI line must name ${outcome}`);
  }
});

test('every outcome is documented control: an added, dropped or duplicated table row goes red', () => {
  const SHARED = readShared();
  const sorted = [...OUTCOMES].sort();
  const anchor = '| `not-applicable` |';
  assert.ok(SHARED.includes(anchor));
  const added = SHARED.replace(anchor, `| \`stale-ref\` | prose only | Proceed |\n${anchor}`);
  assert.notDeepEqual(outcomeTableTokens(added).sort(), sorted);
  const dropped = SHARED.replace(/^\| `not-applicable` \|.*\n/m, '');
  assert.notEqual(dropped, SHARED);
  assert.notDeepEqual(outcomeTableTokens(dropped).sort(), sorted);
  const duplicated = SHARED.replace(anchor, `| \`merged\` | twice | Proceed |\n${anchor}`);
  assert.notDeepEqual(outcomeTableTokens(duplicated).sort(), sorted);
  // A table that no longer parses fails loud rather than comparing two empty lists.
  assert.throws(() => outcomeTableTokens(SHARED.replace(/^\|-+\|.*$/m, '')), /separator not found/);
});
