'use strict';
// #4615 Task 7: the skill prose for the local acceptance park — pr-first-merge Step 2.9,
// the guards in tidy / dispatch close-out / the dispatch driver route, the console and dev-url
// notes, and /accept's re-entry and local verdict. Prose-as-implementation: each claim is pinned
// against the live text through one function (`pin…`) that takes the text, so the matching
// negative control calls the SAME function on the live text with only that claim removed in
// memory and must throw with the claim's own message (skill-prose-conformance-tests).
//
// The composed merge bundle's size rail is not re-pinned here: tests/bin-lib/skill-audit/
// (bloat.test.js check 10, budgets.test.js) owns the composed-rail check.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const collapse = (s) => s.replace(/\s+/g, ' ');

const SKILLS = ['plugin', 'skills'];
const MERGE = read(...SKILLS, '_shared', 'pr-first-merge.md');
const PARK = read(...SKILLS, '_shared', 'local-acceptance-park.md');
const CONSOLE = read(...SKILLS, '_shared', 'console-on-pr.md');
const DEV_URL = read(...SKILLS, '_shared', 'dev-url-detection.md');
const TIDY_ACTIONS = read(...SKILLS, 'tidy', 'actions-github-issues.md');
const TIDY_SKILL = read(...SKILLS, 'tidy', 'SKILL.md');
const CLOSE_OUT = read(...SKILLS, 'dispatch', 'close-out.md');
const DRIVER_ROUTE = read(...SKILLS, 'dispatch', 'driver-route.md');
const ACCEPT = read(...SKILLS, 'accept', 'SKILL.md');
const MERGE_MODE = read(...SKILLS, 'wrap-up', 'merge-mode.md');
const GRAPH = read('docs', 'skill-graph.md');
const PR_SCAN = read(...SKILLS, '_shared', 'github-pr-scan.md');

// Fail with `message` unless `ok`; the message is what a negative control matches on.
const need = (ok, message) => assert.ok(ok, message);
const expectRed = (fn, message) => assert.throws(fn, { message }, `control must fail with: ${message}`);

// Remove exactly one occurrence of `needle` (a control that matched nothing proves nothing).
function without(text, needle) {
  assert.ok(text.includes(needle), `control needle absent: ${needle.slice(0, 60)}`);
  assert.strictEqual(text.split(needle).length, 2, `control needle must be unique: ${needle.slice(0, 60)}`);
  return text.replace(needle, '');
}

// A paragraph of `text` (blank-line split) containing `anchor`, exactly one.
function paragraphWith(text, anchor) {
  const hits = text.split(/\n\n/).filter((p) => p.includes(anchor));
  assert.strictEqual(hits.length, 1, `exactly one paragraph must contain: ${anchor}`);
  return hits[0];
}

// ---------------------------------------------------------------------------------------------
// AC3b.2 — pr-first-merge Step 2.9 runs parked and decide before Step 3's first gh pr merge
// ---------------------------------------------------------------------------------------------
const M_PARKED = 'accept-park.js" parked';
const M_DECIDE = 'accept-park.js" decide';
const M_STEP29 = '## Step 2.9: Local acceptance park (control mode)';

// Raised from 300 (#4615 round 2) so the pointer carries the --run argument and the stop statement, and
// from 410 (final review M4) for the per-merged-run rule, and to 560 (#4619) for the head and
// classification arguments; the composed merge bundle's own rail (tests/bin-lib/skill-audit)
// is what bounds the file.
const POINTER_BYTES = 560;
const POINTER_MSG = `Step 2.9 must stay a pointer of at most ${POINTER_BYTES} bytes`;

function pinStep29(text) {
  const at = text.indexOf(M_STEP29);
  need(at !== -1, 'Step 2.9 heading missing');
  const step3 = text.indexOf('## Step 3: Attempt auto-merge');
  need(step3 !== -1, 'Step 3 heading missing');
  need(at < step3, 'Step 2.9 must come before Step 3');
  const section = sectionOf(text, M_STEP29);
  need(section.includes(M_PARKED), 'Step 2.9 must run accept-park.js parked');
  need(section.includes(M_DECIDE), 'Step 2.9 must run accept-park.js decide');
  need(/for each `Fixes` record/.test(section), 'Step 2.9 must run per Fixes record');
  need(/parked --record \{n\} --run "\$PIPELINE_RUN_DIR"/.test(section), 'Step 2.9 must give parked its --record and --run arguments');
  need(/never run Step 3; report `pending-review` and read/.test(section), 'Step 2.9 must state the stop and the pending-review outcome');
  need(/decide --run "\$PIPELINE_RUN_DIR" --record \{n\}\[,\{m\}…\]/.test(section), 'Step 2.9 must give decide its --run and --record arguments');
  need(section.includes("`--run` follows Step 2.5's per-merged-run rule"), 'Step 2.9 must apply Step 2.5\'s per-merged-run rule to --run');
  need(section.includes('_shared/local-acceptance-park.md'), 'Step 2.9 must point at local-acceptance-park.md');
  need(/Unless `parked` exits 5 and `decide` exits 0 with `park:false`:/.test(section),
    'Step 2.9 must gate the read of local-acceptance-park.md on the inverted condition');
  need(Buffer.byteLength(section.slice(section.indexOf('\n')).trim()) <= POINTER_BYTES, POINTER_MSG);
  const firstMerge = text.indexOf('gh pr merge', step3);
  need(firstMerge !== -1, 'Step 3 first gh pr merge missing');
  need(at < firstMerge, 'Step 2.9 must come before the first gh pr merge');
  need(/\| `pending-review` \|[^\n]*`awaiting-local-acceptance`, `already-parked`, `park-state-unknown`, `supplier-failed` or `park-failed` \(Step 2\.9\)/.test(text),
    'the pending-review outcome row must name awaiting-local-acceptance (Step 2.9)');
}

test('AC3b.2: pr-first-merge Step 2.9 runs parked and decide before Step 3\'s first gh pr merge', () => {
  pinStep29(MERGE);
});

