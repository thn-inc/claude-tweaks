// tests/below-floor-parent-close-conformance.test.js
//
// Conformance for #4466: a decomposition parent whose last sub-issue closes below the oversight
// floor is closed by the pipeline with a closing comment. The prose in plugin/skills/ is the
// contract (an agent runs these fences), so the live files are read.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugin');
const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

// The text from `startHeading` up to (not including) `endHeading`, or to the end of the text when
// `endHeading` is null. Throws when either anchor is missing so a renamed heading is a loud
// failure rather than an empty slice that every assertion silently runs over.
function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `heading not found: ${startHeading}`);
  if (endHeading === null) return text.slice(start);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `end heading not found after "${startHeading}": ${endHeading}`);
  return text.slice(start, end);
}

test('AC4.1: both acceptance-gap scans pass isParent to needsBackstop', () => {
  const gapScope = section(
    read('_shared/github-pr-scan-acceptance.md'),
    '## Scope: `acceptance-gap`',
    '## Scope: `parent-gate`',
  );
  assert.match(gapScope, /isParent: parseRecordFacets\(r\.labels\)\.isParentIssue,/);

  const shape8 = section(
    read('tidy/step-1-records.md'),
    '### Shape 8 — closed record with no acceptance disposition',
    'Each line is `{path}<TAB>{finding}`, the same shape Shape 7 emits',
  );
  assert.match(shape8, /isParent: r\.facets\.isParentIssue === true,/);
});

// ---- Task 2: the Parent-Gate Procedure's below-floor close section ----

const GATE_REL = 'wrap-up/verification-brief-parent-gate.md';
const collapse = (s) => s.replace(/\s+/g, ' ');

// The paragraph opening with `opener`, up to the next blank line.
function paragraph(text, opener) {
  const start = text.indexOf(opener);
  assert.ok(start !== -1, `paragraph not found: ${opener}`);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end === -1 ? undefined : end);
}

// The local-files close-timing invariant, stated identically in the exceeds: false bullet and the
// close section, and the two false merge-mechanism claims it replaced.
const CLOSE_TIMING =
  "The parent is never closed ahead of the merge: on wrap-up's execution step the commit follows item 4's merge, and on the auto-merge short-circuit labeling and the commit happen on the run's branch before its merge.";
const FALSE_MERGE_CLAIMS = [
  'reaches the integration branch only with the merge commit',
  'never reaches the integration branch ahead of the merge',
];

const belowFloorBullet = (gate) => section(gate, '**`exceeds: false`**', '**`exceeds: true`**');
const entryShapes = (gate) => section(gate, '## Two entry shapes', '## What this path deliberately does not run');
const closeSection = (gate) => section(gate, '## Close the parent below the floor', '## Compose the parent brief');

test('AC2.2: the exceeds: false bullet routes the close by entry and never closes ahead of the merge', () => {
  const below = belowFloorBullet(read(GATE_REL));
  assert.ok(!collapse(below).includes('closes cleanly'), 'the unbacked "closes cleanly" claim is gone');
  assert.match(below, /no `demo:pending`, no brief/);
  assert.match(below, /Step 4\.0b/);
  assert.match(below, /\*\*Close the parent below the floor\*\*/);
  assert.match(below, /never closed ahead of the merge/);
  assert.match(below, /commit the parent record with the entry's own close commit/);
  assert.ok(collapse(below).includes(CLOSE_TIMING), 'per-path close-timing invariant');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapse(below).includes(claim), `false claim gone: ${claim}`);
  assert.match(below, /end-to-end variant/, 'the Try-it walkthrough sentence is kept');
  assert.match(below, /Parent-side entry/);
});

