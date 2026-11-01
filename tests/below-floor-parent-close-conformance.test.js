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

// The local-files close-timing invariant, stated once in the close section's step 5 (the
// exceeds: false bullet points at it), and the two false merge-mechanism claims it replaced.
const CLOSE_TIMING =
  "The parent is never closed ahead of the merge: on wrap-up's execution step the commit follows the merge of `wrap-up/cleanup-procedures.md`'s item 4 (Git worktree), and on the auto-merge short-circuit labeling and the commit happen on the run's branch before its merge.";
const FALSE_MERGE_CLAIMS = [
  'reaches the integration branch only with the merge commit',
  'never reaches the integration branch ahead of the merge',
];

const belowFloorBullet = (gate) => section(gate, '**`exceeds: false`**', '**`exceeds: true`**');
const entryShapes = (gate) => section(gate, '## Two entry shapes', '## What this path deliberately does not run');
const closeSection = (gate) => section(gate, '## Close the parent below the floor', '## Compose the parent brief');

test('AC2.2: the exceeds: false bullet routes the close by entry and never closes ahead of the merge', () => {
  const below = belowFloorBullet(read(GATE_REL));
  const collapsedBelow = collapse(below);
  assert.ok(!collapsedBelow.includes('closes cleanly'), 'the unbacked "closes cleanly" claim is gone');
  assert.match(below, /no `demo:pending`, no brief/);
  assert.match(below, /Step 4\.0b/);
  assert.match(below, /\*\*Close the parent below the floor\*\*/);
  assert.match(below, /never closed ahead of the merge/);
  assert.match(below, /commit the parent record with the entry's own close commit/);
  assert.ok(collapsedBelow.includes("never closed ahead of the merge, per that section's step 5."), 'points at step 5');
  assert.ok(!collapsedBelow.includes(CLOSE_TIMING), 'the close-timing invariant is not restated in the bullet');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapsedBelow.includes(claim), `false claim gone: ${claim}`);
  assert.match(below, /end-to-end variant/, 'the Try-it walkthrough sentence is kept');
  assert.match(below, /Parent-side entry/);
});

test('AC1.1: the close section excludes pre-merge github entries, lists sub-issues with $MERGING_PR first, comments before closing, and commits a short-circuit close itself', () => {
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
  const collapsed = collapse(close);
  assert.ok(collapsed.includes(CLOSE_TIMING), 'per-path close-timing invariant');
  for (const claim of FALSE_MERGE_CLAIMS) assert.ok(!collapsed.includes(claim), `false claim gone: ${claim}`);
  assert.ok(
    collapsed.includes(
      'When the entry has no later commit before its merge (the auto-merge short-circuit), commit the parent record file itself before the merge, with a `{Verb} … — refs #{parent}` subject, and, under `pr-first`, push it before the merge, so the squash carries it.',
    ),
    'the short-circuit commits the parent record itself and pushes it under pr-first',
  );
  assert.ok(!collapsed.includes("item 5's commit"), 'no claim of sharing cleanup item 5\'s commit');
  assert.ok(
    collapsed.includes('A pre-merge sub-issue-side entry under `github-issues` never runs this section.'),
    'the opener states the pre-merge exclusion',
  );
  const mergingFirst = collapsed.indexOf('For a `$CLOSING_SUB_ISSUES` member, `{pr}` is `$MERGING_PR` when it is non-empty');
  const fallback = collapsed.indexOf("Otherwise `{pr}` is the `number` of the sub-issue's `closedByPullRequestsReferences` entry");
  assert.ok(mergingFirst !== -1 && fallback > mergingFirst, `$MERGING_PR first (${mergingFirst}), last reference as fallback (${fallback})`);
  assert.ok(collapsed.includes('so this fallback is arbitrary but deterministic'), 'the fallback keeps its honest note');
  assert.ok(!collapsed.includes('uses `$MERGING_PR` instead'), 'MERGING_PR is no longer only the empty-references fallback');
});

test('AC5.1: the close section is idempotent on a closed parent, a human reopen and a counted heading comment', () => {
  const close = collapse(closeSection(read(GATE_REL)));
  assert.match(close, /already `CLOSED`/);
  // #4603: the stateReason+comments read and the login read are the CLI's now, pinned by
  // tests/bin-lib/issues/parent-gate.test.js's `gatherIdempotenceFacts reads the login only for an
  // open, non-reopened parent` and tests/bin-lib/issues/below-floor-parent-close.test.js's fake gh.
  assert.ok(
    close.includes('An open parent whose `stateReason` is `REOPENED` is a no-op too, reported in the output and never re-closed'),
    'a human reopen is never re-closed',
  );
  assert.ok(
    close.includes(
      "counting only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) or from the current `gh` identity (the CLI reads its login)",
    ),
    'a trusted or own-identity heading comment counts',
  );
  assert.ok(close.includes('Any other comment carrying the heading reads as no comment posted'), 'any other heading comment reads as absent');
});

