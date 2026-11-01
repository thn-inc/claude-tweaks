'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const flat = (s) => s.replace(/\s+/g, ' ');

// Returns the names of facts whose pattern does not match `text`.
function missingFactsOf(text, facts) {
  return Object.entries(facts).filter(([, re]) => !re.test(text)).map(([name]) => name);
}

// Per fact: strip only that fact's first match and assert exactly [name] goes missing.
function assertEachFactGoesRed(text, facts) {
  for (const [name, re] of Object.entries(facts)) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `${name}: pattern matched nothing to strip`);
    assert.deepStrictEqual(missingFactsOf(doctored, facts), [name], `${name}: stripping it must report exactly itself`);
  }
}

const HINT = '[#N|<spec>|<context>|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only] [merge]';

const MERGE_MODE_FACTS = {
  // Anchored on its own sentence: the Already merged section also names this command as the failure next step.
  invocation: /`\/claude-tweaks:wrap-up #\{n\} merge` merges the record's already-open PR now/,
  'human-confirmation': /typed invocation is the human merge confirmation/,
  tag: /`\{tag\}` = `human-approved`/,
  'no-console-resolve': /never runs `console-resolve\.js`/,
  'no-console-question': /never asks a `"Review Console"`-headed question/,
  'run-dir': /`_shared\/run-dir-resolution\.md`'s resolution order/,
  'not-resume': /not the `resume` form/,
  'precondition-open': /the PR is neither `OPEN` nor `MERGED`/,
  'precondition-pr': /`run-state\.json` carries no `pr` object/,
  'precondition-model': /`integration-model: pr-first`/,
  'steps-1-4': /`_shared\/pr-first-merge\.md` Steps 1 through 4/,
  'step-4-1': /then Step 4\.0b \(`\{pr-number\}` = `\{pr\}`\), then Step 4\.1\./,
  'section-c': /Section C steps 3\.5-5\.5/,
  'pack-before-teardown': /When `\{run-dir\}\/wrap-up-pack\.json` is absent, produce it before any teardown/,
  'release-reason': /with reason `merged: spec \{n\}` and `\$LINK` set to the merge commit sha/,
  'human-turn': /The confirmation holds only on a human's own turn: a subagent, a scheduled Routine, or any other headless caller that reaches this file stops and reports `pending-review`, reason `no-human-confirmation`/,
  'record-binding': /bind the adopted run to the typed record: its `config\.yml` `spec:` value must equal `\{n\}`/,
  'budget-ignored': /they have no effect here and the report says they were ignored/,
  'branch5-once': /This happens once per invocation: a second branch-5 error accepts `pending-review`/,
  'other-stops': /Any other stop inside `pr-first-merge\.md` before the merge — Step 1\.5's curation guard, a non-zero `compose-subject` exit — reports `pending-review` naming that step/,
  'cleanup-failure': /keeps the `merged` outcome and adds one `cleanup: \{step\} failed — \{reason\}` line per failure/,
  'section-e': /and Section E's claim release/,
  'reconcile-last': /Step 4\.2's reconcile runs last/,
  'reread-merge-state': /re-read `mergeStateStatus`/,
  'rejects-cleanup-only': /`merge` with `cleanup-only` is rejected/,
  'needs-record': /`merge` with no record reference stops/,
  'rejects-dry-run': /`merge` with `--dry-run` is rejected: report both tokens and run neither/,
  'rejects-resume': /`merge` with `resume` is rejected: report both tokens and run neither/,
  'resolve-command': /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" resolve-run-dir --spec-slug "spec-\{n\}"/,
  'archived-fallback': /resolve-run-dir --archived --spec-slug "spec-\{n\}"/,
  'worktree-at-close': /falls back to `worktreeAtClose` when `worktree` is null/,
  'no-create': /with no `--create`/,
  'unresolved-stops': /When nothing resolves, merge mode stops and names the record/,
  'never-mint': /never mints a run dir, because a stray `-standalone` dir could shadow the real run on retry/,
  'steps-split': /, split as below\. Steps 1-3 are/,
  'unrecognized-example': /an error branches 1-4 do not recognize \(for example a transient `HTTP 502` from the forge\)/,
  'clean-reenter': /`CLEAN` with a green rollup: re-enter Step 2\.5 from the top, so its head-run read \(`gh run list --commit`\) still runs/,
  'dirty-conflict': /`DIRTY`: take the Conflict path/,
  'anything-else': /Anything else: accept `pending-review`/,
  outcomes: /`merged`, `armed`, or `pending-review`/,
  bundle: /--step merge/,
  // `## Already merged` (#4692). assertEachFactGoesRed strips only a pattern's first match, so no
  // sentence below may contain text another fact matches: the section points at Procedure step 3
  // for Section C, Section E and the reconcile call instead of restating them.
  'merged-routes-already': /A `MERGED` PR — an `armed` run's auto-merge, or a merge on GitHub, landing before the human types this — skips Procedure steps 1-2 and runs the Already merged section below/,
  'already-cli': /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/post-merge-run\.js" --run "\$PIPELINE_RUN_DIR"/,
  'already-claim': /runs Step 4\.0 and Step 4\.0b once under the run's `\.post-merge\.lock` claim, choosing the in-session or the late-merge arguments by the merge's age/,
  'already-marker': /a run whose `decisions\.md` already holds the post-merge marker prints `already-done` and runs neither step/,
  'already-in-flight': /`in-flight` — a reconcile pass holds the run's claim and is running them now: report `in-flight`, never `ran`/,
  'already-json-line': /It prints one JSON line and exits 0 for every outcome, so route on the line, never the exit code/,
  'already-clean-ran': /A clean `ran` entry — `closingLinks` `nothing-closed`, `closed`, `reopened`, `no-fixes-span`, `not-merged` or `no-pr`, no `step40Failed` — reports `ran`/,
  'already-step40-failed': /a `ran` entry carrying `step40Failed`, or a `closingLinks` of `reopen-failed`, `close-failed`, `close-pending` or `base-unchecked`, is a failure: one `cleanup: post-merge closes failed — \{closingLinks\}` line naming every record in its `records` lists/,
  'already-ran-recovery': /That run's marker is already written, so a re-run prints `already-done` and hides the failure: the line names no `\/claude-tweaks:wrap-up` re-run and cites `_shared\/pr-first-merge-post-merge\.md` Step 4\.0's per-list actions for those records, plus `\/claude-tweaks:tidy`'s `parent-gate` backstop for a parent a failed record holds open and for any parent Step 4\.0b did not reach \(`step40Failed`\)/,
  'already-other-reason': /any other `reason` — `gh-absent`, `transient-failure`, `network-failure`, `claim-failed`, `marker-write-failed`, `error`, `not-github-issues`, `no-remote`, `no-pr`, `no-pr-states`, `no-pr-state`, `pr-not-found`, `invalid-arguments` and `not-merged` — adds one `cleanup: post-merge closes failed — \{reason\}` line/,
  'already-exit-2-3': /A CLI exit 2 or 3 prints nothing on stdout, so its line reads `cleanup: post-merge closes failed — exit \{code\}: \{first stderr line\}`/,
  'already-retry': /Those reading `gh-absent`, `transient-failure`, `network-failure`, `claim-failed`, `marker-write-failed` or `error`, and the exit 2 or 3 line, name `\/claude-tweaks:wrap-up #\{n\} merge` as the next step, because with no marker written yet a re-run tries the closes again/,
  'already-no-rerun': /Every other `skipped` reason — `not-github-issues`, `no-remote`, and the `no-pr`, `no-pr-states`, `no-pr-state`, `pr-not-found`, `invalid-arguments` and `not-merged` that the Preconditions above and the CLI's own checks make unreachable here — names no next step: a re-run fails the same way, because the project's work backend or remote, not this run, decides the first two/,
  'already-step-4-1-line': /Step 4\.1's own release-status line is reported as that step defines it: it is none of the per-step words here and never adds a next step/,
  'already-done-word': /A target that is already gone — worktree reaped, branch deleted, claim released — reports `already done`, never `failed`/,
  'already-link': /`\$LINK` is the PR's `mergeCommit\.oid` from `gh pr view \{pr\} --json mergeCommit,mergedAt,mergedBy`/,
  'already-teardown': /then the rest of Procedure step 3 from Step 4\.1 on, in its order, with Step 4\.2's reconcile call last/,
  'already-outcome': /`already merged \{mergedAt\} by \{mergedBy\} — merge mode ran only the post-merge steps`/,
  'already-no-next': /names no next step when every line reads `ran`, `already done` or `in-flight`; Step 4\.1's release-status line is none of these words and never adds one/,
};

