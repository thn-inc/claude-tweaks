'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// #1493: tidy residue markers + `--approve`. This file pins the `.gitignore`
// carve-out that makes a `*-tidy-standalone*` run's own audit files
// (`decisions.md`, `report.md`, `staged/**`) trackable, plus (Task 4) the
// rest of #1493's prose surface: `decision-markers.md`'s comment-first
// write order + both repair directions + digest-container exclusion,
// `step-6-auto.md`'s citation of it and its byte ceiling, `step-1-records.md`'s
// `Proposed:`-text-aware loop-safety skip, `approve-mode.md`'s resolution/
// reverify/stale-reporting/walk-back behavior, `SKILL.md`'s `--approve` hint,
// `auto-decision-log.md`'s tidy-standalone carve-out clause, and the AC2
// prose-coherence chain (a `keep` resolution is a comment edit that bumps
// `updatedAt`, and the staleness clock reads that same `updatedAt`).

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readFlat = (...p) => read(...p).replace(/\s+/g, ' ');
const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const LINES = GITIGNORE.split('\n');

// Rule-shape pin, not a behavioral git-ignore check (that's already covered
// live by Task 2's own `git check-ignore -v` / `git add -n` probes at
// implementation time — see the task report). This test's job is narrower:
// make sure a later `.gitignore` edit can't silently widen or drop the
// narrow top-level-pipelines carve-out without a test going red here.
test('.gitignore: tidy-standalone carve-out lines are present verbatim, at top-level pipelines depth', () => {
  const expectedCarveOut = [
    '!.claude-tweaks/pipelines/*-tidy-standalone*/decisions.md',
    '!.claude-tweaks/pipelines/*-tidy-standalone*/report.md',
    '!.claude-tweaks/pipelines/*-tidy-standalone*/staged/',
    '!.claude-tweaks/pipelines/*-tidy-standalone*/staged/**',
  ];
  for (const line of expectedCarveOut) {
    assert.ok(
      LINES.includes(line),
      `expected .gitignore to carry the exact carve-out line: ${line}`,
    );
  }

  // Never spec-*/-nested: a tidy standalone run dir is never a multi-spec
  // parent, so the carve-out must not also target a spec-*/-nested shape.
  for (const line of expectedCarveOut) {
    assert.ok(
      !line.includes('/spec-'),
      `tidy-standalone carve-out line must stay top-level, not spec-*/-nested: ${line}`,
    );
  }
});

// Fix-wave addition (whole-branch review of #1494): sweep's Step 1 runs tidy
// inside a `*-sweep-standalone*` run dir, which needs the identical carve-out
// or Step 7.5's `git add` fails there the same way it would have failed for
// `-tidy-standalone` before Task 2 added the lines above.
test('.gitignore: sweep-standalone carve-out lines are present verbatim, at top-level pipelines depth', () => {
  const expectedCarveOut = [
    '!.claude-tweaks/pipelines/*-sweep-standalone*/decisions.md',
    '!.claude-tweaks/pipelines/*-sweep-standalone*/report.md',
    '!.claude-tweaks/pipelines/*-sweep-standalone*/staged/',
    '!.claude-tweaks/pipelines/*-sweep-standalone*/staged/**',
  ];
  for (const line of expectedCarveOut) {
    assert.ok(
      LINES.includes(line),
      `expected .gitignore to carry the exact carve-out line: ${line}`,
    );
  }

  // Never spec-*/-nested: a sweep standalone run dir is never a multi-spec
  // parent, so the carve-out must not also target a spec-*/-nested shape.
  for (const line of expectedCarveOut) {
    assert.ok(
      !line.includes('/spec-'),
      `sweep-standalone carve-out line must stay top-level, not spec-*/-nested: ${line}`,
    );
  }
});

test('.gitignore: the blanket pipelines-contents ignore the carve-out depends on is still present', () => {
  // The carve-out above only means anything as a narrow exception punched
  // into this still-active blanket rule. If a future edit ever removes or
  // loosens this line (e.g. widens it, or deletes it so everything under
  // pipelines/*/ becomes trackable by default), the carve-out silently stops
  // being narrow — this line is what makes it narrow in the first place.
  assert.ok(
    LINES.includes('.claude-tweaks/pipelines/*/*'),
    'expected the surviving blanket-ignore line `.claude-tweaks/pipelines/*/*` — the ' +
      'tidy-standalone carve-out is a narrow exception punched into this rule, not a replacement for it',
  );
});

