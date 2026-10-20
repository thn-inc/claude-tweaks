'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aliasMcpTimestamps } = require('../plugin/bin/lib/issues/mcp-issue-shape');
const { parseRecordFacets } = require('../plugin/bin/lib/issues/record');
const { readText } = require('./helpers/read-skill.js');

// #3691: the GitHub MCP tools return snake_case created_at/updated_at, but the
// dispatch consumers read camelCase createdAt/updatedAt. aliasMcpTimestamps adds
// the camelCase keys without removing the snake_case originals.

test('aliases created_at/updated_at to camelCase', () => {
  const input = [{ number: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }];
  const [out] = aliasMcpTimestamps(input);
  assert.equal(out.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(out.updatedAt, '2026-01-02T00:00:00Z');
  assert.equal(out.created_at, '2026-01-01T00:00:00Z');
});

test('keeps an existing camelCase value', () => {
  const [out] = aliasMcpTimestamps([{ createdAt: 'A', created_at: 'B' }]);
  assert.equal(out.createdAt, 'A');
});

test('adds no key for an absent or non-string snake_case value', () => {
  const [absent, nullValue] = aliasMcpTimestamps([{ number: 2 }, { created_at: null }]);
  assert.ok(!('createdAt' in absent));
  assert.ok(!('createdAt' in nullValue));
});

test('non-array input returns []', () => {
  assert.deepEqual(aliasMcpTimestamps(null), []);
  assert.deepEqual(aliasMcpTimestamps(undefined), []);
  assert.deepEqual(aliasMcpTimestamps({}), []);
});

test('does not mutate its input', () => {
  const input = [{ number: 3, created_at: '2026-01-01T00:00:00Z' }];
  const snapshot = JSON.parse(JSON.stringify(input));
  aliasMcpTimestamps(input);
  assert.deepEqual(input, snapshot);
});

// mcp-transport.md's #3691 section carries the queue-pull boundary heredoc; next-ranking.md's
// pick heredoc is the consumer it must satisfy. Both are extracted and run over fixtures.
const ROOT = path.join(__dirname, '..');
const MCP = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'));
const NEXT_RANKING = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'next-ranking.md'));
const HEADING = '## Step 2 — `list_issues`/`issue_read` return snake_case timestamps (#3691)';
const ALIAS_START = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" <<NODE_EVAL_EOF';
const RANK_START = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$PRIORITY_FILTER" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "$DISPATCH_NEXT_PICK" <<NODE_EVAL_EOF';
// The unquoted heredoc expands ${CLAUDE_PLUGIN_ROOT} into a JS string literal, where a Windows
// backslash path would be read as escapes — pass it with forward slashes.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

function sectionOf(text) {
  const start = text.indexOf(HEADING);
  assert.notStrictEqual(start, -1, 'section heading not found in mcp-transport.md');
  const next = text.indexOf('\n## ', start + HEADING.length);
  return text.slice(start, next === -1 ? undefined : next);
}

// From the heredoc's node-eval-file.js line through its closing NODE_EVAL_EOF line (CRLF-tolerant).
function heredocFrom(text, needle) {
  const found = text.indexOf(needle);
  assert.notStrictEqual(found, -1, `heredoc starting "${needle.slice(0, 60)}" not found`);
  const close = /\r?\nNODE_EVAL_EOF\r?\n/g;
  close.lastIndex = found;
  const match = close.exec(text);
  assert.notStrictEqual(match, null, 'heredoc has no NODE_EVAL_EOF terminator');
  return text.slice(found, match.index + match[0].length);
}

function aliasHeredoc(text = MCP) {
  return heredocFrom(sectionOf(text), ALIAS_START);
}

function fixtureDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-mcp-alias-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runBash(code, env) {
  const result = spawnSync('bash', ['-c', code], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
  });
  assert.strictEqual(result.status, 0, `snippet exited ${result.status}: ${result.stderr}`);
  return result;
}

