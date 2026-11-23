'use strict';
// #6059: pins /specify case 1's planning-hold routing (plugin/skills/specify/SKILL.md) and the
// work-record.md sentence naming the hold. Read live: these files are the declared contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const skill = () => readText(path.join(ROOT, 'plugin/skills/specify/SKILL.md'));
const workRecord = () => readText(path.join(ROOT, 'plugin/skills/_shared/work-record.md'));

// A literal as a regex that tolerates a hard wrap at any space.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// Every fact must be present in the region, and each must go red when stripped alone.
function pinned(region, patterns, label) {
  const missing = missingFactsOf(patterns)(region);
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(' | ')}`);
  assertEachPatternGoesRed(region, patterns, missingFactsOf(patterns));
}
const f = (s, fact) => [lit(s), fact || s];

function caseOne() {
  const text = skill();
  const from = text.indexOf('1. **Work record reference**');
  const to = text.indexOf('2. **Design doc path**');
  assert.notEqual(from, -1, 'case 1 start not found');
  assert.ok(to > from, 'case 2 start not found after case 1');
  return text.slice(from, to);
}

test('D1: case 1 routes a held needs:decision record to planning-answer.md', () => {
  pinned(caseOne(), [
    f('Under `work-backend: github-issues`, when the fetched labels carry `needs:decision`'),
    f('`gh issue view {n} --json comments > "{comments-file}"`'),
    f('`issue_read` `get_comments` (`perPage: 100`) per `_shared/github-write-transport.md`'),
    f('planning-hold.js" --comments-file'),
    f('print every `skipped` line'),
    f('read `planning-answer.md` in this skill\'s directory and follow it instead of shaping mode'),
    f('passing it `{n}`, the fetched body and `{hold-file}`'),
  ], 'routing');
});

test('D5: a headless invocation on a held record refuses naming the planning hold', () => {
  pinned(caseOne(), [
    f('`shaping-mode-stamping.md`\'s `### Risk flags` step 2 defines it'),
    f('`#{n} is held for planning question(s) — answer them with /claude-tweaks:specify #{n} where a human can reply`'),
  ], 'headless refusal');
});

test('AC3.1 + AC5.1 + AC5.2: a record that is not a planning hold keeps today\'s behaviour', () => {
  pinned(caseOne(), [
    f('reason `untrusted`, `unparseable` or `ambiguous`'),
    f('`#{n}\'s decision comment is not a usable planning hold ({reason}) — shaping it as before`'),
    f('Reasons `not-planning` and `no-decision-comment`: continue as today, no notice'),
    f('A failed comment fetch or a non-zero CLI exit: the same notice with reason `unreadable`, then continue as today'),
  ], 'not-held');
});

test('Review Focus 5: a batch with a held element fails whole', () => {
  pinned(caseOne(), [
    f('`\'{element}\' is held for planning question(s) — run /claude-tweaks:specify #{element} on its own to answer them, then re-run the batch without it`'),
    f('the planning-hold routing, and the `needs:definition` check above, per element'),
  ], 'batch');
});

test('case 5 applies the routing by reference', () => {
  const text = skill();
  const from = text.indexOf('5. **Backlog reference**');
  const to = text.indexOf('**Ambiguous input handling');
  assert.notEqual(from, -1, 'case 5 start not found');
  assert.ok(to > from, 'Ambiguous input handling not found after case 5');
  pinned(text.slice(from, to), [
    f('also apply case 1\'s **planning-hold routing** by reference'),
  ], 'case 5');
});

test('the routing paragraph sits after the digest-container guard and before the needs:definition redirect', () => {
  const region = caseOne();
  const digest = region.indexOf('**Digest-container guard');
  const hold = region.indexOf('planning-hold.js');
  const redirect = region.indexOf('**`needs:definition` redirect');
  assert.ok(digest !== -1 && hold !== -1 && redirect !== -1, 'anchor missing');
  assert.ok(digest < hold && hold < redirect, `order wrong: ${digest} ${hold} ${redirect}`);
});

