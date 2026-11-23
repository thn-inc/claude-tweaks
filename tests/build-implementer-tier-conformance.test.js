'use strict';
// #5999: build/dispatch.md takes every per-task implementer's default profile from
// bin/implementer-tier.js (#5996) instead of a prose `size:` mapping, and adds one
// escalation per task under `implementer-tier: record`. The prose facts are pinned
// below; the CLI-answer block pins the CLI answers the build now depends on.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCliSync } = require('./helpers/run-cli');
const { scratchDir } = require('./helpers/tmp-dir');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const DISPATCH = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'dispatch.md'));

// A literal as a non-global regex, so each fact matches one exact phrase.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const CLI_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file "{spec-file}"';
const PROFILE_LINE =
  '`AUTO {time} — implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}) effort {startEffort}. Reversibility: n/a.`';
const LADDER_CALL =
  'node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file "{spec-file}" --attempt-profile {profile} --attempt-effort {effort} --escalations {n} --trigger {trigger}';
const LADDER_ESCALATION_LINE =
  '`AUTO {time} — task {k} implementer escalated {from-profile}@{from-effort} → {to-profile}@{to-effort} ({trigger}). Reversibility: n/a.`';
const START_LINE =
  '`AUTO {time} — task {k} implementer start {profile}@{effort} (role: {role}). Reversibility: n/a.`';
const ESCALATION_LINE =
  '`AUTO {time} — task {k} implementer escalated {from} → {to} ({trigger}). Reversibility: n/a.`';

const PATTERNS = [
  // The trailing `` ` once`` keeps this fact off the ladder call, which extends CLI_CALL.
  [lit(`${CLI_CALL}\` once`), 'AC9.1: names the CLI call'],
  [
    lit("(`{spec-file}`: the materialized `{run-dir}/work/{n}-spec.md`, the worktree's copy in `worktree` mode)"),
    "spec file is the worktree's copy in worktree mode",
  ],
  [
    lit('`## Acceptance Criteria` section — read from `{spec-file}`, never re-fetched'),
    'per-task review reads the ACs from {spec-file}',
  ],
  [lit(PROFILE_LINE), 'AC6.1: one implementer profile line'],
  [lit('`{startEffort}` is `inherit` when `null`'), 'AC6.1: inherit printed for null'],
  [lit(LADDER_CALL), 'AC2.1 AC3.1 (lane): names the next-attempt CLI call'],
  [lit(LADDER_ESCALATION_LINE), 'AC6.2: effort-ladder escalation line'],
  [lit("sets the Agent tool's `effort` parameter to `startEffort`"), 'AC6.1: dispatch at startEffort'],
  [lit('At most two escalations per task'), 'AC6.3: at most two escalations'],
  [lit('plus `--from {marker profile}`'), 'Decision Q1: a Role-marker task starts at its own profile\'s startEffort'],
  [lit('a `null` `next`'), "AC6.3: past the ladder, SDD's own handling"],
  [lit("the CLI's `ladder` is `true`"), 'AC5.1 (lane): inherit keeps #5999'],
  [lit('renders as `inherit` on either side'), 'AC6.2: a null effort renders as inherit'],
  [lit('; no line when `next` is `null`'), 'AC6.3: no escalation line for a null next'],
  [lit("Triggers (`blocked`, `fix-round-failed`) and the fresh-implementer rule are the escalation's"), 'ladder keeps the #5999 triggers and fresh-implementer rule'],
  [lit('its `effort` parameter `next.effort` (none when `null`)'), 'AC2.1: the next attempt dispatches at next.effort'],
  [lit('(with `--run "$PIPELINE_RUN_DIR"` when set)'), 'AC7.4 (lane): the next-attempt call carries --run'],
  [lit("before any escalation line, its start effort: the profile line's `effort` or the marker start line's"), "AC6.2: the first escalation's current effort is the start effort"],
  [lit(START_LINE), 'Deliverable 6: a Role-marker task logs its start effort'],
  [
    lit('Log once, skipped when `decisions.md` already holds an `implementer profile` line (a resumed build)'),
    'AC6.2: a resumed build logs no second profile line',
  ],
  [
    lit("A non-zero exit, a missing spec file included, stops the build before the first dispatch with the CLI's message"),
    'AC7.1: non-zero exit stops before the first dispatch',
  ],
  [lit('A design-doc build runs no CLI and gets no override'), 'AC7.2: design-doc build runs no CLI'],
  [lit('replies `STATUS: BLOCKED`'), 'AC4.1: BLOCKED trigger'],
  [lit("the re-review of the task's first fix round fails"), 'AC4.2: failed first fix-round re-review trigger'],
  [
    lit('An initial task review asking for a fix, `NEEDS_CONTEXT` and `DONE_WITH_CONCERNS` are not triggers'),
    'AC4.3: initial review is not a trigger',
  ],
  [lit('a fresh implementer, never a `SendMessage` resume'), 'fresh dispatch, never SendMessage'],
  [
    lit("a second `implementer-tier.js` call (same arguments) plus `--from {task's profile}` (a `**Role:**` marker's profile when one set it, else the build's `profile`)"),
    "AC5.2: step-up from the task's own profile, by a second --from call",
  ],
  [lit('plus `--run "$PIPELINE_RUN_DIR"` when set'), "AC7.4: the CLI call carries the run's config via --run"],
  [lit('a `null` profile means no override'), 'AC7.5: a null profile means no override'],
  [lit("(a resume keeps the first agent's model), one profile up"), 'escalation is one profile up, on a fresh agent'],
  [lit("as do the fix rounds after an escalation (its round-4 step up included)"), "Decision Q1: SDD's own fix rounds apply after an escalation"],
  [
    lit("a task whose `task {k} implementer escalated` line is already in `decisions.md` (no run dir: SDD's `progress.md`)"),
    'AC5.1: once-per-task check reads decisions.md',
  ],
  [lit("Only when the CLI's `rule` is `record`"), 'AC5.3: escalation gated on rule: record'],
  [lit('and no `profile=` token (or its `tier=` alias) was given'), 'AC3.2: no escalation under the profile= token'],
  [lit(ESCALATION_LINE), 'escalation line'],
  [lit("precedence is `profile=` token, then marker, then the CLI's profile"), 'AC3.1 AC3.2: precedence'],
];
const missing = missingFactsOf(PATTERNS);

