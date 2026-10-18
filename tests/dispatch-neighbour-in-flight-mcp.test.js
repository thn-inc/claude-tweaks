// tests/dispatch-neighbour-in-flight-mcp.test.js — #3392.
//
// mcp-transport.md's neighbour-in-flight section ships two heredoc snippets (claim targets,
// exclusions) that the agent runs on a gh-absent firing. Extract-and-run them, per
// skill-prose-conformance-tests, over fixture files -- the MCP-side agent steps (list_issues,
// claim reads) are fixtured as the files the agent would write.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readExclusions } = require('../plugin/bin/lib/dispatch/exclusions.js');

const ROOT = path.join(__dirname, '..');
const MCP = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'), 'utf8');
const QUEUE_PULL = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'), 'utf8');

const HEADING = '## Step 2 — neighbour-in-flight pool (#3278, #3392)';
const START = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js"';
const END = 'NODE_EVAL_EOF\n';

function section() {
  const start = MCP.indexOf(HEADING);
  assert.notStrictEqual(start, -1, 'section heading anchor not found in mcp-transport.md');
  const next = MCP.indexOf('\n## ', start + HEADING.length);
  return MCP.slice(start, next === -1 ? undefined : next);
}

// The Nth heredoc: from its node-eval-file.js line through its closing NODE_EVAL_EOF line.
function snippet(index) {
  const text = section();
  let from = 0;
  let found = -1;
  for (let i = 0; i <= index; i += 1) {
    found = text.indexOf(START, from);
    assert.notStrictEqual(found, -1, `heredoc #${index} not found in the section`);
    from = found + START.length;
  }
  const close = text.indexOf('\n' + END, found);
  assert.notStrictEqual(close, -1, `heredoc #${index} has no NODE_EVAL_EOF terminator`);
  return text.slice(found, close + 1 + END.length);
}

function rec(number, files) {
  return {
    number,
    labels: [{ name: 'priority:medium' }],
    body: '## Technical Approach\n\n### Key Files\n\n' + files.map((f) => `- \`${f}\` — x`).join('\n') + '\n',
  };
}

function fixture(t, { groups = [[rec(1, ['a.js'])]], inFlight = [rec(9, ['a.js'])], claims }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-nif-mcp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    DISPATCH_GROUPS: path.join(dir, 'groups.json'),
    DISPATCH_IN_FLIGHT_RAW: path.join(dir, 'in-flight-raw.json'),
    DISPATCH_EXCLUSIONS: path.join(dir, 'exclusions.json'),
    DISPATCH_IN_FLIGHT_CLAIMS: path.join(dir, 'in-flight-claims.json'),
  };
  fs.writeFileSync(files.DISPATCH_GROUPS, JSON.stringify(groups));
  fs.writeFileSync(files.DISPATCH_IN_FLIGHT_RAW, JSON.stringify(inFlight));
  fs.writeFileSync(files.DISPATCH_IN_FLIGHT_CLAIMS, JSON.stringify(claims));
  return files;
}

function run(code, files) {
  const result = spawnSync('bash', ['-c', code], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin'), ...files },
  });
  assert.strictEqual(result.status, 0, `snippet exited ${result.status}: ${result.stderr}`);
  return result;
}

const liveClaim = () => JSON.stringify({ runId: 'r', claimedAt: new Date().toISOString(), ttlHours: 72 });

test('AC1.1: the MCP claim-target snippet prints [9] and the MCP exclusion snippet writes a neighbour-in-flight exclusion for a live MCP-read claim', (t) => {
  const files = fixture(t, { claims: { 9: liveClaim() } });
  const targets = run(snippet(0), files);
  assert.deepStrictEqual(JSON.parse(targets.stdout), [9]);
  run(snippet(1), files);
  assert.deepStrictEqual(readExclusions(files.DISPATCH_EXCLUSIONS), [
    { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
});

test('AC2.1: a stale label with no live claim (a tombstone, or no claim file) read over MCP writes no exclusion', (t) => {
  for (const claim of ['{"released":true}', null]) {
    const files = fixture(t, { claims: { 9: claim } });
    run(snippet(1), files);
    assert.deepStrictEqual(readExclusions(files.DISPATCH_EXCLUSIONS), []);
  }
});

test('AC3.1: a failed MCP claim read prints the AUTO line and writes no exclusion', (t) => {
  const files = fixture(t, { claims: { 9: { failure: 'HTTP 500' } } });
  const result = run(snippet(1), files);
  assert.deepStrictEqual(readExclusions(files.DISPATCH_EXCLUSIONS), []);
  assert.ok(
    result.stderr.includes('AUTO — dispatch: neighbour-in-flight claim read failed for #9; treated as not in flight'),
    `stderr was: ${result.stderr}`,
  );
});

test('AC3.1: a failed MCP pool list is documented to write [] and print the existing AUTO line; an empty pool writes no exclusion', (t) => {
  const text = section();
  assert.ok(text.includes('write `[]` there and print `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`'));
  const files = fixture(t, { inFlight: [], claims: {} });
  assert.deepStrictEqual(JSON.parse(run(snippet(0), files).stdout), []);
  run(snippet(1), files);
  assert.deepStrictEqual(readExclusions(files.DISPATCH_EXCLUSIONS), []);
});

test('the section maps the pool to list_issues and the claim read to issue-claims.md\'s file-blob path', () => {
  const text = section();
  for (const token of [
    'list_issues', 'bot:in-progress', '_shared/github-write-transport.md', '_shared/issue-claims.md',
    'claims/issue-{n}.json', 'claims-registry', 'claimReaderFromMap', '#3137', 'extractKeyFiles',
    'NEIGHBOUR_RC', '100 per page', 'returned exactly the --limit cap (200)',
  ]) {
    assert.ok(text.includes(token), `section lacks ${token}`);
  }
  assert.ok(!text.includes('documented gap'), 'the gap prose must be gone');
  assert.ok(!text.includes('Re-open when'), 'the re-open clause must be gone');
  assert.ok(!text.includes('does not touch this pass'), 'the false #3137 claim must be gone');
});

test('queue-pull-script.md declares DISPATCH_IN_FLIGHT_CLAIMS and points MCP-transport firings at mcp-transport.md', () => {
  assert.ok(QUEUE_PULL.includes("DISPATCH_IN_FLIGHT_CLAIMS: 'dispatch-in-flight-claims.json'"));
  const anchor = '# #3278: neighbour-in-flight pass.';
  const at = QUEUE_PULL.indexOf(anchor);
  assert.notStrictEqual(at, -1);
  assert.ok(QUEUE_PULL.slice(at, at + 400).includes('mcp-transport.md'));
});
