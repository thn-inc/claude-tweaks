// tests/closing-links-prose-conformance.test.js — pins #4199: the pr-first merge procedures
// must run `bin/closing-links.js` (pre-merge unlink, post-merge reopen backstop) and the
// deferred-closure section must state the keyword neutralization. Reads live skill prose;
// each assertWiring has a go-red control run on the text with the added block sliced out.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SHARED = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
const read = (f) => readText(path.join(SHARED, f));

const PRE_MERGE = 'bin/closing-links.js" --run "{run-dir}" --mode pre-merge';
const PR_FIRST_OPEN = '<!-- when: integration-model=pr-first -->';

function assertRefreshWiring(text) {
  const at = text.indexOf(PRE_MERGE);
  assert.notEqual(at, -1, `pr-checklist-refresh.md lacks ${PRE_MERGE}`);
  const fixes = text.indexOf('rewrote Fixes block for PR #');
  const title = text.indexOf("3. Read the record's current title");
  assert.ok(fixes !== -1 && at > fixes, 'closing-links must run after the Fixes rewrite');
  assert.ok(title !== -1 && at < title, 'closing-links must run before step 3');
  const open = text.lastIndexOf('<!-- when:', at);
  assert.ok(open !== -1 && text.startsWith(PR_FIRST_OPEN, open), 'must sit in the pr-first fence');
  assert.equal(text.slice(open, at).includes('<!-- /when -->'), false, 'fence closed before the call');
}

function assertPostMergeWiring(text) {
  const step40 = text.indexOf('### Step 4.0');
  const mode = text.indexOf('--mode post-merge');
  const step41 = text.indexOf('### Step 4.1');
  assert.ok(step41 !== -1, 'Step 4.1 anchor missing');
  assert.ok(step40 !== -1 && step40 < step41, 'Step 4.0 must precede Step 4.1');
  assert.ok(mode !== -1 && mode < step41, '--mode post-merge must precede Step 4.1');
}

function assertLifecycleWiring(text) {
  assert.ok(text.includes('`composeFixesBlock` rewrites any closing-keyword phrase'));
  assert.ok(text.includes('probe PR #4234'));
}

// The squash message is the second closing channel: both Step 3 composer fences (the arm
// fence and the merge-verification-off degrade fence) must pass the kept-open records.
function assertKeepOpenWiring(text) {
  const start = text.indexOf('## Step 3:');
  assert.notEqual(start, -1, 'Step 3 heading present');
  const step3 = text.slice(start, text.indexOf('\n## ', start + 1));
  const fences = step3.split('\n').filter((l) => l.includes('bin/compose-subject.js"'));
  assert.equal(fences.length, 2, 'two composer fences in Step 3');
  for (const f of fences) assert.ok(f.includes(' --keep-open {keep-open} '), `composer fence lacks --keep-open: ${f.trim()}`);
  assert.ok(step3.includes("`keepOpen`"), 'Step 3 defines {keep-open} from the pre-merge envelope');
}