test('AC1.1: the close section composes the listing comment, then comments, then closes', () => {
  const close = closeSection(read(GATE_REL));
  assert.ok(close.includes('## Closed below the oversight floor'), 'marker heading');
  assert.ok(close.includes('closed by PR #{pr}'), 'listing line suffix');
  assert.match(close, /Never[^.]*merge SHA/);
  const comment = close.indexOf('gh issue comment $PARENT_NUM --body-file');
  const shut = close.indexOf('gh issue close $PARENT_NUM --reason completed');
  assert.ok(comment !== -1 && shut > comment, `comment (${comment}) before close (${shut})`);
  const write = close.indexOf('writeRecord(parentPath');
  const closeRec = close.indexOf('closeRecord(parentPath)');
  assert.ok(write !== -1 && closeRec > write, `writeRecord (${write}) before closeRecord (${closeRec})`);
  assert.match(close, /which call failed/);
  assert.match(close, /the entry's own close commit/);
  assert.ok(collapse(close).includes(CLOSE_TIMING), 'per-path close-timing invariant');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapse(close).includes(claim), `false claim gone: ${claim}`);
  assert.ok(
    collapse(close).includes(
      'When the entry has no later commit before its merge (the auto-merge short-circuit), commit the parent record file itself before the merge, with a `{Verb} … — refs #{parent}` subject, and, under `pr-first`, push it before the merge, so the squash carries it.',
    ),
    'the short-circuit commits the parent record itself and pushes it under pr-first',
  );
  assert.ok(!collapse(close).includes("item 5's commit"), 'no claim of sharing cleanup item 5\'s commit');
  assert.ok(
    collapse(close).includes('A pre-merge sub-issue-side entry under `github-issues` never runs this section.'),
    'the opener states the pre-merge exclusion',
  );
  const prChoice = collapse(close);
  const mergingFirst = prChoice.indexOf('For a `$CLOSING_SUB_ISSUES` member, `{pr}` is `$MERGING_PR` when it is non-empty');
  const fallback = prChoice.indexOf("Otherwise `{pr}` is the `number` of the sub-issue's `closedByPullRequestsReferences` entry");
  assert.ok(mergingFirst !== -1 && fallback > mergingFirst, `$MERGING_PR first (${mergingFirst}), last reference as fallback (${fallback})`);
  assert.ok(prChoice.includes('so this fallback is arbitrary but deterministic'), 'the fallback keeps its honest note');
  assert.ok(!prChoice.includes('uses `$MERGING_PR` instead'), 'MERGING_PR is no longer only the empty-references fallback');
});

test('AC5.1: the close section is idempotent on a closed parent and a trusted heading comment', () => {
  const close = closeSection(read(GATE_REL));
  assert.match(close, /already `CLOSED`/);
  assert.match(close, /Trusted authors/);
});

test('AC2.2: the entry shapes name Step 4.0b as the post-merge sub-issue-side entry', () => {
  const gate = read(GATE_REL);
  const shapes = entryShapes(gate);
  assert.ok(shapes.includes('Step 4.0b'));
  assert.ok(!collapse(shapes).includes('the four sub-issue callers'));
  assert.ok(
    collapse(shapes).includes('Step 4.0b also passes `$MERGING_PR` — the merged PR\'s number, empty on a no-PR local merge'),
    'Step 4.0b declares its merging-PR input',
  );
  assert.ok(paragraph(gate, '**Return to the Try it post').includes('Step 4.0b'), 'Return-to-Try-it exempts Step 4.0b');
  assert.ok(paragraph(gate, '**Fail open on every `gh` call').includes('Step 4.0b'), 'Fail open exempts Step 4.0b');
  const table = section(gate, '| Sub-issue-side caller |', 'The two wrap-up entries close exactly one record');
  assert.ok(table.includes('Step 4.0b'), 'Self-inclusion table row');
  const routing = section(read('wrap-up/verification-brief.md'), '## Routing', '## Try it block');
  assert.ok(routing.includes('Six call sites exist today'));
  assert.ok(routing.includes('Step 4.0b'));
});

test('AC2.2: no resolvable parent is a no-op for the post-merge Step 4.0b entry on both no-parent branches', () => {
  const NO_OP = 'Step 4.0b\'s post-merge entry, for which no resolvable parent is a no-op: no labeling, no Try it.';
  const gateNoParent = collapse(paragraph(read(GATE_REL), '**No parent resolvable**'));
  assert.ok(gateNoParent.includes(NO_OP), 'Resolve the parent\'s no-parent branch');
  const routingOtherwise = collapse(paragraph(read('wrap-up/verification-brief.md'), '**Otherwise — no resolvable parent**'));
  assert.ok(routingOtherwise.includes(NO_OP), 'Routing\'s Otherwise branch');
});

test('AC1.1: /demo no longer claims to be the only closer of a parent', () => {
  const demo = read('demo/SKILL.md');
  assert.ok(!collapse(demo).includes('nothing else in the system ever closes a parent'));
  assert.match(demo, /Close the parent below the floor/);
});