test('AC1.1: the close reason follows the sub-issues\' stateReason', () => {
  const gate = read(GATE_REL);
  const close = collapse(closeSection(gate));
  assert.ok(close.includes('Close with `--reason completed` only when at least one sub-issue closed `COMPLETED`'), 'completed only with a completed sub-issue');
  assert.ok(close.includes('gh issue close $PARENT_NUM --reason "not planned"'), 'not planned otherwise');
  assert.ok(close.includes('No sub-issue closed as completed, so this parent closes as not planned.'), 'the comment says so');
  // #4603: the per-sub-issue read and the paginated native enumeration are the CLI's now, pinned by
  // tests/bin-lib/issues/parent-gate.test.js's `gatherGateFacts (native, from a sub-issue) makes the
  // call shapes in order` and `AC1.1: a parent past the 100 page size goes through the --paginate
  // ladder`, and tests/parent-gate-cli.test.js's two AC1.1 enumeration tests.
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

test('AC2.2: no resolvable parent is a no-op for the post-merge Step 4.0b entry, stated once and pointed at', () => {
  const NO_OP = 'Step 4.0b\'s post-merge entry, for which no resolvable parent is a no-op: no labeling, no Try it.';
  const gateNoParent = collapse(paragraph(read(GATE_REL), '**No parent resolvable**'));
  assert.ok(gateNoParent.includes(NO_OP), 'Resolve the parent\'s no-parent branch');
  const routingOtherwise = collapse(paragraph(read('wrap-up/verification-brief.md'), '**Otherwise — no resolvable parent**'));
  assert.ok(!routingOtherwise.includes(NO_OP), 'Routing\'s Otherwise branch does not restate it');
  assert.ok(
    routingOtherwise.includes("The post-merge Step 4.0b entry is the exception, per `verification-brief-parent-gate.md`'s **Resolve the parent** no-parent branch."),
    'Routing\'s Otherwise branch points at it',
  );
  const step40b = collapse(section(read('_shared/pr-first-merge-post-merge.md'), '### Step 4.0b', '### Step 4.1'));
  assert.ok(!step40b.includes('as is a record with no resolvable parent'), 'Step 4.0b does not restate it');
  assert.ok(step40b.includes("a record with no resolvable parent follows **Resolve the parent**'s no-parent branch."), 'Step 4.0b points at it');
});

test('AC1.1: /demo no longer claims to be the only closer of a parent', () => {
  const demo = read('demo/SKILL.md');
  assert.ok(!collapse(demo).includes('nothing else in the system ever closes a parent'));
  assert.match(demo, /Close the parent below the floor/);
});

// Go-red controls: the pre-change files carry the literals the absence assertions above reject, so
// those assertions can fail. Guarded so an unreachable commit skips only the control tests.
const PRE_CHANGE_SHA = '1ab4e17d9';
// #4603's base on main, before the Parent-Gate Procedure ran through bin/parent-gate.js.
const PRE_4603_SHA = '0baad513d';

// The skill file as of `sha`: { text, skip } where skip is false or the skip reason.
function preChangeSkillFile(rel, sha = PRE_CHANGE_SHA) {
  try {
    const text = execFileSync('git', ['show', `${sha}:plugin/skills/${rel}`], {
      cwd: ROOT,
      encoding: 'utf8',
    }).replace(/\r\n/g, '\n');
    return { text, skip: false };
  } catch (err) {
    const skip = `commit ${sha} is not reachable in this checkout's git history — the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
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
    '`closingSet[]`',
    'git log -1 --format=%B',
    '**Close the parent below the floor**',
    '`merged`',
    'work-backend: github-issues',
    '$CLOSING_SUB_ISSUES',
    '$MERGING_PR',
  ]) {
    assert.ok(body.includes(lit), `Step 4.0b names ${lit}`);
  }
  assert.ok(
    collapse(body).includes(
      "A merge no session sees land (an `armed` PR that GitHub merges later) never reaches it either: the reconciler's `post-merge` check runs Steps 4.0 and 4.0b for that run once, keyed on its recorded PR (`docs/reconcile-checks.md`'s Post-merge closes), and `/claude-tweaks:tidy`'s `parent-gate` backstop stays the last resort.",
    ),
    'an unseen armed merge is the reconciler\'s, with tidy as the last resort',
  );
  assert.ok(
    !collapse(body).includes('by design: `/claude-tweaks:tidy`'),
    'the "tidy recovers it by design" sentence is gone',
  );
  // #4549: the default-branch no-op is scoped to the no-PR local merge entry; a PR merge uses closingSet[] on either branch.
  const LOCAL_MERGE_NO_OP = 'After a no-PR local merge it is a no-op unless the branch the merge landed on — the integration branch (`_shared/integration-branch.md`) — is the repo\'s default branch';
  const PRE_CHANGE_NO_OP = 'It is also a no-op unless the branch the merge landed on — the integration branch (`_shared/integration-branch.md`) — is the repo\'s default branch';
  const checkLocalMergeNoOp = (text) => assert.ok(collapse(text).includes(LOCAL_MERGE_NO_OP), 'non-default integration branch is a no-op after a local merge only');
  checkLocalMergeNoOp(body);
  assert.throws(() => checkLocalMergeNoOp(PRE_CHANGE_NO_OP), /after a local merge only/, 'go-red: the pre-change unscoped sentence fails the check');
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
      "Skip a parent whose verdict lists `needs` (its `needs:*` labels) and name it in the closing summary, per `_shared/work-record.md`'s Worklist rule.",
    ),
    'Step 4.0b honours the Worklist rule',
  );
});

test('AC2.1: Step 4.0b acts only on a below-floor due gate, once per parent, and skips on a failing gh call', () => {
  const body = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  for (const [lit, why] of [
    ['On `due` with `exceeds: false`, run **Close the parent below the floor**.', 'acts only on due with exceeds: false'],
    ['Every other outcome is a no-op;', 'every other outcome is a no-op'],
    [
      'Evaluate each parent once: skip a record whose parent this step already handled, so a parent with several sub-issues in the set is closed once.',
      'each parent evaluated once',
    ],
    [
      'and how it skips on a failing `gh` call — never a stop, and never a reason to report anything other than `merged`.',
      'a failing gh call follows the gate\'s Fail open paragraph',
    ],
  ]) {
    assert.ok(body.includes(lit), `Step 4.0b: ${why}`);
  }
  assert.ok(!body.includes('A failing `gh` call skips that parent'), 'the fail-open rule is not restated in Step 4.0b');
  const failOpen = collapse(paragraph(read(GATE_REL), '**Fail open on every `gh` call'));
  assert.ok(
    failOpen.includes("on any failing `gh` call it skips that parent — or the whole step, when the call is Step 4.0b's default-branch check — names each skipped parent in the closing summary"),
    'the gate states the Step 4.0b fail-open rule once',
  );
  const shapes = collapse(entryShapes(read(GATE_REL)));
  assert.ok(
    shapes.includes(
      'Step 4.0b runs after it has landed and acts only on `due` with `exceeds: false`, where it runs **Close the parent below the floor** — every other gate outcome is a no-op for it.',
    ),
    'the gate file states Step 4.0b acts only on due with exceeds: false',
  );
});

test('AC2.1: Step 4.0b keeps same-repo closing records, skips without Step 4.0\'s lists, needs parent-issue, and logs through log-decision.js', () => {
  const raw = section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1');
  const body = collapse(raw);
  // The pre-change read (#4466) that #4597 replaced with Step 4.0's closingSet[].
  const PRE_CHANGE_STEP_40B_READ = `  Otherwise, after a PR merge, read the PR's same-repo closing records. Like \`sameRepoNumbers\`
  (\`bin/lib/flow/closing-links.js\`), the filter drops a reference to another repository, whose
  \`Fixes other/repo#N\` would otherwise read as this repo's #N:

  \`\`\`bash
  gh pr view {pr-number} --repo {owner}/{repo} --json closingIssuesReferences --jq '[.closingIssuesReferences[] | select((.repository.owner.login // "" | ascii_downcase) == ("{owner}" | ascii_downcase) and (.repository.name // "" | ascii_downcase) == ("{repo}" | ascii_downcase)) | .number]'
  \`\`\`
`;
  const CLOSING_SET_READ = "After a PR merge, the set is Step 4.0's `closingSet[]`, which only an exit-0 `post-merge` action other than `base-unchecked` carries (`reopen-failed`, `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`)";
  // #4549: the pre-change action list, kept as the control for the list pinned below.
  const PRE_4549_CLOSING_SET_READ = "After a PR merge, the set is Step 4.0's `closingSet[]`, which only an exit-0 `post-merge` action carries (`reopen-failed`, `close-pending`, `reopened` or `nothing-closed`)";
  assert.ok(!raw.includes('closingIssuesReferences'), 'AC1.1: Step 4.0b no longer reads closingIssuesReferences itself');
  assert.ok(PRE_CHANGE_STEP_40B_READ.includes('closingIssuesReferences'), 'AC1.1 go-red: the pre-change read carries the literal');
  assert.ok(body.includes(CLOSING_SET_READ), 'Step 4.0b reads closingSet[] from Step 4.0');
  assert.ok(!collapse(PRE_CHANGE_STEP_40B_READ).includes(CLOSING_SET_READ), 'go-red: the pre-change read never names closingSet[]');
  // The skip is scoped to PR merges: after a no-PR local merge Step 4.0 never runs, so closingSet[] is always absent there.
  const SCOPED_SKIP = 'After a PR merge, when `closingSet[]` is absent';
  const checkScopedSkip = (text) => assert.ok(text.includes(SCOPED_SKIP), 'Step 4.0b skips when the field is absent, after a PR merge only');
  checkScopedSkip(body);
  const unscopedBody = body.replace(SCOPED_SKIP, 'When `closingSet[]` is absent');
  assert.notEqual(unscopedBody, body, 'go-red: the doctored text differs from the live section');
  assert.throws(() => checkScopedSkip(unscopedBody), /Step 4\.0b skips when the field is absent, after a PR merge only/, 'go-red: an unscoped skip sentence fails the check');
  const ACTIONS = 'which only an exit-0 `post-merge` action other than `base-unchecked` carries (`reopen-failed`, `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`)';
  const checkActions = (text) => assert.ok(text.includes(ACTIONS), 'only an exit-0 post-merge action other than base-unchecked carries the lists');
  checkActions(body);
  assert.throws(() => checkActions(collapse(PRE_4549_CLOSING_SET_READ)), /carries the lists/, 'go-red: the pre-change action list fails the check');
  assert.ok(body.includes('skip this step entirely, never subtracting nothing, and log it'), 'skips the whole step without the lists');
  assert.ok(raw.includes('--status SKIP --step "pr-first-merge Step 4.0b (skipped)"'), 'the skip is logged through log-decision.js');
  assert.ok(
    body.includes('A parent whose labels lack `parent-issue` — the label tidy\'s `parent-gate` backstop selects on — is a no-op too, named in the closing summary.'),
    'a parent without the parent-issue label is a no-op',
  );
  assert.ok(
    raw.includes(
      'node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "pr-first-merge Step 4.0b" --reversibility "high (gh issue reopen)"',
    ),
    'each closed parent is logged through log-decision.js',
  );
  assert.ok(!body.includes('AUTO {time} — pr-first-merge Step 4.0b'), 'no hand-composed decisions.md line');
});

// ---- #4599: the reconciler runs Steps 4.0 and 4.0b for a merge no session saw land ----

const SUMMARY_LINE_START = 'node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "pr-first-merge Step 4.0b" --reversibility n/a --text "evaluated PR #{pr-number}\'s closing records: {k} parent(s) closed"';

// The always-written summary command's line, found by its text rather than by position.
function summaryCommand(step40b) {
  const lines = step40b.split('\n').filter((l) => l.includes('log-decision.js') && l.includes('evaluated PR #{pr-number}'));
  assert.equal(lines.length, 1, 'exactly one always-written summary command in Step 4.0b');
  return lines[0];
}

test('#4599: Step 4.0 says the reconciler\'s post-merge check runs the CLI for an armed merge', () => {
  const pm = read(POST_MERGE_REL);
  const body = collapse(section(pm, '### Step 4.0:', STEP_40B));
  assert.ok(
    body.includes(
      "An `armed` outcome never reaches this step in-session: the reconciler's `post-merge` check (`gh` only) runs the CLI for that run once GitHub has merged the PR for 10 minutes (the merge grace), with no settle poll and reopens bounded to 10 minutes after `mergedAt`; with `--keep-open` on the composer,",
    ),
    'Step 4.0 names the reconciler\'s post-merge check, gh-only, the merge grace, no settle poll, and the 10-minute reopen bound',
  );
  // The no-settle-poll claim is the argv the module actually passes: tests/bin-lib/reconcile/post-merge.test.js pins it by running the check.
  const { MERGE_GRACE_MS } = require('../plugin/bin/lib/reconcile/post-merge');
  assert.equal(MERGE_GRACE_MS, 10 * 60 * 1000, 'the 10 minutes of merge grace the prose states is MERGE_GRACE_MS');
  assert.ok(!body.includes('the reconciler does not run the CLI'), 'the "reconciler does not run the CLI" claim is gone');
  assert.ok(body.includes('only a Development-sidebar link can still close a kept-open record there'), 'the --keep-open clause is kept');
  // The numbers the prose states are the module's.
  const { CLOSE_WINDOW_MS } = require('../plugin/bin/lib/reconcile/post-merge');
  assert.equal(CLOSE_WINDOW_MS, 10 * 60 * 1000, 'the 10 minutes the prose states is CLOSE_WINDOW_MS');
});

test('#4599: the Step 4.2 reconcile call states that post-merge rides along as archive\'s prerequisite', () => {
  const pm = collapse(read(POST_MERGE_REL));
  assert.ok(
    pm.includes(
      '`--checks mirror,release,archive` scopes the sweep to what this step needs, plus `post-merge`, which `archive` requires and the check expansion adds. When Step 4.0b wrote its marker, `post-merge` skips this run; with no marker (exit 3) the run sits inside the 10-minute merge grace, so `post-merge` defers it and `archive` leaves it in place as `post-merge-pending`. The full unscoped default',
    ),
    'the --checks sentence names the post-merge expansion and both marker cases',
  );
  assert.ok(!pm.includes('so `post-merge` skips it —'), 'the unconditional "marks this run, so post-merge skips it" run-on is gone');
  assert.ok(!pm.includes('scopes the sweep to exactly what this step needs'), 'the "exactly what this step needs" claim is gone');
});

test('#4599: Step 4.0b writes an always-on summary line, after the per-parent line, that the reconciler parses as its marker', () => {
  const { hasPostMergeMarker } = require('../plugin/bin/lib/reconcile/post-merge');
  const { formatEntry } = require('../plugin/bin/lib/log-decision/append');
  const raw = section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1');
  const line = summaryCommand(raw);
  assert.ok(line.startsWith(SUMMARY_LINE_START), `the summary command is byte-exact: ${line}`);
  const parentLine = raw.indexOf('--reversibility "high (gh issue reopen)"');
  assert.ok(parentLine !== -1 && raw.indexOf(line) > parentLine, 'the summary line follows the per-parent line');
  const prose = collapse(raw);
  assert.ok(
    prose.includes('Then write one summary line when this step evaluated the closing set: after a PR merge that had a `closingSet[]`, or after a no-PR local merge (its non-default-branch no-op included), where `the pushed merge commit` replaces `PR #{pr-number}` in the text:'),
    'the summary line is written only when the closing set was evaluated',
  );
  // #4549: after a PR merge there is no non-default-branch no-op, so the clause names it on the local merge only.
  assert.ok(!prose.includes('after a PR merge that had a `closingSet[]` (the non-default-branch no-op included)'), 'the PR-merge non-default no-op is gone from the summary clause');
  assert.ok(!prose.includes('whatever happened above'), 'the unconditional "whatever happened above" is gone');
  assert.ok(
    prose.includes('On the no-`closingSet[]` path above, the `(skipped)` SKIP line is the marker and no summary line follows, so a run carries one marker and "0 parent(s) closed" never follows a skipped step. Under `local-files`, or after exit 3, there is no line.'),
    'the no-closingSet path keeps the SKIP line as its only marker; the no-line cases are stated',
  );
  assert.ok(
    collapse(raw).includes('reconciler\'s `post-merge` check reads this line as the marker that the step already ran'),
    'the line is explained as the reconciler\'s marker',
  );
  // Tie the prose to the parser: build the entry the real writer would from the command's own --step.
  const step = /--step "([^"]+)"/.exec(line)[1];
  const text = /--text "([^"]+)"/.exec(line)[1].replace('{pr-number}', '4601').replace('{k}', '0');
  const now = new Date('2026-10-31T12:00:00Z');
  const bare = formatEntry({ status: 'AUTO', now, step, text, reversibility: 'n/a' });
  const withSpec = formatEntry({ status: 'AUTO', now, step, spec: 4599, text, reversibility: 'n/a' });
  assert.equal(hasPostMergeMarker(bare), true, `the marker parser reads: ${bare}`);
  assert.equal(hasPostMergeMarker(withSpec), true, `the marker parser reads: ${withSpec}`);
  // Go-red control: a renamed --step is no marker.
  assert.equal(hasPostMergeMarker(formatEntry({ status: 'AUTO', now, step: 'pr-first-merge Step 4.0c', text, reversibility: 'n/a' })), false);
});