// Step 4.0 (the post-merge reopen) must run on the two merge paths that cite Step 4's parts.
function assertStep40Cited(text, anchor, end) {
  const s = text.indexOf(anchor);
  assert.notEqual(s, -1, `anchor missing: ${anchor}`);
  const step = text.slice(s, text.indexOf(end, s));
  assert.ok(/pr-first-merge-post-merge\.md`(?:'s Step 4\.0|\), then Step 4\.0b)/.test(step) && step.includes('Step 4.0'),
    `${anchor.trim()} does not cite Step 4.0`);
}
const MERGE_MODE = ['3. On `merged`:', '\n## '];
const CLOSE_OUT = ['7. **On `merged`', '\n## '];

// Slice out the added block: [start marker, end marker) of the live text.
function without(text, start, end) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `block start missing: ${start}`);
  const e = text.indexOf(end, s);
  assert.notEqual(e, -1, `block end missing: ${end}`);
  return text.slice(0, s) + text.slice(e);
}

const BLOCKS = {
  refresh: ["   **Then check the forge's closing links (#4199).**", '<!-- /when -->'],
  postMerge: ['### Step 4.0', '### Step 4.1'],
  lifecycle: ['`{reason}` may name the record freely', 'anywhere else in the body.\n'],
  keepOpen: ['--keep-open {keep-open} --pr', '--pr'],
  mergeMode: ['Step 4.0 (', ' When `{run-dir}/wrap-up-pack.json`'],
  closeOut: ['First run\n', 'Then reuse'],
};

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const readSkill = (rel) => readText(path.join(SKILLS, rel));

test('the squash message keeps deferred records open: both Step 3 composer fences pass --keep-open', () => {
  assertKeepOpenWiring(read('pr-first-merge.md'));
});

test('merge-mode.md and dispatch close-out.md run Step 4.0 after a merged outcome', () => {
  assertStep40Cited(readSkill('wrap-up/merge-mode.md'), ...MERGE_MODE);
  assertStep40Cited(readSkill('dispatch/close-out.md'), ...CLOSE_OUT);
});

test('AC2.1 pre-merge refresh runs closing-links after the Fixes rewrite', () => {
  assertRefreshWiring(read('pr-checklist-refresh.md'));
});

test('AC2.1 post-merge Step 4.0 runs before release-status and reconcile', () => {
  assertPostMergeWiring(read('pr-first-merge-post-merge.md'));
});

test('deferred-closure section states the keyword neutralization', () => {
  assertLifecycleWiring(read('pr-early-run-lifecycle.md'));
});

// ---- #4549: the closing-keyword contract is "default branch only"; Step 4.0 closes on a non-default base ----
const PLUGIN = path.join(__dirname, '..', 'plugin');
const collapse = (s) => s.replace(/\s+/g, ' ');
const stepOf = (text, start, end) => {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `heading missing: ${start}`);
  const e = text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `end heading missing: ${end}`);
  return collapse(text.slice(s, e));
};
const step3Of = (text) => stepOf(text, '## Step 3:', '\n## ');
const step40Of = (text) => stepOf(text, '### Step 4.0:', '### Step 4.0b');
const step40bOf = (text) => stepOf(text, '### Step 4.0b', '### Step 4.1');

// The pre-change text (before #4549), kept verbatim as the go-red controls.
const PRE_CHANGE_STEP3_CLAIM = collapse(`restated here because the merge commit's own message is what GitHub scans for
closing keywords on a non-default integration branch, where the PR body's keywords don't
fire (GitHub only auto-closes from a merge commit's message, or a PR body merged into the
*default* branch — an explicit merge commit message is what makes closing work on any
integration branch).`);
const PRE_CHANGE_STEP40_REPORT = collapse(`Whatever the \`action\`, report each \`failed[]\` record (reopen it
by hand) and each \`pendingClose[]\` record (the merge may still close it — re-run the step once,
then reopen it by hand if it closed) in the closing summary, never as anything but \`merged\`.`);
const PRE_CHANGE_STEP40B_GATE = collapse(`It is also a no-op unless the branch the merge landed on — the integration branch
(\`_shared/integration-branch.md\`) — is the repo's default branch
(\`gh repo view --json defaultBranchRef -q .defaultBranchRef.name\`). GitHub closes \`Fixes #N\`
records and a PR's other closing links only on the default branch, so a merge into any other branch
leaves its sub-issues open: counting them \`CLOSED\` would close the parent early.`);
const PRE_CHANGE_STEP40B_ACTIONS = collapse(`which only an exit-0 \`post-merge\` action
carries (\`reopen-failed\`, \`close-pending\`, \`reopened\` or \`nothing-closed\`)`);

function assertNoAnyBranchClaim(text) {
  assert.ok(!/any\s+integration\s+branch/.test(text), 'Step 3 still says keywords work on any integration branch');
}
function assertStep3DefaultOnly(step3) {
  assert.ok(step3.includes("only when the merge lands on the repo's default branch"), 'Step 3 scopes the keywords to the default branch');
  assert.ok(step3.includes("`pr-first-merge-post-merge.md`'s Step 4.0 closes those records itself"), 'Step 3 points at Step 4.0');
}
function assertNoOldClaimAnywhere(files) {
  const offenders = Object.entries(files).filter(([, t]) => /any\s+integration\s+branch/.test(t)).map(([f]) => f);
  assert.deepStrictEqual(offenders, [], `files still carrying the any-integration-branch claim: ${offenders.join(', ')}`);
}
function assertStep40ReportsCloseFailed(step40) {
  assert.ok(step40.includes('`closeFailed[]`'), 'Step 4.0 names closeFailed[]');
  assert.ok(step40.includes('close it by hand'), 'Step 4.0 tells the caller to close a closeFailed[] record by hand');
}
function assertStep40ReportsBaseUnchecked(step40) {
  assert.ok(step40.includes('A `baseUnchecked: true` envelope'), 'Step 4.0 names the baseUnchecked envelope');
  assert.ok(step40.includes("name the envelope's `unchecked[]` records in the closing summary"), 'Step 4.0 points at the envelope\'s unchecked[] list');
}
// #4549 named an armed merge into a non-default base as a gap #4599 would close; #4599's reconciler
// runs Step 4.0 for it, so the step now states that the late run closes those records.
const PRE_4599_ARMED_GAP = "On a non-default base an `armed` merge's `Fixes` records also stay open, since this step never runs for it (#4599 tracks running it for an armed PR).";
function assertStep40NamesArmedGap(step40) {
  assert.ok(
    step40.includes("On a non-default base that late run closes an `armed` merge's still-open `Fixes` records the same way, so they no longer wait for a human (#4599)."),
    'Step 4.0 states the armed non-default gap',
  );
  assert.ok(!step40.includes(PRE_4599_ARMED_GAP), 'the pre-#4599 "stay open" gap sentence is gone');
}
function assertStep40bUsesClosingSet(step40b) {
  assert.ok(
    step40b.includes('`reopen-failed`, `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`'),
    'Step 4.0b lists close-failed and closed among the closingSet-carrying actions',
  );
  assert.ok(!step40b.includes('It is also a no-op unless the branch the merge landed on'), 'the PR-merge non-default no-op is gone');
  assert.ok(step40b.includes('After a PR merge there is no such gate'), 'a PR merge uses closingSet[] on either branch');
  assert.ok(step40b.includes('`base-unchecked`'), 'Step 4.0b lists base-unchecked as a reason closingSet[] is absent');
  assert.ok(step40b.includes('a `reopen-failed` result that also carries `baseUnchecked: true`'), 'Step 4.0b lists a reopen-failed baseUnchecked envelope as lacking closingSet[]');
}
function assertStep40bHoldsCloseFailedParent(step40b) {
  assert.ok(
    step40b.includes('A `closeFailed[]` record holds its parent the same way'),
    'a closeFailed[] record\'s parent is skipped and named',
  );
}
function walkFiles(dir, exts, acc = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkFiles(full, exts, acc); }
    else if (exts.some((x) => e.name.endsWith(x))) acc[path.relative(PLUGIN, full)] = collapse(readText(full));
  }
  return acc;
}