// Go-red controls: the pre-change files carry the literals the absence assertions above reject, so
// those assertions can fail. Guarded so an unreachable commit skips only the control tests.
const PRE_CHANGE_SHA = '1ab4e17d9';

// The skill file as of PRE_CHANGE_SHA: { text, skip } where skip is false or the skip reason.
function preChangeSkillFile(rel) {
  try {
    const text = execFileSync('git', ['show', `${PRE_CHANGE_SHA}:plugin/skills/${rel}`], {
      cwd: ROOT,
      encoding: 'utf8',
    }).replace(/\r\n/g, '\n');
    return { text, skip: false };
  } catch (err) {
    const skip = `commit ${PRE_CHANGE_SHA} is not reachable in this checkout's git history — the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
    return { text: null, skip };
  }
}

const preChangeGate = preChangeSkillFile(GATE_REL);

test('go-red control: the pre-change gate says "closes cleanly" and counts four callers', { skip: preChangeGate.skip }, () => {
  assert.ok(collapse(belowFloorBullet(preChangeGate.text)).includes('closes cleanly'));
  assert.ok(collapse(entryShapes(preChangeGate.text)).includes('the four sub-issue callers'));
});

// ---- Task 3: post-merge Step 4.0b closes below-floor parents on every merge path ----

const POST_MERGE_REL = '_shared/pr-first-merge-post-merge.md';
const STEP_40B = '### Step 4.0b: Close below-floor parents (#4466)';

test('AC2.1: Step 4.0b sits between Step 4.0 and Step 4.1 and reads the merge\'s closing records', () => {
  const pm = read(POST_MERGE_REL);
  const s40 = pm.indexOf('### Step 4.0:');
  const s40b = pm.indexOf(STEP_40B);
  const s41 = pm.indexOf('### Step 4.1');
  assert.ok(s40 !== -1 && s40b > s40 && s41 > s40b, `Step 4.0 (${s40}) < Step 4.0b (${s40b}) < Step 4.1 (${s41})`);
  const body = section(pm, STEP_40B, '### Step 4.1');
  for (const lit of [
    'closingIssuesReferences',
    'git log -1 --format=%B',
    '**Close the parent below the floor**',
    '`merged`',
    'work-backend: github-issues',
    '$CLOSING_SUB_ISSUES',
    '$MERGING_PR',
    'gh pr view {pr-number} --repo {owner}/{repo} --json closingIssuesReferences',
  ]) {
    assert.ok(body.includes(lit), `Step 4.0b names ${lit}`);
  }
  assert.ok(
    collapse(body).includes(
      "A merge no session sees land (an `armed` PR that GitHub merges later) never reaches it either, by design: `/claude-tweaks:tidy`'s `parent-gate` backstop recovers that parent.",
    ),
    'an unseen armed merge is the backstop\'s by design',
  );
  assert.ok(
    collapse(body).includes(
      'It is also a no-op unless the branch the merge landed on — the integration branch (`_shared/integration-branch.md`) — is the repo\'s default branch',
    ),
    'non-default integration branch is a no-op',
  );
});

test('AC2.1: Step 4.0b subtracts every record Step 4.0 handled and skips a needs:* parent', () => {
  const body = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  assert.ok(
    body.includes(
      "`$CLOSING_SUB_ISSUES` — the merge's closing records, minus every record Step 4.0 handled: each number in its output's `reopened[]` and `pendingClose[]`, and each `failed[]` entry's `issue`.",
    ),
    'the set subtracts reopened, pendingClose and failed',
  );
  assert.ok(
    body.includes(
      "A `failed[]` or `pendingClose[]` record's live state may still read `CLOSED` — a failed reopen, an unknown state after a failed read, or a close that lands after Step 4.0's poll — so skip any parent whose enumerated sub-issues include one",
    ),
    'a failed or pending record holds its parent open',
  );
  assert.ok(!body.includes('A `failed[]` record still reads `CLOSED` live'), 'the unconditional failed[] claim is gone');
  assert.ok(!body.includes('minus any record Step 4.0 reopened'), 'the reopened-only subtraction is gone');
  assert.ok(
    body.includes(
      "Skip a parent carrying a `needs:*` label (the parent labels **Enumerate the parent's sub-issues** fetches) and name it in the closing summary, per `_shared/work-record.md`'s Worklist rule.",
    ),
    'Step 4.0b honours the Worklist rule',
  );
});

test('AC2.1: Step 4.0b acts only on a below-floor due gate, once per parent, and skips on a failing gh call', () => {
  const body = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  for (const [lit, why] of [
    ['On `due` with `exceeds: false`, run **Close the parent below the floor**.', 'acts only on due with exceeds: false'],
    ['Every other outcome is a no-op, as is a record with no resolvable parent.', 'every other outcome is a no-op'],
    [
      'Evaluate each parent once: skip a record whose parent this step already handled, so a parent with several sub-issues in the set is closed once.',
      'each parent evaluated once',
    ],
    [
      'A failing `gh` call skips that parent, or the whole step when the input read above fails. Name each skipped parent in the closing summary.',
      'a failing gh call skips that parent',
    ],
  ]) {
    assert.ok(body.includes(lit), `Step 4.0b: ${why}`);
  }
  const shapes = collapse(entryShapes(read(GATE_REL)));
  assert.ok(
    shapes.includes(
      'Step 4.0b runs after it has landed and acts only on `due` with `exceeds: false`, where it runs **Close the parent below the floor** — every other gate outcome is a no-op for it.',
    ),
    'the gate file states Step 4.0b acts only on due with exceeds: false',
  );
});

test('AC2.1: issue-claims\' Close-via-merge names the below-floor parent close as an exception', () => {
  const cvm = section(read('_shared/issue-claims.md'), '## Close-via-merge', '## Dispatch authorization');
  assert.ok(
    collapse(cvm).includes("except for the one record-closing exception that contract's Never-reversible list names:"),
    'Close-via-merge points at the one named exception',
  );
  assert.ok(!collapse(cvm).includes('except where a procedure names its own exception'), 'the open-ended exception wording is gone');
  assert.ok(cvm.includes('**Close the parent below the floor**'));
});

test('AC2.1: the auto-mode contract names the below-floor parent close as an exception with its restore contract', () => {
  const contract = read('_shared/auto-mode-contract.md');
  const never = collapse(section(contract, '### Never-reversible (auto-FORBIDDEN, regardless of mode)', '## What `auto` silences'));
  for (const lit of [
    "- Closing or deleting work records — except the Parent-Gate Procedure's **Close the parent below the floor** (`wrap-up/verification-brief-parent-gate.md`), run by `_shared/pr-first-merge-post-merge.md` Step 4.0b's post-merge entry:",
    'Its restore contract: a human runs `gh issue reopen {parent}` and may delete that comment — the pipeline never restores automatically.',
    'The precondition is that the parent still holds only this close: no comment, label or state change has landed on it since.',
    'When that precondition does not hold, the restore is not mechanical: the human reads what changed on the parent before reopening it, and deletes no comment but the `## Closed below the oversight floor` one',
    'The below-floor parent close the first bullet names is the other exception: its comment and its close are its two writes, under that bullet\'s restore contract',
    "This restore contract is what satisfies the Reversibility floor's `high` for this one write, and only for Step 4.0b's entry: `/claude-tweaks:tidy`'s parent-side `Open parent gate` runs the same section but is not this exception, so it stays staged",
  ]) {
    assert.ok(never.includes(lit), `Never-reversible list carries: ${lit}`);
  }
});