test('work-record.md names the planning hold', () => {
  pinned(workRecord(), [
    f('`Held-by: specify-planning` line'),
    f('read by `bin/planning-hold.js`'),
  ], 'work-record');
});

test('Ruling 2: {hold-file} is the session-tmp path for specify-hold-{n}.json', () => {
  pinned(caseOne(), [
    f('`{hold-file}` is the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-hold-{n}.json` prints'),
  ], 'hold-file path');
});

test('Ruling 3: a held verdict skips the needs:definition redirect', () => {
  pinned(caseOne(), [
    f('the `needs:definition` redirect below is skipped'),
  ], 'held skips redirect');
});

// ---- The answer path: plugin/skills/specify/planning-answer.md (Task 4) ----

const { sectionOf } = require('./helpers/conformance-asserts');
const { readPlanningHold } = require('../plugin/bin/lib/issues/planning-hold');

const answer = () => readText(path.join(ROOT, 'plugin/skills/specify/planning-answer.md'));
const planning = () => readText(path.join(ROOT, 'plugin/skills/specify/planning.md'));
const sec = (heading) => sectionOf(answer(), heading);

// Ordered markers: each must exist, and each first occurrence must follow the previous one.
function requireOrder(region, markers) {
  let last = -1;
  let prev = null;
  for (const m of markers) {
    const at = region.indexOf(m);
    if (at === -1) throw new Error(`marker missing: ${m}`);
    if (at < last) throw new Error(`${m} must come after ${prev}`);
    last = at;
    prev = m;
  }
}

// Move `later`'s first occurrence to just before `earlier`'s first occurrence.
function moveBefore(region, later, earlier) {
  const from = region.indexOf(later);
  const without = region.slice(0, from) + region.slice(from + later.length);
  const to = without.indexOf(earlier);
  return without.slice(0, to) + later + without.slice(to);
}

function provenOrder(region, markers) {
  requireOrder(region, markers);
  for (let i = 1; i < markers.length; i++) {
    const swapped = moveBefore(region, markers[i], markers[i - 1]);
    assert.notEqual(swapped, region);
    assert.throws(() => requireOrder(swapped, markers), { message: `${markers[i]} must come after ${markers[i - 1]}` });
  }
  for (const m of markers) {
    const absent = region.replace(m, '');
    assert.notEqual(absent, region);
    assert.throws(() => requireOrder(absent, markers), { message: `marker missing: ${m}` });
  }
}

test('AC1.1: the answer path asks only the held questions and ends ready, needs:decision removed, comment resolved, Plan: hash matching the body', () => {
  pinned(sec('## Ask'), [
    f('Ask only the questions `{hold-file}` holds'),
    f('one batch table with columns `Question`, `Recommended reading`'),
    f('per `planning.md`\'s **Asking.**'),
    f('replacing a lone `No planning questions arose.` line'),
  ], 'ask');
  pinned(sec('## Read-back and outcome'), [
    f('`gh issue view {n} --json labels,body,comments > "{readback-file}"` (`--value specify-answer-readback-{n}.json`'),
    f('`ready` present and `needs:decision` absent'),
    f('the answered hold comment carries `**Resolved:**`, as does each `supersededHolds` comment (`{hold-fresh}`\'s on the `## Write` path, `{hold-file}`\'s on the kept branch and after `## Re-hold`)'),
    f('the body has exactly one `Plan:` line equal to the printed `line`'),
    f('against the re-fetched body and `{base}` prints `{"valid": true}`'),
    f('`answered — {k} planning question(s), ready (Plan: {short commit})`'),
    f('ready` outcome, recommend `/claude-tweaks:flow #{n}`'),
  ], 'read-back');
});

