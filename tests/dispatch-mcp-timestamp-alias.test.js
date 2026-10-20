'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aliasMcpTimestamps } = require('../plugin/bin/lib/issues/mcp-issue-shape');
const { parseRecordFacets } = require('../plugin/bin/lib/issues/record');
const { buildFreshnessSignal, signalsMatch } = require('../plugin/bin/lib/dispatch/queue-order');
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

// queue-pull-script.md carries the unconditional alias function (run by the gh and MCP paths
// alike); next-ranking.md's pick heredoc is the consumer it must satisfy. Both are extracted
// and run over fixtures. mcp-transport.md's #3691 section is the gap explanation.
const ROOT = path.join(__dirname, '..');
const MCP = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'));
const QUEUE_PULL = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'));
const NEXT_RANKING = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'next-ranking.md'));
const HEADING = '## Step 2 — `list_issues`/`issue_read` return snake_case timestamps (#3691)';
const FN_START = 'alias_mcp_timestamps() {';
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

// The whole `alias_mcp_timestamps() { ... }` shell function (CRLF-tolerant).
function aliasFunction(text = QUEUE_PULL) {
  const found = text.indexOf(FN_START);
  assert.notStrictEqual(found, -1, 'alias_mcp_timestamps function not found in queue-pull-script.md');
  const close = /\r?\n\}\r?\n/g;
  close.lastIndex = found;
  const match = close.exec(text);
  assert.notStrictEqual(match, null, 'alias_mcp_timestamps function has no closing brace');
  return text.slice(found, match.index + match[0].length);
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

// Defines the extracted function (LF-normalized) and calls it on the given files.
function runAlias(files) {
  const fn = aliasFunction().replace(/\r\n/g, '\n');
  runBash(`${fn}\nalias_mcp_timestamps ${files.map((f) => JSON.stringify(f)).join(' ')}`, {});
}