test('#4599: the Parent-Gate Procedure says the reconciler closes a merge no session saw land', () => {
  const below = collapse(belowFloorBullet(read(GATE_REL)));
  assert.ok(
    below.includes(
      "A merge no session saw land is closed by the reconciler's `post-merge` check, which runs this gate's own code (`bin/lib/issues/parent-gate.js`, through `bin/lib/issues/below-floor-parent-close.js`) except that it skips the **Self-inclusion rule**; `/claude-tweaks:tidy`'s `parent-gate` backstop catches whatever that leaves open.",
    ),
    'the sub-issue-side bullet names the reconciler check and its one divergence',
  );
  assert.ok(!below.includes('backstop catches a merge no session saw land'), 'the "backstop catches the unseen merge" claim is gone');
});

test('#4599: the Self-inclusion rule names the reconciler as the one caller that skips it, and the code agrees', () => {
  const rule = collapse(section(read(GATE_REL), '## Self-inclusion rule', '\n## '));
  assert.ok(
    rule.includes(
      "**One caller skips this rule:** the reconciler's late `post-merge` pass judges closing records by live state (`selfInclude: false`), because it runs at least 10 minutes after the merge, when GitHub's state is the truth — a sub-issue a human reopened since keeps its parent open.",
    ),
    'the Self-inclusion rule states the reconciler exception',
  );
  // The clause's claims are the code's: post-merge passes selfInclude: false (pinned by running the check in
  // tests/bin-lib/reconcile/post-merge.test.js), and its 10 minutes is MERGE_GRACE_MS.
  const { MERGE_GRACE_MS } = require('../plugin/bin/lib/reconcile/post-merge');
  assert.equal(MERGE_GRACE_MS, 10 * 60 * 1000);
});

test('#4599: the auto-merge short-circuit and the journey name the reconciler before tidy', () => {
  const shortCircuit = collapse(read('wrap-up/auto-merge-short-circuit.md'));
  assert.ok(
    shortCircuit.includes(
      "an `auto:merge`'d sub-issue is exactly the population whose below-floor parent the reconciler's `post-merge` check closes first, with `_shared/github-pr-scan-acceptance.md`'s `parent-gate` backstop scope as the last resort.",
    ),
    'the short-circuit names the reconciler check, with tidy\'s backstop as the last resort',
  );
  assert.ok(!shortCircuit.includes("backstop scope exists to catch"), 'the "backstop exists to catch" framing is gone');
  // Dispatch's group auto-merge gate states the same population the same way (K6).
  const settle = collapse(read('dispatch/settle-and-merge.md'));
  assert.ok(
    settle.includes(
      "an `auto:merge`'d sub-issue is exactly the population whose below-floor parent the reconciler's `post-merge` check closes first, with `_shared/github-pr-scan-acceptance.md`'s `parent-gate` backstop scope as the last resort.",
    ),
    'settle-and-merge names the reconciler check, with tidy\'s backstop as the last resort',
  );
  assert.ok(!settle.includes('backstop scope exists to catch'), 'settle-and-merge drops the "backstop exists to catch" framing');
  const journey = collapse(readText(path.join(ROOT, 'docs', 'journeys', 'close-a-below-floor-decomposition-parent-4466.md')));
  assert.ok(
    journey.includes('is closed by the first reconcile pass at least 10 minutes after the merge (the `post-merge` check'),
    'the journey states when the reconciler closes an armed merge\'s parent',
  );
  assert.ok(!journey.includes('closed by the next reconcile pass'), 'the loose "next reconcile pass" is gone');
});

// #4549: the pre-change wordings, kept as the go-red controls for the pins below.
const PRE_4549_CVM_COUNT = "except for the one record-closing exception that contract's Never-reversible list names:";
const PRE_4549_NETWORK_SENTENCE = "The below-floor parent close the first bullet names is the other exception: its comment and its close are its two writes, under that bullet's restore contract";
const PRE_4549_NEVER_TAIL = "`/claude-tweaks:tidy`'s parent-side `Open parent gate` runs the same section but is not this exception, so it stays staged";

