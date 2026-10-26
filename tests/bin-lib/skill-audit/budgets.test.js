'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const budgets = require('../../../plugin/bin/lib/skill-audit/budgets.js');
const { composedBytesReport } = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const { readText } = require('../../helpers/read-skill');
const {
  lineCount,
  skillFileRailViolations,
  composedRailViolations,
  descriptionRailViolations,
} = require('../../../plugin/bin/lib/skill-audit/rail.js');

const {
  READ_TOKEN_CAP, READ_LINE_CAP, BASH_OUTPUT_CAP_CHARS, RAIL_RATIO, RAIL_TOKENS, RAIL_LINES,
  BYTES_PER_TOKEN, RAIL_BYTES, DESCRIPTION_MAX_CHARS, LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN, listingBudgetChars, overRail,
} = budgets;

const BUDGETS_SRC = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets.js');

function tmpRoot(slug) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `budgets-${slug}-`));
}

// {root}/skills/{skill}/{rel} with `content`; returns root.
function writeSkillFile(root, skill, rel, content) {
  const file = path.join(root, 'skills', skill, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return root;
}

// A corpus with one compose call site whose single source is `sourceBytes` of 'x'.
function composeFixture(slug, sourceBytes) {
  const root = tmpRoot(slug);
  writeSkillFile(root, '_shared', 'big.md', 'x'.repeat(sourceBytes));
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step railstep "${CLAUDE_PLUGIN_ROOT}/skills/_shared/big.md"';
  writeSkillFile(root, 'demo', 'SKILL.md', `${callLine}\n`);
  return root;
}

function nLines(n) {
  return `${Array(n).fill('a').join('\n')}\n`;
}

// ── Derivations (AC1-AC3, AC9)

test('budgets: the platform caps and listing constants carry their exact values', () => {
  assert.strictEqual(READ_TOKEN_CAP, 25000);
  assert.strictEqual(READ_LINE_CAP, 2000);
  assert.strictEqual(BASH_OUTPUT_CAP_CHARS, 30000);
  assert.strictEqual(RAIL_RATIO, 1.0);
  assert.strictEqual(DESCRIPTION_MAX_CHARS, 1536);
  assert.strictEqual(LISTING_BUDGET_FRACTION, 0.01);
  assert.strictEqual(LISTING_CHARS_PER_TOKEN, 4);
});

test('budgets: the rails derive from the caps by formula', () => {
  assert.strictEqual(RAIL_TOKENS, Math.floor(READ_TOKEN_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_LINES, Math.floor(READ_LINE_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_BYTES, Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN));
});

test('budgets: BYTES_PER_TOKEN is the recorded calibration — changing it means re-running the calibration in the header', () => {
  assert.strictEqual(BYTES_PER_TOKEN, 2.1, 'BYTES_PER_TOKEN changed: re-run the Task 0 calibration and update budgets.js\'s header with the new samples');
});

test('budgets: listingBudgetChars at 200k and 1M context', () => {
  assert.strictEqual(listingBudgetChars(200000), 8000);
  assert.strictEqual(listingBudgetChars(1000000), 40000);
});

test('budgets: the header records the calibration — CLI version, date, and all three token counts', () => {
  const src = readText(BUDGETS_SRC);
  for (const needle of ['2.1.302', '2026-10-17', '45,241', '51,251', '65,782']) {
    assert.ok(src.includes(needle), `budgets.js header is missing ${needle}`);
  }
});

test('budgets: requires nothing, so any unit can import it without a cycle', () => {
  const src = readText(BUDGETS_SRC);
  assert.doesNotMatch(src, /\brequire\s*\(/);
});

// ── overRail (AC5)

test('overRail: over the byte rail or the line rail, never at it', () => {
  const entries = [
    { file: 'a.md', bytes: RAIL_BYTES, lines: 10 },
    { file: 'b.md', bytes: RAIL_BYTES + 1, lines: 10 },
    { file: 'c.md', bytes: 100, lines: RAIL_LINES + 1 },
  ];
  assert.deepStrictEqual(overRail(entries).map((e) => e.file), ['b.md', 'c.md']);
});

test('overRail: an entry with no lines field is judged on bytes only', () => {
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES }]), []);
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES + 1 }]).map((e) => e.file), ['bundle']);
});

test('overRail: an entry without numeric bytes fails closed (error row, or a raw composedBytesReport row carrying max)', () => {
  const entries = [
    { file: 'err', error: 'missing source' },
    { file: 'raw', max: 10 },
    { file: 'ok', bytes: 10 },
  ];
  assert.deepStrictEqual(overRail(entries).map((e) => e.file), ['err', 'raw']);
});

// ── lineCount