test('AC2.1: close-out step 7 and merge-mode step 3 run Step 4.0b on `merged`', () => {
  assert.ok(section(read('dispatch/close-out.md'), '7. **On `merged`', '\n## ').includes('Step 4.0b'), 'close-out step 7');
  const mergeStep = section(read('wrap-up/merge-mode.md'), '3. On `merged`:', '\n## ');
  assert.ok(
    mergeStep.includes('run Step 4.0 (`_shared/pr-first-merge-post-merge.md`), then Step 4.0b (`{pr-number}` = `{pr}`), then Step 4.1.'),
    'merge-mode step 3: one sequence, Step 4.0 then Step 4.0b then Step 4.1',
  );
});

// Each local-merge push site runs Step 4.1 against its pushed merge commit; Step 4.0b runs first.
const LOCAL_MERGE_SITES = [
  ['dispatch/settle-and-merge.md', 'After a successful push, run `_shared/pr-first-merge-post-merge.md`'],
  ['wrap-up/auto-merge-short-circuit.md', 'The explicit `--no-ff` guarantees a real merge commit exists even when the'],
  ['flow/worktree-merge.md', '6. **Push the base branch once'],
];

test('AC2.1: every local-merge push site runs Step 4.0b before its Step 4.1', () => {
  for (const [rel, opener] of LOCAL_MERGE_SITES) {
    const para = paragraph(read(rel), opener);
    assert.ok(para.includes('--ref {integration-branch}'), `${rel}: the Step 4.1 invocation paragraph`);
    const a = para.indexOf('Step 4.0b');
    const b = para.indexOf('Step 4.1');
    assert.ok(a !== -1 && b > a, `${rel}: Step 4.0b (${a}) before Step 4.1 (${b})`);
  }
  // local-merge-auto-finish runs no Step 4.1; its push step runs Step 4.0b alone.
  const autoFinish = paragraph(
    read('_shared/local-merge-auto-finish.md'),
    'After a successful push, run `_shared/pr-first-merge-post-merge.md` Step 4.0b',
  );
  assert.ok(collapse(autoFinish).includes('against the pushed merge commit (no PR, so `$MERGING_PR` is empty)'), 'local-merge-auto-finish step 7');
});