// --- Task 4: decision-markers.md ---

test('decision-markers.md exists and cites the canonical Decision-comment template', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'decision-markers.md');
  assert.match(src, /^# Tidy — Decision Markers \(`needs:decision`\)/);
  assert.ok(
    src.includes("Per `_shared/work-record.md`'s Decision-comment template, `{unit}` = `tidy`:"),
    'decision-markers.md must cite _shared/work-record.md\'s Decision-comment template, not restate its own',
  );
});

test('decision-markers.md states comment-first write order', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'decision-markers.md');
  assert.ok(
    src.includes('## Write order: comment first, then the label'),
    'decision-markers.md must carry the comment-first write-order heading',
  );
  assert.ok(
    src.includes(
      'gh issue comment "$ISSUE" --body-file "$COMMENT_FILE" \\ && gh issue edit "$ISSUE" --add-label needs:decision',
    ),
    'decision-markers.md must post the comment before adding the needs:decision label',
  );
});

test('decision-markers.md states the repair rule in both directions', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'decision-markers.md');
  // Direction 1: label present, no matching unresolved comment.
  assert.ok(
    src.includes(
      'with **no matching unresolved** `<!-- needs-decision: tidy -->` comment among its comments treats that as inconsistent state',
    ),
    'decision-markers.md missing the label-with-no-comment repair direction',
  );
  // Direction 2: unresolved comment present, no label.
  assert.ok(
    src.includes(
      'an unresolved `<!-- needs-decision: tidy -->` comment with **no** `needs:decision` label',
    ),
    'decision-markers.md missing the comment-with-no-label repair direction',
  );
  assert.ok(
    src.includes(
      'The repair here is one-directional: re-apply the `needs:decision` label, never remove the comment',
    ),
    'decision-markers.md missing the repair-direction resolution rule (comment is authoritative, label gets restored)',
  );
});

test('decision-markers.md exempts the digest container from the applicability shape', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'decision-markers.md');
  assert.ok(
    src.includes(
      'a finding whose target is the digest **container** issue itself (`Merge-close duplicate digest`, `Expiry summary`, `Rollover digest container`, all Step 5.6): a digest container is not a work record',
    ),
    'decision-markers.md missing the digest-container exclusion clause',
  );
});

// --- Task 4: step-6-auto.md cites decision-markers.md + byte-ceiling guard ---

test('step-6-auto.md cites decision-markers.md for the Stage-tier marker write', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'step-6-auto.md');
  assert.ok(
    src.includes(
      'Stage-tier record rows also write the tracker-visible `needs:decision` marker — procedure in `decision-markers.md` in this skill\'s directory',
    ),
    'step-6-auto.md must cite decision-markers.md for the needs:decision marker write',
  );
});

// Per-file 40 KB pin on step-6-auto.md retired by #1997 — the per-file tier
// is a warning since #1990 and this file has no compose call site; removal
// condition in docs/incident-log.md [IL-153].

// --- Task 4: step-1-records.md's Proposed:-text-aware loop-safety skip ---

test('step-1-records.md skips a finding whose Proposed: text already matches an unresolved decision comment', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'step-1-records.md');
  assert.ok(
    src.includes(
      'skip collecting this finding when an UNRESOLVED one (no `**Resolved:**` line) has a `Proposed:` line matching this finding\'s own proposed action, word for word',
    ),
    'step-1-records.md must carry the Proposed:-text-aware loop-safety skip',
  );
  assert.ok(
    src.includes(
      'A comment whose `Proposed:` text names a different action never suppresses this finding — only an identical proposal already awaiting the same decision does',
    ),
    'step-1-records.md must state that a different Proposed: text never suppresses the finding',
  );
});

// --- Task 4: approve-mode.md ---

test('approve-mode.md exists and states the newest-run-dir default', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'approve-mode.md');
  assert.match(src, /^# Tidy — `--approve` Mode/);
  assert.ok(
    src.includes(
      '**No-arg default:** the newest `{$RUN_ROOT}/.claude-tweaks/pipelines/*-tidy-standalone*/` or `*-sweep-standalone*/` directory (glob match across both shapes + ISO-timestamp-prefix sort, newest last) whose `staged/` holds one or more files',
    ),
    'approve-mode.md must state the newest-run-dir, non-empty-staged default across both tidy-standalone and sweep-standalone shapes',
  );
});

