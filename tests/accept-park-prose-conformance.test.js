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

function pinStep29(text) {
  const at = text.indexOf(M_STEP29);
  need(at !== -1, 'Step 2.9 heading missing');
  const step3 = text.indexOf('## Step 3: Attempt auto-merge');
  need(step3 !== -1, 'Step 3 heading missing');
  need(at < step3, 'Step 2.9 must come before Step 3');
  const section = sectionOf(text, M_STEP29);
  need(section.includes(M_PARKED), 'Step 2.9 must run accept-park.js parked');
  need(section.includes(M_DECIDE), 'Step 2.9 must run accept-park.js decide');
  need(section.includes('awaiting-local-acceptance') && section.includes('pending-review'),
    'Step 2.9 must name the pending-review / awaiting-local-acceptance outcome');
  need(/Step 3 never runs/.test(section), 'Step 2.9 must say Step 3 never runs on a park');
  need(section.includes('_shared/local-acceptance-park.md'), 'Step 2.9 must point at local-acceptance-park.md');
  need(/only when `parked` exits 0\/6 or `decide` prints `park:true`/.test(section),
    'Step 2.9 must gate the read of local-acceptance-park.md');
  need(Buffer.byteLength(section) <= 700, 'Step 2.9 must stay a pointer');
  const firstMerge = text.indexOf('gh pr merge', step3);
  need(firstMerge !== -1, 'Step 3 first gh pr merge missing');
  need(at < firstMerge, 'Step 2.9 must come before the first gh pr merge');
  need(/\| `pending-review` \|[^\n]*`awaiting-local-acceptance` \(Step 2\.9\)/.test(text),
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
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('and Step 3 never runs', 'and moves on'))),
    'Step 2.9 must say Step 3 never runs on a park');
  expectRed(() => pinStep29(MERGE.replace(section, section.replace('only when', 'when'))),
    'Step 2.9 must gate the read of local-acceptance-park.md');
  expectRed(() => pinStep29(without(MERGE, '`awaiting-local-acceptance` (Step 2.9), ')),
    'the pending-review outcome row must name awaiting-local-acceptance (Step 2.9)');
  // Ordering: permute — splice Step 2.9 below Step 3's first merge fence.
  const moved = without(MERGE, `${section}\n\n`).replace('## Step 4 and Step 5', `${section}\n\n## Step 4 and Step 5`);
  assert.notStrictEqual(moved, MERGE);
  expectRed(() => pinStep29(moved), 'Step 2.9 must come before Step 3');
});

// ---------------------------------------------------------------------------------------------
// AC3b.3 — tidy's Arm ready PR holds a parked PR before it reaches Step 3
// ---------------------------------------------------------------------------------------------
const HELD_LINE = 'Held (not armed): PR #{n} — parked awaiting local acceptance';

function pinTidy(actions, skill) {
  const arm = collapse(sectionOf(actions, '## Arm ready PR'));
  const parked = arm.indexOf(M_PARKED);
  need(parked !== -1, 'Arm ready PR must run accept-park.js parked');
  const step3 = arm.indexOf("run `_shared/pr-first-merge.md`'s Step 3");
  need(step3 !== -1, 'Arm ready PR Step 3 call missing');
  need(parked < step3, 'Arm ready PR must run parked before Step 3');
  need(/exit 0 or 6/i.test(arm), 'Arm ready PR must treat parked exit 0 and 6 alike');
  need(arm.includes(HELD_LINE), 'Arm ready PR must report the held line');
  need(collapse(skill).includes(HELD_LINE), 'tidy SKILL.md Step 7.5 template must carry the held line');
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
  const skillLine = TIDY_SKILL.split('\n').find((l) => l.includes(HELD_LINE));
  need(skillLine, 'the template line exists');
  expectRed(() => pinTidy(TIDY_ACTIONS, without(TIDY_SKILL, skillLine)), 'tidy SKILL.md Step 7.5 template must carry the held line');
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
  need(/exit 0 or 6/i.test(body), 'close-out step 3 must treat parked exit 0 and 6 alike');
  need(body.includes(`\`stopped: ${STOP_LINE}\``), 'close-out step 3 must stop with the parked line');
  need(c.slice(c.indexOf('## Reporting')).includes(`stopped: ${STOP_LINE}`), 'close-out Reporting must list the parked outcome');
}

test('AC3b.4: dispatch close-out holds a parked PR before Mark-ready', () => {
  pinCloseOut(CLOSE_OUT);
});

