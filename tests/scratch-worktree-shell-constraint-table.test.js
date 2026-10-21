'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #3340: scratch-worktree.md section 7 records which Bash shapes the Claude
// Code harness's worktree guard refuses. It used to be a chain of dated
// addenda that contradicted each other; it is now one current-state table whose
// every row carries a live-verified date. This suite pins that shape.

const ROOT = path.join(__dirname, '..');
const DOC = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'scratch-worktree.md'));
const JOURNEY = readText(path.join(ROOT, 'docs', 'journeys', 'work-around-a-refused-worktree-bash-command-2776.md'));
const BANNER = readText(path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-progress-banner.md'));

const HEADER = '| Shape | Example | Verdict | Refusal wording | Workaround | Last verified |';

function section7() {
  const start = DOC.indexOf('## 7. Shell constraint');
  assert.notStrictEqual(start, -1, '## 7. Shell constraint heading missing');
  return DOC.slice(start);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function table() {
  const lines = section7().split('\n');
  const head = lines.findIndex((l) => l.trim().startsWith('| Shape'));
  assert.notStrictEqual(head, -1, 'no table header in section 7');
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
  return { header: lines[head].trim(), rows };
}

test('section 7 opens with the current-state table', () => {
  const s7 = section7();
  const { header } = table();
  assert.strictEqual(header, HEADER);
  const at = s7.indexOf(HEADER);
  const practical = s7.indexOf('**Practical workaround');
  assert.ok(practical !== -1 && at < practical, `table (${at}) must precede the practical workaround (${practical})`);
});

test('every row carries a closed-vocabulary verdict and a dated, record-tagged last-verified', () => {
  const { rows } = table();
  assert.ok(rows.length > 0, 'table has no rows');
  for (const row of rows) {
    const cells = splitRow(row);
    assert.strictEqual(cells.length, 6, `row needs 6 cells: ${row}`);
    assert.ok(['refused', 'passes', 'permission-rule'].includes(cells[2]), `bad verdict "${cells[2]}": ${row}`);
    assert.match(cells[5], /^\d{4}-\d{2}-\d{2} \(#\d+\)/, `bad last-verified: ${row}`);
  }
});

test('the table carries the #3340 live-verification date', () => {
  const dated = table().rows.filter((r) => /^2026-10-20 \(#3340\)/.test(splitRow(r)[5]));
  assert.ok(dated.length > 0, 'no row carries 2026-10-20 (#3340)');
});

test('a passes row has no refusal wording, a refusal row has some', () => {
  for (const row of table().rows) {
    const cells = splitRow(row);
    if (cells[2] === 'passes') assert.strictEqual(cells[3], '—', `passes row must have "—" wording: ${row}`);
    else assert.notStrictEqual(cells[3], '—', `${cells[2]} row needs refusal wording: ${row}`);
  }
});

test('no dated addendum remains in section 7', () => {
  assert.doesNotMatch(section7(), /\*\*\d{4}-\d{2}-\d{2} addendum/);
});

test('shape cells are unique', () => {
  const shapes = table().rows.map((r) => splitRow(r)[0]);
  assert.strictEqual(new Set(shapes).size, shapes.length);
});

test('the table covers every shape an addendum recorded', () => {
  const text = table().rows.join('\n');
  for (const token of [
    '${VAR:-default}', 'complete', 'GIT', 'github.com', 'mv ', '-iname', 'if RAW=$(', 'sed -i', '"$P/',
    'mutation(', 'eval', '$TMPDIR', '.log', 'awk', 'mkdir -p', '`for` / `while` loop', '`;`-separated sequence',
    'Standalone heredoc', 'runtime-computed-variable', 'script operand',
  ]) {
    assert.ok(text.includes(token), `table lost the shape token ${JSON.stringify(token)}`);
  }
});

test('the #2776 journey points at the table', () => {
  const step = JOURNEY.slice(JOURNEY.indexOf('### 2.'), JOURNEY.indexOf('### 3.'));
  const action = step.split('\n').find((l) => l.startsWith('- **Action:**'));
  assert.ok(action, 'step 2 lost its Action line');
  assert.match(action, /table/);
  assert.doesNotMatch(action, /newest first/);
});

test('multispec-progress-banner cites the table row, not an addendum', () => {
  assert.ok(!BANNER.includes('2026-08-30 addendum'), 'banner still cites the 2026-08-30 addendum');
  assert.ok(BANNER.includes('scratch-worktree.md'), 'banner lost its scratch-worktree.md citation');
});
