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
const TASK_PROMPT = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'task-prompt.md'));

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

// #3936: a gh --jq program containing a pipe, or a github.com --repo value, chained
// by ; or && onto an unquoted $? is refused; each call passes when run alone.
function isJqExitRow(row) {
  const cells = splitRow(row);
  return cells[2] === 'refused'
    && cells[0].includes('--jq')
    && cells[0].includes('`$?`')
    && /\(#3936\)/.test(cells[5])
    && cells[4].includes('find-run-comment.js');
}

test('the table records the gh --jq / github.com --repo plus unquoted $? shape (#3936)', () => {
  const hits = table().rows.filter(isJqExitRow);
  assert.strictEqual(hits.length, 1, `expected one refused row tagged (#3936), found ${hits.length}`);
});

// Go-red control: the same predicate must match nothing in the pre-#3936 table
// (header, separator, and the github.com and $TMPDIR rows, verbatim from git HEAD).
const PRE_3936_TABLE = [
  HEADER,
  '|---|---|---|---|---|---|',
  `| \`github.com\` URL argument together with a runtime variable (the URL alone and the variable alone both pass) | \`echo "https://github.com/o/r/pull/1" --run "$RUN_DIR"\` | refused | "names git in a form too complex to verify that it stays inside the worktree" | Write the value to a file with \`Write\`, then read it back in a separate plain command so it never appears as literal text next to the variable | 2026-10-20 (#3340); first #1876 |`,
  `| Heredoc then \`gh pr comment --body-file\` on a \`$TMPDIR\` variable path, one call (the same with a literal path passes) | \`cat > "$TMPDIR/x.md" <<'EOF' … EOF\` then \`gh pr comment N --body-file "$TMPDIR/x.md"\` | refused | "runs gh with a value computed at runtime (the variable TMPDIR) inside a construct too complex to verify" | A literal path, or \`Write\` the body then a plain \`gh pr comment N --body-file /literal/path\` | 2026-10-20 (#3340); first #2776 |`,
].join('\n');

test('the #3936 row predicate rejects the real row with any one conjunct broken (go-red control)', () => {
  const real = table().rows.filter(isJqExitRow);
  assert.strictEqual(real.length, 1);
  const cells = splitRow(real[0]);
  const broken = (index, from, to) => cells.map((c, i) => (i === index ? c.split(from).join(to) : c));
  const mutations = [
    broken(2, 'refused', 'passes'),
    broken(0, '--jq', '--query'),
    broken(0, '`$?`', '`exit`'),
    broken(5, '(#3936)', '(#1)'),
    broken(4, 'find-run-comment.js', 'the helper'),
  ];
  for (const mutated of mutations) {
    assert.notDeepStrictEqual(mutated, cells, 'the mutation must change the row');
    assert.strictEqual(isJqExitRow(`| ${mutated.join(' | ')} |`), false, mutated.join(' | '));
  }
});

test('the #3936 row predicate matches nothing in the pre-#3936 table (go-red control)', () => {
  const rows = PRE_3936_TABLE.split('\n').slice(2);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.filter(isJqExitRow).length, 0);
});

// #4022: dispatch task-prompt item 6 lists the Bash shapes the harness refuses;
// its backslash-escaped-space entry must agree with section 7's refused row.
test('dispatch item 6 names the backslash-escaped-space shape and agrees with the section 7 row (#4022)', () => {
  const start = TASK_PROMPT.indexOf('6. **Worktree shell constraint**');
  assert.notStrictEqual(start, -1, 'item 6 heading missing from task-prompt.md');
  const end = TASK_PROMPT.indexOf('7. **', start);
  assert.notStrictEqual(end, -1, 'item 7 heading missing after item 6');
  const item6 = TASK_PROMPT.slice(start, end);
  assert.ok(item6.includes('backslash-escaped space'), 'item 6 lost the backslash-escaped-space shape');
  assert.ok(item6.includes('double-quote the whole path instead'), 'item 6 lost the double-quoted fix');
  const row = table().rows.find((r) => splitRow(r)[0].startsWith('Backslash-escaped space'));
  assert.ok(row, 'section 7 lost its Backslash-escaped space row');
  assert.strictEqual(splitRow(row)[2], 'refused', `section 7 verdict drifted from refused: ${row}`);
});