// SKILL.md's router bullet: `merge` routes on the token alone, so a bare `merge` reaches
// merge-mode.md's no-record stop instead of being stripped as a flag.
const ROUTER_FACTS = {
  'routes-on-token': /If `\$ARGUMENTS` consists of nothing but the literal `merge` token, at most one record reference \(`#42 merge` or `merge #42`\), this skill's own flags \(`--dry-run`, `--skill-budget <n>`, `--doc-budget <n>`, `cleanup-only`\), and `resume`, read `merge-mode\.md`/,
  'bare-and-cleanup-route': /A bare `merge`, `merge` with `cleanup-only`, `merge` with `--dry-run`, and `merge` with `resume` route there too/,
  'routing-not-flag': /`merge` is a routing token handled before the flag strip, never a flag/,
  'free-text-falls-through': /Free text that merely contains the word merge \(`fix the merge bug`\) does not route there and falls through to the branches below/,
};

// The region is merge-mode.md before its `## Conflict` heading, so the Conflict body
// (written separately) can never add a second match to one of these facts.
function mergeModeRegion() {
  const raw = read('plugin', 'skills', 'wrap-up', 'merge-mode.md');
  const idx = raw.indexOf('## Conflict');
  assert.notEqual(idx, -1, 'merge-mode.md must carry a `## Conflict` heading');
  return flat(raw.slice(0, idx));
}