function assertCvmNamesTwoExceptions(cvm) {
  const c = collapse(cvm);
  assert.ok(
    c.includes("except for the two record-closing exceptions that contract's Never-reversible list names:"),
    'Close-via-merge points at the two named exceptions',
  );
  assert.ok(
    c.includes("`_shared/pr-first-merge-post-merge.md` Step 4.0's post-merge pass, which closes a PR's `Fixes` records after a confirmed PR merge into a base that is not the default branch"),
    'Close-via-merge names the Step 4.0 post-merge close as the second exception',
  );
}
function assertNeverNamesPostMergeClose(never) {
  for (const lit of [
    "The second exception is the post-merge close of a PR's `Fixes` records: `_shared/pr-first-merge-post-merge.md` Step 4.0's `closing-links.js --mode post-merge` pass, after a confirmed PR merge into a base that is not the repo's default branch, closes each still-open `Fixes`-span record with a close comment (#4549).",
    'It reproduces what GitHub does itself on the default branch, where the closing keyword fires; it never closes a `Refs` record or any record the PR does not name.',
    "a human runs `gh issue reopen {record}`, and the close comment plus the pass's `AUTO` line in `decisions.md` stay as the audit trail",
    'as long as this close is still its latest; a later promotion of the base into the default branch that carries the `Fixes` keyword can close it again, which is accepted',
    "satisfies the Reversibility floor's `high` for this one write, and only for that pass",
  ]) {
    assert.ok(never.includes(lit), `the Never-reversible list's second exception carries: ${lit}`);
  }
}
function assertNeverNetworkSentence(never) {
  assert.ok(
    never.includes("The two record closes the first bullet names are the other exceptions: each one's comment and close are its two writes, under that bullet's restore contract"),
    'the network-calls bullet names both record closes as exceptions',
  );
}

test('AC2.1: issue-claims\' Close-via-merge names the below-floor parent close and the Step 4.0 post-merge close as its two exceptions', () => {
  const cvm = section(read('_shared/issue-claims.md'), '## Close-via-merge', '## Dispatch authorization');
  assertCvmNamesTwoExceptions(cvm);
  // go-red: the same assertion function, run on the pre-#4549 wording, fails.
  const preCvm = cvm.replace(/except for the two record-closing exceptions[\s\S]*?each under the restore contract/, `${PRE_4549_CVM_COUNT} the Parent-Gate Procedure's **Close the parent below the floor** under the restore contract`);
  assert.notEqual(preCvm, cvm, 'go-red: the doctored text differs from the live section');
  assert.throws(() => assertCvmNamesTwoExceptions(preCvm), /two named exceptions/, 'go-red: the pre-change "one exception" wording fails the check');
  assert.ok(!collapse(cvm).includes('except where a procedure names its own exception'), 'the open-ended exception wording is gone');
  assert.ok(cvm.includes('**Close the parent below the floor**'));
  assert.ok(collapse(cvm).includes('under the restore contract that `_shared/auto-mode-contract.md` exception states'), 'points at the contract for the restore');
  assert.ok(!collapse(cvm).includes('under the restore contract stated there'), 'the referent-less pointer is gone');
});