test('AC3b.2 control: each Step 2.9 claim goes red on its own message', () => {
  const section = sectionOf(MERGE, M_STEP29).trimEnd();
  expectRed(() => pinStep29(without(MERGE, section)), 'Step 2.9 heading missing');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace(M_PARKED, 'x'))), 'Step 2.9 must run accept-park.js parked');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace(M_DECIDE, 'x'))), 'Step 2.9 must run accept-park.js decide');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('parked --record {n} --run "$PIPELINE_RUN_DIR"', 'parked --record {n}'))), 'Step 2.9 must give parked its --record and --run arguments');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('for each `Fixes` record', 'for the record'))), 'Step 2.9 must run per Fixes record');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('never run Step 3; report `pending-review` and read', 'read'))), 'Step 2.9 must state the stop and the pending-review outcome');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('decide --run "$PIPELINE_RUN_DIR" --record', 'decide --record'))),
    'Step 2.9 must give decide its --run and --record arguments');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace("; `--run` follows Step 2.5's per-merged-run rule", ''))),
    'Step 2.9 must apply Step 2.5\'s per-merged-run rule to --run');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('Unless', 'Only when'))),
    'Step 2.9 must gate the read of local-acceptance-park.md on the inverted condition');
  expectRed(() => pinStep29(MERGE.replace(section, `${section} ${'x'.repeat(120)}`)), POINTER_MSG);
  expectRed(() => pinStep29(without(MERGE, '`awaiting-local-acceptance`, `already-parked`, `park-state-unknown`, `supplier-failed` or `park-failed` (Step 2.9), ')),
    'the pending-review outcome row must name awaiting-local-acceptance (Step 2.9)');
  expectRed(() => pinStep29(without(MERGE, '`supplier-failed` or ').replace('`park-state-unknown`, ', '`park-state-unknown` or ')),
    'the pending-review outcome row must name awaiting-local-acceptance (Step 2.9)');
  // Ordering: permute — splice Step 2.9 below Step 3's first merge fence.
  const moved = without(MERGE, `${section}\n\n`).replace('## Step 4 and Step 5', `${section}\n\n## Step 4 and Step 5`);
  assert.notStrictEqual(moved, MERGE);
  expectRed(() => pinStep29(moved), 'Step 2.9 must come before Step 3');
});

// Every Step 2.5 route into Step 3 (arm, immediate merge, forge-enforced arm) passes Step 2.9 first, with two named exemptions.
const GATE_HEAD = 'No fence below runs until Step 2.9 lets the merge through';
const GATE_FACTS = [
  ['every Step 2.5 route', 'whichever Step 2.5 route led here'],
  ['no-Fixes-record exemption', "a caller with no `Fixes` record (tidy's housekeeping arm)"],
  ['own-guard exemption', 'one running Step 3 alone behind its own `parked` guard (dispatch close-out, `/claude-tweaks:accept`)'],
];
function gateParagraph(text) {
  const step3 = text.indexOf('## Step 3: Attempt auto-merge');
  need(step3 !== -1, 'Step 3 heading missing');
  const clause = text.indexOf(GATE_HEAD, step3);
  need(clause !== -1, 'Step 3 must carry the Step 2.9 gate clause');
  const fence = text.indexOf('```bash', step3);
  need(fence !== -1 && clause < fence, "the Step 2.9 gate clause must come before Step 3's first fence");
  const end = text.indexOf('\n\n', clause);
  return text.slice(clause, end);
}
function pinStep3Gate(text) {
  const para = collapse(gateParagraph(text));
  for (const [name, needle] of GATE_FACTS) need(para.includes(needle), `the Step 3 gate clause must state its ${name}`);
  const c = collapse(text.slice(0, text.indexOf('## Step 3: Attempt auto-merge')));
  need(c.includes("(Step 3's own call") && c.includes("Step 3's immediate `--squash` form"),
    'the Step 2.5 routes into Step 3 must still exist for the clause to cover');
}

test('AC3b.2a: Step 3 opens with the Step 2.9 gate, covering every Step 2.5 route into it', () => {
  pinStep3Gate(MERGE);
});

test('AC3b.2a control: the gate clause, each fact and the route check go red', () => {
  expectRed(() => pinStep3Gate(without(MERGE, paragraphWith(MERGE, GATE_HEAD))), 'Step 3 must carry the Step 2.9 gate clause');
  const para = paragraphWith(MERGE, GATE_HEAD);
  for (const [name, needle] of GATE_FACTS) {
    expectRed(() => pinStep3Gate(MERGE.replace(para, without(para, needle))), `the Step 3 gate clause must state its ${name}`);
  }
  const moved = without(MERGE, `${para}\n\n`).replace('\n## Step 4 and Step 5', `\n${para}\n\n## Step 4 and Step 5`);
  assert.notStrictEqual(moved, MERGE);
  expectRed(() => pinStep3Gate(moved), "the Step 2.9 gate clause must come before Step 3's first fence");
  const routeless = MERGE.replace("(Step 3's own call", '(the call');
  assert.notStrictEqual(routeless, MERGE);
  expectRed(() => pinStep3Gate(routeless), 'the Step 2.5 routes into Step 3 must still exist for the clause to cover');
});

// I2: /accept is a named supplier of Step 3's expected head (--match-head-commit).
const EXPECTED_HEAD_CALLERS = '(`dispatch/close-out.md` after an update; `/claude-tweaks:accept`), append `--match-head-commit {expected-head}`';
function pinExpectedHeadCallers(text) {
  const step3 = text.indexOf('## Step 3: Attempt auto-merge');
  need(step3 !== -1 && text.indexOf(EXPECTED_HEAD_CALLERS, step3) !== -1, 'Step 3 must name /claude-tweaks:accept as an expected-head caller');
}

test('I2: Step 3 names /claude-tweaks:accept among the expected-head callers', () => {
  pinExpectedHeadCallers(MERGE);
  expectRed(() => pinExpectedHeadCallers(MERGE.replace('; `/claude-tweaks:accept`), append', '), append')), 'Step 3 must name /claude-tweaks:accept as an expected-head caller');
});

// I4: the repo-wide PR scan never recommends closing a parked PR, nor flags it as a stale pending-review PR.
const SCAN_PARKED_ROW = '| A PR whose `Fixes` record `accept-park.js parked` exits 0';
const SCAN_EXIT_0_OR_6 = 'exits 0 or 6 (unknown counts as parked';
const SCAN_STALE_ROW = '| Open PR stale (>4 weeks, no updates) |';
const SCAN_ITEM11_EXCLUSION = 'A PR whose `Fixes` record `accept-park.js parked` exits 0 or 6 (unknown counts as parked) is excluded from this row';
function pinPrScanPark(text) {
  const lines = text.split('\n');
  const parked = lines.findIndex((l) => l.startsWith(SCAN_PARKED_ROW));
  const stale = lines.findIndex((l) => l.startsWith(SCAN_STALE_ROW));
  need(parked !== -1, 'github-pr-scan must carry the parked-PR row');
  need(stale !== -1, 'github-pr-scan stale row missing');
  need(parked < stale, 'the parked-PR row must come before the stale row');
  need(lines[parked].includes('Yours, `/claude-tweaks:accept #{record}`, never Close'), 'the parked-PR row must route to /claude-tweaks:accept and never Close');
  need(lines[parked].includes(SCAN_EXIT_0_OR_6), 'the parked-PR row must treat parked exit 0 or 6 as parked');
  const item11 = paragraphWith(text, '11. **Stale pending-review PR**');
  need(item11.includes(SCAN_ITEM11_EXCLUSION), 'item 11 must exclude a parked PR');
}