test('merge-mode.md carries every merge-mode fact before its Conflict heading', () => {
  assert.deepStrictEqual(missingFactsOf(mergeModeRegion(), MERGE_MODE_FACTS), []);
});

test('merge-mode.md facts each go red when stripped', () => {
  assertEachFactGoesRed(mergeModeRegion(), MERGE_MODE_FACTS);
});

test('AC1.1 AC1.2: merge-mode.md names cleanup-only only in its Token rules rejection', () => {
  const text = flat(read('plugin', 'skills', 'wrap-up', 'merge-mode.md'));
  assert.strictEqual((text.match(/cleanup-only/g) || []).length, 1);
  assert.ok(text.includes('`merge` with `cleanup-only` is rejected'), 'the one match is the Token rules rejection');
});

// Step 4.0 of the shared post-merge doc names merge mode's in-session caller (#4692).
const POST_MERGE_EXCEPTION = {
  'merge-mode-caller': /merge mode's Already merged section \(`wrap-up\/merge-mode\.md`\) runs this step in-session for an already-merged PR/,
  'merge-mode-caller-4-0b': /The one in-session caller that runs this step after a merge it did not make is merge mode's Already merged section \(`wrap-up\/merge-mode\.md`\), through `bin\/post-merge-run\.js`/,
};

test('pr-first-merge-post-merge.md Step 4.0 names merge mode as an in-session caller', () => {
  const text = flat(read('plugin', 'skills', '_shared', 'pr-first-merge-post-merge.md'));
  assert.deepStrictEqual(missingFactsOf(text, POST_MERGE_EXCEPTION), []);
  assertEachFactGoesRed(text, POST_MERGE_EXCEPTION);
});

test('AC4.1: merge-mode.md no longer claims a parked run stays active', () => {
  assert.ok(!read('plugin', 'skills', 'wrap-up', 'merge-mode.md').includes('a parked `pending-review` run stays `status: active`'));
  assert.ok(!read('docs', 'journeys', 'merge-a-parked-unattended-pr-3784.md').includes('a parked run stays `status: active`'));
});

test('pipeline-run-dir.md documents --archived', () => {
  const doc = read('plugin', 'skills', '_shared', 'pipeline-run-dir.md');
  assert.match(doc, /\[--root-only\] \[--archived\]/);
  const bullet = /^- `--archived`[^\n]*$/m.exec(doc);
  assert.ok(bullet, 'the doc has a `--archived` bullet');
  assert.match(bullet[0], /is refused with `--create`/, 'the bullet states the --create refusal');
  assert.match(bullet[0], /It is read-only/, 'the bullet states the flag is read-only');
});

