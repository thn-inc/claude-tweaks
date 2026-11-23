'use strict';
// #5999: build/dispatch.md takes every per-task implementer's default profile from
// bin/implementer-tier.js (#5996) instead of a prose `size:` mapping, and adds one
// escalation per task under `implementer-tier: record`. The prose facts are pinned
// below; the CLI-answer block pins the CLI answers the build now depends on.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync } = require('./helpers/run-cli');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const DISPATCH = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'dispatch.md'));

// A literal as a non-global regex, so each fact matches one exact phrase.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const CLI_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file';
const PROFILE_LINE =
  '`AUTO {time} — implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}). Reversibility: n/a.`';
const ESCALATION_LINE =
  '`AUTO {time} — task {k} implementer escalated {from} → {to} ({trigger}). Reversibility: n/a.`';

const PATTERNS = [
  [lit(CLI_CALL), 'AC9.1: names the CLI call'],
  [
    lit("(`{spec-file}`: the materialized `work/{n}-spec.md`, the worktree's copy in `worktree` mode)"),
    "spec file is the worktree's copy in worktree mode",
  ],
  [lit(PROFILE_LINE), 'AC6.1: one implementer profile line'],
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
  [lit("`stepUp` with `--from {task's profile}` (a `**Role:**` marker's profile when one set it)"),'AC5.2: step-up from the task\'s own profile'],
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

const madeTmpDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-impl-tier-'));
  madeTmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (madeTmpDirs.length) fs.rmSync(madeTmpDirs.pop(), { recursive: true, force: true });
});

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