const preChangePostMerge = preChangeSkillFile(POST_MERGE_REL);

test('go-red control: the pre-change post-merge file has no Step 4.0b', { skip: preChangePostMerge.skip }, () => {
  assert.ok(!preChangePostMerge.text.includes('Step 4.0b'));
});

// ---- Task 4: tidy's parent-gate backstop surfaces stranded below-floor parents ----

const ABOVE_ROW_TAIL = ' — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo ';
const BELOW_ROW_TAIL = ' — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)';

// Same shape as tests/help-acceptance-queue-local-files.test.js: `node -e "` ... closing `"` at a line start.
function extractNodeScripts(text) {
  const scripts = [];
  const re = /node -e "\n([\s\S]*?)\n\s*"/g;
  let m;
  while ((m = re.exec(text)) !== null) scripts.push(m[1].replace(/\\"/g, '"').replace(/\\\$/g, '$'));
  return scripts;
}

function scanScript(text, needle) {
  const found = extractNodeScripts(text).filter((s) => s.includes(needle));
  assert.equal(found.length, 1, `exactly one node -e block carries ${needle}`);
  return found[0].split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT);
}

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});
function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

// Three due parents against a `high` floor: #1's sub-issues are risk:medium (below), #2's risk:high
// (above), #3 has one unscored sub-issue (fails closed, above).
test('AC3.1: the GitHub parent-gate scan prints a Close row for a due below-floor parent', () => {
  const script = scanScript(
    section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: `parent-gate`', null),
    "'[parent-gate] #'",
  );
  const sub = (number, risk) => ({ number, state: 'CLOSED', labels: risk ? [{ name: `risk:${risk}` }] : [] });
  const gates = [
    { number: 1, title: 'Medium parent', parentLabels: [], subIssues: [sub(11, 'medium'), sub(12, 'low')] },
    { number: 2, title: 'High parent', parentLabels: [], subIssues: [sub(21, 'high')] },
    { number: 3, title: 'Unscored parent', parentLabels: [], subIssues: [sub(31, 'medium'), sub(32, null)] },
  ];
  const gatesFile = path.join(mkTmp('bf-parent-gate-gh-'), 'gates.json');
  fs.writeFileSync(gatesFile, JSON.stringify(gates));
  const out = execFileSync('node', ['-e', script.split('$GATES').join(gatesFile.replace(/\\/g, '/')), '--', 'high'], {
    encoding: 'utf8',
  });
  assert.deepEqual(out.trim().split('\n'), [
    '[parent-gate] #1: Medium parent' + BELOW_ROW_TAIL,
    '[parent-gate] #2: High parent' + ABOVE_ROW_TAIL + '#2',
    '[parent-gate] #3: Unscored parent' + ABOVE_ROW_TAIL + '#3',
  ]);
});