test('approve-mode.md cites reverify-before-write.md and reports a stale target as skipped', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'approve-mode.md');
  assert.ok(
    src.includes(
      "Before applying **any** approved item, re-verify its precondition fresh — per `_shared/reverify-before-write.md`'s stale-confirmation-gate pattern",
    ),
    'approve-mode.md must cite _shared/reverify-before-write.md\'s stale-confirmation-gate pattern',
  );
  assert.ok(
    src.includes(
      'a target that has since changed, closed, or been resolved some other way reports `stale — skipped` in the verification output rather than applying, and is dropped from the approved set',
    ),
    'approve-mode.md must state the stale-target reporting behavior',
  );
});

test('approve-mode.md states the walk-back past an empty-staged newest run', () => {
  const src = readFlat('plugin', 'skills', 'tidy', 'approve-mode.md');
  assert.ok(
    src.includes(
      "`backlog/attention-mode.md`'s Tidy row shares this same glob-and-sort rule but only ever looks at the single newest matching directory (its own accepted limitation) and omits the row when that one's `staged/` is empty, so this walk-back can resolve a run the attention row doesn't currently surface",
    ),
    'approve-mode.md must state the walk-back-past-empty-staged sentence, distinguishing it from the attention row\'s no-walk-back behavior',
  );
});

// --- Task 4: SKILL.md hint + auto-decision-log.md carve-out ---

test('tidy/SKILL.md argument-hint carries --approve', () => {
  const src = read('plugin', 'skills', 'tidy', 'SKILL.md');
  assert.ok(
    src.includes('argument-hint: "[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]] [--source sweep]"'),
    'tidy/SKILL.md argument-hint must carry --approve [run-dir] and --source sweep',
  );
});

test('auto-decision-log.md carries the tidy-standalone committed-run-dir carve-out', () => {
  const src = readFlat('plugin', 'skills', '_shared', 'auto-decision-log.md');
  assert.ok(
    src.includes(
      'Carve-out: `*-tidy-standalone*` runs commit their own run directory by design (#1493 — the pr-first residue-survival mechanism; the narrow `.gitignore` carve-out is the implementation) — every other run\'s log remains uncommitted runtime state.',
    ),
    'auto-decision-log.md must carry the tidy-standalone carve-out clause',
  );
});

// --- Task 4: AC2 prose-coherence pin ---
//
// AC2's chain: a `keep` choice in /backlog refine resolves the decision
// comment by prepending `**Resolved:**` to its body (a comment edit), and
// /tidy's staleness clock reads the issue's own `updatedAt` off the fetch.
// Whether a comment *edit* (as opposed to a comment *creation*) actually
// bumps that `updatedAt` is a stated, not verified, premise (fix-wave review
// of #1493, ruled: state-with-fallback) — this pin now targets that stated
// premise + fallback sentence, not a bare fact assertion.

test('AC2 half 1: backlog/refine-record.md — "keep" resolves the comment via a body-prepend comment edit, premise stated with a fallback', () => {
  const src = readFlat('plugin', 'skills', 'backlog', 'refine-record.md');
  assert.ok(
    src.includes('**keep** — resolves the comment only, no label change.'),
    'refine-record.md must state that "keep" resolves the comment only',
  );
  assert.ok(
    src.includes(
      "1. **Comment edit** — every choice except a bare re-authorize row with no live proposal: prepend `**Resolved:** {choice} — {date}` to that comment's body.",
    ),
    'refine-record.md must state that resolving a choice (including keep) prepends **Resolved:** to the comment body',
  );
  assert.ok(
    src.includes(
      "This relies on GitHub bumping the issue's own `updatedAt` on a comment mutation (verified for comment creation; assumed for edits). If a comment edit turns out not to bump it, `keep` must additionally perform a write that does (e.g. a no-op label touch) — revisit before relying on the staleness clock alone.",
    ),
    'refine-record.md must state the updatedAt-on-comment-edit premise and its fallback, not assert it as fact',
  );
});