test('L15: the ready bullet uses the bare imperative like its siblings', () => {
  const region = sec('## Read-back and outcome');
  const problems = (r) => r.split('\n').filter((l) => l.startsWith('- **') && l.includes('Next Actions recommends')).map(() => 'third person');
  assert.equal(region.split('\n').filter((l) => l.startsWith('- **`ready`:**')).length, 1);
  assert.deepEqual(problems(region), []);
  const mutated = region.replace('outcome, recommend `/claude-tweaks:flow', 'outcome, Next Actions recommends `/claude-tweaks:flow');
  assert.notEqual(mutated, region);
  assert.deepEqual(problems(mutated), ['third person']);
});

test('I1: a re-run skips a held question the body already answers, and writes no second line', () => {
  pinned(sec('## Ask'), [
    f('skip each one `{body}` already answers with a `Decided by the user at planning: {question} — chose` line'),
    f('None left to ask (zero questions, or every one already answered): ask nothing and go to `## Kept plan`'),
  ], 'already answered');
});

test('L14 + I1: with no answer given in this run and a valid kept plan, the amend and change test are skipped', () => {
  pinned(sec('## Kept plan'), [
    f('With no answer given in this run, skip `## Amend and change test` and go on with `{plan}` as read (`## Write`, or `## Re-hold` after a `Leave for later`)'),
  ], 'no-answer skip');
  pinned(sec('## Amend and change test'), [
    f('one row per answer given in this run'),
  ], 'this-run rows');
  // The skip sits on the valid branch: it comes after the valid verdict and before the re-plan sentence.
  const region = sec('## Kept plan');
  provenOrder(region, ['`{"valid": true}` →', 'With no answer given in this run', 'A missing line, any other verdict or exit, or a failed read re-plans']);
});

test('M1: the answer resolves superseded specify holds with the newest', () => {
  pinned(sec('## Write'), [
    f('to the hold comment `comment.id` names and to each `supersededHolds` comment'),
  ], 'write superseded');
  pinned(sec('## Re-hold'), [
    f('to the old hold comment and to each `supersededHolds` comment'),
  ], 're-hold superseded');
});

test('M2: the label decision uses a fresh planning-hold.js read taken just before (c)', () => {
  const region = sec('## Write');
  pinned(region, [
    f('re-fetch the comments to `{comments-file}` and re-run `planning-hold.js` on it to `{hold-fresh}` (`--value specify-answer-hold-fresh-{n}.json`), never over `{hold-file}`, as `SKILL.md`\'s case 1 routing does'),
    f('take `otherUnresolved` and `supersededHolds` from that fresh line'),
    f('is the kept branch: it counts as `otherUnresolved` above 0, resolves `{hold-file}`\'s `supersededHolds`, and its outcome is `answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)`'),
  ], 'fresh read');
  provenOrder(region, ['--body-file "{body}"', 'and re-run `planning-hold.js`', '**Resolved:** answered via']);
});

// R1: the fresh re-run never overwrites the routing-time {hold-file}, which the kept branch, Re-hold (d) and the read-back still read.
const overwritesHoldFile = (region) => /planning-hold\.js`[^.;]*? to `\{hold-file\}`/.test(region);
test('R1: the fresh planning-hold.js re-run writes its own path, never {hold-file}', () => {
  const region = sec('## Write');
  assert.equal(overwritesHoldFile(region), false);
  const mutated = region.replace('on it to `{hold-fresh}`', 'on it to `{hold-file}`');
  assert.notEqual(mutated, region);
  assert.equal(overwritesHoldFile(mutated), true);
});

// L11: every forge call in the write, re-hold and read-back paths names its gh-absent transport.
const bulletOf = (region, label) => {
  const lines = region.split('\n').filter((l) => l.startsWith(`- **${label}`));
  assert.equal(lines.length, 1, `bullet ${label}`);
  return lines[0];
};
test('L11: each write and the read-back fetch cite _shared/github-write-transport.md', () => {
  const write = sec('## Write');
  const rehold = sec('## Re-hold');
  const T = 'per `_shared/github-write-transport.md`';
  pinned(bulletOf(write, '(b)'), [f(`\`issue_write\` (update mode) ${T}`)], 'write b');
  pinned(bulletOf(write, '(c)'), [
    f(`\`issue_write\` (update mode, the complete label array) ${T}`),
    f('`_shared/github-write-transport.md` maps no MCP call for the comment edit: with `gh` absent it fails, and the label stays'),
  ], 'write c');
  pinned(bulletOf(write, '(d)'), [f(`\`issue_write\` (update mode, the complete label array) ${T}`)], 'write d');
  pinned(bulletOf(rehold, '(b)'), [f(`\`issue_write\` (update mode) ${T}`)], 're-hold b');
  pinned(bulletOf(rehold, '(c)'), [f(`\`add_issue_comment\` ${T}`)], 're-hold c');
  pinned(bulletOf(rehold, '(d)'), [f('as `## Write` (c) edits it')], 're-hold d');
  pinned(sec('## Read-back and outcome'), [f(`gh absent, ${T}, write \`issue_read\` \`get_comments\`\'s array to \`{readback-file}\` and \`get\`\'s \`body\` to \`{readback-body}\` and its \`labels\` to \`{readback-labels}\` (\`--value specify-answer-readback-labels-{n}.json\`), each with the Write tool`)], 'read-back');
});