test('I4: github-pr-scan routes a parked PR to /accept, never Close, and item 11 excludes it', () => {
  pinPrScanPark(PR_SCAN);
});

test('I4 control: each github-pr-scan park claim goes red', () => {
  const row = PR_SCAN.split('\n').find((l) => l.startsWith(SCAN_PARKED_ROW));
  expectRed(() => pinPrScanPark(without(PR_SCAN, `${row}\n`)), 'github-pr-scan must carry the parked-PR row');
  const stale = PR_SCAN.split('\n').find((l) => l.startsWith(SCAN_STALE_ROW));
  const swapped = PR_SCAN.replace(`${row}\n${stale}`, `${stale}\n${row}`);
  assert.notStrictEqual(swapped, PR_SCAN);
  expectRed(() => pinPrScanPark(swapped), 'the parked-PR row must come before the stale row');
  expectRed(() => pinPrScanPark(PR_SCAN.replace(row, row.replace('never Close', 'or Close'))), 'the parked-PR row must route to /claude-tweaks:accept and never Close');
  expectRed(() => pinPrScanPark(PR_SCAN.replace(SCAN_ITEM11_EXCLUSION, 'A PR is kept in this row')), 'item 11 must exclude a parked PR');
  expectRed(() => pinPrScanPark(PR_SCAN.replace(row, row.replace('exits 0 or 6', 'exits 0'))), 'the parked-PR row must treat parked exit 0 or 6 as parked');
  expectRed(() => pinPrScanPark(PR_SCAN.replace(SCAN_ITEM11_EXCLUSION, SCAN_ITEM11_EXCLUSION.replace('exits 0 or 6 (unknown counts as parked)', 'exits 0'))), 'item 11 must exclude a parked PR');
});

// The shape line lists Step 2.9; the Phase 2 remedy is never run in-flow.
test('pr-first-merge shape line lists Step 2.9 and the curation remedy stays out of flow', () => {
  const shape = collapse(MERGE.slice(MERGE.indexOf('**The shape:**'), MERGE.indexOf('## Precondition')));
  assert.ok(shape.includes('local acceptance park (Step 2.9)'), 'shape line must list Step 2.9');
  assert.ok(collapse(MERGE).includes('is the remedy, never run here.'), 'curation guard must say the remedy is never run here');
  expectRed(() => assert.ok(collapse(without(MERGE, ', never run here')).includes('is the remedy, never run here.'), 'curation guard must say the remedy is never run here'),
    'curation guard must say the remedy is never run here');
  const stripped = collapse(without(MERGE, 'local acceptance park (Step 2.9) ')).slice(collapse(without(MERGE, 'local acceptance park (Step 2.9) ')).indexOf('**The shape:**'), collapse(without(MERGE, 'local acceptance park (Step 2.9) ')).indexOf('## Precondition'));
  assert.ok(!stripped.includes('local acceptance park (Step 2.9)'), 'control: the shape line pin must fail on stripped text');
});

// ---------------------------------------------------------------------------------------------
// AC3b.3 — tidy's Arm ready PR holds a parked PR before it reaches Step 3
// ---------------------------------------------------------------------------------------------
const HELD_LINE = 'Held (not armed): PR #{n} — parked awaiting local acceptance';
const UNCONFIRMED_LINE = 'Held (not armed): PR #{n} — park state not confirmed (exit {code})';
const NEVER_PARKED_LINE = 'Held (not armed): PR #{n} — local acceptance target, never parked; recommend /claude-tweaks:accept #{record}';
const TIDY_DECIDE = 'accept-park.js" decide --record {n}[,{m}…]';