test('AC3.1: Shape 7 prints a Close row for a due below-floor local parent', () => {
  const script = scanScript(
    section(read('tidy/step-1-records.md'), '### Shape 7 — decomposition parent gate due', '### Shape 8 —'),
    "'\\t[parent-gate] '",
  );
  const { writeRecord, closeRecord, defaultFacets } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'issues', 'local-store.js'));
  const cwd = mkTmp('bf-parent-gate-local-');
  const recordFile = (n, slug) => path.join(cwd, 'specs', `${String(n).padStart(2, '0')}-${slug}.md`);
  const parent = (n, slug, title) =>
    writeRecord(recordFile(n, slug), { title, body: 'Parent body.', facets: { ...defaultFacets(), isParentIssue: true } });
  const closedSub = (n, slug, parentId, risk) => {
    const file = recordFile(n, slug);
    writeRecord(file, { title: slug, body: 'Sub body.', facets: { ...defaultFacets(), parent: parentId, ...(risk ? { risk } : {}) } });
    closeRecord(file);
  };
  parent(1, 'medium-parent', 'Medium parent');
  parent(2, 'high-parent', 'High parent');
  parent(3, 'unscored-parent', 'Unscored parent');
  closedSub(4, 'sub-medium', 1, 'medium');
  closedSub(5, 'sub-high', 2, 'high');
  closedSub(6, 'sub-medium-b', 3, 'medium');
  closedSub(7, 'sub-unscored', 3, null);

  const out = execFileSync('node', ['-e', script, '--', 'high'], { cwd, encoding: 'utf8' });
  const lines = out.trim().split('\n').map((line) => line.split('\t'));
  assert.deepEqual(
    lines.map(([, row]) => row),
    [
      '[parent-gate] 1: Medium parent' + BELOW_ROW_TAIL,
      '[parent-gate] 2: High parent' + ABOVE_ROW_TAIL + '2',
      '[parent-gate] 3: Unscored parent' + ABOVE_ROW_TAIL + '3',
    ],
  );
  assert.ok(lines[0][0].endsWith('01-medium-parent.md'), 'the path column is kept on the below-floor row');
});

test('AC3.1: the Collect lines and the pre-filter prose carry the below-floor form', () => {
  const pg = section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: `parent-gate`', null);
  assert.ok(collapse(pg).includes('a due parent below the floor is surfaced'), 'prose before the block');
  assert.ok(!collapse(pg).includes('filter to parents that both exceed the floor'), 'old filter-out prose gone');
  const unGated = collapse(paragraph(pg, 'Un-gated parents recommend'));
  assert.ok(unGated.includes('**Close the parent below the floor**'), 'approval closes through the section');
  assert.ok(unGated.includes('`wrap-up/verification-brief-parent-gate.md`'));
  assert.ok(unGated.includes('no `/claude-tweaks:demo` step'));

  const shape7 = section(read('tidy/step-1-records.md'), '### Shape 7 — decomposition parent gate due', '### Shape 8 —');
  assert.ok(!collapse(shape7).includes('Both backstop shapes below (this one and Shape 8) filter out below-floor candidates'));
  assert.ok(collapse(shape7).includes('Shape 8 filters out below-floor candidates'), 'the filter-out claim applies to Shape 8 only');
  const collect = shape7.split('\n').find((l) => l.startsWith('→ Collect each as:'));
  assert.ok(collect.includes('`[parent-gate] {id}: {title}' + BELOW_ROW_TAIL + '`'), 'Shape 7 below-floor Collect form');
  assert.ok(collect.includes('`[parent-gate] {id}: {title}' + ABOVE_ROW_TAIL + '{id}`'), 'Shape 7 keeps the above-floor Collect form');
  assert.ok(shape7.includes('.filter((f) => !f.needsDefinition)'), 'needsDefinition filter kept byte-identical');
  const procedures = read('tidy/scan-procedures.md');
  assert.ok(
    procedures.includes('→ Collect each as: `[parent-gate] #{n}: {title}' + BELOW_ROW_TAIL + '`'),
    'scan-procedures below-floor Collect line',
  );
});