test('review: gh absent writes nothing, and a hold with no question re-plans', () => {
  pinned(sec('## Inputs'), [
    f('With `gh` absent, write nothing and stop here'),
    f('The outcome is `held — answering needs gh (no MCP mapping for the hold-comment edit)`'),
  ], 'gh-absent refusal');
  pinned(sec('## Kept plan'), [f('A `{hold-file}` holding no question re-plans whatever the check prints')], 'empty hold re-plans');
});

test('L13: the read-back names a session-tmp path for every file it passes', () => {
  // {readback-file}'s path is pinned with the fetch in AC1.1's read-back pattern.
  pinned(sec('## Read-back and outcome'), [
    f('`planning-hold.js --comments-file "{readback-file}"`'),
    f('`{readback-body}` (`--value specify-answer-readback-body-{n}.md`)'),
    f('the printed `line` to `{plan-line-file}`'),
    f('plan-store.js check --line-file "{plan-line-file}" --spec-file "{readback-body}" --base {base}'),
  ], 'read-back paths');
});

test('AC2.1: no plan review runs unless --surface-diff reports a change', () => {
  pinned(sec('## Amend and change test'), [
    f('--surface-diff "{plan-before}" --spec "{body}"'),
    f('the printed `surfaceDiff.changed` field'),
    f('`changed: false` → no plan review'),
    f('The planner\'s report never decides whether review runs'),
  ], 'change test');
});

test('D6: an answer that changes the surface re-runs review', () => {
  pinned(sec('## Amend and change test'), [
    f('`changed: true`, a non-zero exit or no JSON line'),
    f('steps 5-7'),
  ], 'surface change');
});

test('D8: a missing or stale kept plan re-plans with the decided lines binding it', () => {
  pinned(sec('## Kept plan'), [
    f('--spec-file "{held-body}" --base {base}'),
    f('A missing line, any other verdict or exit, or a failed read re-plans'),
    f('whose decided lines bind the planner, so plan review runs'),
  ], 'kept plan');
  pinned(sec('## Inputs'), [
    f('none, or more than one, counts as missing'),
  ], 'kept line');
});

test('D10: writes run plan, body, comment+label, ready in that order', () => {
  const region = sec('## Write');
  provenOrder(region, ['plan-store.js" write', '--body-file "{body}"', '**Resolved:** answered via', '--remove-label "needs:decision"', '--add-label ready']);
  pinned(region, [
    f('Any non-zero exit stops: there is no no-ref fallback here'),
    f('Fail closed: a failed comment edit never removes the label'),
    f('Only when the label was removed'),
  ], 'write');
});

