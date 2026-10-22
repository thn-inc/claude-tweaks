'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #411: merge-path conversion — every pr-first merge site converges on
// `_shared/pr-first-merge.md`. Prose-as-implementation, same convention as
// the other pr-first sub-issues' test files — pin the key claims against the
// actual file text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const MERGE_POST_MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge-post-merge.md');
const SETTLE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md');
// #552: the fast-lane merge mechanics (pr-first/local-merge branches, the
// #299 fix, and the Step 4.1 post-merge citation below) moved out of
// review-console.md into its own lazy-loaded sub-file.
const AUTO_MERGE = read('plugin', 'skills', 'wrap-up', 'auto-merge-short-circuit.md');
const WORKTREE_MERGE = read('plugin', 'skills', 'flow', 'worktree-merge.md');
const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const TWO_CALL_GATE = read('plugin', 'skills', 'dispatch', 'two-call-gate.md');
const DISPATCH_SKILL = read('plugin', 'skills', 'dispatch', 'SKILL.md');

// AC7: acceptance labeling before the merge step — asserted structurally,
// not only by prose, since a reordering here silently drops acceptance
// sign-off (the exact defect wrap-up/review-console.md's own history notes).
test('AC7: pr-first-merge.md places acceptance labeling (Step 1) before marking ready (Step 2) and merging (Step 3)', () => {
  const step1 = MERGE.indexOf('## Step 1: Acceptance labeling');
  const step2 = MERGE.indexOf('## Step 2: Mark the PR ready');
  const step3 = MERGE.indexOf('## Step 3: Attempt auto-merge');
  assert.ok(step1 > 0 && step2 > 0 && step3 > 0, 'all three steps must exist as located headings');
  assert.ok(step1 < step2, 'acceptance labeling must precede marking the PR ready');
  assert.ok(step2 < step3, 'marking ready must precede the merge attempt');
});

