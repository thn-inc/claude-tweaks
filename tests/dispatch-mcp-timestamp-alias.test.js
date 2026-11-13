'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { aliasMcpTimestamps } = require('../plugin/bin/lib/issues/mcp-issue-shape');
const { parseRecordFacets } = require('../plugin/bin/lib/issues/record');
const { buildFreshnessSignal, signalsMatch } = require('../plugin/bin/lib/dispatch/queue-order');
const { rankNext } = require('../plugin/bin/lib/dispatch/queue-pull');
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

test('keeps an existing camelCase value that is not undefined', () => {
  const [out, nullCamel] = aliasMcpTimestamps([{ createdAt: 'A', created_at: 'B' }, { createdAt: null, created_at: 'B' }]);
  assert.equal(out.createdAt, 'A');
  assert.equal(nullCamel.createdAt, null);
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

// #5230: bin/queue-pull.js aliases on `--transport files` itself (its files-transport aliasing is
// pinned in tests/bin-lib/dispatch/queue-pull.test.js, `#5227 files: the queue file is copied into
// the session file and aliased there`, and by the S1-files parity rows). The ranking the alias must
// satisfy is the module's rankNext (what `queue-pull.js --rank` runs). mcp-transport.md's #3691
// section is the gap explanation and states where the alias now happens.
const ROOT = path.join(__dirname, '..');
const MCP = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'));
const HEADING = '## Step 2 — `list_issues`/`issue_read` return snake_case timestamps (#3691)';

function sectionOf(text) {
  const start = text.indexOf(HEADING);
  assert.notStrictEqual(start, -1, 'section heading not found in mcp-transport.md');
  const next = text.indexOf('\n## ', start + HEADING.length);
  return text.slice(start, next === -1 ? undefined : next);
}

// Newest-first, as list_issues returns them; the snake_case timestamps are the MCP shape.
const RAW_QUEUE = [
  { number: 20, title: 'Newer', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
  { number: 10, title: 'Older', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
];

// rankNext over one group per issue (the facets the grouping pass attaches); returns the picked group.
const pickOf = (issues) => rankNext(issues.map((i) => [{ ...i, facets: parseRecordFacets(i.labels) }]), [], {});

test('mcp-transport section names the gap, the fields, the consumers and the false cache hit, and where the CLI aliases', () => {
  const text = sectionOf(MCP);
  for (const token of [
    'created_at', 'updated_at', 'createdAt', 'updatedAt', 'mcp__github__list_issues', 'mcp__github__issue_read',
    'next-ranking.md', 'aliasMcpTimestamps', 'bin/lib/issues/mcp-issue-shape.js', '2026-10-20T022848-record-3630',
    'bin/queue-pull.js', '`--transport files`', '`--queue-raw`', '`--dep-freshness`',
    'buildFreshnessSignal', 'signalsMatch', 'false queue-order cache hit',
  ]) {
    assert.ok(text.includes(token), `section lacks ${token}`);
  }
  assert.strictEqual(text.split('<<NODE_EVAL_EOF').length - 1, 0, 'the alias lives in the CLI, not as a heredoc here');
});

test("rankNext's oldest-first tie-break picks the older record after aliasing", () => {
  assert.strictEqual(pickOf(aliasMcpTimestamps(RAW_QUEUE))[0].number, 10);
});

test('control: without aliasing the tie-break falls back to array order', () => {
  assert.strictEqual(pickOf(RAW_QUEUE)[0].number, 20);
});

// The persisted cache survives a JSON round-trip, which drops an undefined updatedAt. Without
// the alias, a changed updated_at therefore still matches (a false cache hit); with it, it does not.
test('unaliased snake_case records produce a false queue-order cache hit; aliased ones do not', () => {
  const before = [{ number: 7, state: 'OPEN', updated_at: '2026-10-01T00:00:00Z' }];
  const after = [{ number: 7, state: 'OPEN', updated_at: '2026-10-05T00:00:00Z' }];
  const persist = (signal) => JSON.parse(JSON.stringify(signal));
  assert.ok(signalsMatch(persist(buildFreshnessSignal(before)), buildFreshnessSignal(after)), 'unaliased: the stale signal matches (the bug)');
  assert.ok(!signalsMatch(persist(buildFreshnessSignal(aliasMcpTimestamps(before))), buildFreshnessSignal(aliasMcpTimestamps(after))), 'aliased: the changed record is a mismatch');
});

// The agent writes the raw MCP JSON and re-runs nothing: the queue-pull paragraph says the CLI aliases.
const CLI_ALIASES = 'the CLI aliases them itself on `--transport files`';
function assertPullPointsAtTheAlias(text) {
  const pullStart = text.indexOf('## Step 2 — queue pull and per-dependency open-state check');
  assert.notStrictEqual(pullStart, -1, 'queue-pull paragraph heading not found in mcp-transport.md');
  const pull = text.slice(pullStart, text.indexOf('\n## ', pullStart + 1));
  assert.ok(pull.includes('#3691'), 'mcp-transport.md queue-pull paragraph lacks the #3691 pointer');
  assert.ok(pull.includes(CLI_ALIASES), 'mcp-transport.md queue-pull paragraph must say the CLI aliases on --transport files');
  assert.ok(!pull.includes('alias_mcp_timestamps'), 'mcp-transport.md queue-pull paragraph still sends the agent to the script function');
}

test('the queue-pull MCP notes point at the #3691 alias, which the CLI runs on --transport files', () => {
  assertPullPointsAtTheAlias(MCP);
  // Go-red controls over copies of the live text.
  assert.throws(() => assertPullPointsAtTheAlias(MCP.split(CLI_ALIASES).join('the timestamps are aliased')), assert.AssertionError);
  assert.throws(() => assertPullPointsAtTheAlias(MCP.split('(`#3691`, section below)').join('(section below)')), assert.AssertionError);
  assert.throws(() => assertPullPointsAtTheAlias(MCP.replace(CLI_ALIASES, `${CLI_ALIASES}; re-run \`alias_mcp_timestamps\``)), assert.AssertionError);
});