// Fix round 4: a failure before (c) resolved the hold says re-run; one after it points at the by-hand guidance.
const RERUN = '; re-run /claude-tweaks:specify #{n}`';
const BYHAND = '; check the decision comments and remove needs:decision by hand once none is unresolved`';
const swapStrings = (region) => region.split(RERUN).join('\u0000').split(BYHAND).join(RERUN).split('\u0000').join(BYHAND);
function failureStrings(region, patterns, label) {
  pinned(region, patterns, label);
  // Placement: each string is bound to its own qualifier, so swapping them breaks every pattern.
  const swapped = swapStrings(region);
  assert.notEqual(swapped, region);
  assert.deepEqual(missingFactsOf(patterns)(swapped), patterns.map(([, fact]) => fact));
}

test('Fix round 4: Write stops before (c) resolved the hold say re-run; stops after it say by hand', () => {
  const region = sec('## Write');
  failureStrings(region, [
    f('A stop before (c) resolved the hold comment renders `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`'),
    f('A stop after it (a later (c) edit, the label removal or (d)) renders `failed — {step} ({reason}); check the decision comments and remove needs:decision by hand once none is unresolved`'),
  ], 'write failures');
  assert.equal(region.split(RERUN).length - 1, 1, 'Write names the re-run string once');
});

test('Fix round 4: Re-hold stops always say re-run; the read-back keys its string on the branch', () => {
  pinned(sec('## Re-hold'), [
    f('stopping at the first failure with `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`'),
    f('the fresh hold is posted before (d) resolves the old one, so a re-run reads `held`'),
  ], 're-hold failures');
  assert.equal(sec('## Re-hold').split(BYHAND).length - 1, 0, 'Re-hold never names the by-hand string');
  failureStrings(sec('## Read-back and outcome'), [
    f('after `## Re-hold`, `failed — read-back ({what}); re-run /claude-tweaks:specify #{n}`'),
    f('after `## Write`, which resolved the hold comment, `failed — read-back ({what}); check the decision comments and remove needs:decision by hand once none is unresolved`'),
  ], 'read-back failures');
});

test('Review Focus 3: another unit\'s open decision comment keeps needs:decision and withholds ready', () => {
  pinned(sec('## Write'), [
    f('only when `otherUnresolved` is 0'),
    f('`answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`'),
    f('`_shared/work-record.md`\'s Resolution rule'),
  ], 'other unresolved');
});

test('Review Focus 2: Leave for later keeps answers and re-holds the rest', () => {
  pinned(sec('## Ask'), [
    f('with no question answered in this run or in `{body}`, write nothing at all'),
    f('`held — {k} planning question(s) still open`'),
    f('With some answered, in this run or in `{body}`, `## Kept plan` and `## Amend and change test` run on this run\'s answers and the record takes `## Re-hold` with the rest, so a failed re-hold is retried'),
  ], 'leave for later');
  pinned(sec('## Amend and change test'), [
    f('never `planning.md`\'s `## Hold`'),
  ], 'never hold');
  const region = sec('## Re-hold');
  provenOrder(region, ['plan-store.js" write', '--body-file "{body}"', 'gh issue comment {n} --body-file', 're-held via /claude-tweaks:specify']);
  pinned(region, [
    f('its block holding only the unanswered questions'),
    f('Posting before resolving keeps a newest unresolved planning hold on the record whichever call fails'),
    f('`held — {j} answered, {k} re-held`'),
  ], 're-hold');
});

test('writer-reader: planning.md\'s hold template parses as held through planning-hold.js', () => {
  // sectionOf would stop at the template's own `## Decision needed` line, so slice to the schema heading.
  const text = planning();
  const from = text.indexOf('\n## Hold\n');
  const to = text.indexOf('\n### Held-questions schema\n');
  assert.ok(from !== -1 && to > from, 'Hold section anchors not found');
  const m = text.slice(from, to).match(/```\n([\s\S]*?)```/);
  assert.ok(m, 'hold template fence not found');
  const fill = (t) => t
    .replace('{Q1: recommended reading; Q2: recommended reading; …}', 'Q1: keep the flag')
    .replace('{k}', '1').replace('{n}', '42')
    .replace('{question text}', 'Should the flag stay?')
    .replace(/\{recommended reading\}/g, 'keep the flag')
    .replace('{other reading}', 'drop the flag');
  const body = fill(m[1]);
  assert.ok(!/[{}]/.test(body), `placeholder survived: ${body}`);
  const comment = (b) => [{ id: 'IC_1', url: 'u', body: b, authorAssociation: 'OWNER', createdAt: '2026-11-22T00:00:00Z' }];
  const held = readPlanningHold(comment(body));
  assert.equal(held.verdict, 'held');
  assert.deepEqual(held.questions, [{ question: 'Should the flag stay?', options: ['keep the flag', 'drop the flag'], recommended: 'keep the flag' }]);
  const noHeldBy = body.replace('Held-by: specify-planning\n', '');
  assert.notEqual(noHeldBy, body);
  assert.equal(readPlanningHold(comment(noHeldBy)).reason, 'not-planning');
});