test('rail lineCount: a trailing newline ends the last line, and CRLF counts like LF', () => {
  const root = tmpRoot('linecount');
  const write = (name, text) => { const f = path.join(root, name); fs.writeFileSync(f, text); return f; };
  assert.strictEqual(lineCount(write('lf.md', 'a\nb\n')), 2);
  assert.strictEqual(lineCount(write('noeol.md', 'a\nb')), 2);
  assert.strictEqual(lineCount(write('crlf.md', 'a\r\nb\r\n')), 2);
  assert.strictEqual(lineCount(write('empty.md', '')), 0);
});

// ── Go-red fixtures (AC6): each live-corpus rail test's own code, at and over its limit

test('rail fixture: a SKILL.md at RAIL_BYTES passes, at RAIL_BYTES + 1 fails', () => {
  const at = writeSkillFile(tmpRoot('skill-bytes-at'), 'huge', 'SKILL.md', 'x'.repeat(RAIL_BYTES));
  assert.deepStrictEqual(skillFileRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('skill-bytes-over'), 'huge', 'SKILL.md', 'x'.repeat(RAIL_BYTES + 1));
  assert.deepStrictEqual(skillFileRailViolations(over).map((e) => [e.file, e.bytes]), [['huge/SKILL.md', RAIL_BYTES + 1]]);
});

test('rail fixture: a SKILL.md at RAIL_LINES short lines passes, at RAIL_LINES + 1 fails', () => {
  const at = writeSkillFile(tmpRoot('skill-lines-at'), 'long', 'SKILL.md', nLines(RAIL_LINES));
  assert.deepStrictEqual(skillFileRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('skill-lines-over'), 'long', 'SKILL.md', nLines(RAIL_LINES + 1));
  assert.deepStrictEqual(skillFileRailViolations(over).map((e) => [e.file, e.lines]), [['long/SKILL.md', RAIL_LINES + 1]]);
});

test('rail fixture: a sub-file over the byte rail fails too, not only SKILL.md', () => {
  const root = writeSkillFile(tmpRoot('subfile-over'), 'demo', 'SKILL.md', 'body\n');
  writeSkillFile(root, 'demo', 'big-step.md', 'x'.repeat(RAIL_BYTES + 1));
  assert.deepStrictEqual(skillFileRailViolations(root).map((e) => e.file), ['demo/big-step.md']);
});

test('rail fixture: a compose call site composing to RAIL_BYTES passes, to RAIL_BYTES + 1 fails', () => {
  // Compose adds a fixed overhead around its sources; measure it, then size
  // the source so the bundle lands exactly on the rail.
  const probeBytes = 1000;
  const overhead = composedBytesReport(composeFixture('compose-probe', probeBytes))[0].max - probeBytes;

  const at = composeFixture('compose-at', RAIL_BYTES - overhead);
  assert.strictEqual(composedBytesReport(at)[0].max, RAIL_BYTES);
  assert.deepStrictEqual(composedRailViolations(at), []);

  const over = composeFixture('compose-over', RAIL_BYTES - overhead + 1);
  assert.deepStrictEqual(
    composedRailViolations(over).map((e) => e.bytes),
    [RAIL_BYTES + 1],
  );
});

test('rail fixture: a compose call site with a missing source fails the rail, never passes unmeasured', () => {
  const root = tmpRoot('compose-missing');
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step railstep "${CLAUDE_PLUGIN_ROOT}/skills/_shared/gone.md"';
  writeSkillFile(root, 'demo', 'SKILL.md', `${callLine}\n`);
  const violations = composedRailViolations(root);
  assert.strictEqual(violations.length, 1);
  assert.ok(violations[0].error, 'expected the unmeasured row to carry its error');
});

test('rail fixture: a description of 1,536 chars passes, 1,537 fails', () => {
  const skill = (chars) => `---\nname: d\ndescription: ${'a'.repeat(chars)}\n---\nbody\n`;
  const at = writeSkillFile(tmpRoot('desc-at'), 'd', 'SKILL.md', skill(DESCRIPTION_MAX_CHARS));
  assert.deepStrictEqual(descriptionRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('desc-over'), 'd', 'SKILL.md', skill(DESCRIPTION_MAX_CHARS + 1));
  assert.deepStrictEqual(descriptionRailViolations(over).map((d) => d.chars), [DESCRIPTION_MAX_CHARS + 1]);
});

test('rail fixture: description length counts characters, not UTF-8 bytes', () => {
  const content = `---\nname: d\ndescription: ${'é'.repeat(DESCRIPTION_MAX_CHARS)}\n---\nbody\n`;
  const root = writeSkillFile(tmpRoot('desc-multibyte'), 'd', 'SKILL.md', content);
  assert.deepStrictEqual(descriptionRailViolations(root), []);
});
