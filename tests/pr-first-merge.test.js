'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #411: merge-path conversion — every pr-first merge site converges on
// `_shared/pr-first-merge.md`. Prose-as-implementation, same convention as
// the other pr-first sub-issues' test files — pin the key claims against the
// actual file text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
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

test('Step 4 runs the release-status check before reconcile via git describe --contains, never stages a CHANGELOG backfill (#2257)', () => {
  const step4 = MERGE_POST_MERGE.indexOf('## Step 4: Post-merge reconcile');
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.ok(step4 > 0 && step5 > step4, 'Step 4 must precede Step 5');
  const section = MERGE_POST_MERGE.slice(step4, step5);
  assert.match(section, /### Step 4\.1: Which release carried this\?/, 'Step 4.1 subheading exists');
  assert.match(section, /### Step 4\.2: Reconcile/, 'Step 4.2 subheading exists');
  assert.match(section, /git describe --tags --contains --first-parent \{merge-sha\}/, 'Step 4.1 resolves via tag ancestry');
  assert.doesNotMatch(section, /release-backfill/, 'the retired backfill-staging mechanism must not remain');
  assert.doesNotMatch(section, /bin\/release\.js" status/, 'Step 4.1 no longer shells out to the bump-commit-walk subcommand');
  assert.match(section, /literal[\s\S]*string `unreleased`/, 'a non-zero exit reads as the literal string unreleased');
  const describeIdx = section.indexOf('git describe --tags --contains');
  const reconcile = section.indexOf('bin/hooks.js" reconcile');
  assert.ok(describeIdx >= 0 && reconcile >= 0, 'both calls must be present within Step 4');
  assert.ok(describeIdx < reconcile, 'the status check now runs before the reconcile call');
});

test('the three local-merge fallback sections route the post-merge release-status check to Step 4.1 (#678)', () => {
  assert.match(SETTLE, /pr-first-merge-post-merge\.md` Step 4\.1/);
  assert.match(WORKTREE_MERGE, /pr-first-merge-post-merge\.md` Step 4\.1/);
  assert.match(AUTO_MERGE, /pr-first-merge-post-merge\.md` Step 4\.1/);
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

test('/flow closing reports carry the release-status line verbatim (#678)', () => {
  const summary = read('plugin', 'skills', 'flow', 'summary-template.md');
  // The multi-spec closing template moved to multispec-summary.md in #724's
  // 20KB extraction — the release-status line travels with it.
  const multi = read('plugin', 'skills', 'flow', 'multispec-summary.md');
  const comments = read('plugin', 'skills', '_shared', 'pr-run-comments.md');
  assert.match(summary, /\*\*Release status:\*\* \{/, 'single-spec summary renders the release-status line');
  assert.match(multi, /\*\*Release status:\*\* \{/, 'multi-spec summary template renders the release-status line');
  assert.match(summary, /`unreleased`/, 'the human form is quoted verbatim');
  assert.match(comments, /`release-status`/, 'pr-run-comments.md lists the release-status comment kind');
});