test('wrap-up grammar surfaces carry the merge token', () => {
  const skill = read('plugin', 'skills', 'wrap-up', 'SKILL.md');
  const frontmatterHint = /^argument-hint: "(.*)"$/m.exec(skill);
  assert.ok(frontmatterHint, 'SKILL.md frontmatter has an argument-hint');
  assert.strictEqual(frontmatterHint[1], HINT);

  const inputSection = skill.slice(skill.indexOf('## Input'), skill.indexOf('## Overview'));
  const parseLine = /parsed as `([^`]*)`/.exec(inputSection);
  assert.ok(parseLine, 'SKILL.md ## Input has a parse-line code span');
  assert.strictEqual(parseLine[1], HINT);

  assert.deepStrictEqual(missingFactsOf(flat(skill), ROUTER_FACTS), []);
  assertEachFactGoesRed(flat(skill), ROUTER_FACTS);

  // `merge` is not a flag: the flag strip list must not name it.
  const stripLine = /^Flags \(([^)]*)\) may appear anywhere/m.exec(skill);
  assert.ok(stripLine, 'SKILL.md has the flag strip sentence');
  assert.ok(!/`merge`/.test(stripLine[1]), 'the flag strip list must not include `merge`');

  const flagsMd = read('plugin', 'skills', 'wrap-up', 'flags.md');
  assert.match(flagsMd, /^- \*\*`merge`\*\*/m);
  assert.match(flat(flagsMd), /a routing token, not a flag/);

  const card = read('plugin', 'skills', 'help', 'reference-card.md');
  const row = card.split('\n').find((l) => l.startsWith('| `/claude-tweaks:wrap-up` |'));
  assert.ok(row, 'reference card has a wrap-up row');
  const takes = row.split(/(?<!\\)\|/)[3].trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|');
  assert.strictEqual(takes, HINT);
});

// The attended Conflict-path branch. The procedure lives in merge-mode.md's
// `## Conflict` (merge mode's only reader); `_shared/pr-first-merge.md` carries a pointer
// bullet only, because the composed `merge` bundle has too little rail headroom for it.
const ATTENDED_FACTS = {
  'both-intents': /both sides' intent can be kept and stated in one line per file/,
  renumber: /renumbers the branch's own entry and every citation the branch added, never the integration branch's/,
  'line-per-file-reported': /each file's line goes into the commit message and the closing report/,
  suite: /Stage the result and run the full suite through `verify\.js`/,
  cwd: /with `--cwd "\{worktree-path\}"`, so it checks the resolved merge/,
  'green-gate': /Green: commit, push/,
  reenter: /re-enter Step 2\.5 from the top/,
  'push-failed': /A failed push reports `pending-review`, reason `push-failed`/,
  'red-suite': /A conflict that needs a judgment between the two sides' intent, or a red suite/,
  'no-worktree': /report `pending-review`, reason `no-worktree`, and run no merge in any checkout/,
  'one-attempt': /This re-entry is the Conflict path's one attempt: a second `DIRTY` after the attended push reports `pending-review`, reason `moving-target`, with the PR ready/,
  abort: /`git merge --abort`/,
};
const POINTER_FACTS = {
  scope: /\*\*Attended branch \(merge mode only\)\.\*\*/,
  owner: /`wrap-up\/merge-mode\.md`'s `## Conflict`/,
  'headless-unchanged': /- \*\*Conflict markers remain\*\*: this is what "unresolvable headlessly" means — stop, do not attempt resolution\./,
  'other-callers': /Every other caller keeps the stop-at-markers bullet above/,
};

function conflictRegion() {
  const raw = read('plugin', 'skills', 'wrap-up', 'merge-mode.md');
  const start = raw.indexOf('## Conflict');
  assert.notEqual(start, -1, 'merge-mode.md must carry a `## Conflict` heading');
  const next = raw.indexOf('\n## ', start + 1);
  return flat(next === -1 ? raw.slice(start) : raw.slice(start, next));
}

function conflictPathRegion() {
  const raw = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
  const start = raw.indexOf('## Conflict path');
  const end = raw.indexOf('## Outcome vocabulary');
  assert.notEqual(start, -1, 'pr-first-merge.md must carry a `## Conflict path` heading');
  assert.notEqual(end, -1, 'pr-first-merge.md must carry a `## Outcome vocabulary` heading');
  return flat(raw.slice(start, end));
}