function pinTidy(actions, skill) {
  const arm = collapse(sectionOf(actions, '## Arm ready PR'));
  const parked = arm.indexOf(M_PARKED);
  need(parked !== -1, 'Arm ready PR must run accept-park.js parked');
  const step3 = arm.indexOf("run `_shared/pr-first-merge.md`'s Step 3");
  need(step3 !== -1, 'Arm ready PR Step 3 call missing');
  need(parked < step3, 'Arm ready PR must run parked before Step 3');
  const decide = arm.indexOf(TIDY_DECIDE);
  need(decide !== -1, 'Arm ready PR must run accept-park.js decide without --run');
  need(parked < decide && decide < step3, 'Arm ready PR must run decide after parked and before Step 3');
  need(arm.includes('Only exit 0 with `park:false` continues'), 'Arm ready PR must continue only on decide exit 0 with park:false');
  need(arm.includes(NEVER_PARKED_LINE), 'Arm ready PR must report the never-parked local-target line');
  need(collapse(skill).includes(NEVER_PARKED_LINE), 'tidy SKILL.md Step 7.5 template must carry the never-parked local-target line');
  need(/Any exit but 5/.test(arm), 'Arm ready PR must hold on any parked exit but 5');
  need(/never with `--run` \(the repo-root policy/.test(arm), 'Arm ready PR must never pass --run to parked');
  need(arm.includes('park state not confirmed (exit {code})') && arm.includes('for exit 0'), 'Arm ready PR must say parked only for exit 0 and park state not confirmed otherwise');
  need(arm.includes(HELD_LINE), 'Arm ready PR must report the held line');
  need(collapse(skill).includes(HELD_LINE), 'tidy SKILL.md Step 7.5 template must carry the held line');
  need(collapse(skill).includes(UNCONFIRMED_LINE), 'tidy SKILL.md Step 7.5 template must carry the park-state-not-confirmed line');
}

test('AC3b.3: tidy Arm ready PR holds a parked PR', () => {
  pinTidy(TIDY_ACTIONS, TIDY_SKILL);
});

test('AC3b.3 control: the tidy guard and its template line each go red', () => {
  const arm = sectionOf(TIDY_ACTIONS, '## Arm ready PR');
  const para = paragraphWith(arm, M_PARKED);
  expectRed(() => pinTidy(TIDY_ACTIONS.replace(para, ''), TIDY_SKILL), 'Arm ready PR must run accept-park.js parked');
  const late = TIDY_ACTIONS.replace(para, '').replace('\n## Release claim', `\n${para}\n\n## Release claim`);
  expectRed(() => pinTidy(late, TIDY_SKILL), 'Arm ready PR must run parked before Step 3');
  expectRed(() => pinTidy(TIDY_ACTIONS.replace('Any exit but 5', 'Exit 0 or 6'), TIDY_SKILL), 'Arm ready PR must hold on any parked exit but 5');
  expectRed(() => pinTidy(TIDY_ACTIONS.replace('never with `--run`', 'with `--run`'), TIDY_SKILL), 'Arm ready PR must never pass --run to parked');
  expectRed(() => pinTidy(TIDY_ACTIONS.replaceAll('park state not confirmed (exit {code})', 'parked'), TIDY_SKILL), 'Arm ready PR must say parked only for exit 0 and park state not confirmed otherwise');
  // I1: tidy's record-linked arm runs decide after parked, holding a never-parked local target.
  expectRed(() => pinTidy(TIDY_ACTIONS.replace(TIDY_DECIDE, 'accept-park.js" decide --run "$PIPELINE_RUN_DIR" --record {n}[,{m}…]'), TIDY_SKILL), 'Arm ready PR must run accept-park.js decide without --run');
  expectRed(() => pinTidy(TIDY_ACTIONS.replace('Only exit 0 with `park:false` continues', 'Any exit continues'), TIDY_SKILL), 'Arm ready PR must continue only on decide exit 0 with park:false');
  expectRed(() => pinTidy(without(TIDY_ACTIONS, NEVER_PARKED_LINE), TIDY_SKILL), 'Arm ready PR must report the never-parked local-target line');
  const neverParked = TIDY_SKILL.split('\n').find((l) => l.includes(NEVER_PARKED_LINE));
  need(neverParked, 'the never-parked template line exists');
  expectRed(() => pinTidy(TIDY_ACTIONS, without(TIDY_SKILL, neverParked)), 'tidy SKILL.md Step 7.5 template must carry the never-parked local-target line');
  const skillLine = TIDY_SKILL.split('\n').find((l) => l.includes(HELD_LINE));
  need(skillLine, 'the template line exists');
  expectRed(() => pinTidy(TIDY_ACTIONS, without(TIDY_SKILL, skillLine)), 'tidy SKILL.md Step 7.5 template must carry the held line');
  const unconfirmed = TIDY_SKILL.split('\n').find((l) => l.includes(UNCONFIRMED_LINE));
  need(unconfirmed, 'the unconfirmed template line exists');
  expectRed(() => pinTidy(TIDY_ACTIONS, without(TIDY_SKILL, unconfirmed)), 'tidy SKILL.md Step 7.5 template must carry the park-state-not-confirmed line');
});

// ---------------------------------------------------------------------------------------------
// AC3b.4 — dispatch close-out holds a parked PR before Mark-ready
// ---------------------------------------------------------------------------------------------
const STOP_LINE = 'parked awaiting local acceptance — run /claude-tweaks:accept #{record}';

function pinCloseOut(text) {
  const c = collapse(text);
  const step3 = c.indexOf('3. **Convert draft to ready');
  const step4 = c.indexOf('4. **Confirmation gate.**');
  need(step3 !== -1 && step4 > step3, 'close-out step 3 missing');
  const body = c.slice(step3, step4);
  const parked = body.indexOf(M_PARKED);
  need(parked !== -1, 'close-out step 3 must run accept-park.js parked');
  const markReady = body.indexOf("run `_shared/pr-first-merge.md`'s Step 2 (Mark ready)");
  need(markReady !== -1, 'close-out step 3 Mark ready call missing');
  need(parked < markReady, 'close-out step 3 must run parked before Mark ready');
  need(/Any exit but 5/.test(body), 'close-out step 3 must stop on any parked exit but 5');
  need(body.includes('stopped: park state not confirmed (exit {code})') && body.includes('for exit 0'), 'close-out step 3 must say parked only for exit 0 and park state not confirmed otherwise');
  need(c.slice(c.indexOf('## Reporting')).includes('stopped: park state not confirmed (exit {code})'), 'close-out Reporting must list the park-state-not-confirmed outcome');
  need(body.includes(`\`stopped: ${STOP_LINE}\``), 'close-out step 3 must stop with the parked line');
  need(c.slice(c.indexOf('## Reporting')).includes(`stopped: ${STOP_LINE}`), 'close-out Reporting must list the parked outcome');
}

test('AC3b.4: dispatch close-out holds a parked PR before Mark-ready', () => {
  pinCloseOut(CLOSE_OUT);
});

test('AC3b.4 control: the close-out guard goes red on each claim', () => {
  expectRed(() => pinCloseOut(CLOSE_OUT.replace('Any exit but 5', 'Exit 0 or 6')), 'close-out step 3 must stop on any parked exit but 5');
  expectRed(() => pinCloseOut(CLOSE_OUT.replace('stopped: park state not confirmed (exit {code})` otherwise', 'stopped: parked` otherwise')), 'close-out step 3 must say parked only for exit 0 and park state not confirmed otherwise');
  const stripped = without(CLOSE_OUT, M_PARKED);
  expectRed(() => pinCloseOut(stripped), 'close-out step 3 must run accept-park.js parked');
  const late = stripped.replace('4. **Confirmation gate.**', `${M_PARKED}\n4. **Confirmation gate.**`);
  expectRed(() => pinCloseOut(late), 'close-out step 3 must run parked before Mark ready');
  const reporting = CLOSE_OUT.slice(CLOSE_OUT.indexOf('## Reporting'));
  const noReport = CLOSE_OUT.replace(reporting, reporting.replace(`\`stopped: ${STOP_LINE}\`, `, ''));
  assert.notStrictEqual(noReport, CLOSE_OUT);
  expectRed(() => pinCloseOut(noReport), 'close-out Reporting must list the parked outcome');
});

// ---------------------------------------------------------------------------------------------
// AC3.4b — the dispatch driver route removes a parked group's worktree
// ---------------------------------------------------------------------------------------------
const ROW_AWAIT = '| `pending-review` with `merge.reason` `awaiting-local-acceptance` |';
const ROW_NOPARK = '| `pending-review` with `merge.reason` `already-parked` or `park-state-unknown` |';
const ROW_GENERAL = '| `pending-review` | as `merged` |';
function pinDriverRoute(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(ROW_AWAIT));
  const np = lines.findIndex((l) => l.startsWith(ROW_NOPARK));
  const gen = lines.findIndex((l) => l === ROW_GENERAL);
  need(at !== -1, 'driver-route awaiting-local-acceptance row missing');
  need(np !== -1, 'driver-route already-parked / park-state-unknown row missing');
  need(gen !== -1, 'driver-route general pending-review row missing');
  need(at < gen && np < gen, 'driver-route specific pending-review rows must come before the general row');
  const row = lines[at];
  need(/removes the group's worktree last/.test(row), 'driver-route must have the dispatching session remove the worktree last');
  need(/ExitWorktree/.test(row), 'driver-route must name ExitWorktree for the removal');
  need(/--worktree-mode caller/.test(row), 'driver-route must say the driver parked with --worktree-mode caller');
  need(/writes the (archived )?run directory/.test(row), 'driver-route must forbid writing the archived run directory afterwards');
  const other = lines[np];
  need(other.includes('two-call-gate.md') && other.includes('§5') && /cleanup-only/.test(other), 'driver-route must route a no-park stop to two-call-gate.md §5 cleanup-only');
  need(!/ExitWorktree|removes the group's worktree/.test(other), 'driver-route no-park row must not remove the worktree as a parked group');
  need(/run directory is live/.test(other), 'driver-route no-park row must say the run directory is live');
}

test('AC3.4b: the dispatch driver route removes the worktree of a parked group', () => {
  pinDriverRoute(DRIVER_ROUTE);
});

test('AC3.4b control: each driver-route claim goes red on its own message', () => {
  const lines = DRIVER_ROUTE.split('\n');
  const row = lines.find((l) => l.startsWith(ROW_AWAIT));
  const other = lines.find((l) => l.startsWith(ROW_NOPARK));
  expectRed(() => pinDriverRoute(without(DRIVER_ROUTE, `${row}\n`)), 'driver-route awaiting-local-acceptance row missing');
  expectRed(() => pinDriverRoute(without(DRIVER_ROUTE, `${other}\n`)), 'driver-route already-parked / park-state-unknown row missing');
  expectRed(() => pinDriverRoute(DRIVER_ROUTE.replace(row, row.replace("removes the group's worktree last", 'leaves it'))),
    'driver-route must have the dispatching session remove the worktree last');
  expectRed(() => pinDriverRoute(DRIVER_ROUTE.replace(other, other.replace('two-call-gate.md', 'x'))),
    'driver-route must route a no-park stop to two-call-gate.md §5 cleanup-only');
  expectRed(() => pinDriverRoute(DRIVER_ROUTE.replace(other, `${other.slice(0, -2)}, by ExitWorktree |`)),
    'driver-route no-park row must not remove the worktree as a parked group');
  const moved = without(DRIVER_ROUTE, `${ROW_GENERAL}\n`).replace(row, `${ROW_GENERAL}\n${row}`);
  assert.notStrictEqual(moved, DRIVER_ROUTE);
  expectRed(() => pinDriverRoute(moved), 'driver-route specific pending-review rows must come before the general row');
});

// ---------------------------------------------------------------------------------------------
// AC3b.5 — the merge-prompt path never merges a parked item
// ---------------------------------------------------------------------------------------------
function pinMergePromptPath(mergeMode, merge, park) {
  need(/compose-context\.js" --run "\$PIPELINE_RUN_DIR" --step merge [^\n]*pr-first-merge\.md/.test(mergeMode),
    'wrap-up merge-mode must read the composed merge bundle of pr-first-merge.md');
  need(merge.indexOf(M_STEP29) !== -1 && merge.indexOf(M_STEP29) < merge.indexOf('## Step 3: Attempt auto-merge'),
    'the merge bundle\'s pr-first-merge.md must carry Step 2.9 before Step 3');
  const c = collapse(park);
  need(c.includes('`pending-review`') && c.includes('`awaiting-local-acceptance`'),
    'local-acceptance-park.md must state pending-review / awaiting-local-acceptance');
  need(/never run Step 3/.test(c), 'local-acceptance-park.md must say never run Step 3');
}

test('AC3b.5: the merge-prompt path never merges a parked item', () => {
  pinMergePromptPath(MERGE_MODE, MERGE, PARK);
});

test('AC3b.5 control: each leg goes red', () => {
  const line = MERGE_MODE.split('\n').find((l) => l.includes('--step merge'));
  expectRed(() => pinMergePromptPath(without(MERGE_MODE, line), MERGE, PARK), 'wrap-up merge-mode must read the composed merge bundle of pr-first-merge.md');
  expectRed(() => pinMergePromptPath(MERGE_MODE, without(MERGE, sectionOf(MERGE, M_STEP29)), PARK), "the merge bundle's pr-first-merge.md must carry Step 2.9 before Step 3");
  expectRed(() => pinMergePromptPath(MERGE_MODE, MERGE, PARK.replace(/never run Step 3/g, 'carry on')), 'local-acceptance-park.md must say never run Step 3');
});

// ---------------------------------------------------------------------------------------------
// local-acceptance-park.md — the procedure's controller-ruled clauses
// ---------------------------------------------------------------------------------------------
const PARK_FACTS = [
  ['parked per Fixes record', /accept-park\.js" parked/],
  ['parked passes the run dir', /--record \{n\} --run "\$PIPELINE_RUN_DIR"` \(omit/],
  ['decide call', /accept-park\.js" decide --run "\$PIPELINE_RUN_DIR" --record/],
  ['park call', /accept-park\.js" park --run/],
  ['park-failed outcome', /`pending-review` \/ `park-failed`/],
  ['caller worktree mode then ExitWorktree remove', /--worktree-mode caller[\s\S]{0,200}`ExitWorktree`[\s\S]{0,40}`remove`/],
  ['the park is the run\'s last act', /LAST act[\s\S]{0,200}nothing writes `\$PIPELINE_RUN_DIR`/],
  ['ok:false steps reported', /`ok:false`[\s\S]{0,300}final report/],
  ['auto:build kept, open-pr exclusion', /keeps `auto:build`[\s\S]{0,200}`open-pr`/],
  ['multi-spec series', /multi-spec series[\s\S]{0,200}shared PR parks when any record parks/],
  ['control mode off', /`consulted:false`[\s\S]{0,100}nothing changes/],
  ['every other result never runs Step 3', /means never run Step 3/],
  ['parked exit 0 is already-parked', /Exit 0: report `pending-review` \/ `already-parked`/],
  ['parked exit 6 is park-state-unknown', /Exit 6 \(`unknown`, fail closed\): report `pending-review` \/ `park-state-unknown`/],
  ['parked other exits are supplier-failed', /Any other exit \(2, 3\): report `pending-review` \/ `supplier-failed`/],
  ['decide non-zero is supplier-failed', /Any non-zero exit \(1 prints a fail-closed decision\) — report `pending-review` \/ `supplier-failed`/],
  ['awaiting only after this run\'s park', /this run's park succeeded/],
];

function parkMissing(text) {
  return PARK_FACTS.filter(([, re]) => !re.test(text)).map(([name]) => name);
}

test('local-acceptance-park.md states every ruled clause', () => {
  assert.deepStrictEqual(parkMissing(PARK), []);
});

test('local-acceptance-park.md control: stripping one clause reports exactly that fact', () => {
  for (const [name, re] of PARK_FACTS) {
    const m = PARK.match(re);
    assert.ok(m, `pattern matches live text once: ${name}`);
    const stripped = PARK.replace(re, '');
    assert.notStrictEqual(stripped, PARK);
    assert.deepStrictEqual(parkMissing(stripped), [name], `stripping ${name} must report exactly itself`);
  }
});

// ---------------------------------------------------------------------------------------------
// console-on-pr and dev-url-detection notes
// ---------------------------------------------------------------------------------------------
function pinConsole(text) {
  const s = collapse(sectionOf(text, '## Headless conclusion'));
  need(/Step 2\.9 park[\s\S]{0,60}ends the run `pending-review` \/ `awaiting-local-acceptance`/.test(s), 'console-on-pr must name the park outcome');
  need(/console is not a stop under control mode/.test(s), 'console-on-pr must say the console is not a stop under control mode');
  need(/pending label plus the packet/.test(s), 'console-on-pr must name the durable state');
  need(/no timeout, no nagging/i.test(s), 'console-on-pr must say no timeout, no nagging');
}

test('console-on-pr names the park outcome', () => {
  pinConsole(CONSOLE);
  const para = paragraphWith(CONSOLE, 'Step 2.9 park');
  expectRed(() => pinConsole(CONSOLE.replace(para, '')), 'console-on-pr must name the park outcome');
  for (const [from, message] of [
    ['ends the run `pending-review` / `awaiting-local-acceptance`', 'console-on-pr must name the park outcome'],
    ['the console is not a stop under control mode', 'console-on-pr must say the console is not a stop under control mode'],
    ['pending label plus the packet', 'console-on-pr must name the durable state'],
    ['No timeout, no nagging.', 'console-on-pr must say no timeout, no nagging'],
  ]) {
    expectRed(() => pinConsole(CONSOLE.replace(para, without(para, from))), message);
  }
});

function pinDevUrl(text) {
  const s = collapse(text);
  const at = s.indexOf('#### Ephemeral server start');
  need(at !== -1, 'Ephemeral server start heading missing');
  const end = s.indexOf('### Output', at);
  need(end !== -1, 'Output heading missing');
  const sec = s.slice(at, end);
  need(sec.includes('`.claude/worktrees/accept-{N}`'), 'dev-url-detection must name the recreated acceptance worktree');
  need(sec.includes('/claude-tweaks:accept'), 'dev-url-detection must name /claude-tweaks:accept re-entry');
  need(/worktree root for item 2's anchor/.test(sec), 'dev-url-detection must make it the anchor-to-worktree-root (item 2) root');
  need(/session-tmp path/.test(sec), 'dev-url-detection must put the server record at the session-tmp path');
  need(/stops the server when the verdict is given or the session ends/.test(sec), 'dev-url-detection must say /accept stops the server');
  need(/no start command[^.]*no `APP_URL`[^.]*cannot-run/.test(sec), 'dev-url-detection must route no start command to /accept\'s cannot-run branch');
}

test('dev-url-detection names the recreated acceptance worktree', () => {
  pinDevUrl(DEV_URL);
  const para = paragraphWith(DEV_URL, '`.claude/worktrees/accept-{N}`');
  expectRed(() => pinDevUrl(DEV_URL.replace(para, '')), 'dev-url-detection must name the recreated acceptance worktree');
});

// ---------------------------------------------------------------------------------------------
// /accept — re-entry order, the three-option local verdict, cannot-run
// ---------------------------------------------------------------------------------------------
function pinReentry(text) {
  const row = text.split('\n').find((l) => l.startsWith('| `awaiting-local` |'));
  need(row, 'awaiting-local state row missing');
  const i = ['accept-park.js" parked', 'accept-park.js" reenter --record', 'accept-park.js" reenter-check', 'accept-park.js" reenter-remove'].map((n) => row.indexOf(n));
  need(i.every((x) => x !== -1), 'awaiting-local row must cite parked, reenter, reenter-check and reenter-remove');
  need(i[0] < i[1] && i[1] < i[2] && i[2] < i[3], 'awaiting-local row must cite reenter, reenter-check, reenter-remove in that order');
  need(/moved:true/.test(row) && /Accept and merge/.test(row) && /Step 2\.5/.test(row),
    'awaiting-local row must withhold Accept and merge on moved:true until the checks re-run (Step 2.5)');
  need(row.includes('_shared/dev-url-detection.md'), 'awaiting-local row must start the app per dev-url-detection.md');
  need(/exit 6, unknown, is fail-closed: no re-entry, report it/.test(row), 'awaiting-local row must treat parked exit 6 as fail-closed');
  need(row.includes('`moved:true` from `reenter` (the PR head or base moved since the park), or `reenter-check` exit 8: say so, and withhold `Accept and merge` for this verdict round')
    && row.includes('re-run only by `_shared/pr-first-merge.md` Step 2.5 on a later merge') && row.includes('never inside this round'),
    'awaiting-local row must withhold Accept and merge for this verdict round, the checks re-run only by a later Step 2.5');
  need(row.includes("only once the chosen option's actions have finished (on `Accept and merge`, after `_shared/pr-first-merge.md` Step 3 and Step 4), `node \"${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js\" reenter-remove"),
    'awaiting-local row must run reenter-remove only after the chosen option finished, after Step 3 and Step 4 on Accept and merge');
}

test('AC4.5:/accept re-entry cites reenter, reenter-check and reenter-remove in that order', () => {
  pinReentry(ACCEPT);
});

test('AC4.5 control: a swapped order and a dropped step both go red', () => {
  const row = ACCEPT.split('\n').find((l) => l.startsWith('| `awaiting-local` |'));
  const swapped = row.replace('accept-park.js" reenter-check', '@@A').replace('accept-park.js" reenter-remove', 'accept-park.js" reenter-check').replace('@@A', 'accept-park.js" reenter-remove');
  assert.notStrictEqual(swapped, row);
  expectRed(() => pinReentry(ACCEPT.replace(row, swapped)), 'awaiting-local row must cite reenter, reenter-check, reenter-remove in that order');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace('exit 6, unknown, is fail-closed: no re-entry, report it', 'exit 6'))), 'awaiting-local row must treat parked exit 6 as fail-closed');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace(/reenter-remove/g, 'x'))), 'awaiting-local row must cite parked, reenter, reenter-check and reenter-remove');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace('for this verdict round', 'until the checks are re-run'))),
    'awaiting-local row must withhold Accept and merge for this verdict round, the checks re-run only by a later Step 2.5');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace('only once the chosen option\'s actions have finished', 'after the verdict'))),
    'awaiting-local row must run reenter-remove only after the chosen option finished, after Step 3 and Step 4 on Accept and merge');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace('after `_shared/pr-first-merge.md` Step 3 and Step 4', 'after the verdict'))),
    'awaiting-local row must run reenter-remove only after the chosen option finished, after Step 3 and Step 4 on Accept and merge');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace('never inside this round', 'here'))),
    'awaiting-local row must withhold Accept and merge for this verdict round, the checks re-run only by a later Step 2.5');
});