test('#5999: dispatch.md states every implementer-tier fact', () => {
  assert.deepStrictEqual(missing(DISPATCH), []);
});

test('#5999: removing any one fact turns exactly that fact red', () => {
  assertEachPatternGoesRed(DISPATCH, PATTERNS, missing);
});

test('AC9.1: removing the CLI call turns the suite red', () => {
  const copy = DISPATCH.replace(CLI_CALL, () => '');
  assert.notEqual(copy, DISPATCH, 'the CLI-call literal is not in dispatch.md');
  assert.deepStrictEqual(missing(copy), ['AC9.1: names the CLI call']);
});

test('AC9.1: reverting the --spec-file argument to the run-dir path turns the suite red', () => {
  const copy = DISPATCH.replace('--spec-file "{spec-file}"', () => '--spec-file "{run-dir}/work/{n}-spec.md"');
  assert.notEqual(copy, DISPATCH, 'the --spec-file "{spec-file}" argument is not in dispatch.md');
  assert.deepStrictEqual(missing(copy), ['AC9.1: names the CLI call']);
});

// AC8.1: the prose size mapping is gone — a negative fact, so it gets its own check.
const PROSE_MAPPING = '`low` → Fast, `medium` → Standard, `high` → Capable';
const assertNoProseMapping = (text) =>
  assert.ok(!text.includes(PROSE_MAPPING), 'dispatch.md still carries the prose size: mapping');

test('AC8.1: no prose size mapping', () => {
  assertNoProseMapping(DISPATCH);
});

test('AC8.1 control: re-adding the prose mapping turns the check red', () => {
  const copy = `${DISPATCH}\n${PROSE_MAPPING}\n`;
  assert.throws(() => assertNoProseMapping(copy), { message: 'dispatch.md still carries the prose size: mapping' });
});

// ---- The CLI answers this build depends on (#5996) ----

const CLI = path.join(ROOT, 'plugin', 'bin', 'implementer-tier.js');
// resolvePolicy starts `git rev-parse --show-toplevel` with this env.
const ENV = { PATH: process.env.PATH, ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }) };

const tmpDir = () => scratchDir('build-impl-tier-');