// Newest-first, as list_issues returns them; the snake_case timestamps are the MCP shape.
const RAW_QUEUE = [
  { number: 20, title: 'Newer', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
  { number: 10, title: 'Older', body: '', labels: [{ name: 'priority:low' }], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
];
// The dependency-freshness shape (`gh ... --json number,updatedAt,state`) as MCP returns it.
const RAW_DEPS = [
  { number: 5, state: 'OPEN', updated_at: '2026-08-01T00:00:00Z' },
  { number: 6, state: 'CLOSED', updated_at: '2026-08-02T00:00:00Z' },
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

test('mcp-transport section names the gap, the fields, the consumers and the false cache hit', () => {
  const text = sectionOf(MCP);
  for (const token of [
    'created_at', 'updated_at', 'createdAt', 'updatedAt', 'mcp__github__list_issues', 'mcp__github__issue_read',
    'next-ranking.md', 'aliasMcpTimestamps', 'bin/lib/issues/mcp-issue-shape.js', '2026-10-20T022848-record-3630',
    'queue-pull-script.md', 'alias_mcp_timestamps', '$DISPATCH_QUEUE_RAW', '$DISPATCH_DEP_FRESHNESS',
    'buildFreshnessSignal', 'signalsMatch', 'false queue-order cache hit',
  ]) {
    assert.ok(text.includes(token), `section lacks ${token}`);
  }
  assert.strictEqual(text.split('<<NODE_EVAL_EOF').length - 1, 0, 'the alias lives in queue-pull-script.md, not as a second heredoc here');
});

test('queue-pull function aliases $DISPATCH_QUEUE_RAW in place', (t) => {
  const queue = path.join(fixtureDir(t), 'queue-raw.json');
  fs.writeFileSync(queue, JSON.stringify(RAW_QUEUE));
  runAlias([queue]);
  const out = JSON.parse(fs.readFileSync(queue, 'utf8'));
  assert.deepStrictEqual(out.map((i) => i.createdAt), ['2026-10-10T00:00:00Z', '2026-09-01T00:00:00Z']);
  assert.deepStrictEqual(out.map((i) => i.updatedAt), ['2026-10-10T00:00:00Z', '2026-09-01T00:00:00Z']);
});

test('queue-pull function aliases both $DISPATCH_QUEUE_RAW and $DISPATCH_DEP_FRESHNESS in one call', (t) => {
  const dir = fixtureDir(t);
  const queue = path.join(dir, 'queue-raw.json');
  const deps = path.join(dir, 'dep-freshness.json');
  fs.writeFileSync(queue, JSON.stringify(RAW_QUEUE));
  fs.writeFileSync(deps, JSON.stringify(RAW_DEPS));
  runAlias([queue, deps]);
  const out = JSON.parse(fs.readFileSync(deps, 'utf8'));
  assert.deepStrictEqual(out.map((i) => i.updatedAt), ['2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z']);
  assert.deepStrictEqual(out.map((i) => i.state), ['OPEN', 'CLOSED']);
  assert.strictEqual(JSON.parse(fs.readFileSync(queue, 'utf8'))[1].createdAt, '2026-09-01T00:00:00Z');
});

test('queue-pull function is a no-op on gh-shaped input and leaves [] as []', (t) => {
  const dir = fixtureDir(t);
  const ghShaped = [{ number: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', state: 'OPEN' }];
  const queue = path.join(dir, 'queue-raw.json');
  const deps = path.join(dir, 'dep-freshness.json');
  fs.writeFileSync(queue, JSON.stringify(ghShaped));
  fs.writeFileSync(deps, '[]');
  runAlias([queue, deps]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(queue, 'utf8')), ghShaped);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(deps, 'utf8')), []);
});

test('queue-pull-script.md calls the function after the queue write and after each dependency-freshness write', () => {
  const text = QUEUE_PULL.replace(/\r\n/g, '\n');
  const queueWrite = text.indexOf('--limit 500 > "$DISPATCH_QUEUE_RAW"');
  const queueAlias = text.indexOf('alias_mcp_timestamps "$DISPATCH_QUEUE_RAW"');
  const queueRead = text.indexOf('QUEUE_RAW_COUNT=$(');
  assert.ok(queueWrite !== -1 && queueWrite < queueAlias && queueAlias < queueRead, 'queue alias must sit between the fetch and its first read');
  assert.ok(text.indexOf(FN_START) < queueAlias, 'function must be defined before its first call');
  const calls = [...text.matchAll(/^alias_mcp_timestamps "\$DISPATCH_DEP_FRESHNESS"$/gm)];
  assert.strictEqual(calls.length, 2, 'both dependency-freshness writes need an alias call');
  for (const call of calls) {
    const before = text.slice(0, call.index);
    assert.ok(before.lastIndexOf('gh issue list --search') > before.lastIndexOf('node-eval-file.js'), 'alias call must follow its dependency-freshness fetch');
    const nextLine = text.slice(call.index + call[0].length + 1).split('\n')[0];
    assert.ok(/^(CACHE_HIT=|node )/.test(nextLine), 'alias call must precede the reader');
  }
});

test("next-ranking's oldest-first tie-break picks the older record after aliasing", (t) => {
  const queue = path.join(fixtureDir(t), 'queue-raw.json');
  fs.writeFileSync(queue, JSON.stringify(RAW_QUEUE));
  runAlias([queue]);
  const picked = pickOf(t, JSON.parse(fs.readFileSync(queue, 'utf8')));
  assert.strictEqual(picked[0].number, 10);
});

test('control: without aliasing the tie-break falls back to array order', (t) => {
  const picked = pickOf(t, RAW_QUEUE);
  assert.strictEqual(picked[0].number, 20);
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

test('CRLF extraction matches LF', () => {
  const crlf = QUEUE_PULL.replace(/\n/g, '\r\n');
  assert.strictEqual(aliasFunction(crlf).replace(/\r\n/g, '\n'), aliasFunction().replace(/\r\n/g, '\n'));
  const rankCrlf = NEXT_RANKING.replace(/\n/g, '\r\n');
  assert.strictEqual(heredocFrom(rankCrlf, RANK_START).replace(/\r\n/g, '\n'), heredocFrom(NEXT_RANKING, RANK_START));
});

test('the queue-pull MCP notes point at the #3691 alias', () => {
  const pullStart = MCP.indexOf('## Step 2 — queue pull and per-dependency open-state check');
  assert.notStrictEqual(pullStart, -1, 'queue-pull paragraph heading not found in mcp-transport.md');
  const pull = MCP.slice(pullStart, MCP.indexOf('\n## ', pullStart + 1));
  assert.ok(pull.includes('#3691'), 'mcp-transport.md queue-pull paragraph lacks the #3691 pointer');
  const noteStart = QUEUE_PULL.indexOf('**MCP path** (`gh` unavailable): see `mcp-transport.md`');
  assert.notStrictEqual(noteStart, -1, 'MCP-path note not found in queue-pull-script.md');
  const note = QUEUE_PULL.slice(noteStart, QUEUE_PULL.indexOf('\n', noteStart));
  assert.ok(note.includes('#3691'), 'queue-pull-script.md MCP-path note lacks the #3691 pointer');
  // A shell function does not survive between Bash calls, and the MCP path splits the script across several.
  const REDEFINE = 're-run the `alias_mcp_timestamps() { … }` definition at the top of any Bash call that calls it';
  assert.ok(pull.includes(REDEFINE), 'mcp-transport.md queue-pull paragraph lacks the re-define clause');
  assert.ok(note.includes(REDEFINE), 'queue-pull-script.md MCP-path note lacks the re-define clause');
});
