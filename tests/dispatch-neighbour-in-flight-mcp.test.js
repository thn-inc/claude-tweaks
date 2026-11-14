// tests/dispatch-neighbour-in-flight-mcp.test.js — #3392.
//
// mcp-transport.md's neighbour-in-flight section has the agent fetch the bot:in-progress pool and
// its claims through MCP and write them to the two files bin/queue-pull.js reads on
// `--transport files` (--in-flight-raw, --in-flight-claims). #5230: the two node fences the agent
// once ran (claim targets, exclusions) are gone, so the subject is the module's neighbour-in-flight
// pass, run alone on the files transport over fixture files named through the CLI's own flags
// (parseArgs). The MCP-side agent steps (list_issues, claim reads) are fixtured as the files the
// agent would write.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readExclusions } = require('../plugin/bin/lib/dispatch/exclusions.js');
const { PASSES, SESSION_FILES, makeContext, runPasses, sessionPaths } = require('../plugin/bin/lib/dispatch/queue-pull.js');
const { parseArgs } = require('../plugin/bin/queue-pull.js');
const { readText } = require('./helpers/read-skill.js');

const ROOT = path.join(__dirname, '..');
const MCP = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'));

const HEADING = '## Step 2 — neighbour-in-flight pool (#3278, #3392)';

function section(text = MCP) {
  const start = text.indexOf(HEADING);
  assert.notStrictEqual(start, -1, 'section heading anchor not found in mcp-transport.md');
  const next = text.indexOf('\n## ', start + HEADING.length);
  return text.slice(start, next === -1 ? undefined : next);
}

function rec(number, files) {
  return {
    number,
    labels: [{ name: 'priority:medium' }],
    body: '## Technical Approach\n\n### Key Files\n\n' + files.map((f) => `- \`${f}\` — x`).join('\n') + '\n',
  };
}

const NOW = new Date('2026-11-12T12:00:00.000Z');
const liveClaim = () => JSON.stringify({ runId: 'r', claimedAt: '2026-11-12T11:00:00.000Z', ttlHours: 72 });

// The neighbour pass alone, on --transport files, with the pool and claim map the agent wrote
// passed through --in-flight-raw and --in-flight-claims. No gh call and no claim reader may be used.
function runPass(t, { groups = [[rec(1, ['a.js'])]], inFlight = [rec(9, ['a.js'])], claims }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-nif-mcp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raw = path.join(dir, 'in-flight-raw.json');
  const claimsFile = path.join(dir, 'in-flight-claims.json');
  fs.writeFileSync(raw, JSON.stringify(inFlight));
  fs.writeFileSync(claimsFile, JSON.stringify(claims));
  const args = parseArgs(['--transport', 'files', '--in-flight-raw', raw, '--in-flight-claims', claimsFile]);
  assert.equal(args.error, undefined, args.error);
  const errs = [];
  const ctx = makeContext({ transport: args.transport, sessionId: `nif-mcp-${crypto.randomBytes(6).toString('hex')}`, inputs: args.inputs }, {
    stderr: (s) => errs.push(s),
    now: () => NOW,
    run: (cmd, a) => { throw new Error(`no gh call on files: ${cmd} ${a.join(' ')}`); },
    createClaimReader: () => { throw new Error('no claim reader on files'); },
  });
  t.after(() => fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true }));
  assert.deepEqual([ctx.state.files.inFlightRaw, ctx.state.files.inFlightClaims], [raw, claimsFile], 'the flags name the files the pass reads');
  fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify(groups));
  fs.writeFileSync(ctx.paths['dispatch-exclusions.json'], '[]');
  runPasses(PASSES.filter((p) => p.id === 'neighbour-in-flight'), ctx);
  return { stderr: errs.join(''), exclusions: readExclusions(ctx.paths['dispatch-exclusions.json']) };
}

const CLAIM_READ_FAILED_9 = 'AUTO — dispatch: neighbour-in-flight claim read failed for #9; treated as not in flight';

