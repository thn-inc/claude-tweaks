// tests/release-reviewed-tip-conformance.test.js — pins #4041: /release Step 5 merged whatever
// origin/{branch} held at merge time, so a commit that landed after Step 3's whole-branch review shipped
// unreviewed. Step 3 now records the reviewed tip in its marker line, and Step 5 compares origin/{branch}
// with it immediately before the merge, runs a delta review per move, and holds the release once the
// integration branch has moved more than the `release-tip-moves` policy key allows. Since #4152 the
// comparison itself is `bin/release-tip-check.js` (unit-tested under tests/bin-lib/release-tip/); this
// suite pins the key's schema row, the prose that invokes and
// routes on the CLI, and the log-line templates the CLI parses (twin pins), with go-red proofs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { movedLineRe, parseReleaseLog, advanceText } = require('../plugin/bin/lib/release-tip/check');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'plugin', 'skills', 'release');
const SKILL = path.join(RELEASE_DIR, 'SKILL.md');
const EXECUTE = path.join(RELEASE_DIR, 'execute.md');
const CONSOLE = path.join(RELEASE_DIR, 'console.md');
const BOOKKEEPING = path.join(RELEASE_DIR, 'bookkeeping.md');
const ROUTINE_TEMPLATE = path.join(RELEASE_DIR, 'routine-template.yml');
const AUTONOMY_CEILING = path.join(ROOT, 'plugin', 'skills', '_shared', 'autonomy-ceiling.md');
const POLICY_SCHEMA_DOC = path.join(ROOT, 'plugin', 'skills', '_shared', 'policy-schema.md');

test('release-tip-moves is an advanced merge-safety integer defaulting to 2', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'release-tip-moves');
  assert.ok(row, 'release-tip-moves missing from POLICY_KEYS');
  assert.equal(row.type, 'integer');
  assert.equal(row.default, 2);
  assert.equal(row.min, 0, '0 means "hold on the first move", so the floor is 0, not unset');
  assert.equal(row.category, 'merge-safety');
  assert.equal(row.tier, 'advanced');
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DELTA_MARKER = 'AUTO {HH:MM:SS} — Step 5: origin/{branch} moved {reviewed-short} → {tip-short} ({n} commits) before the merge — move {m} of {bound}; delta review starting, base {reviewed-tip}..{branch}; ## /review marker: {k} existing lines. Reversibility: n/a (marker). [lever: release-tip-moves={bound} ({source})]';

// The new block of execute.md, from its heading to the Merge heading.
function blockOf(executeText) {
  const start = executeText.indexOf('**Reviewed-tip comparison');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: execute.md has no "**Reviewed-tip comparison" block');
  const end = executeText.indexOf('**Merge.**', start);
  assert.notEqual(end, -1, 'extraction pattern is out of sync: execute.md has no "**Merge.**" paragraph after the block');
  return executeText.slice(start, end);
}

