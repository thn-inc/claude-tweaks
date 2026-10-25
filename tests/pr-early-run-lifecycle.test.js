'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #409: a pr-first run is born public — draft PR at run start, one push +
// checklist flip per phase exit, thereafter. The procedure is prose, not
// code, so prose is what has to be pinned — these tests catch the doc
// drifting out from under the deliverables/ACs it was written to satisfy.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const LIFECYCLE = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const GIT_DISCIPLINE = read('plugin', 'skills', '_shared', 'git-discipline.md');
const WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');
const TEST_SKILL = read('plugin', 'skills', 'test', 'SKILL.md');
// /review's Step 7 (phase exit) lives in the code-mode-steps.md sub-file since the #887
// dispatcher split — concatenate so this asserts against the text wherever it lives.
const REVIEW_SKILL =
  read('plugin', 'skills', 'review', 'SKILL.md') +
  '\n' +
  read('plugin', 'skills', 'review', 'code-mode-steps.md');
const STEPS_AND_GATES = read('plugin', 'skills', 'flow', 'steps-and-gates.md');
const WRAP_EXEC = read('plugin', 'skills', 'wrap-up', 'execution-and-verification.md');
const HOOKS_JS = read('plugin', 'bin', 'hooks.js');
// #2002 split the Phase-checklist update / Pre-merge title-description refresh procedures
// (and the merge-time gh-absent degrade row) out of LIFECYCLE into their own file — every
// phase-exit citer names both files now: the phase-exit push rule stays in LIFECYCLE's sibling
// `git-discipline.md`, but the checklist-update procedure itself lives here.
const CHECKLIST_REFRESH = read('plugin', 'skills', '_shared', 'pr-checklist-refresh.md');

test('the run marker is the unconditional first line of the PR body, with its plain-text companion immediately after', () => {
  assert.match(
    LIFECYCLE,
    /<!-- claude-tweaks-run: \{run-id\} -->\nclaude-tweaks-run: \{run-id\}\n\n### Spec summary/,
    'the sweep and reconciler key on the HTML-comment marker for a gh-present recognition; the plain-text companion (#929) is what a gh-absent MCP read sees instead, since the HTML-comment form is invisibly stripped from that read path',
  );
});

test('the phase checklist carries a plain-text delimiter pair alongside the HTML-comment pair (#929)', () => {
  assert.match(LIFECYCLE, /\[claude-tweaks-phases-start\]/);
  assert.match(LIFECYCLE, /\[claude-tweaks-phases-end\]/);
});

test('the push at run start is its own Bash call, never chained', () => {
  assert.match(
    LIFECYCLE,
    /git -C "\{worktree-path\}" push origin \{branch\}/,
    'the worktree-always gate denies a chained push entirely (IL-33)',
  );
});

test('run start checks for an existing PR by state before creating one, and distinguishes open from closed/merged', () => {
  assert.match(
    LIFECYCLE,
    /gh pr list --repo \{host\}\/\{owner\}\/\{repo\} --head \{branch\} --state all --json number,url,state,isDraft/,
    'a resumed or retried run must not duplicate a PR — state:all is required to see the closed/merged case and fall through to creation rather than misreading it as a live match',
  );
  assert.match(LIFECYCLE, /Never flip an already-non-draft open PR back to draft/);
});

test('identity resolution is host-qualified, so every --repo in this file works on GitHub Enterprise (#2021)', () => {
  assert.match(LIFECYCLE, /Resolve `\{host\}\/\{owner\}\/\{repo\}` once: `gh repo view --json nameWithOwner,url`/);
  assert.match(LIFECYCLE, /gh pr create --repo \{host\}\/\{owner\}\/\{repo\} --draft --base \{integration-branch\}/);
  assert.doesNotMatch(
    LIFECYCLE,
    /--repo \{owner\}\/\{repo\}/,
    'no --repo in this file should still be the bare (non-host-qualified) form',
  );
});