// Fix round 1 (+ R2's kept branch): Next Actions splits four ways by outcome. Each bullet is found by its own label;
// the still-needs:decision bullet names the other comments and recommends no command.
const NA_FLOW = '`/claude-tweaks:flow #{n}`';
const NA_SPECIFY = '`/claude-tweaks:specify #{n}`';
const KEPT_OUTCOME = '`answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)`';
const KEPT_HAND = 'check the record\'s decision comments and remove `needs:decision` by hand once none is unresolved';
const FAILED_BEFORE = 'or a `failed — …` one ending `; re-run /claude-tweaks:specify #{n}`';
const FAILED_AFTER = 'or a `failed — …` one ending `; check the decision comments and remove needs:decision by hand once none is unresolved`';
const KEPT_WHY = 'because a re-run would shape the record and resolve another unit\'s comment unanswered';
function nextActionsProblems(region) {
  const bullet = (label) => region.split('\n').filter((l) => l.startsWith(`- **${label}:**`));
  const problems = [];
  const one = (label) => {
    const b = bullet(label);
    if (b.length !== 1) { problems.push(`bullet count: ${label}`); return ''; }
    return b[0];
  };
  const ready = one('`ready`');
  const still = one('Still needs:decision');
  const held = one('Held or failed');
  const kept = one('Kept needs:decision');
  if (kept && !kept.includes(KEPT_OUTCOME)) problems.push('kept: outcome');
  if (kept && !kept.includes(KEPT_HAND)) problems.push('kept: by hand');
  if (kept && !kept.includes(KEPT_WHY)) problems.push('kept: why');
  if (kept && !kept.includes(FAILED_AFTER)) problems.push('kept: failed after (c)');
  if (held.includes(FAILED_AFTER) || kept.includes(FAILED_BEFORE)) problems.push('failed: crossed');
  if (kept.includes(NA_SPECIFY) || kept.includes(NA_FLOW)) problems.push('kept: recommends a command');
  if (ready && !(ready.includes('the `answered — …, ready` outcome') && ready.includes(NA_FLOW))) problems.push('ready: flow');
  if (ready.includes(NA_SPECIFY)) problems.push('ready: specify');
  if (still && !still.includes('`answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`')) problems.push('still: outcome');
  if (still && !still.includes('its URL and its `<!-- needs-decision: {unit} -->` unit, for its owner to resolve')) problems.push('still: names comments');
  if (still && !still.includes('unresolved trusted decision comments other than those just resolved')) problems.push('still: source');
  if (still && !still.includes('recommend neither `/claude-tweaks:specify` nor `/claude-tweaks:flow`')) problems.push('still: neither');
  if (still.includes(NA_SPECIFY) || still.includes(NA_FLOW)) problems.push('still: recommends a command');
  if (held && !(held.includes('after a `held — …` outcome') && held.includes(FAILED_BEFORE) && held.includes(NA_SPECIFY))) problems.push('held: specify');
  if (held.includes(NA_FLOW)) problems.push('held: flow');
  return problems;
}