test('AC3b.4 control: the close-out guard goes red on each claim', () => {
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
function pinDriverRoute(text) {
  const row = text.split('\n').find((l) => l.startsWith('| `pending-review` with `merge.reason` `awaiting-local-acceptance` |'));
  need(row, 'driver-route pending-review row missing');
  need(row.includes('awaiting-local-acceptance'), 'driver-route pending-review row must name awaiting-local-acceptance');
  need(/merge\.reason/.test(row), 'driver-route pending-review row must read merge.reason');
  need(/removes the group's worktree last/.test(row), 'driver-route must have the dispatching session remove the worktree last');
  need(/ExitWorktree/.test(row), 'driver-route must name ExitWorktree for the removal');
  need(/--worktree-mode caller/.test(row), 'driver-route must say the driver parked with --worktree-mode caller');
  need(/writes the (archived )?run directory/.test(row), 'driver-route must forbid writing the archived run directory afterwards');
}

test('AC3.4b: the dispatch driver route removes the worktree of a parked group', () => {
  pinDriverRoute(DRIVER_ROUTE);
});

test('AC3.4b control: the driver route goes red without the removal clause', () => {
  const row = DRIVER_ROUTE.split('\n').find((l) => l.startsWith('| `pending-review` with `merge.reason` `awaiting-local-acceptance` |'));
  expectRed(() => pinDriverRoute(without(DRIVER_ROUTE, `${row}\n`)), 'driver-route pending-review row missing');
  expectRed(() => pinDriverRoute(DRIVER_ROUTE.replace(row, '| `pending-review` with `merge.reason` `awaiting-local-acceptance` | as `merged` |')),
    'driver-route must have the dispatching session remove the worktree last');
  expectRed(() => pinDriverRoute(DRIVER_ROUTE.replace(row, row.replace("removes the group's worktree last", 'leaves it'))),
    'driver-route must have the dispatching session remove the worktree last');
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
  ['exit 0 or 6 do not merge', /Exit 0 or 6[\s\S]{0,200}never run Step 3/],
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
  expectRed(() => pinConsole(CONSOLE.replace(paragraphWith(CONSOLE, 'Step 2.9 park'), '')), 'console-on-pr must name the park outcome');
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
}

test('AC4.5: /accept re-entry cites reenter, reenter-check and reenter-remove in that order', () => {
  pinReentry(ACCEPT);
});

test('AC4.5 control: a swapped order and a dropped step both go red', () => {
  const row = ACCEPT.split('\n').find((l) => l.startsWith('| `awaiting-local` |'));
  const swapped = row.replace('accept-park.js" reenter-check', '@@A').replace('accept-park.js" reenter-remove', 'accept-park.js" reenter-check').replace('@@A', 'accept-park.js" reenter-remove');
  assert.notStrictEqual(swapped, row);
  expectRed(() => pinReentry(ACCEPT.replace(row, swapped)), 'awaiting-local row must cite reenter, reenter-check, reenter-remove in that order');
  expectRed(() => pinReentry(ACCEPT.replace(row, row.replace(/reenter-remove/g, 'x'))), 'awaiting-local row must cite parked, reenter, reenter-check and reenter-remove');
});

const LOCAL_OPTIONS = ['Accept and merge (Recommended)', "Accept, I'll merge", "Broken: here's what I saw"];
const CANNOT_RUN_OPTIONS = ['Accept (agent checks only)', "Broken: here's what I saw"];

function localVerdictBlock(text) {
  const verdict = sectionOf(text, '### Verdict');
  const hits = verdict.split(/\n\n/).filter((p) => p.includes('**Parked local target'));
  need(hits.length === 1, 'Verdict must carry the parked local target paragraph');
  return hits[0];
}

function pinLocalVerdict(text) {
  const block = localVerdictBlock(text);
  const idx = LOCAL_OPTIONS.map((o) => block.indexOf(`\`${o}\``));
  need(idx.every((x) => x !== -1), 'local verdict must list exactly the three options');
  need(idx[0] < idx[1] && idx[1] < idx[2], 'local verdict options must come in order');
  need(/pr-first-merge\.md`? Steps 2\.5-3/.test(collapse(block)), 'Accept and merge must merge through pr-first-merge Steps 2.5-3');
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
});

test('AC4a.1: cannot-run offers exactly two options and runs nothing', () => {
  pinCannotRun(ACCEPT);
});

test('AC4a.1 control: each cannot-run claim goes red', () => {
  const block = localVerdictBlock(ACCEPT);
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace('`Accept (agent checks only)`', 'x'))), 'cannot-run must offer exactly two options');
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace('`Surface: infra`', 'x'))), 'cannot-run must name Surface: infra');
  expectRed(() => pinCannotRun(ACCEPT.replace(block, block.replace(/running nothing/g, 'running it'))), 'cannot-run must run nothing');
});

test('the existing Option 3 Skip prose is untouched', () => {
  assert.ok(ACCEPT.includes('- Option 3 — for a label-backed entry: `label`: `"Skip for now"`'), 'Option 3 Skip prose must remain');
});

// ---------------------------------------------------------------------------------------------
// docs/skill-graph.md — the edges, stated once
// ---------------------------------------------------------------------------------------------
test('skill-graph names the accept-park.js edges on the accept, dispatch and tidy sections', () => {
  for (const name of ['accept', 'dispatch', 'tidy']) {
    const s = sectionOf(GRAPH, `## ${name}`);
    assert.ok(s.includes('`bin/accept-park.js`'), `## ${name} must carry a bin/accept-park.js row`);
  }
  assert.ok(sectionOf(GRAPH, '## accept').includes('`_shared/pr-first-merge.md`'), 'the accept row must name pr-first-merge.md');
});