// materialize.js's layout: header lines, a blank-free frontmatter close, then the body.
const spec = ({ header, keyFiles = [] }) =>
  `---\nrecord: 1\n${header}---\n# 1: Title\n\n## Overview\n\ntext\n\n### Key Files\n\n${keyFiles.map((f) => `- \`${f}\``).join('\n')}\n`;

function answer(header, keyFiles, args) {
  const file = path.join(tmpDir(), 'spec.md');
  fs.writeFileSync(file, spec({ header, keyFiles }));
  const res = runCliSync(CLI, ['--spec-file', file, ...args], { env: ENV, cwd: tmpDir() });
  assert.strictEqual(res.code, 0, res.stderr);
  return JSON.parse(res.stdout);
}

const THREE = ['a.js', 'b.js', 'c.js'];

test('AC1.1: under record a size: high spec gets standard', () => {
  assert.strictEqual(answer('size: high\n', THREE, ['--rule', 'record']).profile, 'standard');
});

test('AC1.2: under lane a size: high spec gets capable', () => {
  assert.strictEqual(answer('size: high\n', THREE, ['--rule', 'lane']).profile, 'capable');
});

test('AC2.1: under record size: low with two Key Files gets fast', () => {
  assert.strictEqual(answer('size: low\n', ['a.js', 'b.js'], ['--rule', 'record']).profile, 'fast');
});

test('AC2.2: under record size: low with three Key Files gets standard', () => {
  assert.strictEqual(answer('size: low\n', THREE, ['--rule', 'record']).profile, 'standard');
});

test('AC5.2: --from fast steps up to standard, not capable', () => {
  assert.strictEqual(answer('size: high\n', THREE, ['--rule', 'record', '--from', 'fast']).stepUp, 'standard');
});

test('AC7.3: an effort: high header under lane gets capable', () => {
  assert.strictEqual(answer('effort: high\n', THREE, ['--rule', 'lane']).profile, 'capable');
});

// AC8.2: flow/materialize.md's `size` reader row names the CLI, not the old prose mapping.
const SIZE_ROW = lineStartingWith(
  readText(path.join(ROOT, 'plugin', 'skills', 'flow', 'materialize.md')),
  '| `size` |',
);
const OLD_MAPPING = '`low`→Fast';
const sizeRowFacts = (row) => [
  ...(/bin\/implementer-tier\.js/.test(row) ? [] : ['AC8.2: names the CLI']),
  ...(row.includes(OLD_MAPPING) ? ['AC8.2: no prose mapping'] : []),
];

test("AC8.2: materialize.md's size row names implementer-tier.js, not the prose mapping", () => {
  assert.ok(SIZE_ROW.length > 0, 'materialize.md has no size row');
  assert.deepStrictEqual(sizeRowFacts(SIZE_ROW), []);
});

test('AC8.2 control: stripping the CLI name or re-adding the old mapping turns exactly that fact red', () => {
  const noCli = SIZE_ROW.replace('bin/implementer-tier.js', () => '');
  assert.notEqual(noCli, SIZE_ROW, 'the CLI name is not in the size row');
  assert.deepStrictEqual(sizeRowFacts(noCli), ['AC8.2: names the CLI']);
  assert.deepStrictEqual(sizeRowFacts(`${SIZE_ROW} ${OLD_MAPPING}`), ['AC8.2: no prose mapping']);
});

// AC6.1: the standalone handoff's profile section names the effort and both ladder line shapes.
const HANDOFF = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'handoff-template.md'));
const HANDOFF_PATTERNS = [
  [lit('- implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}) effort {startEffort}'), 'AC6.1: handoff profile line names the effort'],
  [lit('- task {k} implementer escalated {from-profile}@{from-effort} → {to-profile}@{to-effort} ({trigger})'), 'AC6.2: handoff names the ladder escalation line'],
  [lit('- task {k} implementer start {profile}@{effort} (role: {role})'), 'Deliverable 6: handoff names the marker start line'],
];
const handoffMissing = missingFactsOf(HANDOFF_PATTERNS);

test('AC6.1: handoff-template names the effort on the profile line', () => {
  assert.deepStrictEqual(handoffMissing(HANDOFF), []);
});

test('AC6.1: removing any one handoff fact turns exactly that fact red', () => {
  assertEachPatternGoesRed(HANDOFF, HANDOFF_PATTERNS, handoffMissing);
});