test('#4549 AC1.1: Step 3 no longer claims keywords close on any integration branch', () => {
  assertNoAnyBranchClaim(step3Of(read('pr-first-merge.md')));
  assert.throws(() => assertNoAnyBranchClaim(PRE_CHANGE_STEP3_CLAIM), /any integration branch/, 'go-red: the pre-change sentence fails the check');
});

test('#4549 AC1.2: Step 3 says keywords close only on the default branch and points at Step 4.0', () => {
  const step3 = step3Of(read('pr-first-merge.md'));
  assertStep3DefaultOnly(step3);
  assert.throws(() => assertStep3DefaultOnly(PRE_CHANGE_STEP3_CLAIM), /scopes the keywords/, 'go-red: the pre-change sentence fails the check');
  const noPointer = step3.replace("`pr-first-merge-post-merge.md`'s Step 4.0 closes those records itself", '');
  assert.notEqual(noPointer, step3, 'go-red: the doctored text differs');
  assert.throws(() => assertStep3DefaultOnly(noPointer), /points at Step 4\.0/, 'go-red: dropping the Step 4.0 pointer fails the check');
});

test('#4549 AC1.3: no plugin file still carries the any-integration-branch claim', () => {
  const files = walkFiles(PLUGIN, ['.md', '.js']);
  assert.ok(Object.keys(files).length > 100, 'the walk found the plugin payload');
  assertNoOldClaimAnywhere(files);
  assert.throws(
    () => assertNoOldClaimAnywhere({ ...files, 'skills/_shared/pr-first-merge.md': PRE_CHANGE_STEP3_CLAIM }),
    /pr-first-merge\.md/,
    'go-red: the pre-change sentence is found',
  );
  assert.throws(
    () => assertNoOldClaimAnywhere({ 'skills/x.md': 'a keyword that works on any\nintegration branch' }),
    /skills\/x\.md/,
    'go-red: the broader any-integration-branch wording across a line wrap is found',
  );
});

test('#4549 AC7.1: Step 4.0 tells the caller to report closeFailed[] for a hand close', () => {
  const step40 = step40Of(read('pr-first-merge-post-merge.md'));
  assertStep40ReportsCloseFailed(step40);
  assert.throws(() => assertStep40ReportsCloseFailed(PRE_CHANGE_STEP40_REPORT), /names closeFailed/, 'go-red: the pre-change report list fails the check');
});

