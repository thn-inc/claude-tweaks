// tests/closing-links-prose-conformance.test.js — pins #4199: the pr-first merge procedures
// must run `bin/closing-links.js` (pre-merge unlink, post-merge reopen backstop) and the
// deferred-closure section must state the keyword neutralization. Reads live skill prose;
// each assertWiring has a go-red control run on the text with the added block sliced out.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
  assert.ok(/pr-first-merge-post-merge\.md`(?:'s Step 4\.0|\), then Step 4\.1)/.test(step) && step.includes('Step 4.0'),
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
  mergeMode: ['Step 4.0 (', 'Step 4.1. When'],
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