test('AC2 half 2: tidy staleness clock reads the same updatedAt a comment edit bumps', () => {
  const step1 = readFlat('plugin', 'skills', 'tidy', 'step-1-records.md');
  assert.ok(
    step1.includes('the Staleness clock and Threshold resolution sections into this agent\'s prompt'),
    'step-1-records.md must inline record-queue-fetch.md\'s Staleness clock section',
  );
  const fetchDoc = readFlat('plugin', 'skills', '_shared', 'record-queue-fetch.md');
  assert.ok(
    fetchDoc.includes("`github-issues` uses the query's own `updatedAt`, straight from the fetch above."),
    'record-queue-fetch.md must state the staleness clock reads the fetch\'s own updatedAt under github-issues',
  );
});

// --- Fix-wave (review of #1493): Critical C1 — the committed-set test ---
//
// The Critical finding: under pr-first, a scratch worktree cannot `git add` a
// path anchored under the MAIN checkout ($RUN_ROOT) — tidy/SKILL.md Step 7.5
// now instead copies decisions.md/report.md/staged/** into the worktree's OWN
// copy of the run dir first, then adds/commits that copy (mirroring the
// established work/{n}-spec.md exception). Prose alone can't prove a `git add`
// actually stages the right paths, so this simulates the copy+add in a
// throwaway git repo standing in for the worktree, using the REAL .gitignore
// carve-out rules, and asserts via `git diff --cached --name-only` that the
// staged set is exactly what Step 7.5's new prose says it stages.
test('#1493 C1: Step 7.5\'s copy+add lands decisions.md, report.md, and staged/** in the worktree\'s own commit', () => {
  const wt = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tidy-c1-')));
  const git = (...args) => execFileSync('git', args, { cwd: wt, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');

  // The real .gitignore, copied verbatim — proves the simulation runs against
  // the actual carve-out, not a hand-rolled stand-in that could drift from it.
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(wt, '.gitignore'));
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'seed');

  const runId = '2026-08-30T090000-tidy-standalone';
  const runRel = path.join('.claude-tweaks', 'pipelines', runId);
  const runDir = path.join(wt, runRel);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  // Simulates Step 7.5's copy step: these files already exist at $RUN_ROOT and
  // are copied into the worktree's own copy of the same relative path.
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n- AUTO: did a thing\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), '# report\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'digest-promotion-1.md'), '# staged proposal\n');

  // Step 7.5's own `git add` over the worktree copies (the fix's literal claim).
  git('add', path.join(runRel, 'decisions.md'), path.join(runRel, 'report.md'), path.join(runRel, 'staged'));
  git('commit', '-q', '-m', 'Tidy: housekeeping');

  const staged = git('diff', 'HEAD~1', 'HEAD', '--name-only').trim().split('\n').filter(Boolean).sort();
  assert.deepStrictEqual(staged, [
    path.join(runRel, 'decisions.md'),
    path.join(runRel, 'report.md'),
    path.join(runRel, 'staged', 'digest-promotion-1.md'),
  ].sort(), `expected exactly decisions.md/report.md/staged/** to be committed, got: ${JSON.stringify(staged)}`);
});

// Fix-wave addition (whole-branch review of #1494): identical simulation,
// but for a `*-sweep-standalone*` run dir — sweep's Step 1 runs tidy inside
// its own shared run dir, so the same Step 7.5 copy+add must succeed there
// too, against the `.gitignore` carve-out lines this fix wave added for it.
test('#1494 review fix: Step 7.5\'s copy+add also lands in a *-sweep-standalone* run dir\'s worktree commit', () => {
  const wt = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sweep-c1-')));
  const git = (...args) => execFileSync('git', args, { cwd: wt, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');

  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(wt, '.gitignore'));
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'seed');

  const runId = '2026-08-30T090000-sweep-standalone';
  const runRel = path.join('.claude-tweaks', 'pipelines', runId);
  const runDir = path.join(wt, runRel);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n- AUTO: did a thing\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), '# report\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'digest-promotion-1.md'), '# staged proposal\n');

  git('add', path.join(runRel, 'decisions.md'), path.join(runRel, 'report.md'), path.join(runRel, 'staged'));
  git('commit', '-q', '-m', 'Tidy: housekeeping');

  const staged = git('diff', 'HEAD~1', 'HEAD', '--name-only').trim().split('\n').filter(Boolean).sort();
  assert.deepStrictEqual(staged, [
    path.join(runRel, 'decisions.md'),
    path.join(runRel, 'report.md'),
    path.join(runRel, 'staged', 'digest-promotion-1.md'),
  ].sort(), `expected exactly decisions.md/report.md/staged/** to be committed, got: ${JSON.stringify(staged)}`);
});