test('AC2.1: the auto-mode contract names both exceptions (the below-floor parent close and the non-default-base Fixes close), each with its restore contract', () => {
  const contract = read('_shared/auto-mode-contract.md');
  const never = collapse(section(contract, '### Never-reversible (auto-FORBIDDEN, regardless of mode)', '## What `auto` silences'));
  for (const lit of [
    "- Closing or deleting work records — except the Parent-Gate Procedure's **Close the parent below the floor** (`wrap-up/verification-brief-parent-gate.md`) on a sub-issue-side entry: `_shared/pr-first-merge-post-merge.md` Step 4.0b's post-merge entry under `work-backend: github-issues`, or, under `work-backend: local-files`, wrap-up's execution step, the auto-merge short-circuit and dispatch's group auto-merge gate.",
    'Its restore contract — the pipeline never restores automatically: under `github-issues` a human runs `gh issue reopen {parent}` and the comment stays as the audit trail; a reopen deletes nothing, so it restores the parent whatever else has landed on it since, as long as this close is still its latest.',
    'Under `local-files` the close is an ordinary commit on the run\'s branch and `bin/lib/issues/local-store.js` has no reopen primitive, so a human clears the parent record\'s `closed`/`closedAt` facets',
    "This restore contract is what satisfies the Reversibility floor's `high` for this one write, and only for those sub-issue-side entries: `/claude-tweaks:tidy`'s parent-side `Open parent gate` runs the same section but is not this exception, so it stays staged",
  ]) {
    assert.ok(never.includes(lit), `Never-reversible list carries: ${lit}`);
  }
  assertNeverNamesPostMergeClose(never);
  assertNeverNetworkSentence(never);
  // go-red: the same assertion functions, run on the pre-#4549 text, fail.
  assert.throws(() => assertNeverNamesPostMergeClose(PRE_4549_NEVER_TAIL), /second exception carries/, 'go-red: the pre-change bullet has no second exception');
  assert.throws(() => assertNeverNetworkSentence(PRE_4549_NETWORK_SENTENCE), /both record closes/, 'go-red: the pre-change network-calls sentence fails the check');
  assert.ok(!never.includes(PRE_4549_NETWORK_SENTENCE), 'the one-exception network-calls sentence is gone');
  assert.ok(!never.includes('may delete that comment'), 'the restore no longer deletes the audit-trail comment');
  assert.ok(!never.includes("and only for Step 4.0b's entry"), 'the exception is no longer scoped to Step 4.0b alone');
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
  ['wrap-up/auto-merge-short-circuit.md', 'After a successful push, run `_shared/pr-first-merge-post-merge.md`'],
  ['flow/worktree-merge.md', '6. **Push the base branch once'],
];

function assertLocalPushSite(text, rel, opener) {
  const para = paragraph(text, opener);
  assert.ok(para.includes('--ref {integration-branch}'), `${rel}: the Step 4.1 invocation paragraph`);
  const a = para.indexOf('Step 4.0b');
  const b = para.indexOf('Step 4.1');
  assert.ok(a !== -1 && b > a, `${rel}: Step 4.0b (${a}) before Step 4.1 (${b})`);
}

test('AC2.1: every local-merge push site runs Step 4.0b before its Step 4.1', () => {
  for (const [rel, opener] of LOCAL_MERGE_SITES) assertLocalPushSite(read(rel), rel, opener);
  // local-merge-auto-finish runs no Step 4.1; its push step runs Step 4.0b alone.
  const autoFinish = paragraph(
    read('_shared/local-merge-auto-finish.md'),
    'After a successful push, run `_shared/pr-first-merge-post-merge.md` Step 4.0b',
  );
  assert.ok(collapse(autoFinish).includes('against the pushed merge commit (no PR, so `$MERGING_PR` is empty)'), 'local-merge-auto-finish step 7');
});

test('go-red: the retargeted short-circuit push-site paragraph fails without Step 4.0b', () => {
  const rel = 'wrap-up/auto-merge-short-circuit.md';
  const live = read(rel);
  const doctored = live.replace('Step 4.0b against the pushed merge commit', 'against the pushed merge commit');
  assert.notStrictEqual(doctored, live);
  assert.throws(() => assertLocalPushSite(doctored, rel, LOCAL_MERGE_SITES.find(([r]) => r === rel)[1]), /Step 4\.0b \(-1\)/);
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
  return found[0].split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT.replace(/\\/g, '/'));
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
// (above), #3 has one unscored sub-issue (fails closed, above). #4 is below the floor but one of its
// sub-issues is still open, so it is not due and prints no row: dropping the scan's `due` filter
// would surface it.
test('AC3.1: the GitHub parent-gate scan prints a Close row for a due below-floor parent', () => {
  const script = scanScript(
    section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: `parent-gate`', null),
    "'[parent-gate] #'",
  );
  const sub = (number, risk, state = 'CLOSED') => ({ number, state, labels: risk ? [{ name: `risk:${risk}` }] : [] });
  const gates = [
    { number: 1, title: 'Medium parent', parentLabels: [], subIssues: [sub(11, 'medium'), sub(12, 'low')] },
    { number: 2, title: 'High parent', parentLabels: [], subIssues: [sub(21, 'high')] },
    { number: 3, title: 'Unscored parent', parentLabels: [], subIssues: [sub(31, 'medium'), sub(32, null)] },
    { number: 4, title: 'Open-sub parent', parentLabels: [], subIssues: [sub(41, 'medium'), sub(42, 'low', 'OPEN')] },
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
  // A below-floor parent with one sub-issue left open: not due, so no row.
  parent(8, 'open-sub-parent', 'Open-sub parent');
  closedSub(9, 'sub-medium-c', 8, 'medium');
  writeRecord(recordFile(10, 'sub-open'), { title: 'sub-open', body: 'Sub body.', facets: { ...defaultFacets(), parent: 8, risk: 'low' } });

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
  // The end anchor is chosen per file, never from the text: '## Open parent gate' is the last H2 of
  // actions-local-files.md only, so a renamed heading fails loudly instead of widening the slice.
  for (const [rel, endHeading] of [
    ['tidy/actions-github-issues.md', '## Arm ready PR'],
    ['tidy/actions-local-files.md', null],
  ]) {
    const action = section(read(rel), '## Open parent gate', endHeading);
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
  assert.ok(gh.includes('no acceptance label (`_shared/work-record.md`, either spelling)'));
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

test('AC3.1: tidy stages the below-floor close because the contract exception covers only sub-issue-side entries', () => {
  // The contract's own scope line: a change to it must fail here, not only in the restatements.
  const contract = collapse(read('_shared/auto-mode-contract.md'));
  assert.ok(
    contract.includes("and only for those sub-issue-side entries: `/claude-tweaks:tidy`'s parent-side `Open parent gate` runs the same section but is not this exception, so it stays staged"),
    'the contract scopes the exception to sub-issue-side entries and excludes tidy',
  );
  const sites = [
    [
      collapse(read('tidy/scan-procedures.md')),
      'Below the oversight floor it instead posts a comment and closes the parent: the contract\'s exception for that write covers only the Parent-Gate Procedure\'s sub-issue-side entries, and this parent-side backstop is not one of them, so it stays staged',
      'or, below the oversight floor, posts a comment and closes the parent — an outward-facing GitHub API write that fails',
    ],
    [
      collapse(readText(path.join(ROOT, 'docs', 'skill-graph.md'))),
      'and, below the floor, because the contract\'s exception for posting a comment and closing the parent covers only the Parent-Gate Procedure\'s sub-issue-side entries (`_shared/pr-first-merge-post-merge.md` Step 4.0b\'s post-merge entry, and the pre-merge entries under `local-files`), never this parent-side backstop',
      'or, below the floor, posting a comment and closing the parent — is an outward-facing API write that fails',
    ],
    [
      collapse(read('tidy/actions-github-issues.md')),
      'The below-floor close is staged on different grounds: that contract\'s exception for its comment and close covers only the Parent-Gate Procedure\'s sub-issue-side entries, and this parent-side backstop is not one of them.',
      'The below-floor close is staged on the same grounds',
    ],
  ];
  for (const [text, clause, stale] of sites) {
    assert.ok(text.includes(clause), `below-floor staging reason: ${clause}`);
    assert.ok(!clauseFrom(text, clause).includes('regardless of how mechanical'), `no reversibility-floor claim in: ${clause}`);
    assert.ok(!text.includes(stale), `stale reason gone: ${stale}`);
    assert.ok(!text.includes("covers only `_shared/pr-first-merge-post-merge.md` Step 4.0b's post-merge entry"), 'the Step 4.0b-only scope is gone');
  }
  // The two tidy pointers name the contract for that exception, not the scan scope that never states it.
  assert.ok(
    collapse(read('tidy/scan-procedures.md')).includes("see `_shared/auto-mode-contract.md`'s Never-reversible list for that exception's scope"),
    'scan-procedures points at the contract',
  );
  assert.ok(
    collapse(read('tidy/actions-github-issues.md')).includes("`_shared/auto-mode-contract.md`'s Never-reversible list states that exception's scope."),
    'actions-github-issues points at the contract',
  );
});

// ---- AC5: the local-files close fence, executed against a real store ----

const HEADING = '## Closed below the oversight floor';

// Step 5's ```js fence: parentPath bound ahead of it, and the section handed over as a file the
// fence reads at `{parent-close-comment}` (the Write-tool handoff), never inlined into the source.
function localCloseScript(parentPath, sectionFile) {
  const step5 = section(closeSection(read(GATE_REL)), '**5. `work-backend: local-files`**', null);
  const fence = /```js\n([\s\S]*?)\n```/.exec(step5);
  assert.ok(fence, 'step 5 carries a js fence');
  assert.ok(fence[1].includes("fs.readFileSync('{parent-close-comment}', 'utf8')"), 'the fence reads the section from the handoff file');
  const body = fence[1]
    .split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT.replace(/\\/g, '/'))
    .split('{parent-close-comment}').join(sectionFile.replace(/\\/g, '/'));
  return `const parentPath = ${JSON.stringify(parentPath)};\n${body}`;
}

test('AC5.2: the local-files close fence closes the parent once with one heading section, however often it runs', () => {
  const { writeRecord, readRecord, closeRecord, defaultFacets } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'issues', 'local-store.js'));
  const cwd = mkTmp('bf-local-close-');
  // A title carrying a quote, a backtick and `${` — the characters inlining into JS source breaks on.
  const closeSectionText = `${HEADING}\n\nEvery sub-issue of this decomposition is closed.\n\n- 2 Only sub's \`code\` \${x}`;
  const sectionFile = path.join(cwd, 'parent-close-comment.md');
  fs.writeFileSync(sectionFile, `${closeSectionText}\n`);
  const headings = (file) => readRecord(file).body.split('\n').filter((l) => l.trim() === HEADING).length;
  const run = (file) => execFileSync('node', ['-e', localCloseScript(file, sectionFile)], { cwd, encoding: 'utf8' });
  const parentFile = (name) => path.join(cwd, 'specs', name);
  const parentFacets = { ...defaultFacets(), isParentIssue: true };

  // Open, no heading: two runs append once and close once.
  const fresh = parentFile('01-fresh-parent.md');
  writeRecord(fresh, { title: 'Fresh parent', body: 'Parent body.', facets: parentFacets });
  run(fresh);
  run(fresh);
  assert.equal(readRecord(fresh).facets.closed, true, 'fresh parent ends closed');
  assert.equal(headings(fresh), 1, 'fresh parent carries exactly one heading section');
  assert.ok(readRecord(fresh).body.includes("- 2 Only sub's `code` ${x}"), 'the listing line lands verbatim');

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

test('AC5.2: a sub-issue-side local-files close logs its auto-resolution through log-decision.js', () => {
  const step5 = section(closeSection(read(GATE_REL)), '**5. `work-backend: local-files`**', null);
  assert.match(step5, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status AUTO --step "Parent-Gate local-files close"/);
  assert.match(step5, /--reversibility "high \(clear the parent record's closed facets\)"/);
});

test('#4602: the transport mapping carries every row the parent close needs', () => {
  const t = read('_shared/github-write-transport.md');
  const row = (op) => t.split('\n').find((l) => l.startsWith(`| ${op} |`)) || '';
  const close = row('Close');
  for (const lit of ['`issue_write`', 'state_reason', '`completed`', '`not_planned`']) assert.ok(close.includes(lit), `Close row: ${lit}`);
  const get = row('Get a single issue by number');
  for (const lit of ['state_reason', 'closed_by_pull_requests']) assert.ok(get.includes(lit), `Get row: ${lit}`);
  const subIssues = row("List an issue's native sub-issues");
  for (const lit of ['`get_sub_issues`', 'perPage: 100']) assert.ok(subIssues.includes(lit), `Sub-issues row: ${lit}`);
  assert.ok(row("List an issue's comments").includes('perPage: 100'), 'comment reads are paged');
  assert.ok(row("Get an issue's native parent").includes('`get_parent`'));
  const login = row("Read the current identity's login");
  assert.ok(login.includes('gh api user') && login.includes('`get_me`'));
  const db = row("Read the repo's default branch");
  assert.ok(db.includes('defaultBranchRef') && db.includes('git remote show origin') && db.includes('_shared/integration-branch.md'));
});

// Every `gh` call shape the gate file and Step 4.0b issue, keyed to the MCP tool (or git read)
// its github-write-transport.md row names. A new gh call with no entry here fails the ratchet.
const GH_TO_MCP = [
  [/^gh api user\b/, '`get_me`'],
  [/^gh api\b.*sub_issues/, '`get_sub_issues`'],
  [/^gh issue view\b/, '`issue_read`'],
  [/^gh issue comment\b/, '`add_issue_comment`'],
  [/^gh issue close\b/, '`issue_write`'],
  [/^gh issue edit\b.*--add-label/, '`issue_write`'], // the only edit shape the gate issues; another flag fails as unmapped
  [/^gh issue reopen\b/, '`issue_write`'], // Step 4.0b's restore hint in its log-decision reversibility text
  [/^gh repo view\b/, 'git remote show origin'],
];
// Any `gh <subcommand>` — not a fixed list — so a new subcommand (`gh release`, `gh run`, …) with
// no GH_TO_MCP entry fails as "unmapped". Run over the gate file and Step 4.0b, the hits are all
// real calls (fenced command lines and inline code spans); no prose false positive needs excluding.
const ghCalls = (text) => [...text.matchAll(/\bgh [a-z][a-z-]*\b[^`\n]*/g)].map((m) => m[0]);

// The extractor above and `integration-branch-conformance`'s `/remote show origin/` read one line
// at a time, so a code span (or a `gh`/subcommand pair) wrapped across a newline slips past both.
// Returns the offending lines of `text`, ignoring fenced blocks: any non-fenced line with an odd
// backtick count (a span opened and not closed on that line), and any `gh` ending a line.
function brokenSpanLines(text) {
  const bad = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if ((line.match(/`/g) || []).length % 2 === 1 || /\bgh$/.test(line)) bad.push(line);
  }
  return bad;
}

test('#4602 AC2.1: every gh call in the Parent-Gate Procedure and Step 4.0b has a mapping the Transport paragraph names', () => {
  const gate = read(GATE_REL);
  const transport = collapse(paragraph(gate, '**Transport (#4602).**'));
  const step40b = section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1');
  const calls = [...ghCalls(gate), ...ghCalls(step40b)];
  assert.deepEqual(brokenSpanLines(gate), [], 'no inline code span in the gate file wraps across a line');
  assert.deepEqual(brokenSpanLines(step40b), [], 'no inline code span in Step 4.0b wraps across a line');
  assert.ok(calls.length >= 10, `found ${calls.length} gh calls — the extractor still sees the file`);
  for (const call of calls) {
    const hit = GH_TO_MCP.find(([re]) => re.test(call));
    assert.ok(hit, `unmapped gh call: ${call}`);
    if (!/^gh repo view/.test(call)) assert.ok(transport.includes(hit[1]), `Transport paragraph names ${hit[1]} for: ${call}`);
  }
  assert.ok(transport.includes('`_shared/github-write-transport.md`'));
  assert.ok(transport.includes('`get_parent`'), 'native parent resolution');
  assert.ok(transport.includes('`_shared/label-bootstrap.md`'), 'the label bootstrap states its MCP-path behavior');
  const pairings = [
    '`get_comments` for comments, paged per its row',
    'every `gh issue view` read',
    '`gh api user` is `get_me`',
    '`gh issue comment` is `add_issue_comment`',
    '`gh issue close` and `gh issue edit --add-label` are `issue_write`',
  ];
  for (const lit of pairings) assert.ok(transport.includes(lit), `Transport paragraph states the pairing: ${lit}`);
  for (const lit of ['uppercase', '`CLOSED`', '`COMPLETED`', '`REOPENED`', 'label names', 'the last of the references']) assert.ok(transport.includes(lit), `Transport paragraph normalizes the MCP shape: ${lit}`);
  const failOpen = collapse(paragraph(gate, '**Fail open on every `gh` call'));
  assert.ok(failOpen.includes('neither `gh` nor the GitHub MCP server is available'), 'fail open only when neither transport is available');
  assert.ok(!failOpen.includes('If `gh` is unavailable'), 'a gh-absent run with MCP no longer skips');
});

test('#4602 AC1.1: the close section and Step 4.0b cite the MCP path', () => {
  const close = section(read(GATE_REL), '## Close the parent below the floor', '## Compose the parent brief');
  // #4603: step 1's MCP sentence went with its reads. `get_me` and `get_comments` stay pinned in the
  // Transport paragraph (#4602 AC2.1's pairings); the `reopened` → `REOPENED` and `user.login`
  // normalization is the CLI's, pinned by tests/bin-lib/issues/mcp-parent-gate-shape.test.js's
  // `normalizes the MCP shape`.
  for (const lit of ['`_shared/github-write-transport.md`', '`state_reason`', '`not_planned`', 'never pass `labels`']) {
    assert.ok(close.includes(lit), `close section names ${lit}`);
  }
  const step40b = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  assert.ok(step40b.includes('`_shared/github-write-transport.md`'), 'Step 4.0b cites the mapping');
  assert.ok(step40b.includes('git remote show origin'), 'Step 4.0b default-branch read on a gh-absent run');
});

test('#4602: settle-and-merge\'s #205 paragraph lists the calls the Parent-Gate Procedure makes', () => {
  const p = collapse(paragraph(read('dispatch/settle-and-merge.md'), 'This blanket mapping also covers'));
  for (const lit of ['`gh issue close`', 'sub_issues', '`gh api user`', 'verification-brief-parent-gate.md', 'Transport (#4602)']) assert.ok(p.includes(lit), `names ${lit}`);
  // Derived from the gate file's own calls, so a call shape added there without a mention in the
  // Parent-Gate sentence (the earlier sentence names verification-brief.md's own calls) fails.
  const parentGateAt = p.indexOf('The Parent-Gate Procedure makes');
  assert.ok(parentGateAt !== -1, 'the Parent-Gate sentence is present');
  const parentGate = p.slice(parentGateAt);
  const named = (call) => (/sub_issues/.test(call) ? 'sub_issues' : call.split(' ').slice(0, 3).join(' '));
  for (const call of ghCalls(read(GATE_REL))) assert.ok(parentGate.includes(named(call)), `names ${named(call)} (gate call: ${call})`);
  assert.ok(!p.includes('No separate mapping table entry is needed'), 'the stale no-row claim is gone');
  assert.ok(!p.includes('is one of the three standard shapes'), 'the stale three-shapes claim is gone');
});

// ---- #4603: the Parent-Gate Procedure runs its gather and evaluate through bin/parent-gate.js ----

const RUN_CLI = '## Run the gate CLI';
const runCliSection = (gate) => section(gate, RUN_CLI, '## Evaluate the gate');
const step40bOf = () => section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1');
const SUB_ISSUES_PATH = 'issues/$PARENT_NUM/sub_issues';
const preChange4603Gate = preChangeSkillFile(GATE_REL, PRE_4603_SHA);

test('AC2.1 (#4603): the gate file no longer composes the sub-issue enumeration', () => {
  const gate = read(GATE_REL);
  assert.ok(!gate.includes(SUB_ISSUES_PATH), 'the raw gate text carries no sub_issues REST path');
  assert.ok(!collapse(gate).includes(collapse(SUB_ISSUES_PATH)), 'nor does the whitespace-collapsed text');
  assert.ok(runCliSection(gate).includes('bin/parent-gate.js'), 'the Run the gate CLI section runs the CLI');
});

test('AC2.1 (#4603) go-red control: the pre-#4603 gate composes the sub-issue enumeration', { skip: preChange4603Gate.skip }, () => {
  assert.ok(preChange4603Gate.text.includes(SUB_ISSUES_PATH));
  assert.ok(collapse(preChange4603Gate.text).includes(collapse(SUB_ISSUES_PATH)));
});

// The command lines that run the CLI, fenced or inline: only these are flag-checked, so a prose
// mention of a flag (`--risk-floor` in Evaluate, `--facts-json` in the Transport paragraph) is not.
const CLI_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js"';
const cliLines = (text) => text.split('\n').filter((l) => l.includes(CLI_COMMAND));

// The facts each invocation region must state: [name, region key, literal], matched over the
// collapsed `## Run the gate CLI` section (`cli`) or Step 4.0b (`pm`).
const INVOCATION_FACTS = [
  ['sub-issue-side line', 'cli', 'bin/parent-gate.js" --sub-issue {n} --closing'],
  ['parent-side line', 'cli', 'bin/parent-gate.js" --parent {parent-number} --idempotence'],
  ['facts file', 'cli', '--facts-json'],
  ['local-files backend', 'cli', '--backend local-files'],
  [
    'facts-json exit 2 fails open',
    'cli',
    '**Exit 2 under `--facts-json`** — it can only mean no GitHub remote for a qualified `--closing` token, an undeterminable repository root and working directory, or an unreadable or invalid `.claude-tweaks/policy.yml` (the stderr line names the file): a failing `gh` call under **Fail open on every `gh` call**, never the gh-absent path again, so the two paths cannot loop.',
  ],
  [
    'local-files exit is a reported failure',
    'cli',
    '**Under `work-backend: local-files`, any non-zero exit** — report the failure and stop that entry; never fail open.',
  ],
  [
    'a fail-open exit names the stderr line',
    'cli',
    "Whenever an exit fails open, quote the CLI's stderr line in the entry's output: exit 1 is a malformed invocation, a bug in the calling skill, and only that line tells it apart from a `gh` outage.",
  ],
  ['Step 4.0b line', 'pm', 'bin/parent-gate.js" --sub-issue {n}'],
  ['Step 4.0b idempotence', 'pm', '--idempotence'],
  ['Step 4.0b held', 'pm', '--held'],
  ['Step 4.0b merging PR', 'pm', '--merging-pr'],
];
const missingInvocationFacts = (regions) =>
  INVOCATION_FACTS.filter(([, key, lit]) => !regions[key].includes(lit)).map(([name]) => name);

// Exactly one sub-issue-side github-issues line (no --backend), and it reads no comments or login.
function assertSubIssueLineWithoutIdempotence(cli) {
  const lines = cliLines(cli).filter((l) => l.includes('--sub-issue') && !l.includes('--backend'));
  assert.equal(lines.length, 1, 'exactly one sub-issue-side github-issues command line');
  assert.ok(!lines[0].includes('--idempotence'), 'the pre-merge sub-issue-side line passes no --idempotence');
}

// Every ordered pair of markers appears, in order.
function requireOrder(text, markers) {
  let last = -1;
  for (const m of markers) {
    const at = text.indexOf(m);
    assert.notStrictEqual(at, -1, `marker missing: ${m}`);
    assert.ok(at > last, `${m} must come after the marker before it`);
    last = at;
  }
}
const CLI_ORDER = ['## Self-inclusion rule', RUN_CLI, '## Evaluate the gate'];

test('#4603: the gate file and Step 4.0b invoke bin/parent-gate.js', () => {
  const gate = read(GATE_REL);
  const regions = { cli: collapse(runCliSection(gate)), pm: collapse(step40bOf()) };
  assert.deepEqual(missingInvocationFacts(regions), [], 'every invocation fact is stated');
  // Each fact can go red: removing its literal from its own region reports it.
  for (const [name, key, lit] of INVOCATION_FACTS) {
    const doctored = { ...regions, [key]: regions[key].split(lit).join('') };
    assert.notEqual(doctored[key], regions[key], `go-red: the doctored ${key} text differs (${name})`);
    assert.ok(missingInvocationFacts(doctored).includes(name), `go-red: stripping the literal reports ${name}`);
  }
  const cli = runCliSection(gate);
  assertSubIssueLineWithoutIdempotence(cli);
  const line = cliLines(cli).find((l) => l.includes('--sub-issue') && !l.includes('--backend'));
  const doctored = cli.replace(line, `${line} --idempotence`);
  assert.notEqual(doctored, cli);
  assert.throws(() => assertSubIssueLineWithoutIdempotence(doctored), /passes no --idempotence/, 'go-red: an --idempotence on the pre-merge line fails');
  requireOrder(gate, CLI_ORDER);
  const runAt = gate.indexOf(RUN_CLI);
  const evalAt = gate.indexOf('## Evaluate the gate');
  const selfAt = gate.indexOf('## Self-inclusion rule');
  const swapped = gate.slice(0, selfAt) + gate.slice(runAt, evalAt) + gate.slice(selfAt, runAt) + gate.slice(evalAt);
  assert.notEqual(swapped, gate);
  assert.throws(() => requireOrder(swapped, CLI_ORDER), /must come after/, 'go-red: the section above Self-inclusion fails the order');
  const absent = gate.split(RUN_CLI).join('## Run it');
  assert.notEqual(absent, gate);
  assert.throws(() => requireOrder(absent, CLI_ORDER), /marker missing/, 'go-red: a missing section fails the existence half');
});

// Every --flag on a CLI command line, minus the flags USAGE names.
function unknownCliFlags(lines) {
  const { USAGE } = require('../plugin/bin/parent-gate');
  const known = new Set(USAGE.match(/--[a-z][a-z-]*/g));
  return lines.flatMap((l) => (l.match(/--[a-z][a-z-]*/g) || []).filter((f) => !known.has(f)));
}
const missingSpans = (text, names) => names.filter((n) => !text.includes('`' + n + '`'));

test('#4603: the prose names only the CLI\'s own flags, verdict fields and facts keys', () => {
  const { VERDICT_FIELDS } = require('../plugin/bin/lib/issues/parent-gate');
  const { FACTS_KEYS } = require('../plugin/bin/lib/issues/mcp-parent-gate-shape');
  const cli = runCliSection(read(GATE_REL));
  const lines = [...cliLines(cli), ...cliLines(step40bOf())];
  assert.ok(lines.length >= 3, `found ${lines.length} bin/parent-gate.js command lines`);
  assert.deepEqual(unknownCliFlags(lines), [], 'every flag on a command line is one USAGE names');
  // go-red: a doctored command line with a flag the CLI lacks fails; the same flag in prose does not.
  const withRepo = cli.replace(lines[0], `${lines[0]} --repo o/r`);
  assert.notEqual(withRepo, cli);
  assert.deepEqual(unknownCliFlags(cliLines(withRepo)), ['--repo'], 'go-red: --repo on a command line is unknown');
  const proseRepo = `${cli}\nThere is no \`--repo\` flag.\n`;
  assert.deepEqual(unknownCliFlags(cliLines(proseRepo)), [], 'a prose line naming --repo is not a command line');
  assert.equal(VERDICT_FIELDS.length, 12);
  assert.equal(FACTS_KEYS.length, 7);
  assert.deepEqual(missingSpans(cli, [...VERDICT_FIELDS, ...FACTS_KEYS]), [], 'every verdict field and facts key is a code span in the section');
  for (const name of ['skipped', 'parentComments']) {
    const stripped = cli.split('`' + name + '`').join(name);
    assert.notEqual(stripped, cli);
    assert.deepEqual(missingSpans(stripped, [...VERDICT_FIELDS, ...FACTS_KEYS]), [name], `go-red: dropping the ${name} span reports it`);
  }
});

const closeStep1 = (gate) => section(closeSection(gate), '**1. Idempotence', '**2. Compose the closing comment:**');

function assertStep1RoutesOnIdempotence(step1) {
  const { IDEMPOTENCE_VALUES } = require('../plugin/bin/lib/issues/parent-gate');
  for (const v of IDEMPOTENCE_VALUES) assert.ok(step1.includes('`' + v + '`'), `step 1 names ${v}`);
  assert.ok(!collapse(step1).includes('gh api user'), 'step 1 makes no login read of its own');
}

// The listing lines read the verdict's subIssues[]; the per-sub-issue fetch they once cited left with Enumerate's narration.
const LISTING_SOURCE = "`{title}` is the verdict's `subIssues[].title`.";
const PRE_FIX_LISTING_SOURCE = "`{title}` comes from that section's per-sub-issue fetch.";
function assertListingCitesVerdict(text) {
  const c = collapse(text);
  assert.ok(c.includes(LISTING_SOURCE), 'the listing title comes from the verdict');
  assert.ok(!c.includes('per-sub-issue fetch') && !c.includes('entry from that fetch'), 'no citation of the removed fetch');
}

test('#4603: the close listing lines cite the verdict, not a removed fetch', () => {
  assertListingCitesVerdict(closeSection(read(GATE_REL)));
  assert.throws(() => assertListingCitesVerdict(PRE_FIX_LISTING_SOURCE), /from the verdict/, 'go-red: the pre-fix sentence fails');
  assert.throws(() => assertListingCitesVerdict(`${LISTING_SOURCE} ${PRE_FIX_LISTING_SOURCE}`), /removed fetch/, 'go-red: a leftover citation beside the fix fails');
});

test('#4603: Close step 1 routes on the CLI\'s idempotence values', () => {
  assertStep1RoutesOnIdempotence(closeStep1(read(GATE_REL)));
});

// Step 4.0b's exit sentence must leave Run the gate CLI's exit-2 gh-absent retry in force: a bare
// "a non-zero CLI exit is a failing gh call" would skip the parent on a gh-absent local merge.
const STEP_40B_EXIT = "Any other non-zero CLI exit (after **Run the gate CLI**'s exit-2 `gh`-absent retry) is a failing `gh` call.";
const PRE_FIX_STEP_40B_EXIT = 'anything other than `merged`. A non-zero CLI exit is a failing `gh` call.';
function assertStep40bKeepsRetry(text) {
  const c = collapse(text);
  assert.ok(c.includes(STEP_40B_EXIT), 'Step 4.0b carves the exit-2 gh-absent retry out of its failing-call rule');
  assert.ok(!c.includes('. A non-zero CLI exit is a failing `gh` call.'), 'no unqualified non-zero-exit rule');
}

// Every Step 4.0b held number holds its parent for its own reason: `reopened[]` ones are open again,
// the other three wait on a hand reopen or close.
const HELD_SKIP =
  'A non-empty `held` skips the parent, named in the closing summary: a `reopened[]` sub-issue is open again, so the parent is not due, and a `failed[]`, `pendingClose[]` or `closeFailed[]` one waits on the hand reopen or close the inputs paragraph above names.';
const PRE_FIX_HELD_SKIP = 'A non-empty `held` is the skip the inputs paragraph above names: name the parent in the closing summary.';
const assertHeldSkip = (text) => assert.ok(collapse(text).includes(HELD_SKIP), 'the held skip names every held list accurately');

// Step 4.0b routes a no-parent verdict before the reconciler's order (whose first check, parentIssue,
// would read a no-parent verdict's null as "labels lack parent-issue"), and ties that no-op to its field.
const STEP_40B_ROUTING =
  "Route a `no-parent` verdict first: a record with no resolvable parent follows **Resolve the parent**'s no-parent branch. Route every other verdict in the reconciler's order. A parent whose labels lack `parent-issue` — the label tidy's `parent-gate` backstop selects on — is a no-op too, named in the closing summary. The verdict reports it as `parentIssue: false`.";
const PRE_FIX_STEP_40B_ROUTING =
  "Route the verdict in the reconciler's order. A parent whose labels lack `parent-issue` — the label tidy's `parent-gate` backstop selects on — is a no-op too, named in the closing summary. The verdict reports it as `parentIssue: false`.";
const assertStep40bRouting = (text) => assert.ok(collapse(text).includes(STEP_40B_ROUTING), 'Step 4.0b routes no-parent first and names parentIssue: false');

test('#4603: Step 4.0b routes no-parent first, then the reconciler\'s order, naming parentIssue: false', () => {
  assertStep40bRouting(step40bOf());
  assert.throws(() => assertStep40bRouting(PRE_FIX_STEP_40B_ROUTING), /routes no-parent first/, 'go-red: the pre-fix routing fails');
  const withoutField = STEP_40B_ROUTING.replace(' The verdict reports it as `parentIssue: false`.', '');
  assert.throws(() => assertStep40bRouting(withoutField), /names parentIssue: false/, 'go-red: dropping the field sentence fails');
});

test('#4603: Step 4.0b keeps the gh-absent retry and states the held skip accurately', () => {
  const step40b = step40bOf();
  assertStep40bKeepsRetry(step40b);
  assertHeldSkip(step40b);
  assert.throws(() => assertStep40bKeepsRetry(PRE_FIX_STEP_40B_EXIT), /carves the exit-2/, 'go-red: the unqualified sentence fails');
  assert.throws(() => assertStep40bKeepsRetry(`${STEP_40B_EXIT} ${PRE_FIX_STEP_40B_EXIT}`), /no unqualified/, 'go-red: the unqualified sentence beside the carve-out fails');
  assert.throws(() => assertHeldSkip(PRE_FIX_HELD_SKIP), /every held list/, 'go-red: the pre-fix held sentence fails');
});

// The computation the CLI now owns is not narrated in the prose, and the Transport paragraph no
// longer lists step 1's comment read (the CLI's `parentComments`) among the agent's `gh issue view` reads.
const CLI_NARRATION = [
  ['Enumerate', "## Enumerate the parent's sub-issues", '## Self-inclusion rule', 'no second per-sub-issue round-trip'],
  ['Enumerate', "## Enumerate the parent's sub-issues", '## Self-inclusion rule', 'to build the `subIssues` array'],
  ['Evaluate', '**Oversight-floor check (risk only, never size).**', '- **`exceeds: false`**', 'exceedsOversightFloor('],
  ['Evaluate', '**Oversight-floor check (risk only, never size).**', '- **`exceeds: false`**', 'maxRiskTier'],
  ['Transport', '**Transport (#4602).**', '**Fail open on every `gh` call', 'the comment reads in **Close the parent below the floor**'],
];
const narrationPresent = (gate) =>
  CLI_NARRATION.filter(([, start, end, lit]) => collapse(section(gate, start, end)).includes(lit)).map(([where, , , lit]) => `${where}: ${lit}`);

test('#4603: the gate prose does not narrate the computation the CLI owns', () => {
  assert.deepEqual(narrationPresent(read(GATE_REL)), []);
  assert.ok(read(GATE_REL).includes('**Oversight-floor check (risk only, never size).**'), 'the check keeps its label (verification-brief.md cites it)');
});

test('#4603 go-red control: the pre-#4603 gate narrates every one of them', { skip: preChange4603Gate.skip }, () => {
  assert.equal(narrationPresent(preChange4603Gate.text).length, CLI_NARRATION.length);
});

test('#4603 go-red control: the pre-#4603 Close step 1 reads the login itself', { skip: preChange4603Gate.skip }, () => {
  assert.throws(() => assertStep1RoutesOnIdempotence(closeStep1(preChange4603Gate.text)), /step 1 names already-closed/);
  assert.ok(collapse(closeStep1(preChange4603Gate.text)).includes('gh api user'));
});

// ---- #4770: a failed identity read counts trusted authors only, and the prose says so ----
//
// New prose, so no frozen pre-change excerpt exists: every go-red control strips exactly one fact's
// literal from the live region in memory and asserts the predicate reports exactly that fact.
const IDENTITY_NOTE_4770 = '`identity probe failed — close marker matched against trusted authors only`';
const TIDY_LINE_4770 = (tidy) => tidy.split('\n').find((l) => l.startsWith('- [x] Closed parent below the floor:') && l.includes('`github-issues`'));
const FACTS_4770 = [
  ['close-note', (g) => closeStep1(g), IDENTITY_NOTE_4770],
  ['never-skips', (g) => closeStep1(g), 'the CLI never skips the parent'],
  ['facts-me', (g) => section(g, '- `parentComments` —', 'The verdict carries one field each:'), '- `me` — `get_me`, recorded whole even when it fails'],
  ['facts-exception', (g) => section(g, '- `parentComments` —', 'The verdict carries one field each:'), 'If any MCP read other than `get_me` fails, write no file'],
  ['skipped-note', (g) => section(g, '- `skipped` —', 'Route on its exit code:'), 'plus the identity-probe degrade note when the login read failed or printed none'],
  ['tidy', (_g, t) => TIDY_LINE_4770(t), 'when the identity read fails'],
];
const missingFacts4770 = (gate, tidy, names = FACTS_4770.map(([n]) => n)) =>
  FACTS_4770.filter(([n, region, lit]) => names.includes(n) && !collapse(region(gate, tidy)).includes(lit)).map(([n]) => n);
const stripFact4770 = (gate, tidy, name) => {
  const [, region, lit] = FACTS_4770.find(([n]) => n === name);
  const hay = collapse(region(gate, tidy));
  assert.equal(hay.split(lit).length - 1, 1, `${name}: the literal occurs exactly once in its region`);
  // Strip from the whole (collapsed) document so the predicate re-reads the doctored region.
  const doctoredRegion = hay.replace(lit, '');
  assert.notEqual(doctoredRegion, hay);
  return FACTS_4770.filter(([n, r, l]) => n === name ? !doctoredRegion.includes(l) : !collapse(r(gate, tidy)).includes(l)).map(([n]) => n);
};
const goRed4770 = (name) => assert.deepEqual(stripFact4770(read(GATE_REL), read('tidy/SKILL.md'), name), [name], `go-red: dropping ${name} reports exactly it`);

test('#4770: a failed identity read counts trusted authors only and is noted', () => {
  assert.deepEqual(missingFacts4770(read(GATE_REL), read('tidy/SKILL.md'), ['close-note', 'never-skips']), []);
  assert.ok(!collapse(closeStep1(read(GATE_REL))).includes('gh api user'), 'step 1 still makes no login read of its own');
  goRed4770('close-note');
  goRed4770('never-skips');
});

test('#4770: the MCP facts list keeps a failed get_me', () => {
  assert.deepEqual(missingFacts4770(read(GATE_REL), read('tidy/SKILL.md'), ['facts-me', 'facts-exception']), []);
  goRed4770('facts-me');
  goRed4770('facts-exception');
});

test('#4770: the verdict\'s skipped field names the degrade note', () => {
  assert.deepEqual(missingFacts4770(read(GATE_REL), read('tidy/SKILL.md'), ['skipped-note']), []);
  goRed4770('skipped-note');
});

test('#4770: tidy\'s below-floor verify line accepts a trusted comment alone when the identity read fails', () => {
  assert.ok(TIDY_LINE_4770(read('tidy/SKILL.md')), 'the github-issues form exists');
  assert.deepEqual(missingFacts4770(read(GATE_REL), read('tidy/SKILL.md'), ['tidy']), []);
  goRed4770('tidy');
});

test('#4770: the prose note matches the code constant', () => {
  const { IDENTITY_PROBE_FAILED_NOTE } = require('../plugin/bin/lib/issues/parent-gate');
  const m = collapse(closeStep1(read(GATE_REL))).match(/`(identity probe failed[^`]*)`/);
  assert.ok(m, 'step 1 carries the note in backticks');
  assert.equal(m[1], IDENTITY_PROBE_FAILED_NOTE);
  // go-red: a respelled note in prose no longer equals the constant.
  assert.notEqual(m[1].replace('trusted authors only', 'trusted authors'), IDENTITY_PROBE_FAILED_NOTE);
});