// [label, source, pattern]: each pattern must match exactly once in its source. `block` is the new
// execute.md block, `execute` the whole file, `skill`, `console`, `bookkeeping`, `schemaDoc`, `routine` (the
// firing contract) and `ceiling` (autonomy-ceiling.md) the whole files.
const FACTS = [
  ['skill', 'the Step 3 marker carries the unbraced `at reviewed tip {tip-sha};` and keeps the optional review-tree clause',
    /whole-branch review starting, base \{base\}\.\.\{branch\} at reviewed tip \{tip-sha\}; ## \/review marker: \{k\} existing lines\{; review tree HEAD \{head-sha\} is origin\/\{branch\} \{tip-sha\} plus run-dir-only commits\}\. Reversibility: n\/a \(marker\)\./],
  ['skill', '{tip-sha} is the sha the check\'s first call prints, resolved once before the trees are compared',
    /`\{tip-sha\}` is the full 40-hex sha that the check's first call prints: `origin\/\{branch\}` resolved once, before the trees are compared/],
  ['skill', 'Step 8 HELD names `integration branch kept moving`',
    /and `integration branch kept moving`, where/],
  ['console', 'console.md names the reviewed-tip comparison among the HELD stops',
    /the reviewed-tip comparison's two stops/],
  ['execute', 'the --as path advances the reviewed tip to the Release-As commit only when its parent is the reviewed tip',
    /the reviewed tip advances to the `Release-As:` commit only when `\{sha\}\^` equals the reviewed tip/],
  ['execute', 'the --as advance is logged',
    /Step 5: reviewed tip advanced to this run's Release-As commit \{short\} \(parent is the reviewed tip\); at reviewed tip \{sha\}\. Reversibility: n\/a\./],
  ['block', 'the block invokes release-tip-check.js with the run dir, $RUN_ROOT and the branch',
    /bin\/release-tip-check\.js" --run "\{run-dir\}" --root "\$RUN_ROOT" --branch \{branch\}/],
  ['block', 'the `merge` verdict is routed',
    /\n- `merge` → /],
  ['block', 'the `delta` verdict is routed',
    /\n- `delta` → /],
  ['block', 'the `held` verdict for `integration branch kept moving` is routed',
    /\n- `held`, reason `integration branch kept moving` → /],
  ['block', 'an arrived-commit major is checked first, before routing on any verdict but `failed`, whose reason is the one to act on',
    /First, unless the verdict is `failed` \(route that one first: its reason is the one to act on\), when `arrived\.part` is `major`, take delta 5's/],
  ['block', 'a major on a `held` verdict stages one release-held.md that also carries the bound step\'s content',
    /When the verdict is also `held`, the one `release-held\.md` that stages carries the bound step's content as well \(its `arrivedLog`, `\{m\}`, `\{bound\}` and the pause-merges recovery\)/],
  ['block', 'an interactive `Proceed` on the arrived major continues with the same verdict\'s routing',
    /Under `interactive`, a `Proceed` there continues with this same verdict's routing below/],
  ['block', 'the `failed` verdict is routed',
    /\n- `failed` → /],
  ['block', 'a `no reviewed tip recorded` stop names its recovery: a re-run records one at its own Step 3',
    /For reason `no reviewed tip recorded`, a re-run of `\/claude-tweaks:release` records one at its own Step 3/],
  ['block', 'a missing or unparseable verdict is `failed`',
    /A non-zero exit, or stdout that does not parse as one JSON object, is `failed`, reason `release-tip-check did not produce a verdict`, nothing merged/],
  ['block', 'the comparison reads the last recorded reviewed tip, never re-derived',
    /reads the reviewed tip from the last line[^\n]*`decisions\.md`[^\n]*`at reviewed tip`[^\n]*never re-derived/],
  ['block', 'the fold takes its pre-major flags from the pack, never from release-please-config.json',
    /`release-preflight\.json`'s `proposedVersion\.value`: `preMajor`, `bumpMinorPreMajor` and `bumpPatchForMinorPreMajor`, never re-read from `release-please-config\.json`/],
  ['block', 'an unmoved branch is logged and merges',
    /Step 5: origin\/\{branch\} still at reviewed tip \{short\}; merging\./],
  ['block', '`{m}`, `{bound}` and `{source}` are the verdict\'s `move`, `bound` and `source`',
    /`\{m\}`, `\{bound\}` and `\{source\}` in this block's log lines are the verdict's `move`, `bound` and `source`/],
  ['block', '`{reviewed-tip}` is the verdict\'s `reviewedTip` (run-dir-only advances included) and `{reviewed-short}` its short form',
    /`\{reviewed-tip\}` below is the verdict's `reviewedTip`, which already includes any run-dir-only advance the CLI logged, and `\{reviewed-short\}` is its 7-character short form/],
  ['block', 'the bound stop\'s STAGED line carries the release-tip-moves lever field',
    /move \{m\} exceeds release-tip-moves \{bound\}; release held\. Stage path: staged\/release-held\.md\. Reversibility: high\. \[lever: release-tip-moves=\{bound\} \(\{source\}\)\]/],
  ['block', 'past the bound the run is `HELD`, reason `integration branch kept moving`',
    /`HELD`, reason `integration branch kept moving`/],
  ['block', 'the bound stop stages release-held.md through stage-item.js',
    /stage-item\.js" --run "\{run-dir\}" --id release-held --file/],
  ['block', 'the bound stop stages the verdict\'s `arrivedLog`',
    /the bound and `\{m\}`, and the verdict's `arrivedLog`/],
  ['block', 'the bound stop suggests holding merges',
    /suggest[^\n]*holding merges/],
  ['block', 'the delta brings $RUN_ROOT to the tip with pull --rebase --no-autostash',
    /git -C "\$RUN_ROOT" pull --rebase --no-autostash origin \{branch\}/],
  ['block', 'Step 5 has its own failure line, `stopped before the merge: {reason}`, not Step 3\'s console-stage one',
    /Every failure in this step is `failed`, reported as `stopped before the merge: \{reason\}`\. Step 3's `stopped before the console` lines are not reused, because the console has already rendered/],
  ['block', 'the branch is asserted before the pull: anything but {branch} is `failed`, reports the current branch, prints no `switch` command, pulls nothing',
    /First assert the anchor is still on the integration branch: `git -C "\$RUN_ROOT" rev-parse --abbrev-ref HEAD` must equal `\{branch\}`\. Anything else is `failed`: report the current branch and stop, print no `switch` command, and pull nothing\. `\$RUN_ROOT` is the shared main checkout, and a sibling session owns its checkout state/],
  ['block', 'nothing outside run dirs may have changed locally since the reviewed tip, or nothing is pulled',
    /assert nothing outside run dirs changed locally since the reviewed tip: `git -C "\$RUN_ROOT" diff --quiet \{reviewed-tip\} HEAD -- ':!\.claude-tweaks\/pipelines'`\. Non-zero is `failed` and nothing is pulled, because a sibling's local shipped commits must not be rebased/],
  ['block', 'a rebase that refuses is `failed` with git\'s stderr verbatim',
    /A rebase that refuses is `failed` with git's stderr verbatim\./],
  ['block', 'a rebase that stops mid-way is aborted before `failed`, so the shared checkout is never left mid-rebase',
    /A rebase that stops mid-way on a conflict runs `git -C "\$RUN_ROOT" rebase --abort` first, then reports `failed` with git's stderr verbatim, so the shared checkout is never left mid-rebase/],
  ['block', 'the delta re-runs Step 3\'s review-tree check and a failure is `failed` under Step 5\'s prefix, without Step 3\'s `switch` recovery',
    /re-run SKILL\.md Step 3's review-tree check; any failure is `failed`, reported with Step 3's stop line and reason under this step's prefix and without its `switch` recovery/],
  ['block', '`{n}` is the verdict\'s `commits` while the re-run check\'s printed tip is the verdict\'s `tipSha`',
    /`\{n\}` is the verdict's `commits` when `\{tip-sha\}` equals the verdict's `tipSha`\./],
  ['block', 'a tip that moved past the verdict\'s is counted with `rev-list --count`, and a failing one is `failed`, stderr verbatim, nothing merged',
    /`\{n\}` is `git -C "\$RUN_ROOT" rev-list --count \{reviewed-tip\}\.\.\{tip-sha\}`; a non-zero exit from it is `failed`, stderr verbatim, nothing merged/],
  ['block', 'step 5 reads {tip-sha} as the sha the re-run check\'s first call printed, never a second rev-parse',
    /`\{tip-sha\}` is the sha that check's first call printed, never a second `rev-parse` of `origin\/\{branch\}`/],
  ['block', 'the new tip\'s test gate is the review\'s own Step 1.5',
    /the review's own Step 1\.5/],
  ['block', 'the delta marker line',
    new RegExp(escapeRe(DELTA_MARKER))],
  ['block', 'the delta invokes review base:{reviewed-tip} and classifies only the lines after its marker by Step 3\'s table',
    /`\/claude-tweaks:review base:\{reviewed-tip\}`[^\n]*classify only the lines[^\n]*Step 3's[^\n]*table/],
  ['block', 'a review that did not complete is a stop, not a pass',
    /`failed`, reason `delta review did not complete`/],
  ['block', 'a `review: blocking` delta routes to console.md\'s gate (unchanged rules) and then `HELD`',
    /`review: blocking`[^\n]*console\.md[^\n]*`--allow-blocking`[^\n]*`--train`[^\n]*`HELD`/],
  ['block', 'a clean or findings delta re-enters at the PR-check gate',
    /`review: clean` or `review: findings[^\n]*re-enter at the PR-check gate/],
  ['block', 'the remaining window is the merge call itself',
    /the remaining window is the merge call itself/],
  ['block', 'Step 8\'s HELD summary prints the arrived-commit list for the bound stop',
    /Step 8's HELD summary also prints that `arrivedLog`, the arrived commits, under its gate-and-staged-path line/],
  ['skill', 'SKILL.md Step 8 prints the arrived-commit list beneath the HELD staged-path line',
    /For `integration branch kept moving`, the list of arrived commits \(`execute\.md`'s bound step\) prints beneath that line/],
  ['block', 'every release-held.md the block composes carries the --as warning (the Release-As commit is already on {branch})',
    /Every `release-held\.md` this block composes carries one more line when `--as` was given: the `Release-As:` commit is already on `\{branch\}`, so re-run without pushing a second override/],
  ['block', 'the CLI is told to append `--as` when `--as` was given, which exempts the arrived-commit major (the Release-As override pins the shipped version)',
    /Append `--as` when `--as` was given: [^\n]*the shipped version is pinned by the `Release-As:` override, and Step 4's `--as` major gate measures the `--as` value, not commit parts/],
  ['block', 'the delta marker carries no `at reviewed tip` clause, with the reason',
    /The marker deliberately carries no `at reviewed tip` clause: the delta has not been reviewed yet/],
  ['block', 'the delta verdict line carries the optional `at reviewed tip {tip-sha}` clause',
    /Findings staged at \{paths\|none\}\{; at reviewed tip \{tip-sha\}\}\. Reversibility: n\/a \(gate evaluation\)\./],
  ['block', 'the verdict clause is written only for clean, findings or an overridden blocking verdict',
    /written only when the verdict is `clean`, `findings`, or an overridden `blocking`/],
  ['block', 'the re-entry runs again from the delta verdict line\'s `at reviewed tip`',
    /runs again from the delta verdict line's `at reviewed tip`/],
  ['block', 'the re-entry re-gates a major once per delta, never again for an earlier accepted delta',
    /On that re-entry, step 1 runs again: the CLI reads that line's tip and reports the arrived commits of the delta just reviewed, so step 2 re-gates a major once per delta, never again for an earlier delta already accepted/],
  ['block', 'a major from the arrived commits takes delta 5\'s HELD path with a reason naming the arrived commits',
    /delta 5's `re-rendered to a major after the console` HELD path, with the reason named `re-rendered to a major after the console — from the arrived commits \{shas\}, the release PR title still reads v\{title-version\}`/],
  ['skill', 'SKILL.md Step 5 summary mentions the reviewed-tip comparison',
    /it also compares `origin\/\{branch\}` with the tip Step 3 reviewed: a move runs a delta review, and more moves than `release-tip-moves` allows is `HELD`/],
  ['skill', 'SKILL.md Step 8 says the blocking delta re-fires the existing `review: blocking` gate',
    /re-fires the existing `review: blocking` gate on the delta range/],
  ['skill', 'SKILL.md Step 8 `failed` names an unreadable release-tip-moves',
    /an unreadable `release-tip-moves`/],
  ['skill', 'SKILL.md Step 8 `failed` names a failed git read of the arrived commits',
    /a failed git read of the arrived commits/],
  ['skill', 'the --train row says Step 5\'s no-merge stops also stage release-held.md and exit `HELD`',
    /exit `HELD`; so do Step 5's no-merge stops\. Refused unless/],
  ['skill', 'the --train semantics heading says Step 5\'s no-merge stops end it the same way',
    /Step 5's no-merge stops end it the same way\.\*\*/],
  ['skill', '`HELD` asserts a Step 4 HARD-GATE or a Step 5 no-merge stop fired and nothing merged or tagged',
    /a HARD-GATE at Step 4 or a no-merge stop at Step 5 fired, and nothing was merged or tagged/],
  ['routine', 'the Routine firing contract names the blocking delta review as a Step 5 HELD stop',
    /blocking delta review of commits that reached the integration branch after Step 3 reviewed it,/],
  ['routine', 'the Routine firing contract names `integration branch kept moving` with its recovery (pause merges or raise the bound)',
    /`integration branch kept moving` \(more moves than `release-tip-moves` allows\), whose recovery/],
  ['ceiling', 'autonomy-ceiling.md\'s `train` row names the Step 5 stops, with the pause-merges-or-raise-the-bound recovery',
    /Step 5's `integration branch kept moving` stop is the same `HELD`, but its recovery is to pause merges or raise `release-tip-moves`/],
  ['console', 'console.md says the merge never happens (not that Step 5 never runs) under HELD',
    /The merge never happens and Step 8's summary reads `HELD`\./],
  ['bookkeeping', 'bookkeeping.md defines the HELD no-Step-6/7 rule over every no-merge stop',
    /or one of Step 5's stops that merge nothing/],
  ['schemaDoc', 'the policy-schema.md row states the 0 floor',
    /Floor `0`: it holds on the first move\./],
];

function sources() {
  const execute = readText(EXECUTE);
  return {
    skill: readText(SKILL), console: readText(CONSOLE), bookkeeping: readText(BOOKKEEPING), schemaDoc: readText(POLICY_SCHEMA_DOC),
    routine: readText(ROUTINE_TEMPLATE), ceiling: readText(AUTONOMY_CEILING), execute, block: blockOf(execute),
  };
}

function missingFacts(srcs) {
  return FACTS.filter(([source, , pattern]) => !pattern.test(srcs[source])).map(([, fact]) => fact);
}

test('AC2.1/AC3.1: every reviewed-tip prose fact is present exactly once', () => {
  const srcs = sources();
  assert.deepEqual(missingFacts(srcs), [], 'release prose must state every reviewed-tip fact');
  for (const [source, fact, pattern] of FACTS) {
    const count = (srcs[source].match(new RegExp(pattern.source, 'g')) || []).length;
    assert.equal(count, 1, `"${fact}" must match exactly once in ${source}, matched ${count}`);
  }
});

test('AC2.1/AC3.1: each reviewed-tip prose fact can actually go red on its own (discrimination proof)', () => {
  const srcs = sources();
  for (const [source, fact, pattern] of FACTS) {
    const doctored = srcs[source].replace(pattern, '');
    assert.notEqual(doctored, srcs[source], `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.ok(!pattern.test(doctored), `removing "${fact}" must turn its own assertion red`);
  }
});

// Phrases of the hand-run state machine the CLI replaced (#4152): a fetch-and-compare fence, the
// any-short move count, the exit classification, the bound read and the arrived-commit part derivation.
const STATE_MACHINE_PHRASES = [
  'fetch --quiet',
  '{any-short}',
  'Classify the exit',
  'that carry `origin/{branch} moved',
  'resolve-policy.js" --run "{run-dir}" release-tip-moves',
  'conventional-commit part',
];

function stateMachinePhrases(block) {
  return STATE_MACHINE_PHRASES.filter((phrase) => block.includes(phrase));
}

test('AC1: no hand-run state machine remains in the block', () => {
  const block = blockOf(readText(EXECUTE));
  assert.deepEqual(stateMachinePhrases(block), [], 'the block must route on release-tip-check.js, not re-run its state machine');
  for (const phrase of STATE_MACHINE_PHRASES) {
    assert.deepEqual(stateMachinePhrases(`${block}\n${phrase}\n`), [phrase], `go-red: re-adding "${phrase}" must be caught`);
  }
});

// Phrases that claimed the gh-absent stop was the only, or the third, non-Step-4 HELD reason, or that HELD
// is a Step-4-only word. Once delta 5's major re-render and the reviewed-tip stops exist, they are false.
const STALE_HELD_PHRASES = [
  ['execute', 'the one `HELD` that is not a Step 4 HARD-GATE'],
  ['execute', 'names it as the third reason for the word'],
  ['skill', 'A third reason carries the same word'],
  ['skill', 'A fourth, `integration branch kept moving`'],
  ['skill', 'beside those two HARD-GATEs'],
  ['console', 'the only other `HELD` reason'],
  ['console', 'Step 5 never runs and Step 8\'s summary reads'],
  ['bookkeeping', 'A HARD-GATE fires at Step 4, before Step 5 ever runs'],
  ['skill', 'stage `release-held.md` in the run directory before Step 5 and exit `HELD`. Refused unless'],
  ['skill', '**Two HARD-GATEs stop it before Step 5.**'],
  ['skill', 'a HARD-GATE fired at Step 4 before Step 5, and nothing was merged or tagged'],
];

function staleHeldPhrases(srcs) {
  return STALE_HELD_PHRASES.filter(([source, phrase]) => srcs[source].includes(phrase)).map(([, phrase]) => phrase);
}

test('no stale ordinal or "the one HELD" claim survives in execute.md, SKILL.md, console.md or bookkeeping.md', () => {
  const srcs = sources();
  assert.deepEqual(staleHeldPhrases(srcs), [], 'a stale HELD-reason phrase is still present');
  for (const [source, phrase] of STALE_HELD_PHRASES) {
    const reintroduced = { ...srcs, [source]: `${srcs[source]}\n${phrase}\n` };
    assert.deepEqual(staleHeldPhrases(reintroduced), [phrase], `go-red: re-adding "${phrase}" must be caught by the check`);
  }
});

// The four Step 5 stops that merge nothing, as Step 8's HELD bullet must name them.
const STEP5_HELD_REASONS = [
  ['gh-absent Transport stop', /pr-first with no `gh` on `PATH`/],
  ['delta 5 major re-render', /delta 5's re-render to a major/],
  ['blocking delta review', /a `review: blocking` delta review/],
  ['integration branch kept moving', /`integration branch kept moving`/],
];

function missingHeldReasons(bullet) {
  return STEP5_HELD_REASONS.filter(([, pattern]) => !pattern.test(bullet)).map(([reason]) => reason);
}

test('SKILL.md Step 8 HELD bullet names every Step 5 HELD stop', () => {
  const m = readText(SKILL).match(/^- \*\*`HELD`\*\*[^\n]*$/m);
  assert.ok(m, 'extraction pattern is out of sync: no "- **`HELD`**" bullet in SKILL.md');
  const bullet = m[0];
  assert.deepEqual(missingHeldReasons(bullet), [], 'the HELD bullet must name all four Step 5 stops');
  for (const [reason, pattern] of STEP5_HELD_REASONS) {
    const doctored = bullet.replace(pattern, '');
    assert.notEqual(doctored, bullet, `anchor text for "${reason}" not found — proof cannot discriminate`);
    assert.deepEqual(missingHeldReasons(doctored), [reason], `removing only "${reason}" must turn exactly that assertion red`);
  }
});

// Phrases from before Step 3 and execute.md step 5 resolved the tip once: a second `rev-parse` after the check.
const STALE_TIP_PHRASES = [
  ['skill', 'rev-parse origin/{branch}`, read right after the check'],
  ['block', 'Read `{tip-sha}` as Step 3 does, right after the check passes'],
];

function staleTipPhrases(srcs) {
  return STALE_TIP_PHRASES.filter(([source, phrase]) => srcs[source].includes(phrase)).map(([, phrase]) => phrase);
}

test('no second rev-parse of origin/{branch} survives after the Step 3 check', () => {
  const srcs = sources();
  assert.deepEqual(staleTipPhrases(srcs), [], 'a second rev-parse of origin/{branch} after the check is still present');
  for (const [source, phrase] of STALE_TIP_PHRASES) {
    const reintroduced = { ...srcs, [source]: `${srcs[source]}\n${phrase}\n` };
    assert.deepEqual(staleTipPhrases(reintroduced), [phrase], `go-red: re-adding "${phrase}" must be caught by the check`);
  }
});

test('the Step 3 marker stays one line and its tip clause matches the sibling pin', () => {
  const lines = readText(SKILL).split('\n').filter((l) => l.includes('whole-branch review starting'));
  assert.equal(lines.length, 1, 'the Step 3 marker must be exactly one line');
  assert.ok(
    lines[0].includes('{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}'),
    'the marker line must keep the optional review-tree clause #4012 pins',
  );
});

test('placement: the comparison block sits after delta 5 and before Merge', () => {
  const text = readText(EXECUTE);
  const delta5 = text.indexOf('re-rendered to a major after the console');
  const block = text.indexOf('**Reviewed-tip comparison');
  const merge = text.indexOf('**Merge.**');
  assert.ok(delta5 !== -1 && block !== -1 && merge !== -1, 'placement anchors missing');
  assert.ok(delta5 < block, 'the comparison block must come after delta 5');
  assert.ok(block < merge, 'the comparison block must come before the Merge paragraph');
});

test('placement: the branch and local-change assertions precede the pull', () => {
  const block = blockOf(readText(EXECUTE));
  const at = (s) => {
    const i = block.indexOf(s);
    assert.notEqual(i, -1, `placement anchor missing: ${s}`);
    return i;
  };
  assert.ok(at('rev-parse --abbrev-ref HEAD` must equal `{branch}`') < at('pull --rebase --no-autostash origin {branch}'), 'the branch assertion must precede the pull');
  assert.ok(at("diff --quiet {reviewed-tip} HEAD -- ':!.claude-tweaks/pipelines'") < at('pull --rebase --no-autostash origin {branch}'), 'the local-change assertion must precede the pull');
  assert.ok(at('rebase --abort') > at('pull --rebase --no-autostash origin {branch}'), 'the abort belongs to the pull');
});

test('Step 5 has no `stopped before the console` line: the console has rendered by then', () => {
  const stale = (block) => block.includes('stopped before the console');
  const block = blockOf(readText(EXECUTE));
  assert.ok(block.includes('stopped before the merge:'), 'anchor for Step 5\'s own prefix missing');
  assert.equal(stale(block.replace('Step 3\'s `stopped before the console` lines are not reused', '')), false, 'the only mention is the sentence that rules it out');
  assert.equal(stale(`${block}\nstopped before the console: review tree is not origin/main\n`), true, 'go-red: a reused Step 3 stop line must be caught');
});

test('Step 5 prints no `switch` command: a sibling session owns the shared checkout state', () => {
  const step3 = blockOf(readText(EXECUTE)).split('**3. Bring the checkout to the tip.**')[1].split('**4. Delta review.**')[0];
  const switchCommands = (text) => text.match(/git -C "\$RUN_ROOT" switch/g) || [];
  assert.deepEqual(switchCommands(step3), [], 'Step 5 must not print a switch command');
  assert.equal(switchCommands(`${step3}\ngit -C "$RUN_ROOT" switch main\n`).length, 1, 'go-red: a printed switch command must be caught');
});

// The delta marker is written before the delta review has run, so it must not carry `at reviewed tip`.
function deltaMarkerLine(block) {
  const lines = block.split('\n').filter((l) => /^AUTO \{HH:MM:SS\}/.test(l) && l.includes('delta review starting'));
  assert.equal(lines.length, 1, `exactly one delta marker line expected, found ${lines.length}`);
  return lines[0];
}

// The one log-line template in the block that starts with `prefix`.
function templateLine(block, prefix) {
  const lines = block.split('\n').filter((l) => l.startsWith(prefix));
  assert.equal(lines.length, 1, `extraction pattern is out of sync: expected one "${prefix}" line, found ${lines.length}`);
  return lines[0];
}

test('A8: the delta marker carries no `at reviewed tip` clause; the clause moves to the delta verdict line', () => {
  const block = blockOf(readText(EXECUTE));
  const marker = deltaMarkerLine(block);
  assert.ok(marker.includes('origin/{branch} moved {reviewed-short} → {tip-short}'), 'the marker keeps the counted form');
  assert.ok(!marker.includes('at reviewed tip'), 'the marker must not carry the clause');
  const drifted = block.replace(marker, marker.replace('Reversibility:', 'at reviewed tip {tip-sha}; Reversibility:'));
  assert.notEqual(drifted, block, 'go-red anchor not found');
  assert.ok(deltaMarkerLine(drifted).includes('at reviewed tip'), 'go-red: a clause on the marker must be caught');
  const verdict = block.split('\n').find((l) => l.startsWith('AUTO {HH:MM:SS} — Step 5: delta review base'));
  assert.ok(verdict && verdict.includes('{; at reviewed tip {tip-sha}}'), 'the verdict line carries the optional clause');
});

test('A12: the decisions that consulted release-tip-moves carry the lever field, and no other line in the block does', () => {
  const block = blockOf(readText(EXECUTE));
  const withLever = (b) => b.split('\n').filter((l) => /^(AUTO|STAGED) \{HH:MM:SS\}/.test(l) && l.includes('[lever: '));
  const lines = withLever(block);
  assert.equal(lines.length, 2, `expected the STAGED bound line and the delta marker, found ${lines.length}`);
  for (const line of lines) assert.ok(line.endsWith('[lever: release-tip-moves={bound} ({source})]'), `lever field must be the last element: ${line}`);
  const bare = block.replace(' [lever: release-tip-moves={bound} ({source})]', '');
  assert.equal(withLever(bare).length, 1, 'go-red: dropping one lever field must be caught');
});

// Twin pins (prose template ↔ CLI regex): the CLI parses the lines the prose tells the agent to write.
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

// A template line rendered with the given placeholder values, its `{; …}` optional clauses written out.
function render(template, values) {
  let line = template;
  for (const [key, value] of Object.entries(values)) line = line.split(`{${key}}`).join(value);
  return line.replace(/\{(; [^{}]*)\}/g, '$1');
}

const markerValues = { branch: 'main', 'reviewed-short': 'aaaaaaa', 'tip-short': 'bbbbbbb' };

test('twin pin: the delta marker template is what the CLI counts', () => {
  const block = blockOf(readText(EXECUTE));
  const moved = movedLineRe('main');
  const marker = render(deltaMarkerLine(block), markerValues);
  assert.ok(moved.test(marker), `movedLineRe('main') must count the rendered delta marker: ${marker}`);
  const staged = render(templateLine(block, 'STAGED {HH:MM:SS} — Step 5: origin/{branch} moved past'), { branch: 'main' });
  assert.ok(!moved.test(staged), `the STAGED bound line must not count as a move: ${staged}`);
  const advance = advanceText({ branch: 'main', from: SHA_A, to: SHA_B, commits: 1 });
  assert.ok(!moved.test(advance), `the CLI's run-dir-only advance line must not count as a move: ${advance}`);
  // go-red: a marker whose wording drifts from the counted form is no longer counted
  assert.ok(!moved.test(marker.replace(' moved ', ' moves ')), 'go-red: a drifted marker must stop matching');
});

test('twin pin: the delta verdict template carries the tip the CLI reads', () => {
  const block = blockOf(readText(EXECUTE));
  const step3 = readText(SKILL).split('\n').find((l) => l.includes('whole-branch review starting'));
  assert.ok(step3, 'extraction pattern is out of sync: no Step 3 marker in SKILL.md');
  const verdict = templateLine(block, 'AUTO {HH:MM:SS} — Step 5: delta review base');
  const log = [
    '## /release',
    render(step3, { base: 'v1.0.0', branch: 'main', 'tip-sha': SHA_A, 'head-sha': SHA_A }),
    render(verdict, { branch: 'main', 'reviewed-tip': SHA_A, 'tip-sha': SHA_B }),
  ];
  const parsed = parseReleaseLog(`${log.join('\n')}\n`, 'main');
  assert.equal(parsed.step3Tip, SHA_A, 'the Step 3 marker is the Step 3 tip');
  assert.equal(parsed.reviewedTip, SHA_B, 'the delta verdict line\'s {tip-sha} is the reviewed tip');
  assert.deepEqual(parsed.lastDelta, { base: SHA_A, tip: SHA_B }, 'the delta verdict line is the delta whose arrived commits the CLI folds');
  const marker = render(deltaMarkerLine(block), { ...markerValues, 'reviewed-tip': SHA_B, 'tip-sha': SHA_C });
  const after = parseReleaseLog(`${[...log, marker].join('\n')}\n`, 'main');
  assert.equal(after.reviewedTip, SHA_B, 'a delta marker after the verdict must not move the reviewed tip');
  assert.equal(after.step3Tip, SHA_A, 'a delta marker after the verdict must not move the Step 3 tip');
  // go-red: a verdict template without the clause leaves the Step 3 tip as the reviewed one
  const bare = render(verdict.replace('{; at reviewed tip {tip-sha}}', ''), { branch: 'main', 'reviewed-tip': SHA_A, 'tip-sha': SHA_B });
  const bareParsed = parseReleaseLog(`${[log[0], log[1], bare].join('\n')}\n`, 'main');
  assert.equal(bareParsed.reviewedTip, SHA_A, 'go-red: dropping the clause must lose the new tip');
  assert.equal(bareParsed.lastDelta, null, 'go-red: dropping the clause must lose the delta');
});