test('AC1.1: a live MCP-read claim in the --in-flight-claims map writes a neighbour-in-flight exclusion', (t) => {
  const { exclusions, stderr } = runPass(t, { claims: { 9: liveClaim() } });
  assert.deepStrictEqual(exclusions, [
    { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
  assert.ok(!stderr.includes('claim read failed'), stderr);
});

test('AC2.1: a stale label with no live claim (a tombstone, or no claim file) read over MCP writes no exclusion', (t) => {
  for (const claim of ['{"released":true}', null]) {
    assert.deepStrictEqual(runPass(t, { claims: { 9: claim } }).exclusions, []);
  }
});

test('AC3.1: a failed MCP claim read prints the AUTO line and writes no exclusion', (t) => {
  const { exclusions, stderr } = runPass(t, { claims: { 9: { failure: 'HTTP 500' } } });
  assert.deepStrictEqual(exclusions, []);
  assert.ok(stderr.includes(CLAIM_READ_FAILED_9), `stderr was: ${stderr}`);
});

test('AC3.1: a failed MCP pool list is documented to write [] and print the existing AUTO line; an empty pool writes no exclusion', (t) => {
  const text = section();
  assert.ok(text.includes('write `[]` there and print `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`'));
  const { exclusions, stderr } = runPass(t, { inFlight: [], claims: {} });
  assert.deepStrictEqual(exclusions, []);
  assert.ok(!stderr.includes('claim read failed'), 'an empty pool reads no claim');
});

// #5230: the CLI prints no claim-targets list, so the claims map must cover every record in the
// pool file; a number left out reads as a failed claim read and the neighbour is missed.
test('#5230: a pool record left out of the --in-flight-claims map is a failed claim read, so its neighbour is missed', (t) => {
  const { exclusions, stderr } = runPass(t, { claims: {} });
  assert.deepStrictEqual(exclusions, []);
  assert.ok(stderr.includes(CLAIM_READ_FAILED_9), `stderr was: ${stderr}`);
});

test('the section maps the pool to list_issues and the claim read to issue-claims.md\'s file-blob path, both written to the files-transport inputs', () => {
  const text = section();
  for (const token of [
    'list_issues', 'bot:in-progress', '_shared/github-write-transport.md', '_shared/issue-claims.md',
    'claims/issue-{n}.json', 'claims-registry', 'claimReaderFromMap', '#3137', 'extractKeyFiles',
    '`--in-flight-raw`', '`--in-flight-claims`', 'the claim of every record in the pool file',
    'stops the pull (exit 4)', '100 per page', 'returned exactly the --limit cap (200)',
  ]) {
    assert.ok(text.includes(token), `section lacks ${token}`);
  }
  assert.ok(!text.includes('documented gap'), 'the gap prose must be gone');
  assert.ok(!text.includes('Re-open when'), 'the re-open clause must be gone');
  assert.ok(!text.includes('does not touch this pass'), 'the false #3137 claim must be gone');
  assert.ok(!text.includes('NODE_EVAL_EOF'), 'the agent runs no node fence in this section any more');
});

test('--in-flight-claims defaults to the session-scoped dispatch-in-flight-claims.json, and the flag is valid only with --transport files', (t) => {
  assert.ok(SESSION_FILES.includes('dispatch-in-flight-claims.json'));
  const sessionId = `nif-mcp-default-${crypto.randomBytes(6).toString('hex')}`;
  const args = parseArgs(['--transport', 'files']);
  const ctx = makeContext({ transport: args.transport, sessionId, inputs: args.inputs });
  t.after(() => fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true }));
  assert.equal(ctx.state.files.inFlightClaims, sessionPaths(sessionId)['dispatch-in-flight-claims.json']);
  assert.match(parseArgs(['--transport', 'gh', '--in-flight-claims', 'x.json']).error, /valid only with --transport files/);
});

// #3520: the pool carries title (the near-duplicate rule's title signal), and a strong
// near-duplicate with no Key Files section is a neighbour.
function recAnchors(number, title, anchors) {
  return {
    number,
    title,
    labels: [{ name: 'priority:medium' }],
    body: '## Current State\n\n' + anchors.map((a) => `- \`${a}\` is wired`).join('\n') + '\n',
  };
}

test('AC8: the pool shape the agent writes includes title', () => {
  assert.ok(section().includes('[{number, title, body, labels}]'));
});

test('AC8: a strong near-duplicate with no Key Files is a neighbour and its exclusion element carries sharedAnchors', (t) => {
  const anchors = ['alpha.one', 'beta.two', 'gamma.three'];
  const { exclusions } = runPass(t, {
    groups: [[recAnchors(1, 'Wire the cache layer', anchors)]],
    inFlight: [recAnchors(9, 'Different words entirely', anchors)],
    claims: { 9: liveClaim() },
  });
  const [exclusion] = exclusions;
  assert.strictEqual(exclusion.reason, 'neighbour-in-flight');
  assert.deepStrictEqual(exclusion.records, [1]);
  assert.deepStrictEqual(exclusion.detail.neighbours.map((n) => n.number), [9]);
  assert.deepStrictEqual(exclusion.detail.neighbours[0].sharedAnchors, [...anchors].sort());
});