test('#4549 AC7.1b: Step 4.0 names the baseUnchecked envelope', () => {
  const step40 = step40Of(read('pr-first-merge-post-merge.md'));
  assertStep40ReportsBaseUnchecked(step40);
  assert.throws(() => assertStep40ReportsBaseUnchecked(PRE_CHANGE_STEP40_REPORT), /baseUnchecked/, 'go-red: the pre-change text fails the check');
  const withoutList = step40.replace("name the envelope's `unchecked[]` records in the closing summary", 'name them in the closing summary');
  assert.notEqual(withoutList, step40, 'go-red: the doctored text differs from the live section');
  assert.throws(() => assertStep40ReportsBaseUnchecked(withoutList), /unchecked\[\] list/, 'go-red: the pre-fix "name them" sentence fails the check');
});

test('#4549 final review, #4599: Step 4.0 states that the late run closes an armed merge\'s Fixes records on a non-default base', () => {
  const step40 = step40Of(read('pr-first-merge-post-merge.md'));
  assertStep40NamesArmedGap(step40);
  const withoutClause = step40.replace(/ On a non-default base that late run closes.*$/, '');
  assert.notEqual(withoutClause, step40, 'go-red: the doctored text differs from the live section');
  assert.throws(() => assertStep40NamesArmedGap(withoutClause), /armed non-default gap/, 'go-red: dropping the clause fails the check');
  const preChange = step40.replace(/ On a non-default base that late run closes.*$/, ` ${PRE_4599_ARMED_GAP}`);
  assert.throws(() => assertStep40NamesArmedGap(preChange), /armed non-default gap/, 'go-red: the pre-#4599 gap sentence fails the check');
});

test('#4549 AC7.2: Step 4.0b lists close-failed and closed and uses closingSet[] on a non-default branch', () => {
  const step40b = step40bOf(read('pr-first-merge-post-merge.md'));
  assertStep40bUsesClosingSet(step40b);
  assert.throws(
    () => assertStep40bUsesClosingSet(`${PRE_CHANGE_STEP40B_GATE} ${PRE_CHANGE_STEP40B_ACTIONS}`),
    /close-failed/,
    'go-red: the pre-change paragraph and action list fail the check',
  );
  const withOldNoOp = `${step40b} ${PRE_CHANGE_STEP40B_GATE}`;
  assert.throws(() => assertStep40bUsesClosingSet(withOldNoOp), /PR-merge non-default no-op is gone/, 'go-red: reintroducing the PR-merge no-op sentence fails the check');
  const noGate = step40b.replace('After a PR merge there is no such gate', 'After a PR merge');
  assert.notEqual(noGate, step40b, 'go-red: the doctored text differs');
  assert.throws(() => assertStep40bUsesClosingSet(noGate), /uses closingSet/, 'go-red: dropping the no-gate sentence fails the check');
  const noBaseUnchecked = step40b.replaceAll('`base-unchecked`', '`x`');
  assert.notEqual(noBaseUnchecked, step40b, 'go-red: the doctored text differs');
  assert.throws(() => assertStep40bUsesClosingSet(noBaseUnchecked), /base-unchecked/, 'go-red: dropping base-unchecked fails the check');
});

test('#4549 AC7.3: Step 4.0b skips and names the parent of a closeFailed[] record', () => {
  const step40b = step40bOf(read('pr-first-merge-post-merge.md'));
  assertStep40bHoldsCloseFailedParent(step40b);
  assert.throws(() => assertStep40bHoldsCloseFailedParent(PRE_CHANGE_STEP40B_GATE), /skipped and named/, 'go-red: the pre-change text fails the check');
});

test('go-red controls: each assertWiring throws with its added block sliced out', () => {
  const cut = (file, [s, e]) => without(read(file), s, e);
  const refresh = cut('pr-checklist-refresh.md', BLOCKS.refresh);
  const postMerge = cut('pr-first-merge-post-merge.md', BLOCKS.postMerge);
  const lifecycle = cut('pr-early-run-lifecycle.md', BLOCKS.lifecycle);
  assert.throws(() => assertRefreshWiring(refresh));
  assert.throws(() => assertPostMergeWiring(postMerge));
  assert.throws(() => assertLifecycleWiring(lifecycle));
  // Only the first fence loses the flag: one fence without it must still fail.
  assert.throws(() => assertKeepOpenWiring(cut('pr-first-merge.md', BLOCKS.keepOpen)), /lacks --keep-open/);
  const cutSkill = (rel, [s, e]) => without(readSkill(rel), s, e);
  assert.throws(() => assertStep40Cited(cutSkill('wrap-up/merge-mode.md', BLOCKS.mergeMode), ...MERGE_MODE), /does not cite Step 4\.0/);
  assert.throws(() => assertStep40Cited(cutSkill('dispatch/close-out.md', BLOCKS.closeOut), ...CLOSE_OUT), /does not cite Step 4\.0/);
});