const LOCAL_OPTIONS = ['Accept and merge (Recommended)', "Accept, I'll merge", "Broken: here's what I saw"];
const CANNOT_RUN_OPTIONS = ['Accept (agent checks only)', "Broken: here's what I saw"];

function localVerdictBlock(text) {
  const verdict = sectionOf(text, '### Verdict');
  const hits = verdict.split(/\n\n/).filter((p) => p.includes('**Parked local target'));
  need(hits.length === 1, 'Verdict must carry the parked local target paragraph');
  return hits[0];
}

const HEAD_RECHECK = 'then re-checks the head at merge time: `gh pr view {pr} --json headRefOid -q .headRefOid` must equal `reenter`\'s printed `head`';

function pinLocalVerdict(text) {
  const whole = localVerdictBlock(text);
  need(whole.includes('Cannot-run'), 'Verdict must carry the cannot-run branch');
  const block = whole.slice(0, whole.indexOf('Cannot-run'));
  const idx = LOCAL_OPTIONS.map((o) => block.indexOf(`\`${o}\``));
  need(idx.every((x) => x !== -1), 'local verdict must list exactly the three options');
  need(idx[0] < idx[1] && idx[1] < idx[2], 'local verdict options must come in order');
  const merge = collapse(block);
  const rec = merge.indexOf('then records the approval');
  const s3 = merge.indexOf('Step 3 alone with `{tag}` = `human-approved`');
  const s4 = merge.indexOf('and Step 4 when the outcome is `merged`');
  need(rec !== -1 && s3 !== -1 && s4 !== -1, 'Accept and merge must record approval, then Step 3 alone with human-approved, then Step 4');
  need(rec < s3 && s3 < s4, 'Accept and merge must order approval, Step 3, Step 4');
  need(merge.includes('`parked` then exits 5') && merge.includes(HEAD_RECHECK), 'Accept and merge must say parked then exits 5 and re-check the head');
  need(merge.includes('reenter-check --worktree "{worktree}" --expect-head {head}` must exit 0') && merge.includes('`Accept and merge` withheld this round')
    && merge.includes('the checks are re-run by Step 2.5 on a later merge') && merge.includes('never in this round'),
    'Accept and merge must run reenter-check --expect-head at merge time and withhold itself this round on a move');
  need(merge.includes('or any `reenter-check` exit other than 0, say'), 'Accept and merge must withhold itself this round on any reenter-check exit other than 0');
  need(merge.includes('`{expected-head}` = `reenter`\'s printed `head` (so `gh pr merge --match-head-commit`)'), 'Accept and merge must pin Step 3 to reenter\'s head with --match-head-commit');
  need(merge.indexOf('then re-checks the head') < merge.indexOf('then records the approval'), 'Accept and merge must re-check the head before recording the approval');
  need(merge.includes('as `dispatch/close-out.md` step 5 does') && merge.includes('waits on the required checks, no bypass'), 'Accept and merge must cite close-out step 5 and the required checks');
  need(merge.includes('`PIPELINE_RUN_DIR` bound as `dispatch/close-out.md` step 7 binds it') && merge.includes('the archived one included') && merge.includes('`claude-tweaks-run:` marker as its step 3 resolves it'),
    'Accept and merge must bind PIPELINE_RUN_DIR for Step 4 as close-out step 7 does');
  need(merge.includes('first resolves the run dir for Step 4') && merge.includes('"Resolve the run dir"'), 'Accept and merge must resolve the run dir before recording the approval');
  need(merge.indexOf('first resolves the run dir') < merge.indexOf('then records the approval'), 'Accept and merge must resolve the run dir before Step 3');
  need(merge.includes('on `no run dir`, say so plainly and ask again with the other two options, this one withheld'), 'Accept and merge must be withheld on no run dir');
  need(merge.includes('Step 2.5 and Step 2.9 are skipped for this merge (it is reached only with an unmoved head, pinned by `{expected-head}`)'), 'Accept and merge must skip Step 2.5 and Step 2.9');
  need(/#4614/.test(block), 'the broken option must hand off to the verdict handler (#4614)');
}

function pinCannotRun(text) {
  const whole = collapse(localVerdictBlock(text));
  const at = whole.indexOf('Cannot-run');
  need(at !== -1, 'Verdict must carry the cannot-run branch');
  const block = whole.slice(at);
  const idx = CANNOT_RUN_OPTIONS.map((o) => block.indexOf(`\`${o}\``));
  need(idx.every((x) => x !== -1), 'cannot-run must offer exactly two options');
  need(idx[0] < idx[1], 'cannot-run options must come in order');
  need(block.includes('`Surface: infra`'), 'cannot-run must name Surface: infra');
  need(/running nothing/.test(block), 'cannot-run must run nothing');
  need(block.includes('writes the approval only, no merge: the human merges'), 'cannot-run Accept must write the approval only, the human merges');
}

test('AC5.1: the local verdict lists exactly the three options', () => {
  pinLocalVerdict(ACCEPT);
  // exactly: the Accept (agent checks only) option is the cannot-run branch's, never the local list.
  const block = localVerdictBlock(ACCEPT);
  const local = block.slice(0, block.indexOf('Cannot-run'));
  assert.ok(!local.includes('Accept (agent checks only)'), 'the local list must not carry the cannot-run option');
});

test('AC5.1 control: a dropped or reordered option goes red', () => {
  const block = localVerdictBlock(ACCEPT);
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace(`\`${LOCAL_OPTIONS[1]}\``, 'x'))), 'local verdict must list exactly the three options');
  const swapped = block.replace(`\`${LOCAL_OPTIONS[0]}\``, '@@A').replace(`\`${LOCAL_OPTIONS[1]}\``, `\`${LOCAL_OPTIONS[0]}\``).replace('@@A', `\`${LOCAL_OPTIONS[1]}\``);
  assert.notStrictEqual(swapped, block);
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, swapped)), 'local verdict options must come in order');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('Step 2.5 and Step 2.9 are skipped for this merge', ''))), 'Accept and merge must skip Step 2.5 and Step 2.9');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('as `dispatch/close-out.md` step 5 does', ''))), 'Accept and merge must cite close-out step 5 and the required checks');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('with `PIPELINE_RUN_DIR` bound as `dispatch/close-out.md` step 7 binds it', 'with a run dir'))), 'Accept and merge must bind PIPELINE_RUN_DIR for Step 4 as close-out step 7 does');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('first resolves the run dir for Step 4', 'first resolves'))), 'Accept and merge must resolve the run dir before recording the approval');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('on `no run dir`, say so plainly and ask again with the other two options, this one withheld', 'on `no run dir`, continue'))), 'Accept and merge must be withheld on no run dir');
  const headCheck = block.slice(block.indexOf(', then re-checks the head'), block.indexOf(', then records the approval'));
  assert.ok(headCheck.startsWith(', then re-checks the head at merge time'), 'head-check clause located');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('`Accept and merge` withheld this round', 'this one withheld'))),
    'Accept and merge must run reenter-check --expect-head at merge time and withhold itself this round on a move');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('any `reenter-check` exit other than 0', 'exit 8'))),
    'Accept and merge must withhold itself this round on any reenter-check exit other than 0');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace(' --expect-head {head}` must exit 0', '` must exit 0'))),
    'Accept and merge must run reenter-check --expect-head at merge time and withhold itself this round on a move');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace(' and `{expected-head}` = `reenter`\'s printed `head` (so `gh pr merge --match-head-commit`)', ''))),
    'Accept and merge must pin Step 3 to reenter\'s head with --match-head-commit');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace(' (it is reached only with an unmoved head, pinned by `{expected-head}`)', ''))),
    'Accept and merge must skip Step 2.5 and Step 2.9');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace(headCheck, ''))), 'Accept and merge must say parked then exits 5 and re-check the head');
  const reordered = block.replace(headCheck, '').replace('(`accept:pending` removed, so `parked` then exits 5)', `(\`accept:pending\` removed, so \`parked\` then exits 5)${headCheck}`);
  assert.notStrictEqual(reordered, block);
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, reordered)), 'Accept and merge must re-check the head before recording the approval');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('human-approved', 'x'))), 'Accept and merge must record approval, then Step 3 alone with human-approved, then Step 4');
  expectRed(() => pinLocalVerdict(ACCEPT.replace(block, block.replace('then records the approval', 'records the approval'))), 'Accept and merge must record approval, then Step 3 alone with human-approved, then Step 4');
});