test('Fix round 1: Next Actions splits ready → flow, still needs:decision → name the comments, held/failed → specify', () => {
  const region = sec('## Read-back and outcome');
  assert.deepEqual(nextActionsProblems(region), []);
  const lineOf = (label) => region.split('\n').find((l) => l.startsWith(`- **${label}:**`));
  const still = lineOf('Still needs:decision');
  const held = lineOf('Held or failed');
  const ready = lineOf('`ready`');
  const red = (mutated, expected) => {
    assert.notEqual(mutated, region);
    assert.deepEqual(nextActionsProblems(mutated), [expected]);
  };
  red(region.replace(still, `${still} Then run ${NA_SPECIFY}.`), 'still: recommends a command');
  red(region.replace(still, `${still} Then run ${NA_FLOW}.`), 'still: recommends a command');
  red(region.replace('recommend neither `/claude-tweaks:specify` nor `/claude-tweaks:flow`', 'recommend nothing'), 'still: neither');
  red(region.replace('its URL and its `<!-- needs-decision: {unit} -->` unit, for its owner to resolve', 'for review'), 'still: names comments');
  red(region.replace('unresolved trusted decision comments other than those just resolved', 'all comments'), 'still: source');
  red(region.replace(held, `${held} Or ${NA_FLOW}.`), 'held: flow');
  red(region.replace(held, held.replace(NA_SPECIFY, 'nothing')), 'held: specify');
  red(region.replace(ready, `${ready} Or ${NA_SPECIFY}.`), 'ready: specify');
  red(region.replace(ready, ready.replace(NA_FLOW, 'nothing')), 'ready: flow');
  red(region.replace(still, ''), 'bullet count: Still needs:decision');
  const kept = lineOf('Kept needs:decision');
  red(region.replace(kept, `${kept} Then run ${NA_SPECIFY}.`), 'kept: recommends a command');
  red(region.replace(kept, `${kept} Then run ${NA_FLOW}.`), 'kept: recommends a command');
  red(region.replace(KEPT_OUTCOME, '`answered`'), 'kept: outcome');
  red(region.replace(KEPT_HAND, 'look at it'), 'kept: by hand');
  red(region.replace(KEPT_WHY, 'because'), 'kept: why');
  red(region.replace(kept, ''), 'bullet count: Kept needs:decision');
  // O3: an unqualified failed outcome in the held bullet would send a post-(c) failure back to /specify.
  red(region.replace(FAILED_BEFORE, 'or a `failed — …` one'), 'held: specify');
  red(region.replace(FAILED_AFTER, 'a failure'), 'kept: failed after (c)');
  red(region.replace(held, `${held} Or a ${FAILED_AFTER}.`), 'failed: crossed');
});

const ANSWER_HEADS = ['## Inputs', '## Ask', '## Kept plan', '## Amend and change test', '## Write', '## Re-hold', '## Read-back and outcome'];

test('planning-answer.md headings appear in order', () => {
  const text = answer();
  provenOrder(text, ANSWER_HEADS.map((h) => `\n${h}\n`));
});

test('planning-answer.md never restates the asked classes', () => {
  const text = answer();
  for (const t of ['**(a) Design-level.**', '**(b) Hard to undo.**', '**(c) Contradiction.**']) {
    assert.ok(!text.includes(t), `restates ${t}`);
  }
  // Control: the tokens are the ones _shared/planning-decisions.md really uses.
  const shared = readText(path.join(ROOT, 'plugin/skills/_shared/planning-decisions.md'));
  for (const t of ['**(a) Design-level.**', '**(b) Hard to undo.**', '**(c) Contradiction.**']) assert.ok(shared.includes(t), `control: ${t} absent from planning-decisions.md`);
});

test('planning.md\'s Re-running paragraph points at planning-answer.md', () => {
  const para = planning().split('\n\n').find((p) => p.startsWith('**Re-running.**'));
  assert.ok(para, '**Re-running.** paragraph not found');
  pinned(para, [
    f('is answered through `planning-answer.md`'),
    f('routed from `SKILL.md`\'s case 1'),
    f('a hold whose `needs:decision` label was removed by hand'),
  ], 're-running');
});