test('merge-mode.md Conflict section carries the attended procedure', () => {
  assert.deepStrictEqual(missingFactsOf(conflictRegion(), ATTENDED_FACTS), []);
});

test('attended Conflict facts each go red when stripped', () => {
  assertEachFactGoesRed(conflictRegion(), ATTENDED_FACTS);
});

test('pr-first-merge.md Conflict path carries the pointer and keeps the headless bullet', () => {
  assert.deepStrictEqual(missingFactsOf(conflictPathRegion(), POINTER_FACTS), []);
});

test('pointer facts each go red when stripped', () => {
  assertEachFactGoesRed(conflictPathRegion(), POINTER_FACTS);
});

// A pointer stub stays a pointer: it carries none of the procedure it points at (the composed
// merge bundle's own rail is the size gate, in the test below).
test('the pointer bullet carries none of the attended procedure', () => {
  const m = /- \*\*Attended branch \(merge mode only\)\.\*\*[\s\S]*?(?=\n\n|\n- |\n#)/.exec(
    read('plugin', 'skills', '_shared', 'pr-first-merge.md'),
  );
  assert.ok(m, 'pointer bullet present');
  const leaked = missingFactsOf(flat(m[0]), ATTENDED_FACTS);
  assert.deepStrictEqual(leaked.sort(), Object.keys(ATTENDED_FACTS).sort(), 'pointer restates attended-procedure text');
});

test('the composed merge bundle stays within the read-limit rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  const { composedBytesReport } = require('../plugin/bin/lib/skill-audit/context-cost');
  const rows = composedBytesReport(path.join(ROOT, 'plugin')).filter((r) => r.step === 'merge');
  assert.ok(rows.length > 0, 'at least one compose call site names --step merge');
  for (const r of rows) {
    assert.ok(!r.error, `${r.file}:${r.line} failed to compose: ${r.error}`);
    assert.ok(r.max <= RAIL_BYTES, `${r.file}:${r.line} composes ${r.max} B > ${RAIL_BYTES}`);
  }
});

// Flow's Resume-to-merge row under `consoleAutoResolve`. Under that ceiling the
// existing `flow ... wrap-up` resume re-resolves the Review Console with no question and
// re-parks the PR, so the row points at merge mode instead. The old row stays (both places).
const SUMMARY_FACTS = {
  condition: /grants `consoleAutoResolve`/,
  predicate: /`bookkeepingPermissions\(ceiling\)\.consoleAutoResolve`/,
  'merge-row': /`\/claude-tweaks:wrap-up \{target\} merge` — merge the parked PR in this session, PR #\{n\} \{is ready \| is blocked\} — mergeability: \{outcome\}/,
  'bare-target': /`\{target\}` renders bare there, as the record's `#\{record\}` reference/,
  'other-ceilings': /Every other ceiling keeps the row above/,
};

// The prose names this predicate as the row's condition; pin that it exists and means `unattended` only.
test('the summary row predicate resolves to unattended only', () => {
  const { bookkeepingPermissions } = require('../plugin/bin/lib/issues/autonomy');
  assert.strictEqual(bookkeepingPermissions('unattended').consoleAutoResolve, true);
  assert.strictEqual(bookkeepingPermissions('trusted').consoleAutoResolve, false);
  assert.strictEqual(bookkeepingPermissions('supervised').consoleAutoResolve, false);
});

const OLD_RESUME_ROW = '`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} {is ready | is blocked} — mergeability: {outcome}';

function summaryText() {
  return flat(read('plugin', 'skills', 'flow', 'summary-template.md'));
}