// Newest-first, as list_issues returns them; the snake_case timestamps are the MCP shape.
const RAW_QUEUE = [
  { number: 20, title: 'Newer', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
  { number: 10, title: 'Older', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
];

// Runs next-ranking.md's pick heredoc over one group per issue and returns the picked group.
function pickOf(t, issues) {
  const dir = fixtureDir(t);
  const groups = path.join(dir, 'groups.json');
  const exclusions = path.join(dir, 'exclusions.json');
  const pick = path.join(dir, 'next-pick.json');
  fs.writeFileSync(groups, JSON.stringify(issues.map((i) => [{ ...i, facets: parseRecordFacets(i.labels) }])));
  fs.writeFileSync(exclusions, '[]');
  runBash(heredocFrom(NEXT_RANKING, RANK_START), {
    PRIORITY_FILTER: '', DISPATCH_GROUPS: groups, DISPATCH_EXCLUSIONS: exclusions, DISPATCH_NEXT_PICK: pick,
  });
  return JSON.parse(fs.readFileSync(pick, 'utf8'));
}

test('section names the gap, the fields, the consumers and the helper', () => {
  const text = sectionOf(MCP);
  for (const token of [
    'created_at', 'updated_at', 'createdAt', 'updatedAt', 'mcp__github__list_issues', 'mcp__github__issue_read',
    'next-ranking.md', 'aliasMcpTimestamps', 'bin/lib/issues/mcp-issue-shape.js', '2026-10-20T022848-record-3630',
  ]) {
    assert.ok(text.includes(token), `section lacks ${token}`);
  }
  assert.strictEqual(text.split('<<NODE_EVAL_EOF').length - 1, 1, 'section must carry exactly one heredoc');
});

test('doc heredoc aliases $DISPATCH_QUEUE_RAW in place', (t) => {
  const queue = path.join(fixtureDir(t), 'queue-raw.json');
  fs.writeFileSync(queue, JSON.stringify(RAW_QUEUE));
  runBash(aliasHeredoc(), { DISPATCH_QUEUE_RAW: queue });
  const out = JSON.parse(fs.readFileSync(queue, 'utf8'));
  assert.deepStrictEqual(out.map((i) => i.createdAt), ['2026-10-10T00:00:00Z', '2026-09-01T00:00:00Z']);
  assert.deepStrictEqual(out.map((i) => i.updatedAt), ['2026-10-10T00:00:00Z', '2026-09-01T00:00:00Z']);
});

test('doc heredoc on [] leaves []', (t) => {
  const queue = path.join(fixtureDir(t), 'queue-raw.json');
  fs.writeFileSync(queue, '[]');
  runBash(aliasHeredoc(), { DISPATCH_QUEUE_RAW: queue });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(queue, 'utf8')), []);
});

test("next-ranking's oldest-first tie-break picks the older record after aliasing", (t) => {
  const queue = path.join(fixtureDir(t), 'queue-raw.json');
  fs.writeFileSync(queue, JSON.stringify(RAW_QUEUE));
  runBash(aliasHeredoc(), { DISPATCH_QUEUE_RAW: queue });
  const picked = pickOf(t, JSON.parse(fs.readFileSync(queue, 'utf8')));
  assert.strictEqual(picked[0].number, 10);
});

test('control: without aliasing the tie-break falls back to array order', (t) => {
  const picked = pickOf(t, RAW_QUEUE);
  assert.strictEqual(picked[0].number, 20);
});

test('CRLF extraction matches LF', () => {
  const crlf = MCP.replace(/\n/g, '\r\n');
  assert.strictEqual(aliasHeredoc(crlf).replace(/\r\n/g, '\n'), aliasHeredoc());
  const rankCrlf = NEXT_RANKING.replace(/\n/g, '\r\n');
  assert.strictEqual(heredocFrom(rankCrlf, RANK_START).replace(/\r\n/g, '\n'), heredocFrom(NEXT_RANKING, RANK_START));
});

test('the queue-pull MCP notes point at the #3691 alias step', () => {
  const pullStart = MCP.indexOf('## Step 2 — queue pull and per-dependency open-state check');
  assert.notStrictEqual(pullStart, -1, 'queue-pull paragraph heading not found in mcp-transport.md');
  const pull = MCP.slice(pullStart, MCP.indexOf('\n## ', pullStart + 1));
  assert.ok(pull.includes('#3691'), 'mcp-transport.md queue-pull paragraph lacks the #3691 pointer');
  const queuePull = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'));
  const noteStart = queuePull.indexOf('**MCP path** (`gh` unavailable): see `mcp-transport.md`');
  assert.notStrictEqual(noteStart, -1, 'MCP-path note not found in queue-pull-script.md');
  const note = queuePull.slice(noteStart, queuePull.indexOf('\n', noteStart));
  assert.ok(note.includes('#3691'), 'queue-pull-script.md MCP-path note lacks the #3691 pointer');
});