test('AC4a.1: cannot-run offers exactly two options and runs nothing', () => {
  pinCannotRun(ACCEPT);
});

test('AC4a.1 control: each cannot-run claim goes red', () => {
  const block = localVerdictBlock(ACCEPT);
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace('`Accept (agent checks only)`', 'x'))), 'cannot-run must offer exactly two options');
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace('`Surface: infra`', 'x'))), 'cannot-run must name Surface: infra');
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace(/running nothing/g, 'running it'))), 'cannot-run must run nothing');
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace('writes the approval only, no merge: the human merges', 'merges'))), 'cannot-run Accept must write the approval only, the human merges');
});

test('the existing Option 3 Skip prose is untouched', () => {
  assert.ok(ACCEPT.includes('- Option 3 — for a label-backed entry: `label`: `"Skip for now"`'), 'Option 3 Skip prose must remain');
});

// ---------------------------------------------------------------------------------------------
// docs/skill-graph.md — the edges, stated once
// ---------------------------------------------------------------------------------------------
function pinGraph(text) {
  for (const name of ['accept', 'dispatch', 'tidy']) {
    const s = sectionOf(text, `## ${name}`);
    need(s.includes('`bin/accept-park.js`'), `## ${name} must carry a bin/accept-park.js row`);
  }
  // The row itself, not the section: the tripwire-classification row names pr-first-merge.md too.
  const row = sectionOf(text, '## accept').split('\n').find((l) => l.startsWith('| `bin/accept-park.js` |')) || '';
  need(row.includes('`_shared/pr-first-merge.md`'), 'the accept row must name pr-first-merge.md');
}