// The paragraph is the last section of the file, so there may be no following bold lead-in.
function summaryParagraphRegion() {
  const text = summaryText();
  const start = text.indexOf('**Resume-to-merge row.**');
  assert.notEqual(start, -1, 'summary-template.md must carry the Resume-to-merge row paragraph');
  const rest = text.slice(start);
  const next = rest.indexOf(' **', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

function summaryNextActionsRegion() {
  const text = summaryText();
  const start = text.indexOf('### Next Actions');
  const end = text.indexOf('**Release row.**');
  assert.notEqual(start, -1, 'summary-template.md must carry ### Next Actions');
  assert.notEqual(end, -1, 'summary-template.md must carry the Release row paragraph');
  return text.slice(start, end);
}

test('summary-template.md Resume-to-merge paragraph carries the consoleAutoResolve merge row', () => {
  assert.deepStrictEqual(missingFactsOf(summaryParagraphRegion(), SUMMARY_FACTS), []);
});

test('summary-template.md consoleAutoResolve facts each go red when stripped', () => {
  assertEachFactGoesRed(summaryParagraphRegion(), SUMMARY_FACTS);
});

test('summary-template.md Next Actions list carries the merge row once', () => {
  const matches = summaryNextActionsRegion().match(new RegExp(SUMMARY_FACTS['merge-row'].source, 'g')) || [];
  assert.strictEqual(matches.length, 1);
});

test('summary-template.md keeps the existing resume row in both places', () => {
  const text = summaryText();
  const first = text.indexOf(OLD_RESUME_ROW);
  assert.notEqual(first, -1, 'old resume row missing from Next Actions');
  assert.notEqual(text.indexOf(OLD_RESUME_ROW, first + 1), -1, 'old resume row missing from the paragraph');
});

// Cross-file surfaces: the caller list, the graph rows, the structure row, and the Next Actions line.
test('pr-first-merge.md header lists merge mode among its callers', () => {
  const raw = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
  const end = raw.indexOf('**The shape:**');
  assert.notEqual(end, -1, 'pr-first-merge.md must carry the **The shape:** lead-in');
  const header = flat(raw.slice(0, end));
  // Bounded by the list's last entry, so a later header mention cannot stand in for the caller-list entry.
  assert.match(header, /Canonical for every merge site[^]*?`wrap-up\/merge-mode\.md`[^]*?`release\/execute\.md` Step 5\./);
});

test('docs/skill-graph.md counts three /wrap-up merge sites and names merge-mode.md in both rows', () => {
  const graph = flat(read('docs', 'skill-graph.md'));
  assert.ok(!/(`\/wrap-up`'s two merge sites|two `\/wrap-up` merge sites)/i.test(graph), 'stale "two merge sites" wording');
  const matches = graph.match(/(`\/wrap-up`'s three merge sites|three `\/wrap-up` merge sites) \(([^)]*)\)/gi) || [];
  assert.strictEqual(matches.length, 2, 'both the pr-first-merge.md and pr-checklist-refresh.md rows');
  for (const m of matches) assert.match(m, /merge-mode\.md/);
});

test('docs/plugin-structure.md states the narrowed merge-mode.md read condition', () => {
  const structure = flat(read('docs', 'plugin-structure.md'));
  assert.ok(!/read only when `\$ARGUMENTS` carries `merge`/.test(structure), 'stale read condition');
  assert.match(structure, /merge-mode\.md \(the `#N merge` same-session merge entry, read only when `\$ARGUMENTS` is only the `merge` token, at most one record reference, and the skill's own flags\)/);
});

// flags.md's cleanup-only bullet states its own run-dir lookup so teardown never mints a stray -standalone dir.
const CLEANUP_ONLY_FACTS = {
  'lookup-order': /`cleanup-only` resolves its run dir from an inherited `PIPELINE_RUN_DIR` first, else `resolve-run-dir --spec-slug \{slug\}` with no `--create`/,
  'never-mints': /it never mints a run dir/,
  'stops-naming-record': /When nothing resolves it stops and names the record/,
  'merged-pointer': /when that record's PR is `MERGED`, the stop names `\/claude-tweaks:wrap-up #\{n\} merge`/,
};

test('AC6.1: flags.md states cleanup-only\'s run-dir lookup', () => {
  const flags = flat(read('plugin', 'skills', 'wrap-up', 'flags.md'));
  assert.deepStrictEqual(missingFactsOf(flags, CLEANUP_ONLY_FACTS), []);
});

test('AC6.1: cleanup-only facts each go red when stripped', () => {
  assertEachFactGoesRed(flat(read('plugin', 'skills', 'wrap-up', 'flags.md')), CLEANUP_ONLY_FACTS);
});

test('summary-template.md Next Actions list line backticks consoleAutoResolve', () => {
  const region = summaryNextActionsRegion();
  assert.ok(!/grants consoleAutoResolve/.test(region), 'unbackticked consoleAutoResolve');
  assert.match(region, /grants `consoleAutoResolve`/);
});