// #1465: a defensive ordering guard between curation-engine.md's apply step
// (Phase 2) and this file's own merge attempt (invoked from Phase 4's
// Auto-merge short-circuit) — asserted structurally, mirroring AC7's own
// positional-guard convention above, since this guard is only real
// protection if it actually sits between Step 1 (acceptance labeling) and
// Step 2 (mark ready), not merely mentioned somewhere in the file.
test('#1465: a curation-apply completeness guard sits between Step 1 and Step 2, checks worklist completeness, and fails loud (never silently retries)', () => {
  const step1 = MERGE.indexOf('## Step 1: Acceptance labeling');
  const guard = MERGE.indexOf('## Step 1.5: Curation-apply completeness guard');
  const step2 = MERGE.indexOf('## Step 2: Mark the PR ready');
  assert.ok(guard > 0, 'the guard section must exist as a located heading');
  assert.ok(step1 < guard && guard < step2, 'the guard must sit strictly between Step 1 and Step 2');
  const section = MERGE.slice(guard, step2);
  assert.match(section, /wrap-up-engine\.js" render --run-dir "\$PIPELINE_RUN_DIR" --section trace --strict/, 'reuses the existing render --strict completeness check, never a hand-rolled re-derivation');
  assert.match(section, /Exit `2`/, 'documents the failing exit code explicitly');
  assert.match(section, /merge blocked/i, 'a failing guard blocks the merge rather than proceeding');
  assert.doesNotMatch(section, /AskUserQuestion/, 'the guard must fail loud, never prompt mid-flow (this issue\'s own Gotcha)');
});

test('the precondition gate is the same one condition pr-run-comments.md already established', () => {
  assert.match(MERGE, /run-state\.json.*carries a `pr` object.*AND\s*\n?\s*`integration-model` resolves `pr-first`/s);
});

test('the tag mapping preserves both pre-#411 tags plus #715\'s manifesto-authorized tag for /help\'s metric', () => {
  assert.match(MERGE, /`\{tag\}` is `auto-merge`.*`fast-lane`.*`manifesto-authorized`/s);
  assert.match(MERGE, /github-pr-scan\.md.*triage-queue.*item 3/s);
});

test('an unrecognized gh pr merge error always takes the conservative ready+comment branch, never a guessed one', () => {
  assert.match(MERGE, /Never guess at an unfamiliar\s*\n?\s*error's meaning/);
});

test('the armed outcome never polls or waits, and defers cleanup to the reconciler', () => {
  assert.match(MERGE, /\*\*Do not poll or wait\*\*/);
  assert.match(MERGE, /reconciler.*completes cleanup later, on merged-PR evidence/s);
});

test('no git merge, commit, or push runs in the main checkout anywhere in this procedure', () => {
  assert.match(
    MERGE_POST_MERGE,
    /No `git merge`, `git commit`, or\s*\n?\s*`git push` runs in the main checkout anywhere in this procedure/,
  );
});

test('the conflict path allows exactly one update-from-base attempt, never autonomous resolution', () => {
  assert.match(MERGE, /Exactly \*\*one\*\* update-from-base attempt/);
  assert.match(MERGE, /stop, do not\s*\n?\s*attempt resolution/);
});

test('the outcome vocabulary table retires ready-to-merge and pr-opened with a stated reason', () => {
  assert.match(MERGE, /Replaces `ready-to-merge`/);
  assert.match(MERGE, /`pr-opened` \(retired/);
});

test('settle-and-merge.md routes the pr-first merge through the shared procedure inside the same Task call', () => {
  assert.match(SETTLE, /run `_shared\/pr-first-merge\.md`'s procedure now, in this same Task call/);
  assert.match(SETTLE, /there is no second thread, no\s*\n?\s*`OUTCOME: ready-to-merge` relay/);
});

test('settle-and-merge.md keeps a local-merge fallback section, explicitly scoped away from pr-first', () => {
  assert.match(
    SETTLE,
    /`integration-model: pr-first` groups never reach this section — their merge already ran above/,
  );
});

test('auto-merge-short-circuit.md fast-lane routes pr-first through the shared procedure and states the #299 fix', () => {
  assert.match(AUTO_MERGE, /run `_shared\/pr-first-merge\.md`'s\s*\n?\s*procedure now/);
  assert.match(AUTO_MERGE, /#299:/);
  assert.match(
    AUTO_MERGE,
    /a defect that simply cannot\s*\n?\s*recur once there is no checkout resolution step to get wrong/,
  );
});

test("auto-merge-short-circuit.md's retained local-merge branch reads the worktree path from run-state.json, not $RUN_DIR directly", () => {
  const parts = AUTO_MERGE.split('**`integration-model: local-merge`:**');
  const localMergeSection = parts[parts.length - 1];
  assert.ok(localMergeSection, 'local-merge branch must exist');
  assert.match(localMergeSection.slice(0, 4000), /require\('\$RUN_DIR\/run-state\.json'\)\.worktree/);
  assert.doesNotMatch(
    localMergeSection.slice(0, 2000),
    /git -C "\$RUN_DIR" (rev-parse|branch)/,
    '#299 regression: must never re-anchor git resolution on $RUN_DIR itself',
  );
});

test('worktree-merge.md routes pr-first reconciliation through the shared procedure, retiring the scratch-worktree ceremony for that path only', () => {
  assert.match(WORKTREE_MERGE, /reconcile by\s*\n?\s*readying and merging each one via `_shared\/pr-first-merge\.md`/);
  assert.match(
    WORKTREE_MERGE,
    /the `pr-first` path\s*\n?\s*above never needs it, since its own conflict path surfaces inside the run's own real worktree/,
  );
});

test('task-prompt.md reports the shared OUTPUT FORMAT vocabulary, with ready-to-merge disclaimed under pr-first and reported under local-merge', () => {
  // #434: the fixed OUTPUT FORMAT enum is shared by both integration models'
  // second-call templates, so it must list every value either model can
  // actually report — including `ready-to-merge`, which only local-merge
  // reports (pr-first's own prose immediately below disclaims it).
  assert.match(TASK_PROMPT, /OUTCOME: \{merged \| armed \| pending-review \| ready-to-merge \| failed \| blocked\}/);
  assert.match(TASK_PROMPT, /There is no `ready-to-merge` value\s*\n?\s*under this model/);
  assert.match(TASK_PROMPT, /report `ready-to-merge` when the group's Auto-merge gate/);
});

test('two-call-gate.md and dispatch/SKILL.md scope the ready-to-merge terminal path to local-merge only', () => {
  assert.match(TWO_CALL_GATE, /`integration-model: local-merge` only: the second call succeeds and reports `OUTCOME: ready-to-merge`/);
  // #434: SKILL.md Step 5 restated this as an explicit local-merge-scoped
  // clause (worktree-entry precondition) rather than a standalone "third
  // terminal point" sentence — the local-merge-only scoping of
  // `OUTCOME: ready-to-merge` survives, just inline in the `local-merge`
  // branch instead of its own sentence.
  assert.match(DISPATCH_SKILL, /Under `local-merge`, that also requires the worktree to have been torn down[\s\S]*?on `OUTCOME: ready-to-merge`\) Step 6's own merge-and-cleanup/);
});

// AC4 (grep-based per the issue's own acceptance criteria): every remaining
// `ready-to-merge` reference in skills/ lives inside a local-merge-scoped
// sentence or file, never presented as the default/only outcome.
test('AC4: every remaining "ready-to-merge" mention across skills/ is local-merge-scoped', () => {
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        if (!text.includes('ready-to-merge')) continue;
        // Every file with a hit must also mention local-merge (or be the new
        // canonical file itself, which only mentions it to say it's retired).
        if (!/local-merge/.test(text) && !full.endsWith('pr-first-merge.md')) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  }
  walk(path.join(ROOT, 'plugin', 'skills'));
  assert.deepStrictEqual(offenders, [], `files mentioning ready-to-merge without local-merge scoping: ${offenders.join(', ')}`);
});

test('Step 4 runs the tag-ancestry release-status check before reconcile (#2257 replaced the CHANGELOG-backfill staging mechanism)', () => {
  const step4 = MERGE_POST_MERGE.indexOf('## Step 4: Post-merge reconcile');
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.ok(step4 > 0 && step5 > step4, 'Step 4 must precede Step 5');
  const section = MERGE_POST_MERGE.slice(step4, step5);
  assert.match(section, /### Step 4\.1: Which release carried this\?/, 'Step 4.1 subheading exists');
  assert.match(section, /### Step 4\.2: Reconcile/, 'Step 4.2 subheading exists');
  assert.match(section, /git describe --tags --contains --first-parent --match 'v\*'/, 'Step 4.1 resolves via tag ancestry, not the retired bump-commit-walk');
  assert.doesNotMatch(section, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/release\.js" status --merge/, 'the old status-subcommand invocation must be fully retired, not left as a dual path');
  assert.doesNotMatch(section, /staged\/release-backfill-v\{version\}\.md/, '#2257: the release-backfill staging mechanism is retired entirely, no dual-path fallback');
  assert.match(section, /release status unavailable/, 'a genuine git-describe failure (not "no containing tag") still degrades, never silently reports merged');
  const describeCall = section.indexOf("git describe --tags --contains --first-parent --match 'v*'");
  const reconcile = section.indexOf('bin/hooks.js" reconcile');
  assert.ok(describeCall >= 0 && reconcile >= 0, 'both calls must be present within Step 4');
  assert.ok(describeCall < reconcile, 'the release-status check still runs before the reconcile call');
});

test('the three local-merge fallback sections route the post-merge release-status check to Step 4.1 (#678)', () => {
  assert.match(SETTLE, /pr-first-merge-post-merge\.md` Step 4\.1/);
  assert.match(WORKTREE_MERGE, /pr-first-merge-post-merge\.md` Step 4\.1/);
  assert.match(AUTO_MERGE, /pr-first-merge-post-merge\.md` Step 4\.1/);
});

// #3297: a merged run with no console.json and pending staged/ items skips
// reconcile with console-never-rendered-staged-pending. Step 4.2 must report it
// as needing human action, never as converged, while keeping the transient-failure
// sentence (AC2.1) intact.
test('AC1.1: Step 4.2 reports a console-never-rendered-staged-pending skip as needing human action, never as converging (#3297)', () => {
  const step42 = MERGE_POST_MERGE.indexOf('### Step 4.2: Reconcile');
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.ok(step42 > 0 && step5 > step42, 'Step 4.2 must precede Step 5');
  const section = MERGE_POST_MERGE.slice(step42, step5);
  assert.ok(section.includes('`console-never-rendered-staged-pending`'), 'the reason string must be named verbatim');
  assert.match(section, /needs human action/, 'the skip must be reported as needing human action');
  assert.match(section, /AUTO \{time\} — pr-first-merge Step 4\.2:[^\n]*console-never-rendered-staged-pending/, 'the Step 4.2 log line must name the reason');
  assert.match(section, /\$PIPELINE_RUN_DIR\/console\.json/, 'the skip must be decided by checking this run directly, not from the aggregate summary');
});

test('AC2.1: Step 4.2 still leaves a transient failure for the next trigger point (#3297)', () => {
  const step42 = MERGE_POST_MERGE.indexOf('### Step 4.2: Reconcile');
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.match(MERGE_POST_MERGE.slice(step42, step5), /is logged and left for the next trigger point/);
});

// #3866: reconcile's archive check moves this run's dir to the archive path, so a
// Step 4.2 decisions.md write to $PIPELINE_RUN_DIR afterwards fails (exit 3) or, by a
// hand append, recreates an un-archived dir. The archive-path resolution must sit
// before the "other run dir(s)" log instruction that now targets it.
test('#3866: Step 4.2 routes post-reconcile decisions.md lines to the archived run path, resolved before the other-run log line', () => {
  const step42 = MERGE_POST_MERGE.indexOf('### Step 4.2: Reconcile');
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.ok(step42 > 0 && step5 > step42, 'Step 4.2 must precede Step 5');
  const section = MERGE_POST_MERGE.slice(step42, step5);
  assert.match(section, /archive\/\{run-id\}\/`,\s+`_shared\/timing-render\.md`'s\s+archive-path\s+rule/, 'the archive path is cited with timing-render\'s archive-path rule');
  assert.match(section, /passes that archive path\s+as `--run`/, 'post-reconcile lines pass the archive path as --run');
  assert.match(section, /never `\$PIPELINE_RUN_DIR`/, 'the moved run dir is never written to');
  assert.match(section, /exits 3 on the moved path/, 'names the exit-3 consequence');
  assert.match(section, /recreate an un-archived run dir/, 'names the recreated-dir consequence');
  const resolved = section.indexOf('archive/{run-id}/');
  const other = section.search(/other run dir\(s\) need\s+human action/);
  assert.ok(resolved > 0 && other > resolved, 'the archive-path resolution must precede the other-run log instruction');
  assert.match(section, /log to the path resolved above \(else\s+`\$PIPELINE_RUN_DIR`\) and report\s+"\{N\} other run dir\(s\)/, 'the other-run log line targets the resolved path, falling back to $PIPELINE_RUN_DIR');
});

test('Deliverable 2: auto-merge-short-circuit records why it writes no console.json (#3297)', () => {
  const prFirst = AUTO_MERGE.indexOf('Fast-lane auto-merge: issue #{n}, assess-agent-autonomy verdict auto-merge (see RATIONALE), pr-first-merge outcome');
  const localMerge = AUTO_MERGE.indexOf('**`integration-model: local-merge`:**', prFirst);
  assert.ok(prFirst > 0 && localMerge > prFirst, 'the pr-first paragraph must precede the local-merge paragraph');
  const region = AUTO_MERGE.slice(prFirst, localMerge);
  assert.match(region, /console\.json/, 'the pr-first region must mention console.json');
  assert.match(region, /#3297/, 'the pr-first region must cite #3297');
});

// #1411 deliverable 4: pin Step 3 item 1's auto-merge-not-enabled classification
// against the literal captured GitHub GraphQL wording (PR #1401, 2026-08-24:
// `GraphQL: Auto merge is not allowed for this repository
// (enablePullRequestAutoMerge)`), and prove the branch it fires always
// degrades — never falls through to item 5's generic "anything else" branch,
// and never leaves an unhandled failure.

// The pre-#1411 Step 3 item 1 text — paraphrase only, no literal GitHub
// wording. Frozen as a string literal (not read from history) so the go-red
// proof below survives future edits to the live file
// (skill-prose-conformance-tests: freeze the bytes a change replaces).
const PRE_CHANGE_ITEM_1 = `1. **Command failed with an auto-merge-not-enabled signature** (stderr contains
   \`auto-merge\` and (\`not allowed\` or \`not enabled\`) — GitHub's own wording for the repository
   setting "Allow auto-merge" being off):`;

test('#1411: Step 3 item 1 names the literal captured GraphQL wording, not only the paraphrase', () => {
  const literal = 'Auto merge is not allowed for this repository';
  assert.ok(MERGE.includes(literal), 'live file must contain the literal captured GraphQL wording');
  assert.ok(
    !PRE_CHANGE_ITEM_1.includes(literal),
    'pre-change text must NOT contain the literal wording (proves the pin can go red) [IL-105]',
  );
});

test('#1411: the literal signature sits inside Step 3\'s auto-merge-not-enabled branch (item 1), not elsewhere', () => {
  const step3 = MERGE.indexOf('## Step 3: Attempt auto-merge');
  const conflictPath = MERGE.indexOf('## Conflict path');
  assert.ok(step3 > 0 && conflictPath > step3, 'Step 3 section must be locatable');
  const step3Body = MERGE.slice(step3, conflictPath);
  const item1 = step3Body.indexOf('1. **Command failed with an auto-merge-not-enabled signature**');
  const item2 = step3Body.indexOf('2. **Command failed with a checks-pending');
  assert.ok(item1 > 0 && item2 > item1, 'item 1 must precede item 2');
  const item1Body = step3Body.slice(item1, item2);
  assert.ok(
    item1Body.includes('Auto merge is not allowed for this repository'),
    "literal wording must be inside item 1's own text, not a different item",
  );
});

test('#1411: the auto-merge-not-enabled branch (item 1) always degrades — an immediate merge or Step 2.5\'s wait row, never item 5\'s generic fallback', () => {
  // Given the classification fires on item 1 (proven above), both
  // sub-branches item 1 itself names are a degrade, never an unhandled
  // failure or a fall-through to item 5's "anything else" branch.
  assert.match(MERGE, /under `merge-verification: off` only — degrade to an immediate merge/);
  assert.match(MERGE, /under `merge-when-green` or `wait` — do not merge immediately: degrade to Step 2\.5's `wait`/);
});

// #3521: PR #3450 (2026-10-18) captured a second arm-unavailable wording on this
// repo, and `enablePullRequestAutoMerge` alone (the arm mutation's name, which
// GitHub appends to every arm-unavailable failure of an `--auto` call) must match
// item 1 too. Pin item 1's lead paragraph against the frozen pre-change text, with
// the same slice anchors as the #1411 block above.
const PRE_3521_ITEM_1 = `1. **Command failed with an auto-merge-not-enabled signature** — stderr contains the literal
   captured GitHub GraphQL wording \`Auto merge is not allowed for this repository\` (captured
   verbatim on this repo, PR #1401, 2026-08-24: \`GraphQL: Auto merge is not allowed for this
   repository (enablePullRequestAutoMerge)\`), or the looser paraphrase — \`auto-merge\` and
   (\`not allowed\` or \`not enabled\`) — for a differently-worded GitHub response to the same
   repository setting ("Allow auto-merge") being off:`;

function item1Body() {
  const step3 = MERGE.indexOf('## Step 3: Attempt auto-merge');
  const conflictPath = MERGE.indexOf('## Conflict path');
  const step3Body = MERGE.slice(step3, conflictPath);
  const item1 = step3Body.indexOf('1. **Command failed with an auto-merge-not-enabled signature**');
  const item2 = step3Body.indexOf('2. **Command failed with a checks-pending');
  return step3Body.slice(item1, item2);
}

test('#3521 AC1.1 AC1.2: Step 3 item 1 carries the PR #3450 literal', () => {
  const body = item1Body();
  assert.ok(body.includes('Protected branch rules not configured for this branch'));
  assert.ok(body.includes('PR #3450'));
  assert.ok(body.includes('2026-10-18'));
  assert.ok(
    !PRE_3521_ITEM_1.includes('Protected branch rules not configured for this branch'),
    'pre-change text must NOT contain the PR #3450 literal (proves the pin can go red) [IL-105]',
  );
});

test('#3521 AC2.1: Step 3 item 1 names enablePullRequestAutoMerge alone as a matching token', () => {
  assert.match(item1Body(), /`enablePullRequestAutoMerge` alone/);
  assert.doesNotMatch(PRE_3521_ITEM_1, /`enablePullRequestAutoMerge` alone/, 'pre-change text must NOT name the token-alone match (proves the pin can go red) [IL-105]');
});

test('#3521: Step 3 item 1 states allow_auto_merge without branch protection still fails to arm', () => {
  const body = item1Body();
  assert.match(body, /`allow_auto_merge: true`/);
  assert.match(body, /branch protection or a ruleset/);
  assert.doesNotMatch(PRE_3521_ITEM_1, /`allow_auto_merge: true`/, 'pre-change text must NOT carry the allow_auto_merge sentence (proves the pin can go red) [IL-105]');
});

test('#3521: the token-alone match yields to item 3\'s and item 4\'s signatures', () => {
  assert.match(item1Body(), /unless item 3's or item 4's signature is also present/);
  assert.doesNotMatch(PRE_3521_ITEM_1, /unless item 3's or item 4's signature/, 'pre-change text must NOT carry the precedence clause (proves the pin can go red) [IL-105]');
});

// #3269: PR #3427 (2026-10-18) captured a third arm-unavailable wording — GitHub refuses to arm a PR it could merge right now. Pin it as a literal in item 1, with a frozen pre-change control.
const PRE_3269_ITEM_1 = `1. **Command failed with an auto-merge-not-enabled signature** — stderr contains the literal
   captured GitHub GraphQL wording \`Auto merge is not allowed for this repository\` (captured
   verbatim on this repo, PR #1401, 2026-08-24: \`GraphQL: Auto merge is not allowed for this
   repository (enablePullRequestAutoMerge)\`), or the second literal
   \`Protected branch rules not configured for this branch\` (captured verbatim on this repo,
   PR #3450, 2026-10-18: \`GraphQL: Pull request Protected branch rules not configured for this
   branch (enablePullRequestAutoMerge)\`), or the looser paraphrase — \`auto-merge\` and
   (\`not allowed\` or \`not enabled\`) — for a differently-worded GitHub response to the same
   repository setting ("Allow auto-merge") being off. \`enablePullRequestAutoMerge\` alone in the
   error text also matches, unless item 3's or item 4's signature is also present: it is the arm
   mutation's name, which GitHub appends to every arm-unavailable failure of an \`--auto\` call.
   \`allow_auto_merge: true\` alone, without
   branch protection or a ruleset on the base branch, still fails this way — the setting by
   itself does not make \`--auto\` armable (the Step 2.5 "Why \`--auto\` alone is not a wait"
   mechanism):`;

function carriesCleanStatus(text) {
  return text.includes('Pull request is in clean status') && text.includes('PR #3427');
}

test('#3269 AC3.1: Step 3 item 1 carries the PR #3427 clean-status literal', () => {
  const body = item1Body();
  assert.ok(carriesCleanStatus(body));
  assert.ok(body.includes('PR #3427, 2026-10-18'));
});

test('#3269 AC2.1: the clean-status pin goes red on the pre-change item 1 text', () => {
  assert.equal(carriesCleanStatus(PRE_3269_ITEM_1), false, '[IL-105]');
  assert.ok(PRE_3269_ITEM_1.includes('Protected branch rules not configured for this branch'), 'control text is the post-#3521 paragraph');
});

test('/flow closing reports carry the release-status line verbatim (#678)', () => {
  const summary = read('plugin', 'skills', 'flow', 'summary-template.md');
  // The multi-spec closing template moved to multispec-summary.md in #724's
  // 20KB extraction — the release-status line travels with it.
  const multi = read('plugin', 'skills', 'flow', 'multispec-summary.md');
  const comments = read('plugin', 'skills', '_shared', 'pr-run-comments.md');
  assert.match(summary, /\*\*Release status:\*\* \{/, 'single-spec summary renders the release-status line');
  assert.match(multi, /\*\*Release status:\*\* \{/, 'multi-spec summary template renders the release-status line');
  assert.match(summary, /not yet in a release — bump pending/, 'the human form is quoted verbatim');
  assert.match(comments, /`release-status`/, 'pr-run-comments.md lists the release-status comment kind');
});

test('#3028: human-approved is registered in Step 3, named at close-out step 5, and excluded from the auto-merge metric', () => {
  const step3 = MERGE.split('## Step 3: Attempt auto-merge')[1];
  assert.ok(step3, 'Step 3 must exist');
  assert.match(step3, /`human-approved`/, 'Step 3 registers the human-approved tag');
  assert.match(step3, /--scope \{scope\}/, 'Step 3 tells callers to append --scope when the convention requires it');
  const closeOut = read('plugin', 'skills', 'dispatch', 'close-out.md');
  const step5 = closeOut.split('5. **On confirmation — merge.**')[1].split('\n6. ')[0];
  assert.match(step5, /`\{tag\}` = `human-approved`/, 'close-out step 5 names its tag');
  const scan = read('plugin', 'skills', '_shared', 'github-pr-scan.md');
  const item3 = scan.split('3. **Auto-merged this week**')[1].split('```bash')[0];
  assert.match(item3, /`\[human-approved\]`[\s\S]*excluded/, 'triage-queue item 3 documents the exclusion');
  const jq = scan.split('3. **Auto-merged this week**')[1].split('```bash')[1].split('```')[0];
  assert.doesNotMatch(jq, /human-approved/, 'the metric jq filter is unchanged — human-approved is not counted');
});

// #3347: the integration branch is never rewritten. The rule is stated once, in its own
// section; the dispatch second-call template cites it through the composed merge bundle.
function assertNoRewriteRule(text) {
  const start = text.indexOf('## Never rewrite the integration branch');
  assert.ok(start !== -1, 'the "## Never rewrite the integration branch" heading must exist');
  const next = text.indexOf('\n## ', start + 1);
  const slice = text.slice(start, next === -1 ? undefined : next);
  for (const re of [/force-push/, /\breset\b/, /commit-tree/, /DONE_WITH_CONCERNS/, /decisions\.md/, /#3325/]) {
    assert.match(slice, re);
  }
}

// Frozen pre-#3347 Precondition section (through the start of Step 1), byte-for-byte from 294eac138.
const PRE_3347_MERGE_HEAD = `## Precondition

\`run-state.json\` carries a \`pr\` object (\`_shared/pr-run-comments.md\`'s gate) AND
\`integration-model\` resolves \`pr-first\` for this run. Absent either — fall to the citing file's
local-merge section instead of this procedure.

`;

test('AC1.1: pr-first-merge.md states the integration-branch no-rewrite rule', () => {
  assertNoRewriteRule(MERGE);
});

test('AC1.1 go-red: the pre-#3347 file (no such section) fails the same assertion', () => {
  assert.throws(() => assertNoRewriteRule(PRE_3347_MERGE_HEAD));
});

test('AC1.1 go-red: a heading with a body that drops the rule fails on its tokens, not just the heading check', () => {
  const stub = '## Never rewrite the integration branch\n\nBe careful with the integration branch.\n\n## Step 1: next\n';
  assert.throws(() => assertNoRewriteRule(stub), /force-push/);
});

test('AC1.2: task-prompt.md second-call template cites the rule via the merge bundle, not a restatement', () => {
  const second = TASK_PROMPT.slice(TASK_PROMPT.indexOf('## Second call'));
  const citing = second.split('\n').filter((l) => l.includes('"Never rewrite the integration branch"'));
  assert.equal(citing.length, 1, 'exactly one citing line in the second-call slice');
  assert.match(citing[0], /`\{minted-run-dir\}\/context\/merge\.md`'s "Never rewrite the integration branch"/);
  assert.match(citing[0], /\(if that bundle is absent, read `_shared\/pr-first-merge\.md` directly\)/);
  assert.doesNotMatch(second, /force-push/, 'the second-call slice cites the rule, it does not restate it');
});

// #3607: a PR that conflicts with its base gets no `pull_request` workflow runs,
// so its rollup is empty — Step 2.5 must read the merge state before treating
// that empty rollup as pending, or it watches 15 minutes and parks as
// checks-pending-timeout instead of reaching the Conflict path. Frozen
// pre-change bullet below proves the pins can go red [IL-105].
const PRE_3607_EMPTY_ROLLUP = `- An **empty rollup** → depends on the lever: under \`merge-when-green\` or \`wait\` the repo has PR CI
  by construction (\`_shared/policy-schema-coverage.md\`'s coverage block derives those values only when a
  \`pull_request\`-triggered workflow exists, and an explicit value is a statement that CI is
  expected), so an empty rollup means the checks have not *reported yet* — GitHub populates it
  seconds after a push, not instantly — and reads as **pending**, never green; under \`off\` it is
  simply "no CI" and proceeds as green.`;

function step25Section() {
  return MERGE.slice(MERGE.indexOf('## Step 2.5: Merge-verification gate'), MERGE.indexOf('## Step 3:'));
}

function emptyRollupBullet() {
  const section = step25Section();
  const start = section.indexOf('- An **empty rollup**');
  assert.ok(start !== -1, 'Step 2.5 must carry the empty-rollup bullet');
  return section.slice(start, section.indexOf('\n- Otherwise', start));
}

test('#3607: the Step 2.5 state read fetches mergeable alongside mergeStateStatus', () => {
  const section = step25Section();
  assert.ok(section.includes('--json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup'));
  assert.ok(section.includes('those five fields'), 'the parse-failure bullet must count the widened field list');
});

test('#3607 AC1: an empty rollup reporting DIRTY or CONFLICTING routes to the Conflict path before any pending read', () => {
  const bullet = emptyRollupBullet();
  for (const needle of ['`mergeStateStatus: DIRTY`', '`mergeable: CONFLICTING`', '**Conflict path**', 'checks-pending-timeout']) {
    assert.ok(bullet.includes(needle), `empty-rollup bullet missing ${needle}`);
  }
  const dirty = bullet.indexOf('DIRTY');
  const pending = bullet.indexOf('reads as **pending**');
  const off = bullet.indexOf('under `off`');
  assert.ok(dirty < pending && pending < off, 'the conflict routing precedes the lever split, so it applies under every lever value');
  assert.ok(!PRE_3607_EMPTY_ROLLUP.includes('DIRTY'), 'pre-change bullet must NOT route DIRTY (proves the pin can go red) [IL-105]');
});

test('#3607 AC2: an empty rollup with any other merge state keeps the pending read', () => {
  const bullet = emptyRollupBullet();
  assert.ok(bullet.includes('reads as **pending**, never green'));
  assert.ok(bullet.includes('under `off` it is\n  simply "no CI"') || bullet.includes('under `off` it is simply "no CI"'));
  const conflictSentence = bullet.slice(0, bullet.indexOf('reads as **pending**'));
  assert.ok(!conflictSentence.includes('UNKNOWN'), 'only DIRTY / CONFLICTING route to the Conflict path — UNKNOWN (mergeability still computing) stays pending');
});

test('#3607: a clean update-from-base entered from Step 2.5 re-enters Step 2.5, not Step 3', () => {
  const conflict = MERGE.slice(MERGE.indexOf('## Conflict path'), MERGE.indexOf('## Outcome vocabulary'));
  assert.ok(conflict.includes('entered from Step 2.5'), 'Conflict path must name its Step 2.5 entry');
  assert.ok(conflict.includes('re-enter Step 2.5 from the top'), 'a pushed head from a Step 2.5 entry needs its own CI read before any merge');
});