test('AC3.1: Open parent gate closes the parent below the floor, staged, with no brief', () => {
  const FLOOR = '**Close the parent below the floor**';
  for (const rel of ['tidy/actions-github-issues.md', 'tidy/actions-local-files.md']) {
    const text = read(rel);
    const action = section(text, '## Open parent gate', text.includes('## Arm ready PR') ? '## Arm ready PR' : null);
    assert.ok(collapse(action).includes(FLOOR), `${rel}: runs Close the parent below the floor`);
    assert.ok(collapse(action).includes('instead of composing a brief'), `${rel}: no brief below the floor`);
  }
  const skill = read('tidy/SKILL.md');
  assert.ok(!collapse(skill).includes('never closes the parent'), 'the Action Vocabulary no longer says the action never closes the parent');
  assert.ok(collapse(skill).includes('closes the parent only below the oversight floor (no brief owed)'));
  const step6 = read('tidy/step-6-auto.md');
  const row = step6.slice(step6.indexOf('| **Open parent gate** ('), step6.indexOf('| **Fill Release Note**'));
  assert.ok(row.includes('closeRecord'), 'the Step 6 row names the local-files close');
  assert.ok(row.includes('sub-issue-listing comment'));
});

test('AC3.1: the Step 7 checklist verifies a below-floor close on both drivers', () => {
  const skill = read('tidy/SKILL.md');
  const forms = skill.split('\n').filter((l) => l.startsWith('- [x] Closed parent below the floor:'));
  assert.equal(forms.length, 2, 'one form per driver');
  const gh = forms.find((l) => l.includes('`github-issues`'));
  const local = forms.find((l) => l.includes('`local-files`'));
  assert.ok(gh && local, 'both drivers');
  assert.ok(gh.includes('re-queried as `CLOSED`') && gh.includes('## Closed below the oversight floor') && gh.includes('Trusted authors'));
  assert.ok(gh.includes('no `demo:*` label'));
  assert.ok(local.includes('`facets.closed`') && local.includes('## Closed below the oversight floor'));
  assert.ok(local.includes('no `acceptance` facet'));
  assert.ok(gh.includes('A parent re-queried as `CLOSED` with no such comment also passes, as the no-op case'), 'github: already-closed no-op passes');
  assert.ok(local.includes('A parent with `facets.closed` set and no such section also passes, as the no-op case'), 'local: already-closed no-op passes');
  // The brief-path forms stay, so an above-floor gate is still verified by a brief.
  assert.equal(skill.split('\n').filter((l) => l.startsWith('- [x] Opened parent gate:')).length, 2);
});

test('AC3.1: stale brief-only restatements name the below-floor close', () => {
  const BELOW = '`[parent-gate] #{n}: {title}' + BELOW_ROW_TAIL + '`';
  assert.ok(read('_shared/github-pr-scan.md').includes(BELOW), 'Output Contract row form');
  const floorPtr = '**Close the parent below the floor**';
  const gate = read('tidy/SKILL.md').split('\n').find((l) => l.startsWith('| **Open parent gate** |'));
  assert.ok(gate.includes('below the oversight floor') && gate.includes(floorPtr), 'SKILL.md What It Means column');
  const procedures = collapse(read('tidy/scan-procedures.md'));
  assert.ok(procedures.includes('so an above-floor finding still ends with "then run `/claude-tweaks:demo #{n}`"'), 'scan-procedures above-floor only');
  const actions = collapse(read('tidy/actions-github-issues.md'));
  assert.ok(actions.includes('which is why an above-floor recommendation still ends with `/claude-tweaks:demo #{n}`'), 'github action above-floor only');
  assert.ok(actions.includes('closes the parent and asserts every sub-issue is complete'), 'github staging reasoning');
  const local = collapse(read('tidy/actions-local-files.md'));
  assert.ok(local.includes('closes the parent and asserts every sub-issue is complete'), 'local staging reasoning');
  const wr = collapse(read('_shared/work-record.md'));
  assert.ok(wr.includes('below the oversight floor it instead closes the parent (' + floorPtr + ')'), 'work-record backstop bullet');
  assert.ok(wr.includes('which applies `demo:pending` to the parent and attaches its Verification Brief above the oversight floor'), 'work-record /tidy row');
});

// The below-floor clause runs from its opener to the next sentence or clause end.
function clauseFrom(text, opener) {
  const start = text.indexOf(opener);
  assert.ok(start !== -1, `below-floor clause not found: ${opener}`);
  const rest = text.slice(start + opener.length);
  const end = rest.search(/[.;] /);
  return opener + (end === -1 ? rest : rest.slice(0, end));
}

