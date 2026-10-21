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
  invocation: /`\/claude-tweaks:wrap-up #\{n\} merge`/,
  'human-confirmation': /typed invocation is the human merge confirmation/,
  tag: /`\{tag\}` = `human-approved`/,
  'no-console-resolve': /never runs `console-resolve\.js`/,
  'no-console-question': /never asks a `"Review Console"`-headed question/,
  'run-dir': /`_shared\/run-dir-resolution\.md`'s resolution order/,
  'not-resume': /not the `resume` form/,
  'precondition-open': /PR is not `OPEN`/,
  'precondition-pr': /`run-state\.json` carries no `pr` object/,
  'precondition-model': /`integration-model: pr-first`/,
  'steps-1-4': /`_shared\/pr-first-merge\.md` Steps 1 through 4/,
  'step-4-1': /Step 4\.1/,
  'section-c': /Section C steps 3\.5-5\.5/,
  'pack-before-teardown': /When `\{run-dir\}\/wrap-up-pack\.json` is absent, produce it before any teardown/,
  'release-reason': /with reason `merged: spec \{n\}` and `\$LINK` set to the merge commit sha/,
  'human-turn': /The confirmation holds only on a human's own turn: a subagent, a scheduled Routine, or any other headless caller that reaches this file stops and reports `pending-review`, reason `no-human-confirmation`/,
  'record-binding': /bind the adopted run to the typed record: its `config\.yml` `spec:` value must equal `\{n\}`/,
  'merged-pr-next': /names `\/claude-tweaks:wrap-up #\{n\} cleanup-only` as the next step/,
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

test('summary-template.md Next Actions list line backticks consoleAutoResolve', () => {
  const region = summaryNextActionsRegion();
  assert.ok(!/grants consoleAutoResolve/.test(region), 'unbackticked consoleAutoResolve');
  assert.match(region, /grants `consoleAutoResolve`/);
});