test('skill-graph names the accept-park.js edges on the accept, dispatch and tidy sections', () => {
  pinGraph(GRAPH);
});

test('skill-graph control: each section row and the accept edge go red when stripped', () => {
  const rowOf = (name) => sectionOf(GRAPH, `## ${name}`).split('\n').find((l) => l.startsWith('| `bin/accept-park.js` |'));
  for (const name of ['accept', 'dispatch', 'tidy']) {
    expectRed(() => pinGraph(GRAPH.replace(rowOf(name), '')), `## ${name} must carry a bin/accept-park.js row`);
  }
  const row = rowOf('accept');
  expectRed(() => pinGraph(GRAPH.replace(row, row.split('`_shared/pr-first-merge.md`').join('x'))), 'the accept row must name pr-first-merge.md');
});

// ---------------------------------------------------------------------------------------------
// #4619 — every merge site's `decide` call passes the PR head (the diff tripwire's target)
// ---------------------------------------------------------------------------------------------
const HEAD_ARG = ' --head {headRefOid}';
const DECIDE_HEAD_SITES = [
  ['Step 2.9', (merge) => collapse(sectionOf(merge, M_STEP29)), /accept-park\.js" decide --run "\$PIPELINE_RUN_DIR" --record \{n\}\[,\{m\}…\] --head \{headRefOid\}/],
  ['local-acceptance-park.md step 2', (_m, park) => collapse(park), /accept-park\.js" decide --run "\$PIPELINE_RUN_DIR" --record \{n\}\[,\{m\}…\] --head \{headRefOid\}/],
  ["tidy's Arm ready PR", (_m, _p, tidy) => collapse(sectionOf(tidy, '## Arm ready PR')), /accept-park\.js" decide --record \{n\}\[,\{m\}…\] --head \{headRefOid\}/],
];
function pinDecideHead(merge, park, tidy) {
  for (const [name, slice, re] of DECIDE_HEAD_SITES) need(re.test(slice(merge, park, tidy)), `${name} must pass --head {headRefOid} to decide`);
}

test('#4619: Step 2.9, local-acceptance-park.md and the tidy arm each pass --head to decide', () => {
  pinDecideHead(MERGE, PARK, TIDY_ACTIONS);
});

test('#4619 control: stripping --head from any one site reports that site', () => {
  const sources = [MERGE, PARK, TIDY_ACTIONS];
  DECIDE_HEAD_SITES.forEach(([name, , re], i) => {
    // Each site is one unwrapped line, so the raw text carries the pinned span; strip the flag from that span only.
    const span = sources[i].match(re);
    assert.ok(span, `control: ${name} span present in the raw text`);
    const args = [...sources];
    args[i] = sources[i].replace(span[0], span[0].replace(HEAD_ARG, ''));
    assert.notStrictEqual(args[i], sources[i]);
    expectRed(() => pinDecideHead(...args), `${name} must pass --head {headRefOid} to decide`);
  });
});