test('AC3.1: tidy stages the below-floor close because the contract exception covers only Step 4.0b', () => {
  const sites = [
    [
      collapse(read('tidy/scan-procedures.md')),
      'Below the oversight floor it instead posts a comment and closes the parent: the contract\'s exception for that write covers only `_shared/pr-first-merge-post-merge.md` Step 4.0b\'s post-merge entry, and this parent-side backstop is not that entry, so it stays staged',
      'or, below the oversight floor, posts a comment and closes the parent — an outward-facing GitHub API write that fails',
    ],
    [
      collapse(readText(path.join(ROOT, 'docs', 'skill-graph.md'))),
      'and, below the floor, because the contract\'s exception for posting a comment and closing the parent covers only `_shared/pr-first-merge-post-merge.md` Step 4.0b\'s post-merge entry, never this parent-side backstop',
      'or, below the floor, posting a comment and closing the parent — is an outward-facing API write that fails',
    ],
    [
      collapse(read('tidy/actions-github-issues.md')),
      'The below-floor close is staged on different grounds: that contract\'s exception for its comment and close covers only `_shared/pr-first-merge-post-merge.md` Step 4.0b\'s post-merge entry, and this parent-side backstop is not that entry.',
      'The below-floor close is staged on the same grounds',
    ],
  ];
  for (const [text, clause, stale] of sites) {
    assert.ok(text.includes(clause), `below-floor staging reason: ${clause}`);
    assert.ok(!clauseFrom(text, clause).includes('regardless of how mechanical'), `no reversibility-floor claim in: ${clause}`);
    assert.ok(!text.includes(stale), `stale reason gone: ${stale}`);
  }
});

// ---- AC5: the local-files close fence, executed against a real store ----

const HEADING = '## Closed below the oversight floor';

// Step 5's ```js fence, with its two free inputs bound ahead of it.
function localCloseScript(parentPath, parentCloseSection) {
  const step5 = section(closeSection(read(GATE_REL)), '**5. `work-backend: local-files`**', null);
  const fence = /```js\n([\s\S]*?)\n```/.exec(step5);
  assert.ok(fence, 'step 5 carries a js fence');
  const body = fence[1].split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT.replace(/\\/g, '/'));
  return `const parentPath = ${JSON.stringify(parentPath)};\nconst parentCloseSection = ${JSON.stringify(parentCloseSection)};\n${body}`;
}

test('AC5.2: the local-files close fence closes the parent once with one heading section, however often it runs', () => {
  const { writeRecord, readRecord, closeRecord, defaultFacets } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'issues', 'local-store.js'));
  const cwd = mkTmp('bf-local-close-');
  const closeSectionText = `${HEADING}\n\nEvery sub-issue of this decomposition is closed.\n\n- 2 Only sub`;
  const headings = (file) => readRecord(file).body.split('\n').filter((l) => l.trim() === HEADING).length;
  const run = (file) => execFileSync('node', ['-e', localCloseScript(file, closeSectionText)], { cwd, encoding: 'utf8' });
  const parentFile = (name) => path.join(cwd, 'specs', name);
  const parentFacets = { ...defaultFacets(), isParentIssue: true };

  // Open, no heading: two runs append once and close once.
  const fresh = parentFile('01-fresh-parent.md');
  writeRecord(fresh, { title: 'Fresh parent', body: 'Parent body.', facets: parentFacets });
  run(fresh);
  run(fresh);
  assert.equal(readRecord(fresh).facets.closed, true, 'fresh parent ends closed');
  assert.equal(headings(fresh), 1, 'fresh parent carries exactly one heading section');

  // Open with the heading already appended (a close that failed after the write): close only.
  const halfDone = parentFile('03-half-done-parent.md');
  writeRecord(halfDone, { title: 'Half-done parent', body: `Parent body.\n\n${closeSectionText}`, facets: parentFacets });
  run(halfDone);
  assert.equal(readRecord(halfDone).facets.closed, true, 'half-done parent ends closed');
  assert.equal(headings(halfDone), 1, 'half-done parent gains no second heading section');

  // Already closed with no heading (a human closed it first): a no-op.
  const humanClosed = parentFile('05-human-closed-parent.md');
  writeRecord(humanClosed, { title: 'Human-closed parent', body: 'Parent body.', facets: parentFacets });
  closeRecord(humanClosed);
  const before = fs.readFileSync(humanClosed, 'utf8');
  run(humanClosed);
  assert.equal(fs.readFileSync(humanClosed, 'utf8'), before, 'an already-closed parent is left untouched');
});