test('the phase checklist is delimited by HTML-comment markers for reliable re-composition', () => {
  assert.match(LIFECYCLE, /<!-- phases-start -->/);
  assert.match(LIFECYCLE, /<!-- phases-end -->/);
});

test('Fixes lines are safe because the PR stays draft until gates pass, not because of a scope guard', () => {
  assert.match(
    LIFECYCLE,
    /GitHub blocks merging a draft by default/,
    'unlike the retired dispatch-only durability procedure this file replaced (IL-128), whose PR opened only after review already passed and used Refs, this one opens before any gate has run',
  );
  assert.match(LIFECYCLE, /Fixes #\{n\}/);
});

test('the resume path re-verifies a recorded PR against GitHub before trusting it', () => {
  assert.match(
    LIFECYCLE,
    /gh pr view \{recorded-number\} --repo \{host\}\/\{owner\}\/\{repo\} --json state,isDraft,url/,
    'the branch could have been force-pushed or the PR closed since an earlier phase recorded it — trusting run-state.json blindly would silently skip the checklist update',
  );
});

test('phase-checklist updates degrade the same way phase-exit pushes do: log and continue, never block', () => {
  assert.match(CHECKLIST_REFRESH, /Best-effort, like the phase-exit push it follows/);
});

test('the skip/degrade table names local-merge, push failure, gh-create failure, gh-absent, and offline as distinct rows', () => {
  for (const needle of [
    'integration-model: local-merge',
    'Push at run start fails',
    '`gh pr create` fails twice',
    '`gh` absent',
    'Offline / no `origin` remote',
  ]) {
    assert.ok(LIFECYCLE.includes(needle), `skip/degrade table missing a row for: ${needle}`);
  }
});

test('gh-absent now has a documented MCP fallback for PR create/update, using the dual-marker scheme (#929)', () => {
  assert.match(
    LIFECYCLE,
    /mcp__github__create_pull_request.*update_pull_request.*documented fallback|documented fallback.*mcp__github__create_pull_request/s,
    '_shared/github-write-transport.md now documents a PR create/update exception — #929 replaced the stale "no MCP fallback" claim once the dual-marker scheme made a gh-absent PR recognizable',
  );
});

test('record-pr is cited as the sanctioned run-state write path, not a direct write', () => {
  assert.match(LIFECYCLE, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-pr \{number\} \{url\}/);
  assert.match(LIFECYCLE, /run-state is written\s*\n?\s*only through `hooks\.js` verbs/);
});

test('git-discipline.md states the phase-exit push rule once, cites the spike headroom, and never persists a degrade flag', () => {
  assert.match(GIT_DISCIPLINE, /## Phase exit — one `phase-exit\.js` call/);
  assert.match(GIT_DISCIPLINE, /≥50× headroom/);
  assert.match(
    GIT_DISCIPLINE,
    /never a flag written to `run-state\.json` that would suppress the \*next\*\s+phase's own push attempt/,
    'degradation must be per-attempt — a persisted flag would permanently disable pushes for the rest of the run after one transient failure',
  );
  assert.match(GIT_DISCIPLINE, /`local-merge` runs keep today's behavior: no phase-exit push, one push at finish/);
});

test('build/worktree-setup.md Step 6 cites the lifecycle file rather than restating its procedure', () => {
  assert.match(WORKTREE_SETUP, /Open the draft PR \(`integration-model: pr-first` only\)/);
  assert.match(WORKTREE_SETUP, /_shared\/pr-early-run-lifecycle\.md/);
});

test('build/SKILL.md invokes worktree-setup.md Step 6 immediately after the materialize commit', () => {
  assert.match(
    BUILD_SKILL,
    /Immediately after the materialize commit, in `worktree` mode only:\*\* run `build\/worktree-setup\.md` Step 6/,
  );
});

test('every phase-exit citation (build, test, review, polish via steps-and-gates, wrap-up) names both canonical files', () => {
  for (const [label, text] of [
    ['build/SKILL.md', BUILD_SKILL],
    ['test/SKILL.md', TEST_SKILL],
    ['review/SKILL.md + code-mode-steps.md', REVIEW_SKILL],
    ['flow/steps-and-gates.md (polish)', STEPS_AND_GATES],
  ]) {
    assert.match(text, /_shared\/git-discipline\.md/, `${label} must cite the phase-exit push rule`);
    assert.match(text, /_shared\/pr-checklist-refresh\.md/, `${label} must cite the checklist-update procedure`);
  }
});

test('wrap-up\'s phase exit explicitly defers merge-readiness to the merge-path sub-issue, not this one', () => {
  assert.match(WRAP_EXEC, /_shared\/git-discipline\.md/);
  assert.match(WRAP_EXEC, /_shared\/pr-checklist-refresh\.md/);
  assert.match(
    WRAP_EXEC,
    /does not mark the PR ready for merge or touch its draft state — that\s*\ntransition belongs to the merge-path sub-issue/,
  );
});

test('wrap-up does not duplicate the Fixes lines already carried by the draft PR body under pr-first', () => {
  assert.match(
    WRAP_EXEC,
    /no `Fixes` line here/,
    'the draft PR already carries one Fixes line per record from run start — a second, differently-scoped set here would risk disagreeing with it',
  );
});

test('#2002: pr-checklist-refresh.md carries the Phase-checklist update, Pre-merge refresh, and merge-time gh-absent degrade sections split out of LIFECYCLE', () => {
  assert.match(CHECKLIST_REFRESH, /## Phase-checklist update \(every phase exit\)/);
  assert.match(CHECKLIST_REFRESH, /## Pre-merge title\/description refresh/);
  assert.match(CHECKLIST_REFRESH, /## Merge-time gh-absent degrade/);
  // LIFECYCLE itself no longer carries these sections — moved, not duplicated.
  assert.doesNotMatch(LIFECYCLE, /## Phase-checklist update \(every phase exit\)/);
  assert.doesNotMatch(LIFECYCLE, /## Pre-merge title\/description refresh/);
});

test('#1712: the skip rule names the multi-spec deferral to the pre-merge refresh', () => {
  assert.match(LIFECYCLE, /In\s+a\s+\*\*multi-spec\*\*\s+run.*never removes the row on its\s+own/s);
  assert.match(LIFECYCLE, /`_shared\/pr-checklist-refresh\.md`'s Pre-merge title\/description\s+refresh removes it once/);
});

test('#1712: pr-checklist-refresh.md carries the deferred multi-spec polish-row removal at pre-merge', () => {
  assert.match(CHECKLIST_REFRESH, /Multi-spec\s+deferred polish-row removal/);
  assert.match(CHECKLIST_REFRESH, /A single-record run never reaches this branch/);
});

test('#1712: multispec-pr-checklist.md carries the run-level polish-row paragraph', () => {
  const MULTISPEC_PR_CHECKLIST = read('plugin', 'skills', 'flow', 'multispec-pr-checklist.md');
  assert.match(MULTISPEC_PR_CHECKLIST, /The `polish` row is a run-level, not first-spec, decision \(#1712\)/);
});

// #3319 retired #1712's creation-time polish-row omission: the composer never implemented it,
// and tests/bin-lib/flow/pr-body.test.js now pins all five rows for an all-backend run. Scan
// paragraph by paragraph — "omit" near "polish" and "creation"/"created" (and other creat- forms),
// case-insensitive — so a reworded restatement of the rule goes red, not only the exact old sentence.
test('#3319: no file states a creation-time polish-row omission rule', () => {
  const files = {
    'pr-early-run-lifecycle.md': LIFECYCLE,
    'flow/steps-and-gates.md': STEPS_AND_GATES,
    'flow/multispec-pr-checklist.md': read('plugin', 'skills', 'flow', 'multispec-pr-checklist.md'),
  };
  for (const [name, text] of Object.entries(files)) {
    const offending = text
      .split(/\n\s*\n/)
      .filter((p) => /\bomit(s|ted|ting)?\b/i.test(p) && /\bpolish\b/i.test(p) && /\bcreat(e|ed|es|ing|ion)\b/i.test(p));
    assert.deepEqual(offending, [], `${name} still states a creation-time polish-row omission`);
  }
});

test('#3319: flow/multi-spec.md no longer makes the polish row conditional at creation', () => {
  const MULTI_SPEC = read('plugin', 'skills', 'flow', 'multi-spec.md');
  assert.doesNotMatch(MULTI_SPEC, /present if any record in the run can run polish/);
  assert.match(MULTI_SPEC, /present from PR creation/);
});

test('#3319: steps-and-gates.md phase-exit paragraph routes a non-frontend polish skip through the would-be exit', () => {
  assert.match(
    STEPS_AND_GATES,
    /a non-frontend `surface:`[^\n]*a single-record run removes the row at polish's would-be exit[^\n]*In a multi-spec run that would-be-exit removal is deferred instead/,
  );
});

test('bin/hooks.js record-pr verb writes run-state.json.pr through writeRunState, mirroring record-worktree', () => {
  assert.match(HOOKS_JS, /'record-pr': \{[^}\n]*\brun: runRecordPr\b/);
  assert.match(HOOKS_JS, /^async function runRecordPr\(argv\) \{/m);
  // Anchored on the property this test is named for — run-state reaches disk
  // only through the sanctioned `writeRunState` writer (CLAUDE.md's
  // write-ownership rule), and the field it writes is `pr` — rather than on the
  // byte-literal object that used to follow it. #1672 added an optional
  // `branch` member to that object, and the old literal pin failed only at
  // full-suite time on a branch whose own targeted suites were green, which is
  // the byte-pin hazard `docs/incident-log.md` already records. The two
  // original members are asserted separately below, so dropping either still
  // goes red.
  assert.match(HOOKS_JS, /ctxLib\.writeRunState\(runDir, \{ pr: /);
  assert.match(HOOKS_JS, /\{ number, url: urlArg \}/);
});

// #2997: nothing composed the PR-early body mechanically — the agent running
// /flow's PR-early step wrote it by hand, so a run could open a PR missing
// the run marker / phase checklist / Fixes block (observed on PR #2996).
// bin/lib/flow/pr-body.js now owns that template's literal text, and these
// tests pin the cite-instead-of-restate change plus the module's own output.
const { composePrEarlyBody, repairPrBody } = require('../plugin/bin/lib/flow/pr-body');

test('#2997: Step 3 composes the body via composePrEarlyBody (bin/lib/flow/pr-body.js) instead of hand-composing it', () => {
  assert.match(LIFECYCLE, /composePrEarlyBody/);
  assert.match(LIFECYCLE, /bin\/lib\/flow\/pr-body\.js/);
});

// #3120: the #2997 snippet was a multi-line `node -e` (writes nothing on Windows
// Git Bash, bin/node-eval-file.js's header) with spec text in shell quotes and a
// literal /tmp path. Step 3 now runs bin/compose-pr-body.js with the summary in a
// file and session-scoped paths; these pins keep the old shapes from coming back.
test('#3120: Step 3 composes through bin/compose-pr-body.js with the summary in a file, never an inline node -e', () => {
  assert.match(LIFECYCLE, /bin\/compose-pr-body\.js" [^\n]*--summary-file "\$PR_EARLY_SUMMARY" --out "\$PR_EARLY_BODY"/);
  assert.doesNotMatch(LIFECYCLE, /node -e "[^"\n]*\n/, 'no multi-line node -e');
  assert.doesNotMatch(LIFECYCLE, /\/tmp\/pr-early-body/, 'no literal /tmp body path');
  assert.match(LIFECYCLE, /--body-file "\$PR_EARLY_BODY"/);
});

test('#2997 AC1: a run PR body produced by composePrEarlyBody passes RUN_MARKER, both delimiter pairs, and one Fixes line per target', () => {
  const body = composePrEarlyBody({
    runId: '2026-10-06T031832-record-2997',
    specSummary: 'One paragraph.',
    target: '#2997',
    nextStep: 'build',
    fixesLines: ['Fixes #2997'],
  });
  // RUN_MARKER is the HTML-comment-form regex _shared/github-pr-scan.md keys on.
  const RUN_MARKER = /<!-- claude-tweaks-run: ([^ ]+) -->/;
  assert.match(body, RUN_MARKER);
  assert.match(body, /<!-- phases-start -->[\s\S]*<!-- phases-end -->/);
  assert.match(body, /<!-- fixes-start -->[\s\S]*<!-- fixes-end -->/);
  assert.match(body, /Fixes #2997/);
});

test('#2997 AC2/AC4: repairPrBody restores a #2996-shaped body (no markers at all) and preserves its freeform text', () => {
  const freeform = '## Summary\n\nOpened without the template.\n';
  const { body, restored } = repairPrBody({ body: freeform, runId: 'r1', fixesLines: ['Fixes #42'] });
  assert.deepEqual(restored, ['run marker', 'phases block', 'fixes block']);
  assert.ok(body.includes('Opened without the template.'));
  assert.match(body, /<!-- claude-tweaks-run: r1 -->/);
  assert.match(body, /<!-- phases-start -->/);
  assert.match(body, /<!-- fixes-start -->/);
});

test('#2997 AC3: a missing Fixes/phases/run-marker block is no longer described as cosmetic', () => {
  assert.doesNotMatch(
    CHECKLIST_REFRESH,
    /stale title\/checklist\/`Fixes` block is cosmetic/,
    'the old sentence lumped a missing Fixes block in with a merely-stale title/checklist — #2997 corrects that',
  );
  assert.match(CHECKLIST_REFRESH, /missing.{0,40}run marker, phases pair, or `Fixes` block is not\s*\ncosmetic/);
  assert.match(CHECKLIST_REFRESH, /repairPrBody/);
});

test('#2997: pr-checklist-refresh.md\'s Phase-checklist update repairs a body carrying no markers instead of skipping', () => {
  assert.match(CHECKLIST_REFRESH, /Repair before locating anything \(#2997\)/);
  assert.match(CHECKLIST_REFRESH, /This replaces the former best-effort skip on a\s*\n\s*missing delimiter pair/);
});

// #2997 follow-up (found during /claude-tweaks:wrap-up's Skills curation row): Step 3's
// "Composed shape" fence is a prose/code twin of composePrEarlyBody's actual output — a
// fenced template, not a table, which is exactly the shape prose-code-twin-pin's own
// Anti-Patterns table now names. The tests above only assert each side's own literals
// separately (markers present, module cited); neither pins the fence against the real
// composer output, so a sixth phase row or a renamed delimiter on either side would leave
// both green. Extract the fence by structure and assert byte equality (modulo the
// composer's own trailing newline, which the fence — embedded inside the prose — doesn't
// carry) against calling the composer with the fence's own placeholder text.
test('#2997 follow-up: Step 3\'s "Composed shape" fence is byte-identical to composePrEarlyBody\'s real output', () => {
  const stepIdx = LIFECYCLE.indexOf('### Step 3: Compose the body');
  assert.ok(stepIdx !== -1, 'Step 3 heading not found');
  const fenceMatch = LIFECYCLE.slice(stepIdx).match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(fenceMatch, 'no ```markdown fence found under Step 3');
  const fence = fenceMatch[1];

  const composed = composePrEarlyBody({
    runId: '{run-id}',
    specSummary: '{one-paragraph summary}',
    target: '{target}',
    nextStep: '{next-step}',
    fixesLines: ['Fixes #{n}'],
    runDir: '{run-dir}',
  });

  assert.strictEqual(fence, composed.replace(/\n$/, ''), 'the prose fence and the composer\'s real output have drifted apart');
});

// #3263: the gh-present Phase-checklist update is one `bin/pr-checklist.js` call, not a
// hand-composed locate/flip/temp-file/`gh pr edit` sequence. The two AC3 assertions are
// factored so a frozen excerpt of the pre-#3263 prose (same style as PRE_REFRESH in
// premise-reversal-spec-summary-3050.test.js) proves each one can go red.
const GH_ABSENT_HEADING = '**`gh` absent (MCP).**';
const phaseChecklistUpdate = () => {
  const s = CHECKLIST_REFRESH.split('## Phase-checklist update (every phase exit)')[1];
  assert.ok(s, 'Phase-checklist update section must exist');
  return s.split('## Pre-merge title/description refresh')[0];
};
function assertCliCited(text) {
  assert.match(text, /bin\/pr-checklist\.js" --run "\{run-dir\}" --phase \{phase\}/);
  assert.match(text, /--remove/);
}
function assertNoHandSteps(ghPresent, whole = ghPresent) {
  assert.doesNotMatch(ghPresent, /\/tmp\/pr-checklist-/);
  assert.doesNotMatch(ghPresent, /gh pr edit \{number\} --repo/);
  assert.doesNotMatch(ghPresent, /Locate the checklist span/);
  assert.doesNotMatch(whole, /\/tmp\/pr-checklist-/, 'the MCP path resolves its temp file through session-tmp-resolve');
}
// Frozen from the pre-#3263 file (lines 49-60 and 84-86, 1c3950f96).
const PRE_3263 = `  Locate the checklist span using
  whichever delimiter pair this (possibly-repaired) body actually carries: the
  \`<!-- phases-start -->\`/\`<!-- phases-end -->\` pair on a \`gh\`-present read (the real body,
  unsanitized); the \`[claude-tweaks-phases-start]\`/\`[claude-tweaks-phases-end]\` pair on a
  \`gh\`-absent MCP read (the HTML-comment pair is invisibly stripped from what this read
  returns, per \`_shared/pr-early-run-lifecycle.md\`'s Root cause section, even though it still
  exists in the stored body). Flip that phase's checklist row from
  \`- [ ] {phase}\` to \`- [x] {phase}\` inside whichever span was found, leaving everything else —
  including the *other* delimiter pair, which this read may not even show — untouched, then
  write back through the same transport that did the read, to
  \`/tmp/pr-checklist-{run-id}-{n}.md\` — scoped by \`{run-id}\`, same reason as \`_shared/pr-early-run-lifecycle.md\`'s
  Step 3 path.

  \`\`\`bash
  gh pr edit {number} --repo {host}/{owner}/{repo} --body-file /tmp/pr-checklist-{run-id}-{n}.md
  \`\`\``;

test('#3263 AC3.1: the Phase-checklist update cites bin/pr-checklist.js', () => {
  assertCliCited(phaseChecklistUpdate());
});

test('#3263 AC3.2: the gh-present path carries no hand-composed six-step prose', () => {
  const update = phaseChecklistUpdate();
  const from = update.indexOf('bin/pr-checklist.js" --run');
  const to = update.indexOf(GH_ABSENT_HEADING);
  assert.ok(from !== -1, 'the CLI call must exist');
  assert.ok(to > from, 'the gh-absent heading must follow the CLI call');
  assertNoHandSteps(update.slice(from, to), update);
});

test('#3263: the AC3 assertions go red on the pre-#3263 prose (frozen excerpt)', () => {
  assert.throws(() => assertCliCited(PRE_3263));
  assert.throws(() => assertNoHandSteps(PRE_3263));
});
